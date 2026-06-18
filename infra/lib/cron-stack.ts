import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import {
  Stack,
  type StackProps,
  Duration,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Rule, Schedule, RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface CronJob {
  name: string;
  schedule: string; // EventBridge cron/rate expression, e.g. "cron(0 8 * * ? *)"
  prompt: string;
  deliverTo: string; // WhatsApp recipient phone number in E.164, e.g. "15551234567"
  enabled?: boolean;
}

export interface CronStackProps extends StackProps {
  runtimeArn: string;
  qualifier: string;
  whatsappSecretName: string;
}

export class CronStack extends Stack {
  constructor(scope: Construct, id: string, props: CronStackProps) {
    super(scope, id, props);

    const { runtimeArn, qualifier, whatsappSecretName } = props;

    const secret = Secret.fromSecretNameV2(this, 'WhatsappSecret', whatsappSecretName);

    const fn = new NodejsFunction(this, 'CronFn', {
      functionName: 'sansho-cron',
      entry: path.join(__dirname, '..', 'lambdas', 'cron.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        AGENTCORE_RUNTIME_ARN: runtimeArn,
        AGENTCORE_QUALIFIER: qualifier,
        WHATSAPP_SECRET_NAME: whatsappSecretName,
      },
      bundling: {
        format: OutputFormat.ESM,
        externalModules: [],
        minify: false,
      },
    });

    secret.grantRead(fn);
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: runtimeArn ? [runtimeArn, `${runtimeArn}/*`] : ['*'],
      }),
    );

    const jobsPath = path.join(__dirname, '..', 'config', 'cron-jobs.json');
    const jobs: CronJob[] = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));

    for (const job of jobs) {
      if (job.enabled === false) continue;

      new Rule(this, `CronRule-${job.name}`, {
        ruleName: `sansho-cron-${job.name}`,
        schedule: Schedule.expression(job.schedule),
        targets: [
          new LambdaFunction(fn, {
            event: RuleTargetInput.fromObject({
              jobId: job.name,
              prompt: job.prompt,
              deliverTo: job.deliverTo,
            }),
          }),
        ],
      });
    }
  }
}
