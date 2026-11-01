import {
  RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
  RESOURCE_AI_CLOUD_OPERATIONS_ENV,
  RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV,
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
 *
 * Pure: Config reads it for the start-up warnings, the executor for every
 * command and the posture.
 */

export interface CloudRequiredTag {
  key: string;
  value: string;
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
  warnings: Array<string>;
}

// arn:<partition>:iam::<account>:role/<path/name>
const ROLE_ARN_PATTERN: RegExp =
  /^arn:aws(?:-cn|-us-gov|-iso|-iso-b)?:iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_/-]{1,512}$/;

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

  return {
    provider,
    enabledOperations: operations.enabled,
    operationsLimited: operations.limited,
    requiredTag: tag.tag,
    requiredTagProblem: tag.problem,
    awsWriteRoleArn,
    awsWriteRoleProblem,
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
