/**
 * Everything that holds data or identity: the tables, the user pool, and the
 * account's cost guardrail.
 *
 * Kept apart from the stateless stack on purpose. Lambdas, APIs and the CDN
 * are redeployed constantly and can be torn down and rebuilt freely; a table or
 * user pool can't be without losing every user. A separate stack with
 * termination protection and RETAIN policies means a bad `cdk destroy` of the
 * app can never take the users' data with it. See docs/architecture.md, ADR-2.
 */

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

export interface StatefulStackProps extends StackProps {
  /** Where budget alerts go. */
  alertEmail: string;
  /** Monthly spend, in USD, that counts as "something is wrong". */
  monthlyBudgetUsd: number;
}

export class StatefulStack extends Stack {
  readonly table: dynamodb.TableV2;
  readonly realtimeTable: dynamodb.TableV2;
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: StatefulStackProps) {
    super(scope, id, { ...props, terminationProtection: true });

    /*
     * Single table, keyed for the app's access patterns (ADR-3):
     *
     *   pk               sk                 item
     *   USER#<sub>       PROFILE            display name
     *   USER#<sub>       CHALLENGE#<id>     day map + capped session list
     *   GROUP#<id>       META               name, invite code, owner
     *   GROUP#<id>       MEMBER#<sub>       name + denormalised standing
     *
     *   gsi1pk           gsi1sk
     *   CODE#<code>      GROUP#<id>         find a group by invite code
     *   USER#<sub>       GROUP#<id>         list the groups a user is in
     */
    this.table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          indexName: 'gsi1',
          partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    /*
     * Live versus connections. Short-lived by nature, so a TTL sweeps up
     * anything a dropped socket left behind, and there is nothing worth
     * backing up or protecting here.
     *
     *   pk              sk                 item
     *   MATCH#<code>    CONN#<connId>      role, name
     *   CONN#<connId>   META               which match it belongs to
     */
    this.realtimeTable = new dynamodb.TableV2(this, 'RealtimeTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Passwordless: users get a one-time code by email, so there are no
    // passwords to store, reset or leak (ADR-4).
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      signInPolicy: {
        // Cognito requires password to stay allowed as a factor; the app only
        // ever offers the email code.
        allowedFirstAuthFactors: { password: true, emailOtp: true },
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      standardAttributes: { email: { required: true, mutable: true } },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      // Cognito's built-in sender is capped at a handful of emails a day. Fine
      // for development; switch to SES before launch (see the runbook).
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      // A browser can't keep a secret, so the client is public.
      generateSecret: false,
      authFlows: { user: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    new CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'squat-challenge-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        // Early warning on actual spend, and a heads-up when the month is on
        // track to blow through the limit before it actually does.
        notify('ACTUAL', 50, props.alertEmail),
        notify('ACTUAL', 100, props.alertEmail),
        notify('FORECASTED', 100, props.alertEmail),
      ],
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: this.table.tableName });
  }
}

function notify(
  notificationType: 'ACTUAL' | 'FORECASTED',
  percent: number,
  email: string,
): CfnBudget.NotificationWithSubscribersProperty {
  return {
    notification: {
      notificationType,
      comparisonOperator: 'GREATER_THAN',
      threshold: percent,
      thresholdType: 'PERCENTAGE',
    },
    subscribers: [{ subscriptionType: 'EMAIL', address: email }],
  };
}
