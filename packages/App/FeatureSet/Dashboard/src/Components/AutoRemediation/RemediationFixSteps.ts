import { getRemediationReasoningPreview } from "./RemediationReasoning";
import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionState,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationPlanExecutionStatus,
  AiRemediationRollbackStatus,
  isRemovedSshCommand,
} from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationApprovalSource, {
  readRemediationApprovalSource,
} from "Common/Types/AutoRemediation/AutoRemediationApprovalSource";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "Common/Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "Common/Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "Common/Types/AutoRemediation/ExternalMcpToolCallPlan";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  getRiskierRemediationCommands,
  isSameApprover,
} from "Common/Types/AutoRemediation/RemediationApprovals";
import { isAiResourceType } from "Common/Types/ResourceAiAgent/AiResourceType";
import { getResourceSentenceName } from "Common/Types/AI/ResourceAiAccessPermissions";
import {
  composedValue,
  formatList,
  getGlobalTranslator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  REMEDIATION_FIX_STEP_COPY,
  REMEDIATION_ROUND_COPY,
  REMEDIATION_TWO_APPROVALS_COPY,
} from "./RemediationStepCopy";
import {
  getRemediationRoundRetryWait,
  hasRemediationRoundDetails,
  isRemediationRoundUnfinished,
  RemediationRoundView,
} from "./RemediationRoundView";
import {
  describeAiRunFailureCause,
  describeAttemptEnd,
  readAiRunFailure,
} from "../AI/AiRunFailureWords";
import { AIRunAttemptEnd } from "Common/Types/AI/AIRunAttempt";

/*
 * A FIX ON THE AI CARD'S REMEDIATION STEP, STEP BY STEP (issue #5598).
 *
 * "It is currently extremely complicated to understand what's going on.
 * Ideally it should be in steps where you have step by step sections on
 * what AI did and why, and when I expand the step - it shows me more
 * context into why, commands ran, outputs." A fix drew its status facts,
 * its verification's note, its reasoning, and every command with its
 * policy facts, exit code, output, undo and undo's outcome as one block,
 * with "Plan execution: Completed" and "Rollback status: Completed" under
 * it: the order things happened in - planned, approved, ran, checked,
 * rolled back - was left for the reader to piece together.
 *
 * Here one fix (an AutoRemediationSuggestion) becomes the steps it went
 * through, in the order they happened, each one line: where it stands (a
 * mark), what OneUptime AI did in a few words, when, and - where there is
 * one - why, or what went wrong:
 *
 *   plan     - OneUptime AI worked the fix out: the commands it planned and
 *              where, the changes through which MCP servers, the runbook it
 *              picked - or that it found none. Opens to its reasoning and
 *              what each command does and why.
 *   approval - it waits for the reader, a person approved or dismissed it,
 *              or it was allowed to run without asking. A riskier fix two
 *              people must approve (RemediationApprovals) reads its first
 *              approval as a step of its own (firstApproval), before the
 *              one that waits for, or gave, the second.
 *   run      - its commands ran, its changes were made, its runbook was
 *              started. Opens to each command as it ran: exit code, error,
 *              output.
 *   verify   - OneUptime watched whether the incident or alert recovered.
 *   rollback - what ran was undone because it did not. Opens to each undo
 *              as it ran.
 *
 * Only what happened, and what is happening now, is a step: nothing waits
 * in grey for a step a fix may never take (a fix that runs without asking
 * has no approval to wait for).
 *
 * React-free, so App's tests can read it; RemediationStep draws it
 * (RemediationFixStepList).
 */

export type RemediationFixStepKind =
  | "plan"
  | "firstApproval"
  | "approval"
  | "run"
  | "verify"
  | "rollback";

/*
 * How a step went, named by meaning: drawn with the AI card's step marks
 * (AiCardStep), so a fix's steps read the way the card's own two do.
 */
export type RemediationFixStepTone =
  | "done"
  | "live"
  | "attention"
  | "failed"
  | "idle";

export interface RemediationFixStep {
  kind: RemediationFixStepKind;
  tone: RemediationFixStepTone;
  // What OneUptime AI did, in the reader's language.
  title: string;
  /*
   * Why, or what went wrong, under the title: in the reader's language, or
   * - isSummaryWritten - what OneUptime AI, an agent or the verifier wrote,
   * which reads in its own direction.
   */
  summary: string | null;
  isSummaryWritten: boolean;
  /*
   * The summary is said again, whole, where the step opens - as a written
   * summary always is - so the open step leaves it out: a round that
   * stopped says why in its notice (issue #6436).
   */
  isSummaryInDetails?: boolean | undefined;
  // When it happened, when that is known.
  at: Date | null;
  // It opens to more: the reasoning, the commands, their output.
  hasDetails: boolean;
}

/*
 * What a plan or a list of changes that cannot be read says, in the words
 * the step said it in before it read as steps.
 */
const COMMANDS_NOT_SHOWN: string = translationKey(
  "The command plan could not be displayed.",
);
const CHANGES_NOT_SHOWN: string = translationKey(
  "The changes of this fix could not be shown.",
);

/*
 * Where a command runs, as the card's command row names it: the cluster of
 * a kubectl step ("cluster prod-east"), the resource of a resource command
 * ("host web-1", "Docker host web-1"), the Runner of a Bash or SSH step.
 * The plan's sentence lists the same ("Planned 2 commands on host web-1"),
 * so the kind of resource is its name for the middle of a sentence, cased
 * and worded the reader's way (#7862).
 */
export function getCommandTargetLabel(
  command: Pick<
    AiRemediationCommand,
    | "stepType"
    | "kubernetesClusterNameSnapshot"
    | "resourceType"
    | "resourceNameSnapshot"
    | "runnerNameSnapshot"
  >,
  translator: Translator = getGlobalTranslator(),
): string {
  const unknownName: string = translator.translateText("(unknown)") as string;

  if (command.stepType === RunbookStepType.Kubectl) {
    return translator.translateTemplate("cluster {{name}}", {
      name: command.kubernetesClusterNameSnapshot || unknownName,
    });
  }

  if (command.stepType === RunbookStepType.ResourceCommand) {
    // The kind of resource, then its name: "host web-1", "Docker host web-1".
    const kind: string = translator.translateTerm(
      isAiResourceType(command.resourceType)
        ? getResourceSentenceName(command.resourceType)
        : translationKey("resource"),
      { inSentence: true },
    );

    return `${kind} ${command.resourceNameSnapshot || unknownName}`;
  }

  return command.runnerNameSnapshot;
}

/*
 * The step-type chip of a command row: "kubectl" for a kubectl step, the
 * program a resource command runs ("docker", "systemctl", "pvesh", ...), the
 * step type otherwise.
 */
export function getCommandStepLabel(
  command: Pick<AiRemediationCommand, "stepType" | "command">,
): string {
  if (command.stepType === RunbookStepType.Kubectl) {
    return "kubectl";
  }

  if (command.stepType === RunbookStepType.ResourceCommand) {
    return (command.command || "").trim().split(/\s+/)[0] || "command";
  }

  return command.stepType;
}

/*
 * The program chip a command row draws beside where it runs, or null when
 * the command shown under it already starts with that program: "kubectl"
 * over "kubectl rollout restart ..." said the same word twice in one row.
 * A Bash or SSH step keeps its chip - its command does not say what runs it.
 */
export function getCommandProgramChip(
  command: Pick<AiRemediationCommand, "stepType" | "command">,
): string | null {
  const program: string = getCommandStepLabel(command);
  const firstWord: string =
    (command.command || "").trim().split(/\s+/)[0] || "";

  return firstWord === program ? null : program;
}

// Each name once, in the order it first came; an empty one is left out.
function getDistinctNames(names: Array<string>): Array<string> {
  return Array.from(
    new Set<string>(
      names.filter((name: string): boolean => {
        return Boolean(name);
      }),
    ),
  );
}

// The last two names of a list a sentence reads: "a, b and c".
const NAMES_AND_LAST: string = translationKey("{{items}} and {{last}}");

/*
 * Names as a sentence lists them, each once, in the words of the sentence's
 * language: "prod-east", "Feature flags and Status page", "a, b and c" - a
 * clause, so the last two are joined as the language joins them, not by a
 * comma alone. Each is set apart where it could move the words around it (a
 * name in Latin letters in a Persian sentence), so the list reads in its
 * order right to left too. A name that is not known reads "(unknown)".
 */
function getNamesInSentence(
  names: Array<string>,
  sentenceTranslator: Translator,
): string {
  const unknownName: string =
    sentenceTranslator.translateText("(unknown)") || "(unknown)";
  const distinct: Array<string> = getDistinctNames(
    names.map((name: string): string => {
      return name || unknownName;
    }),
  );

  if (distinct.length <= 1) {
    return distinct[0] || unknownName;
  }

  return sentenceTranslator.translateTemplate(
    NAMES_AND_LAST,
    {
      items: formatList(distinct.slice(0, -1), sentenceTranslator),
      last: distinct[distinct.length - 1]!,
    },
    { setsValuesApart: true },
  );
}

/*
 * What OneUptime AI planned, as a fix's first step says it: how many
 * commands it runs and where - "Planned 2 commands on cluster
 * prod-eu-west-1" - or how many changes it makes and through which MCP
 * servers ("... through Feature flags and Status page"). It says the same
 * whether the fix waits, ran or was dismissed: the steps after it say what
 * came of it. Null for a fix with no commands or changes to count: a
 * runbook, one still being worked out, one whose commands cannot be read.
 */
export function getRemediationFixSentence(data: {
  plan: AiRemediationCommandPlan | null;
  mcpPlan: ExternalMcpToolCallPlan | null;
  translator?: Translator | undefined;
}): string | null {
  const translator: Translator = data.translator || getGlobalTranslator();

  if (data.plan && data.plan.commands.length > 0) {
    const commands: Array<AiRemediationCommand> = data.plan.commands;

    return translator.translatePlural(
      REMEDIATION_FIX_STEP_COPY.planCommands,
      commands.length,
      {
        // Where they run, each once, in the words of the sentence's language.
        targets: composedValue((sentenceTranslator: Translator): string => {
          return getNamesInSentence(
            commands.map((command: AiRemediationCommand): string => {
              return getCommandTargetLabel(command, sentenceTranslator);
            }),
            sentenceTranslator,
          );
        }),
      },
      { setsValuesApart: true },
    );
  }

  if (data.mcpPlan && data.mcpPlan.calls.length > 0) {
    const calls: Array<ExternalMcpToolCall> = data.mcpPlan.calls;

    return translator.translatePlural(
      REMEDIATION_FIX_STEP_COPY.planChanges,
      calls.length,
      {
        // The servers, each once, by the names the project gave them.
        servers: composedValue((sentenceTranslator: Translator): string => {
          return getNamesInSentence(
            calls.map((call: ExternalMcpToolCall): string => {
              return call.serverNameSnapshot;
            }),
            sentenceTranslator,
          );
        }),
      },
      { setsValuesApart: true },
    );
  }

  return null;
}

/*
 * How many of a fix's commands or changes failed: a command, or its undo,
 * that failed, and a change a server did not make. Said in red beside where
 * the fix stands, so no failure is ever only inside a step that is closed.
 */
export function getRemediationFixFailedCount(data: {
  plan: AiRemediationCommandPlan | null;
  mcpPlan: ExternalMcpToolCallPlan | null;
}): number {
  const failedCommands: number = (data.plan?.commands || []).filter(
    (command: AiRemediationCommand): boolean => {
      return (
        command.execution?.status ===
          AiRemediationCommandExecutionStatus.Failed ||
        command.rollbackExecution?.status ===
          AiRemediationCommandExecutionStatus.Failed
      );
    },
  ).length;
  const failedChanges: number = (data.mcpPlan?.calls || []).filter(
    (call: ExternalMcpToolCall): boolean => {
      return call.status === ExternalMcpToolCallStatus.Failed;
    },
  ).length;

  return failedCommands + failedChanges;
}

// A moment the server or an agent recorded, or null when it is not one.
export function readRemediationMoment(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date: Date =
    value instanceof Date ? value : new Date(value as string | number);

  return Number.isFinite(date.getTime()) ? date : null;
}

// The earliest of the moments that are known.
function getEarliest(values: Array<unknown>): Date | null {
  let earliest: Date | null = null;

  for (const value of values) {
    const date: Date | null = readRemediationMoment(value);

    if (date && (!earliest || date.getTime() < earliest.getTime())) {
      earliest = date;
    }
  }

  return earliest;
}

// The latest of the moments that are known.
function getLatest(values: Array<unknown>): Date | null {
  let latest: Date | null = null;

  for (const value of values) {
    const date: Date | null = readRemediationMoment(value);

    if (date && (!latest || date.getTime() > latest.getTime())) {
      latest = date;
    }
  }

  return latest;
}

// Who approved or dismissed a fix, by name, else by email.
function getPersonName(
  user:
    | {
        name?: { toString: () => string } | string | undefined;
        email?: { toString: () => string } | string | undefined;
      }
    | undefined,
): string {
  return user?.name?.toString() || user?.email?.toString() || "";
}

/*
 * What a fix's reasoning says, as one line of words under its first step:
 * the answer's summary, read in full once the step is opened - without the
 * report's heading and footer the round posted it in (issue #6860).
 */
function getReasoningPreview(markdown: string | undefined): string | null {
  return getRemediationReasoningPreview(markdown);
}

// How an approval reads, by where it was made: who approved it, and alone.
interface ApprovalWords {
  byName: string;
  alone: string;
}

/*
 * An approval from the fix's Slack or Microsoft Teams message says so
 * beside who made it, as the record's feed does; one on the card - or one
 * made before where was kept - reads as it always has.
 */
function getApprovalWords(
  source: AutoRemediationApprovalSource | undefined,
): ApprovalWords {
  if (source === AutoRemediationApprovalSource.Slack) {
    return {
      byName: REMEDIATION_FIX_STEP_COPY.approvedByInSlack,
      alone: REMEDIATION_FIX_STEP_COPY.approvedInSlack,
    };
  }

  if (source === AutoRemediationApprovalSource.MicrosoftTeams) {
    return {
      byName: REMEDIATION_FIX_STEP_COPY.approvedByInTeams,
      alone: REMEDIATION_FIX_STEP_COPY.approvedInTeams,
    };
  }

  return {
    byName: REMEDIATION_FIX_STEP_COPY.approvedBy,
    alone: REMEDIATION_FIX_STEP_COPY.approved,
  };
}

export type RemediationFixStepSuggestion = Pick<
  AutoRemediationSuggestion,
  | "status"
  | "suggestionType"
  | "commandPlan"
  | "mcpToolCallPlan"
  | "rationaleMarkdown"
  | "verificationStatus"
  | "verificationNote"
  | "verificationWindowMinutes"
  | "verificationCompletedAt"
  | "approvedAt"
  | "approvedByUser"
  | "approvedByUserId"
  | "approvedFrom"
  | "firstApprovedAt"
  | "firstApprovedByUser"
  | "firstApprovedByUserId"
  | "firstApprovedFrom"
  | "dismissedAt"
  | "dismissedByUser"
  | "createdAt"
>;

/*
 * Where a fix that waits for approval stands with the approvals it needs,
 * for the reader (Common/Types/AutoRemediation/RemediationApprovals): a
 * riskier fix in a project that asks two people to approve one waits, after
 * its first approval, for a second from someone else.
 */
export interface RemediationFixApprovals {
  // A first approval is in, and a second, from someone else, runs the fix.
  isWaitingForSecondApproval: boolean;
  /*
   * Two people must approve it: a first approval is in, or the project
   * asks for two (as the card read it) and it holds a riskier change.
   */
  needsTwoApprovals: boolean;
  // The reader gave the first approval: their press would do nothing.
  isFirstApprovedByReader: boolean;
}

const NO_SECOND_APPROVAL: RemediationFixApprovals = {
  isWaitingForSecondApproval: false,
  needsTwoApprovals: false,
  isFirstApprovedByReader: false,
};

/*
 * The approvals of a fix that waits, as the server will count them: once a
 * first approval is recorded, the fix waits for a second - unless the card
 * read the project's rule as off since, when one approval runs it. Before
 * any, two are needed when the rule reads on and the fix is a command plan
 * holding a riskier change. A rule not read (yet) says nothing of two
 * before a first approval is in: the server decides, and says so.
 */
export function getRemediationFixApprovals(data: {
  suggestion: Pick<
    AutoRemediationSuggestion,
    "status" | "suggestionType" | "commandPlan" | "firstApprovedByUserId"
  >;
  // Project.requireTwoApprovalsForRiskierFixes as read, or undefined.
  isTwoApprovalsRuleOn?: boolean | undefined;
  readerUserId?: string | undefined;
}): RemediationFixApprovals {
  const suggestion: Pick<
    AutoRemediationSuggestion,
    "status" | "suggestionType" | "commandPlan" | "firstApprovedByUserId"
  > = data.suggestion;

  if (
    suggestion.status !== AutoRemediationSuggestionStatus.Suggested ||
    suggestion.suggestionType !== AutoRemediationSuggestionType.CommandPlan
  ) {
    return NO_SECOND_APPROVAL;
  }

  const plan: AiRemediationCommandPlan | null =
    AiRemediationCommandPlanUtil.parse(suggestion.commandPlan || null);

  // A plan that can no longer be approved waits for nobody.
  if (plan?.commands.some(isRemovedSshCommand)) {
    return NO_SECOND_APPROVAL;
  }

  const isWaitingForSecondApproval: boolean =
    Boolean(suggestion.firstApprovedByUserId) &&
    data.isTwoApprovalsRuleOn !== false;

  return {
    isWaitingForSecondApproval,
    needsTwoApprovals:
      isWaitingForSecondApproval ||
      (data.isTwoApprovalsRuleOn === true &&
        getRiskierRemediationCommands(plan).length > 0),
    isFirstApprovedByReader:
      isWaitingForSecondApproval &&
      isSameApprover(suggestion.firstApprovedByUserId, data.readerUserId),
  };
}

/*
 * The line under the approval step of a fix two people must approve: what
 * the reader's own approval does - it is the first, it runs the fix, or it
 * was given already - or, to a reader who may not approve, that two people
 * must. Null when one approval runs the fix.
 */
function getTwoApprovalsSummary(data: {
  approvals: RemediationFixApprovals;
  mayApprove?: boolean | undefined;
}): string | null {
  const approvals: RemediationFixApprovals = data.approvals;

  if (!approvals.needsTwoApprovals) {
    return null;
  }

  if (approvals.isFirstApprovedByReader) {
    return REMEDIATION_TWO_APPROVALS_COPY.youApprovedFirst;
  }

  if (data.mayApprove === false) {
    return REMEDIATION_TWO_APPROVALS_COPY.twoPeopleMustApprove;
  }

  return approvals.isWaitingForSecondApproval
    ? REMEDIATION_TWO_APPROVALS_COPY.yoursRunsIt
    : REMEDIATION_TWO_APPROVALS_COPY.yoursIsTheFirst;
}

/*
 * The first of two approvals, as a step of its own: who gave it, where,
 * and when - "Approved by Maya Chen in Slack" - with the words a lone
 * approval reads in.
 */
function getFirstApprovalStep(data: {
  suggestion: RemediationFixStepSuggestion;
  translator: Translator;
}): RemediationFixStep {
  const name: string = getPersonName(data.suggestion.firstApprovedByUser);
  const words: ApprovalWords = getApprovalWords(
    readRemediationApprovalSource(data.suggestion.firstApprovedFrom),
  );

  return {
    kind: "firstApproval",
    tone: "done",
    title: name
      ? data.translator.translateTemplate(
          words.byName,
          { name },
          { setsValuesApart: true },
        )
      : data.translator.translateText(words.alone) || words.alone,
    summary: null,
    isSummaryWritten: false,
    at: readRemediationMoment(data.suggestion.firstApprovedAt),
    hasDetails: false,
  };
}

/*
 * The steps one fix went through, in the order they happened, as the
 * Remediation step draws them under the fix's name.
 */
export function getRemediationFixSteps(data: {
  suggestion: RemediationFixStepSuggestion;
  translator?: Translator | undefined;
  /*
   * Whether the reader may approve the fix (RemediationFixActGate): false
   * when their permissions certainly do not let them, and a fix that
   * waits then needs approval - not theirs. Left out, theirs.
   */
  mayApprove?: boolean | undefined;
  /*
   * Whether the project asks two people to approve a riskier fix
   * (Project.requireTwoApprovalsForRiskierFixes), as the card read it, and
   * who is reading: a fix that needs two says so, and says "you" to the
   * one who approved it first. Left out, nothing is said of two before a
   * first approval is in.
   */
  isTwoApprovalsRuleOn?: boolean | undefined;
  readerUserId?: string | undefined;
  /*
   * How the fix's round went, as the step read it (RemediationRoundView,
   * issue #6436): a round that stopped says so - not that it found no fix
   * - and why; one that found none says why in the AI's words; one that
   * waits to try again says when. Left out (not read yet, or not an AI
   * round), the fix reads as its row says.
   */
  round?: RemediationRoundView | undefined;
}): Array<RemediationFixStep> {
  const translator: Translator = data.translator || getGlobalTranslator();
  const suggestion: RemediationFixStepSuggestion = data.suggestion;
  const text: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
  };

  const status: AutoRemediationSuggestionStatus =
    (suggestion.status as AutoRemediationSuggestionStatus) ||
    AutoRemediationSuggestionStatus.Planning;
  const isCommandPlan: boolean =
    suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan;
  const isMcpFix: boolean =
    suggestion.suggestionType === AutoRemediationSuggestionType.McpToolCalls;
  const isRunbook: boolean = !isCommandPlan && !isMcpFix;
  const plan: AiRemediationCommandPlan | null = isCommandPlan
    ? AiRemediationCommandPlanUtil.parse(suggestion.commandPlan || null)
    : null;
  const mcpPlan: ExternalMcpToolCallPlan | null = isMcpFix
    ? ExternalMcpToolCallPlanUtil.parse(suggestion.mcpToolCallPlan || null)
    : null;
  const commands: Array<AiRemediationCommand> = plan?.commands || [];
  const calls: Array<ExternalMcpToolCall> = mcpPlan?.calls || [];
  const isStarted: boolean =
    status === AutoRemediationSuggestionStatus.Approved ||
    status === AutoRemediationSuggestionStatus.AutoExecuted;
  const reasoning: string | null = getReasoningPreview(
    suggestion.rationaleMarkdown,
  );
  const hasReasoning: boolean = Boolean(suggestion.rationaleMarkdown);
  const createdAt: Date | null = readRemediationMoment(suggestion.createdAt);
  // The changes a fix through MCP servers has sent: they are what ran.
  const sentCalls: Array<ExternalMcpToolCall> = calls.filter(
    (call: ExternalMcpToolCall): boolean => {
      return call.status !== ExternalMcpToolCallStatus.Proposed;
    },
  );

  const steps: Array<RemediationFixStep> = [];
  const round: RemediationRoundView | undefined = data.round;
  const hasRoundDetails: boolean = hasRemediationRoundDetails(round);
  /*
   * When its round started: its run's start, once the round is read. A
   * round tried again (issue #6487) started well after its fix was first
   * worked out, and "Working out a fix…" said the first time.
   */
  const roundStartedAt: Date | null =
    readRemediationMoment(round?.run?.createdAt) || createdAt;

  // --- plan: what OneUptime AI worked out, or that it found nothing ---

  /*
   * Its round stopped without its answer - its run failed, stopped
   * answering or expired in the queue - and changed nothing: that is what
   * happened, never "Found no safe fix" (issue #6436). Why, in the
   * reader's language, under it; what to do and Try again where it opens.
   */
  if (isRemediationRoundUnfinished({ status, round })) {
    steps.push({
      kind: "plan",
      tone: "failed",
      title: text(
        isRunbook
          ? REMEDIATION_ROUND_COPY.unfinishedRunbook
          : REMEDIATION_ROUND_COPY.unfinishedFix,
      ),
      summary: describeAiRunFailureCause(
        readAiRunFailure({
          events: round!.events,
          errorMessage: round!.run?.errorMessage || undefined,
        }),
        translator,
      ),
      isSummaryWritten: false,
      // Its notice, where the step opens, starts with the same words.
      isSummaryInDetails: true,
      at: readRemediationMoment(round!.run?.completedAt) || createdAt,
      hasDetails: true,
    });

    return steps;
  }

  if (status === AutoRemediationSuggestionStatus.Planning) {
    // Its last attempt did not finish, and it tries again on its own.
    const retryWait: AIRunAttemptEnd | null =
      getRemediationRoundRetryWait(round);

    steps.push({
      kind: "plan",
      tone: "live",
      title: text(
        isRunbook
          ? REMEDIATION_FIX_STEP_COPY.pickingRunbook
          : REMEDIATION_FIX_STEP_COPY.composing,
      ),
      summary: retryWait ? describeAttemptEnd(retryWait, translator) : null,
      isSummaryWritten: false,
      at: roundStartedAt,
      // The commands it has checked with so far.
      hasDetails: hasRoundDetails,
    });

    return steps;
  }

  if (status === AutoRemediationSuggestionStatus.NoneApplicable) {
    /*
     * Why it found none, as the AI said it when it ended (explain_no_fix):
     * one or two sentences. Older rounds, and an AI that did not say,
     * read their reasoning as before.
     */
    const reason: string | null = round?.explanation?.reason || reasoning;

    steps.push({
      kind: "plan",
      tone: "idle",
      title: text(
        isRunbook
          ? REMEDIATION_FIX_STEP_COPY.noRunbook
          : REMEDIATION_FIX_STEP_COPY.noSafeFix,
      ),
      summary: reason,
      isSummaryWritten: Boolean(reason),
      at: roundStartedAt,
      /*
       * What it ruled out and what it checked, once its round is read -
       * and always that no fix ran and nobody was asked to approve one.
       */
      hasDetails: true,
    });

    return steps;
  }

  const sentence: string | null = getRemediationFixSentence({
    plan,
    mcpPlan,
    translator,
  });
  // A plan or a list of changes that cannot be read: said so, not hidden.
  const isUnreadable: boolean =
    (isCommandPlan && !plan) || (isMcpFix && !mcpPlan);

  steps.push({
    kind: "plan",
    tone: isUnreadable ? "idle" : "done",
    title:
      sentence ||
      text(
        isRunbook
          ? REMEDIATION_FIX_STEP_COPY.planRunbook
          : REMEDIATION_FIX_STEP_COPY.planUnreadable,
      ),
    summary: isUnreadable
      ? text(isMcpFix ? CHANGES_NOT_SHOWN : COMMANDS_NOT_SHOWN)
      : reasoning,
    isSummaryWritten: !isUnreadable && Boolean(reasoning),
    at: roundStartedAt,
    hasDetails:
      hasReasoning ||
      hasRoundDetails ||
      commands.length > 0 ||
      // Changes not sent yet are read where they were planned.
      (calls.length > 0 && sentCalls.length === 0),
  });

  // --- approval: the reader's, a person's, or not needed ---

  if (status === AutoRemediationSuggestionStatus.Suggested) {
    const isUnapprovable: boolean = commands.some(
      (command: AiRemediationCommand): boolean => {
        return isRemovedSshCommand(command);
      },
    );
    const approvals: RemediationFixApprovals = getRemediationFixApprovals({
      suggestion,
      isTwoApprovalsRuleOn: data.isTwoApprovalsRuleOn,
      readerUserId: data.readerUserId,
    });
    const twoApprovalsSummary: string | null = getTwoApprovalsSummary({
      approvals,
      mayApprove: data.mayApprove,
    });

    // Who approved it first, in the order it happened.
    if (approvals.isWaitingForSecondApproval) {
      steps.push(getFirstApprovalStep({ suggestion, translator }));
    }

    steps.push({
      kind: "approval",
      tone: isUnapprovable ? "idle" : "attention",
      title: text(
        isUnapprovable
          ? REMEDIATION_FIX_STEP_COPY.cannotBeApproved
          : approvals.isWaitingForSecondApproval
            ? REMEDIATION_TWO_APPROVALS_COPY.needsSecondApproval
            : data.mayApprove === false
              ? REMEDIATION_FIX_STEP_COPY.waitingForSomeonesApproval
              : REMEDIATION_FIX_STEP_COPY.waitingForApproval,
      ),
      summary: twoApprovalsSummary ? text(twoApprovalsSummary) : null,
      isSummaryWritten: false,
      at: null,
      hasDetails: false,
    });

    return steps;
  }

  /*
   * A first approval stays in a fix's story once it is decided: approved
   * a second time by someone else, or dismissed. One approval by the same
   * person (the project stopped asking for two meanwhile) is one step.
   */
  if (
    suggestion.firstApprovedByUserId &&
    (status === AutoRemediationSuggestionStatus.Dismissed ||
      (status === AutoRemediationSuggestionStatus.Approved &&
        !isSameApprover(
          suggestion.firstApprovedByUserId,
          suggestion.approvedByUserId || suggestion.approvedByUser?.id,
        )))
  ) {
    steps.push(getFirstApprovalStep({ suggestion, translator }));
  }

  if (status === AutoRemediationSuggestionStatus.Dismissed) {
    const name: string = getPersonName(suggestion.dismissedByUser);

    steps.push({
      kind: "approval",
      tone: "idle",
      title: name
        ? translator.translateTemplate(
            REMEDIATION_FIX_STEP_COPY.dismissedBy,
            { name },
            { setsValuesApart: true },
          )
        : text(REMEDIATION_FIX_STEP_COPY.dismissed),
      summary: null,
      isSummaryWritten: false,
      at: readRemediationMoment(suggestion.dismissedAt),
      hasDetails: false,
    });

    return steps;
  }

  if (!isStarted) {
    return steps;
  }

  if (status === AutoRemediationSuggestionStatus.Approved) {
    const name: string = getPersonName(suggestion.approvedByUser);
    const words: ApprovalWords = getApprovalWords(
      readRemediationApprovalSource(suggestion.approvedFrom),
    );

    steps.push({
      kind: "approval",
      tone: "done",
      title: name
        ? translator.translateTemplate(
            words.byName,
            { name },
            { setsValuesApart: true },
          )
        : text(words.alone),
      summary: null,
      isSummaryWritten: false,
      at: readRemediationMoment(suggestion.approvedAt),
      hasDetails: false,
    });
  } else {
    steps.push({
      kind: "approval",
      tone: "done",
      title: text(REMEDIATION_FIX_STEP_COPY.approvedAutomatically),
      summary: null,
      isSummaryWritten: false,
      at: null,
      hasDetails: false,
    });
  }

  // --- run: what ran, and how it went ---

  if (isCommandPlan && plan) {
    const executionStatus: AiRemediationPlanExecutionStatus =
      plan.executionStatus || AiRemediationPlanExecutionStatus.NotStarted;
    const failed: Array<AiRemediationCommand> = commands.filter(
      (command: AiRemediationCommand): boolean => {
        return (
          command.execution?.status ===
          AiRemediationCommandExecutionStatus.Failed
        );
      },
    );
    const isRunning: boolean =
      executionStatus === AiRemediationPlanExecutionStatus.NotStarted ||
      executionStatus === AiRemediationPlanExecutionStatus.Running;
    const hasFailed: boolean =
      failed.length > 0 ||
      executionStatus === AiRemediationPlanExecutionStatus.Failed;
    const firstError: string | undefined = failed.find(
      (command: AiRemediationCommand): boolean => {
        return Boolean(command.execution?.errorMessage);
      },
    )?.execution?.errorMessage;

    let title: string;

    if (isRunning) {
      title = translator.translatePlural(
        REMEDIATION_FIX_STEP_COPY.runningCommands,
        commands.length,
      );
    } else if (hasFailed && commands.length === 1) {
      title = text(REMEDIATION_FIX_STEP_COPY.commandFailed);
    } else if (hasFailed) {
      title = translator.translatePlural(
        REMEDIATION_FIX_STEP_COPY.commandsFailed,
        commands.length,
        { failed: translator.formatNumber(Math.max(failed.length, 1)) },
      );
    } else {
      title = translator.translatePlural(
        REMEDIATION_FIX_STEP_COPY.ranCommands,
        commands.length,
      );
    }

    steps.push({
      kind: "run",
      tone: isRunning ? "live" : hasFailed ? "failed" : "done",
      title,
      summary: !isRunning && firstError ? firstError : null,
      isSummaryWritten: !isRunning && Boolean(firstError),
      at: getEarliest([
        plan.executionStartedAt,
        ...commands.map((command: AiRemediationCommand): unknown => {
          return command.execution?.startedAt;
        }),
      ]),
      hasDetails: commands.length > 0,
    });
  } else if (isMcpFix && mcpPlan) {
    const failed: Array<ExternalMcpToolCall> = calls.filter(
      (call: ExternalMcpToolCall): boolean => {
        return call.status === ExternalMcpToolCallStatus.Failed;
      },
    );
    const isRunning: boolean =
      ExternalMcpToolCallPlanUtil.isInFlight(mcpPlan) ||
      ExternalMcpToolCallPlanUtil.getProposedCalls(mcpPlan).length > 0;
    const firstError: string | undefined = failed.find(
      (call: ExternalMcpToolCall): boolean => {
        return Boolean(call.errorMessage);
      },
    )?.errorMessage;

    let title: string;

    if (isRunning) {
      title = translator.translatePlural(
        REMEDIATION_FIX_STEP_COPY.makingChanges,
        calls.length,
      );
    } else if (failed.length > 0 && calls.length === 1) {
      title = text(REMEDIATION_FIX_STEP_COPY.changeFailed);
    } else if (failed.length > 0) {
      title = translator.translatePlural(
        REMEDIATION_FIX_STEP_COPY.changesFailed,
        calls.length,
        { failed: translator.formatNumber(failed.length) },
      );
    } else {
      title = translator.translatePlural(
        REMEDIATION_FIX_STEP_COPY.madeChanges,
        calls.length,
      );
    }

    steps.push({
      kind: "run",
      tone: isRunning ? "live" : failed.length > 0 ? "failed" : "done",
      title,
      summary: !isRunning && firstError ? firstError : null,
      isSummaryWritten: !isRunning && Boolean(firstError),
      at: getEarliest(
        calls.map((call: ExternalMcpToolCall): unknown => {
          return call.startedAt;
        }),
      ),
      hasDetails: calls.length > 0,
    });
  } else if (isRunbook) {
    steps.push({
      kind: "run",
      tone: "done",
      title: text(REMEDIATION_FIX_STEP_COPY.runbookStarted),
      summary: null,
      isSummaryWritten: false,
      at:
        readRemediationMoment(suggestion.approvedAt) ||
        (status === AutoRemediationSuggestionStatus.AutoExecuted
          ? createdAt
          : null),
      hasDetails: false,
    });
  }

  // --- verify: whether the incident or alert recovered ---

  const verification: AutoRemediationVerificationStatus | undefined =
    suggestion.verificationStatus as
      | AutoRemediationVerificationStatus
      | undefined;
  const verificationNote: string | null = suggestion.verificationNote || null;

  if (verification === AutoRemediationVerificationStatus.Pending) {
    const windowMinutes: number | undefined =
      typeof suggestion.verificationWindowMinutes === "number" &&
      suggestion.verificationWindowMinutes > 0
        ? suggestion.verificationWindowMinutes
        : undefined;

    steps.push({
      kind: "verify",
      tone: "live",
      title: text(REMEDIATION_FIX_STEP_COPY.watching),
      summary:
        verificationNote ||
        (windowMinutes
          ? translator.translatePlural(
              REMEDIATION_FIX_STEP_COPY.watchingFor,
              windowMinutes,
            )
          : null),
      isSummaryWritten: Boolean(verificationNote),
      at: null,
      hasDetails: false,
    });
  } else if (verification) {
    const VERIFICATION_TITLES: Record<
      AutoRemediationVerificationStatus,
      { title: string; tone: RemediationFixStepTone }
    > = {
      [AutoRemediationVerificationStatus.Pending]: {
        title: REMEDIATION_FIX_STEP_COPY.watching,
        tone: "live",
      },
      [AutoRemediationVerificationStatus.Verified]: {
        title: REMEDIATION_FIX_STEP_COPY.verified,
        tone: "done",
      },
      [AutoRemediationVerificationStatus.Failed]: {
        title: REMEDIATION_FIX_STEP_COPY.notRecovered,
        tone: "failed",
      },
      [AutoRemediationVerificationStatus.Skipped]: {
        title: REMEDIATION_FIX_STEP_COPY.verificationSkipped,
        tone: "idle",
      },
    };
    const outcome: { title: string; tone: RemediationFixStepTone } =
      VERIFICATION_TITLES[verification] ||
      VERIFICATION_TITLES[AutoRemediationVerificationStatus.Skipped];

    steps.push({
      kind: "verify",
      tone: outcome.tone,
      title: text(outcome.title),
      summary: verificationNote,
      isSummaryWritten: Boolean(verificationNote),
      at: readRemediationMoment(suggestion.verificationCompletedAt),
      hasDetails: false,
    });
  }

  // --- rollback: what ran, undone because it did not work ---

  if (plan) {
    const undone: Array<AiRemediationCommandExecutionState> = commands
      .map(
        (
          command: AiRemediationCommand,
        ): AiRemediationCommandExecutionState | undefined => {
          return command.rollbackExecution;
        },
      )
      .filter(
        (
          execution: AiRemediationCommandExecutionState | undefined,
        ): execution is AiRemediationCommandExecutionState => {
          return Boolean(execution);
        },
      );
    const succeeded: number = undone.filter(
      (execution: AiRemediationCommandExecutionState): boolean => {
        return (
          execution.status === AiRemediationCommandExecutionStatus.Succeeded
        );
      },
    ).length;
    const rollbackAt: Date | null = getLatest(
      undone.map((execution: AiRemediationCommandExecutionState): unknown => {
        return execution.completedAt || execution.startedAt;
      }),
    );
    /*
     * An undo that failed, or was left for a person to make (Skipped), makes
     * the rollback a failed one, whatever status it settled with - as the
     * server's own summary of it says (CommandPlanExecutor).
     */
    const hasUndoNotMade: boolean = undone.some(
      (execution: AiRemediationCommandExecutionState): boolean => {
        return (
          execution.status === AiRemediationCommandExecutionStatus.Failed ||
          execution.status === AiRemediationCommandExecutionStatus.Skipped
        );
      },
    );
    const isUndoMoving: boolean = undone.some(
      (execution: AiRemediationCommandExecutionState): boolean => {
        return (
          execution.status === AiRemediationCommandExecutionStatus.Pending ||
          execution.status === AiRemediationCommandExecutionStatus.Running
        );
      },
    );
    // NotAttempted is the rollback arm's "not settled yet", as no status is.
    const settled: AiRemediationRollbackStatus | undefined =
      plan.rollbackStatus &&
      plan.rollbackStatus !== AiRemediationRollbackStatus.NotAttempted
        ? plan.rollbackStatus
        : undefined;

    if (
      settled === AiRemediationRollbackStatus.Failed ||
      (settled === AiRemediationRollbackStatus.Completed && hasUndoNotMade)
    ) {
      steps.push({
        kind: "rollback",
        tone: "failed",
        title: text(REMEDIATION_FIX_STEP_COPY.rollbackFailed),
        summary: text(REMEDIATION_FIX_STEP_COPY.rollbackFailedSummary),
        isSummaryWritten: false,
        at: rollbackAt,
        hasDetails: undone.length > 0,
      });
    } else if (settled === AiRemediationRollbackStatus.Completed) {
      steps.push({
        kind: "rollback",
        tone: "done",
        title:
          succeeded > 0
            ? translator.translatePlural(
                REMEDIATION_FIX_STEP_COPY.rolledBackCommands,
                succeeded,
              )
            : text(REMEDIATION_FIX_STEP_COPY.rolledBack),
        summary: null,
        isSummaryWritten: false,
        at: rollbackAt,
        hasDetails: undone.length > 0,
      });
    } else if (settled === AiRemediationRollbackStatus.NotApplicable) {
      // What it changed is still in place: said, and why.
      const wasPutBack: boolean = commands.some(
        (command: AiRemediationCommand): boolean => {
          return Boolean(command.revertWatch?.putBackAt);
        },
      );

      steps.push({
        kind: "rollback",
        tone: "idle",
        title: text(REMEDIATION_FIX_STEP_COPY.notRolledBack),
        summary: text(
          wasPutBack
            ? REMEDIATION_FIX_STEP_COPY.alreadyPutBackSummary
            : REMEDIATION_FIX_STEP_COPY.notRolledBackSummary,
        ),
        isSummaryWritten: false,
        at: null,
        hasDetails: false,
      });
    } else if (isUndoMoving || Boolean(plan.rollbackHeartbeatAt)) {
      // The rollback arm has started, and has not settled.
      steps.push({
        kind: "rollback",
        tone: "live",
        title: text(REMEDIATION_FIX_STEP_COPY.rollingBack),
        summary: null,
        isSummaryWritten: false,
        at: rollbackAt,
        hasDetails: undone.length > 0,
      });
    }
  }

  return steps;
}

// What keeps a fix's step open, apart from another fix's or step's.
export function getRemediationFixStepKey(
  suggestionId: string,
  kind: RemediationFixStepKind,
): string {
  return `${suggestionId}:step:${kind}`;
}

/*
 * The fixes in the order OneUptime AI tried them, oldest first, so they
 * read top to bottom as what it did: the first fix, what came of it, the
 * next one. The server answers newest first; fixes of the same moment keep
 * its order.
 */
export function sortRemediationFixesOldestFirst<
  T extends Pick<AutoRemediationSuggestion, "createdAt">,
>(fixes: Array<T>): Array<T> {
  const time: (fix: T) => number = (fix: T): number => {
    return readRemediationMoment(fix.createdAt)?.getTime() || 0;
  };

  return fixes
    .map((fix: T, index: number): { fix: T; index: number } => {
      return { fix, index };
    })
    .sort(
      (a: { fix: T; index: number }, b: { fix: T; index: number }): number => {
        return time(a.fix) - time(b.fix) || a.index - b.index;
      },
    )
    .map((entry: { fix: T; index: number }): T => {
      return entry.fix;
    });
}
