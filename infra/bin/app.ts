#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { ChatStack } from '../lib/chat-stack.js';
import { CronStack } from '../lib/cron-stack.js';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Written into cdk.json context by scripts/deploy.sh after `agentcore deploy`.
const runtimeArn = app.node.tryGetContext('agentcore_runtime_arn') as string;
const qualifier = (app.node.tryGetContext('agentcore_qualifier') as string) || 'DEFAULT';

new ChatStack(app, 'sansho-web', {
  env,
  runtimeArn,
  qualifier,
});

new CronStack(app, 'sansho-cron', {
  env,
  runtimeArn,
  qualifier,
  whatsappSecretName: 'sansho/whatsapp',
});
