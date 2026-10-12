import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import URL from "../../../../Types/API/URL";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import WorkspaceLiveMessageKey from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import { WorkspacePayloadMarkdown } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import DatabaseConfig from "../../../DatabaseConfig";
import AlertEpisodeService from "../../../Services/AlertEpisodeService";
import AlertService from "../../../Services/AlertService";
import IncidentEpisodeService from "../../../Services/IncidentEpisodeService";
import IncidentService from "../../../Services/IncidentService";
import OnCallDutyPolicyEscalationRuleService, {
  NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
} from "../../../Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
import { NOT_A_PROJECT_MEMBER_STATUS_MESSAGE } from "../../../Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Services/UserOnCallLogTimelineService";
import WorkspaceLiveMessageService from "../../../Services/WorkspaceLiveMessageService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Services/WorkspaceNotificationRuleService";
import logger, { LogAttributes } from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceMessageTime from "../WorkspaceMessageTime";
import OnCallPolicyRunMessageView, {
  ON_CALL_RUN_NOT_PAGED,
  OnCallPolicyRun,
  OnCallPolicyRunAlarm,
  OnCallPolicyRunNotPaged,
  OnCallPolicyRunOutcome,
  OnCallPolicyRunPagedPerson,
  OnCallPolicyRunRule,
} from "./OnCallPolicyRunMessageView";
import WorkspaceLiveMessages from "./WorkspaceLiveMessages";

// What the timeline says when a rule paged somebody twice: not worth a line.
const ALREADY_NOTIFIED_TIMELINE_MESSAGE: string =
  "Skipped because notification sent to this user already.";

// "Skipped because ..." at the start of a timeline message, and its full stop.
const SKIPPED_BECAUSE_PREFIX: RegExp = /^skipped because\s+/i;
const TRAILING_FULL_STOP: RegExp = /\.\s*$/;

/*
 * A responder's own opt-out reads "You have opted out of ..." in their log;
 * in a channel it is about them: "has opted out of ...".
 */
const YOU_HAVE_PREFIX: RegExp = /^you have\s+/i;

// How each notification method reads in a list, in the order it is listed.
const METHOD_LABELS: Array<{
  field: keyof UserOnCallLogTimeline;
  label: string;
}> = [
  { field: "userCallId", label: "call" },
  { field: "userSmsId", label: "SMS" },
  { field: "userWhatsAppId", label: "WhatsApp" },
  { field: "userTelegramId", label: "Telegram" },
  { field: "userPushId", label: "push" },
  { field: "userEmailId", label: "email" },
  { field: "userSlackId", label: "Slack" },
  { field: "userMicrosoftTeamsId", label: "Microsoft Teams" },
  { field: "userWebhookId", label: "webhook" },
];

// A run, read for its message.
export interface OnCallPolicyRunReading {
  projectId: ObjectID;
  notificationFor: NotificationFor;
  run: OnCallPolicyRun;
  /*
   * Whether the run has anything to show yet: an escalation rule has started,
   * or the run is over. A run that is only being set up is not posted, so a
   * run that fails in its first step (no escalation rules, an archived
   * policy) says so in ONE new message.
   */
  hasStarted: boolean;
}

interface RunRecord {
  notificationFor: NotificationFor;
  label: string;
  url: URL;
  stateName?: string | undefined;
  isAcknowledged: () => Promise<boolean>;
}

interface RefreshInFlight {
  running: Promise<void>;
  runAgain: boolean;
}

/*
 * ONE MESSAGE PER ON-CALL POLICY RUN, IN EVERY CHANNEL A RECORD'S MESSAGES GO.
 *
 * Every change to a run - it starts, an escalation rule pages somebody or
 * nobody, a page reaches somebody by SMS, somebody acknowledges, the run
 * ends - calls refresh(). That reads the run as it stands and brings its
 * message up to date wherever the record's messages go (the channels
 * OneUptime created for the incident, alert or episode, and the channels and
 * chats its workspace rules name): posted once, edited after that
 * (WorkspaceLiveMessages), and a new message only when somebody has to act
 * (OnCallPolicyRunMessageView.getAlarms). The run's steps stay in the record's
 * feed in OneUptime, where they always were.
 *
 * refresh() never waits and never throws: paging somebody must not wait on
 * Slack or Microsoft Teams. Refreshes of one run in this process are folded
 * together - while one runs, any number of new ones become one more run
 * after it - and the work on the run's message is serialised across
 * processes (WorkspaceLiveMessages.withLock).
 */
export default class OnCallPolicyRunMessage {
  private static inFlight: Map<string, RefreshInFlight> = new Map<
    string,
    RefreshInFlight
  >();

  // Brings the run's message up to date soon. Never throws, never waits.
  public static refresh(
    executionLogId: ObjectID | string | null | undefined,
  ): void {
    if (!executionLogId) {
      return;
    }

    const id: string = executionLogId.toString();
    const current: RefreshInFlight | undefined = this.inFlight.get(id);

    if (current) {
      current.runAgain = true;
      return;
    }

    const refreshInFlight: RefreshInFlight = {
      running: Promise.resolve(),
      runAgain: false,
    };

    this.inFlight.set(id, refreshInFlight);

    refreshInFlight.running = (async (): Promise<void> => {
      try {
        do {
          refreshInFlight.runAgain = false;

          try {
            await this.syncRun(new ObjectID(id));
          } catch (err) {
            logger.error(
              "Could not bring the on-call policy run's Slack / Microsoft Teams message up to date.",
              { onCallDutyPolicyExecutionLogId: id } as LogAttributes,
            );
            logger.error(err, {
              onCallDutyPolicyExecutionLogId: id,
            } as LogAttributes);
          }
        } while (refreshInFlight.runAgain);
      } finally {
        this.inFlight.delete(id);
      }
    })();
  }

  // Resolves once no refresh is running or waiting in this process.
  public static async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all(
        Array.from(this.inFlight.values()).map(
          (refreshInFlight: RefreshInFlight): Promise<void> => {
            return refreshInFlight.running;
          },
        ),
      );
    }
  }

  /*
   * Reads the run and brings its message up to date in every place: posts it
   * where it has never been posted, edits it where it says something else
   * now, and posts each alarm the run calls for that no message of the run
   * has raised yet.
   */
  @CaptureSpan()
  public static async syncRun(executionLogId: ObjectID): Promise<void> {
    const messageKey: string =
      WorkspaceLiveMessageKey.forOnCallPolicyRun(executionLogId);

    /*
     * The run is read under the same hold as its message is written: two
     * workers handling two steps of one run would otherwise each read the
     * run, and the one that read it first could write that older state over
     * the newer edit - for good, if no later change came to correct it.
     */
    await WorkspaceLiveMessages.withLock(messageKey, async () => {
      const reading: OnCallPolicyRunReading | null =
        await this.readRun(executionLogId);

      if (!reading || !reading.hasStarted) {
        return;
      }

      const markdownBlock: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: OnCallPolicyRunMessageView.getMarkdown(reading.run),
      };

      const alarms: Array<OnCallPolicyRunAlarm> =
        OnCallPolicyRunMessageView.getAlarms(reading.run);

      const kept: Array<WorkspaceLiveMessage> =
        await WorkspaceLiveMessageService.findByMessageKey({
          projectId: reading.projectId,
          messageKey: messageKey,
        });

      if (kept.length === 0) {
        /*
         * The first post is a new message itself: whatever alarm the run
         * calls for now, it says already, so none is raised on top of it.
         */
        await WorkspaceLiveMessages.postEverywhere({
          projectId: reading.projectId,
          messageKey: messageKey,
          notificationFor: reading.notificationFor,
          messageBlocks: [markdownBlock],
          text: OnCallPolicyRunMessageView.getPlainText(reading.run),
          messageData: {
            alarms: alarms.map((alarm: OnCallPolicyRunAlarm): string => {
              return alarm.key;
            }),
          },
        });
        return;
      }

      const raised: Array<string> = this.getRaisedAlarms(kept);

      const newAlarms: Array<OnCallPolicyRunAlarm> = alarms.filter(
        (alarm: OnCallPolicyRunAlarm): boolean => {
          return !raised.includes(alarm.key);
        },
      );

      for (const alarm of newAlarms) {
        try {
          await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
            {
              projectId: reading.projectId,
              notificationFor: reading.notificationFor,
              feedInfoInMarkdown: alarm.markdown,
              // An alarm is posted to be seen: its notification says what is wrong.
              notificationText: alarm.text,
              workspaceNotification: {
                sendWorkspaceNotification: true,
              },
            },
          );
        } catch (err) {
          logger.error("Could not post an on-call alarm to Slack / Teams.", {
            projectId: reading.projectId.toString(),
          } as LogAttributes);
          logger.error(err, {
            projectId: reading.projectId.toString(),
          } as LogAttributes);
        }

        raised.push(alarm.key);
      }

      for (const keptMessage of kept) {
        await WorkspaceLiveMessages.updateKept({
          keptMessage: keptMessage,
          messageBlocks: [markdownBlock],
          text: OnCallPolicyRunMessageView.getPlainText(reading.run),
          messageData: {
            ...(keptMessage.messageData || {}),
            alarms: [...raised],
          },
        });
      }
    });
  }

  // The alarm keys any message of the run already raised.
  private static getRaisedAlarms(
    kept: Array<WorkspaceLiveMessage>,
  ): Array<string> {
    const raised: Array<string> = [];

    for (const keptMessage of kept) {
      const alarms: unknown = keptMessage.messageData?.alarms;

      if (!Array.isArray(alarms)) {
        continue;
      }

      for (const alarm of alarms) {
        if (typeof alarm === "string" && !raised.includes(alarm)) {
          raised.push(alarm);
        }
      }
    }

    return raised;
  }

  /*
   * The run as its message tells it, or null when there is nothing to tell:
   * the run is gone, it pages for no incident, alert or episode, or the
   * project is connected to neither Slack nor Microsoft Teams.
   */
  @CaptureSpan()
  public static async readRun(
    executionLogId: ObjectID,
  ): Promise<OnCallPolicyRunReading | null> {
    const executionLog: OnCallDutyPolicyExecutionLog | null =
      await OnCallDutyPolicyExecutionLogService.findOneById({
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
          lastExecutedEscalationRuleId: true,
          lastExecutedEscalationRuleOrder: true,
          lastEscalationRuleExecutedAt: true,
          executeNextEscalationRuleInMinutes: true,
          onCallPolicyExecutionRepeatCount: true,
          acknowledgedByUserId: true,
          acknowledgedByUser: {
            name: true,
            email: true,
          },
          onCallDutyPolicy: {
            _id: true,
            name: true,
            repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (
      !executionLog ||
      !executionLog.projectId ||
      !executionLog.onCallDutyPolicyId
    ) {
      return null;
    }

    const projectId: ObjectID = executionLog.projectId;

    const connected: Array<unknown> =
      await WorkspaceLiveMessages.getConnectedWorkspaceTypes(projectId);

    if (connected.length === 0) {
      return null;
    }

    const record: RunRecord | null = await this.readRecord(executionLog);

    if (!record) {
      return null;
    }

    const rules: Array<OnCallDutyPolicyEscalationRule> =
      await OnCallDutyPolicyEscalationRuleService.findBy({
        query: {
          projectId: projectId,
          onCallDutyPolicyId: executionLog.onCallDutyPolicyId,
        },
        select: {
          _id: true,
          name: true,
          order: true,
          escalateAfterInMinutes: true,
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

    const timeline: Array<OnCallDutyPolicyExecutionLogTimeline> =
      await OnCallDutyPolicyExecutionLogTimelineService.findBy({
        query: {
          projectId: projectId,
          onCallDutyPolicyExecutionLogId: executionLogId,
        },
        select: {
          _id: true,
          status: true,
          statusMessage: true,
          alertSentToUserId: true,
          alertSentToUser: {
            name: true,
            email: true,
          },
          overridedByUserId: true,
          overridedByUser: {
            name: true,
            email: true,
          },
          onCallDutyPolicyEscalationRuleId: true,
          onCallDutyScheduleId: true,
          onCallDutySchedule: {
            name: true,
          },
          isAcknowledged: true,
          createdAt: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const deliveries: Array<UserOnCallLogTimeline> =
      await UserOnCallLogTimelineService.findBy({
        query: {
          projectId: projectId,
          onCallDutyPolicyExecutionLogId: executionLogId,
        },
        select: {
          _id: true,
          userId: true,
          status: true,
          userCallId: true,
          userSmsId: true,
          userWhatsAppId: true,
          userTelegramId: true,
          userPushId: true,
          userEmailId: true,
          userSlackId: true,
          userMicrosoftTeamsId: true,
          userWebhookId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    const policyUrl: URL =
      await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
        projectId,
        executionLog.onCallDutyPolicyId,
      );

    const runUrl: URL = URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/on-call-duty/execution-logs/${executionLogId.toString()}`,
    );

    const run: OnCallPolicyRun = this.buildRun({
      executionLog: executionLog,
      rules: rules,
      timeline: timeline,
      deliveries: deliveries,
      policyUrl: policyUrl.toString(),
      runUrl: runUrl.toString(),
      recordLabel: record.label,
      recordUrl: record.url.toString(),
    });

    const outcome: {
      outcome: OnCallPolicyRunOutcome;
      detail?: string | undefined;
    } = await this.getOutcome({
      executionLog: executionLog,
      record: record,
    });

    run.outcome = outcome.outcome;
    run.outcomeDetail = outcome.detail;

    /*
     * Read from the run itself: a rule is under way (OneUptime records the
     * rule on the run before it writes the rule's first step), or the run
     * is over.
     */
    const hasStarted: boolean =
      run.outcome !== OnCallPolicyRunOutcome.Paging ||
      Boolean(executionLog.lastExecutedEscalationRuleId);

    return {
      projectId: projectId,
      notificationFor: record.notificationFor,
      run: run,
      hasStarted: hasStarted,
    };
  }

  /*
   * The run's message, from what its execution log and its timeline say -
   * everything but how it ended (getOutcome), which may need the record.
   */
  public static buildRun(data: {
    executionLog: OnCallDutyPolicyExecutionLog;
    rules: Array<OnCallDutyPolicyEscalationRule>;
    timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
    deliveries: Array<UserOnCallLogTimeline>;
    policyUrl: string;
    runUrl: string;
    recordLabel: string;
    recordUrl: string;
  }): OnCallPolicyRun {
    const executionLog: OnCallDutyPolicyExecutionLog = data.executionLog;

    const toRule: (
      rule: OnCallDutyPolicyEscalationRule | undefined,
    ) => OnCallPolicyRunRule | undefined = (
      rule: OnCallDutyPolicyEscalationRule | undefined,
    ): OnCallPolicyRunRule | undefined => {
      if (!rule || rule.order === undefined || rule.order === null) {
        return undefined;
      }

      return { order: rule.order, name: rule.name || undefined };
    };

    const ruleById: (
      ruleId: ObjectID | undefined | null,
    ) => OnCallDutyPolicyEscalationRule | undefined = (
      ruleId: ObjectID | undefined | null,
    ): OnCallDutyPolicyEscalationRule | undefined => {
      if (!ruleId) {
        return undefined;
      }

      return data.rules.find((rule: OnCallDutyPolicyEscalationRule) => {
        return rule.id?.toString() === ruleId.toString();
      });
    };

    const currentRuleModel: OnCallDutyPolicyEscalationRule | undefined =
      ruleById(executionLog.lastExecutedEscalationRuleId) ||
      data.rules.find((rule: OnCallDutyPolicyEscalationRule) => {
        return (
          executionLog.lastExecutedEscalationRuleOrder !== undefined &&
          executionLog.lastExecutedEscalationRuleOrder !== null &&
          rule.order === executionLog.lastExecutedEscalationRuleOrder
        );
      });

    const currentRule: OnCallPolicyRunRule | undefined =
      toRule(currentRuleModel);

    const nextRule: OnCallPolicyRunRule | undefined = currentRule
      ? toRule(
          data.rules.find((rule: OnCallDutyPolicyEscalationRule) => {
            return (rule.order || 0) > currentRule.order;
          }),
        )
      : undefined;

    // Everybody the run paged, in the order it first paged them.
    const pagedByUserId: Map<string, OnCallPolicyRunPagedPerson> = new Map<
      string,
      OnCallPolicyRunPagedPerson
    >();

    const notPaged: Array<OnCallPolicyRunNotPaged> = [];
    const notPagedKeys: Set<string> = new Set<string>();

    const addNotPaged: (key: string, entry: OnCallPolicyRunNotPaged) => void = (
      key: string,
      entry: OnCallPolicyRunNotPaged,
    ): void => {
      if (notPagedKeys.has(key)) {
        return;
      }

      notPagedKeys.add(key);
      notPaged.push(entry);
    };

    // Per escalation rule: why it paged fewer people, for a rule that reached nobody.
    const reasonsByRuleId: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    const addRuleReason: (
      ruleId: ObjectID | undefined | null,
      reason: string,
    ) => void = (ruleId: ObjectID | undefined | null, reason: string): void => {
      if (!ruleId) {
        return;
      }

      const reasons: Array<string> =
        reasonsByRuleId.get(ruleId.toString()) || [];

      if (!reasons.includes(reason)) {
        reasons.push(reason);
      }

      reasonsByRuleId.set(ruleId.toString(), reasons);
    };

    const rulesThatReachedNobody: Array<OnCallDutyPolicyEscalationRule> = [];

    for (const step of data.timeline) {
      const status: OnCallDutyExecutionLogTimelineStatus | undefined =
        step.status;

      if (step.alertSentToUserId) {
        const userId: string = step.alertSentToUserId.toString();
        const name: string = this.getPersonName(step.alertSentToUser);

        if (status === OnCallDutyExecutionLogTimelineStatus.Skipped) {
          if (step.statusMessage === ALREADY_NOTIFIED_TIMELINE_MESSAGE) {
            continue;
          }

          const reason: string = this.getSkipReason(step.statusMessage);

          addNotPaged(`person:${userId}:${reason}`, {
            personName: name,
            reason: reason,
          });
          addRuleReason(
            step.onCallDutyPolicyEscalationRuleId,
            `${name}: ${reason}`,
          );
          continue;
        }

        if (status === OnCallDutyExecutionLogTimelineStatus.Error) {
          const reason: string = step.statusMessage?.trim()
            ? `could not be paged (${step.statusMessage.trim().replace(TRAILING_FULL_STOP, "")})`
            : "could not be paged";

          addNotPaged(`person:${userId}:${reason}`, {
            personName: name,
            reason: reason,
            failed: true,
          });
          continue;
        }

        let person: OnCallPolicyRunPagedPerson | undefined =
          pagedByUserId.get(userId);

        if (!person) {
          person = {
            name: name,
            timesPaged: 0,
            isBeingPaged: false,
            acknowledged: false,
            methods: [],
            coveringFor: [],
          };
          pagedByUserId.set(userId, person);
        }

        if (
          status === OnCallDutyExecutionLogTimelineStatus.NotificationSent ||
          status ===
            OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged
        ) {
          person.timesPaged++;
        } else {
          // Started or Executing: the page is still going out.
          person.isBeingPaged = true;
        }

        if (
          status ===
            OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged ||
          step.isAcknowledged
        ) {
          person.acknowledged = true;
        }

        if (step.overridedByUserId) {
          const coveredName: string = this.getPersonName(step.overridedByUser);

          if (!person.coveringFor.includes(coveredName)) {
            person.coveringFor.push(coveredName);
          }
        }

        continue;
      }

      if (status !== OnCallDutyExecutionLogTimelineStatus.Skipped) {
        continue;
      }

      if (step.onCallDutyScheduleId) {
        const scheduleName: string =
          step.onCallDutySchedule?.name?.trim() || "(unnamed)";

        addNotPaged(`schedule:${step.onCallDutyScheduleId.toString()}`, {
          scheduleName: scheduleName,
          reason: "nobody was on call",
        });
        addRuleReason(
          step.onCallDutyPolicyEscalationRuleId,
          `nobody was on call in schedule ${scheduleName}`,
        );
        continue;
      }

      // A step with no person and no schedule: the rule reached nobody.
      const rule: OnCallDutyPolicyEscalationRule | undefined = ruleById(
        step.onCallDutyPolicyEscalationRuleId,
      );

      if (
        rule &&
        !rulesThatReachedNobody.some(
          (other: OnCallDutyPolicyEscalationRule): boolean => {
            return other.id?.toString() === rule.id?.toString();
          },
        )
      ) {
        rulesThatReachedNobody.push(rule);
      }
    }

    // A rule that reached nobody, with nothing else to say why: it has nobody to page.
    for (const rule of rulesThatReachedNobody) {
      const reasons: Array<string> =
        reasonsByRuleId.get(rule.id!.toString()) || [];

      if (reasons.length === 0) {
        addNotPaged(`rule:${rule.id!.toString()}`, {
          rule: toRule(rule),
          reason: "nobody to page",
        });
      }
    }

    // How each person's pages reached them.
    for (const delivery of data.deliveries) {
      if (
        !delivery.userId ||
        (delivery.status !== UserNotificationStatus.Sent &&
          delivery.status !== UserNotificationStatus.Acknowledged)
      ) {
        continue;
      }

      const person: OnCallPolicyRunPagedPerson | undefined = pagedByUserId.get(
        delivery.userId.toString(),
      );

      if (!person) {
        continue;
      }

      for (const method of METHOD_LABELS) {
        if (delivery[method.field] && !person.methods.includes(method.label)) {
          person.methods.push(method.label);
        }
      }
    }

    for (const person of pagedByUserId.values()) {
      person.methods.sort((a: string, b: string): number => {
        return (
          METHOD_LABELS.findIndex(
            (method: { field: keyof UserOnCallLogTimeline; label: string }) => {
              return method.label === a;
            },
          ) -
          METHOD_LABELS.findIndex(
            (method: { field: keyof UserOnCallLogTimeline; label: string }) => {
              return method.label === b;
            },
          )
        );
      });
    }

    const firstRule: OnCallDutyPolicyEscalationRule | undefined =
      rulesThatReachedNobody[0];

    const escalateAfterInMinutes: number =
      executionLog.executeNextEscalationRuleInMinutes ??
      currentRuleModel?.escalateAfterInMinutes ??
      0;

    /*
     * When the current rule's wait is over: the next step names that moment
     * rather than the wait, which never said from when. Known once the run
     * has recorded when the rule started.
     */
    const ruleStartedAt: Date | undefined =
      executionLog.lastEscalationRuleExecutedAt
        ? new Date(executionLog.lastEscalationRuleExecutedAt)
        : undefined;

    const nextStepAt: Date | undefined =
      ruleStartedAt &&
      !isNaN(ruleStartedAt.getTime()) &&
      escalateAfterInMinutes > 0
        ? WorkspaceMessageTime.endOfWait(ruleStartedAt, escalateAfterInMinutes)
        : undefined;

    return {
      policyName:
        executionLog.onCallDutyPolicy?.name?.trim() || "On-call policy",
      policyUrl: data.policyUrl,
      runUrl: data.runUrl,
      recordLabel: data.recordLabel,
      recordUrl: data.recordUrl,
      outcome: OnCallPolicyRunOutcome.Paging,
      acknowledgedByName: executionLog.acknowledgedByUserId
        ? this.getPersonName(executionLog.acknowledgedByUser)
        : undefined,
      ruleCount: data.rules.length,
      currentRule: currentRule,
      nextRule: nextRule,
      escalateAfterInMinutes: escalateAfterInMinutes,
      nextStepAt: nextStepAt,
      repeatNumber: Math.max(
        (executionLog.onCallPolicyExecutionRepeatCount || 1) - 1,
        0,
      ),
      repeatsAllowed:
        executionLog.onCallDutyPolicy
          ?.repeatPolicyIfNoOneAcknowledgesNoOfTimes || 0,
      paged: Array.from(pagedByUserId.values()),
      notPaged: notPaged,
      firstRuleThatReachedNobody: firstRule
        ? {
            rule: toRule(firstRule)!,
            reasons: reasonsByRuleId.get(firstRule.id!.toString()) || [
              "the rule has nobody to page",
            ],
          }
        : undefined,
    };
  }

  // How the run stands: still paging, or how it ended.
  private static async getOutcome(data: {
    executionLog: OnCallDutyPolicyExecutionLog;
    record: RunRecord;
  }): Promise<{
    outcome: OnCallPolicyRunOutcome;
    detail?: string | undefined;
  }> {
    const executionLog: OnCallDutyPolicyExecutionLog = data.executionLog;

    switch (executionLog.status) {
      case OnCallDutyPolicyStatus.Completed: {
        if (executionLog.acknowledgedByUserId) {
          return { outcome: OnCallPolicyRunOutcome.Acknowledged };
        }

        if (
          executionLog.statusMessage ===
          ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE
        ) {
          return { outcome: OnCallPolicyRunOutcome.PolicyArchived };
        }

        if (await data.record.isAcknowledged()) {
          return {
            outcome: OnCallPolicyRunOutcome.RecordHandled,
            detail: data.record.stateName,
          };
        }

        return { outcome: OnCallPolicyRunOutcome.NobodyAcknowledged };
      }
      case OnCallDutyPolicyStatus.CompletedWithNoNotifications:
        return { outcome: OnCallPolicyRunOutcome.NobodyReached };
      case OnCallDutyPolicyStatus.Error:
        return {
          outcome: OnCallPolicyRunOutcome.Failed,
          detail: executionLog.statusMessage?.trim() || undefined,
        };
      default:
        return { outcome: OnCallPolicyRunOutcome.Paging };
    }
  }

  // The incident, alert or episode the run pages for.
  private static async readRecord(
    executionLog: OnCallDutyPolicyExecutionLog,
  ): Promise<RunRecord | null> {
    const projectId: ObjectID = executionLog.projectId!;

    if (executionLog.triggeredByIncidentId) {
      const incidentId: ObjectID = executionLog.triggeredByIncidentId;
      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        select: {
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          currentIncidentState: {
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!incident) {
        return null;
      }

      return {
        notificationFor: { incidentId: incidentId },
        label: `Incident ${incident.incidentNumberWithPrefix || "#" + (incident.incidentNumber ?? "")}`,
        url: await IncidentService.getIncidentLinkInDashboard(
          projectId,
          incidentId,
        ),
        stateName: incident.currentIncidentState?.name || undefined,
        isAcknowledged: async (): Promise<boolean> => {
          return await IncidentService.isIncidentAcknowledged({
            incidentId: incidentId,
          });
        },
      };
    }

    if (executionLog.triggeredByAlertId) {
      const alertId: ObjectID = executionLog.triggeredByAlertId;
      const alert: Alert | null = await AlertService.findOneById({
        id: alertId,
        select: {
          alertNumber: true,
          alertNumberWithPrefix: true,
          currentAlertState: {
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        return null;
      }

      return {
        notificationFor: { alertId: alertId },
        label: `Alert ${alert.alertNumberWithPrefix || "#" + (alert.alertNumber ?? "")}`,
        url: await AlertService.getAlertLinkInDashboard(projectId, alertId),
        stateName: alert.currentAlertState?.name || undefined,
        isAcknowledged: async (): Promise<boolean> => {
          return await AlertService.isAlertAcknowledged({ alertId: alertId });
        },
      };
    }

    if (executionLog.triggeredByIncidentEpisodeId) {
      const episodeId: ObjectID = executionLog.triggeredByIncidentEpisodeId;
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneById({
          id: episodeId,
          select: {
            episodeNumber: true,
            episodeNumberWithPrefix: true,
            currentIncidentState: {
              name: true,
            },
          },
          props: {
            isRoot: true,
          },
        });

      if (!episode) {
        return null;
      }

      return {
        notificationFor: { incidentEpisodeId: episodeId },
        label: `Incident Episode ${episode.episodeNumberWithPrefix || "#" + (episode.episodeNumber ?? "")}`,
        url: await IncidentEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          episodeId,
        ),
        stateName: episode.currentIncidentState?.name || undefined,
        isAcknowledged: async (): Promise<boolean> => {
          return await IncidentEpisodeService.isEpisodeAcknowledged({
            episodeId: episodeId,
          });
        },
      };
    }

    if (executionLog.triggeredByAlertEpisodeId) {
      const episodeId: ObjectID = executionLog.triggeredByAlertEpisodeId;
      const episode: AlertEpisode | null =
        await AlertEpisodeService.findOneById({
          id: episodeId,
          select: {
            episodeNumber: true,
            episodeNumberWithPrefix: true,
            currentAlertState: {
              name: true,
            },
          },
          props: {
            isRoot: true,
          },
        });

      if (!episode) {
        return null;
      }

      return {
        notificationFor: { alertEpisodeId: episodeId },
        label: `Alert Episode ${episode.episodeNumberWithPrefix || "#" + (episode.episodeNumber ?? "")}`,
        url: await AlertEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          episodeId,
        ),
        stateName: episode.currentAlertState?.name || undefined,
        isAcknowledged: async (): Promise<boolean> => {
          return await AlertEpisodeService.isEpisodeAcknowledged({
            episodeId: episodeId,
          });
        },
      };
    }

    return null;
  }

  private static getPersonName(
    user: { name?: unknown; email?: unknown } | undefined | null,
  ): string {
    const name: string = user?.name ? String(user.name).trim() : "";

    if (name) {
      return name;
    }

    const email: string = user?.email ? String(user.email).trim() : "";

    return email || "Someone";
  }

  // "Skipped because this user is not a member of the project." -> a phrase.
  private static getSkipReason(statusMessage: string | undefined): string {
    if (!statusMessage || !statusMessage.trim()) {
      return ON_CALL_RUN_NOT_PAGED;
    }

    /*
     * Both ways OneUptime says somebody is not in the project: the rule
     * found them gone before paging, or their page found them gone.
     */
    if (
      statusMessage === NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE ||
      statusMessage === NOT_A_PROJECT_MEMBER_STATUS_MESSAGE
    ) {
      return "not a member of this project";
    }

    const reason: string = statusMessage
      .trim()
      .replace(SKIPPED_BECAUSE_PREFIX, "")
      .replace(YOU_HAVE_PREFIX, "has ")
      .replace(TRAILING_FULL_STOP, "");

    return reason || ON_CALL_RUN_NOT_PAGED;
  }
}
