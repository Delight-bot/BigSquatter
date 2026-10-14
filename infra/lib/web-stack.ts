/**
 * Static hosting for the PWA: a private S3 bucket behind CloudFront.
 *
 * The bucket is never public; CloudFront reads it through Origin Access
 * Control. Caching is split by how the build names files:
 *
 *  - `/assets/*` is content-hashed by Vite, so it can be cached for a year —
 *    a new build produces new file names rather than changing old ones.
 *  - The pose model and WASM runtime are large and versioned with the app, so
 *    they are cached at the edge too.
 *  - Everything else (index.html, sw.js, the manifest) must never be stale,
 *    or users keep getting the old app after a deploy.
 */

import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import type * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

export interface WebStackProps extends StackProps {
  /** Path to the built app (`npm run build` → `dist/`). */
  distPath: string;
  /** Served at `/api/*` on the same domain, so the app needs no CORS or API URL. */
  api?: apigw.IHttpApi;
}

export class WebStack extends Stack {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // The bucket only ever holds build output, which `deploy` can recreate.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const origin = S3BucketOrigin.withOriginAccessControl(bucket);
    const longCache: cloudfront.AddBehaviorOptions = {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
    };

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        compress: true,
      },
      additionalBehaviors: {
        '/assets/*': { origin, ...longCache },
        '/models/*': { origin, ...longCache },
        '/mediapipe/*': { origin, ...longCache },
        ...(props.api && {
          '/api/*': {
            origin: new HttpOrigin(
              `${props.api.apiId}.execute-api.${Stack.of(this).region}.${Stack.of(this).urlSuffix}`,
            ),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            // API Gateway routes on its own Host header, so forward everything else.
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          },
        }),
      },
      // The app uses hash routing, so there are no deep URLs to rewrite.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    new s3deploy.BucketDeployment(this, 'Deploy', {
      sources: [s3deploy.Source.asset(props.distPath)],
      destinationBucket: bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      // Large WASM and model files need more room than the default.
      memoryLimit: 512,
    });

    new CfnOutput(this, 'SiteUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
    });
  }
}
