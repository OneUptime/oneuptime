/*
 * A ROUND OF AN AI FIX: WHAT IT DID, AND TRYING IT AGAIN (issues #6436,
 * #6487).
 *
 * The Remediation step of an incident's or alert's AI card shows each fix
 * OneUptime AI worked out. Its suggestion row says what was decided; how
 * the round got there lives with its AI run, which people cannot read (a
 * run is system-authored, hidden by the per-user pin on AIRun). Here the
 * round is read for a person who may read the fix - its run, how it ended,
 * the commands it ran to check, and why it found no fix - and tried again
 * for one who may change the incident or alert.
 *
 * Reading (readForViewer): the fix is read under the PERSON's permissions
 * in the tenant they asked in, then its run and events as root, and only
 * what the step shows leaves: the run's status and times, the events that
 * say how its attempts ended, each check's command (from the round's own
 * read tools) and the explanation the AI gave (Types/AutoRemediation
 * /RemediationRound). Raw tool arguments never do.
 *
 * Trying again (tryAgain): a round that did not finish - its run failed,
 * stopped answering, expired in the queue or is gone - and that changed
 * nothing starts again with a new run. Every command, change and runbook a
 * round makes is recorded before it acts (that record is the step's
 * idempotency key), so a round that recorded one is never started again:
 * from the top it could make the same change twice. The new run is named
 * on the round inside one conditional write before it exists - of two
 * presses at once one starts it - and a run that is not the round's own
 * never acts on it (RemediationRoundRun.isAnotherRunsRound).
 */

import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import { AIRunStatusHelper } from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import { AIRunEventResultSummary } from "../../../Types/AI/AIChatTypes";
import { InvestigationNotStartedCode } from "../../../Types/AI/InvestigationNotStartedReason";
import { isRecordAiTokenLimitPaused } from "../../../Types/AI/RecordAiTokenLimit";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallPlanUtil,
} from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import {
  clipRoundText,
  EXPLAIN_NO_FIX_TOOL_NAME,
  getRemediationRoundTryAgainRefusal,
  hasRemediationRoundAppliedSteps,
  MAX_ROUND_CHECK_ERROR_LENGTH,
  MAX_ROUND_CHECK_WHY_LENGTH,
  MAX_ROUND_CHECKS,
  MAX_ROUND_COMMAND_LENGTH,
  parseRemediationRoundExplanation,
  RemediationRoundAppliedSteps,
  RemediationRoundCheck,
  RemediationRoundCheckStatus,
  RemediationRoundExplanation,
  REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED,
  RemediationRoundTryAgainRefusal,
} from "../../../Types/AutoRemediation/RemediationRound";
import {
  KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX,
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import {
  isInfrastructureResultUnknownMessage,
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "../AI/ResourceAccess/ResourceAccessToolNames";
import { READ_TOOL_OUTPUT_TOOL_NAME } from "../AI/Chat/ToolOutputPager";
import {
  CALL_MCP_TOOL_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
} from "../../../Types/AI/ExternalMcpServer/ExternalMcpToolNames";
import { Indigo500 } from "../../../Types/BrandColors";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import Alert from "../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import AIRunEventService from "../../Services/AIRunEventService";
import AIRunService from "../../Services/AIRunService";
import { AutonomousBudgetStatus } from "../../Services/AIService";
import AlertFeedService from "../../Services/AlertFeedService";
import AlertService from "../../Services/AlertService";
import AutoRemediationSuggestionService from "../../Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import IncidentService from "../../Services/IncidentService";
import AIInvestigationEngine from "../AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../AI/SRE/InvestigationQueue";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import Select from "../../Types/Database/Select";
import logger from "../Logger";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";

// How many of a round's events are read: the newest ones, put back in order.
const MAX_ROUND_EVENTS: number = 500;

/*
 * The events that say how a round's attempts went - each start, each
 * attempt that ended, and how the run ended - which the step's failure
 * notice reads (AiRunFailureWords.readAiRunFailure). Sent as they are,
 * without a tool's arguments.
 */
const LIFECYCLE_EVENT_TYPES: ReadonlyArray<AIRunEventType> = [
  AIRunEventType.RunStarted,
  AIRunEventType.AttemptEnded,
  AIRunEventType.RunFailed,
  AIRunEventType.RunCompleted,
];

const TOOL_EVENT_TYPES: ReadonlyArray<AIRunEventType> = [
  AIRunEventType.ToolCallStarted,
  AIRunEventType.ToolCallCompleted,
  AIRunEventType.ToolCallFailed,
];

// The tools a round checks with that run a command on what it fixes.
const COMMAND_CHECK_TOOL_NAMES: ReadonlyArray<string> = [
  RUN_KUBECTL_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
];

/*
 * The tools that are not a query of the project's telemetry: a round's
 * own - what it proposes or makes, where it may run, the rest of a long
 * output, and its explanation - and the project's external MCP servers',
 * which are other systems (a fix through MCP servers proposes and makes
 * its changes with call_mcp_tool).
 */
const NOT_A_CHECK_TOOL_NAMES: ReadonlyArray<string> = [
  ...COMMAND_CHECK_TOOL_NAMES,
  EXPLAIN_NO_FIX_TOOL_NAME,
  "propose_remediation_commands",
  "execute_remediation_command",
  "roll_back_change",
  "list_command_targets",
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  READ_TOOL_OUTPUT_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
  CALL_MCP_TOOL_TOOL_NAME,
];

// The fix's fields a round's read and its Try again need.
const ROUND_SUGGESTION_SELECT: Select<AutoRemediationSuggestion> = {
  _id: true,
  projectId: true,
  status: true,
  suggestionType: true,
  aiRunId: true,
  incidentId: true,
  alertId: true,
  commandPlan: true,
  mcpToolCallPlan: true,
  runbookExecutionId: true,
  rationaleMarkdown: true,
  ruleNameSnapshot: true,
  kubernetesClusterId: true,
  resourceType: true,
  resourceId: true,
};

/*
 * What a round already did outside OneUptime, from what it recorded before
 * acting: commands with an execution (a command is recorded before it
 * runs), changes sent through MCP servers (each recorded before it is
 * sent), and a runbook it started.
 */
export function getRoundAppliedSteps(
  suggestion: Pick<
    AutoRemediationSuggestion,
    "commandPlan" | "mcpToolCallPlan" | "runbookExecutionId"
  >,
): RemediationRoundAppliedSteps {
  const plan: AiRemediationCommandPlan | null =
    AiRemediationCommandPlanUtil.parse(suggestion.commandPlan || null);
  const mcpPlan: ExternalMcpToolCallPlan | null =
    ExternalMcpToolCallPlanUtil.parse(suggestion.mcpToolCallPlan || null);

  return {
    commandCount: (plan?.commands || []).filter(
      (command: AiRemediationCommand): boolean => {
        return command.execution !== undefined;
      },
    ).length,
    changeCount: mcpPlan
      ? ExternalMcpToolCallPlanUtil.getSentCalls(mcpPlan).length
      : 0,
    isRunbookStarted: Boolean(suggestion.runbookExecutionId),
  };
}

/*
 * Why a round is not started again - or null when it may be: it ran (it
 * has a run), its run is over without its answer (or is gone), it changed
 * nothing, and it says it found no fix (NoneApplicable), or still says it
 * is being worked out while its run is over (Planning, before the sweep
 * settles it).
 */
export function getRoundTryAgainRefusal(data: {
  suggestion: Pick<AutoRemediationSuggestion, "status" | "aiRunId">;
  run: Pick<AIRun, "status"> | null;
  appliedSteps: RemediationRoundAppliedSteps;
}): RemediationRoundTryAgainRefusal | null {
  if (!data.suggestion.aiRunId) {
    return RemediationRoundTryAgainRefusal.NoRound;
  }

  if (data.run && !AIRunStatusHelper.isTerminalStatus(data.run.status!)) {
    return RemediationRoundTryAgainRefusal.StillWorking;
  }

  if (data.run && !AIRunStatusHelper.didNotFinish(data.run.status)) {
    return RemediationRoundTryAgainRefusal.Finished;
  }

  // Before the status: a round that made a change says so, whatever it says now.
  if (hasRemediationRoundAppliedSteps(data.appliedSteps)) {
    return RemediationRoundTryAgainRefusal.PartlyApplied;
  }

  if (
    data.suggestion.status !== AutoRemediationSuggestionStatus.NoneApplicable &&
    data.suggestion.status !== AutoRemediationSuggestionStatus.Planning
  ) {
    return RemediationRoundTryAgainRefusal.Finished;
  }

  return null;
}

/*
 * The checks a round ran, in order: each command it ran with its read
 * tools, paired with how it ended. A call ends with the next completion or
 * failure of its tool (a run calls its tools one at a time); one with
 * neither is running - or, once its attempt or its run ended, stopped.
 */
export function getRoundChecks(data: {
  events: Array<AIRunEvent>;
  isRunOver: boolean;
}): Array<RemediationRoundCheck> {
  const checks: Array<RemediationRoundCheck> = [];
  let openCheck: RemediationRoundCheck | null = null;
  let openToolName: string = "";

  const endOpenCheck: (
    status: RemediationRoundCheckStatus,
    error: string,
  ) => void = (status: RemediationRoundCheckStatus, error: string): void => {
    if (openCheck) {
      openCheck.status = status;
      openCheck.error = error;
    }

    openCheck = null;
    openToolName = "";
  };

  for (const event of data.events) {
    if (
      event.eventType === AIRunEventType.RunStarted ||
      event.eventType === AIRunEventType.AttemptEnded ||
      event.eventType === AIRunEventType.RunFailed
    ) {
      // The attempt ended (or another began): what it left open stopped.
      if (openCheck) {
        endOpenCheck("stopped", "");
      }
      continue;
    }

    const toolName: string = event.toolName || "";

    if (!COMMAND_CHECK_TOOL_NAMES.includes(toolName)) {
      continue;
    }

    if (event.eventType === AIRunEventType.ToolCallStarted) {
      if (openCheck) {
        endOpenCheck("stopped", "");
      }

      const command: string = clipRoundText(
        event.toolArguments?.["command"],
        MAX_ROUND_COMMAND_LENGTH,
      );

      if (!command) {
        continue;
      }

      const check: RemediationRoundCheck = {
        command,
        why: clipRoundText(
          event.toolArguments?.["rationale"],
          MAX_ROUND_CHECK_WHY_LENGTH,
        ),
        status: "running",
        at: event.createdAt ? new Date(event.createdAt).toISOString() : "",
        error: "",
      };

      checks.push(check);
      openCheck = check;
      openToolName = toolName;
      continue;
    }

    if (!openCheck || openToolName !== toolName) {
      continue;
    }

    const summary: AIRunEventResultSummary = event.resultSummary || {};
    const errorMessage: string = summary.errorMessage || "";

    if (event.eventType === AIRunEventType.ToolCallCompleted) {
      /*
       * kubectl ran: rowCount 1 is a command it completed, 0 one it
       * answered with an error (KubectlInvestigationToolkit).
       */
      endOpenCheck(
        toolName === RUN_KUBECTL_TOOL_NAME && summary.rowCount === 0
          ? "failed"
          : "ran",
        "",
      );
      continue;
    }

    // ToolCallFailed: it could not run - or its result never came back.
    endOpenCheck(
      errorMessage.startsWith(KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX) ||
        isInfrastructureResultUnknownMessage(errorMessage)
        ? "unknown"
        : "failed",
      clipRoundText(errorMessage, MAX_ROUND_CHECK_ERROR_LENGTH),
    );
  }

  if (openCheck && data.isRunOver) {
    endOpenCheck("stopped", "");
  }

  return checks.slice(-MAX_ROUND_CHECKS);
}

/*
 * How many other checks the round made: the project's telemetry it
 * queried (logs, metrics, traces, monitors, ...), each tool call that
 * completed and is not one of the round's own tools.
 */
export function countRoundOtherChecks(events: Array<AIRunEvent>): number {
  return events.filter((event: AIRunEvent): boolean => {
    return (
      event.eventType === AIRunEventType.ToolCallCompleted &&
      Boolean(event.toolName) &&
      !NOT_A_CHECK_TOOL_NAMES.includes(event.toolName || "")
    );
  }).length;
}

/*
 * What the AI said when it ended without a fix: the arguments of its last
 * explain_no_fix call that went through.
 */
export function getRoundExplanation(
  events: Array<AIRunEvent>,
): RemediationRoundExplanation | null {
  for (let index: number = events.length - 1; index >= 0; index--) {
    const event: AIRunEvent = events[index]!;

    if (
      event.eventType === AIRunEventType.ToolCallCompleted &&
      event.toolName === EXPLAIN_NO_FIX_TOOL_NAME
    ) {
      const explanation: RemediationRoundExplanation | null =
        parseRemediationRoundExplanation(event.toolArguments);

      if (explanation) {
        return explanation;
      }
    }
  }

  return null;
}

/*
 * The lifecycle events as the step reads them: the event's type, order,
 * time and how an attempt ended - never a tool's name or its arguments.
 */
export function toLifecycleEventsJson(events: Array<AIRunEvent>): JSONArray {
  return BaseModel.toJSONArray(
    events.filter((event: AIRunEvent): boolean => {
      return LIFECYCLE_EVENT_TYPES.includes(event.eventType!);
    }),
    AIRunEvent,
  ).map((eventJson: JSONObject): JSONObject => {
    const summary: AIRunEventResultSummary =
      (eventJson["resultSummary"] as AIRunEventResultSummary | undefined) || {};
    const clientJson: JSONObject = { ...eventJson };

    delete clientJson["toolArguments"];
    delete clientJson["toolName"];
    delete clientJson["citationId"];

    clientJson["resultSummary"] = {
      ...(summary.attemptEnd !== undefined
        ? { attemptEnd: summary.attemptEnd as unknown as JSONObject }
        : {}),
      ...(summary.errorMessage !== undefined
        ? { errorMessage: summary.errorMessage }
        : {}),
    };

    return clientJson;
  });
}

/*
 * The run as the step reads it: its status, its times and its error -
 * not the provider it used or anything else it carries.
 */
export function toRoundRunJson(run: AIRun): JSONObject {
  const runJson: JSONObject = BaseModel.toJSON(run, AIRun);

  for (const key of ["llmProviderId", "projectId", "runType"]) {
    delete runJson[key];
  }

  return runJson;
}

/*
 * What stopped the round's new run, by the queue's or the gate's code:
 * the refusal that names who can change it. A code not here is no refusal
 * (a lane's switch) or the generic one.
 */
const NOT_STARTED_REFUSALS: Partial<
  Record<InvestigationNotStartedCode, RemediationRoundTryAgainRefusal>
> = {
  ai_disabled: RemediationRoundTryAgainRefusal.AiOff,
  provider_missing: RemediationRoundTryAgainRefusal.NoProvider,
  insufficient_ai_balance: RemediationRoundTryAgainRefusal.CreditsUsedUp,
  project_daily_limit_reached: RemediationRoundTryAgainRefusal.LimitReached,
  /*
   * daily_budget_exhausted is the incident's or alert's own daily AI token
   * limit, not the project's: getTokenLimitRefusal words it by the record
   * and whether a limit of 0 pauses it (#7157).
   */
};

type RoundSubjectKind = "incident" | "alert";

/*
 * The refusal when the incident's (alert's) own daily AI token limit stops
 * the round: paused when it is set to 0 or below, which only raising it
 * lifts, else used up until midnight UTC. A budget the queue did not hand
 * over reads as used up, the only other way the limit stops work.
 */
export function getTokenLimitRefusal(
  subjectKind: RoundSubjectKind,
  budget: AutonomousBudgetStatus | null | undefined,
): RemediationRoundTryAgainRefusal {
  const isPaused: boolean = isRecordAiTokenLimitPaused(budget?.limitInTokens);

  if (subjectKind === "incident") {
    return isPaused
      ? RemediationRoundTryAgainRefusal.IncidentTokenLimitPaused
      : RemediationRoundTryAgainRefusal.IncidentTokenLimitUsedUp;
  }

  return isPaused
    ? RemediationRoundTryAgainRefusal.AlertTokenLimitPaused
    : RemediationRoundTryAgainRefusal.AlertTokenLimitUsedUp;
}

interface RoundForViewer {
  suggestion: AutoRemediationSuggestion;
  subjectKind: RoundSubjectKind;
  subjectId: ObjectID;
}

export default class RemediationRound {
  /*
   * The fix, read under the PERSON's permissions in the tenant they asked
   * in, then as root for what the round needs. "Not found" and "not yours"
   * read alike.
   */
  private static async findRoundForViewer(data: {
    suggestionId: unknown;
    tenantId: ObjectID;
    viewerProps: DatabaseCommonInteractionProps;
  }): Promise<RoundForViewer> {
    const suggestionIdString: string =
      typeof data.suggestionId === "string" ? data.suggestionId.trim() : "";

    if (!suggestionIdString || !ObjectID.isValidUUID(suggestionIdString)) {
      throw new BadDataException("suggestionId must be a fix's ID.");
    }

    const readable: AutoRemediationSuggestion | null =
      await AutoRemediationSuggestionService.findOneById({
        id: new ObjectID(suggestionIdString),
        select: { _id: true, projectId: true },
        props: data.viewerProps,
      });

    if (
      !readable ||
      !readable.id ||
      readable.projectId?.toString() !== data.tenantId.toString()
    ) {
      throw new BadDataException(
        "Auto-remediation suggestion not found (or you do not have access to it).",
      );
    }

    const suggestion: AutoRemediationSuggestion | null =
      await AutoRemediationSuggestionService.findOneById({
        id: readable.id,
        select: ROUND_SUGGESTION_SELECT,
        props: { isRoot: true },
      });

    const subjectId: ObjectID | undefined =
      suggestion?.incidentId || suggestion?.alertId;

    if (!suggestion || !subjectId) {
      throw new BadDataException(
        "Auto-remediation suggestion not found (or you do not have access to it).",
      );
    }

    return {
      suggestion,
      subjectKind: suggestion.incidentId ? "incident" : "alert",
      subjectId,
    };
  }

  /*
   * Whether the person may change the incident or alert the fix is for,
   * held to that record as an update of it is (findOneUpdatableById): who
   * may ask OneUptime AI to try fixing it again. False rather than a throw.
   */
  public static async canViewerChangeSubject(data: {
    subjectKind: RoundSubjectKind;
    subjectId: ObjectID;
    viewerProps: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    try {
      const changeable: Incident | Alert | null =
        data.subjectKind === "incident"
          ? await IncidentService.findOneUpdatableById({
              id: data.subjectId,
              select: { _id: true },
              props: data.viewerProps,
            })
          : await AlertService.findOneUpdatableById({
              id: data.subjectId,
              select: { _id: true },
              props: data.viewerProps,
            });

      return Boolean(changeable);
    } catch {
      return false;
    }
  }

  private static async isSubjectResolved(data: {
    subjectKind: RoundSubjectKind;
    subjectId: ObjectID;
  }): Promise<boolean> {
    return data.subjectKind === "incident"
      ? await IncidentService.isIncidentResolved({
          incidentId: data.subjectId,
        })
      : await AlertService.isAlertResolved({ alertId: data.subjectId });
  }

  private static async readRun(
    aiRunId: ObjectID | undefined,
    projectId: ObjectID,
  ): Promise<AIRun | null> {
    if (!aiRunId) {
      return null;
    }

    const run: AIRun | null = await AIRunService.findOneById({
      id: aiRunId,
      select: {
        _id: true,
        projectId: true,
        runType: true,
        status: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        retryAt: true,
        llmProviderId: true,
      },
      props: { isRoot: true },
    });

    // A run of another project is no run of this round.
    if (!run || run.projectId?.toString() !== projectId.toString()) {
      return null;
    }

    return run;
  }

  /*
   * The round of one fix, for the Remediation step: its run, how its
   * attempts ended, the commands it checked with, how many other checks
   * it made, why it found no fix, what it already changed, and whether
   * the person may try it again.
   */
  @CaptureSpan()
  public static async readForViewer(data: {
    suggestionId: unknown;
    tenantId: ObjectID;
    viewerProps: DatabaseCommonInteractionProps;
  }): Promise<JSONObject> {
    const round: RoundForViewer = await this.findRoundForViewer(data);
    const suggestion: AutoRemediationSuggestion = round.suggestion;
    const run: AIRun | null = await this.readRun(
      suggestion.aiRunId,
      data.tenantId,
    );

    const events: Array<AIRunEvent> = run
      ? await AIRunEventService.findBy({
          query: { aiRunId: run.id!, projectId: data.tenantId },
          select: {
            _id: true,
            sequence: true,
            eventType: true,
            toolName: true,
            toolArguments: true,
            resultSummary: true,
            createdAt: true,
          },
          // The newest: the end of a long round is what the step must show.
          sort: { sequence: SortOrder.Descending },
          limit: MAX_ROUND_EVENTS,
          skip: 0,
          props: { isRoot: true },
        })
      : [];

    events.reverse();

    const roundEvents: Array<AIRunEvent> = events.filter(
      (event: AIRunEvent): boolean => {
        return (
          LIFECYCLE_EVENT_TYPES.includes(event.eventType!) ||
          TOOL_EVENT_TYPES.includes(event.eventType!)
        );
      },
    );

    const appliedSteps: RemediationRoundAppliedSteps =
      getRoundAppliedSteps(suggestion);

    const mayTryAgain: boolean =
      getRoundTryAgainRefusal({ suggestion, run, appliedSteps }) === null &&
      !(await this.isSubjectResolved(round)) &&
      (await this.canViewerChangeSubject({
        ...round,
        viewerProps: data.viewerProps,
      }));

    return {
      run: run ? toRoundRunJson(run) : null,
      events: toLifecycleEventsJson(roundEvents),
      checks: getRoundChecks({
        events: roundEvents,
        isRunOver: !run || AIRunStatusHelper.isTerminalStatus(run.status!),
      }) as unknown as JSONArray,
      otherCheckCount: countRoundOtherChecks(roundEvents),
      explanation: getRoundExplanation(roundEvents) as unknown as JSONObject,
      appliedSteps: appliedSteps as unknown as JSONObject,
      mayTryAgain,
    };
  }

  /*
   * Start a round that did not finish again, for a person who may change
   * the incident or alert it is for. Returns the new run's id, or throws
   * a BadDataException that says why it did not start.
   */
  @CaptureSpan()
  public static async tryAgain(data: {
    suggestionId: unknown;
    tenantId: ObjectID;
    viewerProps: DatabaseCommonInteractionProps;
    userId: ObjectID;
  }): Promise<ObjectID> {
    const round: RoundForViewer = await this.findRoundForViewer(data);
    const suggestion: AutoRemediationSuggestion = round.suggestion;

    if (
      !(await this.canViewerChangeSubject({
        ...round,
        viewerProps: data.viewerProps,
      }))
    ) {
      throw new NotAuthorizedException(
        REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED[round.subjectKind],
      );
    }

    const refuse: (refusal: RemediationRoundTryAgainRefusal) => never = (
      refusal: RemediationRoundTryAgainRefusal,
    ): never => {
      throw new BadDataException(getRemediationRoundTryAgainRefusal(refusal));
    };

    const run: AIRun | null = await this.readRun(
      suggestion.aiRunId,
      data.tenantId,
    );

    const refusal: RemediationRoundTryAgainRefusal | null =
      getRoundTryAgainRefusal({
        suggestion,
        run,
        appliedSteps: getRoundAppliedSteps(suggestion),
      });

    if (refusal) {
      refuse(refusal);
    }

    if (await this.isSubjectResolved(round)) {
      refuse(
        round.subjectKind === "incident"
          ? RemediationRoundTryAgainRefusal.IncidentResolved
          : RemediationRoundTryAgainRefusal.AlertResolved,
      );
    }

    /*
     * What stops any AI run of the project, said to whoever pressed it
     * with who can change it. A lane's switch does not: a person asked.
     */
    const disabledReason: InvestigationNotStartedCode | null =
      await AIInvestigationEngine.getDisabledReasonForSubject({
        projectId: data.tenantId,
        subjectType: round.subjectKind === "incident" ? "Incident" : "Alert",
        getRuleLlmProviderId: async (): Promise<ObjectID | undefined> => {
          return run?.llmProviderId;
        },
      });

    const disabledRefusal: RemediationRoundTryAgainRefusal | undefined =
      disabledReason ? NOT_STARTED_REFUSALS[disabledReason] : undefined;

    if (disabledRefusal) {
      refuse(disabledRefusal);
    }

    const runType: AIRunType.RemediationPlan | AIRunType.RemediationExecution =
      run?.runType === AIRunType.RemediationPlan ||
      (!run &&
        suggestion.suggestionType !==
          AutoRemediationSuggestionType.CommandPlan &&
        suggestion.suggestionType !==
          AutoRemediationSuggestionType.McpToolCalls)
        ? AIRunType.RemediationPlan
        : AIRunType.RemediationExecution;

    const fromStatus: AutoRemediationSuggestionStatus = suggestion.status!;
    const fromAiRunId: ObjectID | null = suggestion.aiRunId || null;
    const newRunId: ObjectID = ObjectID.generate();
    // What the queue said, filled in by its callbacks.
    const admission: {
      isAsked: boolean;
      isAdmitted: boolean;
      notEnqueuedCode: InvestigationNotStartedCode | null;
      notEnqueuedBudget: AutonomousBudgetStatus | null;
    } = {
      isAsked: false,
      isAdmitted: false,
      notEnqueuedCode: null,
      notEnqueuedBudget: null,
    };

    const createdRunId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: data.tenantId,
      ...(round.subjectKind === "incident"
        ? { subjectIncidentId: round.subjectId }
        : { subjectAlertId: round.subjectId }),
      subjectAutoRemediationSuggestionId: suggestion.id!,
      remediationRunType: runType,
      llmProviderId: run?.llmProviderId,
      runId: newRunId,
      onNotEnqueued: async (
        code: InvestigationNotStartedCode,
        budget?: AutonomousBudgetStatus,
      ): Promise<void> => {
        admission.notEnqueuedCode = code;
        admission.notEnqueuedBudget = budget || null;
      },
      /*
       * Right before the run is created: the round, as it was read, names
       * it - one conditional write, so of two presses at once one starts
       * the round, and a round that moved on meanwhile is left alone. What
       * the last run left on it goes: nothing it recorded ran.
       */
      admitInsideSubjectLock: async (): Promise<boolean> => {
        admission.isAsked = true;
        admission.isAdmitted =
          (await AutoRemediationSuggestionService.attemptRoundRunChange({
            suggestionId: suggestion.id!,
            fromStatus,
            fromAiRunId,
            set: {
              status: AutoRemediationSuggestionStatus.Planning,
              aiRunId: newRunId.toString(),
              commandPlan: null,
              mcpToolCallPlan: null,
              rationaleMarkdown: null,
            },
          })) > 0;

        return admission.isAdmitted;
      },
    });

    if (!createdRunId) {
      if (admission.isAdmitted) {
        // Named but never created: the round is put back as it was.
        await AutoRemediationSuggestionService.attemptRoundRunChange({
          suggestionId: suggestion.id!,
          fromStatus: AutoRemediationSuggestionStatus.Planning,
          fromAiRunId: newRunId,
          set: {
            status: fromStatus,
            aiRunId: fromAiRunId ? fromAiRunId.toString() : null,
            commandPlan: suggestion.commandPlan || null,
            mcpToolCallPlan: suggestion.mcpToolCallPlan || null,
            rationaleMarkdown: suggestion.rationaleMarkdown || null,
          },
        });
      }

      if (admission.isAsked && !admission.isAdmitted) {
        refuse(RemediationRoundTryAgainRefusal.AlreadyStarted);
      }

      if (admission.notEnqueuedCode === "daily_budget_exhausted") {
        refuse(
          getTokenLimitRefusal(round.subjectKind, admission.notEnqueuedBudget),
        );
      }

      refuse(
        (admission.notEnqueuedCode &&
          NOT_STARTED_REFUSALS[admission.notEnqueuedCode]) ||
          RemediationRoundTryAgainRefusal.NotStarted,
      );
    }

    logger.info(
      `AI: fix ${suggestion.id!.toString()} of ${round.subjectKind} ${round.subjectId.toString()} was tried again as run ${newRunId.toString()}.`,
    );

    await this.postTriedAgainFeedItem({
      suggestion,
      userId: data.userId,
    });

    return newRunId;
  }

  /*
   * The record's feed says who started the fix again - a person made
   * OneUptime AI act on the record - and why, in the words the
   * Remediation step said it with ("Stopped before it found a fix"), not
   * the server's ("round"). Best effort: never fails the press.
   */
  private static async postTriedAgainFeedItem(data: {
    suggestion: AutoRemediationSuggestion;
    userId: ObjectID;
  }): Promise<void> {
    const suggestion: AutoRemediationSuggestion = data.suggestion;
    const source: string =
      suggestion.kubernetesClusterId ||
      (suggestion.resourceType && suggestion.resourceId)
        ? suggestion.ruleNameSnapshot || "AI remediation"
        : `AI rule "${suggestion.ruleNameSnapshot || "AI rule"}"`;
    const isRunbookPick: boolean =
      suggestion.suggestionType !== AutoRemediationSuggestionType.CommandPlan &&
      suggestion.suggestionType !== AutoRemediationSuggestionType.McpToolCalls;
    const markdown: string = isRunbookPick
      ? mdText`⚡ Asked ${ProductBrandingText.getProductName()} AI to try **${source}** again: it stopped before it picked a runbook.`.toString()
      : mdText`⚡ Asked ${ProductBrandingText.getProductName()} AI to try **${source}** again: it stopped before it found a fix.`.toString();

    try {
      if (suggestion.incidentId && suggestion.projectId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: suggestion.incidentId,
          projectId: suggestion.projectId,
          incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
          displayColor: Indigo500,
          feedInfoInMarkdown: markdown,
          userId: data.userId,
          workspaceNotification: {
            sendWorkspaceNotification: false,
            leadWithAuthor: true,
          },
        });
      } else if (suggestion.alertId && suggestion.projectId) {
        await AlertFeedService.createAlertFeedItem({
          alertId: suggestion.alertId,
          projectId: suggestion.projectId,
          alertFeedEventType: AlertFeedEventType.AutoRemediation,
          displayColor: Indigo500,
          feedInfoInMarkdown: markdown,
          userId: data.userId,
          workspaceNotification: {
            sendWorkspaceNotification: false,
            leadWithAuthor: true,
          },
        });
      }
    } catch (error) {
      logger.error(
        `RemediationRound: could not post that a fix was tried again: ${error}`,
      );
    }
  }
}
