import { CloudProvider } from "../Cloud/CloudPlatform";
import BadDataException from "../Exception/BadDataException";
import {
  AGENT_AI_FIXES_SETTING_VALUES,
  AI_FIXES_ENV,
  AI_INVESTIGATION_ENV,
} from "../AI/AgentAiSettings";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../ResourceAiAgent/AiResourceType";
import {
  AWS_CLOUD_AI_AGENT_CLUSTER_NAME,
  AWS_CLOUD_AI_AGENT_LOG_GROUP_NAME,
  AWS_CLOUD_AI_AGENT_SERVICE_NAME,
  AWS_CLOUD_AI_AGENT_STACK_NAME,
  AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME,
  AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
  AZURE_CLOUD_AI_AGENT_APP_NAME,
  AZURE_CLOUD_AI_AGENT_ENVIRONMENT_NAME,
  AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP,
  AZURE_CLOUD_AI_AGENT_ROLE_NAME,
  CLOUD_AI_AGENT_NAME,
  GCP_CLOUD_AI_AGENT_DEFAULT_HOST,
  GCP_CLOUD_AI_AGENT_HOSTS,
  GCP_CLOUD_AI_AGENT_INSTANCE_NAME,
  GCP_CLOUD_AI_AGENT_NETWORK_NAME,
  GCP_CLOUD_AI_AGENT_ROLE_ID,
  GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID,
  GCP_CLOUD_AI_AGENT_SERVICE_NAME,
  GcpCloudAiAgentHost,
  getCloudAiAgentOwnTargets,
} from "../ResourceAiAgent/CloudAiAgentNames";
import {
  MAX_POSTURE_LIST_ENTRIES,
  MAX_POSTURE_STRING_LENGTH,
  RESOURCE_AI_AGENT_API_KEY_ENVS,
  RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT,
  RESOURCE_AI_AGENT_IMAGE_REPOSITORY,
  RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
  RESOURCE_AI_CLOUD_ACCOUNT_ID_ENV,
  RESOURCE_AI_CLOUD_OPERATIONS_ENV,
  RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV,
  RESOURCE_AI_GCP_HOST_ENV,
  RESOURCE_AI_PROTECTED_TARGETS_ENV,
  ResourceCommandTier,
} from "../ResourceAiAgent/ResourceAiAccess";
import { shellQuote } from "../Runbook/ShellWord";
import {
  CLOUD_CHANGE_OPERATION_NAMES,
  CLOUD_OPERATIONS,
  CloudCatalogProvider,
  CloudOperationKindSpec,
  CloudOperationSpec,
  getCloudOperation,
} from "../../Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * THE ONE COMMAND THAT LETS ONEUPTIME AI FIX PROBLEMS IN A CLOUD ACCOUNT.
 *
 * The Cloud AI agent is the resource AI agent's image
 * (RESOURCE_AI_AGENT_IMAGE_REPOSITORY) run inside the customer's own cloud
 * with ONEUPTIME_AI_AGENT_RESOURCE_TYPE set to the cloud. It holds the only
 * credentials that can change anything, and runs one operation of the
 * closed cloud catalog (CloudOperationCatalog) at a time. Each cloud gets
 * one command for its own browser shell, written for one OneUptime cloud
 * account, that writes the agent's role from the operations turned on for
 * it and starts the agent:
 *
 *   - AWS (CloudShell): a CloudFormation stack running one ECS Fargate
 *     service. The task role may only assume the write role; the write role
 *     holds the operations' permissions - changes only on resources that
 *     carry the required tag, when one is set - and the agent assumes it
 *     once per job with a session policy for that job's one action on its
 *     one resource. The ingestion key is kept in Secrets Manager, read by
 *     ECS when the task starts.
 *   - Azure (Cloud Shell): a custom role from the operations, a Container
 *     App with a system-assigned identity holding that role on the
 *     subscription, and the ingestion key as a Container Apps secret.
 *   - Google Cloud (Cloud Shell): a custom role from the operations, a
 *     service account holding it on the project, the ingestion key in
 *     Secret Manager (only that service account may read it), and the
 *     agent running as that service account on one small Compute Engine
 *     VM of Container-Optimized OS, in a network of its own that lets
 *     nothing in, whose startup script reads the key from Secret Manager
 *     at every boot - or, for a project that allows no VM an external
 *     address, on a Cloud Run service with CPU always allocated (four
 *     times the cost: Cloud Run keeps CPU allocated only for a whole vCPU).
 *
 * On every cloud the key is a secret of the platform's, never a plain
 * variable: a task definition's or a Cloud Run service's variables are
 * shown to anyone who may describe them (AWS ReadOnlyAccess, Google
 * Cloud's Viewer), and the key registers agents and sends telemetry for
 * the whole OneUptime project.
 *
 * Azure and Google Cloud have no general tag condition, so there the agent
 * checks the required tag (or label) itself, as it does everywhere.
 *
 * A command works in the one account it was written for: the AWS command
 * makes nothing in a shell signed in to another account, and the Azure and
 * Google Cloud commands name the subscription or project on every call, so
 * the shell's default one does not matter.
 *
 * Every command can be run again, and running it again is how anything is
 * changed: the operations, the protected resources, the required tag and
 * how far AI may go are the agent's own settings, so turning an operation
 * off and running the command again takes its permission out of the role.
 * Nothing is pasted back: the agent registers with the ingestion key and
 * connects on its own. The last line printed says so.
 *
 * Every value the command takes from the options is checked first
 * (describeCloudAiAgentSetupProblem) and the command is never written from
 * one that fails: the functions here throw a BadDataException with the
 * problem instead. Values that reach the shell are quoted for it
 * (Runbook/ShellWord), values inside a template or an environment file are
 * written as JSON in a heredoc the shell does not expand.
 *
 * getCloudAiAgentEnvironment is the same agent's environment for a team
 * that deploys it its own way ("Run the agent somewhere else").
 */

// How far OneUptime AI may go, as the setup dialog asks it.
export type CloudAiAgentFixesMode =
  | "RequireApproval"
  | "Automatic"
  | "BypassApproval";

/*
 * "Ask me first" (the default), "Fix safe problems on its own", and under
 * Advanced, "Let riskier changes run without approval".
 */
export const CLOUD_AI_AGENT_FIXES_MODES: ReadonlyArray<CloudAiAgentFixesMode> =
  ["RequireApproval", "Automatic", "BypassApproval"];
export const CLOUD_AI_AGENT_DEFAULT_FIXES_MODE: CloudAiAgentFixesMode =
  "RequireApproval";

export interface CloudAiAgentSetupOptions {
  provider: CloudProvider;
  // This OneUptime's address, as the agent reaches it.
  oneuptimeUrl: string;
  // A telemetry ingestion key of the project: what the agent registers with.
  ingestionKey: string;
  // OneUptime's id of the cloud account (CloudAccount), pinned on the agent.
  cloudAccountId: string;
  // The cloud's own id: AWS account id, Azure subscription id, Google Cloud project id.
  accountId: string;
  fixesMode: CloudAiAgentFixesMode;
  // Catalog changes AI may make (restart-service, ...); every change of the cloud when absent.
  enabledOperations?: Array<string> | undefined;
  // Resources AI must never change, as patterns of their ids ("*" matches any run).
  protectedTargets?: Array<string> | undefined;
  // "key=value": change only resources that carry this tag, such as oneuptime-ai=allow.
  requiredTag?: string | null | undefined;
  // Where the agent itself runs (CLOUD_AI_AGENT_DEFAULT_REGIONS when absent).
  region?: string | undefined;
  // Google Cloud only: what runs it (GCP_CLOUD_AI_AGENT_DEFAULT_HOST when absent).
  gcpHost?: GcpCloudAiAgentHost | undefined;
  // The image's tag (CLOUD_AI_AGENT_IMAGE_TAG when absent).
  imageTag?: string | undefined;
}

// One variable of the agent's environment.
export interface CloudAiAgentEnvironmentVariable {
  name: string;
  value: string;
  // The ingestion key: a secret where the platform keeps them, never shown in full.
  isSecret: boolean;
}

// The released image, tagged as every other OneUptime agent's.
export const CLOUD_AI_AGENT_IMAGE_TAG: string = "release";

/*
 * Where the agent runs when no region is given: AWS in the Region the
 * shell is in (CloudShell's own), Azure and Google Cloud in a large region
 * each. The agent acts on resources in every region either way.
 */
export const CLOUD_AI_AGENT_DEFAULT_REGIONS: Readonly<
  Record<CloudProvider, string | null>
> = {
  [CloudProvider.AWS]: null,
  [CloudProvider.Azure]: "eastus",
  [CloudProvider.GCP]: "us-central1",
};

// What the agent runs on: one small always-on container.
export interface CloudAiAgentSize {
  vcpu: number;
  memoryGiB: number;
}

/*
 * Fargate's and Container Apps' smallest size, and Google Cloud's on Cloud
 * Run: Cloud Run keeps CPU allocated only for a whole vCPU or more, and
 * 512 MiB is the least it gives one. On Google Cloud's default host the
 * agent has a VM of its own instead (GCP_CLOUD_AI_AGENT_MACHINE_TYPE).
 */
export const CLOUD_AI_AGENT_SIZES: Readonly<
  Record<CloudProvider, CloudAiAgentSize>
> = {
  [CloudProvider.AWS]: { vcpu: 0.25, memoryGiB: 0.5 },
  [CloudProvider.Azure]: { vcpu: 0.25, memoryGiB: 0.5 },
  [CloudProvider.GCP]: { vcpu: 1, memoryGiB: 0.5 },
};

// The last line every command prints.
export const CLOUD_AI_AGENT_STARTED_MESSAGE: string =
  "The Cloud AI agent is starting. It connects to OneUptime on its own, so there is nothing to paste back.";

/*
 * Variables the agent's Config reads (agents/ResourceAIAgent/Config.ts:
 * ONEUPTIME_URL_ENV and HEALTH_HOST_ENV; the health port is PORT, which
 * Cloud Run sets from --port). The key goes in the one of
 * RESOURCE_AI_AGENT_API_KEY_ENVS that names an ingestion key.
 */
export const CLOUD_AI_AGENT_ONEUPTIME_URL_ENV: string = "ONEUPTIME_URL";
export const CLOUD_AI_AGENT_INGESTION_KEY_ENV: string =
  RESOURCE_AI_AGENT_API_KEY_ENVS.find((name: string): boolean => {
    return name === "ONEUPTIME_TELEMETRY_INGESTION_KEY";
  }) || "ONEUPTIME_TELEMETRY_INGESTION_KEY";
export const CLOUD_AI_AGENT_HEALTH_HOST_ENV: string =
  "ONEUPTIME_AI_AGENT_HEALTH_HOST";

// What the commands write in the shell's directory, and the secrets' names.
export const AWS_CLOUD_AI_AGENT_TEMPLATE_FILE: string = `${CLOUD_AI_AGENT_NAME}.json`;
export const GCP_CLOUD_AI_AGENT_ENV_FILE: string = `${CLOUD_AI_AGENT_NAME}.env.yaml`;
export const GCP_CLOUD_AI_AGENT_KEY_FILE: string = `${CLOUD_AI_AGENT_NAME}.key`;
export const AZURE_CLOUD_AI_AGENT_SECRET_NAME: string = "ingestion-key";
export const GCP_CLOUD_AI_AGENT_SECRET_NAME: string = `${CLOUD_AI_AGENT_NAME}-key`;

/*
 * The line that ends the key file's here-document in the Google Cloud
 * command: it holds a space, which no key may (KEY_CHARACTERS), so no key
 * can end the document early.
 */
export const GCP_CLOUD_AI_AGENT_KEY_FILE_END: string = "KEY ENDS";

// What lets the Google Cloud agent's service account read its one secret.
export const GCP_SECRET_ACCESSOR_ROLE: string =
  "roles/secretmanager.secretAccessor";

/*
 * Cloud Run checks, as it deploys, that the service account may read the
 * key's secret, and access granted a moment before can take a minute or
 * two to reach it. So the Google Cloud command tries a deploy that did not
 * work again, three tries in all, 30 seconds apart, and says why between
 * them. The line is echoed in double quotes: it holds none, and no $, `
 * or backslash.
 */
export const GCP_CLOUD_AI_AGENT_DEPLOY_ATTEMPTS: number = 3;
export const GCP_CLOUD_AI_AGENT_DEPLOY_RETRY_SECONDS: number = 30;
export const GCP_CLOUD_AI_AGENT_DEPLOY_RETRY_MESSAGE: string = `Cloud Run did not start the agent. Access to the key granted a moment ago can take a minute or two to reach it, so the deploy runs again in ${GCP_CLOUD_AI_AGENT_DEPLOY_RETRY_SECONDS} seconds.`;

// How long the agent's AWS logs are kept: long enough to read what went wrong.
export const AWS_CLOUD_AI_AGENT_LOG_RETENTION_DAYS: number = 7;

/*
 * The Google Cloud agent's VM: the smallest machine (two shared vCPUs and
 * 1 GB, which the free tier covers once a month in us-central1, us-west1
 * and us-east1), the smallest boot disk Container-Optimized OS takes, on
 * standard persistent disk, and Google's own image family of it, which
 * updates itself. Shielded (secure boot, vTPM, integrity monitoring), with
 * OS Login and no project-wide SSH keys - not that its network lets an SSH
 * connection in.
 */
export const GCP_CLOUD_AI_AGENT_MACHINE_TYPE: string = "e2-micro";
export const GCP_CLOUD_AI_AGENT_BOOT_DISK_GB: number = 10;
export const GCP_CLOUD_AI_AGENT_BOOT_DISK_TYPE: string = "pd-standard";
export const GCP_CLOUD_AI_AGENT_IMAGE_FAMILY: string = "cos-stable";
export const GCP_CLOUD_AI_AGENT_IMAGE_PROJECT: string = "cos-cloud";
// The VM's subnet: a network of its own, so any range does; 16 addresses.
export const GCP_CLOUD_AI_AGENT_SUBNET_RANGE: string = "10.250.0.0/28";
// What the VM's own startup script is written to in the shell's directory.
export const GCP_CLOUD_AI_AGENT_STARTUP_FILE: string = `${CLOUD_AI_AGENT_NAME}.startup.sh`;
// Its own logs: Docker's Cloud Logging driver, which the VM's role may write with.
export const GCP_CLOUD_AI_AGENT_LOG_WRITER_ROLE: string =
  "roles/logging.logWriter";
// Where the VM keeps what its startup script writes: memory, never its disk.
export const GCP_CLOUD_AI_AGENT_RUN_DIRECTORY: string = `/run/${CLOUD_AI_AGENT_NAME}`;
/*
 * What the Google Cloud command says when the VM could not be made, and
 * what to do: an organization policy refusing a VM an external address is
 * the one a command cannot know beforehand. Echoed in double quotes: it
 * holds none, and no $, ` or backslash.
 */
export const GCP_CLOUD_AI_AGENT_VM_REFUSED_MESSAGE: string =
  "The agent's VM could not be created. If an organization policy allows no VM an external IP address, choose Cloud Run under More fields and run the command again.";

/*
 * How the VM's startup script reads the key: a small Node.js program run
 * in the agent's own image (the VM has no gcloud), which asks the metadata
 * server for the service account's token and Secret Manager for the
 * secret's latest version, and prints it. The key passes through memory
 * only: it is never on the VM's disk, in its metadata or on a command line.
 * Written without a $ or a backtick, and without a ! - an interactive
 * shell expands one even inside a here-document, and the command is pasted
 * into one.
 */
export const GCP_CLOUD_AI_AGENT_KEY_READER: string = [
  'const secret = process.argv[2] || "";',
  "const metadata =",
  '  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";',
  "async function readKey() {",
  "  const token = await (",
  '    await fetch(metadata, { headers: { "Metadata-Flavor": "Google" } })',
  "  ).json();",
  "  const answer = await fetch(",
  '    "https://secretmanager.googleapis.com/v1/" + secret + ":access",',
  '    { headers: { Authorization: "Bearer " + token.access_token } },',
  "  );",
  "  if (answer.ok === false) {",
  '    throw new Error("Secret Manager answered HTTP " + answer.status + " for " + secret);',
  "  }",
  "  const version = await answer.json();",
  '  const key = Buffer.from(version.payload.data, "base64").toString("utf8").trim();',
  "  if (key.length === 0) {",
  '    throw new Error(secret + " holds no key");',
  "  }",
  "  process.stdout.write(key);",
  "}",
  "readKey().catch((error) => {",
  '  console.error("Could not read the agent key: " + String(error && error.message ? error.message : error));',
  "  process.exit(1);",
  "});",
].join("\n");

// The role's title on Azure and Google Cloud.
const ROLE_TITLE: string = "OneUptime AI Agent";
const ROLE_DESCRIPTION: string =
  "What the OneUptime Cloud AI agent may change: the operations turned on for it";

// The read every agent runs for Test connection.
const WHOAMI: string = "whoami";

// The cloud each CloudProvider is in the catalog, and the agent's resource type.
const CATALOG_PROVIDERS: Readonly<Record<CloudProvider, CloudCatalogProvider>> =
  {
    [CloudProvider.AWS]: "aws",
    [CloudProvider.Azure]: "azure",
    [CloudProvider.GCP]: "gcp",
  };

const RESOURCE_TYPES: Readonly<Record<CloudProvider, AiResourceType>> = {
  [CloudProvider.AWS]: AiResourceType.AwsAccount,
  [CloudProvider.Azure]: AiResourceType.AzureSubscription,
  [CloudProvider.GCP]: AiResourceType.GoogleCloudProject,
};

const PROVIDER_NAMES: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: "AWS",
  [CloudProvider.Azure]: "Azure",
  [CloudProvider.GCP]: "Google Cloud",
};

// The cloud's id of an account, as OneUptime's registration reads it.
const ACCOUNT_ID_PATTERNS: Readonly<Record<CloudProvider, RegExp>> = {
  [CloudProvider.AWS]: /^[0-9]{12}$/,
  [CloudProvider.Azure]:
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  [CloudProvider.GCP]: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
};

const ACCOUNT_ID_NAMES: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: "AWS account id (12 digits)",
  [CloudProvider.Azure]: "Azure subscription id",
  [CloudProvider.GCP]: "Google Cloud project id",
};

// Where each cloud may run the agent: us-east-1, eastus, us-central1.
const REGION_PATTERNS: Readonly<Record<CloudProvider, RegExp>> = {
  [CloudProvider.AWS]: /^[a-z]{2}(?:-gov|-iso|-isob)?-[a-z]{2,12}-[0-9]{1,2}$/,
  [CloudProvider.Azure]: /^[a-z][a-z0-9]{1,39}$/,
  [CloudProvider.GCP]: /^[a-z]+-[a-z]+[0-9]{1,2}$/,
};

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A Docker image tag.
const IMAGE_TAG_PATTERN: RegExp = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/*
 * A tag's key and value, the same on every cloud: letters, digits and
 * _ . : + @ - (a value also /), none of which a shell, a policy or a
 * template reads specially. Google Cloud labels are stricter: lowercase
 * letters, digits, _ and -, a key starting with a letter.
 */
const TAG_KEY_PATTERN: RegExp = /^[A-Za-z0-9][A-Za-z0-9_.:+@-]{0,127}$/;
const TAG_VALUE_PATTERN: RegExp = /^[A-Za-z0-9_.:/+@-]{1,256}$/;
const GCP_LABEL_KEY_PATTERN: RegExp = /^[a-z][a-z0-9_-]{0,62}$/;
const GCP_LABEL_VALUE_PATTERN: RegExp = /^[a-z0-9_-]{1,63}$/;

// The longest ingestion key taken.
const MAX_INGESTION_KEY_LENGTH: number = 256;

function isLetterOrDigit(char: string): boolean {
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9")
  );
}

// Only these characters, besides letters and digits.
function holdsOnly(value: string, others: string): boolean {
  for (const char of value) {
    if (!isLetterOrDigit(char) && others.indexOf(char) === -1) {
      return false;
    }
  }

  return true;
}

/*
 * What a URL may hold (RFC 3986): never a space, a quote, a backtick or a
 * line break - nor "!", which the interactive shell a command is pasted
 * into reads as history expansion even inside a heredoc. No value the
 * commands write holds one.
 */
const URL_CHARACTERS: string = "-._~:/?#[]@$&'()*+,;=%";
// What an ingestion key may hold.
const KEY_CHARACTERS: string = "-._~+/=:";
/*
 * What a protected-target pattern may hold: what an ARN, an Azure resource
 * ID or a Google Cloud resource name holds, and "*". Never a comma (the
 * variable's separator), a space or a quote.
 */
const PATTERN_CHARACTERS: string = "_.:/@+=$#*()~-";

// The URL without the slashes it may end with.
function trimUrl(url: string): string {
  let end: number = url.length;

  while (end > 0 && url.charAt(end - 1) === "/") {
    end--;
  }

  return url.substring(0, end);
}

function describeUrlProblem(value: string): string | null {
  const shown: string = JSON.stringify(value.slice(0, 64));

  if (!value || !holdsOnly(value, URL_CHARACTERS)) {
    return `The OneUptime URL ${shown} is not one the agent can be given: use an address such as https://oneuptime.com, without spaces or quotes.`;
  }

  let parsed: URL | null = null;

  try {
    parsed = new URL(value);
  } catch {
    parsed = null;
  }

  if (
    !parsed ||
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    !parsed.hostname
  ) {
    return `The OneUptime URL ${shown} is not an http(s) address: use one such as https://oneuptime.com.`;
  }

  return null;
}

/*
 * The required tag as key and value, or a problem. A tag is "key=value";
 * the key may not be one AWS reserves.
 */
function readRequiredTag(
  provider: CloudProvider,
  tag: string,
): { key: string; value: string } | string {
  const equals: number = tag.indexOf("=");
  const key: string = equals > 0 ? tag.substring(0, equals) : "";
  const value: string = equals > 0 ? tag.substring(equals + 1) : "";
  const example: string =
    "write it as key=value, such as oneuptime-ai=allow, in letters, digits and _ . : + @ -";

  if (!TAG_KEY_PATTERN.test(key) || !TAG_VALUE_PATTERN.test(value)) {
    return `The required tag ${JSON.stringify(tag.slice(0, 64))} is not one the agent can check: ${example}.`;
  }

  if (provider === CloudProvider.AWS && key.toLowerCase().startsWith("aws:")) {
    return `The required tag's key ${JSON.stringify(key)} starts with aws:, which AWS keeps for its own tags: pick another key.`;
  }

  if (
    provider === CloudProvider.GCP &&
    (!GCP_LABEL_KEY_PATTERN.test(key) || !GCP_LABEL_VALUE_PATTERN.test(value))
  ) {
    return `Google Cloud labels are lowercase letters, digits, _ and -, with a key that starts with a letter, so no resource can carry ${JSON.stringify(tag.slice(0, 64))}: use one such as oneuptime-ai=allow.`;
  }

  return { key, value };
}

/*
 * The catalog changes each cloud has, in catalog order: what "every
 * change" means for it.
 */
export function getCloudAiAgentChangeOperations(
  provider: CloudProvider,
): Array<string> {
  const cloud: CloudCatalogProvider | undefined = CATALOG_PROVIDERS[provider];

  return CLOUD_OPERATIONS.filter((operation: CloudOperationSpec): boolean => {
    return (
      CLOUD_CHANGE_OPERATION_NAMES.includes(operation.name) &&
      operation.kinds.some((kind: CloudOperationKindSpec): boolean => {
        return (
          kind.provider === cloud && kind.tier !== ResourceCommandTier.Read
        );
      })
    );
  }).map((operation: CloudOperationSpec): string => {
    return operation.name;
  });
}

/*
 * The changes turned on, in catalog order and each once, or why the list
 * cannot be: empty, or naming something that is not a change of this cloud.
 */
function readOperations(
  provider: CloudProvider,
  enabledOperations: Array<string> | undefined,
): Array<string> | string {
  const available: Array<string> = getCloudAiAgentChangeOperations(provider);

  if (enabledOperations === undefined) {
    return available;
  }

  if (!Array.isArray(enabledOperations) || enabledOperations.length === 0) {
    return "Turn on at least one change AI may make, or leave AI fixes off.";
  }

  for (const name of enabledOperations) {
    if (typeof name !== "string" || !available.includes(name)) {
      return `${JSON.stringify(String(name).slice(0, 64))} is not a change the Cloud AI agent can make on ${PROVIDER_NAMES[provider]}. The changes are: ${available.join(", ")}.`;
    }
  }

  return available.filter((name: string): boolean => {
    return enabledOperations.includes(name);
  });
}

/*
 * Whether the agent can read a protected-resource pattern: a resource's id,
 * with * for any run of characters, short enough for its posture report.
 */
export function isReadableCloudAiAgentProtectedTarget(target: string): boolean {
  return (
    target.length > 0 &&
    target.length <= MAX_POSTURE_STRING_LENGTH &&
    holdsOnly(target, PATTERN_CHARACTERS)
  );
}

/*
 * How many protected resources the agent takes besides its own (its stack,
 * service and roles), which it reports with them.
 */
export function getCloudAiAgentMaxProtectedTargets(
  provider: CloudProvider,
  accountId: string,
): number {
  return (
    MAX_POSTURE_LIST_ENTRIES -
    getCloudAiAgentOwnTargets({
      provider: CATALOG_PROVIDERS[provider],
      accountId,
    }).length
  );
}

function readProtectedTargets(
  provider: CloudProvider,
  accountId: string,
  protectedTargets: Array<string> | undefined,
): Array<string> | string {
  const targets: Array<string> = [];

  /*
   * The agent reports these with its own (its stack, service and roles),
   * and OneUptime reads a longer list as malformed: the agent would then
   * refuse every change.
   */
  const most: number = getCloudAiAgentMaxProtectedTargets(provider, accountId);

  for (const entry of protectedTargets || []) {
    const target: string = typeof entry === "string" ? entry.trim() : "";

    if (!target) {
      continue;
    }

    if (!isReadableCloudAiAgentProtectedTarget(target)) {
      return `The protected resource ${JSON.stringify(target.slice(0, 64))} is not a pattern the agent can read: write a resource's id, with * for any run of characters, in at most ${MAX_POSTURE_STRING_LENGTH} characters and without spaces, commas or quotes.`;
    }

    if (!targets.includes(target)) {
      targets.push(target);
    }
  }

  if (targets.length > most) {
    return `${targets.length} protected resources are more than the agent takes: list at most ${most}, with * patterns to cover several.`;
  }

  return targets;
}

// The setup, checked and in the form the commands write it.
interface CloudAiAgentSetup {
  provider: CloudProvider;
  oneuptimeUrl: string;
  ingestionKey: string;
  cloudAccountId: string;
  accountId: string;
  fixesMode: CloudAiAgentFixesMode;
  operations: Array<string>;
  everyOperation: boolean;
  protectedTargets: Array<string>;
  requiredTag: { key: string; value: string } | null;
  region: string | null;
  image: string;
  gcpHost: GcpCloudAiAgentHost;
}

function readSetup(
  options: CloudAiAgentSetupOptions,
): CloudAiAgentSetup | string {
  if (!options || typeof options !== "object") {
    return "Say which cloud account the agent is for.";
  }

  const provider: CloudProvider = options.provider;

  if (!Object.values(CloudProvider).includes(provider)) {
    return "Pick AWS, Azure or Google Cloud.";
  }

  const url: string = trimUrl(
    typeof options.oneuptimeUrl === "string" ? options.oneuptimeUrl.trim() : "",
  );
  const urlProblem: string | null = describeUrlProblem(url);

  if (urlProblem) {
    return urlProblem;
  }

  const key: string =
    typeof options.ingestionKey === "string" ? options.ingestionKey.trim() : "";

  if (
    !key ||
    key.length > MAX_INGESTION_KEY_LENGTH ||
    !holdsOnly(key, KEY_CHARACTERS)
  ) {
    return "The ingestion key is not one OneUptime issues: copy it again from Project Settings, under Telemetry Ingestion Keys.";
  }

  const cloudAccountId: string =
    typeof options.cloudAccountId === "string"
      ? options.cloudAccountId.trim().toLowerCase()
      : "";

  if (!UUID_PATTERN.test(cloudAccountId)) {
    return "The cloud account's OneUptime id is not an id: open the account's page under Cloud → Accounts and set the agent up from there.";
  }

  const accountId: string =
    typeof options.accountId === "string"
      ? provider === CloudProvider.Azure
        ? options.accountId.trim().toLowerCase()
        : options.accountId.trim()
      : "";

  if (!ACCOUNT_ID_PATTERNS[provider].test(accountId)) {
    return `${JSON.stringify(accountId.slice(0, 64))} is not an ${ACCOUNT_ID_NAMES[provider]}.`;
  }

  if (!CLOUD_AI_AGENT_FIXES_MODES.includes(options.fixesMode)) {
    return "Pick how far AI may go: Ask me first, or Fix safe problems on its own.";
  }

  const operations: Array<string> | string = readOperations(
    provider,
    options.enabledOperations,
  );

  if (typeof operations === "string") {
    return operations;
  }

  const protectedTargets: Array<string> | string = readProtectedTargets(
    provider,
    accountId,
    options.protectedTargets,
  );

  if (typeof protectedTargets === "string") {
    return protectedTargets;
  }

  let requiredTag: { key: string; value: string } | null = null;
  const tagSetting: string =
    typeof options.requiredTag === "string" ? options.requiredTag.trim() : "";

  if (tagSetting) {
    const tag: { key: string; value: string } | string = readRequiredTag(
      provider,
      tagSetting,
    );

    if (typeof tag === "string") {
      return tag;
    }

    requiredTag = tag;
  }

  const regionSetting: string =
    typeof options.region === "string" ? options.region.trim() : "";

  if (regionSetting && !REGION_PATTERNS[provider].test(regionSetting)) {
    return `${JSON.stringify(regionSetting.slice(0, 64))} is not a ${PROVIDER_NAMES[provider]} region.`;
  }

  const imageTag: string =
    typeof options.imageTag === "string" && options.imageTag.trim()
      ? options.imageTag.trim()
      : CLOUD_AI_AGENT_IMAGE_TAG;

  if (!IMAGE_TAG_PATTERN.test(imageTag)) {
    return `${JSON.stringify(imageTag.slice(0, 64))} is not an image tag.`;
  }

  const gcpHost: unknown =
    options.gcpHost === undefined
      ? GCP_CLOUD_AI_AGENT_DEFAULT_HOST
      : options.gcpHost;

  if (!(GCP_CLOUD_AI_AGENT_HOSTS as ReadonlyArray<unknown>).includes(gcpHost)) {
    return "Pick where the Google Cloud agent runs: a small VM, or Cloud Run.";
  }

  return {
    provider,
    oneuptimeUrl: url,
    ingestionKey: key,
    cloudAccountId,
    accountId,
    fixesMode: options.fixesMode,
    operations,
    everyOperation:
      operations.length === getCloudAiAgentChangeOperations(provider).length,
    protectedTargets,
    requiredTag,
    region: regionSetting || CLOUD_AI_AGENT_DEFAULT_REGIONS[provider],
    image: getCloudAiAgentImage(imageTag),
    gcpHost: gcpHost as GcpCloudAiAgentHost,
  };
}

/*
 * What is wrong with the options, in words the setup dialog can show, or
 * null when a command can be written from them. Every other function here
 * throws a BadDataException with the same words instead of writing one.
 */
export function describeCloudAiAgentSetupProblem(
  options: CloudAiAgentSetupOptions,
): string | null {
  const setup: CloudAiAgentSetup | string = readSetup(options);

  return typeof setup === "string" ? setup : null;
}

/*
 * The checked setup, or a BadDataException with what is wrong. A cloud's
 * own writer takes only that cloud's options.
 */
function checkedSetup(
  options: CloudAiAgentSetupOptions,
  provider?: CloudProvider | undefined,
): CloudAiAgentSetup {
  const setup: CloudAiAgentSetup | string = readSetup(options);

  if (typeof setup === "string") {
    throw new BadDataException(setup);
  }

  if (provider && setup.provider !== provider) {
    throw new BadDataException(
      `These options are for ${PROVIDER_NAMES[setup.provider]}, not ${PROVIDER_NAMES[provider]}.`,
    );
  }

  return setup;
}

// The agent's image, from Docker Hub, which every one of the three clouds pulls from.
export function getCloudAiAgentImage(
  imageTag: string = CLOUD_AI_AGENT_IMAGE_TAG,
): string {
  return `docker.io/${RESOURCE_AI_AGENT_IMAGE_REPOSITORY}:${imageTag}`;
}

// The write role's ARN, in the standard partition (the template asks AWS for it instead).
export function getAwsCloudAiAgentWriteRoleArn(accountId: string): string {
  return `arn:aws:iam::${accountId}:role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}`;
}

function environmentOf(
  setup: CloudAiAgentSetup,
): Array<CloudAiAgentEnvironmentVariable> {
  const variable: (
    name: string,
    value: string,
    isSecret?: boolean,
  ) => CloudAiAgentEnvironmentVariable = (
    name: string,
    value: string,
    isSecret: boolean = false,
  ): CloudAiAgentEnvironmentVariable => {
    return { name, value, isSecret };
  };

  const environment: Array<CloudAiAgentEnvironmentVariable> = [
    variable(
      RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
      AI_RESOURCE_TYPE_INFO[RESOURCE_TYPES[setup.provider]].agentAlias,
    ),
    variable(CLOUD_AI_AGENT_ONEUPTIME_URL_ENV, setup.oneuptimeUrl),
    variable(CLOUD_AI_AGENT_INGESTION_KEY_ENV, setup.ingestionKey, true),
    variable(RESOURCE_AI_CLOUD_ACCOUNT_ID_ENV, setup.cloudAccountId),
    variable(RESOURCE_AI_ALLOW_WRITES_ENV, "true"),
    variable(AI_INVESTIGATION_ENV, "true"),
    variable(AI_FIXES_ENV, AGENT_AI_FIXES_SETTING_VALUES[setup.fixesMode]),
  ];

  // Unset means every change of the catalog, so the list is set only when it is not that.
  if (!setup.everyOperation) {
    environment.push(
      variable(RESOURCE_AI_CLOUD_OPERATIONS_ENV, setup.operations.join(",")),
    );
  }

  if (setup.requiredTag) {
    environment.push(
      variable(
        RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV,
        `${setup.requiredTag.key}=${setup.requiredTag.value}`,
      ),
    );
  }

  if (setup.protectedTargets.length > 0) {
    environment.push(
      variable(
        RESOURCE_AI_PROTECTED_TARGETS_ENV,
        setup.protectedTargets.join(","),
      ),
    );
  }

  if (setup.provider === CloudProvider.AWS) {
    environment.push(
      variable(
        RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
        getAwsCloudAiAgentWriteRoleArn(setup.accountId),
      ),
    );
  }

  // The one subscription the agent acts in, so it never has to guess among several.
  if (setup.provider === CloudProvider.Azure) {
    environment.push(
      variable(
        AI_RESOURCE_TYPE_INFO[AiResourceType.AzureSubscription]
          .identityEnvVars[0] as string,
        setup.accountId,
      ),
    );
  }

  /*
   * Cloud Run starts an instance only once it accepts connections on its
   * port, from outside the container: the health server listens on every
   * interface there, on the PORT Cloud Run sets from --port. On its VM the
   * agent keeps the health server to itself, and says where it runs, as
   * Cloud Run says so itself (K_SERVICE): its posture reports it, so the
   * command written from Change keeps it there.
   */
  if (setup.provider === CloudProvider.GCP) {
    environment.push(
      setup.gcpHost === "cloud-run"
        ? variable(CLOUD_AI_AGENT_HEALTH_HOST_ENV, "0.0.0.0")
        : variable(RESOURCE_AI_GCP_HOST_ENV, setup.gcpHost),
    );
  }

  return environment;
}

/*
 * Every variable the agent needs, for a team that runs it its own way: the
 * same the cloud's command gives it. The ingestion key is the one secret.
 */
export function getCloudAiAgentEnvironment(
  options: CloudAiAgentSetupOptions,
): Array<CloudAiAgentEnvironmentVariable> {
  return environmentOf(checkedSetup(options));
}

/*
 * What the agent's role may do: the catalog's permissions for each kind of
 * resource of each change turned on, and what Test connection's whoami
 * needs, sorted, each once. AWS IAM actions, Azure RBAC actions or Google
 * Cloud IAM permissions. Every change of the cloud when no list is given.
 */
export function getCloudAiAgentRolePermissions(
  provider: CloudProvider,
  enabledOperations?: Array<string> | undefined,
): Array<string> {
  if (!Object.values(CloudProvider).includes(provider)) {
    throw new BadDataException("Pick AWS, Azure or Google Cloud.");
  }

  const operations: Array<string> | string = readOperations(
    provider,
    enabledOperations,
  );

  if (typeof operations === "string") {
    throw new BadDataException(operations);
  }

  const cloud: CloudCatalogProvider = CATALOG_PROVIDERS[provider];
  const permissions: Set<string> = new Set<string>();

  for (const name of [...operations, WHOAMI]) {
    const operation: CloudOperationSpec | null = getCloudOperation(name);

    for (const kind of operation ? operation.kinds : []) {
      if (kind.provider !== cloud) {
        continue;
      }

      for (const permission of kind.permissions) {
        permissions.add(permission);
      }
    }
  }

  /*
   * On Google Cloud a change returns a long-running operation, which the
   * agent follows to say how it ended: reading it is part of the change.
   */
  for (const [service, readOperation] of GCP_OPERATION_READS) {
    if (
      Array.from(permissions).some((permission: string): boolean => {
        return permission.startsWith(`${service}.`);
      })
    ) {
      readOperation.forEach((permission: string): void => {
        permissions.add(permission);
      });
    }
  }

  return Array.from(permissions).sort();
}

// The permissions that read a Google Cloud change's operation, per service.
const GCP_OPERATION_READS: ReadonlyArray<[string, Array<string>]> = [
  ["compute", ["compute.zoneOperations.get", "compute.regionOperations.get"]],
  ["run", ["run.operations.get"]],
];

/*
 * What the agent reads to check a required tag where the resource's own
 * read does not return its tags (a Lambda function's, an SQS queue's).
 */
const AWS_TAG_READ_ACTIONS: Array<string> = [
  "lambda:ListTags",
  "sqs:ListQueueTags",
];

// ---- AWS ------------------------------------------------------------------------

// CloudFormation's own values, for Fn::Sub.
const CFN_PARTITION: string = "${AWS::Partition}";
const CFN_REGION: string = "${AWS::Region}";
const CFN_ACCOUNT_ID: string = "${AWS::AccountId}";

// An AWS action that only reads: what the agent reads before it changes something.
function isAwsReadAction(action: string): boolean {
  const name: string = action.substring(action.indexOf(":") + 1);

  return (
    name.startsWith("Describe") ||
    name.startsWith("List") ||
    name.startsWith("Get")
  );
}

type TemplateValue =
  | string
  | number
  | boolean
  | null
  | Array<TemplateValue>
  | { [key: string]: TemplateValue };

/*
 * The write role's policy: the reads on everything, the changes on
 * everything - or, with a required tag, only on resources that carry it
 * (aws:ResourceTag) - and never anything on the agent's own cluster and
 * service, whatever a session policy would allow.
 */
function getAwsWritePolicy(setup: CloudAiAgentSetup): TemplateValue {
  const permissions: Array<string> = getCloudAiAgentRolePermissions(
    CloudProvider.AWS,
    setup.operations,
  );
  const reads: Array<string> = Array.from(
    new Set<string>([
      ...permissions.filter(isAwsReadAction),
      ...(setup.requiredTag ? AWS_TAG_READ_ACTIONS : []),
    ]),
  ).sort();
  const changes: Array<string> = permissions.filter(
    (action: string): boolean => {
      return !isAwsReadAction(action);
    },
  );
  const statements: Array<TemplateValue> = [];

  if (reads.length > 0) {
    statements.push({
      Sid: "ReadWhatAChangeReplaces",
      Effect: "Allow",
      Action: reads,
      Resource: "*",
    });
  }

  if (changes.length > 0) {
    statements.push({
      Sid: "MakeTheChangesTurnedOn",
      Effect: "Allow",
      Action: changes,
      Resource: "*",
      ...(setup.requiredTag
        ? {
            Condition: {
              StringEquals: {
                [`aws:ResourceTag/${setup.requiredTag.key}`]:
                  setup.requiredTag.value,
              },
            },
          }
        : {}),
    });
  }

  statements.push({
    Sid: "NeverChangeTheAgentItself",
    Effect: "Deny",
    Action: "*",
    Resource: [
      {
        "Fn::Sub": `arn:${CFN_PARTITION}:ecs:*:${CFN_ACCOUNT_ID}:cluster/${AWS_CLOUD_AI_AGENT_CLUSTER_NAME}`,
      },
      {
        "Fn::Sub": `arn:${CFN_PARTITION}:ecs:*:${CFN_ACCOUNT_ID}:service/${AWS_CLOUD_AI_AGENT_CLUSTER_NAME}/*`,
      },
    ],
  });

  return { Version: "2012-10-17", Statement: statements };
}

function getAwsTemplate(setup: CloudAiAgentSetup): TemplateValue {
  /*
   * The key is a parameter, never in the template, and reaches the task
   * from Secrets Manager (Secrets), never as one of its variables: those
   * are shown to anyone who may describe the task definition. The write
   * role's ARN is the role's own.
   */
  const containerEnvironment: Array<TemplateValue> = environmentOf(setup)
    .filter((variable: CloudAiAgentEnvironmentVariable): boolean => {
      return !variable.isSecret;
    })
    .map((variable: CloudAiAgentEnvironmentVariable): TemplateValue => {
      if (variable.name === RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV) {
        return {
          Name: variable.name,
          Value: { "Fn::GetAtt": ["WriteRole", "Arn"] },
        };
      }

      return { Name: variable.name, Value: variable.value };
    });
  const containerSecrets: Array<TemplateValue> = environmentOf(setup)
    .filter((variable: CloudAiAgentEnvironmentVariable): boolean => {
      return variable.isSecret;
    })
    .map((variable: CloudAiAgentEnvironmentVariable): TemplateValue => {
      return { Name: variable.name, ValueFrom: { Ref: "IngestionKeySecret" } };
    });

  const size: CloudAiAgentSize = CLOUD_AI_AGENT_SIZES[CloudProvider.AWS];
  const ecsTasks: TemplateValue = { Service: "ecs-tasks.amazonaws.com" };

  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "OneUptime Cloud AI agent: one ECS Fargate task that makes the changes OneUptime AI asks for in this account, with a role that holds only the operations turned on for it.",
    Parameters: {
      VpcId: {
        Type: "AWS::EC2::VPC::Id",
        Description: "The VPC the agent runs in: the Region's default VPC.",
      },
      SubnetIds: {
        Type: "List<AWS::EC2::Subnet::Id>",
        Description: "The default VPC's default subnets.",
      },
      IngestionKey: {
        Type: "String",
        NoEcho: true,
        MinLength: 1,
        Description: "The telemetry ingestion key the agent registers with.",
      },
    },
    Resources: {
      Cluster: {
        Type: "AWS::ECS::Cluster",
        Properties: {
          ClusterName: AWS_CLOUD_AI_AGENT_CLUSTER_NAME,
          ClusterSettings: [{ Name: "containerInsights", Value: "disabled" }],
        },
      },
      LogGroup: {
        Type: "AWS::Logs::LogGroup",
        Properties: {
          LogGroupName: AWS_CLOUD_AI_AGENT_LOG_GROUP_NAME,
          RetentionInDays: AWS_CLOUD_AI_AGENT_LOG_RETENTION_DAYS,
        },
      },
      // The key the agent registers with, which only ECS reads, as the task starts.
      IngestionKeySecret: {
        Type: "AWS::SecretsManager::Secret",
        Properties: {
          Description:
            "The telemetry ingestion key the OneUptime Cloud AI agent registers with.",
          SecretString: { Ref: "IngestionKey" },
        },
      },
      // What ECS pulls the image, writes the logs and reads the key with.
      ExecutionRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: ecsTasks,
                Action: "sts:AssumeRole",
              },
            ],
          },
          ManagedPolicyArns: [
            {
              "Fn::Sub": `arn:${CFN_PARTITION}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`,
            },
          ],
          Policies: [
            {
              PolicyName: "ReadTheIngestionKey",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Effect: "Allow",
                    Action: "secretsmanager:GetSecretValue",
                    Resource: { Ref: "IngestionKeySecret" },
                  },
                ],
              },
            },
          ],
        },
      },
      // The agent's own credentials: they can only assume the write role.
      TaskRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME,
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: ecsTasks,
                Action: "sts:AssumeRole",
                Condition: {
                  ArnLike: {
                    "aws:SourceArn": {
                      "Fn::Sub": `arn:${CFN_PARTITION}:ecs:${CFN_REGION}:${CFN_ACCOUNT_ID}:*`,
                    },
                  },
                  StringEquals: {
                    "aws:SourceAccount": { Ref: "AWS::AccountId" },
                  },
                },
              },
            ],
          },
          Policies: [
            {
              PolicyName: "AssumeTheWriteRole",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Effect: "Allow",
                    Action: "sts:AssumeRole",
                    // By name: the write role trusts this one, so it is made after it.
                    Resource: {
                      "Fn::Sub": `arn:${CFN_PARTITION}:iam::${CFN_ACCOUNT_ID}:role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}`,
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      // What a change runs as, assumed once per job with that job's session policy.
      WriteRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { AWS: { "Fn::GetAtt": ["TaskRole", "Arn"] } },
                Action: "sts:AssumeRole",
              },
            ],
          },
          Policies: [
            {
              PolicyName: "OneUptimeAiAgentOperations",
              PolicyDocument: getAwsWritePolicy(setup),
            },
          ],
        },
      },
      // Nothing comes in: the agent asks OneUptime for its work.
      SecurityGroup: {
        Type: "AWS::EC2::SecurityGroup",
        Properties: {
          GroupDescription: "OneUptime Cloud AI agent: outbound only",
          VpcId: { Ref: "VpcId" },
          SecurityGroupEgress: [
            {
              IpProtocol: "-1",
              CidrIp: "0.0.0.0/0",
              Description: "OneUptime, the AWS APIs and the image registry",
            },
          ],
        },
      },
      TaskDefinition: {
        Type: "AWS::ECS::TaskDefinition",
        Properties: {
          Family: CLOUD_AI_AGENT_NAME,
          RequiresCompatibilities: ["FARGATE"],
          NetworkMode: "awsvpc",
          Cpu: String(size.vcpu * 1024),
          Memory: String(size.memoryGiB * 1024),
          RuntimePlatform: {
            OperatingSystemFamily: "LINUX",
            CpuArchitecture: "X86_64",
          },
          ExecutionRoleArn: { "Fn::GetAtt": ["ExecutionRole", "Arn"] },
          TaskRoleArn: { "Fn::GetAtt": ["TaskRole", "Arn"] },
          ContainerDefinitions: [
            {
              Name: CLOUD_AI_AGENT_NAME,
              Image: setup.image,
              Essential: true,
              Environment: containerEnvironment,
              Secrets: containerSecrets,
              LogConfiguration: {
                LogDriver: "awslogs",
                Options: {
                  "awslogs-group": { Ref: "LogGroup" },
                  "awslogs-region": { Ref: "AWS::Region" },
                  "awslogs-stream-prefix": "agent",
                },
              },
            },
          ],
        },
      },
      Service: {
        Type: "AWS::ECS::Service",
        Properties: {
          ServiceName: AWS_CLOUD_AI_AGENT_SERVICE_NAME,
          Cluster: { Ref: "Cluster" },
          TaskDefinition: { Ref: "TaskDefinition" },
          LaunchType: "FARGATE",
          DesiredCount: 1,
          /*
           * One agent at a time: an update stops the old task before the
           * new one starts, and rolls back on its own if the new one fails.
           */
          DeploymentConfiguration: {
            MinimumHealthyPercent: 0,
            MaximumPercent: 100,
            DeploymentCircuitBreaker: { Enable: true, Rollback: true },
          },
          NetworkConfiguration: {
            AwsvpcConfiguration: {
              /*
               * A public IP, in the default VPC's public subnets, is how the
               * task reaches OneUptime, the AWS APIs and Docker Hub without
               * a NAT gateway. The security group still lets nothing in.
               */
              AssignPublicIp: "ENABLED",
              Subnets: { Ref: "SubnetIds" },
              SecurityGroups: [{ "Fn::GetAtt": ["SecurityGroup", "GroupId"] }],
            },
          },
        },
      },
    },
    Outputs: {
      WriteRoleArn: { Value: { "Fn::GetAtt": ["WriteRole", "Arn"] } },
    },
  };
}

/*
 * The CloudFormation template the AWS command deploys, as JSON: also what a
 * team that keeps its infrastructure in CloudFormation deploys itself, with
 * VpcId, SubnetIds and IngestionKey as its parameters.
 */
export function getAwsCloudAiAgentTemplate(
  options: CloudAiAgentSetupOptions,
): string {
  return JSON.stringify(
    getAwsTemplate(checkedSetup(options, CloudProvider.AWS)),
  );
}

/*
 * AWS, in CloudShell: the account the shell is signed in to and the
 * Region's default VPC and subnets, the template, then - in the account
 * the command was written for, and only there - the stack. A first attempt
 * that rolled back is deleted first, since a stack in ROLLBACK_COMPLETE
 * cannot be updated; otherwise deploy creates the stack or updates it, and
 * does nothing when nothing changed.
 */
export function getAwsCloudAiAgentSetupCommand(
  options: CloudAiAgentSetupOptions,
): string {
  return writeAwsCommand(checkedSetup(options, CloudProvider.AWS));
}

function writeAwsCommand(setup: CloudAiAgentSetup): string {
  const region: string = setup.region ? ` --region ${setup.region}` : "";
  const stack: string = `--stack-name ${AWS_CLOUD_AI_AGENT_STACK_NAME}${region}`;

  return [
    "ACCOUNT=$(aws sts get-caller-identity --query Account --output text)",
    `VPC=$(aws ec2 describe-vpcs${region} --filters Name=is-default,Values=true --query "Vpcs[0].VpcId" --output text)`,
    `SUBNETS=$(aws ec2 describe-subnets${region} --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true --query "Subnets[].SubnetId" --output text | tr '\\t' ',')`,
    `cat > ${AWS_CLOUD_AI_AGENT_TEMPLATE_FILE} <<'TEMPLATE'`,
    JSON.stringify(getAwsTemplate(setup)),
    "TEMPLATE",
    `if [ "$ACCOUNT" != ${setup.accountId} ]; then`,
    `  echo "This command is for AWS account ${setup.accountId}, and this shell is signed in to another one. Open CloudShell in AWS account ${setup.accountId} and run the command there."`,
    `elif [ "$VPC" = None ] || [ -z "$SUBNETS" ]; then`,
    `  echo "This Region has no default VPC with default subnets for the agent to run in. Run the command in a Region that has one, or create it with: aws ec2 create-default-vpc"`,
    "else",
    `  [ "$(aws cloudformation describe-stacks ${stack} --query "Stacks[0].StackStatus" --output text 2> /dev/null)" = ROLLBACK_COMPLETE ] && aws cloudformation delete-stack ${stack} && aws cloudformation wait stack-delete-complete ${stack}`,
    `  aws cloudformation deploy ${stack} --template-file ${AWS_CLOUD_AI_AGENT_TEMPLATE_FILE} --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --parameter-overrides VpcId="$VPC" SubnetIds="$SUBNETS" IngestionKey=${shellQuote(setup.ingestionKey)} && echo "${CLOUD_AI_AGENT_STARTED_MESSAGE}"`,
    "fi",
  ].join("\n");
}

// ---- Azure ----------------------------------------------------------------------

/*
 * Custom role names are unique in a whole tenant, so each subscription's
 * agent role carries the subscription's id: a second subscription of the
 * same tenant gets a role of its own instead of failing to create one.
 */
export function getAzureCloudAiAgentRoleName(subscriptionId: string): string {
  return `${AZURE_CLOUD_AI_AGENT_ROLE_NAME} (${subscriptionId.trim().toLowerCase()})`;
}

export interface AzureCloudAiAgentRoleDefinition {
  Name: string;
  IsCustom: boolean;
  Description: string;
  Actions: Array<string>;
  NotActions: Array<string>;
  DataActions: Array<string>;
  NotDataActions: Array<string>;
  AssignableScopes: Array<string>;
}

/*
 * The custom role, as `az role definition create` and `update` take it:
 * the operations' actions on the one subscription. RBAC cannot leave the
 * agent's own resource group out of a subscription's role; the agent
 * protects it (getCloudAiAgentOwnTargets).
 */
export function getAzureCloudAiAgentRoleDefinition(
  options: CloudAiAgentSetupOptions,
): AzureCloudAiAgentRoleDefinition {
  return azureRoleDefinitionOf(checkedSetup(options, CloudProvider.Azure));
}

function azureRoleDefinitionOf(
  setup: CloudAiAgentSetup,
): AzureCloudAiAgentRoleDefinition {
  return {
    Name: getAzureCloudAiAgentRoleName(setup.accountId),
    IsCustom: true,
    Description: ROLE_DESCRIPTION,
    Actions: getCloudAiAgentRolePermissions(
      CloudProvider.Azure,
      setup.operations,
    ),
    NotActions: [],
    DataActions: [],
    NotDataActions: [],
    AssignableScopes: [`/subscriptions/${setup.accountId}`],
  };
}

/*
 * Azure, in Cloud Shell, in the subscription the command was written for
 * (every call names it, so the shell's default subscription does not
 * matter): the role, created or updated; the resource group and the
 * Container Apps environment, created when they are not there; the app,
 * which `az containerapp create` writes whole each time - its image,
 * secret, variables and size - keeping its identity; and the role on the
 * subscription for that identity (`az role assignment create` is a no-op
 * when the assignment is there). The role is assigned by its id, which
 * needs no lookup of a role made a minute before.
 */
export function getAzureCloudAiAgentSetupCommand(
  options: CloudAiAgentSetupOptions,
): string {
  return writeAzureCommand(checkedSetup(options, CloudProvider.Azure));
}

function writeAzureCommand(setup: CloudAiAgentSetup): string {
  const size: CloudAiAgentSize = CLOUD_AI_AGENT_SIZES[CloudProvider.Azure];
  const location: string = setup.region as string;
  const subscription: string = '--subscription "$SUBSCRIPTION"';
  const group: string = `--resource-group ${AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP}`;
  const variables: Array<string> = environmentOf(setup).map(
    (variable: CloudAiAgentEnvironmentVariable): string => {
      return variable.isSecret
        ? `${variable.name}=secretref:${AZURE_CLOUD_AI_AGENT_SECRET_NAME}`
        : `${variable.name}=${shellQuote(variable.value)}`;
    },
  );

  return [
    `SUBSCRIPTION=${setup.accountId}`,
    `DEFINITION=${shellQuote(JSON.stringify(azureRoleDefinitionOf(setup)))}`,
    "az extension add --name containerapp --upgrade -y --only-show-errors",
    `ROLE=$(az role definition create ${subscription} --role-definition "$DEFINITION" --query name --output tsv 2> /dev/null || az role definition update ${subscription} --role-definition "$DEFINITION" --query name --output tsv)`,
    `az provider register ${subscription} --namespace Microsoft.App --wait`,
    `az group show ${subscription} --name ${AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP} > /dev/null 2>&1 || az group create ${subscription} --name ${AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP} --location ${location} --output none`,
    `az containerapp env show ${subscription} --name ${AZURE_CLOUD_AI_AGENT_ENVIRONMENT_NAME} ${group} > /dev/null 2>&1 || az containerapp env create ${subscription} --name ${AZURE_CLOUD_AI_AGENT_ENVIRONMENT_NAME} ${group} --location ${location} --logs-destination none --output none`,
    // The app, its identity's role, and the line that says so: each only when the one before worked.
    [
      `az containerapp create ${subscription} --name ${AZURE_CLOUD_AI_AGENT_APP_NAME} ${group}`,
      `--environment ${AZURE_CLOUD_AI_AGENT_ENVIRONMENT_NAME} --image ${setup.image}`,
      `--cpu ${size.vcpu} --memory ${size.memoryGiB}Gi --min-replicas 1 --max-replicas 1 --system-assigned`,
      `--secrets ${AZURE_CLOUD_AI_AGENT_SECRET_NAME}=${shellQuote(setup.ingestionKey)}`,
      `--env-vars ${variables.join(" ")}`,
      "--output none &&",
    ].join(" "),
    `  PRINCIPAL=$(az containerapp show ${subscription} --name ${AZURE_CLOUD_AI_AGENT_APP_NAME} ${group} --query identity.principalId --output tsv) &&`,
    `  az role assignment create ${subscription} --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal --role "$ROLE" --scope "/subscriptions/$SUBSCRIPTION" --output none &&`,
    `  echo "${CLOUD_AI_AGENT_STARTED_MESSAGE}"`,
  ].join("\n");
}

// ---- Google Cloud ---------------------------------------------------------------

// The API each Google Cloud permission's service is called through.
const GCP_PERMISSION_APIS: Readonly<Record<string, string>> = {
  run: "run.googleapis.com",
  compute: "compute.googleapis.com",
  cloudsql: "sqladmin.googleapis.com",
};

/*
 * The APIs the Google Cloud command turns on: what the agent runs on
 * (Compute Engine and Cloud Logging for its VM, or Cloud Run), IAM and
 * Resource Manager (the role, the service account and its binding),
 * Secret Manager (the key), and those of the operations turned on.
 */
export function getGcpCloudAiAgentServices(
  enabledOperations?: Array<string> | undefined,
  gcpHost: GcpCloudAiAgentHost = GCP_CLOUD_AI_AGENT_DEFAULT_HOST,
): Array<string> {
  const services: Array<string> = [
    ...(gcpHost === "cloud-run"
      ? ["run.googleapis.com"]
      : ["compute.googleapis.com", "logging.googleapis.com"]),
    "iam.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "secretmanager.googleapis.com",
  ];

  for (const permission of getCloudAiAgentRolePermissions(
    CloudProvider.GCP,
    enabledOperations,
  )) {
    const api: string | undefined =
      GCP_PERMISSION_APIS[permission.substring(0, permission.indexOf("."))];

    if (api && !services.includes(api)) {
      services.push(api);
    }
  }

  return services;
}

/*
 * Google Cloud, in Cloud Shell, in the project the command was written for
 * (every call names it): the APIs, the role (created, or updated to
 * exactly these permissions), the service account (created when it is not
 * there) and its binding, the key as a new version of a Secret Manager
 * secret only that service account may read, then the agent on its host:
 *
 *   - compute-engine (the default): a network of its own whose firewall
 *     lets nothing in (a VPC denies every connection in until a rule
 *     allows one, and none is made), and one e2-micro VM of
 *     Container-Optimized OS in it, running as the service account, whose
 *     startup script - every boot - pulls the agent's image, reads the key
 *     from Secret Manager (GCP_CLOUD_AI_AGENT_KEY_READER, in the image) and
 *     starts the agent. Run again, the command writes the startup script
 *     anew and restarts the VM, which starts the agent the new way.
 *   - cloud-run: `gcloud run deploy` creates the service or moves it to a
 *     new revision with exactly these variables and the key from the
 *     secret - tried again, 30 seconds later, while Cloud Run cannot read
 *     the secret yet.
 *
 * One agent per account: once the agent runs on one host, the command
 * removes the one an earlier run started on the other. The variables and
 * the key go through files the shell does not expand, each removed once
 * read: the key is never on a command line, in the VM's metadata or one of
 * the service's variables, which anyone who may view them reads.
 */
export function getGcpCloudAiAgentSetupCommand(
  options: CloudAiAgentSetupOptions,
): string {
  return writeGcpCommand(checkedSetup(options, CloudProvider.GCP));
}

// The service account the agent runs as, in the command's shell.
const GCP_MEMBER: string = `${GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID}@$PROJECT_ID.iam.gserviceaccount.com`;
const GCP_PROJECT_FLAG: string = '--project "$PROJECT_ID"';

/*
 * Whether an API is on in the project, as a shell condition: a list call
 * of a service whose API is off asks, in Cloud Shell, whether to turn it
 * on - and would read the next line pasted as the answer. --quiet answers
 * no to every question.
 */
function gcpApiIsOn(api: string): string {
  return `gcloud services list ${GCP_PROJECT_FLAG} --enabled --filter "config.name=${api}" --format "value(config.name)" --quiet 2> /dev/null | grep -q .`;
}

// What both hosts share: the APIs, the role and its account, and the key.
function writeGcpCommandStart(setup: CloudAiAgentSetup): Array<string> {
  // The same title, description and permissions whether it creates or updates.
  const role: string = [
    `--title ${shellQuote(ROLE_TITLE)}`,
    `--description ${shellQuote(ROLE_DESCRIPTION)}`,
    '--permissions "$PERMISSIONS" --stage GA --quiet',
  ].join(" ");
  const secret: string = GCP_CLOUD_AI_AGENT_SECRET_NAME;

  return [
    `PROJECT_ID=${setup.accountId}`,
    `PERMISSIONS=${shellQuote(getCloudAiAgentRolePermissions(CloudProvider.GCP, setup.operations).join(","))}`,
    `gcloud services enable ${getGcpCloudAiAgentServices(setup.operations, setup.gcpHost).join(" ")} ${GCP_PROJECT_FLAG}`,
    `gcloud iam roles create ${GCP_CLOUD_AI_AGENT_ROLE_ID} ${GCP_PROJECT_FLAG} ${role} > /dev/null 2>&1 || gcloud iam roles update ${GCP_CLOUD_AI_AGENT_ROLE_ID} ${GCP_PROJECT_FLAG} ${role} > /dev/null`,
    `gcloud iam service-accounts create ${GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID} ${GCP_PROJECT_FLAG} --display-name ${shellQuote("OneUptime Cloud AI agent")} > /dev/null 2>&1 || true`,
    `gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${GCP_MEMBER}" --role "projects/$PROJECT_ID/roles/${GCP_CLOUD_AI_AGENT_ROLE_ID}" --condition=None > /dev/null`,
    // The key: a secret only the agent's service account may read.
    `cat > ${GCP_CLOUD_AI_AGENT_KEY_FILE} <<'${GCP_CLOUD_AI_AGENT_KEY_FILE_END}'`,
    setup.ingestionKey,
    GCP_CLOUD_AI_AGENT_KEY_FILE_END,
    `gcloud secrets create ${secret} ${GCP_PROJECT_FLAG} --replication-policy automatic > /dev/null 2>&1 || true`,
    `tr -d '\\n' < ${GCP_CLOUD_AI_AGENT_KEY_FILE} | gcloud secrets versions add ${secret} ${GCP_PROJECT_FLAG} --data-file=- > /dev/null`,
    `rm ${GCP_CLOUD_AI_AGENT_KEY_FILE}`,
    `gcloud secrets add-iam-policy-binding ${secret} ${GCP_PROJECT_FLAG} --member "serviceAccount:${GCP_MEMBER}" --role ${GCP_SECRET_ACCESSOR_ROLE} --condition=None > /dev/null`,
  ];
}

/*
 * The VM's startup script: run as root at every boot, it holds no secret
 * (anyone who may view the VM reads its metadata). The agent's variables
 * and the key reader go to memory (/run), the image is pulled until the
 * network answers, the key is read from Secret Manager in the image itself,
 * and the agent starts - read-only, its /tmp in memory, on the VM's own
 * network (the metadata server answers its tokens there), its log in Cloud
 * Logging, started again by Docker should it stop - the file with the key
 * removed once Docker has read it.
 */
export function getGcpCloudAiAgentStartupScript(
  options: CloudAiAgentSetupOptions,
): string {
  return writeGcpStartupScript(checkedSetup(options, CloudProvider.GCP));
}

function writeGcpStartupScript(setup: CloudAiAgentSetup): string {
  const variables: Array<CloudAiAgentEnvironmentVariable> =
    environmentOf(setup);
  const keyVariable: string =
    variables.find((variable: CloudAiAgentEnvironmentVariable): boolean => {
      return variable.isSecret;
    })?.name || CLOUD_AI_AGENT_INGESTION_KEY_ENV;
  const run: string = GCP_CLOUD_AI_AGENT_RUN_DIRECTORY;

  /*
   * No #! line: the guest environment runs a startup script with bash, and
   * a "!" in the pasted command would be expanded by Cloud Shell's
   * interactive bash, even inside the here-document.
   */
  return [
    "# The OneUptime Cloud AI agent, started by bash on every boot. Written by its setup command; it holds no secret.",
    `IMAGE=${setup.image}`,
    `SECRET=projects/${setup.accountId}/secrets/${GCP_CLOUD_AI_AGENT_SECRET_NAME}/versions/latest`,
    "umask 077",
    `mkdir -p ${run}`,
    `cat > ${run}/agent.env <<'ENV'`,
    ...variables
      .filter((variable: CloudAiAgentEnvironmentVariable): boolean => {
        return !variable.isSecret;
      })
      .map((variable: CloudAiAgentEnvironmentVariable): string => {
        return `${variable.name}=${variable.value}`;
      }),
    "ENV",
    `cat > ${run}/key.js <<'KEYJS'`,
    GCP_CLOUD_AI_AGENT_KEY_READER,
    "KEYJS",
    // The image runs as its own user, which reads the key reader.
    `chmod 755 ${run}`,
    `chmod 644 ${run}/key.js`,
    'until docker pull "$IMAGE" > /dev/null; do sleep 10; done',
    `KEY=$(docker run --rm --network host -v ${run}/key.js:/key.js:ro --entrypoint node "$IMAGE" /key.js "$SECRET") || { rm -f ${run}/agent.env; exit 1; }`,
    `printf '%s=%s\\n' ${keyVariable} "$KEY" >> ${run}/agent.env`,
    `docker rm -f ${GCP_CLOUD_AI_AGENT_INSTANCE_NAME} > /dev/null 2>&1`,
    `docker run -d --name ${GCP_CLOUD_AI_AGENT_INSTANCE_NAME} --restart unless-stopped --network host --read-only --tmpfs /tmp --log-driver gcplogs --env-file ${run}/agent.env "$IMAGE" > /dev/null`,
    `rm -f ${run}/agent.env`,
  ].join("\n");
}

// The agent on its VM, in a network that lets nothing in.
function writeGcpVmCommand(setup: CloudAiAgentSetup): Array<string> {
  const vm: string = GCP_CLOUD_AI_AGENT_INSTANCE_NAME;
  const network: string = GCP_CLOUD_AI_AGENT_NETWORK_NAME;
  const startup: string = GCP_CLOUD_AI_AGENT_STARTUP_FILE;
  const region: string = setup.region as string;
  const create: string = [
    `gcloud compute instances create ${vm} ${GCP_PROJECT_FLAG} --zone "$ZONE"`,
    `--machine-type ${GCP_CLOUD_AI_AGENT_MACHINE_TYPE} --network ${network} --subnet ${network}`,
    `--image-family ${GCP_CLOUD_AI_AGENT_IMAGE_FAMILY} --image-project ${GCP_CLOUD_AI_AGENT_IMAGE_PROJECT}`,
    `--boot-disk-size ${GCP_CLOUD_AI_AGENT_BOOT_DISK_GB}GB --boot-disk-type ${GCP_CLOUD_AI_AGENT_BOOT_DISK_TYPE}`,
    `--service-account "${GCP_MEMBER}" --scopes cloud-platform`,
    "--shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring",
    "--metadata enable-oslogin=TRUE,block-project-ssh-keys=TRUE",
    `--metadata-from-file startup-script=${startup} --quiet > /dev/null`,
  ].join(" ");

  return [
    // Its own log in Cloud Logging, written by Docker on the VM.
    `gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${GCP_MEMBER}" --role ${GCP_CLOUD_AI_AGENT_LOG_WRITER_ROLE} --condition=None > /dev/null`,
    // A network of its own: no firewall rule, so nothing gets in.
    `gcloud compute networks create ${network} ${GCP_PROJECT_FLAG} --subnet-mode custom > /dev/null 2>&1 || true`,
    `gcloud compute networks subnets create ${network} ${GCP_PROJECT_FLAG} --network ${network} --region ${region} --range ${GCP_CLOUD_AI_AGENT_SUBNET_RANGE} > /dev/null 2>&1 || true`,
    `cat > ${startup} <<'STARTUP'`,
    writeGcpStartupScript(setup),
    "STARTUP",
    // The VM an earlier run made, wherever it is: written anew and restarted.
    `ZONE=$(gcloud compute instances list ${GCP_PROJECT_FLAG} --filter "name=${vm}" --format "value(zone.basename())" --quiet | head -1)`,
    'if [ -n "$ZONE" ]; then',
    `  gcloud compute instances add-metadata ${vm} ${GCP_PROJECT_FLAG} --zone "$ZONE" --metadata-from-file startup-script=${startup} > /dev/null && gcloud compute instances reset ${vm} ${GCP_PROJECT_FLAG} --zone "$ZONE" --quiet > /dev/null && STARTED=1`,
    "else",
    `  ZONE=$(gcloud compute zones list ${GCP_PROJECT_FLAG} --filter "region:${region}" --format "value(name)" --sort-by name --limit 1 --quiet)`,
    `  ${create} && STARTED=1`,
    "fi",
    `rm ${startup}`,
    // One agent per account: the Cloud Run service an earlier run started goes.
    `if [ -n "$STARTED" ] && ${gcpApiIsOn("run.googleapis.com")}; then`,
    `  for REGION in $(gcloud run services list ${GCP_PROJECT_FLAG} --filter "metadata.name=${GCP_CLOUD_AI_AGENT_SERVICE_NAME}" --format "value(region)" --quiet); do gcloud run services delete ${GCP_CLOUD_AI_AGENT_SERVICE_NAME} ${GCP_PROJECT_FLAG} --region "$REGION" --quiet > /dev/null; done`,
    "fi",
    `if [ -n "$STARTED" ]; then echo "${CLOUD_AI_AGENT_STARTED_MESSAGE}"; else echo "${GCP_CLOUD_AI_AGENT_VM_REFUSED_MESSAGE}"; fi`,
  ];
}

// The agent as a Cloud Run service with CPU always allocated.
function writeGcpCloudRunCommand(setup: CloudAiAgentSetup): Array<string> {
  const size: CloudAiAgentSize = CLOUD_AI_AGENT_SIZES[CloudProvider.GCP];
  const secret: string = GCP_CLOUD_AI_AGENT_SECRET_NAME;
  const variables: Array<CloudAiAgentEnvironmentVariable> =
    environmentOf(setup);
  const secrets: Array<string> = variables
    .filter((variable: CloudAiAgentEnvironmentVariable): boolean => {
      return variable.isSecret;
    })
    .map((variable: CloudAiAgentEnvironmentVariable): string => {
      return `${variable.name}=${secret}:latest`;
    });
  const deploy: string = [
    `gcloud run deploy ${GCP_CLOUD_AI_AGENT_SERVICE_NAME} ${GCP_PROJECT_FLAG} --region ${setup.region as string}`,
    `--image ${setup.image} --service-account "${GCP_MEMBER}"`,
    `--no-cpu-throttling --min-instances 1 --max-instances 1 --cpu ${size.vcpu} --memory ${size.memoryGiB * 1024}Mi`,
    `--no-allow-unauthenticated --ingress internal --port ${RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT}`,
    `--env-vars-file ${GCP_CLOUD_AI_AGENT_ENV_FILE} --set-secrets ${secrets.join(",")} --quiet`,
  ].join(" ");
  const attempts: Array<number> = Array.from(
    { length: GCP_CLOUD_AI_AGENT_DEPLOY_ATTEMPTS },
    (_: unknown, index: number): number => {
      return index + 1;
    },
  );

  return [
    `cat > ${GCP_CLOUD_AI_AGENT_ENV_FILE} <<'ENV'`,
    ...variables
      .filter((variable: CloudAiAgentEnvironmentVariable): boolean => {
        return !variable.isSecret;
      })
      .map((variable: CloudAiAgentEnvironmentVariable): string => {
        return `${variable.name}: ${JSON.stringify(variable.value)}`;
      }),
    "ENV",
    // A deploy that did not work is tried again: the key's access may still be on its way.
    `for ATTEMPT in ${attempts.join(" ")}; do`,
    `  if ${deploy}; then STARTED=1; echo "${CLOUD_AI_AGENT_STARTED_MESSAGE}"; break; fi`,
    `  [ "$ATTEMPT" = ${GCP_CLOUD_AI_AGENT_DEPLOY_ATTEMPTS} ] || { echo "${GCP_CLOUD_AI_AGENT_DEPLOY_RETRY_MESSAGE}"; sleep ${GCP_CLOUD_AI_AGENT_DEPLOY_RETRY_SECONDS}; }`,
    "done",
    `rm ${GCP_CLOUD_AI_AGENT_ENV_FILE}`,
    // One agent per account: the VM an earlier run started goes.
    `if [ -n "$STARTED" ] && ${gcpApiIsOn("compute.googleapis.com")}; then`,
    `  for ZONE in $(gcloud compute instances list ${GCP_PROJECT_FLAG} --filter "name=${GCP_CLOUD_AI_AGENT_INSTANCE_NAME}" --format "value(zone.basename())" --quiet); do gcloud compute instances delete ${GCP_CLOUD_AI_AGENT_INSTANCE_NAME} ${GCP_PROJECT_FLAG} --zone "$ZONE" --quiet > /dev/null; done`,
    "fi",
  ];
}

function writeGcpCommand(setup: CloudAiAgentSetup): string {
  return [
    ...writeGcpCommandStart(setup),
    ...(setup.gcpHost === "cloud-run"
      ? writeGcpCloudRunCommand(setup)
      : writeGcpVmCommand(setup)),
  ].join("\n");
}

// The cloud's command, for its own browser shell.
export function getCloudAiAgentSetupCommand(
  options: CloudAiAgentSetupOptions,
): string {
  const setup: CloudAiAgentSetup = checkedSetup(options);

  if (setup.provider === CloudProvider.AWS) {
    return writeAwsCommand(setup);
  }

  if (setup.provider === CloudProvider.Azure) {
    return writeAzureCommand(setup);
  }

  return writeGcpCommand(setup);
}
