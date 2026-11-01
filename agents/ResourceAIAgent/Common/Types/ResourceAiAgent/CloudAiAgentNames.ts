/*
 * What the Cloud AI agent's setup command creates in a customer's cloud,
 * by name, and what the agent therefore never changes: its own stack,
 * service, roles and identity.
 *
 * The setup commands (Types/CloudConnection/CloudAiAgentSetupCommands)
 * create exactly these, the agent protects them on top of what an operator
 * lists in ONEUPTIME_AI_PROTECTED_TARGETS, and the docs name them.
 *
 * Imports nothing on purpose: the resource AI agent carries a
 * byte-identical copy of this directory.
 */

// The clouds, spelled as CloudProvider spells them (Types/Cloud/CloudPlatform).
export type CloudAiAgentProvider = "aws" | "azure" | "gcp";

// The one name every piece takes where a name fits.
export const CLOUD_AI_AGENT_NAME: string = "oneuptime-ai-agent";

/*
 * AWS: a CloudFormation stack running one ECS Fargate service in a cluster
 * of its own, with a task role that may only assume the write role, which
 * holds the enabled operations' permissions.
 */
export const AWS_CLOUD_AI_AGENT_STACK_NAME: string = CLOUD_AI_AGENT_NAME;
export const AWS_CLOUD_AI_AGENT_CLUSTER_NAME: string = CLOUD_AI_AGENT_NAME;
export const AWS_CLOUD_AI_AGENT_SERVICE_NAME: string = CLOUD_AI_AGENT_NAME;
export const AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME: string = "OneUptimeAiAgentTask";
export const AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME: string =
  "OneUptimeAiAgentWrite";
export const AWS_CLOUD_AI_AGENT_LOG_GROUP_NAME: string = `/oneuptime/${CLOUD_AI_AGENT_NAME}`;

/*
 * Azure: a resource group holding one Container App with a system-assigned
 * managed identity, given a custom role built from the enabled operations.
 */
export const AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP: string = CLOUD_AI_AGENT_NAME;
export const AZURE_CLOUD_AI_AGENT_APP_NAME: string = CLOUD_AI_AGENT_NAME;
export const AZURE_CLOUD_AI_AGENT_ENVIRONMENT_NAME: string = `${CLOUD_AI_AGENT_NAME}-env`;
export const AZURE_CLOUD_AI_AGENT_ROLE_NAME: string = "OneUptime AI Agent";

/*
 * Google Cloud: one Cloud Run service with CPU always allocated, running as
 * a service account of its own with a custom role built from the enabled
 * operations.
 */
export const GCP_CLOUD_AI_AGENT_SERVICE_NAME: string = CLOUD_AI_AGENT_NAME;
export const GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID: string =
  CLOUD_AI_AGENT_NAME;
export const GCP_CLOUD_AI_AGENT_ROLE_ID: string = "oneuptimeAiAgent";

/*
 * The targets an agent in this account never changes, as protected-target
 * globs (ResourceCommandPolicy.getWriteScopeRefusal matches them against a
 * change's target, case-insensitively): everything its setup command
 * created. The account id narrows them where the cloud's ids carry it.
 */
export function getCloudAiAgentOwnTargets(data: {
  provider: CloudAiAgentProvider;
  accountId: string;
}): Array<string> {
  const account: string = data.accountId.trim() || "*";

  switch (data.provider) {
    case "aws":
      return [
        `arn:aws*:ecs:*:${account}:service/${AWS_CLOUD_AI_AGENT_CLUSTER_NAME}/*`,
        `arn:aws*:ecs:*:${account}:cluster/${AWS_CLOUD_AI_AGENT_CLUSTER_NAME}`,
        `arn:aws*:iam::${account}:role/${AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME}`,
        `arn:aws*:iam::${account}:role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}`,
        `arn:aws*:cloudformation:*:${account}:stack/${AWS_CLOUD_AI_AGENT_STACK_NAME}/*`,
      ];
    case "azure":
      return [
        `/subscriptions/${account.toLowerCase()}/resourcegroups/${AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP}/*`,
      ];
    case "gcp":
      return [
        `//run.googleapis.com/projects/${account}/locations/*/services/${GCP_CLOUD_AI_AGENT_SERVICE_NAME}`,
        `//iam.googleapis.com/projects/${account}/serviceAccounts/${GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID}@*`,
      ];
    default:
      return [];
  }
}
