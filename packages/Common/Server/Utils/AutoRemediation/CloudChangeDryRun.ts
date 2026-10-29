import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  AiRemediationCommand,
  AiRemediationCommandDryRun,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationDryRunStatus,
  MAX_DRY_RUN_SUMMARY_CHARS,
  MAX_PLAN_COMMANDS,
  getDryRunCommandStepId,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import {
  CloudDryRunVerdict,
  readCloudDryRunVerdict,
  readCloudReplacedValue,
  withoutCloudDryRunVerdict,
} from "../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import AutoRemediationSuggestionService from "../../Services/AutoRemediationSuggestionService";
import {
  CLOUD_DRY_RUN_STALE_AFTER_MS,
  getCloudChangesToDryRun,
  getCloudDryRunCommandText,
  getEffectiveDryRunStatus,
} from "../../../Utils/AiRemediation/CloudChangeDryRunPlan";
import ResourceCommandJobRunner, {
  ResourceCommandJobOutcome,
} from "../AI/ResourceAccess/ResourceCommandJobRunner";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * DRY RUNS OF THE CLOUD CHANGES A FIX PROPOSES.
 *
 * Before a person approves a fix that changes a cloud account - an AWS
 * account, an Azure subscription, a Google Cloud project - OneUptime asks
 * the account's Cloud AI agent to dry-run each change it proposes
 * (`cloud dry-run <change>`, CloudOperationCatalog): the agent checks the
 * change the way it would make it and reads the value it would replace,
 * then stops before the call that makes it. The Remediation card shows the
 * answer beside the change (AiRemediationCommand.dryRun): that it would
 * run, replacing which value, and how it would be undone - or why it would
 * be refused. A person approves knowing what will happen, not guessing.
 *
 * It runs on its own once a fix is proposed (RemediationExecutionRunner),
 * and again when a person asks (Dry run again: POST /auto-remediation/
 * dry-run, which answers once the changes are marked as being checked).
 * Either way:
 *
 *  - only a plan that waits for approval (Suggested) is dry-run, and an
 *    answer is written only while it still waits: one conditional write
 *    per answer (attemptStatusTransition from Suggested to Suggested), so
 *    an approval or a dismissal in between always wins and the dry run's
 *    answer is dropped - it never overwrites what the run of the plan
 *    records;
 *  - one dry run of a suggestion at a time, across pods (a lock): a second
 *    ask while one runs is told so;
 *  - each change once, in sequence, at most MAX_PLAN_COMMANDS of them, as
 *    a job of the fix (origin AiRemediation, step id ai-dry-run-<n>) that
 *    the enqueue chokepoint holds to every rule a fix's job meets - Enable
 *    AI, the account's fixes, its agent, the inventory - and to a brake of
 *    its own, so dry runs never spend the brake the fixes need;
 *  - it changes nothing, and never throws: what it did is what it returns.
 */

// The pure half, for callers of this module.
export {
  CLOUD_DRY_RUN_STALE_AFTER_MS,
  getCloudChangesToDryRun,
  getEffectiveDryRunStatus,
};

// How long one change's dry run may take on the agent.
export const CLOUD_DRY_RUN_TIMEOUT_MS: number = 60_000;

// How long the agent has to claim it.
export const CLOUD_DRY_RUN_CLAIM_TIMEOUT_MS: number = 60_000;

// How long the lock of one suggestion's dry run lasts at most.
const DRY_RUN_LOCK_TIMEOUT_MS: number =
  MAX_PLAN_COMMANDS *
    (CLOUD_DRY_RUN_TIMEOUT_MS + CLOUD_DRY_RUN_CLAIM_TIMEOUT_MS) +
  30_000;

export type CloudDryRunOutcome =
  // These changes were dry-run, and their answers written.
  | { kind: "checked"; checked: number }
  // The plan proposes no cloud change a dry run can check.
  | { kind: "nothing-to-check" }
  // It is no longer waiting for approval (approved, dismissed, gone).
  | { kind: "not-awaiting-approval" }
  // Another dry run of it is running.
  | { kind: "busy" };

// What startDryRun did before it answered.
export type CloudDryRunStart =
  // Every change is marked as being checked; the answers come in the background.
  | { kind: "started"; changes: number }
  | { kind: "nothing-to-check" }
  | { kind: "not-awaiting-approval" }
  // Another dry run of it is running, and marked its changes already.
  | { kind: "busy" };

// A suggestion's cloud changes, marked as being checked, or why not.
type MarkedDryRun =
  | {
      kind: "marked";
      suggestion: AutoRemediationSuggestion;
      changes: Array<AiRemediationCommand>;
    }
  | { kind: "nothing-to-check" }
  | { kind: "not-awaiting-approval" };

// Text held to the plan's cap, cut at a line where one fits.
function capSummary(text: string): string {
  const trimmed: string = text.trim();

  if (trimmed.length <= MAX_DRY_RUN_SUMMARY_CHARS) {
    return trimmed;
  }

  const head: string = trimmed.slice(0, MAX_DRY_RUN_SUMMARY_CHARS - 1);
  const newline: number = head.lastIndexOf("\n");

  return `${newline > 0 ? head.slice(0, newline) : head}…`;
}

// The machine lines of a would-run answer: its replaced value.
function withoutReplacedValueLine(text: string): string {
  if (!text.startsWith("oneuptime-replaced-value: ")) {
    return text;
  }

  const end: number = text.indexOf("\n");

  return end < 0 ? "" : text.slice(end + 1);
}

/*
 * The agent's first sentence of a dry run's answer ("Dry run: nothing was
 * changed. <change> would run, replacing count 2." or "... would be
 * refused: <why>"). The card says the first part itself, in the reader's
 * language, so a would-run answer keeps the lines after it (the call it
 * would make, how it would be undone) and a would-be-refused one the why.
 */
const DRY_RUN_LEAD: string = "Dry run: nothing was changed.";
const WOULD_BE_REFUSED: string = " would be refused: ";

function splitFirstLine(text: string): { first: string; rest: string } {
  const end: number = text.indexOf("\n");

  return end < 0
    ? { first: text, rest: "" }
    : { first: text.slice(0, end), rest: text.slice(end + 1) };
}

// The lines after the agent's first sentence, when it is the dry run's lead.
function withoutLeadSentence(text: string): string {
  const lines: { first: string; rest: string } = splitFirstLine(text);

  return lines.first.startsWith(DRY_RUN_LEAD) ? lines.rest : text;
}

// Why a change would be refused, as the agent's first sentence says it.
function refusalReason(text: string): string {
  const lines: { first: string; rest: string } = splitFirstLine(text);
  const at: number = lines.first.indexOf(WOULD_BE_REFUSED);

  if (!lines.first.startsWith(DRY_RUN_LEAD) || at < 0) {
    return text;
  }

  const reason: string = lines.first.slice(at + WOULD_BE_REFUSED.length);

  return lines.rest ? `${reason}\n${lines.rest}` : reason;
}

// What an agent older than dry runs says (its catalog knows no "dry-run").
const OLD_AGENT_REFUSAL: string = '"dry-run" is not a cloud operation';

export const OLD_AGENT_DRY_RUN_SUMMARY: string =
  "This Cloud AI agent is older than dry runs, so it cannot check a change before it is approved. Start it again on its newest image (Change, on the account's AI agent page) to see what each fix would do before you approve it.";

/*
 * One finished dry-run job, read into the record the card shows: the
 * verdict the agent's first line gives, what would be replaced, and the
 * agent's own sentences. A job that failed, or answered without a
 * verdict, is a dry run that could not answer.
 */
export function readCloudDryRunOutcome(data: {
  outcome: ResourceCommandJobOutcome;
  checkedAt: Date;
}): AiRemediationCommandDryRun {
  const { outcome } = data;
  const checkedAt: string = data.checkedAt.toISOString();
  const verdict: CloudDryRunVerdict | null = outcome.succeeded
    ? readCloudDryRunVerdict(outcome.output)
    : null;

  if (verdict === "would-run") {
    const rest: string = withoutCloudDryRunVerdict(outcome.output);
    const replaced: Record<string, string> = readCloudReplacedValue(rest);

    return {
      status: AiRemediationDryRunStatus.WouldRun,
      checkedAt,
      summary: capSummary(withoutLeadSentence(withoutReplacedValueLine(rest))),
      ...(Object.keys(replaced).length > 0 ? { replaced } : {}),
      runnerJobId: outcome.jobId,
    };
  }

  if (verdict === "would-be-refused") {
    return {
      status: AiRemediationDryRunStatus.WouldBeRefused,
      checkedAt,
      summary: capSummary(
        refusalReason(withoutCloudDryRunVerdict(outcome.output)),
      ),
      runnerJobId: outcome.jobId,
    };
  }

  const message: string = outcome.succeeded
    ? "The Cloud AI agent answered without a dry run's verdict. Run the agent image version that matches your OneUptime server."
    : outcome.errorMessage || "The dry run did not finish.";

  return {
    status: AiRemediationDryRunStatus.Failed,
    checkedAt,
    summary: capSummary(
      message.includes(OLD_AGENT_REFUSAL) ? OLD_AGENT_DRY_RUN_SUMMARY : message,
    ),
    runnerJobId: outcome.jobId,
  };
}

export default class CloudChangeDryRun {
  /*
   * Once a fix is proposed for approval: dry-run its cloud changes in the
   * background, if it has any. Never throws, never waits.
   */
  public static startForProposedPlan(data: {
    suggestionId: ObjectID;
    plan: AiRemediationCommandPlan | null;
  }): void {
    if (getCloudChangesToDryRun(data.plan).length === 0) {
      return;
    }

    CloudChangeDryRun.dryRunSuggestion({
      suggestionId: data.suggestionId,
    }).catch((error: unknown) => {
      logger.error(
        `CloudChangeDryRun: the dry run of proposed suggestion ${data.suggestionId.toString()} failed: ${error}`,
      );
    });
  }

  /*
   * Dry-run every cloud change of a suggestion that waits for approval,
   * writing each answer onto its step as it comes. Never throws.
   */
  @CaptureSpan()
  public static async dryRunSuggestion(data: {
    suggestionId: ObjectID;
  }): Promise<CloudDryRunOutcome> {
    const lock: { mutex: SemaphoreMutex } | null = await this.lockSuggestion(
      data.suggestionId,
    );

    if (!lock) {
      // Held: another dry run of this suggestion is running.
      return { kind: "busy" };
    }

    try {
      const marked: MarkedDryRun = await this.markHeld(data.suggestionId);

      if (marked.kind !== "marked") {
        return marked;
      }

      return await this.checkHeld({
        suggestionId: data.suggestionId,
        suggestion: marked.suggestion,
        changes: marked.changes,
      });
    } catch (error) {
      logger.error(
        `CloudChangeDryRun: the dry run of suggestion ${data.suggestionId.toString()} failed: ${error}`,
      );
      return { kind: "checked", checked: 0 };
    } finally {
      await this.releaseLock(lock.mutex);
    }
  }

  /*
   * A dry run a person asked for (Dry run again): it answers once every
   * change is marked as being checked, so the card's read right after the
   * click already shows the dry run on its way - and keeps polling until
   * the answers land. Answering before the mark, the card could read the
   * plan as it was, show the old answer and stop polling. The dry runs
   * themselves go on in the background, holding the lock until they end.
   * Throws only when the suggestion could not be read or marked.
   */
  @CaptureSpan()
  public static async startDryRun(data: {
    suggestionId: ObjectID;
  }): Promise<CloudDryRunStart> {
    const lock: { mutex: SemaphoreMutex } | null = await this.lockSuggestion(
      data.suggestionId,
    );

    if (!lock) {
      // Another dry run of it holds the suggestion, and marked it already.
      return { kind: "busy" };
    }

    let isHandedOff: boolean = false;

    try {
      const marked: MarkedDryRun = await this.markHeld(data.suggestionId);

      if (marked.kind !== "marked") {
        return marked;
      }

      isHandedOff = true;

      this.checkHeld({
        suggestionId: data.suggestionId,
        suggestion: marked.suggestion,
        changes: marked.changes,
      })
        .catch((error: unknown): void => {
          logger.error(
            `CloudChangeDryRun: the dry run of suggestion ${data.suggestionId.toString()} failed: ${error}`,
          );
        })
        .finally((): Promise<void> => {
          return this.releaseLock(lock.mutex);
        })
        .catch((): void => {
          // releaseLock never throws.
        });

      return { kind: "started", changes: marked.changes.length };
    } finally {
      if (!isHandedOff) {
        await this.releaseLock(lock.mutex);
      }
    }
  }

  // The lock of one suggestion's dry run, or null while another holds it.
  private static async lockSuggestion(
    suggestionId: ObjectID,
  ): Promise<{ mutex: SemaphoreMutex } | null> {
    try {
      const mutex: SemaphoreMutex = await Semaphore.lock({
        key: `cloud-dry-run-${suggestionId.toString()}`,
        namespace: "CloudChangeDryRun",
        lockTimeout: DRY_RUN_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
        onLockLost: (error: Error): void => {
          logger.warn(
            `CloudChangeDryRun: lost the lock of suggestion ${suggestionId.toString()}'s dry run: ${error.message}`,
          );
        },
      });

      return { mutex };
    } catch {
      return null;
    }
  }

  private static async releaseLock(mutex: SemaphoreMutex): Promise<void> {
    try {
      await Semaphore.release(mutex);
    } catch {
      // It runs out on its own.
    }
  }

  /*
   * Under the lock: every cloud change of a suggestion that still waits
   * for approval marked as being checked, in one write, before any is.
   */
  private static async markHeld(suggestionId: ObjectID): Promise<MarkedDryRun> {
    const suggestion: AutoRemediationSuggestion | null =
      await this.loadWaiting(suggestionId);

    if (!suggestion) {
      return { kind: "not-awaiting-approval" };
    }

    const plan: AiRemediationCommandPlan | null =
      AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);
    const changes: Array<AiRemediationCommand> = getCloudChangesToDryRun(plan);

    if (!plan || changes.length === 0) {
      return { kind: "nothing-to-check" };
    }

    // Each change says it is being checked, before any of them is.
    const askedAt: Date = OneUptimeDate.getCurrentDate();
    const marked: boolean = await this.writeDryRuns({
      suggestionId,
      dryRuns: changes.map(
        (
          change: AiRemediationCommand,
        ): {
          change: AiRemediationCommand;
          dryRun: AiRemediationCommandDryRun;
        } => {
          return {
            change,
            dryRun: {
              status: AiRemediationDryRunStatus.Running,
              checkedAt: askedAt.toISOString(),
            },
          };
        },
      ),
    });

    if (!marked) {
      return { kind: "not-awaiting-approval" };
    }

    return { kind: "marked", suggestion, changes };
  }

  /*
   * Under the lock, once marked: each change dry-run in turn, its answer
   * written onto its step as it comes, while the suggestion still waits.
   */
  private static async checkHeld(data: {
    suggestionId: ObjectID;
    suggestion: AutoRemediationSuggestion;
    changes: Array<AiRemediationCommand>;
  }): Promise<CloudDryRunOutcome> {
    const { suggestionId, suggestion, changes } = data;
    let checked: number = 0;

    for (const change of changes) {
      const dryRun: AiRemediationCommandDryRun = await this.dryRunOne({
        suggestion,
        change,
      });

      const written: boolean = await this.writeDryRuns({
        suggestionId,
        dryRuns: [{ change, dryRun }],
      });

      if (!written) {
        // Approved or dismissed meanwhile: what is left is not asked.
        return checked > 0
          ? { kind: "checked", checked }
          : { kind: "not-awaiting-approval" };
      }

      checked++;
    }

    return { kind: "checked", checked };
  }

  // The suggestion, read as root, while it waits for approval; else null.
  private static async loadWaiting(
    suggestionId: ObjectID,
  ): Promise<AutoRemediationSuggestion | null> {
    const suggestion: AutoRemediationSuggestion | null =
      await AutoRemediationSuggestionService.findOneById({
        id: suggestionId,
        select: {
          _id: true,
          projectId: true,
          status: true,
          suggestionType: true,
          commandPlan: true,
        },
        props: { isRoot: true },
      });

    if (
      !suggestion ||
      !suggestion.projectId ||
      suggestion.status !== AutoRemediationSuggestionStatus.Suggested ||
      suggestion.suggestionType !== AutoRemediationSuggestionType.CommandPlan
    ) {
      return null;
    }

    return suggestion;
  }

  // One change's dry run, through the enqueue chokepoint and its agent.
  private static async dryRunOne(data: {
    suggestion: AutoRemediationSuggestion;
    change: AiRemediationCommand;
  }): Promise<AiRemediationCommandDryRun> {
    const { suggestion, change } = data;
    const checkedAt: Date = OneUptimeDate.getCurrentDate();
    const command: string | null = getCloudDryRunCommandText({
      resourceType: change.resourceType,
      command: change.command,
    });

    if (!command || !change.resourceType || !change.resourceId) {
      return {
        status: AiRemediationDryRunStatus.Failed,
        checkedAt: checkedAt.toISOString(),
        summary: "This change cannot be dry-run.",
      };
    }

    try {
      const outcome: ResourceCommandJobOutcome =
        await ResourceCommandJobRunner.run({
          projectId: suggestion.projectId!,
          origin: RunnerJobOrigin.AiRemediation,
          autoRemediationSuggestionId: suggestion.id!,
          resourceType: change.resourceType,
          resourceId: new ObjectID(change.resourceId),
          // The agent the plan was composed for: approving needs it too.
          ...(ObjectID.isValidUUID(change.runnerId)
            ? { targetResourceAiAgentId: new ObjectID(change.runnerId) }
            : {}),
          command,
          stepId: getDryRunCommandStepId(change),
          timeoutInMs: Math.min(
            CLOUD_DRY_RUN_TIMEOUT_MS,
            change.timeoutInMs || CLOUD_DRY_RUN_TIMEOUT_MS,
          ),
          claimTimeoutInMs: CLOUD_DRY_RUN_CLAIM_TIMEOUT_MS,
        });

      return readCloudDryRunOutcome({ outcome, checkedAt });
    } catch (error) {
      // Refused before it was sent (Enable AI, fixes, the agent, the inventory, the brake).
      return {
        status: AiRemediationDryRunStatus.Failed,
        checkedAt: checkedAt.toISOString(),
        summary: capSummary(
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  }

  /*
   * Write dry runs onto the plan as it stands now - only on the steps they
   * are for (same sequence, same command), and only while it still waits
   * for approval. False when it no longer does.
   */
  private static async writeDryRuns(data: {
    suggestionId: ObjectID;
    dryRuns: Array<{
      change: AiRemediationCommand;
      dryRun: AiRemediationCommandDryRun;
    }>;
  }): Promise<boolean> {
    const current: AutoRemediationSuggestion | null = await this.loadWaiting(
      data.suggestionId,
    );
    const plan: AiRemediationCommandPlan | null = current
      ? AiRemediationCommandPlanUtil.parse(current.commandPlan)
      : null;

    if (!current || !plan) {
      return false;
    }

    for (const entry of data.dryRuns) {
      const step: AiRemediationCommand | undefined = plan.commands.find(
        (command: AiRemediationCommand): boolean => {
          return (
            command.sequence === entry.change.sequence &&
            command.command === entry.change.command &&
            command.execution === undefined
          );
        },
      );

      if (step) {
        step.dryRun = entry.dryRun;
      }
    }

    const written: number =
      await AutoRemediationSuggestionService.attemptStatusTransition({
        suggestionId: data.suggestionId,
        fromStatus: AutoRemediationSuggestionStatus.Suggested,
        set: {
          status: AutoRemediationSuggestionStatus.Suggested,
          commandPlan: AiRemediationCommandPlanUtil.toJSON(plan),
        },
      });

    return written > 0;
  }
}
