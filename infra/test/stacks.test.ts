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
