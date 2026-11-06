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
 * Azure: a resource group holding one Container App, which runs as a
 * system-assigned managed identity of its own that may only read (a custom
 * role of the enabled operations' reads). Its changes are made as a second
 * identity, the write identity: a user-assigned managed identity in the
 * same resource group, which holds the custom role built from the enabled
 * operations and is attached to the agent's Container App and to nothing
 * else. For each change the agent asks the Container App's identity
 * endpoint for a token of it, by its resource ID. A managed identity's
 * token cannot be narrowed to one change or made to last less than Azure
 * makes it (about a day), so the standing write access sits with an
 * identity the agent signs in as only for a change, never with the one it
 * reads with.
 */
export const AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP: string = CLOUD_AI_AGENT_NAME;
export const AZURE_CLOUD_AI_AGENT_APP_NAME: string = CLOUD_AI_AGENT_NAME;
export const AZURE_CLOUD_AI_AGENT_ENVIRONMENT_NAME: string = `${CLOUD_AI_AGENT_NAME}-env`;
// The write identity's role: the enabled operations' permissions.
export const AZURE_CLOUD_AI_AGENT_ROLE_NAME: string = "OneUptime AI Agent";
// The agent's own identity's role: the reads of those operations alone.
export const AZURE_CLOUD_AI_AGENT_READER_ROLE_NAME: string =
  "OneUptime AI Agent Reader";
export const AZURE_CLOUD_AI_AGENT_WRITE_IDENTITY_NAME: string = `${CLOUD_AI_AGENT_NAME}-write`;

/*
 * The write identity's resource ID in a subscription: what the Container
 * App is given it by, and what the agent asks for its token with.
 */
export function getAzureCloudAiAgentWriteIdentityId(
  subscriptionId: string,
): string {
  return `/subscriptions/${subscriptionId.trim().toLowerCase()}/resourceGroups/${AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${AZURE_CLOUD_AI_AGENT_WRITE_IDENTITY_NAME}`;
}

/*
 * Google Cloud: the agent runs as a service account of its own, which may
 * only read (a custom role of the enabled operations' reads), on one of two
 * hosts:
 *
 *   - compute-engine (the default): one small Compute Engine VM of
 *     Container-Optimized OS in a network of its own that lets nothing in;
 *   - cloud-run: one Cloud Run service with CPU always allocated.
 *
 * Its changes are made as a second service account, the write account,
 * which holds the custom role built from the enabled operations: for each
 * change the agent asks for a token of it that lasts 15 minutes (IAM
 * Credentials' generateAccessToken), which only the agent's own account may
 * do, on that one account.
 */
export type GcpCloudAiAgentHost = "compute-engine" | "cloud-run";
export const GCP_CLOUD_AI_AGENT_HOSTS: ReadonlyArray<GcpCloudAiAgentHost> = [
  "compute-engine",
  "cloud-run",
];
export const GCP_CLOUD_AI_AGENT_DEFAULT_HOST: GcpCloudAiAgentHost =
  "compute-engine";
export const GCP_CLOUD_AI_AGENT_SERVICE_NAME: string = CLOUD_AI_AGENT_NAME;
export const GCP_CLOUD_AI_AGENT_INSTANCE_NAME: string = CLOUD_AI_AGENT_NAME;
// The VM's network and its one subnet.
export const GCP_CLOUD_AI_AGENT_NETWORK_NAME: string = CLOUD_AI_AGENT_NAME;
export const GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID: string =
  CLOUD_AI_AGENT_NAME;
export const GCP_CLOUD_AI_AGENT_WRITE_SERVICE_ACCOUNT_ID: string = `${CLOUD_AI_AGENT_NAME}-write`;
// The write account's role: the enabled operations' permissions.
export const GCP_CLOUD_AI_AGENT_ROLE_ID: string = "oneuptimeAiAgent";
// The agent's own account's role: the reads of those operations alone.
export const GCP_CLOUD_AI_AGENT_READER_ROLE_ID: string =
  "oneuptimeAiAgentReader";

// A service account's email in a project.
export function getGcpServiceAccountEmail(data: {
  serviceAccountId: string;
  projectId: string;
}): string {
  return `${data.serviceAccountId}@${data.projectId.trim()}.iam.gserviceaccount.com`;
}

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
        `//compute.googleapis.com/projects/${account}/zones/*/instances/${GCP_CLOUD_AI_AGENT_INSTANCE_NAME}`,
        `//iam.googleapis.com/projects/${account}/serviceAccounts/${GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID}@*`,
        `//iam.googleapis.com/projects/${account}/serviceAccounts/${GCP_CLOUD_AI_AGENT_WRITE_SERVICE_ACCOUNT_ID}@*`,
      ];
    default:
      return [];
  }
}
