import InstanceHealthLog, {
  InstanceHealthLogEventType,
  InstanceHealthLogStatus,
} from "Common/Models/DatabaseModels/InstanceHealthLog";
import User from "Common/Models/DatabaseModels/User";
import {
  AdminDashboardClientURL,
  HomeClientUrl,
  Host,
} from "Common/Server/EnvironmentConfig";
import InstanceHealthLogService from "Common/Server/Services/InstanceHealthLogService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * How long a failed or half-delivered notification waits before delivery is
 * retried. Long enough that a broken SMTP configuration cannot mail-bomb every
 * master admin, short enough that a transient outage self-heals.
 */
export const RETRY_COOLDOWN_IN_MINUTES: number = 60;

export interface NotificationDeliverySummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

/*
 * The outcome of one instance-health check. `isBreaching` is the only field the
 * state machine branches on; everything else shapes the log row and the email.
 *
 * There are three outcomes, and only two of them are this object:
 *   breaching        -> this object, isBreaching true
 *   clear            -> this object, isBreaching false (resolves an open notification)
 *   cannot evaluate  -> null
 *
 * "Cannot evaluate" means the datastore could not be probed right now. It is
 * strictly transient: it holds the current state so an unreachable datastore
 * cannot resolve a live notification and then immediately re-raise it. A check
 * that has become permanently inapplicable is NOT this case — see notApplicable
 * below, which resolves instead. Getting that wrong strands the stream.
 */
export interface InstanceHealthCheckResult {
  isBreaching: boolean;
  isCritical: boolean;
  // Subject line and body headline for the notification email.
  subject: string;
  badgeText: string;
  // Ordered detail rows rendered in the email's detail box.
  details: Array<{ title: string; text: string }>;
  // What the operator should do about it.
  remediation: string;
  breachMessage: string;
  resolvedMessage: string;
  observedPercent?: number | undefined;
  thresholdPercent?: number | undefined;
  metadata?: JSONObject | undefined;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/*
 * A check whose precondition has gone away — a limit the admin cleared, a
 * resource that no longer exists. It is NOT the same as an unevaluatable check:
 * this one is known to be inapplicable, so it must clear any open notification
 * rather than hold it. Holding it would strand NotificationActive forever,
 * because nothing else can ever move that stream again, and the strand would
 * silently suppress every future breach of the same event type.
 *
 * The email-shaped fields are never read: a non-breaching result only ever
 * produces a Resolved row.
 */
export function notApplicable(data: {
  subject: string;
  resolvedMessage: string;
  snapshot?: unknown;
}): InstanceHealthCheckResult {
  return {
    isBreaching: false,
    isCritical: false,
    subject: data.subject,
    badgeText: "Not Applicable",
    details: [],
    remediation: "",
    breachMessage: data.resolvedMessage,
    resolvedMessage: data.resolvedMessage,
    metadata:
      data.snapshot === undefined
        ? { resolutionDetail: "CheckNoLongerApplicable" }
        : {
            resolutionDetail: "CheckNoLongerApplicable",
            snapshot: serializeForMetadata(data.snapshot),
          },
  };
}

export function serializeForMetadata(value: unknown): JSONValue {
  return JSON.parse(
    JSON.stringify(value, (_key: string, currentValue: unknown): unknown => {
      return typeof currentValue === "bigint"
        ? currentValue.toString()
        : currentValue;
    }),
  ) as JSONValue;
}

export function mergeMetadata(
  current: JSONObject | undefined,
  additions: JSONObject,
): JSONObject {
  return Object.assign({}, current || {}, additions);
}

export function bytesToReadable(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units: Array<string> = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent: number = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const scaled: number = bytes / Math.pow(1024, exponent);
  const decimals: number = scaled >= 10 || exponent === 0 ? 0 : 1;

  return `${scaled.toFixed(decimals)} ${units[exponent]}`;
}

/*
 * addRoute mutates the URL it is called on, so this must build from a copy.
 * Appending to the AdminDashboardClientURL singleton would compound the route
 * on every send.
 */
export function getAdminDashboardHealthLink(healthRoute: string): string {
  if (!Host) {
    return "";
  }

  return URL.fromString(AdminDashboardClientURL.toString())
    .addRoute(new Route(healthRoute))
    .toString();
}

export async function getLatestInstanceHealthLog(
  eventType: InstanceHealthLogEventType,
): Promise<InstanceHealthLog | null> {
  return await InstanceHealthLogService.findOneBy({
    query: {
      eventType,
    },
    select: {
      _id: true,
      eventType: true,
      status: true,
      message: true,
      createdAt: true,
      completedAt: true,
      nextCheckAt: true,
      capacityBeforePercent: true,
      capacityAfterPercent: true,
      thresholdPercent: true,
      metadata: true,
    },
    sort: {
      createdAt: SortOrder.Descending,
    },
    props: {
      isRoot: true,
    },
  });
}

export async function createInstanceHealthLog(data: {
  eventType: InstanceHealthLogEventType;
  status: InstanceHealthLogStatus;
  message: string;
  completedAt?: Date | undefined;
  nextCheckAt?: Date | undefined;
  capacityBeforePercent?: number | undefined;
  capacityAfterPercent?: number | undefined;
  thresholdPercent?: number | undefined;
  metadata?: JSONObject | undefined;
}): Promise<InstanceHealthLog> {
  const log: InstanceHealthLog = new InstanceHealthLog();
  log.eventType = data.eventType;
  log.status = data.status;
  log.message = data.message;

  if (data.completedAt !== undefined) {
    log.completedAt = data.completedAt;
  }
  if (data.nextCheckAt !== undefined) {
    log.nextCheckAt = data.nextCheckAt;
  }
  if (data.capacityBeforePercent !== undefined) {
    log.capacityBeforePercent = data.capacityBeforePercent;
  }
  if (data.capacityAfterPercent !== undefined) {
    log.capacityAfterPercent = data.capacityAfterPercent;
  }
  if (data.thresholdPercent !== undefined) {
    log.thresholdPercent = data.thresholdPercent;
  }
  if (data.metadata !== undefined) {
    log.metadata = data.metadata;
  }

  return await InstanceHealthLogService.create({
    data: log,
    props: {
      isRoot: true,
    },
  });
}

async function updateInstanceHealthLog(data: {
  id: ObjectID;
  data: Partial<InstanceHealthLog>;
  props: { isRoot: boolean };
}): Promise<void> {
  await InstanceHealthLogService.updateOneById(data as never);
}

/*
 * Detail rows are rendered by a Handlebars template that cannot iterate an
 * arbitrary-length array, so the fixed detail1..detail6 slots below carry them.
 * Anything past the sixth row is dropped from the email but survives in the log
 * row's metadata.
 */
const MAX_EMAIL_DETAIL_ROWS: number = 6;

export async function sendInstanceHealthNotificationToMasterAdmins(data: {
  templateType: EmailTemplateType;
  check: InstanceHealthCheckResult;
  healthPageLink: string;
  healthPageButtonText: string;
}): Promise<NotificationDeliverySummary> {
  const summary: NotificationDeliverySummary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
  };
  const vars: Dictionary<string> = {
    subject: data.check.subject,
    badgeType: data.check.isCritical ? "critical" : "warning",
    badgeText: data.check.badgeText,
    oneuptimeHost: Host,
    homeURL: Host ? HomeClientUrl.toString() : "",
    healthPageLink: data.healthPageLink,
    healthPageButtonText: data.healthPageButtonText,
    remediation: data.check.remediation,
  };

  data.check.details
    .slice(0, MAX_EMAIL_DETAIL_ROWS)
    .forEach((detail: { title: string; text: string }, index: number): void => {
      vars[`detail${index + 1}Title`] = detail.title;
      vars[`detail${index + 1}Text`] = detail.text;
    });

  let skip: number = 0;

  for (;;) {
    const users: Array<User> = await UserService.findBy({
      query: {
        isMasterAdmin: true,
        isDisabled: false,
        isBlocked: false,
      },
      select: {
        _id: true,
        email: true,
      },
      skip,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const user of users) {
      if (!user.email) {
        continue;
      }

      summary.attempted++;

      try {
        const response: Awaited<ReturnType<typeof MailService.sendMail>> =
          await MailService.sendMail(
            {
              toEmail: user.email,
              templateType: data.templateType,
              subject: data.check.subject,
              vars,
            },
            {
              userId: user.id || undefined,
            },
          );

        if (response.isSuccess()) {
          summary.succeeded++;
        } else {
          summary.failed++;
        }
      } catch (error) {
        summary.failed++;
        logger.error(
          `InstanceHealth: Failed to email an instance-health warning: ${getErrorMessage(error)}`,
        );
      }
    }

    if (users.length < LIMIT_MAX) {
      break;
    }

    skip += users.length;
  }

  return summary;
}

/*
 * The shared threshold-crossing state machine behind every instance-health
 * notification. It keeps one durable InstanceHealthLog stream per event type
 * and moves it through:
 *
 *   (none) --breach--> Running --delivered--> NotificationActive --recovery--> Resolved
 *                         \--no delivery--> Failed --cooldown--> (retry)
 *
 * NotificationActive is the suppression state: while it holds, a still-breaching
 * check sends nothing, so an operator gets one email per incident rather than
 * one per tick. Recovery is what clears it, which is why an unevaluatable check
 * must pass check: null and not a synthesized "not breaching".
 */
export async function evaluateInstanceHealthNotification(data: {
  eventType: InstanceHealthLogEventType;
  templateType: EmailTemplateType;
  healthRoute: string;
  healthPageButtonText: string;
  isEnabled: boolean;
  latestLog: InstanceHealthLog | null;
  check: InstanceHealthCheckResult | null;
}): Promise<void> {
  const isActive: boolean =
    data.latestLog?.status === InstanceHealthLogStatus.NotificationActive;
  const isRetryableFailure: boolean =
    data.latestLog?.status === InstanceHealthLogStatus.Failed;
  const isPendingDelivery: boolean =
    data.latestLog?.status === InstanceHealthLogStatus.Running;

  if (!data.isEnabled) {
    /*
     * Turning a check off must also end any cycle it left open, or re-enabling
     * it months later would inherit a stale NotificationActive and stay silent
     * through a real breach.
     */
    if (isActive || isRetryableFailure || isPendingDelivery) {
      await createInstanceHealthLog({
        eventType: data.eventType,
        status: InstanceHealthLogStatus.Resolved,
        message:
          "This instance-health notification state was resolved because the notification was disabled.",
        completedAt: OneUptimeDate.getCurrentDate(),
        metadata: {
          resolutionReason: "NotificationsDisabled",
        },
      });
    }

    return;
  }

  // The datastore could not be probed. Hold the current state rather than guess.
  if (!data.check) {
    return;
  }

  if (
    (isRetryableFailure || isPendingDelivery) &&
    data.latestLog?.nextCheckAt &&
    data.latestLog.nextCheckAt.getTime() >
      OneUptimeDate.getCurrentDate().getTime() &&
    data.check.isBreaching
  ) {
    return;
  }

  if (data.check.isBreaching && !isActive) {
    /*
     * Persist pending delivery before sending mail. If this worker dies while
     * delivering, the durable cooldown prevents an immediate duplicate burst;
     * after it expires, delivery is safe to retry instead of staying silently
     * suppressed forever.
     */
    const activeLog: InstanceHealthLog = await createInstanceHealthLog({
      eventType: data.eventType,
      status: InstanceHealthLogStatus.Running,
      message: `${data.check.breachMessage} Notification delivery is pending.`,
      nextCheckAt: OneUptimeDate.getSomeMinutesAfter(RETRY_COOLDOWN_IN_MINUTES),
      capacityBeforePercent: data.check.observedPercent,
      thresholdPercent: data.check.thresholdPercent,
      metadata: data.check.metadata,
    });

    /*
     * Declared outside the try so the catch can tell "the send never happened"
     * from "the send succeeded and only the bookkeeping afterwards failed".
     * Those need opposite outcomes, and conflating them re-mails every master
     * admin an hour later over a database hiccup.
     */
    let delivery: NotificationDeliverySummary | null = null;

    try {
      delivery = await sendInstanceHealthNotificationToMasterAdmins({
        templateType: data.templateType,
        check: data.check,
        healthPageLink: getAdminDashboardHealthLink(data.healthRoute),
        healthPageButtonText: data.healthPageButtonText,
      });

      if (activeLog.id) {
        const noSuccessfulDelivery: boolean = delivery.succeeded === 0;
        const updateData: InstanceHealthLog = new InstanceHealthLog();
        updateData.status = noSuccessfulDelivery
          ? InstanceHealthLogStatus.Failed
          : InstanceHealthLogStatus.NotificationActive;
        updateData.completedAt = noSuccessfulDelivery
          ? OneUptimeDate.getCurrentDate()
          : (null as unknown as Date);
        updateData.nextCheckAt = noSuccessfulDelivery
          ? OneUptimeDate.getSomeMinutesAfter(RETRY_COOLDOWN_IN_MINUTES)
          : (null as unknown as Date);
        updateData.metadata = mergeMetadata(activeLog.metadata, {
          notificationDelivery: serializeForMetadata(delivery),
        });
        updateData.message = noSuccessfulDelivery
          ? `${data.check.breachMessage} No notification email was delivered; retrying after a cooldown.`
          : `${data.check.breachMessage} Notification email delivery: ` +
            `${delivery.succeeded} succeeded, ${delivery.failed} failed.`;

        await updateInstanceHealthLog({
          id: activeLog.id,
          data: updateData,
          props: {
            isRoot: true,
          },
        });
      }
    } catch (error) {
      /*
       * A send that already succeeded stays succeeded. Only the record of it is
       * missing, so the notification is marked active and no retry is scheduled
       * — recording this as a delivery failure would mail every master admin a
       * second time once the cooldown expired.
       */
      const wasDelivered: boolean = (delivery?.succeeded ?? 0) > 0;

      if (activeLog.id) {
        const updateData: InstanceHealthLog = new InstanceHealthLog();
        updateData.status = wasDelivered
          ? InstanceHealthLogStatus.NotificationActive
          : InstanceHealthLogStatus.Failed;
        updateData.message = wasDelivered
          ? `${data.check.breachMessage} Notification email delivery: ` +
            `${delivery?.succeeded} succeeded, ${delivery?.failed} failed. ` +
            `Recording the result then failed: ${getErrorMessage(error)}`
          : `${data.check.breachMessage} Notification delivery failed before any confirmed email: ` +
            getErrorMessage(error);
        updateData.completedAt = wasDelivered
          ? (null as unknown as Date)
          : OneUptimeDate.getCurrentDate();
        updateData.nextCheckAt = wasDelivered
          ? (null as unknown as Date)
          : OneUptimeDate.getSomeMinutesAfter(RETRY_COOLDOWN_IN_MINUTES);
        updateData.metadata = mergeMetadata(activeLog.metadata, {
          notificationDeliveryError: getErrorMessage(error),
          ...(delivery
            ? { notificationDelivery: serializeForMetadata(delivery) }
            : {}),
        });

        await updateInstanceHealthLog({
          id: activeLog.id,
          data: updateData,
          props: {
            isRoot: true,
          },
        });
      }

      throw error;
    }

    return;
  }

  if (
    !data.check.isBreaching &&
    (isActive || isRetryableFailure || isPendingDelivery)
  ) {
    await createInstanceHealthLog({
      eventType: data.eventType,
      status: InstanceHealthLogStatus.Resolved,
      message: data.check.resolvedMessage,
      completedAt: OneUptimeDate.getCurrentDate(),
      capacityAfterPercent: data.check.observedPercent,
      thresholdPercent: data.check.thresholdPercent,
      metadata: mergeMetadata(data.check.metadata, {
        resolutionReason: "ConditionCleared",
      }),
    });
  }
}
