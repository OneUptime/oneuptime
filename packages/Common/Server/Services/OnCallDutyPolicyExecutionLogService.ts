import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import OnCallDutyPolicyEscalationRuleService, {
  OnCallPagingOutcome,
  OnCallRuleExecutionOutcome,
} from "./OnCallDutyPolicyEscalationRuleService";
import OnCallEscalationAdvance from "../Utils/OnCall/OnCallEscalationAdvance";
import UserOnCallLogService from "./UserOnCallLogService";
import UserService from "./UserService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../Types/PositiveNumber";
import UserNotificationExecutionStatus from "../../Types/UserNotification/UserNotificationExecutionStatus";
import QueryHelper from "../Types/Database/QueryHelper";
import { ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE } from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import { toOnCallPersonPageMessage } from "../../Types/OnCallDutyPolicy/OnCallPersonPage";
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
import {
  ON_CALL_POLICY_RUN_STARTED_EARLY_REASON_MAX_LENGTH,
  getOnCallPolicyRunWaitingMessage,
} from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import { IsNull, UpdateResult } from "typeorm";
import FeedMarkdown, { MarkdownText } from "../../Utils/Markdown/FeedMarkdown";
import logger, { LogAttributes } from "../Utils/Logger";
import OnCallPolicyRunMessage from "../Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
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
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import {
  getOnCallPageAgainStatusMessage,
  isOnCallPageAgainRun,
} from "../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";

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
        "On-Call Duty Policy",
      )
    ) {
      throw new BadDataException(ON_CALL_POLICY_REQUIRED_MESSAGE);
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
      createBy.data.statusMessage = "Scheduled.";
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
    log.statusMessage = "Scheduled.";

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
        statusMessage: "Paging started...",
      },
      props: {
        isRoot: true,
      },
    });

    let outcome: OnCallPagingOutcome;

    try {
      outcome = await OnCallDutyPolicyEscalationRuleService.startDirectPage({
        projectId: data.projectId,
        triggeredByIncidentId: data.triggeredByIncidentId,
        triggeredByAlertId: data.triggeredByAlertId,
        userNotificationEventType: log.userNotificationEventType!,
        onCallPolicyExecutionLogId: executionLogId,
        targets: data.targets,
      });
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
  }): Promise<ObjectID | null> {
    const log: Model = new Model();

    log.projectId = data.projectId;
    log.onCallDutyPolicyId = data.onCallDutyPolicyId;
    log.userNotificationEventType = data.userNotificationEventType;
    log.status = OnCallDutyPolicyStatus.Scheduled;
    log.statusMessage = "Scheduled.";
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

    // Archived meanwhile: the run says it was not executed, as any run does.
    if (run.status === OnCallDutyPolicyStatus.Error) {
      return null;
    }

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
            statusMessage:
              "No Escalation Rules in Policy. Please add escalation rules to this policy.",
          },
          props: {
            isRoot: true,
          },
        });

        return runId;
      }

      await this.updateOneById({
        id: runId,
        data: {
          status: OnCallDutyPolicyStatus.Started,
          statusMessage: "Execution started...",
        },
        props: {
          isRoot: true,
        },
      });

      const firstRuleOutcome: OnCallRuleExecutionOutcome =
        await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
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
        await OnCallEscalationAdvance.moveOnAtOnce({ runId: runId });
      }
    } catch (err) {
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

      throw err;
    }

    return runId;
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

    return await OnCallDutyPolicyEscalationRuleService.findOneBy({
      query: {
        projectId: data.projectId,
        onCallDutyPolicyId: data.onCallDutyPolicyId,
      },
      select: {
        _id: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
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
   * while they are.
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
        status: QueryHelper.any([
          UserNotificationExecutionStatus.Scheduled,
          UserNotificationExecutionStatus.Started,
          UserNotificationExecutionStatus.Executing,
        ]),
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
      "On-Call Duty Policy",
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
            })
          : OnCallFeedText.getRunStartedMarkdown({
              policyLink: policyLink,
              isStartedBySomeone: Boolean(startedByUserId),
              startedByWorkflowName: createdItem.triggeredByWorkflowName,
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

    await this.startFirstEscalationRule(createdItem);

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
      statusMessage: "Execution started...",
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

    await this.startFirstEscalationRule(run, { isStarted: true });

    return true;
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
   * which is started already.
   */
  private async startFirstEscalationRule(
    run: Model,
    options?: { isStarted?: boolean | undefined } | undefined,
  ): Promise<void> {
    // get execution rules in this policy adn execute the first rule.
    const executionRule: OnCallDutyPolicyEscalationRule | null =
      await OnCallDutyPolicyEscalationRuleService.findOneBy({
        query: {
          projectId: run.projectId!,
          onCallDutyPolicyId: run.onCallDutyPolicyId!,
          order: 1,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    if (!executionRule) {
      await this.updateOneById({
        id: run.id!,
        data: {
          status: OnCallDutyPolicyStatus.Error,
          statusMessage:
            "No Escalation Rules in Policy. Please add escalation rules to this policy.",
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
          statusMessage: "Execution started...",
        },
        props: {
          isRoot: true,
        },
      });
    }

    let userNotificationEventType: UserNotificationEventType | null = null;

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

    const firstRuleOutcome: OnCallRuleExecutionOutcome =
      await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
        executionRule.id!,
        {
          projectId: run.projectId!,
          triggeredByIncidentId: run.triggeredByIncidentId,
          triggeredByAlertId: run.triggeredByAlertId,
          triggeredByAlertEpisodeId: run.triggeredByAlertEpisodeId,
          triggeredByIncidentEpisodeId: run.triggeredByIncidentEpisodeId,
          userNotificationEventType: userNotificationEventType,
          onCallPolicyExecutionLogId: run.id!,
          onCallPolicyId: run.onCallDutyPolicyId!,
        },
      );

    await this.updateOneById({
      id: run.id!,
      data: {
        status: OnCallDutyPolicyStatus.Executing,
        statusMessage: "First escalation rule executed...",
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * The first rule reached nobody: there is nobody on it to wait for, so
     * the run moves on now - to the next level, or to its end - rather than
     * a whole wait later (Types/OnCallDutyPolicy/OnCallEmptyLevel).
     */
    if (firstRuleOutcome?.movesOnAtOnce) {
      await OnCallEscalationAdvance.moveOnAtOnce({ runId: run.id! });
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
