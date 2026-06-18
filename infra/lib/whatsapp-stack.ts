import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  Stack,
  type StackProps,
  Duration,
  CfnOutput,
  RemovalPolicy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface WhatsappStackProps extends StackProps {
  runtimeArn: string;
  qualifier: string;
  whatsappSecretName: string;
}

export class WhatsappStack extends Stack {
  constructor(scope: Construct, id: string, props: WhatsappStackProps) {
    super(scope, id, props);

    const { runtimeArn, qualifier, whatsappSecretName } = props;

    // Holds the WhatsApp Cloud API config as a JSON blob:
    //   { "accessToken", "phoneNumberId", "appSecret", "verifyToken" }
    // Created empty here; fill it in after deploy with `put-secret-value`.
    const secret = new Secret(this, 'WhatsappSecret', {
      secretName: whatsappSecretName,
      description: 'WhatsApp Cloud API credentials for the Hermes agent',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const fn = new NodejsFunction(this, 'RouterFn', {
      functionName: 'sansho-whatsapp-router',
      entry: path.join(__dirname, '..', 'lambdas', 'router.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      // AgentCore cold start is 10-30s; the webhook ACK path stays fast, the
      // self-invoked async path does the slow work. Give it generous headroom.
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        AGENTCORE_RUNTIME_ARN: runtimeArn,
        AGENTCORE_QUALIFIER: qualifier,
        WHATSAPP_SECRET_NAME: whatsappSecretName,
      },
      bundling: {
        format: OutputFormat.ESM,
        // Bundle every dependency (including the AgentCore SDK client, which
        // is not guaranteed to be present in the Lambda runtime).
        externalModules: [],
        minify: false,
      },
    });

    secret.grantRead(fn);

    // Invoke the deployed AgentCore runtime.
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: runtimeArn ? [runtimeArn, `${runtimeArn}/*`] : ['*'],
      }),
    );

    // Allow the function to invoke itself asynchronously (fast ACK pattern).
    // Use '*' resource to avoid circular dep: fn.functionArn in role policy
    // causes Lambda→DependsOn→RolePolicy→fn.functionArn→Lambda cycle.
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: ['*'],
      }),
    );

    const api = new HttpApi(this, 'WebhookApi', {
      apiName: 'sansho-whatsapp',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST],
      },
    });

    const integration = new HttpLambdaIntegration('RouterIntegration', fn);

    api.addRoutes({
      path: '/webhook/whatsapp',
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration,
    });

    new CfnOutput(this, 'WebhookUrl', {
      value: `${api.apiEndpoint}/webhook/whatsapp`,
      description: 'Set this as the WhatsApp Cloud API webhook callback URL',
    });
  }
}
