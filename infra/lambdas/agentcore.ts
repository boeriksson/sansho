import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const region = process.env.AWS_REGION || 'us-west-2';
const agentcore = new BedrockAgentCoreClient({ region });
const secrets = new SecretsManagerClient({ region });

export interface WhatsappConfig {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
}

let cachedConfig: WhatsappConfig | undefined;

export async function getWhatsappConfig(): Promise<WhatsappConfig> {
  if (cachedConfig) return cachedConfig;
  const name = process.env.WHATSAPP_SECRET_NAME;
  if (!name) throw new Error('WHATSAPP_SECRET_NAME not set');
  const res = await secrets.send(new GetSecretValueCommand({ SecretId: name }));
  if (!res.SecretString) throw new Error(`Secret ${name} has no value yet`);
  cachedConfig = JSON.parse(res.SecretString) as WhatsappConfig;
  return cachedConfig;
}

// AgentCore requires runtimeSessionId to be at least 33 characters.
function padSessionId(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9_:-]/g, '_');
  return clean.length >= 33 ? clean : clean.padEnd(33, '0');
}

export interface InvokeArgs {
  prompt: string;
  channel: string;
  chatId?: string;
  userId: string; // stable per-conversation id; also drives the session
}

export async function invokeAgent(args: InvokeArgs): Promise<string> {
  const runtimeArn = process.env.AGENTCORE_RUNTIME_ARN;
  if (!runtimeArn) throw new Error('AGENTCORE_RUNTIME_ARN not set');
  const qualifier = process.env.AGENTCORE_QUALIFIER || 'DEFAULT';

  const payload = JSON.stringify({
    prompt: args.prompt,
    message: args.prompt,
    channel: args.channel,
    chatId: args.chatId,
  });

  const res = await agentcore.send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: runtimeArn,
      qualifier,
      runtimeSessionId: padSessionId(`${args.channel}:${args.userId}`),
      runtimeUserId: `${args.channel}:${args.userId}`,
      contentType: 'application/json',
      accept: 'text/event-stream',
      payload: new TextEncoder().encode(payload),
    }),
  );

  const raw = res.response ? await res.response.transformToString() : '';
  console.log('AgentCore raw response:', JSON.stringify(raw));
  const parsed = parseAgentResponse(raw);
  console.log('AgentCore parsed response:', JSON.stringify(parsed));
  return parsed;
}

// The runtime streams its reply as Server-Sent Events: each yielded chunk
// arrives as a `data: <json-encoded-string>` line. Concatenate the chunks.
function parseAgentResponse(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const dataLines = trimmed
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());

  const chunks = dataLines.length ? dataLines : [trimmed];

  let out = '';
  for (const chunk of chunks) {
    if (!chunk) continue;
    try {
      const parsed = JSON.parse(chunk);
      out += typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    } catch {
      out += chunk;
    }
  }
  return out.trim();
}

export async function sendWhatsappText(
  cfg: WhatsappConfig,
  to: string,
  body: string,
): Promise<void> {
  // WhatsApp text bodies are capped at 4096 characters.
  const text = body.length > 4096 ? body.slice(0, 4093) + '...' : body || '(no response)';

  const url = `https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${errBody}`);
  }
}
