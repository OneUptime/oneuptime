import { AsyncLocalStorage } from "async_hooks";
import GlobalCache from "../../Infrastructure/GlobalCache";
import logger from "../Logger";
import Telemetry from "../Telemetry";
import { NotificationSchedule } from "../Telemetry/NotificationDeliveryMetrics";
import OnCallPageTiming from "./OnCallPageTiming";
import OneUptimeDate from "../../../Types/Date";
import {
  getFirstOwedRuleExecution,
  getRuleExecutionDueAfterMinutes,
} from "../../../Types/NotificationRule/NotificationRepeat";
import ObjectID from "../../../Types/ObjectID";

/*
 * HOW LATE AN ON-CALL NOTIFICATION SENT LATER WENT OUT
 * (notification.send.lag, NotificationDeliveryMetrics, issue #6646).
 *
 * notification.time_to_send times the notifications due as their page
 * starts (OnCallPageTiming). The rest the on-call configuration sends
 * later, once a wait it asked for runs out:
 *
 *   - a person's on-call rule that waits ("call me after 10 minutes"), and
 *     a push repeated until somebody acknowledges - the rules' worker
 *     (UserOnCallLog:ExecutePendingExecutions), once a minute;
 *   - a later escalation level, once the level before it waited its
 *     "Escalate after", and the policy starting again from its first level
 *     (its Repeat Policy) - the escalation worker
 *     (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions), once a
 *     minute, through OnCallEscalationAdvance.
 *
 * Their time from the trigger is mostly the wait they asked for. What the
 * platform adds is how long after the wait ran out the notification
 * reached its provider: a worker's tick, and a worker that fell behind
 * delays every one of them. So each is timed from when it was due.
 *
 * The worker that sends one knows when it was due: it runs the send inside
 * runAsScheduledSend, and every notification written in that call is told
 * (an AsyncLocalStorage, as a page's start is). When such a notification is
 * written, its due time is kept in Redis under the row's id
 * (rememberDueTimeOf); when the row says it was sent - often on another
 * server, the Notification service - it is taken back, atomically, so a
 * second "sent" records nothing, and the lag recorded (takeDueTimeOf,
 * UserOnCallLogTimelineService).
 *
 * A notification due as its page starts is timed from the page's start
 * alone: inside a page start, nothing is kept here - a level a page moves
 * on to at once is part of its start, not a wait.
 *
 * All of it is best effort and costs nothing where nobody reads it: without
 * an OpenTelemetry metrics exporter configured, nothing is kept.
 */

export interface OnCallScheduledSend {
  // When the wait it was sent after ran out.
  dueAt: Date;
  schedule: NotificationSchedule;
}

// One delivery of a person's on-call rule, as the rules' worker sends it.
export interface OnCallRuleDelivery {
  ruleId: string;
  notifyAfterMinutes: number;
  repeatEveryMinutes: unknown;
  // 0 for the rule's first push, n for repeat n (getDueRuleExecution).
  executionNumber: number;
}

const MINUTE_IN_MS: number = 60 * 1000;

// A moment kept in Redis: milliseconds since the epoch.
const DIGITS_ONLY: RegExp = /^\d+$/;

const scheduledSend: AsyncLocalStorage<OnCallScheduledSend> =
  new AsyncLocalStorage<OnCallScheduledSend>();

export default class OnCallSendLag {
  public static readonly CACHE_NAMESPACE: string = "on-call-notification-due";

  /*
   * As a page's start (OnCallPageTiming): far beyond the seconds a
   * provider takes, and still lets the due times of notifications never
   * sent age out.
   */
  public static readonly CACHE_EXPIRES_IN_SECONDS: number = 6 * 60 * 60;

  /*
   * When the rules' worker last went through an on-call log's rules
   * (rememberRulesCheckedAt): kept a while past the minute between its
   * ticks. A worker stopped for longer finds none, which is right - the
   * moments due meanwhile are what it is late on.
   */
  public static readonly RULES_CHECKED_CACHE_NAMESPACE: string =
    "on-call-log-rules-checked";
  public static readonly RULES_CHECKED_CACHE_EXPIRES_IN_SECONDS: number =
    60 * 60;

  // Whether anybody reads these: an OpenTelemetry metrics exporter is configured.
  public static isOn(): boolean {
    return Telemetry.isMetricsEnabled();
  }

  /*
   * Runs a worker's send of what came due at `dueAt` after a wait of
   * `schedule`'s kind: every notification it writes is due then. With no
   * moment (the metrics are off, or it could not be told), `send` runs as
   * it is.
   */
  public static runAsScheduledSend<T>(
    data: { dueAt?: Date | null | undefined; schedule: NotificationSchedule },
    send: () => Promise<T>,
  ): Promise<T> {
    const dueAt: Date | null = OnCallSendLag.toValidDate(data.dueAt);

    if (!dueAt) {
      return send();
    }

    return scheduledSend.run({ dueAt: dueAt, schedule: data.schedule }, send);
  }

  /*
   * The scheduled send a notification written now belongs to; null when it
   * is not written by one.
   */
  public static getScheduledSend(): OnCallScheduledSend | null {
    return scheduledSend.getStore() || null;
  }

  /*
   * Keeps the due time of a notification written now, by a worker sending
   * what a wait made due, for whichever server writes that it was sent.
   * Nothing inside a page's start - its start times it - and nothing for a
   * notification no worker scheduled. Never throws.
   */
  public static async rememberDueTimeOf(
    notificationId: ObjectID | null | undefined,
  ): Promise<void> {
    try {
      const send: OnCallScheduledSend | null = this.getScheduledSend();

      if (
        !send ||
        !notificationId ||
        OnCallPageTiming.getPageStart() ||
        !this.isOn()
      ) {
        return;
      }

      await GlobalCache.setString(
        this.CACHE_NAMESPACE,
        notificationId.toString(),
        this.toCacheValue(send),
        {
          expiresInSeconds: this.CACHE_EXPIRES_IN_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(
        `Could not keep the due time of on-call notification ${notificationId?.toString()}: ${err}`,
      );
    }
  }

  /*
   * The due time kept for a notification, taken out so it is read once;
   * null when none was kept. Never throws.
   */
  public static async takeDueTimeOf(
    notificationId: ObjectID | null | undefined,
  ): Promise<OnCallScheduledSend | null> {
    try {
      if (!notificationId || !this.isOn()) {
        return null;
      }

      const value: string | null = await GlobalCache.getAndDeleteString(
        this.CACHE_NAMESPACE,
        notificationId.toString(),
      );

      return this.fromCacheValue(value);
    } catch (err) {
      logger.debug(
        `Could not read the due time of on-call notification ${notificationId?.toString()}: ${err}`,
      );
      return null;
    }
  }

  /*
   * The moment the rules' worker went through a log's rules and sent what
   * was due, kept for its next tick (readRulesCheckedAt). Nothing when the
   * metrics are off. Never throws.
   */
  public static async rememberRulesCheckedAt(data: {
    userOnCallLogId: ObjectID | null | undefined;
    checkedAt: Date;
  }): Promise<void> {
    try {
      const checkedAt: Date | null = this.toValidDate(data.checkedAt);

      if (!data.userOnCallLogId || !checkedAt || !this.isOn()) {
        return;
      }

      await GlobalCache.setString(
        this.RULES_CHECKED_CACHE_NAMESPACE,
        data.userOnCallLogId.toString(),
        String(checkedAt.getTime()),
        {
          expiresInSeconds: this.RULES_CHECKED_CACHE_EXPIRES_IN_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(
        `Could not keep when the rules of on-call log ${data.userOnCallLogId?.toString()} were checked: ${err}`,
      );
    }
  }

  /*
   * When the rules' worker last went through a log's rules; null when it is
   * not known - the metrics are off, it never did, or that was long ago.
   * Never throws.
   */
  public static async readRulesCheckedAt(
    userOnCallLogId: ObjectID | null | undefined,
  ): Promise<Date | null> {
    try {
      if (!userOnCallLogId || !this.isOn()) {
        return null;
      }

      const value: string | null = await GlobalCache.getString(
        this.RULES_CHECKED_CACHE_NAMESPACE,
        userOnCallLogId.toString(),
      );

      if (!value || !DIGITS_ONLY.test(value)) {
        return null;
      }

      return this.toValidDate(new Date(Number(value)));
    } catch (err) {
      logger.debug(
        `Could not read when the rules of on-call log ${userOnCallLogId?.toString()} were checked: ${err}`,
      );
      return null;
    }
  }

  /*
   * When a delivery of a person's on-call rule was due, for its lag: the
   * moment its schedule says (`scheduledAt`, NotificationRepeat's minutes
   * after the log started) - but never before the worker last went through
   * the log's rules and did not send it. A delivery the worker found not
   * due then, and due now, came due in between: the rule was added or
   * changed, or the record's severity changed so other rules apply - which
   * the schedule cannot tell, and which is no lateness of the platform.
   * Never later than `now`.
   */
  public static getRuleDeliveryDueAt(data: {
    scheduledAt: Date;
    rulesCheckedAt?: Date | null | undefined;
    now: Date;
  }): Date {
    const now: number = data.now.getTime();
    const checkedAt: number | null =
      this.toValidDate(data.rulesCheckedAt)?.getTime() ?? null;
    let dueAt: number = data.scheduledAt.getTime();

    if (!Number.isFinite(dueAt)) {
      dueAt = now;
    }

    if (checkedAt !== null && checkedAt > dueAt && checkedAt <= now) {
      dueAt = checkedAt;
    }

    return new Date(Math.min(dueAt, now));
  }

  public static toCacheValue(send: OnCallScheduledSend): string {
    return JSON.stringify({
      dueAt: send.dueAt.getTime(),
      schedule: send.schedule,
    });
  }

  // A kept due time, read back; null for anything that is not one.
  public static fromCacheValue(
    value: string | null | undefined,
  ): OnCallScheduledSend | null {
    if (!value) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(value);

      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      const dueAt: unknown = (parsed as { dueAt?: unknown }).dueAt;
      const schedule: unknown = (parsed as { schedule?: unknown }).schedule;

      if (
        typeof dueAt !== "number" ||
        !Number.isFinite(dueAt) ||
        !Object.values(NotificationSchedule).includes(
          schedule as NotificationSchedule,
        )
      ) {
        return null;
      }

      return {
        dueAt: new Date(dueAt),
        schedule: schedule as NotificationSchedule,
      };
    } catch {
      return null;
    }
  }

  // A moment as a Date of its own; null for one that is missing or not a moment.
  public static toValidDate(value: unknown): Date | null {
    try {
      const date: Date | null =
        value instanceof Date
          ? value
          : typeof value === "string" && value
            ? OneUptimeDate.fromString(value)
            : null;

      if (!date || isNaN(date.getTime())) {
        return null;
      }

      return new Date(date.getTime());
    } catch {
      return null;
    }
  }
}

/*
 * ONE TICK OF THE RULES' WORKER THROUGH ONE PERSON'S ON-CALL LOG
 * (UserOnCallLog:ExecutePendingExecutions): each delivery of a rule it
 * sends - a first push, a repeat - is sent as a scheduled send (runSend),
 * due when the rule's schedule says (NotificationRepeat, as the worker
 * decides it), and once it went through the log's rules the tick is kept
 * for the next (finish). Nothing is read or kept while the metrics are off.
 */
export class OnCallRulesTick {
  private rulesCheckedAt: Promise<Date | null> | null = null;

  public constructor(
    private readonly log: {
      userOnCallLogId: ObjectID | null | undefined;
      // When the log started: its rules' schedules count from it.
      logCreatedAt: Date | string | null | undefined;
      // Every delivery already claimed on the log (executedNotificationRules).
      executedClaimKeys: ReadonlyArray<string>;
      // The moment the worker read as now, deciding what is due.
      checkedAt: Date;
    },
  ) {}

  /*
   * Sends one delivery of a rule - its first push (0), repeat n - inside
   * the scheduled send it is.
   */
  public async runSend<T>(
    delivery: OnCallRuleDelivery,
    send: () => Promise<T>,
  ): Promise<T> {
    const scheduled: OnCallScheduledSend | null =
      await this.getScheduledSend(delivery);

    if (!scheduled) {
      return await send();
    }

    return await OnCallSendLag.runAsScheduledSend(scheduled, send);
  }

  /*
   * When a delivery was due, and after which wait: a first push after its
   * rule's wait, a repeat after its interval - since the first repeat the
   * person went without, for one a worker that fell behind sends in place
   * of those it skipped (getFirstOwedRuleExecution). Null while the metrics
   * are off, or for a log with no start. Never throws.
   */
  public async getScheduledSend(
    delivery: OnCallRuleDelivery,
  ): Promise<OnCallScheduledSend | null> {
    try {
      const logCreatedAt: Date | null = OnCallSendLag.toValidDate(
        this.log.logCreatedAt,
      );

      if (!logCreatedAt || !OnCallSendLag.isOn()) {
        return null;
      }

      if (!this.rulesCheckedAt) {
        this.rulesCheckedAt = OnCallSendLag.readRulesCheckedAt(
          this.log.userOnCallLogId,
        );
      }

      const owedExecution: number = getFirstOwedRuleExecution({
        executedClaimKeys: this.log.executedClaimKeys,
        ruleId: delivery.ruleId,
        executionNumber: delivery.executionNumber,
      });

      const owedAfterMinutes: number = getRuleExecutionDueAfterMinutes({
        notifyAfterMinutes: delivery.notifyAfterMinutes,
        repeatEveryMinutes: delivery.repeatEveryMinutes,
        executionNumber: owedExecution,
      });

      return {
        dueAt: OnCallSendLag.getRuleDeliveryDueAt({
          scheduledAt: new Date(
            logCreatedAt.getTime() + owedAfterMinutes * MINUTE_IN_MS,
          ),
          rulesCheckedAt: await this.rulesCheckedAt,
          now: this.log.checkedAt,
        }),
        schedule:
          delivery.executionNumber > 0
            ? NotificationSchedule.Repeat
            : NotificationSchedule.RuleWait,
      };
    } catch (err) {
      logger.debug(
        `Could not tell when a delivery of on-call log ${this.log.userOnCallLogId?.toString()} was due: ${err}`,
      );
      return null;
    }
  }

  // The worker went through the log's rules: kept for its next tick. Never throws.
  public async finish(): Promise<void> {
    await OnCallSendLag.rememberRulesCheckedAt({
      userOnCallLogId: this.log.userOnCallLogId,
      checkedAt: this.log.checkedAt,
    });
  }
}
