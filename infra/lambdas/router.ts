import { createHmac, timingSafeEqual } from 'node:crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  getWhatsappConfig,
  invokeAgent,
  sendWhatsappText,
  type WhatsappConfig,
} from './agentcore.js';

const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'us-west-2' });

// Shape of the payload we send to ourselves for the slow (async) path.
interface AsyncJob {
  __async: true;
  to: string;
  text: string;
}

type RouterEvent = APIGatewayProxyEventV2 | AsyncJob;

export const handler = async (
  event: RouterEvent,
): Promise<APIGatewayProxyResultV2 | void> => {
  // Slow path: invoked asynchronously by ourselves with a parsed message.
  if ('__async' in event && event.__async) {
    await processMessage(event.to, event.text);
    return;
  }

  const apiEvent = event as APIGatewayProxyEventV2;
  const method = apiEvent.requestContext?.http?.method;

  if (method === 'GET') return verifyWebhook(apiEvent);
  if (method === 'POST') return receiveWebhook(apiEvent);

  return { statusCode: 405, body: 'Method Not Allowed' };
};

// Meta webhook verification handshake (GET).
async function verifyWebhook(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const q = event.queryStringParameters || {};
  const mode = q['hub.mode'];
  const token = q['hub.verify_token'];
  const challenge = q['hub.challenge'];

  const cfg = await getWhatsappConfig();
  if (mode === 'subscribe' && token === cfg.verifyToken && challenge) {
    return { statusCode: 200, body: challenge };
  }
  return { statusCode: 403, body: 'Forbidden' };
}

// Incoming messages (POST). Validate, fan out to async, ACK fast.
async function receiveWebhook(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const cfg = await getWhatsappConfig();

  const rawBuf = event.body
    ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')
    : Buffer.alloc(0);

  const signature = event.headers?.['x-hub-signature-256'];
  if (!verifySignature(cfg.appSecret, rawBuf, signature)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let body: any;
  try {
    body = JSON.parse(rawBuf.toString('utf8'));
  } catch {
    return { statusCode: 200, body: 'ok' }; // ignore non-JSON, still ACK
  }

  for (const msg of extractTextMessages(body)) {
    await lambda.send(
      new InvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        InvocationType: 'Event',
        Payload: Buffer.from(
          JSON.stringify({ __async: true, to: msg.from, text: msg.text }),
        ),
      }),
    );
  }

  // Meta requires a fast 200 or it retries and disables the webhook.
  return { statusCode: 200, body: 'ok' };
}

function verifySignature(
  appSecret: string,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface IncomingText {
  from: string;
  text: string;
}

function extractTextMessages(body: any): IncomingText[] {
  const out: IncomingText[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const msg of change?.value?.messages ?? []) {
        if (msg?.type === 'text' && msg?.text?.body && msg?.from) {
          out.push({ from: msg.from, text: msg.text.body });
        }
      }
    }
  }
  return out;
}

// Slow path: ask the agent, then reply on WhatsApp.
async function processMessage(to: string, text: string): Promise<void> {
  const cfg: WhatsappConfig = await getWhatsappConfig();
  let reply: string;
  try {
    reply = await invokeAgent({
      prompt: text,
      channel: 'whatsapp',
      chatId: to,
      userId: to,
    });
  } catch (err) {
    console.error('Agent invocation failed:', err);
    reply = 'Sorry, something went wrong reaching the agent.';
  }
  await sendWhatsappText(cfg, to, reply);
}
