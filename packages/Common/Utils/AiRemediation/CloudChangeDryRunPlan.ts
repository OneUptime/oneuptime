import {
  AiRemediationCommand,
  AiRemediationCommandDryRun,
  AiRemediationCommandPlan,
  AiRemediationDryRunStatus,
  MAX_PLAN_COMMANDS,
} from "../../Types/AutoRemediation/AiRemediationCommandPlan";
import ObjectID from "../../Types/ObjectID";
import { isCloudAiResourceType } from "../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import {
  CLOUD_DRY_RUN_OPERATION_NAME,
  CLOUD_PROGRAM,
  CloudCatalogProvider,
  CloudCommandParse,
  getCloudCatalogProvider,
  isCloudChangeOperation,
  parseCloudCommand,
} from "./Resource/CloudOperationCatalog";
import {
  renderResourceDisplayCommand,
  tokenizeResourceCommand,
} from "./Resource/ResourceCommandPolicyCore";

/*
 * What the dry runs of a fix's cloud changes read off its plan - pure, so
 * the server that runs them (Server/Utils/AutoRemediation/CloudChangeDryRun)
 * and the Remediation card that shows them read a plan the same way.
 *
 * A dry run checks a cloud change the way the account's Cloud AI agent
 * would make it, without making it (`cloud dry-run <change>`,
 * CloudOperationCatalog). It is asked for the changes a plan proposes for
 * approval: ResourceCommand steps on a cloud account that change something
 * and have not run.
 */

/*
 * A dry run still Running this long after it was asked for will not answer
 * (the server that asked went away): it reads as Failed, and may be asked
 * again.
 */
export const CLOUD_DRY_RUN_STALE_AFTER_MS: number = 5 * 60_000;

/*
 * The dry run of a cloud change - `cloud dry-run <change>`, the change's
 * canonical argv after "dry-run" - or null when the command is no change of
 * this cloud the catalog reads (a read, whoami, a dry run already, or not a
 * cloud command at all).
 */
export function getCloudDryRunCommandText(data: {
  resourceType: unknown;
  command: string;
}): string | null {
  const provider: CloudCatalogProvider | null = getCloudCatalogProvider(
    data.resourceType,
  );
  const argv: Array<string> | undefined = tokenizeResourceCommand(
    data.command,
  ).argv;

  if (!provider || !argv) {
    return null;
  }

  const parse: CloudCommandParse = parseCloudCommand(provider, argv);

  if (
    !parse.ok ||
    parse.command.dryRunOf ||
    !isCloudChangeOperation(parse.command.operation)
  ) {
    return null;
  }

  return renderResourceDisplayCommand([
    CLOUD_PROGRAM,
    CLOUD_DRY_RUN_OPERATION_NAME,
    ...parse.command.canonicalArgs,
  ]);
}

/*
 * The change a cloud dry run checks, as its own command and tier, or null
 * when the command is no dry run.
 */
export function readCloudDryRunChange(data: {
  resourceType: unknown;
  command: string;
}): { command: string; tier: ResourceCommandTier } | null {
  const provider: CloudCatalogProvider | null = getCloudCatalogProvider(
    data.resourceType,
  );
  const argv: Array<string> | undefined = tokenizeResourceCommand(
    data.command,
  ).argv;

  if (!provider || !argv) {
    return null;
  }

  const parse: CloudCommandParse = parseCloudCommand(provider, argv);

  if (!parse.ok || !parse.command.dryRunOf) {
    return null;
  }

  return {
    command: renderResourceDisplayCommand([
      CLOUD_PROGRAM,
      ...parse.command.dryRunOf.canonicalArgs,
    ]),
    tier: parse.command.dryRunOf.kindSpec.tier,
  };
}

// The steps of a plan a dry run checks: cloud changes that have not run.
export function getCloudChangesToDryRun(
  plan: AiRemediationCommandPlan | null,
): Array<AiRemediationCommand> {
  if (!plan) {
    return [];
  }

  return plan.commands
    .filter((command: AiRemediationCommand): boolean => {
      return (
        command.stepType === RunbookStepType.ResourceCommand &&
        isCloudAiResourceType(command.resourceType) &&
        ObjectID.isValidUUID(command.resourceId || "") &&
        command.resourceCommandTier !== ResourceCommandTier.Read &&
        command.execution === undefined &&
        getCloudDryRunCommandText({
          resourceType: command.resourceType,
          command: command.command,
        }) !== null
      );
    })
    .slice(0, MAX_PLAN_COMMANDS);
}

/*
 * A dry run's status as it reads now: Running past CLOUD_DRY_RUN_STALE_
 * AFTER_MS is Failed (it will not answer).
 */
export function getEffectiveDryRunStatus(
  dryRun: AiRemediationCommandDryRun,
  now: Date,
): AiRemediationDryRunStatus {
  if (dryRun.status !== AiRemediationDryRunStatus.Running) {
    return dryRun.status;
  }

  const askedAt: number = new Date(dryRun.checkedAt).getTime();

  return Number.isFinite(askedAt) &&
    now.getTime() - askedAt > CLOUD_DRY_RUN_STALE_AFTER_MS
    ? AiRemediationDryRunStatus.Failed
    : AiRemediationDryRunStatus.Running;
}

// Whether a dry run of one of the plan's changes is on its way now.
export function isCloudDryRunInFlight(
  plan: AiRemediationCommandPlan | null,
  now: Date,
): boolean {
  return getCloudChangesToDryRun(plan).some(
    (command: AiRemediationCommand): boolean => {
      return (
        command.dryRun !== undefined &&
        getEffectiveDryRunStatus(command.dryRun, now) ===
          AiRemediationDryRunStatus.Running
      );
    },
  );
}
