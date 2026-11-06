import {
  RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
  RESOURCE_AI_AZURE_WRITE_IDENTITY_ENV,
  RESOURCE_AI_CLOUD_OPERATIONS_ENV,
  RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV,
  RESOURCE_AI_GCP_WRITE_SERVICE_ACCOUNT_ENV,
} from "../../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  CLOUD_CATALOG_PROVIDER_NAMES,
  CloudCatalogProvider,
  CloudOperationSpec,
  getCloudOperation,
  isCloudChangeOperation,
  isCloudOperationAvailable,
  CLOUD_OPERATIONS,
} from "../../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * What a Cloud AI agent's own settings let it change (the cloud's setup
 * command writes them; Common/Types/ResourceAiAgent/ResourceAiAccess names
 * them):
 *
 *   ONEUPTIME_AI_CLOUD_OPERATIONS    comma-separated catalog changes. Unset
 *                                    or empty: every change the catalog has
 *                                    on this cloud. A name that is not one
 *                                    (a typo, a read, a change this cloud
 *                                    lacks) is a warning and is ignored; a
 *                                    list in which no name is one enables
 *                                    nothing — a list was meant to narrow.
 *   ONEUPTIME_AI_CLOUD_REQUIRED_TAG  "key=value": only resources carrying
 *                                    exactly that tag (label) are changed.
 *                                    A value that is not key=value refuses
 *                                    every change, rather than none.
 *   ONEUPTIME_AI_AWS_WRITE_ROLE_ARN  AWS: the role each change assumes. A
 *                                    value that is not a role ARN refuses
 *                                    every change, rather than falling
 *                                    back to the agent's own credentials.
 *   ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT
 *                                    Google Cloud: the service account each
 *                                    change runs as, with a token the agent
 *                                    asks for that one change. A value that
 *                                    is not a service account refuses every
 *                                    change, rather than falling back to the
 *                                    agent's own account.
 *   ONEUPTIME_AI_AZURE_WRITE_IDENTITY
 *                                    Azure: the resource ID of the
 *                                    user-assigned managed identity each
 *                                    change runs as, with a token the agent
 *                                    asks for that change. A value that is
 *                                    not such an ID refuses every change,
 *                                    rather than falling back to the
 *                                    agent's own identity.
 *
 * Pure: Config reads it for the start-up warnings, the executor for every
 * command and the posture.
 */

export interface CloudRequiredTag {
  key: string;
  value: string;
}

// An Azure user-assigned managed identity, as its resource ID names it.
export interface AzureWriteIdentity {
  // The resource ID, as written (trimmed): what its token is asked for by.
  resourceId: string;
  // Lowercased: the subscription it belongs to.
  subscriptionId: string;
  resourceGroup: string;
  name: string;
}

export interface CloudAgentSettings {
  provider: CloudCatalogProvider;
  // The changes the agent may make, in catalog order.
  enabledOperations: Array<string>;
  // ONEUPTIME_AI_CLOUD_OPERATIONS narrowed them (false: every change).
  operationsLimited: boolean;
  requiredTag: CloudRequiredTag | null;
  // Set but unreadable: every change is refused with this.
  requiredTagProblem: string | null;
  awsWriteRoleArn: string | null;
  // Set but not a role ARN: every change is refused with this.
  awsWriteRoleProblem: string | null;
  gcpWriteServiceAccount: string | null;
  // Set but not a service account: every change is refused with this.
  gcpWriteServiceAccountProblem: string | null;
  azureWriteIdentity: AzureWriteIdentity | null;
  // Set but not a user-assigned identity's ID: every change is refused with this.
  azureWriteIdentityProblem: string | null;
  warnings: Array<string>;
}

// arn:<partition>:iam::<account>:role/<path/name>
const ROLE_ARN_PATTERN: RegExp =
  /^arn:aws(?:-cn|-us-gov|-iso|-iso-b)?:iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_/-]{1,512}$/;

// <account id>@<project id>.iam.gserviceaccount.com: each 6 to 30 characters.
const SERVICE_ACCOUNT_PATTERN: RegExp =
  /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;

// The project a service account's email names.
export function getServiceAccountProject(email: string): string {
  return email.slice(email.indexOf("@") + 1, email.indexOf("."));
}

/*
 * A user-assigned managed identity's resource ID, without case as Azure
 * reads it: its subscription, its resource group (letters, digits and
 * _ - . ( ), at most 90) and its name (3 to 128 letters, digits, _ and -,
 * starting with a letter or a digit). Anchored, with bounded repeats.
 */
const USER_ASSIGNED_IDENTITY_ID_PATTERN: RegExp =
  /^\/subscriptions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/resourcegroups\/([\w.()-]{1,90})\/providers\/microsoft\.managedidentity\/userassignedidentities\/([A-Za-z0-9][\w-]{2,127})$/i;

// The ID Azure Resource Manager makes for one, as messages show it (lowercased).
const USER_ASSIGNED_IDENTITY_ID_EXAMPLE: string =
  "/subscriptions/<subscription id>/resourcegroups/oneuptime-ai-agent/providers/microsoft.managedidentity/userassignedidentities/oneuptime-ai-agent-write";

/*
 * Why a write identity of another subscription than the one the agent
 * serves changes nothing (no full stop), or null for one of its own: the
 * write identity is the subscription's own, as its setup command makes it,
 * so a change never runs as an identity another subscription's owners
 * hold - and the agent never falls back to its own identity instead. An
 * agent that does not know its subscription changes nothing anyway, and
 * says so for that reason (null here).
 */
export function describeAzureWriteIdentityElsewhere(data: {
  identity: AzureWriteIdentity;
  subscriptionId: string;
}): string | null {
  const serves: string = data.subscriptionId.trim().toLowerCase();

  if (!serves || data.identity.subscriptionId === serves) {
    return null;
  }

  // Short enough for the posture (MAX_POSTURE_STRING_LENGTH) with both ids.
  return `${RESOURCE_AI_AZURE_WRITE_IDENTITY_ENV} names an identity of subscription ${data.identity.subscriptionId}, but the agent serves subscription ${serves}, so it changes nothing`;
}

// A user-assigned identity's resource ID read apart, or null for anything else.
export function parseAzureWriteIdentity(
  value: string,
): AzureWriteIdentity | null {
  const match: RegExpExecArray | null =
    USER_ASSIGNED_IDENTITY_ID_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  return {
    resourceId: value,
    subscriptionId: (match[1] || "").toLowerCase(),
    resourceGroup: match[2] || "",
    name: match[3] || "",
  };
}

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  const value: unknown = env[name];
  return typeof value === "string" ? value.trim() : "";
}

// Every change this cloud has, in catalog order.
export function getCloudChangeNames(
  provider: CloudCatalogProvider,
): Array<string> {
  return CLOUD_OPERATIONS.filter((operation: CloudOperationSpec): boolean => {
    return (
      isCloudChangeOperation(operation) &&
      isCloudOperationAvailable(operation, provider)
    );
  }).map((operation: CloudOperationSpec): string => {
    return operation.name;
  });
}

function parseOperations(
  value: string,
  provider: CloudCatalogProvider,
  warnings: Array<string>,
): { enabled: Array<string>; limited: boolean } {
  const all: Array<string> = getCloudChangeNames(provider);
  const words: Array<string> = value
    .split(",")
    .map((word: string): string => {
      return word.trim();
    })
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  if (words.length === 0) {
    return { enabled: all, limited: false };
  }

  const chosen: Set<string> = new Set<string>();

  for (const word of words) {
    const operation: CloudOperationSpec | null = getCloudOperation(
      word.toLowerCase(),
    );

    if (!operation) {
      warnings.push(
        `${RESOURCE_AI_CLOUD_OPERATIONS_ENV} names "${word.slice(0, 64)}", which is not a cloud change, so the agent ignores it. The changes are: ${all.join(", ")}.`,
      );
      continue;
    }

    if (!isCloudChangeOperation(operation)) {
      warnings.push(
        `${RESOURCE_AI_CLOUD_OPERATIONS_ENV} names "${operation.name}", which is a read: reads are always available and are not listed there, so the agent ignores it.`,
      );
      continue;
    }

    if (!isCloudOperationAvailable(operation, provider)) {
      warnings.push(
        `${RESOURCE_AI_CLOUD_OPERATIONS_ENV} names "${operation.name}", which ${CLOUD_CATALOG_PROVIDER_NAMES[provider]} does not have, so the agent ignores it.`,
      );
      continue;
    }

    chosen.add(operation.name);
  }

  if (chosen.size === 0) {
    warnings.push(
      `${RESOURCE_AI_CLOUD_OPERATIONS_ENV} names no cloud change this agent knows, so it makes no change at all. List the changes it may make (${all.join(", ")}), or leave it empty for all of them.`,
    );
  }

  return {
    enabled: all.filter((name: string): boolean => {
      return chosen.has(name);
    }),
    limited: true,
  };
}

function parseRequiredTag(value: string): {
  tag: CloudRequiredTag | null;
  problem: string | null;
} {
  if (!value) {
    return { tag: null, problem: null };
  }

  const equals: number = value.indexOf("=");
  const key: string = equals >= 0 ? value.slice(0, equals).trim() : "";

  if (equals < 0 || !key || key.length > 128 || value.length > 384) {
    return {
      tag: null,
      problem: `${RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV}="${value.slice(0, 64)}" is not a tag written as key=value (such as oneuptime-ai=allow), so the agent changes nothing until it is fixed.`,
    };
  }

  return { tag: { key, value: value.slice(equals + 1).trim() }, problem: null };
}

export function parseCloudAgentSettings(
  env: NodeJS.ProcessEnv,
  provider: CloudCatalogProvider,
): CloudAgentSettings {
  const warnings: Array<string> = [];
  const operations: { enabled: Array<string>; limited: boolean } =
    parseOperations(
      readTrimmed(env, RESOURCE_AI_CLOUD_OPERATIONS_ENV),
      provider,
      warnings,
    );
  const tag: { tag: CloudRequiredTag | null; problem: string | null } =
    parseRequiredTag(readTrimmed(env, RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV));

  if (tag.problem) {
    warnings.push(tag.problem);
  }

  let awsWriteRoleArn: string | null = null;
  let awsWriteRoleProblem: string | null = null;
  const roleSetting: string = readTrimmed(
    env,
    RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
  );

  if (provider === "aws" && roleSetting) {
    if (ROLE_ARN_PATTERN.test(roleSetting)) {
      awsWriteRoleArn = roleSetting;
    } else {
      awsWriteRoleProblem = `${RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV}="${roleSetting.slice(0, 96)}" is not an IAM role ARN (arn:aws:iam::123456789012:role/OneUptimeAiAgentWrite), so the agent changes nothing until it is fixed.`;
      warnings.push(awsWriteRoleProblem);
    }
  } else if (provider !== "aws" && roleSetting) {
    warnings.push(
      `${RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV} is set, but this agent serves ${CLOUD_CATALOG_PROVIDER_NAMES[provider]}, so it is ignored.`,
    );
  }

  let gcpWriteServiceAccount: string | null = null;
  let gcpWriteServiceAccountProblem: string | null = null;
  const accountSetting: string = readTrimmed(
    env,
    RESOURCE_AI_GCP_WRITE_SERVICE_ACCOUNT_ENV,
  );

  if (provider === "gcp" && accountSetting) {
    if (
      accountSetting.length <= 128 &&
      SERVICE_ACCOUNT_PATTERN.test(accountSetting)
    ) {
      gcpWriteServiceAccount = accountSetting;
    } else {
      gcpWriteServiceAccountProblem = `${RESOURCE_AI_GCP_WRITE_SERVICE_ACCOUNT_ENV}="${accountSetting.slice(0, 96)}" is not a service account (oneuptime-ai-agent-write@my-project.iam.gserviceaccount.com), so the agent changes nothing until it is fixed.`;
      warnings.push(gcpWriteServiceAccountProblem);
    }
  } else if (provider !== "gcp" && accountSetting) {
    warnings.push(
      `${RESOURCE_AI_GCP_WRITE_SERVICE_ACCOUNT_ENV} is set, but this agent serves ${CLOUD_CATALOG_PROVIDER_NAMES[provider]}, so it is ignored.`,
    );
  }

  let azureWriteIdentity: AzureWriteIdentity | null = null;
  let azureWriteIdentityProblem: string | null = null;
  const identitySetting: string = readTrimmed(
    env,
    RESOURCE_AI_AZURE_WRITE_IDENTITY_ENV,
  );

  if (provider === "azure" && identitySetting) {
    azureWriteIdentity = parseAzureWriteIdentity(identitySetting);

    if (!azureWriteIdentity) {
      /*
       * Shown lowercased, as an Azure ID reads the same either way: the
       * output's redactor reads a camel-cased one as base64.
       */
      azureWriteIdentityProblem = `${RESOURCE_AI_AZURE_WRITE_IDENTITY_ENV}="${identitySetting
        .slice(0, 160)
        .toLowerCase()}" is not the resource ID of a user-assigned managed identity (${USER_ASSIGNED_IDENTITY_ID_EXAMPLE}), so the agent changes nothing until it is fixed.`;
      warnings.push(azureWriteIdentityProblem);
    }
  } else if (provider !== "azure" && identitySetting) {
    warnings.push(
      `${RESOURCE_AI_AZURE_WRITE_IDENTITY_ENV} is set, but this agent serves ${CLOUD_CATALOG_PROVIDER_NAMES[provider]}, so it is ignored.`,
    );
  }

  return {
    provider,
    enabledOperations: operations.enabled,
    operationsLimited: operations.limited,
    requiredTag: tag.tag,
    requiredTagProblem: tag.problem,
    awsWriteRoleArn,
    awsWriteRoleProblem,
    gcpWriteServiceAccount,
    gcpWriteServiceAccountProblem,
    azureWriteIdentity,
    azureWriteIdentityProblem,
    warnings,
  };
}

// "oneuptime-ai=allow"
export function formatRequiredTag(tag: CloudRequiredTag): string {
  return `${tag.key}=${tag.value}`;
}

/*
 * Whether the tags a resource carries hold the required one exactly. AWS
 * compares keys and values exactly; Azure tag names are case-insensitive
 * (values are not); Google Cloud labels are lowercase, compared lowercased.
 */
export function carriesRequiredTag(data: {
  provider: CloudCatalogProvider;
  tag: CloudRequiredTag;
  tags: Record<string, string>;
}): boolean {
  for (const [key, value] of Object.entries(data.tags)) {
    if (typeof value !== "string") {
      continue;
    }

    switch (data.provider) {
      case "azure":
        if (
          key.toLowerCase() === data.tag.key.toLowerCase() &&
          value === data.tag.value
        ) {
          return true;
        }
        break;
      case "gcp":
        if (
          key.toLowerCase() === data.tag.key.toLowerCase() &&
          value.toLowerCase() === data.tag.value.toLowerCase()
        ) {
          return true;
        }
        break;
      default:
        if (key === data.tag.key && value === data.tag.value) {
          return true;
        }
    }
  }

  return false;
}
