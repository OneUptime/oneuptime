import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { isOnCallDirectPage } from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import { getOnCallPolicyRepeatsAllowed } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import {
  ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
  OnCallPassOnRule,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertService from "../../Services/AlertService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentService from "../../Services/IncidentService";
import OnCallDutyPolicyEscalationRuleService from "../../Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../Services/OnCallDutyPolicyExecutionLogTimelineService";
import UserOnCallLogService from "../../Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OnCallEscalationAdvance, {
  OnCallEscalationAdvanceKind,
  OnCallEscalationAdvanceResult,
} from "./OnCallEscalationAdvance";

/*
 * PASSING A PAGE ON - THE SERVER SIDE OF "CAN'T TAKE IT? PASS IT ON."
 *
 * What it does, and why, is in Types/OnCallDutyPolicy/OnCallPagePassOn. This
 * is the one place that does it, for every way in: the links in a person's
 * own messages and the page they open (UserOnCallLogTimelineAPI), the second
 * key of a phone call, and the Dashboard and the mobile app signed in as the
 * person (OnCallPagePassOnAPI). Whoever calls it has made sure the person is
 * who they say they are - a signed link, their own call, their own session:
 * this only ever passes on the pages of the person it is given.
 *
 * A person's page in a run is their notification log (UserOnCallLog) - one
 * for each escalation rule, and each repeat, that paged them - with the
 * run's timeline line for it (OnCallDutyPolicyExecutionLogTimeline). Passing
 * on marks every one of theirs in the run that is still theirs to take:
 * "Passed On", which stops the notifications still due on it (the worker
 * sends only for logs that are executing) and, through the log's own update
 * (UserOnCallLogService), turns the timeline line to "Passed On" too - which
 * writes the record's feed entry and edits the run's Slack and Microsoft
 * Teams message.
 *
 * Then the run: when nobody else the current rule paged is left to take the
 * page, it moves on now (OnCallEscalationAdvance), claimed as the worker
 * claims it, so it moves on once. Everybody marks first and looks second, so
 * when two people on one rule pass at the same moment, the later of the two
 * looks sees both and moves the run on.
 */

// A run, read with everything passing on and moving the run on need.
const RUN_SELECT: Select<OnCallDutyPolicyExecutionLog> = {
  _id: true,
  projectId: true,
  onCallDutyPolicyId: true,
  status: true,
  statusMessage: true,
  createdAt: true,
  lastEscalationRuleExecutedAt: true,
  lastExecutedEscalationRuleId: true,
  lastExecutedEscalationRuleOrder: true,
  executeNextEscalationRuleInMinutes: true,
  onCallPolicyExecutionRepeatCount: true,
  userNotificationEventType: true,
  triggeredByIncidentId: true,
  triggeredByAlertId: true,
  triggeredByAlertEpisodeId: true,
  triggeredByIncidentEpisodeId: true,
  acknowledgedByUserId: true,
  acknowledgedByUser: {
    name: true,
    email: true,
  },
  onCallDutyPolicy: {
    _id: true,
    name: true,
    repeatPolicyIfNoOneAcknowledges: true,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
  },
};

// The statuses of a person's page that is still going out to them.
const SENDING_PAGE_STATUSES: Array<UserNotificationExecutionStatus> = [
  UserNotificationExecutionStatus.Scheduled,
  UserNotificationExecutionStatus.Started,
  UserNotificationExecutionStatus.Executing,
];

// The statuses of a run that is still paging.
const PAGING_RUN_STATUSES: Array<OnCallDutyPolicyStatus> = [
  OnCallDutyPolicyStatus.Scheduled,
  OnCallDutyPolicyStatus.Started,
  OnCallDutyPolicyStatus.Executing,
];

/*
 * A run's timeline line that says its person was reached and may still take
 * the page: being paged, or paged.
 */
const STILL_ON_THE_PAGE_LINE_STATUSES: Array<OnCallDutyExecutionLogTimelineStatus> =
  [
    OnCallDutyExecutionLogTimelineStatus.Started,
    OnCallDutyExecutionLogTimelineStatus.Executing,
    OnCallDutyExecutionLogTimelineStatus.NotificationSent,
  ];

// Where a person's page about a record stands, read before passing it on.
interface PassOnState {
  run: OnCallDutyPolicyExecutionLog;
  // Their pages in the run that are still theirs to take.
  openLogs: Array<UserOnCallLog>;
  // Every page of theirs in the run.
  logs: Array<UserOnCallLog>;
}

type ReadStateResult =
  | { state: PassOnState; answer?: undefined }
  | { state?: undefined; answer: OnCallPassOnAnswer };

// The record a run pages about, by the column that names it on a run and a log.
type RecordColumn =
  | "triggeredByIncidentId"
  | "triggeredByAlertId"
  | "triggeredByIncidentEpisodeId"
  | "triggeredByAlertEpisodeId";

export default class OnCallPagePassOn {
  // The column of a run, and of a person's page, that names a record.
  public static getRecordColumn(recordType: OnCallPageRecordType): RecordColumn {
    switch (recordType) {
      case OnCallPageRecordType.Incident:
        return "triggeredByIncidentId";
      case OnCallPageRecordType.Alert:
        return "triggeredByAlertId";
      case OnCallPageRecordType.IncidentEpisode:
        return "triggeredByIncidentEpisodeId";
      case OnCallPageRecordType.AlertEpisode:
      default:
        return "triggeredByAlertEpisodeId";
    }
  }

  /*
   * What passing a person's page in a run on would do - or why they cannot.
   * Changes nothing: the confirm page, the Dashboard and the mobile app say
   * it before the person decides.
   */
  @CaptureSpan()
  public static async getPreview(data: {
    userId: ObjectID;
    executionLogId: ObjectID;
  }): Promise<OnCallPassOnAnswer> {
    const read: ReadStateResult = await this.readState(data);

    if (!read.state) {
      return read.answer;
    }

    return {
      passedOn: false,
      result: await this.predict({
        userId: data.userId,
        run: read.state.run,
      }),
    };
  }

  /*
   * Passes a person's page in a run on, and says what came of it.
   *
   * `viaUserOnCallLogTimelineId` is the notification they passed it on
   * from - a link in an email, a text, a call - which is marked "Passed On"
   * as acknowledging marks the one acknowledged from. The caller has checked
   * it is theirs.
   */
  @CaptureSpan()
  public static async passOn(data: {
    userId: ObjectID;
    executionLogId: ObjectID;
    viaUserOnCallLogTimelineId?: ObjectID | undefined;
  }): Promise<OnCallPassOnAnswer> {
    const read: ReadStateResult = await this.readState(data);

    if (!read.state) {
      return read.answer;
    }

    const state: PassOnState = read.state;

    logger.debug(
      `User ${data.userId.toString()} passes on their page in execution log ${data.executionLogId.toString()}.`,
      {
        projectId: state.run.projectId?.toString(),
        userId: data.userId.toString(),
      } as LogAttributes,
    );

    /*
     * Their pages first: the notifications still due stop now, and the
     * run's timeline says they passed it on - which is what the look at who
     * is left, below, reads.
     */
    for (const log of state.openLogs) {
      await UserOnCallLogService.updateOneById({
        id: log.id!,
        data: {
          status: UserNotificationExecutionStatus.PassedOn,
          statusMessage: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (data.viaUserOnCallLogTimelineId) {
      await UserOnCallLogTimelineService.updateOneById({
        id: data.viaUserOnCallLogTimelineId,
        data: {
          status: UserNotificationStatus.PassedOn,
          statusMessage: ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const prediction: OnCallPassOnResult = await this.predict({
      userId: data.userId,
      run: state.run,
    });

    const result: OnCallPassOnResult = await this.carryOut({
      prediction: prediction,
      run: state.run,
    });

    return {
      passedOn: true,
      result: result,
    };
  }

  /*
   * The pages a person can pass on about one record: one for each of the
   * record's runs still paging them. Read cheaply - the record's runs that
   * are still paging, and the person's own pages still going out - since
   * every visit of a record's page in the Dashboard asks.
   */
  @CaptureSpan()
  public static async getOpenPagesForRecord(data: {
    userId: ObjectID;
    projectId: ObjectID;
    recordType: OnCallPageRecordType;
    recordId: ObjectID;
  }): Promise<Array<OnCallOpenPage>> {
    const pages: Array<OnCallOpenPage> = [];

    for (const executionLogId of await this.getRunIdsForRecord(data)) {
      const answer: OnCallPassOnAnswer = await this.getPreview({
        userId: data.userId,
        executionLogId: executionLogId,
      });

      if (answer.result) {
        pages.push({
          executionLogId: executionLogId.toString(),
          preview: answer.result,
        });
      }
    }

    return pages;
  }

  /*
   * Passes on every page a person can pass on about one record, and says
   * what came of each. None at all is one answer: not paged.
   */
  @CaptureSpan()
  public static async passOnForRecord(data: {
    userId: ObjectID;
    projectId: ObjectID;
    recordType: OnCallPageRecordType;
    recordId: ObjectID;
  }): Promise<Array<OnCallPassOnAnswer>> {
    const answers: Array<OnCallPassOnAnswer> = [];
    const refusals: Array<OnCallPassOnAnswer> = [];

    for (const executionLogId of await this.getRunIdsForRecord(data)) {
      const answer: OnCallPassOnAnswer = await this.passOn({
        userId: data.userId,
        executionLogId: executionLogId,
      });

      if (answer.passedOn) {
        answers.push(answer);
      } else if (answer.refusal !== OnCallPassOnRefusal.NotPaged) {
        refusals.push(answer);
      }
    }

    if (answers.length > 0) {
      return answers;
    }

    // Nothing passed on: why, once - the most telling reason first.
    if (refusals.length > 0) {
      return [refusals[0]!];
    }

    return [
      {
        passedOn: false,
        refusal: OnCallPassOnRefusal.NotPaged,
      },
    ];
  }

  // The runs about a record that may still have a page of the person's.
  private static async getRunIdsForRecord(data: {
    userId: ObjectID;
    projectId: ObjectID;
    recordType: OnCallPageRecordType;
    recordId: ObjectID;
  }): Promise<Array<ObjectID>> {
    const column: RecordColumn = this.getRecordColumn(data.recordType);

    // The record's runs still paging.
    const runs: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findBy({
        query: {
          projectId: data.projectId,
          status: QueryHelper.any(PAGING_RUN_STATUSES),
          [column]: data.recordId,
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    /*
     * And the person's own pages about it still going out, whose run may
     * have ended already: a push that repeats until somebody acknowledges
     * goes on after the run went through its last rule.
     */
    const sending: Array<UserOnCallLog> = await UserOnCallLogService.findBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        status: QueryHelper.any(SENDING_PAGE_STATUSES),
        [column]: data.recordId,
      },
      select: {
        onCallDutyPolicyExecutionLogId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return OnCallEscalationAdvance.uniqueIds([
      ...runs.map((run: OnCallDutyPolicyExecutionLog): ObjectID | undefined => {
        return run.id || undefined;
      }),
      ...sending.map((log: UserOnCallLog): ObjectID | undefined => {
        return log.onCallDutyPolicyExecutionLogId;
      }),
    ]);
  }

  /*
   * The run and the person's pages in it, or why there is nothing to pass
   * on: they are not paged in it, the record was taken, they passed it on
   * already, or it is over.
   */
  private static async readState(data: {
    userId: ObjectID;
    executionLogId: ObjectID;
  }): Promise<ReadStateResult> {
    const run: OnCallDutyPolicyExecutionLog | null =
      await OnCallDutyPolicyExecutionLogService.findOneById({
        id: data.executionLogId,
        select: RUN_SELECT,
        props: {
          isRoot: true,
        },
      });

    if (!run || !run.id || !run.projectId) {
      return {
        answer: { passedOn: false, refusal: OnCallPassOnRefusal.NotPaged },
      };
    }

    const logs: Array<UserOnCallLog> = await UserOnCallLogService.findBy({
      query: {
        onCallDutyPolicyExecutionLogId: run.id,
        userId: data.userId,
      },
      select: {
        _id: true,
        status: true,
        acknowledgedAt: true,
        onCallDutyPolicyEscalationRuleId: true,
        onCallDutyPolicyExecutionLogTimelineId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    if (logs.length === 0) {
      return {
        answer: { passedOn: false, refusal: OnCallPassOnRefusal.NotPaged },
      };
    }

    /*
     * Somebody took the record - its own acknowledgement, the person's, or
     * a colleague's: there is nothing to pass on.
     */
    const isTaken: boolean =
      logs.some((log: UserOnCallLog): boolean => {
        return Boolean(log.acknowledgedAt);
      }) || (await this.isRecordAcknowledged(run));

    if (isTaken) {
      return {
        answer: {
          passedOn: false,
          refusal: OnCallPassOnRefusal.RecordAcknowledged,
          ...(run.acknowledgedByUserId
            ? { acknowledgedByName: this.getPersonName(run.acknowledgedByUser) }
            : {}),
        },
      };
    }

    const openLogs: Array<UserOnCallLog> = logs.filter(
      (log: UserOnCallLog): boolean => {
        return (
          log.status !== UserNotificationExecutionStatus.PassedOn &&
          log.status !== UserNotificationExecutionStatus.Error
        );
      },
    );

    if (openLogs.length === 0) {
      const passedOnAlready: boolean = logs.some(
        (log: UserOnCallLog): boolean => {
          return log.status === UserNotificationExecutionStatus.PassedOn;
        },
      );

      return {
        answer: {
          passedOn: false,
          refusal: passedOnAlready
            ? OnCallPassOnRefusal.AlreadyPassedOn
            : OnCallPassOnRefusal.PageOver,
        },
      };
    }

    /*
     * A run that has stopped paging, with none of the person's
     * notifications still going out: the page is over, and passing it on
     * would change nothing.
     */
    const isRunPaging: boolean = PAGING_RUN_STATUSES.includes(
      run.status as OnCallDutyPolicyStatus,
    );

    const isStillSending: boolean = openLogs.some(
      (log: UserOnCallLog): boolean => {
        return SENDING_PAGE_STATUSES.includes(
          log.status as UserNotificationExecutionStatus,
        );
      },
    );

    if (!isRunPaging && !isStillSending) {
      return {
        answer: { passedOn: false, refusal: OnCallPassOnRefusal.PageOver },
      };
    }

    return {
      state: {
        run: run,
        logs: logs,
        openLogs: openLogs,
      },
    };
  }

  /*
   * Whether the record a run pages about is acknowledged or resolved:
   * somebody has taken it, and the run stops at its next tick.
   */
  private static async isRecordAcknowledged(
    run: OnCallDutyPolicyExecutionLog,
  ): Promise<boolean> {
    if (run.triggeredByIncidentId) {
      return await IncidentService.isIncidentAcknowledged({
        incidentId: run.triggeredByIncidentId,
      });
    }

    if (run.triggeredByAlertId) {
      return await AlertService.isAlertAcknowledged({
        alertId: run.triggeredByAlertId,
      });
    }

    if (run.triggeredByIncidentEpisodeId) {
      return await IncidentEpisodeService.isEpisodeAcknowledged({
        episodeId: run.triggeredByIncidentEpisodeId,
      });
    }

    if (run.triggeredByAlertEpisodeId) {
      return await AlertEpisodeService.isEpisodeAcknowledged({
        episodeId: run.triggeredByAlertEpisodeId,
      });
    }

    return false;
  }

  /*
   * What passing on comes to, as things stand: read after the person's
   * pages were marked (passOn), or as if they were (getPreview).
   */
  private static async predict(data: {
    userId: ObjectID;
    run: OnCallDutyPolicyExecutionLog;
  }): Promise<OnCallPassOnResult> {
    const run: OnCallDutyPolicyExecutionLog = data.run;
    const isDirectPage: boolean = isOnCallDirectPage(run);
    const policyName: string = isDirectPage
      ? ""
      : run.onCallDutyPolicy?.name?.trim() || "";

    const rules: Array<OnCallDutyPolicyEscalationRule> = isDirectPage
      ? []
      : await this.readRules(run);

    const base: OnCallPassOnResult = {
      outcome: OnCallPassOnOutcome.PagingStopped,
      isPreview: true,
      isDirectPage: isDirectPage,
      policyName: policyName,
      pagedNames: [],
      stillPagedNames: [],
      ruleCount: rules.length,
    };

    // A run that stopped paging already: nobody else is left to page.
    if (!PAGING_RUN_STATUSES.includes(run.status as OnCallDutyPolicyStatus)) {
      return base;
    }

    const lines: Array<OnCallDutyPolicyExecutionLogTimeline> =
      await this.readLines(run);

    const passedOn: Set<string> = new Set<string>(
      lines
        .filter((line: OnCallDutyPolicyExecutionLogTimeline): boolean => {
          return line.status === OnCallDutyExecutionLogTimelineStatus.PassedOn;
        })
        .map((line: OnCallDutyPolicyExecutionLogTimeline): string => {
          return line.alertSentToUserId!.toString().toLowerCase();
        }),
    );

    passedOn.add(data.userId.toString().toLowerCase());

    // Who else that part of the run reached, who has not passed it on.
    const stillOnIt: (
      inPart: (line: OnCallDutyPolicyExecutionLogTimeline) => boolean,
    ) => Array<string> = (
      inPart: (line: OnCallDutyPolicyExecutionLogTimeline) => boolean,
    ): Array<string> => {
      const names: Map<string, string> = new Map<string, string>();

      for (const line of lines) {
        if (
          !inPart(line) ||
          !STILL_ON_THE_PAGE_LINE_STATUSES.includes(
            line.status as OnCallDutyExecutionLogTimelineStatus,
          )
        ) {
          continue;
        }

        const key: string = line.alertSentToUserId!.toString().toLowerCase();

        if (passedOn.has(key) || names.has(key)) {
          continue;
        }

        names.set(key, this.getPersonName(line.alertSentToUser));
      }

      return Array.from(names.values());
    };

    // A direct page pages everybody at once: there is no rule to move on to.
    if (isDirectPage) {
      const others: Array<string> = stillOnIt((): boolean => {
        return true;
      });

      return others.length > 0
        ? {
            ...base,
            outcome: OnCallPassOnOutcome.OthersStillPaged,
            stillPagedNames: others,
          }
        : base;
    }

    const currentRule: OnCallDutyPolicyEscalationRule | undefined = rules.find(
      (rule: OnCallDutyPolicyEscalationRule): boolean => {
        return (
          Boolean(run.lastExecutedEscalationRuleId) &&
          rule.id?.toString() === run.lastExecutedEscalationRuleId?.toString()
        );
      },
    );

    const currentRuleId: string =
      run.lastExecutedEscalationRuleId?.toString() || "";

    const isOnCurrentRule: (ruleId: ObjectID | undefined | null) => boolean = (
      ruleId: ObjectID | undefined | null,
    ): boolean => {
      return Boolean(ruleId) && ruleId!.toString() === currentRuleId;
    };

    /*
     * Was the person paged by the rule the run is on? Not when their page
     * came from an earlier rule whose wait ran out: the run has moved on
     * already, and goes on as it is. A line that skipped them (away, say)
     * is no page.
     */
    const isPagedByCurrentRule: boolean = lines.some(
      (line: OnCallDutyPolicyExecutionLogTimeline): boolean => {
        return (
          isOnCurrentRule(line.onCallDutyPolicyEscalationRuleId) &&
          line.alertSentToUserId?.toString().toLowerCase() ===
            data.userId.toString().toLowerCase() &&
          (STILL_ON_THE_PAGE_LINE_STATUSES.includes(
            line.status as OnCallDutyExecutionLogTimelineStatus,
          ) ||
            line.status === OnCallDutyExecutionLogTimelineStatus.PassedOn)
        );
      },
    );

    if (!isPagedByCurrentRule) {
      return {
        ...base,
        outcome: OnCallPassOnOutcome.AlreadyEscalated,
        ...(currentRule ? { rule: this.toRule(currentRule) } : {}),
      };
    }

    const nextRule: OnCallDutyPolicyEscalationRule | undefined = rules.find(
      (rule: OnCallDutyPolicyEscalationRule): boolean => {
        return (
          typeof rule.order === "number" &&
          rule.order === (run.lastExecutedEscalationRuleOrder || 0) + 1
        );
      },
    );

    const others: Array<string> = stillOnIt(
      (line: OnCallDutyPolicyExecutionLogTimeline): boolean => {
        return isOnCurrentRule(line.onCallDutyPolicyEscalationRuleId);
      },
    );

    if (others.length > 0) {
      const startedAt: Date | undefined = run.lastEscalationRuleExecutedAt
        ? OneUptimeDate.fromString(run.lastEscalationRuleExecutedAt)
        : undefined;

      const waitInMinutes: number = run.executeNextEscalationRuleInMinutes || 0;

      return {
        ...base,
        outcome: OnCallPassOnOutcome.OthersStillPaged,
        stillPagedNames: others,
        ...(startedAt && !isNaN(startedAt.getTime())
          ? {
              nextStepAt: OneUptimeDate.addRemoveMinutes(
                startedAt,
                waitInMinutes,
              ),
            }
          : {}),
        ...(nextRule ? { nextRule: this.toRule(nextRule) } : {}),
      };
    }

    if (nextRule) {
      return {
        ...base,
        outcome: OnCallPassOnOutcome.NextRulePaged,
        rule: this.toRule(nextRule),
      };
    }

    const repeatCount: number = run.onCallPolicyExecutionRepeatCount || 0;

    if (
      repeatCount > 0 &&
      repeatCount <= getOnCallPolicyRepeatsAllowed(run.onCallDutyPolicy)
    ) {
      const firstRule: OnCallDutyPolicyEscalationRule | undefined = rules.find(
        (rule: OnCallDutyPolicyEscalationRule): boolean => {
          return rule.order === 1;
        },
      );

      return {
        ...base,
        outcome: OnCallPassOnOutcome.PolicyStartedAgain,
        ...(firstRule ? { rule: this.toRule(firstRule) } : {}),
      };
    }

    return base;
  }

  /*
   * Does what the prediction says, now that the person's pages are marked:
   * moves the run on, or ends a direct page nobody is left on.
   */
  private static async carryOut(data: {
    prediction: OnCallPassOnResult;
    run: OnCallDutyPolicyExecutionLog;
  }): Promise<OnCallPassOnResult> {
    const prediction: OnCallPassOnResult = {
      ...data.prediction,
      isPreview: false,
    };
    const run: OnCallDutyPolicyExecutionLog = data.run;
    const isRunPaging: boolean = PAGING_RUN_STATUSES.includes(
      run.status as OnCallDutyPolicyStatus,
    );

    switch (prediction.outcome) {
      case OnCallPassOnOutcome.OthersStillPaged:
      case OnCallPassOnOutcome.AlreadyEscalated:
        return prediction;
      case OnCallPassOnOutcome.PagingStopped:
        if (prediction.isDirectPage && isRunPaging) {
          await this.endDirectPage(run);
        } else if (isRunPaging) {
          // The last rule, with no repeat left: the run ends now.
          return await this.moveOn({ prediction: prediction, run: run });
        }

        return prediction;
      case OnCallPassOnOutcome.NextRulePaged:
      case OnCallPassOnOutcome.PolicyStartedAgain:
      default:
        return await this.moveOn({ prediction: prediction, run: run });
    }
  }

  /*
   * Moves a policy's run on now, as its wait running out would have
   * (OnCallEscalationAdvance), and says what that came to.
   */
  private static async moveOn(data: {
    prediction: OnCallPassOnResult;
    run: OnCallDutyPolicyExecutionLog;
  }): Promise<OnCallPassOnResult> {
    const advanced: OnCallEscalationAdvanceResult =
      await OnCallEscalationAdvance.advance({
        run: data.run,
        now: OneUptimeDate.getCurrentDate(),
      });

    switch (advanced.kind) {
      case OnCallEscalationAdvanceKind.RuleStarted:
      case OnCallEscalationAdvanceKind.PolicyStartedAgain:
        return {
          ...data.prediction,
          outcome:
            advanced.kind === OnCallEscalationAdvanceKind.RuleStarted
              ? OnCallPassOnOutcome.NextRulePaged
              : OnCallPassOnOutcome.PolicyStartedAgain,
          ...(advanced.rule
            ? {
                rule: {
                  order: advanced.rule.order,
                  name: advanced.rule.name,
                },
              }
            : {}),
          pagedNames: await this.getNames(advanced.pagedUserIds),
        };
      case OnCallEscalationAdvanceKind.Ended:
        return {
          ...data.prediction,
          outcome: OnCallPassOnOutcome.PagingStopped,
          pagedNames: [],
        };
      case OnCallEscalationAdvanceKind.NotClaimed:
      default: {
        /*
         * Somebody moved the run on in the same moment - the worker, or a
         * colleague passing the page on too. Where it is now is the answer.
         */
        const now: OnCallDutyPolicyExecutionLog | null =
          await OnCallDutyPolicyExecutionLogService.findOneById({
            id: data.run.id!,
            select: {
              status: true,
              lastExecutedEscalationRuleId: true,
              lastExecutedEscalationRuleOrder: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (
          !now ||
          !PAGING_RUN_STATUSES.includes(now.status as OnCallDutyPolicyStatus)
        ) {
          return {
            ...data.prediction,
            outcome: OnCallPassOnOutcome.PagingStopped,
          };
        }

        const currentRule: OnCallDutyPolicyEscalationRule | undefined = (
          await this.readRules(data.run)
        ).find((rule: OnCallDutyPolicyEscalationRule): boolean => {
          return (
            rule.id?.toString() === now.lastExecutedEscalationRuleId?.toString()
          );
        });

        return {
          ...data.prediction,
          outcome: OnCallPassOnOutcome.AlreadyEscalated,
          ...(currentRule ? { rule: this.toRule(currentRule) } : {}),
        };
      }
    }
  }

  /*
   * Ends a direct page that has nobody left on it: everybody it reached
   * passed it on (or could not be reached). Claimed as moving a run on is,
   * so two people passing at once end it once.
   */
  private static async endDirectPage(
    run: OnCallDutyPolicyExecutionLog,
  ): Promise<void> {
    const claimed: boolean =
      await OnCallDutyPolicyExecutionLogService.claimEscalationAdvance({
        executionLogId: run.id!,
        previousLastEscalationRuleExecutedAt:
          run.lastEscalationRuleExecutedAt || null,
        newLastEscalationRuleExecutedAt: OneUptimeDate.getCurrentDate(),
      });

    if (!claimed) {
      return;
    }

    const everybodyPassedItOn: boolean =
      await OnCallEscalationAdvance.hasEverybodyPassedItOn(run.id!);

    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: run.id!,
      data: {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: everybodyPassedItOn
          ? ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE
          : ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      },
      props: {
        isRoot: true,
      },
    });
  }

  // The run's escalation rules, in order. None for a direct page.
  private static async readRules(
    run: OnCallDutyPolicyExecutionLog,
  ): Promise<Array<OnCallDutyPolicyEscalationRule>> {
    if (!run.onCallDutyPolicyId || isOnCallDirectPage(run)) {
      return [];
    }

    return await OnCallDutyPolicyEscalationRuleService.findBy({
      query: {
        projectId: run.projectId!,
        onCallDutyPolicyId: run.onCallDutyPolicyId,
      },
      select: {
        _id: true,
        name: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });
  }

  // Every line of the run's timeline that names a person.
  private static async readLines(
    run: OnCallDutyPolicyExecutionLog,
  ): Promise<Array<OnCallDutyPolicyExecutionLogTimeline>> {
    return await OnCallDutyPolicyExecutionLogTimelineService.findBy({
      query: {
        onCallDutyPolicyExecutionLogId: run.id!,
        alertSentToUserId: QueryHelper.notNull(),
      },
      select: {
        _id: true,
        status: true,
        alertSentToUserId: true,
        alertSentToUser: {
          name: true,
          email: true,
        },
        onCallDutyPolicyEscalationRuleId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });
  }

  private static toRule(rule: OnCallDutyPolicyEscalationRule): OnCallPassOnRule {
    return {
      order: rule.order || 0,
      name: rule.name?.trim() || undefined,
    };
  }

  // People's names, in the order given.
  private static async getNames(
    userIds: Array<ObjectID>,
  ): Promise<Array<string>> {
    if (userIds.length === 0) {
      return [];
    }

    const users: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any(
          userIds.map((userId: ObjectID): string => {
            return userId.toString();
          }),
        ),
      },
      select: {
        _id: true,
        name: true,
        email: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return userIds.map((userId: ObjectID): string => {
      return this.getPersonName(
        users.find((user: User): boolean => {
          return user.id?.toString() === userId.toString();
        }),
      );
    });
  }

  // A person's name, or their email address, or "Someone".
  public static getPersonName(
    user: { name?: unknown; email?: unknown } | undefined | null,
  ): string {
    const name: string = user?.name ? String(user.name).trim() : "";

    if (name) {
      return name;
    }

    const email: string = user?.email ? String(user.email).trim() : "";

    return email || "Someone";
  }
}
