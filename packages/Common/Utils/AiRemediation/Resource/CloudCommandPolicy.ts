/*
 * The cloud command policy: tiers the closed catalog of cloud operations
 * (never a free-form aws, az or gcloud command) a Cloud AI agent and the
 * server's live reads run on an AWS account, an Azure subscription or a
 * Google Cloud project.
 *
 * A command is `cloud <operation> [RESOURCE] [--flag value]...`, read by the
 * catalog's grammar (CloudOperationCatalog.parseCloudCommand) for the cloud
 * the resource type names — the same parse the agent's executor and the
 * server's live reads use to decide what to run, so the policy and the
 * runners can never read one argv two ways. Whatever the grammar does not
 * read as exactly one catalog operation on one resource is Denied, with a
 * reason that names what IS available.
 *
 * Tiers come from the catalog, per kind of resource: every read is Read;
 * restart-service on an ECS service, start-instance and scale-out are
 * SafeWrite; the rest are RiskyWrite, and fail-over-database, stop-instance
 * and redrive-queue always ask a person (requiresHuman). A change's target
 * is the resource's id (lowercased for Azure), the form the agent's
 * protectedTargets and ONEUPTIME_AI_WRITE_TARGETS globs are matched
 * against.
 *
 * One policy object per cloud, so the dispatcher's per-type lookup hands
 * each cloud's resource type the grammar and the guides of its own cloud.
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set only.
 */

import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
  deniedResult,
  renderResourceDisplayCommand,
} from "./ResourceCommandPolicyCore";
import {
  CLOUD_CATALOG_PROVIDER_NAMES,
  CLOUD_PROGRAM,
  CloudCatalogProvider,
  CloudCommandParse,
  CloudOperationKindSpec,
  CloudResourceKindSpec,
  ParsedCloudCommand,
  getCloudReadCommandGuide,
  getCloudResourceKind,
  getCloudWriteCommandGuide,
  getCloudWriteTarget,
  parseCloudCommand,
} from "./CloudOperationCatalog";

/*
 * A Denied result that cannot throw: deniedResult reads the argv, and an
 * argv that throws when read (it made the parse throw) is described without
 * it.
 */
function refused(argv: unknown, reason: string): ResourceCommandPolicyResult {
  try {
    return deniedResult(argv as Array<string>, reason);
  } catch {
    return {
      tier: ResourceCommandTier.Denied,
      reason,
      program: CLOUD_PROGRAM,
      args: [],
      verb: "",
      displayCommand: CLOUD_PROGRAM,
      targets: [],
    };
  }
}

// "an ECS service", "this AWS account": what the command acts on, in words.
function describeSubject(command: ParsedCloudCommand): string {
  if (!command.resource) {
    return `this ${CLOUD_CATALOG_PROVIDER_NAMES[command.provider]} account`;
  }

  const kind: CloudResourceKindSpec | null = getCloudResourceKind(
    command.provider,
    command.resource.kind,
  );

  return kind ? `one ${kind.displayName}` : "one resource";
}

function describeTier(command: ParsedCloudCommand): string {
  const spec: CloudOperationKindSpec = command.kindSpec;
  const name: string = `cloud ${command.operation.name}`;

  switch (spec.tier) {
    case ResourceCommandTier.Read:
      return `${name} is a live read that changes nothing: it ${command.operation.summary} (${spec.apiCall})`;

    case ResourceCommandTier.SafeWrite:
      return `${name} changes ${describeSubject(command)} only, with ${spec.apiCall}: it ${command.operation.summary}`;

    default:
      return `${name} changes ${describeSubject(command)} only, with ${spec.apiCall}${
        spec.requiresHuman ? ", and a person always approves it" : ""
      }: it ${command.operation.summary}`;
  }
}

function evaluateCloudArgv(
  provider: CloudCatalogProvider,
  argv: Array<string>,
): ResourceCommandPolicyResult {
  const parse: CloudCommandParse = parseCloudCommand(provider, argv);

  if (!parse.ok) {
    return refused(argv, parse.errorMessage);
  }

  const command: ParsedCloudCommand = parse.command;
  const tier: ResourceCommandTier = command.kindSpec.tier;

  if (
    tier !== ResourceCommandTier.Read &&
    tier !== ResourceCommandTier.SafeWrite &&
    tier !== ResourceCommandTier.RiskyWrite
  ) {
    return refused(argv, `cloud ${command.operation.name} is not allowed`);
  }

  const isWrite: boolean = tier !== ResourceCommandTier.Read;

  // A change always names its one resource; fail closed if it somehow did not.
  if (isWrite && !command.resource) {
    return refused(
      argv,
      `cloud ${command.operation.name} must name the one resource it changes`,
    );
  }

  const result: ResourceCommandPolicyResult = {
    tier,
    reason: describeTier(command),
    program: CLOUD_PROGRAM,
    args: command.canonicalArgs.slice(),
    verb: command.operation.name,
    displayCommand: renderResourceDisplayCommand([
      CLOUD_PROGRAM,
      ...command.canonicalArgs,
    ]),
    targets:
      isWrite && command.resource
        ? [getCloudWriteTarget(command.resource)]
        : [],
  };

  if (isWrite && command.kindSpec.requiresHuman) {
    result.requiresHuman = true;
  }

  return result;
}

function buildCloudCommandPolicy(
  provider: CloudCatalogProvider,
): ResourceToolPolicy {
  return {
    name: `cloud-${provider}`,
    programs: [CLOUD_PROGRAM],
    readCommandGuide: getCloudReadCommandGuide(provider),
    writeCommandGuide: getCloudWriteCommandGuide(provider),
    evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
      try {
        return evaluateCloudArgv(provider, argv);
      } catch {
        return refused(
          argv,
          "the cloud command policy could not read this command",
        );
      }
    },
  };
}

export const AwsCloudCommandPolicy: ResourceToolPolicy =
  buildCloudCommandPolicy("aws");
export const AzureCloudCommandPolicy: ResourceToolPolicy =
  buildCloudCommandPolicy("azure");
export const GcpCloudCommandPolicy: ResourceToolPolicy =
  buildCloudCommandPolicy("gcp");
