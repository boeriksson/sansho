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
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { WebSocketLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { UserPool, UserPoolClient, AccountRecovery } from 'aws-cdk-lib/aws-cognito';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ChatStackProps extends StackProps {
  runtimeArn: string;
  qualifier: string;
}

export class ChatStack extends Stack {
  constructor(scope: Construct, id: string, props: ChatStackProps) {
    super(scope, id, props);

    const { runtimeArn, qualifier } = props;

    // Cognito UserPool
    const userPool = new UserPool(this, 'ChatUserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
    });

    // UserPoolClient
    const userPoolClient = new UserPoolClient(this, 'ChatUserPoolClient', {
      userPool,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      disableOAuth: true,
    });

    // DynamoDB Table
    const connectionsTable = new Table(this, 'WsConnectionsTable', {
      tableName: 'sansho-ws-connections',
      partitionKey: { name: 'connectionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Lambda authorizer for Cognito token validation via query string
    const authFn = new NodejsFunction(this, 'ChatAuthFn', {
      functionName: 'sansho-web-authorizer',
      entry: path.join(__dirname, '..', 'lambdas', 'chat-authorizer.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 128,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        AWS_REGION_NAME: this.region,
      },
      bundling: {
        format: OutputFormat.ESM,
        externalModules: [],
        minify: false,
      },
    });

    // Main chat Lambda function
    const fn = new NodejsFunction(this, 'ChatFn', {
      functionName: 'sansho-web-handler',
      entry: path.join(__dirname, '..', 'lambdas', 'chat.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE: connectionsTable.tableName,
        AGENTCORE_RUNTIME_ARN: runtimeArn,
        AGENTCORE_QUALIFIER: qualifier,
      },
      bundling: {
        format: OutputFormat.ESM,
        externalModules: [],
        minify: false,
        // CJS AWS SDK packages use require('node:https') which breaks in ESM bundles.
        // This banner injects a real require() at the top of the ESM output.
        banner: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
      },
    });

    // Grants
    connectionsTable.grantReadWriteData(fn);

    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime', 'bedrock-agentcore:InvokeAgentRuntimeForUser'],
        resources: runtimeArn ? [runtimeArn, `${runtimeArn}/*`] : ['*'],
      }),
    );

    // WebSocket Authorizer (validates Cognito token passed as query string ?token=...)
    const wsAuthorizer = new WebSocketLambdaAuthorizer('ChatWsAuthorizer', authFn, {
      identitySource: ['route.request.querystring.token'],
    });

    // WebSocket API
    const wsApi = new WebSocketApi(this, 'ChatWsApi', {
      apiName: 'sansho-web',
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('ConnectIntegration', fn),
        authorizer: wsAuthorizer,
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectIntegration', fn),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration('DefaultIntegration', fn),
      },
    });

    const wsStage = new WebSocketStage(this, 'ChatWsStage', {
      webSocketApi: wsApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant execute-api:ManageConnections
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/prod/POST/@connections/*`,
        ],
      }),
    );

    // Outputs
    new CfnOutput(this, 'WsEndpoint', { value: wsStage.url });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
  }
}
