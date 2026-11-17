import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AlertService from "./AlertService";
import CallLogService from "./CallLogService";
import EmailLogService from "./EmailLogService";
import IncidentService from "./IncidentService";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "./OnCallDutyPolicyExecutionLogTimelineService";
import PushNotificationLogService from "./PushNotificationLogService";
import SmsLogService from "./SmsLogService";
import TelegramLogService from "./TelegramLogService";
import WebhookLogService from "./WebhookLogService";
import WhatsAppLogService from "./WhatsAppLogService";
import WorkspaceNotificationLogService from "./WorkspaceNotificationLogService";
import Alert from "../../Models/DatabaseModels/Alert";
import CallLog from "../../Models/DatabaseModels/CallLog";
import EmailLog from "../../Models/DatabaseModels/EmailLog";
import Incident from "../../Models/DatabaseModels/Incident";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import PushNotificationLog from "../../Models/DatabaseModels/PushNotificationLog";
import SmsLog from "../../Models/DatabaseModels/SmsLog";
import TelegramLog from "../../Models/DatabaseModels/TelegramLog";
import WebhookLog from "../../Models/DatabaseModels/WebhookLog";
import WhatsAppLog from "../../Models/DatabaseModels/WhatsAppLog";
import WorkspaceNotificationLog from "../../Models/DatabaseModels/WorkspaceNotificationLog";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import MailStatus from "../../Types/Mail/MailStatus";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import {
  WHO_WAS_TOLD_ROWS_PER_KIND,
  WhoWasToldLogKind,
  WhoWasToldLogRow,
  WhoWasToldResult,
  WhoWasToldRun,
  WhoWasToldStepRow,
  WhoWasToldSubscribers,
  buildWhoWasTold,
  getWhoWasToldWebhookHost,
} from "../../Types/Notification/WhoWasTold";
import ObjectID from "../../Types/ObjectID";
import { isOnCallDirectPage } from "../../Types/OnCallDutyPolicy/OnCallDirectPage";
import { readOnCallPageChannels } from "../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPageRecordKind } from "../../Types/OnCallDutyPolicy/OnCallTestPage";
import SmsStatus from "../../Types/SmsStatus";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import WorkspaceNotificationActionType from "../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";

/*
 * WHO WAS TOLD ABOUT AN INCIDENT OR AN ALERT, AS IT HAPPENED (#7075,
 * Types/Notification/WhoWasTold).
 *
 * Reads what happened - the record's on-call runs and their steps, and its
 * notification logs - and hands it to buildWhoWasTold, which groups it by
 * person and channel. Reads only, and every read is the caller's own:
 *
 *   - THE RECORD FIRST. The incident or alert is read as the caller, so a
 *     private one they may not read (#8913) - or one in another project -
 *     is not found, and nothing else is read.
 *   - EVERY ROW AS THE CALLER. Runs and steps are read through their policy
 *     (a policy the caller may not read hides its runs), each kind of log by
 *     its own permission (Read SMS Log, ...) and, like everything about a
 *     private record, only by those who see the record. A person's own page
 *     (UserOnCallLogTimeline) is theirs alone, so it is not read at all: a
 *     step says the channels a page went out by, and the logs say the rest.
 *   - WHAT THEY MAY NOT READ IS COUNTED, NEVER NAMED: each read is counted
 *     again as OneUptime, and only the difference leaves (#9155's pattern).
 *     A kind on the project's plan none of it may read (on-call on the Free
 *     plan) is neither shown nor counted.
 *
 * Status page subscribers are said by the incident's own "created"
 * notification status, and counted - never listed: a page can have
 * thousands of them, and they are no person of the project.
 */

// A log kind's reads, whatever its model.
interface LogKindReader {
  kind: WhoWasToldLogKind;
  // Its rows about the record, to people and channels, the latest first.
  find: (data: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
    limit: number;
  }) => Promise<Array<WhoWasToldLogRow>>;
  count: (data: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }) => Promise<number>;
  // The query that keeps a kind's rows to the ones this answer lists.
  extraQuery?: Record<string, unknown> | undefined;
}

// What every log row's read selects: its status, its person, its on-call page.
const LOG_SELECT: Record<string, unknown> = {
  _id: true,
  status: true,
  statusMessage: true,
  createdAt: true,
  userId: true,
  user: {
    name: true,
    email: true,
  },
  onCallDutyPolicyId: true,
  onCallDutyPolicyEscalationRuleId: true,
  onCallDutyPolicyScheduleId: true,
};

interface LogModelLike {
  id?: ObjectID | null | undefined;
  status?: string | undefined;
  statusMessage?: string | undefined;
  createdAt?: Date | undefined;
  userId?: ObjectID | undefined;
  user?: { name?: unknown; email?: unknown } | undefined;
  onCallDutyPolicyId?: ObjectID | undefined;
  onCallDutyPolicyEscalationRuleId?: ObjectID | undefined;
  onCallDutyPolicyScheduleId?: ObjectID | undefined;
  userOnCallLogTimelineId?: ObjectID | undefined;
}

// A person's name as their log reads it, by their name or else their email.
function nameOf(
  user: { name?: unknown; email?: unknown } | null | undefined,
): string | undefined {
  const name: string = user?.name ? String(user.name).trim() : "";

  if (name) {
    return name;
  }

  const email: string = user?.email ? String(user.email).trim() : "";

  return email || undefined;
}

function toIso(date: Date | string | null | undefined): string {
  if (!date) {
    return "";
  }

  try {
    return OneUptimeDate.fromString(date).toISOString();
  } catch {
    return "";
  }
}

// The fields every log row says the same way.
function toLogRow(
  kind: WhoWasToldLogKind,
  log: LogModelLike,
  where: Partial<WhoWasToldLogRow>,
): WhoWasToldLogRow {
  const row: WhoWasToldLogRow = {
    id: log.id?.toString() || "",
    kind: kind,
    status: log.status?.toString() || "",
    createdAt: toIso(log.createdAt),
    isOnCallPage: Boolean(
      log.onCallDutyPolicyId ||
        log.onCallDutyPolicyEscalationRuleId ||
        log.onCallDutyPolicyScheduleId ||
        log.userOnCallLogTimelineId,
    ),
    ...where,
  };

  if (log.statusMessage) {
    row.statusMessage = log.statusMessage.toString();
  }

  if (log.userId) {
    row.userId = log.userId.toString();

    const name: string | undefined = nameOf(log.user);

    if (name) {
      row.userName = name;
    }
  }

  return row;
}

/*
 * The reads of one kind of log, through its own service: the service's read
 * rules (its permissions, the private record filter) hold.
 */
function logKind<TModel extends LogModelLike>(data: {
  kind: WhoWasToldLogKind;
  service: {
    findBy: (findBy: never) => Promise<Array<TModel>>;
    countBy: (countBy: never) => Promise<{ toNumber: () => number }>;
  };
  select: Record<string, unknown>;
  where: (log: TModel) => Partial<WhoWasToldLogRow>;
  extraQuery?: Record<string, unknown> | undefined;
}): LogKindReader {
  return {
    kind: data.kind,
    extraQuery: data.extraQuery,
    find: async (read: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
      limit: number;
    }): Promise<Array<WhoWasToldLogRow>> => {
      const logs: Array<TModel> = await data.service.findBy({
        query: read.query,
        select: { ...LOG_SELECT, ...data.select },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: read.limit,
        props: read.props,
      } as never);

      return logs.map((log: TModel): WhoWasToldLogRow => {
        return toLogRow(data.kind, log, data.where(log));
      });
    },
    count: async (read: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }): Promise<number> => {
      return (
        await data.service.countBy({
          query: read.query,
          props: read.props,
        } as never)
      ).toNumber();
    },
  };
}

const LOG_KINDS: ReadonlyArray<LogKindReader> = [
  logKind<EmailLog>({
    kind: WhoWasToldLogKind.Email,
    service: EmailLogService as never,
    select: { toEmail: true },
    where: (log: EmailLog): Partial<WhoWasToldLogRow> => {
      return { address: log.toEmail?.toString() || undefined };
    },
  }),
  logKind<SmsLog>({
    kind: WhoWasToldLogKind.SMS,
    service: SmsLogService as never,
    select: { toNumber: true, userOnCallLogTimelineId: true },
    where: (log: SmsLog): Partial<WhoWasToldLogRow> => {
      return { address: log.toNumber?.toString() || undefined };
    },
  }),
  logKind<CallLog>({
    kind: WhoWasToldLogKind.Call,
    service: CallLogService as never,
    select: { toNumber: true, userOnCallLogTimelineId: true },
    where: (log: CallLog): Partial<WhoWasToldLogRow> => {
      return { address: log.toNumber?.toString() || undefined };
    },
  }),
  logKind<PushNotificationLog>({
    kind: WhoWasToldLogKind.Push,
    service: PushNotificationLogService as never,
    select: { deviceName: true },
    where: (log: PushNotificationLog): Partial<WhoWasToldLogRow> => {
      return { address: log.deviceName?.toString() || undefined };
    },
  }),
  logKind<WhatsAppLog>({
    kind: WhoWasToldLogKind.WhatsApp,
    service: WhatsAppLogService as never,
    select: { toNumber: true, userOnCallLogTimelineId: true },
    where: (log: WhatsAppLog): Partial<WhoWasToldLogRow> => {
      return { address: log.toNumber?.toString() || undefined };
    },
  }),
  logKind<TelegramLog>({
    kind: WhoWasToldLogKind.Telegram,
    service: TelegramLogService as never,
    select: { toChatId: true },
    where: (log: TelegramLog): Partial<WhoWasToldLogRow> => {
      return { address: log.toChatId?.toString() || undefined };
    },
  }),
  logKind<WebhookLog>({
    kind: WhoWasToldLogKind.Webhook,
    service: WebhookLogService as never,
    select: { webhookUrl: true },
    where: (log: WebhookLog): Partial<WhoWasToldLogRow> => {
      // Its host only: a webhook's path and query can hold its key.
      return {
        address:
          getWhoWasToldWebhookHost(log.webhookUrl?.toString()) || undefined,
      };
    },
  }),
  logKind<WorkspaceNotificationLog>({
    kind: WhoWasToldLogKind.Workspace,
    service: WorkspaceNotificationLogService as never,
    select: { workspaceType: true, channelId: true, channelName: true },
    where: (log: WorkspaceNotificationLog): Partial<WhoWasToldLogRow> => {
      return {
        workspaceType: (log.workspaceType as WorkspaceType) || undefined,
        channelId: log.channelId?.toString() || undefined,
        channelName: log.channelName?.toString() || undefined,
      };
    },
    // A message posted: not a channel made, a person invited or a button pressed.
    extraQuery: { actionType: WorkspaceNotificationActionType.SendMessage },
  }),
];

/*
 * The subscriber logs counted: the channels a status page tells its
 * subscribers by that keep a log naming the page - its emails and SMS - with
 * the statuses that mean one did not go out.
 */
const SUBSCRIBER_LOG_KINDS: ReadonlyArray<{
  service: {
    countBy: (countBy: never) => Promise<{ toNumber: () => number }>;
  };
  failedStatuses: Array<string>;
}> = [
  {
    service: EmailLogService as never,
    failedStatuses: [MailStatus.Error],
  },
  {
    service: SmsLogService as never,
    failedStatuses: [
      SmsStatus.Error,
      SmsStatus.Failed,
      SmsStatus.Undelivered,
      SmsStatus.LowBalance,
    ],
  },
];

// A read the caller may not make: their permissions refused it.
function isRefused(error: unknown): boolean {
  return error instanceof NotAuthorizedException;
}

// A read the project's plan does not include: neither shown nor counted.
function isNotOnPlan(error: unknown): boolean {
  return error instanceof PaymentRequiredException;
}

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

export class WhoWasToldService {
  @CaptureSpan()
  public static async getForIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WhoWasToldResult> {
    const incident: Incident | null = await IncidentService.findOneBy({
      query: {
        _id: data.incidentId.toString(),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        subscriberNotificationStatusOnIncidentCreated: true,
        subscriberNotificationStatusMessage: true,
      },
      props: data.props,
    });

    if (!incident) {
      throw new NotFoundException("Incident not found.");
    }

    return await this.read({
      projectId: data.projectId,
      recordKind: OnCallTestPageRecordKind.Incident,
      recordId: data.incidentId,
      props: data.props,
      subscribers: {
        status:
          (incident.subscriberNotificationStatusOnIncidentCreated as StatusPageSubscriberNotificationStatus) ||
          undefined,
        statusMessage:
          incident.subscriberNotificationStatusMessage?.toString() || undefined,
      },
    });
  }

  @CaptureSpan()
  public static async getForAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WhoWasToldResult> {
    const alert: Alert | null = await AlertService.findOneBy({
      query: {
        _id: data.alertId.toString(),
        projectId: data.projectId,
      },
      select: {
        _id: true,
      },
      props: data.props,
    });

    if (!alert) {
      throw new NotFoundException("Alert not found.");
    }

    return await this.read({
      projectId: data.projectId,
      recordKind: OnCallTestPageRecordKind.Alert,
      recordId: data.alertId,
      props: data.props,
    });
  }

  /*
   * Everything about one record the caller may read: they may read the
   * record (its caller checked).
   */
  private static async read(data: {
    projectId: ObjectID;
    recordKind: OnCallTestPageRecordKind;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
    // An incident's: its own created notification's status.
    subscribers?:
      | Pick<WhoWasToldSubscribers, "status" | "statusMessage">
      | undefined;
  }): Promise<WhoWasToldResult> {
    const isAlert: boolean = data.recordKind === OnCallTestPageRecordKind.Alert;
    const recordColumn: string = isAlert ? "alertId" : "incidentId";
    const triggeredByColumn: string = isAlert
      ? "triggeredByAlertId"
      : "triggeredByIncidentId";

    const [runRead, logReads, subscribers] = await Promise.all([
      this.readRuns({
        query: {
          projectId: data.projectId,
          [triggeredByColumn]: data.recordId,
        },
        props: data.props,
      }),
      Promise.all(
        LOG_KINDS.map(
          (
            kind: LogKindReader,
          ): Promise<{
            rows: Array<WhoWasToldLogRow>;
            hidden: number;
            isTruncated: boolean;
          }> => {
            return this.readLogs({
              kind: kind,
              query: {
                projectId: data.projectId,
                [recordColumn]: data.recordId,
                // Subscribers are counted below, never listed.
                statusPageId: QueryHelper.isNull(),
                ...(kind.extraQuery || {}),
              },
              props: data.props,
            });
          },
        ),
      ),
      data.subscribers
        ? this.readSubscribers({
            query: {
              projectId: data.projectId,
              [recordColumn]: data.recordId,
              statusPageId: QueryHelper.notNull(),
            },
            props: data.props,
            created: data.subscribers,
          })
        : Promise.resolve(undefined),
    ]);

    const steps: Array<WhoWasToldStepRow> = await this.readSteps({
      projectId: data.projectId,
      runIds: runRead.runs.map((run: WhoWasToldRun): string => {
        return run.id;
      }),
      props: data.props,
    });

    const logs: Array<WhoWasToldLogRow> = [];
    let hiddenNotificationCount: number = 0;
    let isTruncated: boolean = runRead.isTruncated;

    for (const read of logReads) {
      logs.push(...read.rows);
      hiddenNotificationCount += read.hidden;
      isTruncated = isTruncated || read.isTruncated;
    }

    return buildWhoWasTold({
      recordKind: data.recordKind,
      recordId: data.recordId.toString(),
      checkedAt: OneUptimeDate.getCurrentDate().toISOString(),
      runs: runRead.runs,
      steps: steps,
      logs: logs,
      subscribers: subscribers,
      hiddenNotificationCount: hiddenNotificationCount,
      hiddenRunCount: runRead.hidden,
      isTruncated: isTruncated,
    });
  }

  // The record's on-call runs the caller may read, and how many they may not.
  private static async readRuns(data: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    runs: Array<WhoWasToldRun>;
    hidden: number;
    isTruncated: boolean;
  }> {
    let runs: Array<OnCallDutyPolicyExecutionLog> = [];
    let isReadable: boolean = true;

    try {
      runs = await OnCallDutyPolicyExecutionLogService.findBy({
        query: data.query as never,
        select: {
          _id: true,
          status: true,
          statusMessage: true,
          createdAt: true,
          userNotificationEventType: true,
          acknowledgedAt: true,
          acknowledgedByUser: {
            name: true,
            email: true,
          },
          onCallDutyPolicyId: true,
          onCallDutyPolicy: {
            _id: true,
            name: true,
          },
        },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: WHO_WAS_TOLD_ROWS_PER_KIND,
        props: data.props,
      });
    } catch (error) {
      if (isNotOnPlan(error)) {
        return { runs: [], hidden: 0, isTruncated: false };
      }

      if (!isRefused(error)) {
        throw error;
      }

      isReadable = false;
    }

    const hidden: number = await this.countHidden({
      readableCount: isReadable
        ? await this.countReadable({
            rows: runs.length,
            count: async (): Promise<number> => {
              return (
                await OnCallDutyPolicyExecutionLogService.countBy({
                  query: data.query as never,
                  props: data.props,
                })
              ).toNumber();
            },
          })
        : 0,
      countEvery: async (): Promise<number> => {
        return (
          await OnCallDutyPolicyExecutionLogService.countBy({
            query: data.query as never,
            props: ROOT,
          })
        ).toNumber();
      },
    });

    return {
      runs: runs.map((run: OnCallDutyPolicyExecutionLog): WhoWasToldRun => {
        const item: WhoWasToldRun = {
          id: run.id?.toString() || "",
          policyName: run.onCallDutyPolicy?.name?.toString() || "",
          isDirectPage: isOnCallDirectPage(run),
          status: run.status?.toString() || "",
          statusMessage: run.statusMessage?.toString() || "",
          startedAt: toIso(run.createdAt),
        };

        if (run.onCallDutyPolicyId) {
          item.policyId = run.onCallDutyPolicyId.toString();
        }

        if (run.userNotificationEventType) {
          item.userNotificationEventType =
            run.userNotificationEventType.toString();
        }

        if (run.acknowledgedAt) {
          item.acknowledgedAt = toIso(run.acknowledgedAt);

          const name: string | undefined = nameOf(run.acknowledgedByUser);

          if (name) {
            item.acknowledgedByName = name;
          }
        }

        return item;
      }),
      hidden: hidden,
      isTruncated: runs.length >= WHO_WAS_TOLD_ROWS_PER_KIND,
    };
  }

  /*
   * The steps of the runs the caller may read: each person a level paged,
   * or each target that reached nobody, and the channels a page went out by.
   */
  private static async readSteps(data: {
    projectId: ObjectID;
    runIds: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<WhoWasToldStepRow>> {
    if (data.runIds.length === 0) {
      return [];
    }

    let steps: Array<OnCallDutyPolicyExecutionLogTimeline> = [];

    try {
      steps = await OnCallDutyPolicyExecutionLogTimelineService.findBy({
        query: {
          projectId: data.projectId,
          onCallDutyPolicyExecutionLogId: QueryHelper.any(
            data.runIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        },
        select: {
          _id: true,
          onCallDutyPolicyExecutionLogId: true,
          status: true,
          statusMessage: true,
          createdAt: true,
          userNotificationEventType: true,
          isAcknowledged: true,
          acknowledgedAt: true,
          alertSentToUserId: true,
          alertSentToUser: {
            name: true,
            email: true,
          },
          escalationRuleOrder: true,
          escalationRuleName: true,
          /*
           * The level's name as it is now. Its place is the line's own
           * (escalationRuleOrder, kept as the line is written): a rule's
           * order is no column a reader may read through a relation.
           */
          onCallDutyPolicyEscalationRule: {
            name: true,
          },
          userBelongsToTeam: {
            name: true,
          },
          onCallDutySchedule: {
            name: true,
          },
          isNextInRotation: true,
          overridedByUser: {
            name: true,
            email: true,
          },
          notificationChannels: true,
        },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: WHO_WAS_TOLD_ROWS_PER_KIND * 2,
        props: data.props,
      });
    } catch (error) {
      if (isRefused(error) || isNotOnPlan(error)) {
        // The runs say what the caller may read of them; the steps follow.
        return [];
      }

      throw error;
    }

    return steps.map(
      (step: OnCallDutyPolicyExecutionLogTimeline): WhoWasToldStepRow => {
        const row: WhoWasToldStepRow = {
          id: step.id?.toString() || "",
          runId: step.onCallDutyPolicyExecutionLogId?.toString() || "",
          status: step.status?.toString() || "",
          statusMessage: step.statusMessage?.toString() || "",
          createdAt: toIso(step.createdAt),
          // None for a step that reached nobody, or one written before steps kept them.
          channels: readOnCallPageChannels(step.notificationChannels) || [],
        };

        if (step.alertSentToUserId) {
          row.userId = step.alertSentToUserId.toString();

          const name: string | undefined = nameOf(step.alertSentToUser);

          if (name) {
            row.userName = name;
          }
        }

        if (step.userNotificationEventType) {
          row.userNotificationEventType =
            step.userNotificationEventType.toString();
        }

        if (step.isAcknowledged) {
          row.isAcknowledged = true;
        }

        if (step.acknowledgedAt) {
          row.acknowledgedAt = toIso(step.acknowledgedAt);
        }

        // The level's place as the line kept it, and its name as it is now, or as kept.
        const order: number | undefined = step.escalationRuleOrder || undefined;
        const levelName: string =
          step.onCallDutyPolicyEscalationRule?.name?.toString() ||
          step.escalationRuleName?.toString() ||
          "";

        if (order) {
          row.levelOrder = order;
        }

        if (levelName) {
          row.levelName = levelName;
        }

        if (step.userBelongsToTeam?.name) {
          row.teamName = step.userBelongsToTeam.name.toString();
        }

        if (step.onCallDutySchedule?.name) {
          row.scheduleName = step.onCallDutySchedule.name.toString();
        }

        if (step.isNextInRotation) {
          row.isNextInRotation = true;
        }

        const coveringFor: string | undefined = nameOf(step.overridedByUser);

        if (coveringFor) {
          row.coveringForName = coveringFor;
        }

        return row;
      },
    );
  }

  // One kind of log: the rows the caller may read, and how many they may not.
  private static async readLogs(data: {
    kind: LogKindReader;
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    rows: Array<WhoWasToldLogRow>;
    hidden: number;
    isTruncated: boolean;
  }> {
    let rows: Array<WhoWasToldLogRow> = [];
    let isReadable: boolean = true;

    try {
      rows = await data.kind.find({
        query: { ...data.query },
        props: data.props,
        limit: WHO_WAS_TOLD_ROWS_PER_KIND,
      });
    } catch (error) {
      if (isNotOnPlan(error)) {
        return { rows: [], hidden: 0, isTruncated: false };
      }

      if (!isRefused(error)) {
        throw error;
      }

      isReadable = false;
    }

    const hidden: number = await this.countHidden({
      readableCount: isReadable
        ? await this.countReadable({
            rows: rows.length,
            count: (): Promise<number> => {
              return data.kind.count({
                query: { ...data.query },
                props: data.props,
              });
            },
          })
        : 0,
      countEvery: (): Promise<number> => {
        return data.kind.count({ query: { ...data.query }, props: ROOT });
      },
    });

    return {
      rows: rows,
      hidden: hidden,
      isTruncated: rows.length >= WHO_WAS_TOLD_ROWS_PER_KIND,
    };
  }

  /*
   * How many rows the caller may read: the rows read, unless the read was
   * cut at its limit, when they are counted.
   */
  private static async countReadable(data: {
    rows: number;
    count: () => Promise<number>;
  }): Promise<number> {
    if (data.rows < WHO_WAS_TOLD_ROWS_PER_KIND) {
      return data.rows;
    }

    return await data.count();
  }

  /*
   * How many rows the caller may not read: every row, counted as OneUptime,
   * less the ones they may. Only the number leaves this service.
   */
  private static async countHidden(data: {
    readableCount: number;
    countEvery: () => Promise<number>;
  }): Promise<number> {
    try {
      return Math.max(0, (await data.countEvery()) - data.readableCount);
    } catch (error) {
      // A count that fails says nothing is hidden, rather than failing the answer.
      logger.error(error as Error);
      return 0;
    }
  }

  /*
   * The record's status page subscribers: its created notification, as the
   * incident keeps it, and its subscriber emails and SMS the caller may
   * read, counted.
   */
  private static async readSubscribers(data: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
    created: Pick<WhoWasToldSubscribers, "status" | "statusMessage">;
  }): Promise<WhoWasToldSubscribers> {
    const subscribers: WhoWasToldSubscribers = {
      sentCount: 0,
      failedCount: 0,
      areCountsReadable: true,
    };

    if (data.created.status) {
      subscribers.status = data.created.status;
    }

    if (data.created.statusMessage) {
      subscribers.statusMessage = data.created.statusMessage;
    }

    try {
      const counts: Array<{ every: number; failed: number }> =
        await Promise.all(
          SUBSCRIBER_LOG_KINDS.map(
            async (kind: {
              service: {
                countBy: (
                  countBy: never,
                ) => Promise<{ toNumber: () => number }>;
              };
              failedStatuses: Array<string>;
            }): Promise<{ every: number; failed: number }> => {
              const [every, failed] = await Promise.all([
                kind.service.countBy({
                  query: { ...data.query },
                  props: data.props,
                } as never),
                kind.service.countBy({
                  query: {
                    ...data.query,
                    status: QueryHelper.any(kind.failedStatuses),
                  },
                  props: data.props,
                } as never),
              ]);

              return { every: every.toNumber(), failed: failed.toNumber() };
            },
          ),
        );

      for (const count of counts) {
        subscribers.failedCount += count.failed;
        subscribers.sentCount += Math.max(0, count.every - count.failed);
      }
    } catch (error) {
      if (!isRefused(error) && !isNotOnPlan(error)) {
        throw error;
      }

      subscribers.areCountsReadable = false;
      subscribers.sentCount = 0;
      subscribers.failedCount = 0;
    }

    return subscribers;
  }
}

export default WhoWasToldService;
