import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { invokeAgent } from './agentcore.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.CONNECTIONS_TABLE!;

export const handler = async (event: any): Promise<{ statusCode: number }> => {
  const routeKey = event.requestContext.routeKey as string;
  const connectionId = event.requestContext.connectionId as string;
  const callbackUrl = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;

  if (routeKey === '$connect') {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          connectionId,
          ttl: Math.floor(Date.now() / 1000) + 86400,
        },
      }),
    );
    return { statusCode: 200 };
  }

  if (routeKey === '$disconnect') {
    await ddb.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { connectionId },
      }),
    );
    return { statusCode: 200 };
  }

  // $default — process message
  const apigw = new ApiGatewayManagementApiClient({ endpoint: callbackUrl });

  try {
    const body = JSON.parse(event.body ?? '{}');
    const message = body.message as string;

    const reply = await invokeAgent({
      prompt: message,
      channel: 'web',
      userId: connectionId,
      chatId: connectionId,
    });

    await apigw.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({ type: 'message', content: reply }),
      }),
    );
  } catch (err) {
    console.error('Error processing message:', err);
    await apigw.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({ type: 'error', content: 'Failed to process message' }),
      }),
    );
  }

  return { statusCode: 200 };
};
