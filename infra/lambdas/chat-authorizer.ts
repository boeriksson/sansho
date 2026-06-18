/**
 * WebSocket Lambda authorizer that validates a Cognito JWT token
 * passed as a query string parameter (?token=<id_token>).
 *
 * This is the stable-CDK equivalent of WebSocketUserPoolAuthorizer
 * (which only exists in the frozen @aws-cdk/aws-apigatewayv2-authorizers-alpha package).
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

const region = process.env.AWS_REGION_NAME!;
const userPoolId = process.env.USER_POOL_ID!;
const clientId = process.env.USER_POOL_CLIENT_ID!;

const jwksUrl = new URL(
  `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
);
const JWKS = createRemoteJWKSet(jwksUrl);

export const handler = async (event: any): Promise<any> => {
  const token: string | undefined =
    event.queryStringParameters?.token ??
    event.headers?.Authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    throw new Error('Unauthorized');
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
      audience: clientId,
    });

    const principalId = (payload.sub as string) ?? 'user';

    return {
      principalId,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: event.methodArn,
          },
        ],
      },
      context: {
        userId: principalId,
        email: payload.email ?? '',
      },
    };
  } catch (e) {
    console.error('JWT verification failed:', e);
    throw new Error('Unauthorized');
  }
};
