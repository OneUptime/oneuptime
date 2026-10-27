import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import AutoRemediationDecision from "../../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import User from "../../../../Models/DatabaseModels/User";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { AutoRemediationDecisionStage } from "../../../../Types/AutoRemediation/AutoRemediationDecision";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { Gray500 } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  AI_HOLD_OUTAGE_RECORD_COUNT,
  AI_HOLD_OUTAGE_WINDOW_IN_MINUTES,
  AiHoldHandOffReason,
  AiHoldRecordKind,
  OnCallPolicyAiHoldOutcome,
} from "../../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import AIRunService from "../../../Services/AIRunService";
import AlertFeedService from "../../../Services/AlertFeedService";
import AlertService from "../../../Services/AlertService";
import AlertSeverityService from "../../../Services/AlertSeverityService";
import AlertStateTimelineService from "../../../Services/AlertStateTimelineService";
import AutoRemediationDecisionService from "../../../Services/AutoRemediationDecisionService";
import AutoRemediationSuggestionService from "../../../Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import IncidentService from "../../../Services/IncidentService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import IncidentStateTimelineService from "../../../Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../../Services/OnCallDutyPolicyExecutionLogService";
import UserService from "../../../Services/UserService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AiFirstResponderEligibility from "./AiFirstResponderEligibility";

/*
 * ONEUPTIME AI RESPONDS FIRST: WHAT HAPPENS TO A PAGE IT HOLDS.
 *
 * An alert or incident on-call rule set to After OneUptime AI creates its
 * runs waiting, for at most its hold time, when AI may fix what the record is
 * about (AiFirstResponderEligibility, OnCallRulePagingHold). Such a run says
 * Holding (OnCallDutyPolicyExecutionLog.aiHoldOutcome). From then on:
 *
 *   - every minute this reviews each held record (reviewHolds) and, from what
 *     OneUptime AI did - its investigation, and the fix round the remediation
 *     engine ran on it - keeps holding, resolves the record once AI's fix is
 *     verified, or hands the page to people (reviewAiHold): the investigation
 *     did not start, waits on an AI rule or did not finish; it found no fix
 *     AI may run on its own; its fix needs a person's approval, did not bring
 *     the monitors back, or has no monitor to be checked against;
 *   - its hold time running out, the worker starts the run as for any run
 *     that waited (ExecutePendingExecutions);
 *   - acknowledged or resolved while it waits, the worker ends the run without
 *     paging, and says here how the hold ended (classifyEndedHold);
 *   - Page now, AI turned off, fixing turned off, the rule no longer letting
 *     AI respond first, the record reaching the project's highest severity,
 *     or what looks like an outage hand it off at once.
 *
 * Handing off starts the run where it waits (startWaitingRun): one atomic
 * claim, so a run pages once whoever hands it off, and the reason is kept on
 * the run and said in its record's feed and its Slack and Microsoft Teams
 * message, as for any run that starts early.
 */

export enum AiHoldAction {
  Keep = "Keep",
  Resolve = "Resolve",
  HandOff = "HandOff",
}

export interface AiHoldReview {
  action: AiHoldAction;
  // Why it is handed off: said on the run and in the record's feed.
  reason?: string | undefined;
}

// What the remediation engine did for the record: one fix round or proposal.
export interface AiHoldSuggestionState {
  status?: AutoRemediationSuggestionStatus | undefined;
  executionMode?: AutoRemediationExecutionMode | undefined;
  verificationStatus?: AutoRemediationVerificationStatus | undefined;
}

// What a held record's review reads about OneUptime AI's work on it.
export interface AiHoldRecordState {
  recordKind: AiHoldRecordKind;
  now: Date;
  recordCreatedAt?: Date | undefined;
  // An AI rule makes OneUptime AI wait before investigating, until then.
  investigationWaitUntil?: Date | undefined;
  // Why the investigation did not start, recorded on the record.
  investigationNotStartedTitle?: string | undefined;
  // The record's latest investigation run, and when it ended.
  investigationStatus?: AIRunStatus | undefined;
  investigationSettledAt?: Date | undefined;
  // The remediation engine evaluated the record after the investigation.
  isRemediationEvaluated: boolean;
  suggestions: Array<AiHoldSuggestionState>;
}

/*
 * How long a held record may go without an investigation run before the
 * investigation is taken not to come - it is queued right after on-call
 * starts - and how long after it ends the remediation engine has to say what
 * it did, before nothing is taken as no fix.
 */
export const AI_HOLD_INVESTIGATION_START_GRACE_IN_MINUTES: number = 2;
export const AI_HOLD_REMEDIATION_GRACE_IN_MINUTES: number = 2;

// Held runs one review reads.
const HELD_RUNS_READ_LIMIT: number = 500;

const IN_PROGRESS_INVESTIGATION_STATUSES: Array<AIRunStatus> = [
  AIRunStatus.Queued,
  AIRunStatus.Running,
];

const UNFINISHED_INVESTIGATION_STATUSES: Array<AIRunStatus> = [
  AIRunStatus.Error,
  AIRunStatus.Cancelled,
  AIRunStatus.Stale,
];

const HELD_RUN_SELECT: {
  _id: true;
  projectId: true;
  status: true;
  pagingStartsAt: true;
  onCallDutyPolicyId: true;
  userNotificationEventType: true;
  triggeredByIncidentId: true;
  triggeredByAlertId: true;
  triggeredByAlertEpisodeId: true;
  triggeredByIncidentEpisodeId: true;
  onCallPolicyExecutionRepeatCount: true;
  aiHoldOutcome: true;
  createdAt: true;
} = {
  _id: true,
  projectId: true,
  status: true,
  pagingStartsAt: true,
  onCallDutyPolicyId: true,
  userNotificationEventType: true,
  triggeredByIncidentId: true,
  triggeredByAlertId: true,
  triggeredByAlertEpisodeId: true,
  triggeredByIncidentEpisodeId: true,
  onCallPolicyExecutionRepeatCount: true,
  aiHoldOutcome: true,
  createdAt: true,
};

function minutesSince(at: Date, now: Date): number {
  return (now.getTime() - at.getTime()) / 60000;
}

// A fix round that runs on its own and has not settled: AI is still at it.
function isFixInFlight(suggestion: AiHoldSuggestionState): boolean {
  if (suggestion.executionMode !== AutoRemediationExecutionMode.FullAuto) {
    return false;
  }

  if (suggestion.status === AutoRemediationSuggestionStatus.Planning) {
    return true;
  }

  return (
    suggestion.status === AutoRemediationSuggestionStatus.AutoExecuted &&
    (!suggestion.verificationStatus ||
      suggestion.verificationStatus ===
        AutoRemediationVerificationStatus.Pending)
  );
}

// A proposal waiting for a person: AI will not run it on its own.
function isWaitingForApproval(suggestion: AiHoldSuggestionState): boolean {
  return (
    suggestion.status === AutoRemediationSuggestionStatus.Suggested ||
    (suggestion.status === AutoRemediationSuggestionStatus.Planning &&
      suggestion.executionMode !== AutoRemediationExecutionMode.FullAuto)
  );
}

/*
 * What to do with a held record now, from OneUptime AI's work on it. A fix
 * in flight keeps the hold even after a failed attempt, since a second
 * unattended round may follow it; anything that needs a person hands off.
 */
export function reviewAiHold(state: AiHoldRecordState): AiHoldReview {
  const kind: AiHoldRecordKind = state.recordKind;

  if (
    state.investigationWaitUntil &&
    OneUptimeDate.isAfter(state.investigationWaitUntil, state.now)
  ) {
    return {
      action: AiHoldAction.HandOff,
      reason: AiHoldHandOffReason.investigationWaits({
        waitMinutes: Math.max(
          1,
          Math.ceil(-minutesSince(state.investigationWaitUntil, state.now)),
        ),
      }),
    };
  }

  if (!state.investigationStatus) {
    if (state.investigationNotStartedTitle) {
      return {
        action: AiHoldAction.HandOff,
        reason: AiHoldHandOffReason.investigationSkipped({
          recordKind: kind,
          why: state.investigationNotStartedTitle,
        }),
      };
    }

    if (
      !state.recordCreatedAt ||
      minutesSince(state.recordCreatedAt, state.now) >=
        AI_HOLD_INVESTIGATION_START_GRACE_IN_MINUTES
    ) {
      return {
        action: AiHoldAction.HandOff,
        reason: AiHoldHandOffReason.investigationSkipped({
          recordKind: kind,
          why: "",
        }),
      };
    }

    return { action: AiHoldAction.Keep };
  }

  if (IN_PROGRESS_INVESTIGATION_STATUSES.includes(state.investigationStatus)) {
    return { action: AiHoldAction.Keep };
  }

  if (state.investigationStatus === AIRunStatus.WaitingForApproval) {
    return {
      action: AiHoldAction.HandOff,
      reason: AiHoldHandOffReason.fixNeedsApproval(),
    };
  }

  if (
    state.suggestions.some((suggestion: AiHoldSuggestionState): boolean => {
      return (
        suggestion.verificationStatus ===
        AutoRemediationVerificationStatus.Verified
      );
    })
  ) {
    return { action: AiHoldAction.Resolve };
  }

  if (state.suggestions.some(isFixInFlight)) {
    return { action: AiHoldAction.Keep };
  }

  if (
    state.suggestions.some((suggestion: AiHoldSuggestionState): boolean => {
      return (
        suggestion.verificationStatus ===
        AutoRemediationVerificationStatus.Failed
      );
    })
  ) {
    return {
      action: AiHoldAction.HandOff,
      reason: AiHoldHandOffReason.fixDidNotHold(),
    };
  }

  if (
    state.suggestions.some((suggestion: AiHoldSuggestionState): boolean => {
      return (
        suggestion.verificationStatus ===
        AutoRemediationVerificationStatus.Skipped
      );
    })
  ) {
    return {
      action: AiHoldAction.HandOff,
      reason: AiHoldHandOffReason.noMonitorToCheck(),
    };
  }

  if (state.suggestions.some(isWaitingForApproval)) {
    return {
      action: AiHoldAction.HandOff,
      reason: AiHoldHandOffReason.fixNeedsApproval(),
    };
  }

  // The remediation engine runs right after the investigation ends.
  if (
    !state.isRemediationEvaluated &&
    (!state.investigationSettledAt ||
      minutesSince(state.investigationSettledAt, state.now) <
        AI_HOLD_REMEDIATION_GRACE_IN_MINUTES)
  ) {
    return { action: AiHoldAction.Keep };
  }

  if (UNFINISHED_INVESTIGATION_STATUSES.includes(state.investigationStatus)) {
    return {
      action: AiHoldAction.HandOff,
      reason: AiHoldHandOffReason.investigationSkipped({
        recordKind: kind,
        why: "its investigation did not finish",
      }),
    };
  }

  return {
    action: AiHoldAction.HandOff,
    reason: AiHoldHandOffReason.noFixToRun(),
  };
}

/*
 * How a hold ended when its record was acknowledged or resolved while it
 * waited: by a person, by AI's fix - one that ran on its own and was not
 * found to fail - or by the record recovering with no AI fix.
 */
export function classifyEndedAiHold(data: {
  isHandledByPerson: boolean;
  suggestions: Array<AiHoldSuggestionState>;
}): OnCallPolicyAiHoldOutcome {
  if (data.isHandledByPerson) {
    return OnCallPolicyAiHoldOutcome.HandledByPerson;
  }

  const isFixedByAi: boolean = data.suggestions.some(
    (suggestion: AiHoldSuggestionState): boolean => {
      return (
        suggestion.verificationStatus ===
          AutoRemediationVerificationStatus.Verified ||
        (suggestion.executionMode === AutoRemediationExecutionMode.FullAuto &&
          suggestion.status === AutoRemediationSuggestionStatus.AutoExecuted &&
          suggestion.verificationStatus !==
            AutoRemediationVerificationStatus.Failed &&
          suggestion.verificationStatus !==
            AutoRemediationVerificationStatus.Skipped)
      );
    },
  );

  return isFixedByAi
    ? OnCallPolicyAiHoldOutcome.ResolvedByAI
    : OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn;
}

// One record a held run pages about.
export interface AiHeldRecord {
  projectId: ObjectID;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
}

export default class AiFirstResponder {
  /*
   * Every minute: each record a run is held for, reviewed once, and kept,
   * resolved or handed off. A record acknowledged or resolved meanwhile is
   * the worker's to end (ExecutePendingExecutions): it is left alone here,
   * so nothing is paged about a record someone already took.
   */
  @CaptureSpan()
  public static async reviewHolds(): Promise<void> {
    const runs: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findBy({
        query: {
          status: OnCallDutyPolicyStatus.Waiting,
          aiHoldOutcome: OnCallPolicyAiHoldOutcome.Holding,
        },
        select: HELD_RUN_SELECT,
        limit: HELD_RUNS_READ_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

    const records: Map<string, AiHeldRecord> = new Map<string, AiHeldRecord>();

    for (const run of runs) {
      const record: AiHeldRecord | null = this.getAiHeldRecord(run);

      if (record) {
        records.set(this.getRecordKey(record), record);
      }
    }

    for (const record of records.values()) {
      try {
        await this.reviewRecord(record);
      } catch (error) {
        logger.error(
          `OneUptime AI could not review the page it holds for ${this.describeRecord(record)}: ${error}`,
          { projectId: record.projectId.toString() } as LogAttributes,
        );
      }
    }
  }

  // Reviews one held record now, and acts on the review.
  public static async reviewRecord(
    record: AiHeldRecord,
  ): Promise<AiHoldReview> {
    if (await this.isRecordHandled(record)) {
      return { action: AiHoldAction.Keep };
    }

    const review: AiHoldReview = reviewAiHold(
      await this.readRecordState(record, OneUptimeDate.getCurrentDate()),
    );

    if (review.action === AiHoldAction.Resolve) {
      await this.resolveRecord(record);
    }

    if (review.action === AiHoldAction.HandOff) {
      await this.handOff({
        ...record,
        reason: review.reason || AiHoldHandOffReason.noFixToRun(),
      });
    }

    return review;
  }

  /*
   * Hands the record's held runs to people now: each starts at its first
   * escalation rule, saying why. Returns how many this call started.
   */
  @CaptureSpan()
  public static async handOff(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    reason: string;
    outcome?: OnCallPolicyAiHoldOutcome | undefined;
  }): Promise<number> {
    if (!data.incidentId && !data.alertId) {
      return 0;
    }

    return await this.startHeldRuns({
      runs: await this.findHeldRuns({
        projectId: data.projectId,
        incidentId: data.incidentId,
        alertId: data.alertId,
      }),
      reason: data.reason,
      outcome: data.outcome || OnCallPolicyAiHoldOutcome.HandedOff,
    });
  }

  /*
   * Hands every page the project's AI holds to people now - or only those
   * of the given policies. For AI or fixing turned off, a rule changed, or
   * what looks like an outage.
   */
  @CaptureSpan()
  public static async handOffEveryHold(data: {
    projectId: ObjectID;
    reason: string;
    policyIds?: Array<ObjectID> | undefined;
  }): Promise<number> {
    if (data.policyIds && data.policyIds.length === 0) {
      return 0;
    }

    return await this.startHeldRuns({
      runs: await this.findHeldRuns({
        projectId: data.projectId,
        policyIds: data.policyIds,
      }),
      reason: data.reason,
      outcome: OnCallPolicyAiHoldOutcome.HandedOff,
    });
  }

  // Page now: someone wants a person on it, without waiting for AI.
  @CaptureSpan()
  public static async pageNow(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    userId?: ObjectID | undefined;
  }): Promise<number> {
    let userName: string | undefined = undefined;

    if (data.userId) {
      const user: User | null = await UserService.findOneById({
        id: data.userId,
        select: { name: true, email: true },
        props: { isRoot: true },
      });

      userName = user?.name?.toString() || user?.email?.toString() || undefined;
    }

    return await this.handOff({
      projectId: data.projectId,
      incidentId: data.incidentId,
      alertId: data.alertId,
      reason: AiHoldHandOffReason.pageNow({ userName: userName }),
      outcome: OnCallPolicyAiHoldOutcome.PageNowPressed,
    });
  }

  /*
   * A new alert or incident opened: with enough others just before it, the
   * project looks like it has an outage, and people take every page AI
   * holds. Reads nothing more in a project where AI holds none.
   */
  @CaptureSpan()
  public static async onRecordCreated(data: {
    projectId: ObjectID;
  }): Promise<void> {
    try {
      if (!(await this.hasHolds({ projectId: data.projectId }))) {
        return;
      }

      const opened: number =
        await AiFirstResponderEligibility.countOtherRecordsOpenedRecently({
          projectId: data.projectId,
        });

      // The count takes in the new record itself: it is one of the others.
      if (opened - 1 < AI_HOLD_OUTAGE_RECORD_COUNT) {
        return;
      }

      await this.handOffEveryHold({
        projectId: data.projectId,
        reason: AiHoldHandOffReason.outage({
          recordCount: opened,
          windowMinutes: AI_HOLD_OUTAGE_WINDOW_IN_MINUTES,
        }),
      });
    } catch (error) {
      logger.error(
        `OneUptime AI could not check for an outage in project ${data.projectId.toString()}: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }
  }

  /*
   * A held record changed: raised to the project's highest severity, it is
   * people's to take at once.
   */
  @CaptureSpan()
  public static async onRecordChanged(record: AiHeldRecord): Promise<void> {
    try {
      if (!(await this.hasHolds(record))) {
        return;
      }

      if (!(await this.isAtHighestSeverity(record))) {
        return;
      }

      await this.handOff({
        ...record,
        reason: AiHoldHandOffReason.highestSeverity({
          recordKind: record.alertId ? "alert" : "incident",
        }),
      });
    } catch (error) {
      logger.error(
        `OneUptime AI could not check the page it holds for ${this.describeRecord(record)} after it changed: ${error}`,
        { projectId: record.projectId.toString() } as LogAttributes,
      );
    }
  }

  /*
   * The project's AI switches changed: AI or automatic fixing turned off
   * hands every page AI holds to people - of incidents or alerts alone, for
   * the switch of their kind.
   */
  @CaptureSpan()
  public static async onProjectAiSettingsChanged(data: {
    projectId: ObjectID;
    isAiTurnedOff: boolean;
    isIncidentFixingTurnedOff: boolean;
    isAlertFixingTurnedOff: boolean;
  }): Promise<void> {
    try {
      if (data.isAiTurnedOff) {
        await this.handOffEveryHold({
          projectId: data.projectId,
          reason: AiHoldHandOffReason.aiTurnedOff(),
        });
        return;
      }

      for (const kind of [
        data.isIncidentFixingTurnedOff ? "incident" : null,
        data.isAlertFixingTurnedOff ? "alert" : null,
      ]) {
        if (!kind) {
          continue;
        }

        await this.startHeldRuns({
          runs: await this.findHeldRuns({
            projectId: data.projectId,
            recordKind: kind as AiHoldRecordKind,
          }),
          reason: AiHoldHandOffReason.automaticFixingTurnedOff({
            recordKind: kind as AiHoldRecordKind,
          }),
          outcome: OnCallPolicyAiHoldOutcome.HandedOff,
        });
      }
    } catch (error) {
      logger.error(
        `OneUptime AI could not hand off the pages it holds in project ${data.projectId.toString()}: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }
  }

  /*
   * A rule no longer lets OneUptime AI respond first - set to another
   * choice, disabled or deleted: the pages AI holds for its policies go to
   * people. A run does not say which rule held it, so every hold of those
   * policies goes.
   */
  @CaptureSpan()
  public static async onRuleStoppedHolding(data: {
    projectId: ObjectID;
    policyIds: Array<ObjectID>;
  }): Promise<void> {
    try {
      await this.handOffEveryHold({
        projectId: data.projectId,
        policyIds: data.policyIds,
        reason: AiHoldHandOffReason.ruleChanged(),
      });
    } catch (error) {
      logger.error(
        `OneUptime AI could not hand off the pages it holds for a changed on-call rule in project ${data.projectId.toString()}: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }
  }

  /*
   * How a held run's hold ended, when its record was acknowledged or
   * resolved while it waited (ExecutePendingExecutions).
   */
  public static async classifyEndedHold(
    run: OnCallDutyPolicyExecutionLog,
  ): Promise<OnCallPolicyAiHoldOutcome> {
    const record: AiHeldRecord | null = this.getAiHeldRecord(run);

    if (!record) {
      return OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn;
    }

    try {
      return classifyEndedAiHold({
        isHandledByPerson: await this.isHandledByPerson(record),
        suggestions: await this.readSuggestions(record),
      });
    } catch (error) {
      logger.error(
        `OneUptime AI could not tell how the page it held for ${this.describeRecord(record)} ended: ${error}`,
        { projectId: record.projectId.toString() } as LogAttributes,
      );

      return OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn;
    }
  }

  /*
   * Says in the record's feed why a rule set to After OneUptime AI paged
   * right away: what AI would need to respond first.
   */
  public static async sayWhyNotHeld(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    reason: string;
  }): Promise<void> {
    // The reason is OneUptime's own words: placed as text, not Markdown.
    const markdown: string =
      mdText`**OneUptime AI did not hold this page.** ${data.reason} The on-call policies paged right away.`.toString();

    try {
      if (data.incidentId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.incidentId,
          projectId: data.projectId,
          incidentFeedEventType: IncidentFeedEventType.OnCallPolicy,
          displayColor: Gray500,
          feedInfoInMarkdown: markdown,
        });
      } else if (data.alertId) {
        await AlertFeedService.createAlertFeedItem({
          alertId: data.alertId,
          projectId: data.projectId,
          alertFeedEventType: AlertFeedEventType.OnCallPolicy,
          displayColor: Gray500,
          feedInfoInMarkdown: markdown,
        });
      }
    } catch (error) {
      logger.error(
        `Could not say in the feed why OneUptime AI did not hold the page: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }
  }

  // The runs AI holds: of one record, of some policies, or of the project.
  public static async findHeldRuns(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    policyIds?: Array<ObjectID> | undefined;
    recordKind?: AiHoldRecordKind | undefined;
  }): Promise<Array<OnCallDutyPolicyExecutionLog>> {
    return await OnCallDutyPolicyExecutionLogService.findBy({
      query: {
        projectId: data.projectId,
        status: OnCallDutyPolicyStatus.Waiting,
        aiHoldOutcome: OnCallPolicyAiHoldOutcome.Holding,
        ...(data.incidentId ? { triggeredByIncidentId: data.incidentId } : {}),
        ...(data.alertId ? { triggeredByAlertId: data.alertId } : {}),
        ...(data.policyIds
          ? { onCallDutyPolicyId: QueryHelper.any(data.policyIds) }
          : {}),
        ...(data.recordKind === "incident"
          ? { triggeredByIncidentId: QueryHelper.notNull() }
          : {}),
        ...(data.recordKind === "alert"
          ? { triggeredByAlertId: QueryHelper.notNull() }
          : {}),
      },
      select: HELD_RUN_SELECT,
      limit: HELD_RUNS_READ_LIMIT,
      skip: 0,
      props: { isRoot: true },
    });
  }

  // Whether AI holds a page: of one record, or anywhere in the project.
  public static async hasHolds(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<boolean> {
    return (
      (
        await OnCallDutyPolicyExecutionLogService.countBy({
          query: {
            projectId: data.projectId,
            status: OnCallDutyPolicyStatus.Waiting,
            aiHoldOutcome: OnCallPolicyAiHoldOutcome.Holding,
            ...(data.incidentId
              ? { triggeredByIncidentId: data.incidentId }
              : {}),
            ...(data.alertId ? { triggeredByAlertId: data.alertId } : {}),
          },
          props: { isRoot: true },
        })
      ).toNumber() > 0
    );
  }

  /*
   * Starts each run where it waits, saying why. Of two hand-offs that race,
   * the claim lets one start a run; the other starts nothing.
   */
  private static async startHeldRuns(data: {
    runs: Array<OnCallDutyPolicyExecutionLog>;
    reason: string;
    outcome: OnCallPolicyAiHoldOutcome;
  }): Promise<number> {
    let started: number = 0;
    const now: Date = OneUptimeDate.getCurrentDate();

    for (const run of data.runs) {
      try {
        if (
          await OnCallDutyPolicyExecutionLogService.startWaitingRun({
            run: run,
            now: now,
            startedEarlyReason: data.reason,
            aiHoldOutcome: data.outcome,
          })
        ) {
          started++;
        }
      } catch (error) {
        logger.error(
          `Could not hand off on-call execution log ${run.id?.toString()} that OneUptime AI held: ${error}`,
          { projectId: run.projectId?.toString() } as LogAttributes,
        );
      }
    }

    return started;
  }

  public static async readRecordState(
    record: AiHeldRecord,
    now: Date,
  ): Promise<AiHoldRecordState> {
    let recordCreatedAt: Date | undefined = undefined;
    let investigationWaitUntil: Date | undefined = undefined;
    let investigationNotStartedTitle: string | undefined = undefined;

    if (record.incidentId) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: record.incidentId,
        select: {
          createdAt: true,
          aiInvestigationDecision: true,
          aiInvestigationWaitUntil: true,
        },
        props: { isRoot: true },
      });

      recordCreatedAt = incident?.createdAt;
      investigationWaitUntil = incident?.aiInvestigationWaitUntil;
      investigationNotStartedTitle =
        incident?.aiInvestigationDecision?.title || undefined;
    } else if (record.alertId) {
      const alert: Alert | null = await AlertService.findOneById({
        id: record.alertId,
        select: {
          createdAt: true,
          aiInvestigationDecision: true,
          aiInvestigationWaitUntil: true,
        },
        props: { isRoot: true },
      });

      recordCreatedAt = alert?.createdAt;
      investigationWaitUntil = alert?.aiInvestigationWaitUntil;
      investigationNotStartedTitle =
        alert?.aiInvestigationDecision?.title || undefined;
    }

    const investigation: AIRun | null = await AIRunService.findOneBy({
      query: {
        projectId: record.projectId,
        runType: AIRunType.Investigation,
        ...(record.incidentId
          ? { triggeredByIncidentId: record.incidentId }
          : { triggeredByAlertId: record.alertId! }),
      },
      sort: { createdAt: SortOrder.Descending },
      select: { _id: true, status: true, completedAt: true, updatedAt: true },
      props: { isRoot: true },
    });

    const decision: AutoRemediationDecision | null =
      await AutoRemediationDecisionService.findOneBy({
        query: {
          projectId: record.projectId,
          ...(record.incidentId
            ? { incidentId: record.incidentId }
            : { alertId: record.alertId! }),
        },
        select: { _id: true, stage: true },
        props: { isRoot: true },
      });

    const settledAt: Date | undefined =
      investigation?.completedAt || investigation?.updatedAt || undefined;

    return {
      recordKind: record.alertId ? "alert" : "incident",
      now: now,
      recordCreatedAt: recordCreatedAt
        ? OneUptimeDate.fromString(recordCreatedAt)
        : undefined,
      investigationWaitUntil: investigationWaitUntil
        ? OneUptimeDate.fromString(investigationWaitUntil)
        : undefined,
      investigationNotStartedTitle: investigationNotStartedTitle,
      investigationStatus: investigation?.status,
      investigationSettledAt: settledAt
        ? OneUptimeDate.fromString(settledAt)
        : undefined,
      isRemediationEvaluated:
        decision?.stage === AutoRemediationDecisionStage.Evaluated,
      suggestions: await this.readSuggestions(record),
    };
  }

  private static async readSuggestions(
    record: AiHeldRecord,
  ): Promise<Array<AiHoldSuggestionState>> {
    const suggestions: Array<AutoRemediationSuggestion> =
      await AutoRemediationSuggestionService.findBy({
        query: {
          projectId: record.projectId,
          ...(record.incidentId
            ? { incidentId: record.incidentId }
            : { alertId: record.alertId! }),
        },
        select: {
          _id: true,
          status: true,
          executionMode: true,
          verificationStatus: true,
        },
        sort: { createdAt: SortOrder.Descending },
        limit: 20,
        skip: 0,
        props: { isRoot: true },
      });

    return suggestions.map(
      (suggestion: AutoRemediationSuggestion): AiHoldSuggestionState => {
        return {
          status: suggestion.status,
          executionMode: suggestion.executionMode,
          verificationStatus: suggestion.verificationStatus,
        };
      },
    );
  }

  /*
   * Resolves the record as OneUptime AI: its fix was verified. Its held runs
   * end on the worker's next tick, having paged nobody.
   */
  private static async resolveRecord(record: AiHeldRecord): Promise<void> {
    const rootCause: string =
      mdText`Resolved by OneUptime AI: its fix was verified - every affected monitor is operational again - so nobody was paged.`.toString();

    try {
      if (record.incidentId) {
        const timeline: IncidentStateTimeline = new IncidentStateTimeline();
        timeline.incidentId = record.incidentId;
        timeline.incidentStateId =
          await IncidentStateTimelineService.getResolvedStateIdForProject(
            record.projectId,
          );
        timeline.projectId = record.projectId;
        timeline.rootCause = rootCause;

        await IncidentStateTimelineService.create({
          data: timeline,
          props: { isRoot: true },
        });
      } else if (record.alertId) {
        const timeline: AlertStateTimeline = new AlertStateTimeline();
        timeline.alertId = record.alertId;
        timeline.alertStateId =
          await AlertStateTimelineService.getResolvedStateIdForProject(
            record.projectId,
          );
        timeline.projectId = record.projectId;
        timeline.rootCause = rootCause;

        await AlertStateTimelineService.create({
          data: timeline,
          props: { isRoot: true },
        });
      }
    } catch (error) {
      if (
        error instanceof BadDataException &&
        (error.message === "Incident state cannot be same as previous state." ||
          error.message === "Alert state cannot be same as previous state.")
      ) {
        // Resolved already, by the verifier or a person: what was wanted.
        return;
      }

      throw error;
    }
  }

  private static async isRecordHandled(record: AiHeldRecord): Promise<boolean> {
    if (record.incidentId) {
      return await IncidentService.isIncidentAcknowledged({
        incidentId: record.incidentId,
      });
    }

    if (record.alertId) {
      return await AlertService.isAlertAcknowledged({
        alertId: record.alertId,
      });
    }

    return true;
  }

  // Whether the change that acknowledged or resolved the record was a person's.
  private static async isHandledByPerson(
    record: AiHeldRecord,
  ): Promise<boolean> {
    if (record.incidentId) {
      const latest: IncidentStateTimeline | null =
        await IncidentStateTimelineService.findOneBy({
          query: { incidentId: record.incidentId },
          sort: { startsAt: SortOrder.Descending },
          select: { _id: true, createdByUserId: true },
          props: { isRoot: true },
        });

      return Boolean(latest?.createdByUserId);
    }

    if (record.alertId) {
      const latest: AlertStateTimeline | null =
        await AlertStateTimelineService.findOneBy({
          query: { alertId: record.alertId },
          sort: { startsAt: SortOrder.Descending },
          select: { _id: true, createdByUserId: true },
          props: { isRoot: true },
        });

      return Boolean(latest?.createdByUserId);
    }

    return false;
  }

  private static async isAtHighestSeverity(
    record: AiHeldRecord,
  ): Promise<boolean> {
    if (record.incidentId) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: record.incidentId,
        select: { incidentSeverityId: true },
        props: { isRoot: true },
      });

      const highest: IncidentSeverity | null =
        await IncidentSeverityService.findOneBy({
          query: { projectId: record.projectId },
          sort: { order: SortOrder.Ascending },
          select: { _id: true },
          props: { isRoot: true },
        });

      return Boolean(
        highest?.id &&
          incident?.incidentSeverityId &&
          highest.id.toString() === incident.incidentSeverityId.toString(),
      );
    }

    if (record.alertId) {
      const alert: Alert | null = await AlertService.findOneById({
        id: record.alertId,
        select: { alertSeverityId: true },
        props: { isRoot: true },
      });

      const highest: AlertSeverity | null =
        await AlertSeverityService.findOneBy({
          query: { projectId: record.projectId },
          sort: { order: SortOrder.Ascending },
          select: { _id: true },
          props: { isRoot: true },
        });

      return Boolean(
        highest?.id &&
          alert?.alertSeverityId &&
          highest.id.toString() === alert.alertSeverityId.toString(),
      );
    }

    return false;
  }

  private static getAiHeldRecord(
    run: OnCallDutyPolicyExecutionLog,
  ): AiHeldRecord | null {
    if (!run.projectId) {
      return null;
    }

    if (run.triggeredByIncidentId) {
      return {
        projectId: run.projectId,
        incidentId: run.triggeredByIncidentId,
      };
    }

    if (run.triggeredByAlertId) {
      return { projectId: run.projectId, alertId: run.triggeredByAlertId };
    }

    return null;
  }

  private static getRecordKey(record: AiHeldRecord): string {
    return record.incidentId
      ? `incident:${record.incidentId.toString()}`
      : `alert:${record.alertId?.toString()}`;
  }

  private static describeRecord(record: AiHeldRecord): string {
    return record.incidentId
      ? `incident ${record.incidentId.toString()}`
      : `alert ${record.alertId?.toString()}`;
  }
}
