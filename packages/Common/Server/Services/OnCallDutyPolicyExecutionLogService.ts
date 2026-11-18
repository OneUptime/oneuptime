import ProjectMilestoneService from "./ProjectMilestoneService";
import ActivationMilestone from "../../Types/Analytics/ActivationMilestone";
import CreateBy from "../Types/Database/CreateBy";
import CountBy from "../Types/Database/CountBy";
import FindBy from "../Types/Database/FindBy";
import {
  DatabaseTriggerType,
  OnCreate,
  OnFind,
  OnUpdate,
} from "../Types/Database/Hooks";
import PrivateRecordReadFilter from "../Utils/Permission/PrivateRecordReadFilter";
import ProjectReferencesService from "./ProjectReferencesService";
import OnCallDutyPolicyEscalationRuleService, {
  OnCallPagingOutcome,
  OnCallRuleExecutionOutcome,
} from "./OnCallDutyPolicyEscalationRuleService";
import OnCallEscalationAdvance, {
  OnCallEscalationAdvanceResult,
} from "../Utils/OnCall/OnCallEscalationAdvance";
import OnCallPageTiming, {
  OnCallPageStartMoment,
} from "../Utils/OnCall/OnCallPageTiming";
import UserOnCallLogService from "./UserOnCallLogService";
import UserService from "./UserService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../Types/PositiveNumber";
import UserNotificationExecutionStatus from "../../Types/UserNotification/UserNotificationExecutionStatus";
import QueryHelper from "../Types/Database/QueryHelper";
import { ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE } from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { hasOnCallRunStartedALevel } from "../../Types/OnCallDutyPolicy/OnCallRunLevel";
import {
  ON_CALL_RUN_EXECUTION_STARTED_MESSAGE,
  ON_CALL_RUN_PAGING_STARTED_MESSAGE,
  ON_CALL_RUN_SCHEDULED_MESSAGE,
} from "../../Types/OnCallDutyPolicy/OnCallRunStart";
import { OnCallPolicyAiHoldOutcome } from "../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import { toOnCallPersonPageMessage } from "../../Types/OnCallDutyPolicy/OnCallPersonPage";
import { isOnCallObserverPage } from "../../Types/OnCallDutyPolicy/OnCallObserverPage";
import { getOnCallPolicyStartedOnResolvedRecordMessage } from "../../Types/OnCallDutyPolicy/OnCallPolicyStartedByHand";
import type {
  OnCallTimeoutRecordKind,
  OnCallTimeoutRecordState,
} from "../Utils/OnCall/OnCallAcknowledgementTimeout";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Blue500, Green500, Red500, Yellow500 } from "../../Types/BrandColors";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import ObjectID from "../../Types/ObjectID";

import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import Color from "../../Types/Color";
import AlertFeedService from "./AlertFeedService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import BadDataException from "../../Types/Exception/BadDataException";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import { ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE } from "../../Types/OnCallDutyPolicy/OnCallPageLine";
import {
  ON_CALL_POLICY_RUN_STARTED_EARLY_REASON_MAX_LENGTH,
  getOnCallPolicyRunPagingDueAt,
  getOnCallPolicyRunWaitingMessage,
} from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import { In, IsNull, Not, UpdateResult } from "typeorm";
import OnCallRunFailure, {
  OnCallRunFailureKind,
} from "../Utils/OnCall/OnCallRunFailure";
import OnCallLevelsInFlight, {
  OnCallLevelInFlight,
  OnCallPageAgainInFlight,
} from "../Utils/OnCall/OnCallLevelsInFlight";
import FeedMarkdown, { MarkdownText } from "../../Utils/Markdown/FeedMarkdown";
import logger, { LogAttributes } from "../Utils/Logger";
import OnCallPolicyRunMessage from "../Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OnCallRunPageMessage from "../Utils/OnCall/OnCallRunPageMessage";
import OnCallFeedText, {
  OnCallDirectPagePager,
} from "../Utils/OnCall/OnCallFeedText";
import {
  MAX_ON_CALL_DIRECT_PAGE_TARGETS,
  ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
  ON_CALL_POLICY_REQUIRED_MESSAGE,
  OnCallDirectPageTargets,
  countOnCallDirectPageTargets,
  getOnCallDirectPagePagingMessage,
  hasOnCallDirectPageWaitedForAcknowledgement,
  isOnCallDirectPage,
} from "../../Types/OnCallDutyPolicy/OnCallDirectPage";
import OneUptimeDate from "../../Types/Date";
import {
  getOnCallPageAgainStatusMessage,
  isOnCallPageAgainRun,
} from "../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE,
  ON_CALL_TEST_PAGE_FIRST_LEVEL_REACHED_NOBODY_MESSAGE,
  ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
  ON_CALL_TEST_PAGE_STARTED_ELSEWHERE_MESSAGE,
  OnCallTestPageRecordKind,
  getOnCallTestPagePagingMessage,
  isOnCallTestPage,
} from "../../Types/OnCallDutyPolicy/OnCallTestPage";
import { JSONObject } from "../../Types/JSON";
import { OnCallFireDrillFailureRecord } from "../../Types/OnCallDutyPolicy/OnCallFireDrill";

/*
 * Who started a direct page, for its run to record: the person, or the
 * workflow whose step did, by the name it has now.
 */
export interface OnCallDirectPageStartedBy {
  userId?: ObjectID | undefined;
  workflowId?: ObjectID | undefined;
  workflowName?: string | undefined;
}

// A direct page that was started: its run, and who it paged and did not.
export interface OnCallDirectPageRun {
  executionLogId: ObjectID;
  outcome: OnCallPagingOutcome;
}

/*
 * The fire drill a policy's test is part of (#9386): the drill, the same on
 * every policy's test it starts; the monitor whose failure it rehearses; and
 * that failure, as the drill's dialog named it.
 */
export interface OnCallFireDrillOfRun {
  fireDrillId: ObjectID;
  monitorId: ObjectID;
  failure: OnCallFireDrillFailureRecord;
}

/*
 * The statuses of a person's page that keep a direct page open
 * (endDirectPageIfItsPagesAreOver): its notifications are still going out,
 * or it is merged into the person's open page from another run and waits on
 * it (OnCallPageMerge, #8859) - it takes the page over should that one end
 * without their answer, so the direct page is not over while it waits.
 */
export const ON_CALL_DIRECT_PAGE_STATUSES_STILL_OUT: ReadonlyArray<UserNotificationExecutionStatus> =
  [
    UserNotificationExecutionStatus.Scheduled,
    UserNotificationExecutionStatus.Started,
    UserNotificationExecutionStatus.Executing,
    UserNotificationExecutionStatus.AlreadyPaged,
  ];

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 30);
    }
  }

  /*
   * Execution logs are written by OneUptime as it runs an on-call policy, for
   * the policy, incident or alert it is paging about. Refusing one would stop
   * the page. An execution log written by an API call or a workflow is checked
   * like any other write.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /*
   * A page about a private incident, alert or episode is read only by those
   * who see that record (PrivateRecordReadFilter): its own columns say who
   * was paged about it and what the person who paged wrote, and its
   * relation reads the record itself. A page about no private record is
   * read as before.
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = PrivateRecordReadFilter.apply(
      findBy.query,
      findBy.props,
      Model,
    );

    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = PrivateRecordReadFilter.apply(
      countBy.query,
      countBy.props,
      Model,
    );

    return await super.countBy(countBy);
  }

  // The read hook narrows by the records a page is about. See onBeforeFind.
  public override getColumnsReadHooksNarrowBy(): Array<string> {
    return PrivateRecordReadFilter.getNamedRecordColumnNames(Model);
  }

  /**
   * Atomically claim the right to advance this execution to its next escalation
   * rule on the current tick. Implemented as a single conditional
   * `UPDATE ... WHERE lastEscalationRuleExecutedAt = <the value just read>`
   * (via TypeORM's repository.update, which emits one atomic statement and
   * returns the affected-row count), so that when two overlapping cron runs read
   * the same lastEscalationRuleExecutedAt, exactly one wins — the loser sees
   * `affected === 0` and bows out instead of double-paging responders (audit
   * F13). `updateOneBy` could NOT provide this: it does a non-locking SELECT and
   * then `save()` keyed only on `_id`, and returns the SELECT match count, so
   * both overlapping runs would "win".
   */
  @CaptureSpan()
  public async claimEscalationAdvance(data: {
    executionLogId: ObjectID;
    previousLastEscalationRuleExecutedAt: Date | null;
    newLastEscalationRuleExecutedAt: Date;
  }): Promise<boolean> {
    const whereClause: Record<string, unknown> = {
      _id: data.executionLogId.toString(),
      status: OnCallDutyPolicyStatus.Executing,
      lastEscalationRuleExecutedAt: data.previousLastEscalationRuleExecutedAt
        ? data.previousLastEscalationRuleExecutedAt
        : IsNull(),
    };

    const result: UpdateResult = await this.getRepository().update(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      whereClause as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        lastEscalationRuleExecutedAt: data.newLastEscalationRuleExecutedAt,
      } as any,
    );

    return (result.affected || 0) > 0;
  }

  /*
   * RECORDS AN ESCALATION RULE'S PLACE NOW ON THE RUNS STILL ON IT, as the
   * rule is about to be deleted (issue #9036).
   *
   * Deleting the rule keeps those runs and clears it from them (ON DELETE
   * SET NULL); each then goes on from the place it recorded - to the level
   * that moves up into the deleted one's - once the wait it started is over
   * (OnCallRunLevel). The place a run recorded when it reached the level is
   * out of date if a level before it was added or deleted since, so it is
   * written again from the rule as it is now. One statement, found by the
   * rule's own index (lastExecutedEscalationRuleId) - never by the place,
   * which no index holds (OnCallExecutionLogStepColumnReads); runs already
   * over keep what they recorded, and the moment the claims compare
   * (lastEscalationRuleExecutedAt) is left alone. Returns how many runs it
   * wrote.
   */
  @CaptureSpan()
  public async recordPlaceOfRunsOnRule(data: {
    ruleId: ObjectID;
    order: number;
  }): Promise<number> {
    const result: UpdateResult = await this.getRepository().update(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        lastExecutedEscalationRuleId: data.ruleId.toString(),
        status: In([
          OnCallDutyPolicyStatus.Executing,
          OnCallDutyPolicyStatus.Started,
          OnCallDutyPolicyStatus.Scheduled,
        ]),
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        lastExecutedEscalationRuleOrder: data.order,
      } as any,
    );

    return result.affected || 0;
  }

  /*
   * GIVES BACK A CLAIM TO MOVE A RUN ON THAT PAGED NOBODY (issue #8167).
   *
   * A move on (OnCallEscalationAdvance) is claimed first, by moving the
   * run's lastEscalationRuleExecutedAt to the moment of the claim - which
   * also starts the wait of the rule the run is on afresh. A move that
   * failed after its claim but before it started its next rule - before
   * anybody was paged - would leave the run to wait that rule's whole wait
   * again (half an hour, say) before it is tried again. So the claim is
   * given back: the run's moment is put back as it was, and the worker's
   * next tick tries the move again at once.
   *
   * Only while the run is as the claim left it: still executing, its moment
   * still the claim's, on the same rule and the same pass. A run that
   * started its next rule - some of whose people may be paged - began its
   * policy again, ended, or that somebody else moved on keeps what it has,
   * so nobody is paged twice. Never throws: a claim that cannot be given
   * back is kept, and the run waits its rule's wait again, as it did.
   */
  @CaptureSpan()
  public async giveBackEscalationAdvance(data: {
    executionLogId: ObjectID;
    // What the claim wrote.
    claimedLastEscalationRuleExecutedAt: Date;
    // What the claim found, and is put back.
    previousLastEscalationRuleExecutedAt: Date | null;
    // The rule the run was on, and its pass, when it was claimed.
    lastExecutedEscalationRuleId: ObjectID | null;
    onCallPolicyExecutionRepeatCount: number | null;
    /*
     * Throw what the database throws, rather than log it and say nothing
     * was given back: for a caller that tries again later (issue #8410).
     */
    throwOnError?: boolean | undefined;
    /*
     * The rule the run is on reached nobody, and was claimed past at once
     * (issue #8515): giving the claim back also clears the rule's wait, so
     * the run moves on now rather than after it.
     */
    clearWait?: boolean | undefined;
  }): Promise<boolean> {
    try {
      const current: Model | null = await this.findOneById({
        id: data.executionLogId,
        select: {
          status: true,
          lastEscalationRuleExecutedAt: true,
          lastExecutedEscalationRuleId: true,
          onCallPolicyExecutionRepeatCount: true,
        },
        props: {
          isRoot: true,
        },
      });

      /*
       * The same level: the same rule - or the rule it was on then, deleted
       * since, which clears it from the run (ON DELETE SET NULL, issue
       * #9036). Nothing else clears it: moving on to another level names
       * that level's rule.
       */
      const currentRuleId: string | null =
        current?.lastExecutedEscalationRuleId?.toString() || null;
      const claimedRuleId: string | null =
        data.lastExecutedEscalationRuleId?.toString() || null;

      const isOnTheSameRuleAndPass: boolean = Boolean(
        current &&
          current.status === OnCallDutyPolicyStatus.Executing &&
          (currentRuleId === claimedRuleId ||
            (currentRuleId === null && claimedRuleId !== null)) &&
          (current.onCallPolicyExecutionRepeatCount ?? null) ===
            (data.onCallPolicyExecutionRepeatCount ?? null),
      );

      const isAsClaimed: boolean = Boolean(
        isOnTheSameRuleAndPass &&
          current!.lastEscalationRuleExecutedAt &&
          new Date(current!.lastEscalationRuleExecutedAt).getTime() ===
            data.claimedLastEscalationRuleExecutedAt.getTime(),
      );

      /*
       * A claim past a level that reached nobody whose process stopped
       * before the claim itself was written (issue #8515): the run is as
       * it was before it, waiting out the level's wait - which is cleared.
       */
      const isAsBeforeTheClaim: boolean = Boolean(
        data.clearWait &&
          isOnTheSameRuleAndPass &&
          data.previousLastEscalationRuleExecutedAt &&
          current!.lastEscalationRuleExecutedAt &&
          new Date(current!.lastEscalationRuleExecutedAt).getTime() ===
            data.previousLastEscalationRuleExecutedAt.getTime(),
      );

      if (!isAsClaimed && !isAsBeforeTheClaim) {
        return false;
      }

      const result: UpdateResult = await this.getRepository().update(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          _id: data.executionLogId.toString(),
          status: OnCallDutyPolicyStatus.Executing,
          lastEscalationRuleExecutedAt: isAsClaimed
            ? data.claimedLastEscalationRuleExecutedAt
            : data.previousLastEscalationRuleExecutedAt,
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          lastEscalationRuleExecutedAt:
            data.previousLastEscalationRuleExecutedAt,
          ...(data.clearWait ? { executeNextEscalationRuleInMinutes: 0 } : {}),
        } as any,
      );

      return (result.affected || 0) > 0;
    } catch (err) {
      if (data.throwOnError) {
        throw err;
      }

      logger.error(
        `Could not give back the claim to move on-call execution log ${data.executionLogId.toString()} on; it waits its rule's wait again before it is tried.`,
      );
      logger.error(err as Error);

      return false;
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * An execution log is a run of the on-call policy it names. The one that
     * names none is a direct page, which only OneUptime starts
     * (startDirectPage): an API call or a workflow's Create One step that
     * leaves the policy out is told to name it, as it always was.
     */
    if (
      !createBy.props.isRoot &&
      !RelationIdUtil.readConsistent(
        createBy.data as unknown as Record<string, unknown>,
        ["onCallDutyPolicyId", "onCallDutyPolicy"],
        "On-Call Policy",
      )
    ) {
      throw new BadDataException(ON_CALL_POLICY_REQUIRED_MESSAGE);
    }

    /*
     * A test page (OnCallTestPage) is OneUptime's own run, started where who
     * may send it and how often are checked (OnCallTestPageService). An API
     * call or a workflow that writes one is told where to send it from, so a
     * test cannot be sent past its limits.
     */
    if (!createBy.props.isRoot && isOnCallTestPage(createBy.data)) {
      throw new BadDataException(ON_CALL_TEST_PAGE_STARTED_ELSEWHERE_MESSAGE);
    }

    /*
     * A run that starts paging later is created waiting, and only that one
     * (OnCallDutyPolicyRunWait): one asked to wait with no moment to wait
     * for, or with a moment already past, is scheduled to page now.
     */
    const now: Date = OneUptimeDate.getCurrentDate();
    const pagingStartsAt: Date | undefined = createBy.data.pagingStartsAt
      ? OneUptimeDate.fromString(createBy.data.pagingStartsAt)
      : undefined;
    const waitsToPage: boolean = Boolean(
      pagingStartsAt &&
        !isNaN(pagingStartsAt.getTime()) &&
        OneUptimeDate.isAfter(pagingStartsAt, now),
    );

    if (waitsToPage) {
      if (createBy.data.status !== OnCallDutyPolicyStatus.Waiting) {
        createBy.data.status = OnCallDutyPolicyStatus.Waiting;
        createBy.data.statusMessage = "";
      }

      if (!createBy.data.statusMessage) {
        createBy.data.statusMessage = getOnCallPolicyRunWaitingMessage({
          pagingStartsAt: pagingStartsAt!,
          now: now,
          isWaitingForWorkingHours: false,
        });
      }
    } else {
      (createBy.data as unknown as Record<string, unknown>)["pagingStartsAt"] =
        undefined;
      // Paging now: there is no hold for OneUptime AI to keep either.
      (createBy.data as unknown as Record<string, unknown>)["aiHoldOutcome"] =
        undefined;

      if (createBy.data.status === OnCallDutyPolicyStatus.Waiting) {
        createBy.data.status = OnCallDutyPolicyStatus.Scheduled;
        createBy.data.statusMessage = "";
      }
    }

    if (!createBy.data.status) {
      createBy.data.status = OnCallDutyPolicyStatus.Scheduled;
    }

    if (!createBy.data.statusMessage) {
      createBy.data.statusMessage = ON_CALL_RUN_SCHEDULED_MESSAGE;
    }

    /*
     * Triggered by the person making the request. DatabaseService has
     * already taken out whatever triggeredByUser the request named, under
     * both names (UserAttribution), so with no person on it - an API key, a
     * workflow - nobody triggered it by hand. Stamped with stamp, so a
     * relation a server caller names beside it is not what is stored.
     */
    if (createBy.props.userId) {
      RelationIdUtil.stamp(
        createBy.data as unknown as Record<string, unknown>,
        ["triggeredByUserId", "triggeredByUser"],
        createBy.props.userId,
      );
    }

    createBy.data.onCallPolicyExecutionRepeatCount = 1;

    /*
     * An archived policy pages no one, however its execution is asked for:
     * a record's Execute On-Call Policy in the dashboard, the API, Slack or
     * Microsoft Teams (OnCallDutyPolicyArchive). The log is still written,
     * with the reason, so "why was nobody paged?" has an answer on the
     * record; onCreateSuccess then starts no escalation.
     */
    const isPolicyArchived: boolean = await this.isPolicyArchived(
      createBy.data,
    );

    if (isPolicyArchived) {
      createBy.data.status = OnCallDutyPolicyStatus.Error;
      createBy.data.statusMessage =
        ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE;
    }

    return {
      createBy,
      carryForward: {
        isPolicyArchived: isPolicyArchived,
      },
    };
  }

  /*
   * A run a workflow's step started records the workflow: its id and the
   * name it has now, for the run's feed entries, its Slack and Microsoft
   * Teams message and the Dashboard to say "Workflow <name>". No caller may
   * write those columns, so they are written here, once every check on the
   * caller has passed, rather than held against their column permissions -
   * and never from what a request sent.
   */
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps = onCreate.createBy.props;

    /*
     * A person starting a policy by hand (OnCallPolicyStartedByHand) - the
     * Dashboard's Execute On-Call Policy, a page that names the policy, the
     * API signed in as them - for a record that is resolved is told so, and
     * nothing starts: nobody is needed any more, and the policy's first
     * level would have been paged about it all the same before the run
     * ended a minute later. Slack and Microsoft Teams say so before they
     * get here (WorkspaceLatePress.ExecuteOnCallPolicy). Asked once every
     * check on the caller has passed, so nobody who may not start a run
     * learns where a record stands. OneUptime's own runs, a workflow's and
     * an API key's are left as they were.
     */
    if (!props.isRoot && props.userId && !props.workflowId) {
      const resolvedRecordKind: string | null =
        await this.readResolvedRecordKind(onCreate.createBy.data);

      if (resolvedRecordKind) {
        throw new BadDataException(
          getOnCallPolicyStartedOnResolvedRecordMessage(resolvedRecordKind),
        );
      }
    }

    /*
     * What the person who paged wrote, for a policy a page from Slack or
     * Microsoft Teams starts as them (OnCallRunPageMessage): on the run
     * from its creation, so the notifications its first level sends as it
     * is created carry it. OneUptime's to write, never the caller's.
     */
    const pageMessage: string | undefined = OnCallRunPageMessage.take();

    if (pageMessage) {
      onCreate.createBy.data.pageMessage = pageMessage;
    }

    if (!props.workflowId) {
      return;
    }

    onCreate.createBy.data.triggeredByWorkflowId = props.workflowId;

    const workflowName: string = (props.workflowName || "").trim();

    if (workflowName) {
      onCreate.createBy.data.triggeredByWorkflowName = workflowName;
    }
  }

  /*
   * The record a new run is about, in words - "incident", "alert episode" -
   * when it is resolved; null while it is not, when the run is about none,
   * or when where it stands cannot be read: a policy that could not be
   * checked is started, as it always was, rather than lost. The clock's
   * reader of a record's state (OnCallAcknowledgementTimeout) is loaded
   * when it is needed: it reads this service, so a static import would be a
   * cycle.
   */
  private async readResolvedRecordKind(data: Model): Promise<string | null> {
    try {
      const timeout: typeof import("../Utils/OnCall/OnCallAcknowledgementTimeout") =
        await import("../Utils/OnCall/OnCallAcknowledgementTimeout");

      const record: {
        kind: OnCallTimeoutRecordKind;
        recordId: ObjectID;
      } | null = timeout.default.getRunRecord(data);

      if (!record) {
        return null;
      }

      const state: OnCallTimeoutRecordState | null =
        await timeout.default.readRecordState(record);

      return state?.isResolved ? record.kind : null;
    } catch (err) {
      logger.error(
        "Could not read whether the record of a policy started by hand is resolved; starting it.",
        { projectId: data.projectId?.toString() } as LogAttributes,
      );
      logger.error(err as Error);
      return null;
    }
  }

  /*
   * STARTS A DIRECT PAGE: pages the people, the teams' members and whoever
   * is on call in the schedules it names, about one incident or one alert,
   * all at once and with no on-call policy behind the page
   * (Types/OnCallDutyPolicy/OnCallDirectPage).
   *
   * The page is a run like an on-call policy's - an execution log, with a
   * timeline line for everybody it paged or could not - so everything that
   * follows a run follows it: each person's own On-Call Rules decide how
   * they are reached, acknowledging a page acknowledges the record, the
   * record's feed says who was paged, and Slack and Microsoft Teams get the
   * run's one message.
   *
   * This is OneUptime's own write: whoever calls it has decided the caller
   * may page these people about this record (OnCallPageService does, with
   * the caller's own permissions). It hands back the run and what came of
   * it. A page that reaches nobody is still a run, ended at once, so the
   * record says a page was tried and why it reached nobody.
   */
  @CaptureSpan()
  public async startDirectPage(data: {
    projectId: ObjectID;
    targets: OnCallDirectPageTargets;
    triggeredByIncidentId?: ObjectID | undefined;
    triggeredByAlertId?: ObjectID | undefined;
    startedBy?: OnCallDirectPageStartedBy | undefined;
    /*
     * What the person who paged wrote to the people the page reaches, for a
     * page about a record that was there already (OnCallPageService). Kept
     * on the run, from its creation: its chat message is first posted from
     * the run as it is then.
     */
    pageMessage?: string | undefined;
    /*
     * Pages its people as observers (OnCallObserverPage): kept informed, and
     * answering only says they have seen it. Left out, they are paged as
     * responders.
     */
    isObserverPage?: boolean | undefined;
  }): Promise<OnCallDirectPageRun> {
    if (
      Boolean(data.triggeredByIncidentId) === Boolean(data.triggeredByAlertId)
    ) {
      throw new BadDataException(
        "A page is about one incident or one alert. Name one of them.",
      );
    }

    const targetCount: number = countOnCallDirectPageTargets(data.targets);

    if (targetCount === 0) {
      throw new BadDataException(
        "A page needs somebody to page: a person, a team or an on-call schedule.",
      );
    }

    if (targetCount > MAX_ON_CALL_DIRECT_PAGE_TARGETS) {
      throw new BadDataException(
        `A page names at most ${MAX_ON_CALL_DIRECT_PAGE_TARGETS} people, teams and on-call schedules. This one names ${targetCount}.`,
      );
    }

    const log: Model = new Model();

    log.projectId = data.projectId;
    log.status = OnCallDutyPolicyStatus.Scheduled;
    log.statusMessage = ON_CALL_RUN_SCHEDULED_MESSAGE;

    if (data.triggeredByIncidentId) {
      log.triggeredByIncidentId = data.triggeredByIncidentId;
      log.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    } else {
      log.triggeredByAlertId = data.triggeredByAlertId!;
      log.userNotificationEventType = UserNotificationEventType.AlertCreated;
    }

    const pageMessage: string = toOnCallPersonPageMessage(data.pageMessage);

    if (pageMessage) {
      log.pageMessage = pageMessage;
    }

    if (data.isObserverPage) {
      log.isObserverPage = true;
    }

    /*
     * Who started it, on the write's own props: onBeforeCreate stamps the
     * person as who triggered the run, and onCreatePermitted the workflow.
     */
    const props: DatabaseCommonInteractionProps = { isRoot: true };

    if (data.startedBy?.userId) {
      props.userId = data.startedBy.userId;
    }

    if (data.startedBy?.workflowId) {
      props.workflowId = data.startedBy.workflowId;

      if (data.startedBy.workflowName) {
        props.workflowName = data.startedBy.workflowName;
      }
    }

    const createdLog: Model = await this.create({
      data: log,
      props: props,
    });

    const executionLogId: ObjectID = createdLog.id!;

    await this.updateOneById({
      id: executionLogId,
      data: {
        status: OnCallDutyPolicyStatus.Started,
        statusMessage: ON_CALL_RUN_PAGING_STARTED_MESSAGE,
      },
      props: {
        isRoot: true,
      },
    });

    let outcome: OnCallPagingOutcome;

    try {
      // A direct page starts now (OnCallPageTiming).
      outcome = await OnCallPageTiming.runInPageStart(
        OnCallPageTiming.startPage(),
        (): Promise<OnCallPagingOutcome> => {
          return OnCallDutyPolicyEscalationRuleService.startDirectPage({
            projectId: data.projectId,
            triggeredByIncidentId: data.triggeredByIncidentId,
            triggeredByAlertId: data.triggeredByAlertId,
            userNotificationEventType: log.userNotificationEventType!,
            onCallPolicyExecutionLogId: executionLogId,
            targets: data.targets,
          });
        },
      );
    } catch (err) {
      /*
       * The run says what went wrong rather than sitting at "started" until
       * it is timed out; whoever asked for the page is told as well.
       */
      await this.updateOneById({
        id: executionLogId,
        data: {
          status: OnCallDutyPolicyStatus.Error,
          statusMessage:
            (err as Error)?.message ||
            "Error occurred while paging the people this page names.",
        },
        props: {
          isRoot: true,
        },
      });

      throw err;
    }

    /*
     * Somebody was paged: the run stays open while their pages are out, and
     * the worker ends it once the record is acknowledged or everybody's
     * notifications have gone out (OnCallDutyPolicyExecutionLog:
     * ExecutePendingExecutions). Nobody was: it is over, and says so.
     */
    await this.updateOneById({
      id: executionLogId,
      data:
        outcome.paged.length > 0
          ? {
              status: OnCallDutyPolicyStatus.Executing,
              statusMessage: getOnCallDirectPagePagingMessage(
                outcome.paged.length,
              ),
            }
          : {
              status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
              statusMessage: ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
            },
      props: {
        isRoot: true,
      },
    });

    return {
      executionLogId: executionLogId,
      outcome: outcome,
    };
  }

  /*
   * STARTS A TEST PAGE TO PEOPLE (OnCallTestPage): "Send me a test page",
   * or an admin's test page to a member. A run with no policy and no
   * record, whose event type is Test Page, that pages the people it names
   * at once - as a direct page does (OnCallDutyPolicyEscalationRuleService
   * .startDirectPage), so a user override, a person who left the project
   * and nobody paged twice are handled exactly as for a real page - each
   * through their own On-Call Rules for `recordKind` and `severityId`.
   *
   * OneUptime's own write: OnCallTestPageService has checked who may send
   * it and how often. Credited to `startedByUserId`. Hands back the run
   * and who it paged; one that reached nobody is over at once, and says so.
   */
  @CaptureSpan()
  public async startTestPage(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
    recordKind: OnCallTestPageRecordKind;
    severityId: ObjectID;
    startedByUserId: ObjectID;
  }): Promise<OnCallDirectPageRun> {
    if (data.userIds.length === 0) {
      throw new BadDataException("A test page needs somebody to page.");
    }

    const log: Model = new Model();

    log.projectId = data.projectId;
    log.status = OnCallDutyPolicyStatus.Scheduled;
    log.statusMessage = ON_CALL_RUN_SCHEDULED_MESSAGE;
    log.userNotificationEventType = UserNotificationEventType.TestPage;
    log.testPageRecordKind = data.recordKind;
    log.testPageSeverityId = data.severityId;

    const createdLog: Model = await this.create({
      data: log,
      props: {
        isRoot: true,
        userId: data.startedByUserId,
      },
    });

    const executionLogId: ObjectID = createdLog.id!;

    await this.updateOneById({
      id: executionLogId,
      data: {
        status: OnCallDutyPolicyStatus.Started,
        statusMessage: ON_CALL_RUN_PAGING_STARTED_MESSAGE,
      },
      props: {
        isRoot: true,
      },
    });

    let outcome: OnCallPagingOutcome;

    try {
      outcome = await OnCallPageTiming.runInPageStart(
        OnCallPageTiming.startPage(),
        (): Promise<OnCallPagingOutcome> => {
          return OnCallDutyPolicyEscalationRuleService.startDirectPage({
            projectId: data.projectId,
            userNotificationEventType: UserNotificationEventType.TestPage,
            onCallPolicyExecutionLogId: executionLogId,
            targets: {
              userIds: data.userIds,
              teamIds: [],
              onCallScheduleIds: [],
            },
          });
        },
      );
    } catch (err) {
      await this.updateOneById({
        id: executionLogId,
        data: {
          status: OnCallDutyPolicyStatus.Error,
          statusMessage:
            (err as Error)?.message ||
            "Error occurred while sending the test page.",
        },
        props: {
          isRoot: true,
        },
      });

      throw err;
    }

    await this.updateOneById({
      id: executionLogId,
      data:
        outcome.paged.length > 0
          ? {
              status: OnCallDutyPolicyStatus.Executing,
              statusMessage: getOnCallTestPagePagingMessage(
                outcome.paged.length,
              ),
            }
          : {
              status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
              statusMessage: ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
            },
      props: {
        isRoot: true,
      },
    });

    return {
      executionLogId: executionLogId,
      outcome: outcome,
    };
  }

  /*
   * STARTS A TEST OF AN ON-CALL POLICY (OnCallTestPage): "Test this policy".
   * A run of the policy whose event type is Test Page, with no record: it
   * pages the policy's first escalation level as a real run does
   * (onCreateSuccess, startFirstEscalationRule) - its teams, schedules,
   * overrides and people - through each person's On-Call Rules for
   * `recordKind` and `severityId`. It walks every level, each after a short
   * wait, only when asked to (walksEscalation); it never repeats the policy.
   *
   * OneUptime's own write: OnCallTestPageService has checked that the caller
   * may edit the policy, and how often it is tested. An archived policy, or
   * one without escalation rules, writes the run with the reason, as for any
   * run. Returns the run's id.
   *
   * A monitor's fire drill (OnCallFireDrillService) starts one for each
   * policy its failure pages, and keeps on each the drill, the monitor and
   * the failure it rehearsed (#9386): the policy's execution logs say the
   * run was part of a fire drill of that monitor, and the monitor's card
   * says how the drill went.
   */
  @CaptureSpan()
  public async startPolicyTest(data: {
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID;
    recordKind: OnCallTestPageRecordKind;
    severityId: ObjectID;
    walksEscalation: boolean;
    startedByUserId: ObjectID;
    fireDrill?: OnCallFireDrillOfRun | undefined;
  }): Promise<ObjectID> {
    const log: Model = new Model();

    log.projectId = data.projectId;
    log.onCallDutyPolicyId = data.onCallDutyPolicyId;
    log.status = OnCallDutyPolicyStatus.Scheduled;
    log.statusMessage = ON_CALL_RUN_SCHEDULED_MESSAGE;
    log.userNotificationEventType = UserNotificationEventType.TestPage;
    log.testPageRecordKind = data.recordKind;
    log.testPageSeverityId = data.severityId;
    log.testPageWalksEscalation = data.walksEscalation;

    if (data.fireDrill) {
      log.testPageFireDrillId = data.fireDrill.fireDrillId;
      log.testPageFireDrillMonitorId = data.fireDrill.monitorId;
      log.testPageFireDrillFailure = data.fireDrill.failure;
    }

    const createdLog: Model = await this.create({
      data: log,
      props: {
        isRoot: true,
        userId: data.startedByUserId,
      },
    });

    return createdLog.id!;
  }

  /*
   * A test page (OnCallTestPage) starts none of the customer's workflows:
   * it is not news about the project, and a workflow that pages, posts or
   * opens a ticket on every run would turn a test into the real thing. Read
   * by the run's id, as the workflow is asked for: a run that cannot be read
   * is not taken for a test.
   */
  @CaptureSpan()
  public override async onTriggerWorkflow(
    id: ObjectID,
    projectId: ObjectID,
    triggerType: DatabaseTriggerType,
    miscData?: JSONObject | undefined,
  ): Promise<void> {
    if (await this.isTestPageRun(id)) {
      return;
    }

    return await super.onTriggerWorkflow(id, projectId, triggerType, miscData);
  }

  // Whether a run is a test page, read by its id as OneUptime.
  public async isTestPageRun(id: ObjectID): Promise<boolean> {
    try {
      const run: Model | null = await this.findOneById({
        id: id,
        select: {
          _id: true,
          userNotificationEventType: true,
        },
        props: {
          isRoot: true,
        },
      });

      return isOnCallTestPage(run);
    } catch (err) {
      logger.error(
        `Could not read whether on-call execution log ${id.toString()} is a test page: ${err}`,
      );

      return false;
    }
  }

  /*
   * STARTS A PAGE AGAIN (OnCallAcknowledgementTimeout): a record a policy
   * paged about stayed acknowledged without being resolved past the
   * policy's acknowledgement timeout, so the policy pages again - a run of
   * its own, numbered (pageAgainNumber), that pages whoever is on call now
   * at `startAtRuleId` (the rule that was paging when the record was
   * acknowledged) and, first of all, the person who acknowledged it. From
   * there it is a run like any other: it escalates through the policy's
   * later rules, repeats as the policy repeats, and ends when somebody
   * acknowledges it or the record is resolved.
   *
   * Its record's feed says why it pages ("is paging again (1 of 5): the
   * incident is still not resolved 30 minutes after Ana Lopez acknowledged
   * it."), and its status message says the same while it pages. This is
   * OneUptime's own write; the caller decided the policy pages again.
   * Returns the run, or null when it could not page (an archived policy
   * says so on the run, as for any run).
   */
  @CaptureSpan()
  public async startPageAgain(data: {
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID;
    triggeredByIncidentId?: ObjectID | undefined;
    triggeredByAlertId?: ObjectID | undefined;
    triggeredByAlertEpisodeId?: ObjectID | undefined;
    triggeredByIncidentEpisodeId?: ObjectID | undefined;
    userNotificationEventType: UserNotificationEventType;
    pageAgainNumber: number;
    // The timeout that ran out, for the words.
    minutes: number;
    // "incident", "alert", "incident episode" or "alert episode".
    recordKind: string;
    // The escalation rule to start at; the policy's first when it is gone.
    startAtRuleId?: ObjectID | undefined;
    // Who acknowledged the record last: paged first.
    acknowledgedByUserId?: ObjectID | undefined;
    /*
     * When the timeout ran out: the page again is timed from then
     * (OnCallPageTiming.startPage), however late the worker got to it.
     * Now without one.
     */
    dueAt?: Date | undefined;
    /*
     * Told once the page again's run is written: a page again whose run
     * was never written gives its acknowledgement clock back (issue #8514).
     */
    onRunCreated?: ((runId: ObjectID) => void | Promise<void>) | undefined;
  }): Promise<ObjectID | null> {
    const log: Model = new Model();

    log.projectId = data.projectId;
    log.onCallDutyPolicyId = data.onCallDutyPolicyId;
    log.userNotificationEventType = data.userNotificationEventType;
    log.status = OnCallDutyPolicyStatus.Scheduled;
    log.statusMessage = ON_CALL_RUN_SCHEDULED_MESSAGE;
    log.pageAgainNumber = data.pageAgainNumber;

    if (data.triggeredByIncidentId) {
      log.triggeredByIncidentId = data.triggeredByIncidentId;
    }

    if (data.triggeredByAlertId) {
      log.triggeredByAlertId = data.triggeredByAlertId;
    }

    if (data.triggeredByAlertEpisodeId) {
      log.triggeredByAlertEpisodeId = data.triggeredByAlertEpisodeId;
    }

    if (data.triggeredByIncidentEpisodeId) {
      log.triggeredByIncidentEpisodeId = data.triggeredByIncidentEpisodeId;
    }

    const run: Model = await this.create({
      data: log,
      props: {
        isRoot: true,
      },
    });

    const runId: ObjectID = run.id!;

    if (data.onRunCreated) {
      await data.onRunCreated(runId);
    }

    // Archived meanwhile: the run says it was not executed, as any run does.
    if (run.status === OnCallDutyPolicyStatus.Error) {
      return null;
    }

    /*
     * A page again starts when its timeout ran out (dueAt), or now
     * without one (OnCallPageTiming).
     */
    const pageStart: OnCallPageStartMoment = OnCallPageTiming.startPage({
      dueAt: data.dueAt,
    });

    /*
     * Where it starts, and who it pages first, kept in flight until its
     * rule is recorded (OnCallLevelsInFlight, issue #8514): a start that
     * fails or stops before that is started by the policy-run worker, from
     * the same rule, the person who acknowledged first, rather than ended
     * in Error with nobody paged - the acknowledgement clock is stopped,
     * and no later page again would come.
     */
    const startInFlight: OnCallLevelInFlight = this.getPageAgainStart({
      startAtRuleId: data.startAtRuleId?.toString() || null,
      acknowledgedByUserId: data.acknowledgedByUserId?.toString() || null,
      minutes: data.minutes,
      pageStart: pageStart,
    });

    await OnCallLevelsInFlight.keep(runId, startInFlight);

    try {
      const policyLink: MarkdownText | null = await this.getPolicyLink(run);

      if (policyLink) {
        await this.addToRecordFeed({
          run: run,
          feedInfoInMarkdown: OnCallFeedText.getRunPagedAgainMarkdown({
            policyLink: policyLink,
            pageAgainNumber: data.pageAgainNumber,
            minutes: data.minutes,
            recordKind: data.recordKind,
            acknowledgedBy: data.acknowledgedByUserId
              ? await UserService.getUserMarkdownString({
                  userId: data.acknowledgedByUserId,
                  projectId: data.projectId,
                })
              : undefined,
          }),
          displayColor: Yellow500,
        });
      }
    } catch (err) {
      // Nothing about the feed may stop the page.
      logger.error(
        `Could not say in the feed that on-call execution log ${runId.toString()} pages again; paging anyway.`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      logger.error(err as Error);
    }

    try {
      await this.startPageAgainLevel({
        ...data,
        runId: runId,
        pageStart: pageStart,
        isHandedOver: false,
      });
    } catch (err) {
      if (
        await this.handPageAgainToEscalation({
          runId: runId,
          projectId: data.projectId,
          startInFlight: startInFlight,
          dueAt: pageStart.startedAt,
          error: err,
        })
      ) {
        return runId;
      }

      // The run says what went wrong rather than sitting at "started".
      await this.updateOneById({
        id: runId,
        data: {
          status: OnCallDutyPolicyStatus.Error,
          statusMessage:
            (err as Error)?.message ||
            "Error occurred while paging again about this record.",
        },
        props: {
          isRoot: true,
        },
      });

      await OnCallLevelsInFlight.forget(runId);

      throw err;
    }

    return runId;
  }

  /*
   * A page again's rule, paged: the rule it starts at - the policy's
   * first when that one is gone - the person who acknowledged first, then
   * the run moves on if nobody could be paged (startPageAgain). The
   * policy-run worker runs it too, for a page again handed over before its
   * rule was recorded (startHandedOverPageAgain, issue #8514).
   */
  private async startPageAgainLevel(data: {
    runId: ObjectID;
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID;
    triggeredByIncidentId?: ObjectID | undefined;
    triggeredByAlertId?: ObjectID | undefined;
    triggeredByAlertEpisodeId?: ObjectID | undefined;
    triggeredByIncidentEpisodeId?: ObjectID | undefined;
    userNotificationEventType: UserNotificationEventType;
    pageAgainNumber: number;
    minutes: number;
    startAtRuleId?: ObjectID | undefined;
    acknowledgedByUserId?: ObjectID | undefined;
    pageStart: OnCallPageStartMoment;
    // Handed to its escalation already: Executing, not to be marked Started.
    isHandedOver: boolean;
  }): Promise<void> {
    const runId: ObjectID = data.runId;
    const pageStart: OnCallPageStartMoment = data.pageStart;

    const rule: OnCallDutyPolicyEscalationRule | null =
      await this.getPageAgainRule({
        projectId: data.projectId,
        onCallDutyPolicyId: data.onCallDutyPolicyId,
        startAtRuleId: data.startAtRuleId,
      });

    if (!rule) {
      await this.updateOneById({
        id: runId,
        data: {
          status: OnCallDutyPolicyStatus.Error,
          statusMessage: ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE,
        },
        props: {
          isRoot: true,
        },
      });

      await OnCallLevelsInFlight.forget(runId);
      return;
    }

    // One handed over is Executing already, for the worker to read.
    if (!data.isHandedOver) {
      await this.updateOneById({
        id: runId,
        data: {
          status: OnCallDutyPolicyStatus.Started,
          statusMessage: ON_CALL_RUN_EXECUTION_STARTED_MESSAGE,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const firstRuleOutcome: OnCallRuleExecutionOutcome =
      await OnCallPageTiming.runInPageStart(
        pageStart,
        (): Promise<OnCallRuleExecutionOutcome> => {
          return OnCallDutyPolicyEscalationRuleService.startRuleExecution(
            rule.id!,
            {
              projectId: data.projectId,
              triggeredByIncidentId: data.triggeredByIncidentId,
              triggeredByAlertId: data.triggeredByAlertId,
              triggeredByAlertEpisodeId: data.triggeredByAlertEpisodeId,
              triggeredByIncidentEpisodeId: data.triggeredByIncidentEpisodeId,
              userNotificationEventType: data.userNotificationEventType,
              onCallPolicyExecutionLogId: runId,
              onCallPolicyId: data.onCallDutyPolicyId,
              alsoPageUserIds: data.acknowledgedByUserId
                ? [data.acknowledgedByUserId]
                : [],
            },
          );
        },
      );

    await this.updateOneById({
      id: runId,
      data: {
        status: OnCallDutyPolicyStatus.Executing,
        statusMessage: getOnCallPageAgainStatusMessage({
          pageAgainNumber: data.pageAgainNumber,
          minutes: data.minutes,
        }),
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * Nobody at the level it starts at could be paged - not even whoever
     * acknowledged: the page again moves on now, as any run does from a
     * level with nobody to wait for (OnCallEmptyLevel).
     */
    if (firstRuleOutcome?.movesOnAtOnce) {
      await OnCallPageTiming.runInPageStart(
        pageStart,
        (): Promise<OnCallEscalationAdvanceResult | null> => {
          return OnCallEscalationAdvance.moveOnAtOnce({ runId: runId });
        },
      );
    }

    await OnCallLevelsInFlight.forget(runId);
  }

  /*
   * A page again whose start failed for a reason a retry can outlast is
   * handed to its escalation rather than ended in Error (issues #8471,
   * #8514): from its rule when its rule was recorded - the worker resumes
   * its level, the person who acknowledged first - or, when it was not,
   * with its start kept in flight, stopped, for the worker to start it
   * from where it starts (startHandedOverPageAgain). Returns whether it was
   * handed over.
   */
  private async handPageAgainToEscalation(data: {
    runId: ObjectID;
    projectId: ObjectID;
    startInFlight: OnCallLevelInFlight;
    dueAt: Date;
    error: unknown;
  }): Promise<boolean> {
    if (
      OnCallRunFailure.classify(data.error) === OnCallRunFailureKind.Permanent
    ) {
      return false;
    }

    let handedOver: boolean = await this.handStartedRunToEscalation({
      executionLogId: data.runId,
      dueAt: data.dueAt,
      onlyFromItsRule: true,
    });

    if (!handedOver) {
      await OnCallLevelsInFlight.keep(data.runId, {
        ...data.startInFlight,
        heartbeatAt: OneUptimeDate.getCurrentDate(),
        stopped: true,
      });

      handedOver = await this.handStartedRunToEscalation({
        executionLogId: data.runId,
        dueAt: data.dueAt,
        fromStatuses: [
          OnCallDutyPolicyStatus.Started,
          OnCallDutyPolicyStatus.Scheduled,
        ],
      });
    }

    if (handedOver) {
      logger.error(
        `On-call execution log ${data.runId.toString()}: its page again failed as it started; handed to its escalation, which pages what it did not.`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      logger.error(data.error as Error);
    }

    return handedOver;
  }

  /*
   * STARTS A PAGE AGAIN HANDED OVER BEFORE ITS RULE WAS RECORDED
   * (issue #8514), for the policy-run worker: its start failed or stopped,
   * and its start was kept in flight (OnCallLevelsInFlight) - where it
   * starts, who acknowledged, and when it was due. It is started as it
   * would have been, the person who acknowledged first. Throws as paging
   * does: the start stays in flight for the run's next try.
   */
  @CaptureSpan()
  public async startHandedOverPageAgain(data: {
    run: Model;
    level: OnCallLevelInFlight;
  }): Promise<void> {
    const run: Model = data.run;
    const pageAgain: OnCallPageAgainInFlight = data.level.pageAgain!;

    await this.startPageAgainLevel({
      runId: run.id!,
      projectId: run.projectId!,
      onCallDutyPolicyId: run.onCallDutyPolicyId!,
      triggeredByIncidentId: run.triggeredByIncidentId,
      triggeredByAlertId: run.triggeredByAlertId,
      triggeredByAlertEpisodeId: run.triggeredByAlertEpisodeId,
      triggeredByIncidentEpisodeId: run.triggeredByIncidentEpisodeId,
      userNotificationEventType: run.userNotificationEventType!,
      pageAgainNumber: Number(run.pageAgainNumber),
      minutes: pageAgain.minutes,
      startAtRuleId: pageAgain.startAtRuleId
        ? new ObjectID(pageAgain.startAtRuleId)
        : undefined,
      acknowledgedByUserId: pageAgain.acknowledgedByUserId
        ? new ObjectID(pageAgain.acknowledgedByUserId)
        : undefined,
      pageStart: data.level.pageStart
        ? {
            startedAt: data.level.pageStart.startedAt,
            start: data.level.pageStart.start,
          }
        : OnCallPageTiming.startPage({}),
      isHandedOver: true,
    });
  }

  // A page again's start, as it is kept in flight until its rule is recorded (issue #8514).
  private getPageAgainStart(data: {
    startAtRuleId: string | null;
    acknowledgedByUserId: string | null;
    minutes: number;
    pageStart: OnCallPageStartMoment;
  }): OnCallLevelInFlight {
    return {
      ruleId: data.startAtRuleId || "",
      startedAt: OneUptimeDate.getCurrentDate(),
      heartbeatAt: OneUptimeDate.getCurrentDate(),
      stopped: false,
      ...(data.acknowledgedByUserId
        ? { firstUserIds: [data.acknowledgedByUserId] }
        : {}),
      pageStart: {
        startedAt: data.pageStart.startedAt,
        start: data.pageStart.start,
      },
      pageAgain: {
        startAtRuleId: data.startAtRuleId,
        acknowledgedByUserId: data.acknowledgedByUserId,
        minutes: data.minutes,
      },
    };
  }

  /*
   * Keeps the start of a page again whose run was written, and whose
   * process stopped before it kept its start (issue #8549): the page-again
   * tick asks for this once the page again has been in flight a while
   * (OnCallPageAgainClaimsInFlight). Only for a run still starting - no
   * rule recorded, Scheduled or Started - with no start kept already: the
   * stuck-run job then hands it to its escalation, and the policy-run
   * worker starts it from where it starts, the person who acknowledged
   * first (startHandedOverPageAgain). Throws as the database does, and
   * when Redis did not take the start.
   */
  @CaptureSpan()
  public async keepPageAgainStartIfMissing(data: {
    runId: ObjectID;
    startAtRuleId: string | null;
    acknowledgedByUserId: string | null;
    minutes: number;
    dueAt: Date;
  }): Promise<boolean> {
    const run: Model | null = await this.findOneById({
      id: data.runId,
      select: {
        status: true,
        lastExecutedEscalationRuleId: true,
        // Kept when the level's rule is deleted (OnCallRunLevel, #9036).
        lastExecutedEscalationRuleOrder: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      !run ||
      hasOnCallRunStartedALevel(run) ||
      (run.status !== OnCallDutyPolicyStatus.Scheduled &&
        run.status !== OnCallDutyPolicyStatus.Started)
    ) {
      return false;
    }

    const kept: Map<string, OnCallLevelInFlight> =
      await OnCallLevelsInFlight.read([data.runId]);

    if (kept.has(data.runId.toString())) {
      return false;
    }

    await OnCallLevelsInFlight.keep(data.runId, {
      ...this.getPageAgainStart({
        startAtRuleId: data.startAtRuleId,
        acknowledgedByUserId: data.acknowledgedByUserId,
        minutes: data.minutes,
        pageStart: OnCallPageTiming.startPage({ dueAt: data.dueAt }),
      }),
      stopped: true,
    });

    // Kept only once Redis has it: else the page-again tick tries again at its next.
    if (
      !(await OnCallLevelsInFlight.read([data.runId])).has(
        data.runId.toString(),
      )
    ) {
      throw new Error(
        `Could not keep the start of the page again of on-call execution log ${data.runId.toString()}.`,
      );
    }

    return true;
  }

  /*
   * Gives a run's acknowledgement clock back (issue #8514): its page
   * again's run was never written, so the next tick pages again. Only
   * while the clock is still stopped. Never throws, unless asked to: the
   * page-again tick's settle (issue #8549) keeps its page again in flight
   * for its next tick on a database error.
   */
  @CaptureSpan()
  public async restartAcknowledgementTimeoutClock(data: {
    executionLogId: ObjectID;
    startedAt: Date;
    throwOnError?: boolean | undefined;
  }): Promise<boolean> {
    try {
      return await this.compareAndSetColumnsByIdWithoutHooks({
        id: data.executionLogId,
        data: {
          acknowledgementTimeoutStartedAt: data.startedAt,
        },
        expectedData: {
          acknowledgementTimeoutStartedAt: null,
        },
        skipUpdateDateColumn: true,
      });
    } catch (err) {
      if (data.throwOnError) {
        throw err;
      }

      logger.error(
        `Could not give back the acknowledgement clock of on-call execution log ${data.executionLogId.toString()}; its page again is not tried again.`,
      );
      logger.error(err as Error);
      return false;
    }
  }

  /*
   * The escalation rule a page again starts at: the one the run before it
   * was on, while it is still the policy's - else the rule that is now at
   * the same place, else the policy's first. Null when the policy has none.
   */
  private async getPageAgainRule(data: {
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID;
    startAtRuleId?: ObjectID | undefined;
  }): Promise<OnCallDutyPolicyEscalationRule | null> {
    if (data.startAtRuleId) {
      const rule: OnCallDutyPolicyEscalationRule | null =
        await OnCallDutyPolicyEscalationRuleService.findOneBy({
          query: {
            _id: data.startAtRuleId,
            projectId: data.projectId,
            onCallDutyPolicyId: data.onCallDutyPolicyId,
          },
          select: {
            _id: true,
            order: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (rule) {
        return rule;
      }
    }

    // The policy's first, as a new run starts at (#9369).
    return await OnCallDutyPolicyEscalationRuleService.findFirstOfPolicy({
      projectId: data.projectId,
      onCallDutyPolicyId: data.onCallDutyPolicyId,
    });
  }

  /*
   * Starts (or starts again) a run's acknowledgement timeout clock at
   * `startedAt` (OnCallAcknowledgementTimeout). A plain write of the one
   * column, with no hooks: the clock is bookkeeping, not news - nothing in
   * the run's feed or chat message changes.
   */
  @CaptureSpan()
  public async startAcknowledgementTimeoutClock(data: {
    executionLogId: ObjectID;
    startedAt: Date;
  }): Promise<void> {
    await this.updateColumnsByIdWithoutHooks({
      id: data.executionLogId,
      data: {
        acknowledgementTimeoutStartedAt: data.startedAt,
      },
      skipUpdateDateColumn: true,
    });
  }

  /*
   * Stops a run's acknowledgement timeout clock - it ran out, or there is
   * nothing left to count for - if it still reads `expectedStartedAt`: one
   * atomic compare-and-set, so of two worker ticks (or replicas) that read
   * the same clock exactly one stops it, and pages again; a clock started
   * again meanwhile (a new acknowledgement) is left running. Says whether
   * this call stopped it.
   */
  @CaptureSpan()
  public async stopAcknowledgementTimeoutClock(data: {
    executionLogId: ObjectID;
    expectedStartedAt: Date;
  }): Promise<boolean> {
    return await this.compareAndSetColumnsByIdWithoutHooks({
      id: data.executionLogId,
      data: {
        acknowledgementTimeoutStartedAt: null,
      },
      expectedData: {
        acknowledgementTimeoutStartedAt: data.expectedStartedAt,
      },
      skipUpdateDateColumn: true,
    });
  }

  /*
   * Ends a direct page whose pages are all over, and says whether it did.
   *
   * An on-call policy's run ends once it has gone through its escalation
   * rules. A direct page has none: it pages everybody at once, and is over
   * when every one of those pages is - each person's own On-Call Rules have
   * sent everything they had to send (a call after ten minutes, a push that
   * repeats), with nobody acknowledging. Until then it stays open, so its
   * Slack and Microsoft Teams message goes on saying people are being paged
   * while they are. A page of it merged into the person's open page from
   * another run waits on that page, and keeps it open too
   * (ON_CALL_DIRECT_PAGE_STATUSES_STILL_OUT): it pages them itself should
   * that page end without their answer (#8859).
   *
   * It stays open for a while after paging started in any case
   * (ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES): somebody whose one
   * rule is an SMS sent at once has had their whole page a minute in, and
   * "nobody acknowledged" then would be said before anybody could have.
   *
   * A record that is acknowledged or resolved ends the run before this is
   * asked (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions, as for a
   * policy's run), so a page that ends here ended with nobody on it: the
   * run's message says "nobody acknowledged", in the words a policy's run
   * that went through every rule is given.
   */
  @CaptureSpan()
  public async endDirectPageIfItsPagesAreOver(data: {
    executionLogId: ObjectID;
    // When its paging started: when the run recorded it, or when the run was created.
    pagingStartedAt: Date | null | undefined;
    // The moment to ask about. Now, when left out.
    at?: Date | undefined;
  }): Promise<boolean> {
    const executionLogId: ObjectID = data.executionLogId;

    if (
      !hasOnCallDirectPageWaitedForAcknowledgement({
        pagingStartedAt: data.pagingStartedAt,
        at: data.at || OneUptimeDate.getCurrentDate(),
      })
    ) {
      return false;
    }

    const pagesStillOut: PositiveNumber = await UserOnCallLogService.countBy({
      query: {
        onCallDutyPolicyExecutionLogId: executionLogId,
        status: QueryHelper.any([...ON_CALL_DIRECT_PAGE_STATUSES_STILL_OUT]),
      },
      props: {
        isRoot: true,
      },
    });

    if (pagesStillOut.toNumber() > 0) {
      return false;
    }

    await this.updateOneById({
      id: executionLogId,
      data: {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      },
      props: {
        isRoot: true,
      },
    });

    return true;
  }

  /*
   * Who started a direct page, as its feed entries name them
   * (OnCallFeedText): the workflow, by the name the run recorded, or the
   * person, as a link to them.
   */
  @CaptureSpan()
  public async getDirectPagePager(run: {
    projectId?: ObjectID | undefined;
    triggeredByWorkflowName?: string | undefined;
    triggeredByUserId?: ObjectID | undefined;
  }): Promise<OnCallDirectPagePager> {
    const workflowName: string = (run.triggeredByWorkflowName || "").trim();

    if (workflowName) {
      return { workflowName: workflowName };
    }

    if (run.triggeredByUserId && run.projectId) {
      return {
        startedByUser: await UserService.getUserMarkdownString({
          userId: run.triggeredByUserId,
          projectId: run.projectId,
        }),
      };
    }

    return {};
  }

  // Whether the policy an execution log is for is archived, read as OneUptime.
  private async isPolicyArchived(data: Model): Promise<boolean> {
    const policyId: ObjectID | null = RelationIdUtil.readConsistent(
      data as unknown as Record<string, unknown>,
      ["onCallDutyPolicyId", "onCallDutyPolicy"],
      "On-Call Policy",
    );

    if (!policyId) {
      return false;
    }

    const policy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: policyId,
        select: {
          isArchived: true,
        },
        props: {
          isRoot: true,
        },
      });

    return policy?.isArchived === true;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * The run's one message in Slack and Microsoft Teams (OnCallPolicyRunMessage).
     * It is posted once the run has something to say - its first escalation
     * rule, that it waits to page, or how it ended - and edited after that;
     * this and every later change to the run only ask for it to be brought
     * up to date.
     */
    OnCallPolicyRunMessage.refresh(createdItem.id);

    // An archived policy's log says why nobody was paged; nothing follows it.
    if (
      (onCreate.carryForward as { isPolicyArchived?: boolean } | null)
        ?.isPolicyArchived
    ) {
      return createdItem;
    }

    /*
     * A direct page has no policy and no escalation rules to start: whoever
     * created it pages its people (startDirectPage), and each of them is an
     * entry of the record's feed that names who started the page.
     */
    if (isOnCallDirectPage(createdItem)) {
      return createdItem;
    }

    /*
     * The project's first on-call policy that ran (issue #6830): a policy's
     * run that starts its escalation - not an archived policy's, which says
     * why nobody was paged, nor a direct page, which has no policy, nor a
     * test of the policy (OnCallTestPage), which has its own milestone once
     * somebody acknowledges it.
     */
    if (!isOnCallTestPage(createdItem)) {
      ProjectMilestoneService.reachInBackground({
        projectId: createdItem.projectId,
        milestone: ActivationMilestone.FirstOnCallPolicyExecuted,
      });
    }

    /*
     * A page again starts at the escalation rule that was paging when its
     * record was acknowledged, with the person who acknowledged it, and
     * says why in the feed: whoever created it does that (startPageAgain).
     */
    if (isOnCallPageAgainRun(createdItem)) {
      return createdItem;
    }

    /*
     * A run that waits to page (OnCallDutyPolicyRunWait) pages nobody yet:
     * its record's feed says so, and why and until when, and the worker
     * starts it at its first escalation rule once its moment comes
     * (startWaitingRun).
     */
    const isWaiting: boolean =
      createdItem.status === OnCallDutyPolicyStatus.Waiting;

    if (this.isTriggeredByRecord(createdItem)) {
      const policyLink: MarkdownText | null =
        await this.getPolicyLink(createdItem);

      if (policyLink) {
        /*
         * One sentence (OnCallFeedText). Started by hand - Execute On-Call
         * Policy in a feed's Actions - it is credited to that person, and
         * reads after their name: "Nitin started on-call policy PolicyX".
         */
        const startedByUserId: ObjectID | undefined =
          createdItem.createdByUserId || createdItem.triggeredByUserId;

        const feedInfoInMarkdown: string = isWaiting
          ? OnCallFeedText.getRunWaitingMarkdown({
              policyLink: policyLink,
              isStartedBySomeone: Boolean(startedByUserId),
              startedByWorkflowName: createdItem.triggeredByWorkflowName,
              waitingMessage: createdItem.statusMessage,
              isObserverPage: isOnCallObserverPage(createdItem),
            })
          : OnCallFeedText.getRunStartedMarkdown({
              policyLink: policyLink,
              isStartedBySomeone: Boolean(startedByUserId),
              startedByWorkflowName: createdItem.triggeredByWorkflowName,
              isObserverPage: isOnCallObserverPage(createdItem),
            });

        await this.addToRecordFeed({
          run: createdItem,
          feedInfoInMarkdown: feedInfoInMarkdown,
          displayColor: isWaiting
            ? this.getDisplayColorByStatus(OnCallDutyPolicyStatus.Waiting)
            : Yellow500,
          userId: startedByUserId,
        });
      }
    }

    if (isWaiting) {
      return createdItem;
    }

    try {
      await this.startFirstEscalationRule(createdItem);
    } catch (err) {
      /*
       * The start failed - the database lost as it read the first rule, or
       * as the rule paged (issue #8405). The run was left Started (or still
       * Scheduled), which no tick of the worker reads: it was ended in
       * Error five minutes later, having paged nobody, and its later rules
       * were never paged either. It is handed to its escalation now, as a
       * waiting run whose start fails is (startWaitingRun): the worker
       * pages within a minute what the start did not, claimed, so nobody
       * is paged twice, and tries a run that keeps failing a few times
       * before it ends it, saying why (OnCallPolicyRunRetry). The page
       * that created the run goes on: the run is paged from here.
       *
       * Not a test page (OnCallTestPage): a test of the policy's first
       * level only must not walk on to its later levels, which its
       * escalation would. Its start fails as it always did, and it is
       * stopped as Error.
       */
      if (isOnCallTestPage(createdItem)) {
        throw err;
      }

      logger.error(
        `On-call execution log ${createdItem.id?.toString()}: its start failed; handing it to its escalation, which pages what the start did not.`,
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );
      logger.error(err as Error);

      await this.handStartedRunToEscalation({
        executionLogId: createdItem.id!,
        dueAt: createdItem.createdAt || OneUptimeDate.getCurrentDate(),
        fromStatuses: [
          OnCallDutyPolicyStatus.Started,
          OnCallDutyPolicyStatus.Scheduled,
        ],
      });
    }

    return createdItem;
  }

  /*
   * STARTS A RUN THAT WAITED (OnCallDutyPolicyRunWait): its moment has come,
   * and its record still needs somebody, so it pages its first escalation
   * rule now - as a run that never waited does when it is created. The
   * worker asks for this once a minute, for each waiting run whose moment
   * has come (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions).
   *
   * Starting is CLAIMED first: one atomic conditional UPDATE from Waiting to
   * Started, so two overlapping ticks or two worker replicas start the run
   * once and page its first rule once, and one that a tick has just ended
   * (endWaitingRun) is not started. Whoever loses the claim does nothing.
   * The claim moves pagingStartsAt to the moment paging started, so a start
   * that hangs is timed out five minutes after it - not at once because the
   * run was created hours before (TimeoutStuckExecutions).
   *
   * A run can also start before its moment: its record changed and now
   * matches an on-call rule that pages right away (WaitingRunsOnRecordChange).
   * `startedEarlyReason` then says why, in the same claim - kept on the run
   * (pagingStartedEarlyReason) for its Slack and Microsoft Teams message, and
   * said in its record's feed.
   *
   * A run OneUptime AI held (OnCallPolicyAiHold) says, in the same claim,
   * how its hold ended (`aiHoldOutcome`): handed off, Page now, or its hold
   * time ran out.
   *
   * `run` is the run as the worker read it: its id, its project, its policy
   * and the record it pages about. Returns whether this call started it.
   */
  @CaptureSpan()
  public async startWaitingRun(data: {
    run: Model;
    now: Date;
    startedEarlyReason?: string | undefined;
    aiHoldOutcome?: OnCallPolicyAiHoldOutcome | undefined;
  }): Promise<boolean> {
    const run: Model = data.run;
    const startedEarlyReason: string | undefined =
      data.startedEarlyReason?.trim() || undefined;

    const claimed: boolean = await this.claimWaitingRun({
      executionLogId: run.id!,
      status: OnCallDutyPolicyStatus.Started,
      statusMessage: ON_CALL_RUN_EXECUTION_STARTED_MESSAGE,
      pagingStartsAt: data.now,
      pagingStartedEarlyReason: startedEarlyReason,
      aiHoldOutcome: data.aiHoldOutcome,
    });

    if (!claimed) {
      return false;
    }

    OnCallPolicyRunMessage.refresh(run.id);

    /*
     * Its record's feed said it was waiting; it says it started paging now.
     * Nothing about the feed may stop the page: a run left Started would be
     * timed out without paging anybody.
     */
    try {
      const policyLink: MarkdownText | null = this.isTriggeredByRecord(run)
        ? await this.getPolicyLink(run)
        : null;

      if (policyLink) {
        await this.addToRecordFeed({
          run: run,
          feedInfoInMarkdown: OnCallFeedText.getRunStartedMarkdown({
            policyLink: policyLink,
            isStartedBySomeone: false,
            startedEarlyReason: startedEarlyReason,
            isObserverPage: isOnCallObserverPage(run),
          }),
          displayColor: Yellow500,
        });
      }
    } catch (err) {
      logger.error(
        `Could not say in the feed that on-call execution log ${run.id!.toString()} started paging; paging it anyway.`,
        { projectId: run.projectId?.toString() } as LogAttributes,
      );
      logger.error(err as Error);
    }

    /*
     * Its page is due when its hold ended: at its moment - however late the
     * worker got to it, as `run` was read before the claim moved the moment
     * - or now, for a run started before its moment (OnCallPageTiming).
     */
    try {
      await this.startFirstEscalationRule(run, {
        isStarted: true,
        dueAt: getOnCallPolicyRunPagingDueAt({
          pagingStartsAt: run.pagingStartsAt,
          now: data.now,
        }),
      });
    } catch (err) {
      /*
       * The start failed after its claim: the run is Started, which no tick
       * reads, and would be timed out having paged nobody. It is handed to
       * its escalation, which pages what the start did not, and the failure
       * goes on to the worker, which says what it means (issue #8167).
       */
      await this.handStartedRunToEscalation({
        executionLogId: run.id!,
        dueAt: getOnCallPolicyRunPagingDueAt({
          pagingStartsAt: run.pagingStartsAt,
          now: data.now,
        }),
      });

      throw err;
    }

    return true;
  }

  /*
   * HANDS A RUN WHOSE START FAILED TO ITS ESCALATION (issue #8167).
   *
   * Starting a run that waited is claimed by moving it from Waiting to
   * Started (claimWaitingRun). A start that then failed - the database lost
   * as it read the first rule, or as the rule paged - left the run Started,
   * which no tick of the worker reads: TimeoutStuckExecutions ended it in
   * Error five minutes later, having paged nobody, and its later rules were
   * never paged either. The run is handed to its escalation instead
   * (Executing), and the worker's next tick pages what the start did not, in
   * the one way a run moves on (OnCallEscalationAdvance), claimed, so nobody
   * is paged twice:
   *
   *   - a start that did not get as far as its first rule (none recorded on
   *     the run) paged nobody: its escalation starts from its first rule at
   *     once, due when the run's page was (`dueAt`);
   *   - a start whose first rule started - some of whose people may be
   *     paged - goes on from that rule, to the next once its wait is over.
   *
   * Only a run still in one of `fromStatuses` - Started, unless said - is
   * handed over: a run left Scheduled never got as far as its first rule
   * (issue #8405). Never throws: a run that cannot be handed over stays
   * where it was.
   */
  @CaptureSpan()
  public async handStartedRunToEscalation(data: {
    executionLogId: ObjectID;
    // When the run's page was due.
    dueAt: Date;
    // The statuses the run may have been left in; Started when absent.
    fromStatuses?: Array<OnCallDutyPolicyStatus> | undefined;
    /*
     * Only a run whose rule was recorded, which goes on from it: a page
     * again starts at a rule of its own, not its policy's first.
     */
    onlyFromItsRule?: boolean | undefined;
  }): Promise<boolean> {
    try {
      let handedOver: boolean = false;

      for (const fromStatus of data.fromStatuses || [
        OnCallDutyPolicyStatus.Started,
      ]) {
        if (!data.onlyFromItsRule) {
          const fromFirstRule: UpdateResult = await this.getRepository().update(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {
              _id: data.executionLogId.toString(),
              status: fromStatus,
              lastExecutedEscalationRuleId: IsNull(),
              lastEscalationRuleExecutedAt: IsNull(),
            } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {
              status: OnCallDutyPolicyStatus.Executing,
              lastEscalationRuleExecutedAt: data.dueAt,
              executeNextEscalationRuleInMinutes: 0,
            } as any,
          );

          handedOver = (fromFirstRule.affected || 0) > 0;
        }

        if (!handedOver) {
          const fromItsRule: UpdateResult = await this.getRepository().update(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {
              _id: data.executionLogId.toString(),
              status: fromStatus,
              /*
               * Its rule recorded: its place, which stays when the rule is
               * deleted - then the run goes on from that place
               * (OnCallRunLevel, issue #9036).
               */
              ...(data.onlyFromItsRule
                ? { lastExecutedEscalationRuleOrder: Not(IsNull()) }
                : {}),
            } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {
              status: OnCallDutyPolicyStatus.Executing,
            } as any,
          );

          handedOver = (fromItsRule.affected || 0) > 0;
        }

        if (handedOver) {
          break;
        }
      }

      if (handedOver) {
        OnCallPolicyRunMessage.refresh(data.executionLogId);
      }

      return handedOver;
    } catch (err) {
      logger.error(
        `Could not hand on-call execution log ${data.executionLogId.toString()} to its escalation after its start failed.`,
      );
      logger.error(err as Error);

      return false;
    }
  }

  /*
   * ENDS A RUN THAT WAITED, BEFORE IT PAGED ANYBODY (OnCallDutyPolicyRunWait):
   * its record was acknowledged or resolved while it waited, or its policy
   * was archived. Ended with one atomic conditional UPDATE from Waiting, so
   * a run another tick has just started is left to page - the next tick ends
   * it, as it ends any run whose record is handled - rather than marked over
   * while its first rule pages. Its record's feed says how it ended, and its
   * Slack and Microsoft Teams message is brought up to date, as for any run
   * that ends. A run OneUptime AI held says, in the same claim, how its hold
   * ended (`aiHoldOutcome`) - or null, when its policy was archived and it
   * neither paged nor was resolved. Returns whether this call ended it.
   */
  @CaptureSpan()
  public async endWaitingRun(data: {
    executionLogId: ObjectID;
    status: OnCallDutyPolicyStatus;
    statusMessage: string;
    aiHoldOutcome?: OnCallPolicyAiHoldOutcome | null | undefined;
  }): Promise<boolean> {
    const claimed: boolean = await this.claimWaitingRun({
      executionLogId: data.executionLogId,
      status: data.status,
      statusMessage: data.statusMessage,
      aiHoldOutcome: data.aiHoldOutcome,
    });

    if (!claimed) {
      return false;
    }

    OnCallPolicyRunMessage.refresh(data.executionLogId);

    if (OnCallFeedText.isRunStatusFeedNews(data.status)) {
      await this.addRunStatusToFeed(data.executionLogId);
    }

    return true;
  }

  /*
   * Moves a run on from Waiting - to Started, or to how it ended - if it is
   * still waiting: one atomic conditional UPDATE (as claimEscalationAdvance),
   * which says whether it was. TypeORM's repository.update emits the one
   * statement and returns the rows it changed; it runs no hooks, so whoever
   * claims says what follows itself.
   */
  private async claimWaitingRun(data: {
    executionLogId: ObjectID;
    status: OnCallDutyPolicyStatus;
    statusMessage: string;
    pagingStartsAt?: Date | undefined;
    pagingStartedEarlyReason?: string | undefined;
    aiHoldOutcome?: OnCallPolicyAiHoldOutcome | null | undefined;
  }): Promise<boolean> {
    const values: Record<string, unknown> = {
      status: data.status,
      statusMessage: data.statusMessage,
    };

    // Null clears it: a hold that ended with neither a page nor a resolve.
    if (data.aiHoldOutcome !== undefined) {
      values["aiHoldOutcome"] = data.aiHoldOutcome;
    }

    if (data.pagingStartsAt) {
      values["pagingStartsAt"] = data.pagingStartsAt;
    }

    if (data.pagingStartedEarlyReason) {
      values["pagingStartedEarlyReason"] = data.pagingStartedEarlyReason.slice(
        0,
        ON_CALL_POLICY_RUN_STARTED_EARLY_REASON_MAX_LENGTH,
      );
    }

    const result: UpdateResult = await this.getRepository().update(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        _id: data.executionLogId.toString(),
        status: OnCallDutyPolicyStatus.Waiting,
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      values as any,
    );

    return (result.affected || 0) > 0;
  }

  /*
   * Pages a run's first escalation rule: the run is started, the rule
   * pages, and the run is executing - or, with no escalation rules in its
   * policy, it ends with an error that says so. A run does this as it is
   * created, and a run that waited once its moment came (startWaitingRun),
   * which is started already and names when its page was due (dueAt).
   */
  private async startFirstEscalationRule(
    run: Model,
    options?:
      | {
          isStarted?: boolean | undefined;
          /*
           * When the page was due, for a run that waited: its page is timed
           * from then (OnCallPageTiming.startPage). Now without one.
           */
          dueAt?: Date | undefined;
        }
      | undefined,
  ): Promise<void> {
    /*
     * The policy's first escalation rule: its lowest place, which need not
     * be 1 (#9369).
     */
    const executionRule: OnCallDutyPolicyEscalationRule | null =
      await OnCallDutyPolicyEscalationRuleService.findFirstOfPolicy({
        projectId: run.projectId!,
        onCallDutyPolicyId: run.onCallDutyPolicyId!,
      });

    if (!executionRule) {
      await this.updateOneById({
        id: run.id!,
        data: {
          status: OnCallDutyPolicyStatus.Error,
          statusMessage: ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE,
        },
        props: {
          isRoot: true,
        },
      });

      return;
    }

    if (!options?.isStarted) {
      await this.updateOneById({
        id: run.id!,
        data: {
          status: OnCallDutyPolicyStatus.Started,
          statusMessage: ON_CALL_RUN_EXECUTION_STARTED_MESSAGE,
        },
        props: {
          isRoot: true,
        },
      });
    }

    let userNotificationEventType: UserNotificationEventType | null = null;

    /*
     * A test page (OnCallTestPage) has no record to read its kind from: it
     * says it is one, and pages its people through the rules of the kind
     * and severity it stands in for.
     */
    const isTestPage: boolean = isOnCallTestPage(run);

    if (isTestPage) {
      userNotificationEventType = UserNotificationEventType.TestPage;
    }

    if (run.triggeredByIncidentId) {
      userNotificationEventType = UserNotificationEventType.IncidentCreated;
    }

    if (run.triggeredByAlertId) {
      userNotificationEventType = UserNotificationEventType.AlertCreated;
    }

    if (run.triggeredByAlertEpisodeId) {
      userNotificationEventType = UserNotificationEventType.AlertEpisodeCreated;
    }

    if (run.triggeredByIncidentEpisodeId) {
      userNotificationEventType =
        UserNotificationEventType.IncidentEpisodeCreated;
    }

    if (!userNotificationEventType) {
      throw new BadDataException("Invalid userNotificationEventType");
    }

    /*
     * The page starts now - or, for a run started as its record was
     * created, when the record was, and for a run that waited, when its
     * hold ended (dueAt) - and every notification its first rule sends at
     * once is due then (OnCallPageTiming).
     */
    const pageStart: OnCallPageStartMoment = OnCallPageTiming.startPage({
      dueAt: options?.dueAt,
    });

    const firstRuleOutcome: OnCallRuleExecutionOutcome =
      await OnCallPageTiming.runInPageStart(
        pageStart,
        (): Promise<OnCallRuleExecutionOutcome> => {
          return OnCallDutyPolicyEscalationRuleService.startRuleExecution(
            executionRule.id!,
            {
              projectId: run.projectId!,
              triggeredByIncidentId: run.triggeredByIncidentId,
              triggeredByAlertId: run.triggeredByAlertId,
              triggeredByAlertEpisodeId: run.triggeredByAlertEpisodeId,
              triggeredByIncidentEpisodeId: run.triggeredByIncidentEpisodeId,
              userNotificationEventType: userNotificationEventType!,
              onCallPolicyExecutionLogId: run.id!,
              onCallPolicyId: run.onCallDutyPolicyId!,
            },
          );
        },
      );

    /*
     * A test of the policy's first level only (OnCallTestPage) pages nobody
     * the dialog did not name: a first level that reached nobody ends it,
     * saying so, rather than moving on to the next level.
     */
    const isFirstLevelOnlyTest: boolean =
      isTestPage && !run.testPageWalksEscalation;

    if (isFirstLevelOnlyTest && firstRuleOutcome?.movesOnAtOnce) {
      await this.updateOneById({
        id: run.id!,
        data: {
          status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
          statusMessage: ON_CALL_TEST_PAGE_FIRST_LEVEL_REACHED_NOBODY_MESSAGE,
        },
        props: {
          isRoot: true,
        },
      });

      return;
    }

    await this.updateOneById({
      id: run.id!,
      data: {
        status: OnCallDutyPolicyStatus.Executing,
        statusMessage: isTestPage
          ? ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE
          : "First escalation rule executed...",
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * The first rule reached nobody: there is nobody on it to wait for, so
     * the run moves on now - to the next level, or to its end - rather than
     * a whole wait later (Types/OnCallDutyPolicy/OnCallEmptyLevel). What it
     * pages there is due as the page starts, too.
     */
    if (firstRuleOutcome?.movesOnAtOnce) {
      await OnCallPageTiming.runInPageStart(
        pageStart,
        (): Promise<OnCallEscalationAdvanceResult | null> => {
          return OnCallEscalationAdvance.moveOnAtOnce({ runId: run.id! });
        },
      );
    }
  }

  // Whether the run pages about an incident, an alert or an episode.
  private isTriggeredByRecord(run: Model): boolean {
    return Boolean(
      run.triggeredByIncidentId ||
        run.triggeredByAlertId ||
        run.triggeredByAlertEpisodeId ||
        run.triggeredByIncidentEpisodeId,
    );
  }

  // The run's policy as a link to it in the Dashboard: [PolicyX](...).
  private async getPolicyLink(run: Model): Promise<MarkdownText | null> {
    if (!run.onCallDutyPolicyId) {
      return null;
    }

    const onCallPolicy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: run.onCallDutyPolicyId,
        select: {
          _id: true,
          projectId: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!onCallPolicy || !onCallPolicy.id) {
      return null;
    }

    return FeedMarkdown.link(
      onCallPolicy.name || "",
      (
        await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
          onCallPolicy.projectId!,
          onCallPolicy.id!,
        )
      ).toString(),
    );
  }

  /*
   * An entry of the feed of the record the run pages about - the
   * incident's, the alert's or the episode's. The feed only: Slack and
   * Teams get the run's one message instead.
   */
  private async addToRecordFeed(data: {
    run: Model;
    feedInfoInMarkdown: string;
    displayColor: Color;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    const run: Model = data.run;

    if (run.triggeredByIncidentId) {
      await IncidentFeedService.createIncidentFeedItem({
        incidentId: run.triggeredByIncidentId,
        projectId: run.projectId!,
        incidentFeedEventType: IncidentFeedEventType.OnCallPolicy,
        displayColor: data.displayColor,
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        userId: data.userId,
      });
    }

    if (run.triggeredByAlertId) {
      await AlertFeedService.createAlertFeedItem({
        alertId: run.triggeredByAlertId,
        projectId: run.projectId!,
        alertFeedEventType: AlertFeedEventType.OnCallPolicy,
        displayColor: data.displayColor,
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        userId: data.userId,
      });
    }

    if (run.triggeredByAlertEpisodeId) {
      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: run.triggeredByAlertEpisodeId,
        projectId: run.projectId!,
        alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OnCallPolicy,
        displayColor: data.displayColor,
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        userId: data.userId,
      });
    }

    if (run.triggeredByIncidentEpisodeId) {
      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: run.triggeredByIncidentEpisodeId,
        projectId: run.projectId!,
        incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.OnCallPolicy,
        displayColor: data.displayColor,
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        userId: data.userId,
      });
    }
  }

  public getDisplayColorByStatus(status: OnCallDutyPolicyStatus): Color {
    switch (status) {
      // Paging nobody yet, on purpose: it waits for its moment.
      case OnCallDutyPolicyStatus.Waiting:
        return Blue500;
      case OnCallDutyPolicyStatus.Scheduled:
        return Blue500;
      case OnCallDutyPolicyStatus.Started:
        return Yellow500;
      case OnCallDutyPolicyStatus.Executing:
        return Yellow500;
      case OnCallDutyPolicyStatus.Completed:
        return Green500;
      /*
       * Amber, not green: the policy finished, but finishing without paging
       * anyone is a failure of the thing the policy exists to do.
       */
      case OnCallDutyPolicyStatus.CompletedWithNoNotifications:
        return Yellow500;
      case OnCallDutyPolicyStatus.Error:
        return Red500;
      default:
        return Blue500;
    }
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Every change to a run - its status, the escalation rule it is on, a
     * repeat, who acknowledged - can change what its Slack / Microsoft Teams
     * message says (OnCallPolicyRunMessage).
     */
    for (const id of updatedItemIds) {
      OnCallPolicyRunMessage.refresh(id);
    }

    /*
     * When the status is updated, each execution log the update wrote that
     * an incident, an alert or an episode triggered adds its new status to
     * that record's feed - when the status is news there: how the run ended.
     * Its start is already in the feed (onCreateSuccess) and so is every
     * page it sent, so "started" and "executing" would only say it again
     * (OnCallFeedText.isRunStatusFeedNews).
     */
    if (
      !onUpdate.updateBy.data.status ||
      !OnCallFeedText.isRunStatusFeedNews(
        onUpdate.updateBy.data.status as OnCallDutyPolicyStatus,
      )
    ) {
      return onUpdate;
    }

    for (const id of updatedItemIds) {
      await this.addRunStatusToFeed(id);
    }

    return onUpdate;
  }

  /*
   * A run's status as an entry of the feed of the record it pages about:
   * how it ended, and why when that adds something (OnCallFeedText).
   */
  private async addRunStatusToFeed(executionLogId: ObjectID): Promise<void> {
    const onCalldutyPolicyExecutionLog: Model | null = await this.findOneById({
      id: executionLogId,
      select: {
        _id: true,
        projectId: true,
        onCallDutyPolicyId: true,
        status: true,
        statusMessage: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        triggeredByAlertEpisodeId: true,
        triggeredByIncidentEpisodeId: true,
        triggeredByWorkflowName: true,
        triggeredByUserId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      !onCalldutyPolicyExecutionLog ||
      !this.isTriggeredByRecord(onCalldutyPolicyExecutionLog)
    ) {
      return;
    }

    /*
     * A direct page has no policy to name: its ending names who started the
     * page instead. A policy's run is read with its policy.
     */
    const isDirectPage: boolean = isOnCallDirectPage(
      onCalldutyPolicyExecutionLog,
    );

    const policyLink: MarkdownText | null = isDirectPage
      ? null
      : await this.getPolicyLink(onCalldutyPolicyExecutionLog);

    if (!isDirectPage && !policyLink) {
      return;
    }

    // One sentence, and why when that adds something (OnCallFeedText).
    const feedInfoInMarkdown: string = policyLink
      ? OnCallFeedText.getRunStatusMarkdown({
          status: onCalldutyPolicyExecutionLog.status!,
          policyLink: policyLink,
          statusMessage: onCalldutyPolicyExecutionLog.statusMessage,
        })
      : OnCallFeedText.getDirectPageStatusMarkdown({
          status: onCalldutyPolicyExecutionLog.status!,
          pager: await this.getDirectPagePager(onCalldutyPolicyExecutionLog),
          statusMessage: onCalldutyPolicyExecutionLog.statusMessage,
        });

    await this.addToRecordFeed({
      run: onCalldutyPolicyExecutionLog,
      feedInfoInMarkdown: feedInfoInMarkdown,
      displayColor: onCalldutyPolicyExecutionLog.status
        ? this.getDisplayColorByStatus(onCalldutyPolicyExecutionLog.status)
        : Blue500,
    });
  }
}
export default new Service();
