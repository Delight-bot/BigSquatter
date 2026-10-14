/**
 * Guards on the properties that matter most and are easiest to lose in a
 * refactor: data can't be deleted by accident, the bucket is never public,
 * and the user pool stays passwordless.
 */

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CoachStack, NVIDIA_KEY_PARAM } from '../lib/coach-stack.js';
import { StatefulStack } from '../lib/stateful-stack.js';
import { WebStack } from '../lib/web-stack.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = { account: '123456789012', region: 'us-east-1' };

function stateful() {
  const app = new App();
  const stack = new StatefulStack(app, 'Stateful', {
    env,
    alertEmail: 'alerts@example.com',
    monthlyBudgetUsd: 5,
  });
  return { stack, template: Template.fromStack(stack) };
}

describe('StatefulStack', () => {
  it('protects the main table from deletion', () => {
    const { template } = stateful();
    template.hasResource('AWS::DynamoDB::GlobalTable', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        Replicas: [
          Match.objectLike({
            DeletionProtectionEnabled: true,
            PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
          }),
        ],
      }),
    });
  });

  it('expires realtime connections with a TTL', () => {
    const { template } = stateful();
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
  });

  it('keeps the user pool and turns on email one-time codes', () => {
    const { template } = stateful();
    template.hasResource('AWS::Cognito::UserPool', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        Policies: Match.objectLike({
          SignInPolicy: { AllowedFirstAuthFactors: Match.arrayWith(['EMAIL_OTP']) },
        }),
      }),
    });
  });

  it('gives the browser a public client with no secret', () => {
    const { template } = stateful();
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_AUTH']),
    });
  });

  it('alerts on spend', () => {
    const { template } = stateful();
    template.resourceCountIs('AWS::Budgets::Budget', 1);
  });

  it('turns on termination protection', () => {
    expect(stateful().stack.terminationProtection).toBe(true);
  });
});

describe('WebStack', () => {
  const app = new App();
  const stack = new WebStack(app, 'Web', { env, distPath: path.resolve(here, '../../dist') });
  const template = Template.fromStack(stack);

  it('never makes the bucket public', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('reads the bucket through Origin Access Control', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('forces HTTPS, which the camera requires', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    });
  });
});

describe('CoachStack + WebStack', () => {
  // Skip bundling: tests check the template, not the Python package.
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const coach = new CoachStack(app, 'Coach', { env, coachPath: path.resolve(here, '../../coach') });
  const web = new WebStack(app, 'Web', { env, distPath: path.resolve(here, '../../dist'), api: coach.api });
  const coachTemplate = Template.fromStack(coach);
  const webTemplate = Template.fromStack(web);

  it('runs the coach on Python with the key parameter name, never the key', () => {
    coachTemplate.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'python3.13',
      Handler: 'coach.aws_lambda.handler',
      Environment: { Variables: { NVIDIA_API_KEY_PARAM: NVIDIA_KEY_PARAM } },
    });
    expect(JSON.stringify(coachTemplate.toJSON())).not.toMatch(/nvapi-/);
  });

  it('lets the Lambda read only the key parameter', () => {
    const policies = Object.values(coachTemplate.findResources('AWS::IAM::Policy'));
    const statements = policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
    const ssm = statements.filter((st) => JSON.stringify(st.Action).includes('ssm:'));
    expect(ssm).toHaveLength(1);
    expect(ssm[0].Action).toBe('ssm:GetParameter');
    expect(JSON.stringify(ssm[0].Resource)).toContain(`:parameter${NVIDIA_KEY_PARAM}`);
  });

  it('throttles the public API', () => {
    coachTemplate.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingRateLimit: 2, ThrottlingBurstLimit: 5 },
    });
  });

  it('serves /api/* through CloudFront without caching', () => {
    webTemplate.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/api/*',
            AllowedMethods: Match.arrayWith(['POST']),
            ViewerProtocolPolicy: 'https-only',
          }),
        ]),
      }),
    });
  });
});
