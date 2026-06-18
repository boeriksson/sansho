import { getWhatsappConfig, invokeAgent, sendWhatsappText } from './agentcore.js';

// Event shape comes from the EventBridge rule input (see cron-stack.ts):
//   { jobId, prompt, deliverTo }
interface CronEvent {
  jobId: string;
  prompt: string;
  deliverTo: string;
}

export const handler = async (event: CronEvent): Promise<void> => {
  const { jobId, prompt, deliverTo } = event;

  const reply = await invokeAgent({
    prompt,
    channel: 'cron',
    chatId: deliverTo,
    userId: deliverTo,
  });

  const cfg = await getWhatsappConfig();
  await sendWhatsappText(cfg, deliverTo, `[${jobId}]\n\n${reply}`);
};
