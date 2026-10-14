/**
 * CDK entry point.
 *
 *   npx cdk deploy --all -c alertEmail=you@example.com
 *
 * Stacks so far: stateful (data + identity + budget) and web (hosting). The
 * API and the live-versus WebSocket stacks come next; see docs/architecture.md.
 */

import { App } from 'aws-cdk-lib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StatefulStack } from '../lib/stateful-stack.js';
import { WebStack } from '../lib/web-stack.js';

const app = new App();

const alertEmail: unknown = app.node.tryGetContext('alertEmail');
if (typeof alertEmail !== 'string' || !alertEmail.includes('@')) {
  // Deploying without a budget alarm is exactly the mistake that causes
  // surprise bills, so it is a hard error rather than a default.
  throw new Error('Pass the budget alert address: cdk deploy -c alertEmail=you@example.com');
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const here = path.dirname(fileURLToPath(import.meta.url));

new StatefulStack(app, 'SquatChallenge-Stateful', {
  env,
  alertEmail,
  monthlyBudgetUsd: Number(app.node.tryGetContext('monthlyBudgetUsd') ?? 5),
  description: 'Squat Challenge: tables, user pool, budget (retained on delete).',
});

new WebStack(app, 'SquatChallenge-Web', {
  env,
  distPath: path.resolve(here, '../../dist'),
  description: 'Squat Challenge: S3 + CloudFront hosting for the PWA.',
});

app.synth();
