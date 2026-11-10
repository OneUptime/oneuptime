import { AsyncLocalStorage } from "async_hooks";
import GlobalCache from "../../Infrastructure/GlobalCache";
import logger from "../Logger";
import Telemetry from "../Telemetry";
import { OnCallPageStart } from "../Telemetry/NotificationDeliveryMetrics";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";

/*
 * HOW LONG AFTER ITS TRIGGER AN ON-CALL PAGE REACHED ITS PROVIDER
 * (notification.time_to_send, NotificationDeliveryMetrics).
 *
 * A monitor opens an incident, the incident's on-call policies page, each
 * person's On-Call Rules pick how they are reached, and each notification is
 * handed to Twilio, Expo, a custom channel. The platform's operator wants
 * that whole path timed, from the trigger to the provider accepting the
 * notification - and only the platform's part of it: a page whose rules say
 * "call me after 10 minutes", or that escalates after 15, waits because it
 * was told to, not because the platform is slow.
 *
 * So the notifications measured are the ones due as their page starts: the
 * first escalation rule's people, by their rules that wait for nothing (and
 * the levels a run moves on to at once, finding nobody before them). They
 * are the ones written while the page starts - in the same call, on the
 * same server - so the page's start is told to them through the call
 * itself (an AsyncLocalStorage), and nothing is told to the notifications
 * the workers send later: those of later levels, rules that wait, repeats.
 *
 * What a page starts at:
 *   - a run started as its record was created - the incident, alert or
 *     episode a monitor or a person just opened - starts at the trigger
 *     (runAsRecordIsCreated, around the record's on-call fan-out): the
 *     moment OneUptime received the data that tripped the monitor, when it
 *     knows it - an incoming request is received at the edge and evaluated
 *     from a queue, which can fall behind (runAsMonitorTriggered, around
 *     the monitor's create) - and else the record's creation, which is when
 *     a probe's check, a telemetry monitor's evaluation or a person opened
 *     it;
 *   - any other starts when it starts paging: a run a person, a workflow or
 *     a rule that now matches started later, a page again, a direct page,
 *     and a run that waited to page (a hold its on-call rule asked for)
 *     once its wait is over.
 *
 * The notification is accepted on another server, often: the Notification
 * service sends the SMS and writes the outcome on the notification's row.
 * So when a notification due at its page's start is written, its page's
 * start is kept in Redis under the row's id (rememberPageStartOf), and when
 * the row says it was sent, it is taken back - atomically, so a second
 * "sent" records nothing - and the time recorded (takePageStartOf,
 * UserOnCallLogTimelineService).
 *
 * All of it is best effort and costs nothing where nobody reads it: without
 * an OpenTelemetry metrics exporter configured, nothing is kept.
 */

export interface OnCallPageStartMoment {
  startedAt: Date;
  start: OnCallPageStart;
}

interface MonitorTriggerStore {
  dataReceivedAt: Date;
}

const monitorTrigger: AsyncLocalStorage<MonitorTriggerStore> =
  new AsyncLocalStorage<MonitorTriggerStore>();

const recordCreation: AsyncLocalStorage<OnCallPageStartMoment> =
  new AsyncLocalStorage<OnCallPageStartMoment>();

const pageStart: AsyncLocalStorage<OnCallPageStartMoment> =
  new AsyncLocalStorage<OnCallPageStartMoment>();

export default class OnCallPageTiming {
  public static readonly CACHE_NAMESPACE: string = "on-call-page-start";

  /*
   * A notification is accepted within seconds, or a minute for a channel
   * that is tried again. Six hours is far beyond either, and still lets the
   * starts of notifications never sent - a send that failed, a server that
   * stopped - age out.
   */
  public static readonly CACHE_EXPIRES_IN_SECONDS: number = 6 * 60 * 60;

  /*
   * Runs a monitor's create of the record its data tripped, with when
   * OneUptime received that data (getMonitorDataReceivedAt): the record's
   * pages start then. With no such moment, `create` runs as it is.
   */
  public static runAsMonitorTriggered<T>(
    data: { dataReceivedAt?: Date | undefined },
    create: () => Promise<T>,
  ): Promise<T> {
    const dataReceivedAt: Date | undefined = data.dataReceivedAt;

    if (!dataReceivedAt || isNaN(new Date(dataReceivedAt).getTime())) {
      return create();
    }

    return monitorTrigger.run(
      { dataReceivedAt: new Date(dataReceivedAt) },
      create,
    );
  }

  /*
   * When OneUptime received the data a monitor evaluated, for the data a
   * received moment means the trigger of: an incoming request, received at
   * the edge. Not the heartbeat's check that no request came - its
   * received moment is the last request's, long before what it found - and
   * not a probe's check, timed by the probe's own clock; for those, and
   * every other monitor, the record's creation is the trigger.
   */
  public static getMonitorDataReceivedAt(data: unknown): Date | undefined {
    if (!data || typeof data !== "object") {
      return undefined;
    }

    const request: {
      incomingRequestReceivedAt?: unknown;
      onlyCheckForIncomingRequestReceivedAt?: unknown;
    } = data as {
      incomingRequestReceivedAt?: unknown;
      onlyCheckForIncomingRequestReceivedAt?: unknown;
    };

    if (
      !("incomingRequestReceivedAt" in request) ||
      request.onlyCheckForIncomingRequestReceivedAt === true
    ) {
      return undefined;
    }

    const value: unknown = request.incomingRequestReceivedAt;
    const receivedAt: Date | null =
      value instanceof Date
        ? value
        : typeof value === "string"
          ? new Date(value)
          : null;

    if (!receivedAt || isNaN(receivedAt.getTime())) {
      return undefined;
    }

    return receivedAt;
  }

  /*
   * Runs a record's on-call fan-out as the record is created: every run it
   * starts paging now starts at the record's trigger - the moment its
   * monitor's data was received, inside runAsMonitorTriggered, when that
   * is before the record's creation (a server whose clock is a little
   * ahead says otherwise), and else the record's creation.
   */
  public static runAsRecordIsCreated<T>(
    data: { recordCreatedAt?: Date | string | undefined },
    fanOut: () => Promise<T>,
  ): Promise<T> {
    const recordCreatedAt: Date = OnCallPageTiming.toDate(data.recordCreatedAt);
    const trigger: MonitorTriggerStore | undefined = monitorTrigger.getStore();

    const moment: OnCallPageStartMoment =
      trigger && trigger.dataReceivedAt.getTime() <= recordCreatedAt.getTime()
        ? {
            startedAt: trigger.dataReceivedAt,
            start: OnCallPageStart.MonitorDataReceived,
          }
        : {
            startedAt: recordCreatedAt,
            start: OnCallPageStart.RecordCreated,
          };

    return recordCreation.run(moment, fanOut);
  }

  /*
   * When a page that starts now starts: at its record's trigger, inside
   * runAsRecordIsCreated; otherwise now.
   */
  public static startPage(): OnCallPageStartMoment {
    const record: OnCallPageStartMoment | undefined = recordCreation.getStore();

    if (record) {
      return record;
    }

    return {
      startedAt: OneUptimeDate.getCurrentDate(),
      start: OnCallPageStart.PageStarted,
    };
  }

  /*
   * Runs the paging of a page's start - its first level, a level it moves
   * on to at once - so every notification it writes is due at `moment`.
   */
  public static runInPageStart<T>(
    moment: OnCallPageStartMoment,
    page: () => Promise<T>,
  ): Promise<T> {
    return pageStart.run(moment, page);
  }

  /*
   * The start of the page a notification written now is due at; null when
   * it is not written as its page starts.
   */
  public static getPageStart(): OnCallPageStartMoment | null {
    return pageStart.getStore() || null;
  }

  /*
   * Keeps the page start of a notification written now, for whichever
   * server writes that it was sent. Nothing for a notification not written
   * as its page starts. Never throws.
   */
  public static async rememberPageStartOf(
    notificationId: ObjectID | null | undefined,
  ): Promise<void> {
    const moment: OnCallPageStartMoment | null = this.getPageStart();

    if (!moment || !notificationId || !Telemetry.isMetricsEnabled()) {
      return;
    }

    try {
      await GlobalCache.setString(
        this.CACHE_NAMESPACE,
        notificationId.toString(),
        this.toCacheValue(moment),
        {
          expiresInSeconds: this.CACHE_EXPIRES_IN_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(
        `Could not keep the page start of on-call notification ${notificationId.toString()}: ${err}`,
      );
    }
  }

  /*
   * The page start kept for a notification, taken out so it is read once;
   * null when none was kept. Never throws.
   */
  public static async takePageStartOf(
    notificationId: ObjectID | null | undefined,
  ): Promise<OnCallPageStartMoment | null> {
    if (!notificationId || !Telemetry.isMetricsEnabled()) {
      return null;
    }

    try {
      const value: string | null = await GlobalCache.getAndDeleteString(
        this.CACHE_NAMESPACE,
        notificationId.toString(),
      );

      return this.fromCacheValue(value);
    } catch (err) {
      logger.debug(
        `Could not read the page start of on-call notification ${notificationId.toString()}: ${err}`,
      );
      return null;
    }
  }

  public static toCacheValue(moment: OnCallPageStartMoment): string {
    return JSON.stringify({
      startedAt: moment.startedAt.getTime(),
      start: moment.start,
    });
  }

  // A kept page start, read back; null for anything that is not one.
  public static fromCacheValue(
    value: string | null | undefined,
  ): OnCallPageStartMoment | null {
    if (!value) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(value);

      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      const startedAt: unknown = (parsed as { startedAt?: unknown }).startedAt;
      const start: unknown = (parsed as { start?: unknown }).start;

      if (
        typeof startedAt !== "number" ||
        !Number.isFinite(startedAt) ||
        !Object.values(OnCallPageStart).includes(start as OnCallPageStart)
      ) {
        return null;
      }

      return {
        startedAt: new Date(startedAt),
        start: start as OnCallPageStart,
      };
    } catch {
      return null;
    }
  }

  // A moment as a Date; now for one that is missing or not a moment.
  private static toDate(value: Date | string | undefined): Date {
    if (value) {
      const date: Date = OneUptimeDate.fromString(value);

      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return OneUptimeDate.getCurrentDate();
  }
}
