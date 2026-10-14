/**
 * The AI coach: API Gateway HTTP API → Python Lambda → NVIDIA NIM.
 *
 * The browser never sees the NVIDIA key. It's a SecureString in SSM Parameter
 * Store, created by hand (see `NVIDIA_KEY_PARAM`) so the secret never appears in
 * code, CloudFormation or the CDK assembly. The Lambda reads it at cold start.
 *
 * The API is reached through the web stack's CloudFront distribution at
 * `/api/*`, so the app calls its own origin: no CORS, and no API URL baked into
 * the build. Throttling caps how fast a stranger could burn NVIDIA credits.
 */

import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { spawnSync } from 'node:child_process';
import { cpSync } from 'node:fs';
import path from 'node:path';
import type { Construct } from 'constructs';

export const NVIDIA_KEY_PARAM = '/squat-challenge/nvidia-api-key';

export interface CoachStackProps extends StackProps {
  /** The `coach/` directory (Python package + requirements-lambda.txt). */
  coachPath: string;
}

export class CoachStack extends Stack {
  readonly api: apigw.HttpApi;

  constructor(scope: Construct, id: string, props: CoachStackProps) {
    super(scope, id, props);

    const fn = new lambda.Function(this, 'CoachFn', {
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.X86_64,
      handler: 'coach.aws_lambda.handler',
      code: coachCode(props.coachPath),
      memorySize: 512,
      // Cold start embeds the knowledge base, then one embed + one chat call.
      timeout: Duration.seconds(25),
      environment: {
        NVIDIA_API_KEY_PARAM: NVIDIA_KEY_PARAM,
      },
      logGroup: new logs.LogGroup(this, 'CoachLogs', { retention: logs.RetentionDays.TWO_WEEKS }),
    });

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          Stack.of(this).formatArn({ service: 'ssm', resource: 'parameter', resourceName: NVIDIA_KEY_PARAM.slice(1) }),
        ],
      }),
    );

    this.api = new apigw.HttpApi(this, 'Api', { description: 'Squat Challenge coach' });
    this.api.addRoutes({
      path: '/api/coach',
      methods: [apigw.HttpMethod.POST],
      integration: new HttpLambdaIntegration('CoachIntegration', fn),
    });

    const stage = this.api.defaultStage?.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 2, throttlingBurstLimit: 5 };

    new CfnOutput(this, 'ApiEndpoint', { value: this.api.apiEndpoint });
  }
}

/**
 * Bundles the package with Linux wheels. Tries the local Python first (pip can
 * fetch manylinux wheels from Windows or macOS), falling back to Docker.
 */
function coachCode(coachPath: string): lambda.Code {
  const install = (python: string, out: string) => [
    python, '-m', 'pip', 'install', '--quiet', '--no-compile',
    '--requirement', path.join(coachPath, 'requirements-lambda.txt'),
    '--target', out,
    '--platform', 'manylinux2014_x86_64', '--implementation', 'cp',
    '--python-version', '3.13', '--only-binary=:all:',
  ];

  return lambda.Code.fromAsset(coachPath, {
    exclude: ['**/__pycache__', '.env', 'tests', '*.egg-info', '.pytest_cache'],
    bundling: {
      image: lambda.Runtime.PYTHON_3_13.bundlingImage,
      command: [
        'bash', '-c',
        'pip install -q -r requirements-lambda.txt -t /asset-output && cp -r src/coach /asset-output/',
      ],
      local: {
        tryBundle(outputDir) {
          for (const python of ['python', 'python3']) {
            const [cmd, ...args] = install(python, outputDir);
            if (spawnSync(cmd, args, { stdio: 'inherit' }).status === 0) {
              cpSync(path.join(coachPath, 'src', 'coach'), path.join(outputDir, 'coach'), {
                recursive: true,
                filter: (src) => !src.includes('__pycache__'),
              });
              return true;
            }
          }
          return false;
        },
      },
    },
  });
}
