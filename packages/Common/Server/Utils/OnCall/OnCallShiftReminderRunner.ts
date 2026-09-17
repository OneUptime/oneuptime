import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import UserNotificationSettingService from "../../Services/UserNotificationSettingService";
import UserOnCallShiftReminderService from "../../Services/UserOnCallShiftReminderService";
import UserService from "../../Services/UserService";
import UserOnCallShiftReminderLogService, {
  Service as UserOnCallShiftReminderLogServiceClass,
} from "../../Services/UserOnCallShiftReminderLogService";
import DatabaseConfig from "../../DatabaseConfig";
import GlobalCache from "../../Infrastructure/GlobalCache";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import QueryHelper from "../../Types/Database/QueryHelper";
import PostgresErrorTranslator from "../Database/PostgresErrorTranslator";
import logger from "../Logger";
import PushNotificationUtil from "../PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "../WhatsAppTemplateUtil";
import Telemetry, { TelemetryCounter } from "../Telemetry";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OnCallShiftMaterializer, {
  MaterializeResult,
  MaterializedScheduleInfo,
  MaterializedUserInfo,
} from "./OnCallShiftMaterializer";
import { OnCallShiftChangeEvent } from "./OnCallShiftChangeListeners";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../Models/DatabaseModels/User";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import UserOnCallShiftReminder from "../../../Models/DatabaseModels/UserOnCallShiftReminder";
import UserOnCallShiftReminderLog, {
  UserOnCallShiftReminderLogKind,
} from "../../../Models/DatabaseModels/UserOnCallShiftReminderLog";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import {
  MaterializedShift,
  MaterializedShiftPolicy,
} from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import OnCallCalendarFeedUtil from "../../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import Timezone from "../../../Types/Timezone";
import { WhatsAppTemplateIds } from "../../../Types/WhatsApp/WhatsAppTemplates";
import URL from "../../../Types/API/URL";
import { WhatsAppMessagePayload } from "../../../Types/WhatsApp/WhatsAppMessage";

/*
 * Shift reminders ("your on-call shift on Payments starts in 1 hour") and the
 * change notices that keep them honest when a shift changes hands inside a
 * reminder window.
 *
 * Two entry points, one ledger:
 *
 *   - runSweep: the five-minute cron body. Reads the lead times every user
 *     configured (UserOnCallShiftReminder), materializes the next
 *     [now, now + longest lead + 30 min] of every schedule those users can
 *     hold a shift on, and sends one reminder per (user, schedule, shift
 *     start, lead) whose "start minus lead" instant fell inside this tick's
 *     window. The window is a WATERMARK, not a run-time slice: it runs from
 *     the previous completed tick (capped at 30 minutes back) to now, so a
 *     skipped or late tick is caught up by the next one, while a long outage
 *     never floods (and never reminds anyone about a shift that already
 *     started — the lateness cap).
 *
 *   - runChangePass: called from the on-call configuration hooks through
 *     OnCallShiftChangeListeners. Re-materializes the affected schedules and
 *     (a) sends ONE catch-up to a user who now holds a shift that starts
 *     inside one of their leads but was never reminded about it (a late
 *     override, a rotation edit), and (b) sends ONE "reassigned" notice to a
 *     user who was reminded about a shift they no longer hold.
 *
 * The ledger is UserOnCallShiftReminderLog with a UNIQUE index over
 * (user, schedule, shiftStartsAt, minutesBeforeShift, kind). Every send is
 * claim -> send -> stamp: the row is inserted with sentAt NULL first (a
 * unique violation means another replica already has it), the notification
 * goes out, then sentAt is stamped. A thrown send deletes the claim so the
 * next tick retries while the shift is still ahead; a claim that is older
 * than RECLAIM_AFTER_MINUTES with sentAt still NULL belonged to a worker
 * that died mid-send and is re-claimed with a conditional update. Postgres,
 * not Redis: the compose Redis is non-persistent, and a flush must never
 * re-page anyone.
 *
 * shiftStartsAt is the seam-normalised, minute-aligned MaterializedShift
 * start, so a shift whose engine start moves by a second (a layer edit that
 * re-cuts the seams) still maps onto the same ledger row.
 */

// Enqueued/scheduled by App/FeatureSet/Workers/Jobs/OnCallDutySchedule/*.
export const SHIFT_REMINDER_JOB_NAME: string =
  "OnCallDutySchedule:SendShiftReminders";
export const SHIFT_REMINDER_LOG_RETENTION_JOB_NAME: string =
  "OnCallDutySchedule:DeleteOldShiftReminderLogs";

// Listener name under which the change pass registers (idempotent).
export const SHIFT_REMINDER_LISTENER_NAME: string = "shift-reminders";

// Watermark of the last COMPLETED sweep, in GlobalCache (Redis).
export const SHIFT_REMINDER_WATERMARK_NAMESPACE: string =
  "OnCallShiftReminders";
export const SHIFT_REMINDER_WATERMARK_KEY: string = "watermark";
export const SHIFT_REMINDER_WATERMARK_TTL_SECONDS: number =
  OneUptimeDate.getSecondsInDays(1);

/*
 * How far back a sweep may reach when the watermark is missing (Redis
 * restart) or older than this. A longer outage deliberately loses the
 * reminders whose lead instant fell inside it: re-sending an hour of
 * "starts in 15 minutes" messages after the fact helps nobody.
 */
export const SHIFT_REMINDER_MAX_LOOKBACK_MINUTES: number = 30;

// A claim with sentAt NULL older than this is assumed orphaned and retried.
export const SHIFT_REMINDER_RECLAIM_AFTER_MINUTES: number = 10;

// Materialization window = [now, now + longest lead + this].
export const SHIFT_REMINDER_WINDOW_PADDING_MINUTES: number = 30;

/*
 * When the sweep is at most one tick behind the lead instant the message says
 * the lead ("starts in 1 hour"); further behind, it says the true remaining
 * time so a late tick never claims an hour that is already half gone.
 */
export const SHIFT_REMINDER_LEAD_TEXT_TOLERANCE_MINUTES: number = 5;

// Retention of ledger rows, measured from the shift's start.
export const SHIFT_REMINDER_LOG_RETENTION_DAYS: number = 30;
export const SHIFT_REMINDER_LOG_DELETE_BATCH_SIZE: number = 100;

// Sweep lock. The lock must outlive the job timeout (runJobWithTimeout races).
export const SHIFT_REMINDER_SWEEP_LOCK_NAMESPACE: string = "Workers.Cron";
export const SHIFT_REMINDER_JOB_TIMEOUT_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(10);
export const SHIFT_REMINDER_SWEEP_LOCK_TIMEOUT_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(12);

const MILLISECONDS_PER_MINUTE: number = 60 * 1000;

const METRIC_NAME: string = "oncall_shift_reminders";
const METRIC_OUTCOME_ATTRIBUTE: string =
  "oneuptime.oncall_shift_reminder.outcome";

export enum ShiftReminderOutcome {
  Sent = "sent",
  SkippedLate = "skipped_late",
  SkippedAlreadySent = "skipped_already_sent",
  SkippedInFlight = "skipped_in_flight",
  SkippedNoPolicy = "skipped_no_policy",
  ClaimCollision = "claim_collision",
  ClaimRetry = "claim_retry",
  SendFailed = "send_failed",
  MissingSettings = "missing_settings",
  CatchUpSent = "catch_up_sent",
  ReassignedSent = "reassigned_sent",
}

export interface ShiftReminderSweepStats {
  now: Date;
  lookbackFrom: Date;
  watermarkFound: boolean;
  /*
   * The instant the watermark was stamped with: `now` for a clean pass,
   * `lookbackFrom` when a project failed, so the next tick re-covers this
   * window instead of stepping over it.
   */
  watermarkWrittenAt: Date;
  projects: number;
  usersWithReminders: number;
  shiftsConsidered: number;
  sent: number;
  skippedLate: number;
  skippedAlreadySent: number;
  skippedInFlight: number;
  skippedNoPolicy: number;
  claimCollisions: number;
  claimRetries: number;
  sendFailures: number;
  missingSettings: number;
  truncatedSchedules: number;
  errors: number;
}

export interface ShiftReminderChangePassStats {
  now: Date;
  projectId: string | null;
  users: number;
  catchUpsSent: number;
  reassignedSent: number;
  claimCollisions: number;
  sendFailures: number;
  missingSettings: number;
  errors: number;
  // Why the pass ended early, when it did.
  skippedReason: string | null;
}

export interface ShiftReminderRetentionStats {
  deleted: number;
  cutoff: Date;
}

// Where a recipient's wall clock is rendered: their zone, else the schedule's, else UTC.
export interface ShiftReminderMessage {
  subject: string;
  text: string;
  pushTitle: string;
  pushBody: string;
  vars: Dictionary<string>;
  templateType: EmailTemplateType;
  eventType: NotificationSettingEventType;
  timezone: string;
  whenText: string;
}

interface UserReminderPlan {
  userId: ObjectID;
  projectId: ObjectID;
  // Distinct, descending.
  leads: Array<number>;
  maxLead: number;
}

interface ProjectReminderPlan {
  projectId: ObjectID;
  users: Map<string, UserReminderPlan>;
  maxLead: number;
}

interface LedgerRow {
  id: ObjectID;
  userId: string;
  scheduleId: string;
  shiftStartsAt: Date;
  minutesBeforeShift: number;
  kind: UserOnCallShiftReminderLogKind;
  claimedAt: Date;
  sentAt: Date | null;
}

interface Ledger {
  byKey: Map<string, LedgerRow>;
  rows: Array<LedgerRow>;
  /*
   * Every ledger row this pass has seen: the snapshot it loaded plus every
   * row it claimed itself. A row for the same shift that is NOT in here was
   * written by another pass while this one was running (see
   * yieldToConcurrentSibling).
   */
  knownIds: Set<string>;
}

interface ClaimResult {
  claimId: ObjectID | null;
  outcome: "claimed" | "reclaimed" | "already-sent" | "in-flight" | "collision";
}

interface SendContext {
  now: Date;
  projectId: ObjectID;
  dashboardUrl: string;
  users: Map<string, MaterializedUserInfo>;
}

export default class OnCallShiftReminderRunner {
  private static counter: TelemetryCounter | null = null;

  // (userId|projectId|YYYY-MM-DD) already warned about a missing settings row.
  private static missingSettingsWarned: Set<string> = new Set<string>();

  // -- Cron entry points ------------------------------------------------

  /**
   * The five-minute cron body: one sweep under a cross-replica lock. A held
   * lock (or an unreachable Redis) skips the tick — the holder is already
   * covering the same window, and the watermark makes the next tick catch
   * up anything this one would have done.
   */
  @CaptureSpan()
  public static async runSweepUnderLock(options?: {
    now?: Date | undefined;
  }): Promise<ShiftReminderSweepStats | null> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: SHIFT_REMINDER_JOB_NAME,
        namespace: SHIFT_REMINDER_SWEEP_LOCK_NAMESPACE,
        lockTimeout: SHIFT_REMINDER_SWEEP_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    } catch (err) {
      logger.debug(
        `${SHIFT_REMINDER_JOB_NAME}: could not acquire the sweep lock; a sweep is already in flight (or Redis is unavailable). Skipping this run: ${err}`,
      );
      return null;
    }

    try {
      return await OnCallShiftReminderRunner.runSweep(options);
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(
          `${SHIFT_REMINDER_JOB_NAME}: error releasing the sweep lock: ${err}`,
        );
      }
    }
  }

  /**
   * One sweep: every due (user, shift, lead) inside
   * (lookbackFrom + lead, now + lead], claimed and sent once. Never throws
   * for one user's or one project's bad data; throws only when the reminder
   * table itself cannot be read, in which case the watermark is NOT advanced
   * and the next tick covers the same window.
   *
   * A project or user that threw (a DB timeout inside the materializer, a
   * transient Redis error) is isolated the same way, but its window would
   * otherwise be lost for good: the next tick starts where this one ended
   * and `isDue` never looks back at a lead instant again. So whenever
   * anything failed the watermark is stamped with `lookbackFrom` instead of
   * `now` and the next tick re-covers the identical window. The re-run is a
   * no-op for everything that did send — the UNIQUE ledger turns it into
   * "already sent" — and the 30-minute lookback cap bounds a project that
   * keeps failing.
   */
  @CaptureSpan()
  public static async runSweep(options?: {
    now?: Date | undefined;
  }): Promise<ShiftReminderSweepStats> {
    const now: Date = options?.now || OneUptimeDate.getCurrentDate();
    const watermark: Date | null =
      await OnCallShiftReminderRunner.readWatermark();
    const lookbackFrom: Date = OnCallShiftReminderRunner.computeLookbackFrom(
      now,
      watermark,
    );

    const stats: ShiftReminderSweepStats = {
      now,
      lookbackFrom,
      watermarkFound: watermark !== null,
      watermarkWrittenAt: now,
      projects: 0,
      usersWithReminders: 0,
      shiftsConsidered: 0,
      sent: 0,
      skippedLate: 0,
      skippedAlreadySent: 0,
      skippedInFlight: 0,
      skippedNoPolicy: 0,
      claimCollisions: 0,
      claimRetries: 0,
      sendFailures: 0,
      missingSettings: 0,
      truncatedSchedules: 0,
      errors: 0,
    };

    const reminders: Array<UserOnCallShiftReminder> =
      await UserOnCallShiftReminderService.findAllBy({
        query: {},
        select: {
          _id: true,
          projectId: true,
          userId: true,
          minutesBeforeShift: true,
        },
        props: {
          isRoot: true,
        },
      });

    const plans: Map<string, ProjectReminderPlan> =
      OnCallShiftReminderRunner.buildProjectPlans(reminders);

    stats.projects = plans.size;

    for (const plan of plans.values()) {
      stats.usersWithReminders += plan.users.size;
    }

    if (plans.size === 0) {
      await OnCallShiftReminderRunner.writeWatermark(now);
      return stats;
    }

    const dashboardUrl: string =
      await OnCallShiftReminderRunner.getDashboardUrl();

    for (const plan of plans.values()) {
      try {
        await OnCallShiftReminderRunner.sweepProject({
          plan,
          now,
          lookbackFrom,
          dashboardUrl,
          stats,
        });
      } catch (err) {
        stats.errors++;
        logger.error(
          `${SHIFT_REMINDER_JOB_NAME}: failed to process project ${plan.projectId.toString()}`,
        );
        logger.error(err);
      }
    }

    /*
     * Hold the window open when anything failed. Re-covering it costs
     * nothing: every reminder that DID go out has a stamped ledger row and
     * comes back as "already sent", and an isolated failure always happens
     * before its send (a failed stamp is caught inside deliver, precisely so
     * that "sent" and "swept" cannot disagree here).
     */
    stats.watermarkWrittenAt = stats.errors > 0 ? lookbackFrom : now;

    if (stats.errors > 0) {
      logger.warn(
        `${SHIFT_REMINDER_JOB_NAME}: ${stats.errors} failure(s) this tick; holding the watermark at ${lookbackFrom.toISOString()} so the next tick re-covers this window.`,
      );
    }

    await OnCallShiftReminderRunner.writeWatermark(stats.watermarkWrittenAt);

    logger.debug(
      `${SHIFT_REMINDER_JOB_NAME}: sweep complete — ${stats.sent} sent, ${stats.skippedLate} skipped (late), ${stats.claimRetries} claim retries, ${stats.claimCollisions} claim collisions, ${stats.sendFailures} send failures, ${stats.errors} errors.`,
    );

    return stats;
  }

  /**
   * Ledger retention: rows for shifts that started more than
   * SHIFT_REMINDER_LOG_RETENTION_DAYS ago are deleted in batches. Keyed on
   * the SHIFT start (not the claim time) so a row can never disappear while
   * the shift it de-duplicates is still ahead.
   */
  @CaptureSpan()
  public static async deleteOldLogs(options?: {
    now?: Date | undefined;
    retentionDays?: number | undefined;
    batchSize?: number | undefined;
  }): Promise<ShiftReminderRetentionStats> {
    const now: Date = options?.now || OneUptimeDate.getCurrentDate();
    const retentionDays: number =
      options?.retentionDays ?? SHIFT_REMINDER_LOG_RETENTION_DAYS;
    const batchSize: number =
      options?.batchSize ?? SHIFT_REMINDER_LOG_DELETE_BATCH_SIZE;
    const cutoff: Date = OneUptimeDate.addRemoveDays(now, retentionDays * -1);

    let deleted: number = 0;

    while (true) {
      const count: number = await UserOnCallShiftReminderLogService.deleteBy({
        query: {
          shiftStartsAt: QueryHelper.lessThanEqualTo(cutoff),
        },
        limit: batchSize,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      deleted += count;

      if (count === 0) {
        break;
      }
    }

    return { deleted, cutoff };
  }

  // -- Change pass (hook-triggered) ---------------------------------------

  /**
   * Catch-up + reassigned notices for one shift-change event. Fire-and-forget
   * from the hooks (through OnCallShiftChangeListeners); never throws.
   */
  @CaptureSpan()
  public static async runChangePass(
    event: OnCallShiftChangeEvent,
    options?: { now?: Date | undefined },
  ): Promise<ShiftReminderChangePassStats> {
    const now: Date = options?.now || OneUptimeDate.getCurrentDate();

    const stats: ShiftReminderChangePassStats = {
      now,
      projectId: null,
      users: 0,
      catchUpsSent: 0,
      reassignedSent: 0,
      claimCollisions: 0,
      sendFailures: 0,
      missingSettings: 0,
      errors: 0,
      skippedReason: null,
    };

    try {
      const projectId: ObjectID | null =
        event.projectId ||
        (await OnCallShiftReminderRunner.resolveProjectIdFromSchedules(
          event.scheduleIds,
        ));

      if (!projectId) {
        stats.skippedReason = "no-project";
        return stats;
      }

      stats.projectId = projectId.toString();

      const eventScheduleIds: Array<ObjectID> =
        OnCallShiftReminderRunner.dedupeIds(event.scheduleIds);

      /*
       * Users to look at: everyone the hook named, plus everyone holding a
       * ledger row for a future shift on an affected schedule (they may need
       * a "reassigned" notice even if the hook did not name them).
       */
      const scheduleRows: Array<LedgerRow> =
        eventScheduleIds.length > 0
          ? await OnCallShiftReminderRunner.loadLedgerRows({
              projectId,
              scheduleIds: eventScheduleIds,
              from: now,
            })
          : [];

      const userIds: Array<ObjectID> = OnCallShiftReminderRunner.dedupeIds([
        ...event.userIds,
        ...scheduleRows.map((row: LedgerRow) => {
          return new ObjectID(row.userId);
        }),
      ]);

      if (userIds.length === 0) {
        stats.skippedReason = "no-users";
        return stats;
      }

      const reminders: Array<UserOnCallShiftReminder> =
        await UserOnCallShiftReminderService.findBy({
          query: {
            projectId: projectId,
            userId: QueryHelper.any(userIds),
          },
          select: {
            _id: true,
            projectId: true,
            userId: true,
            minutesBeforeShift: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      const plans: Map<string, ProjectReminderPlan> =
        OnCallShiftReminderRunner.buildProjectPlans(reminders);
      const plan: ProjectReminderPlan | undefined = plans.get(
        projectId.toString(),
      );

      // Every ledger row of those users for shifts still ahead.
      const ledger: Ledger = OnCallShiftReminderRunner.buildLedger(
        await OnCallShiftReminderRunner.loadLedgerRows({
          projectId,
          userIds,
          from: now,
        }),
      );

      const futureRowsExist: boolean = ledger.rows.length > 0;

      if (!plan && !futureRowsExist) {
        stats.skippedReason = "nothing-to-do";
        return stats;
      }

      /*
       * The window has to reach the farthest lead (for catch-ups) AND the
       * farthest shift anyone was already reminded about (to judge whether
       * they still hold it).
       */
      let windowMinutes: number = plan ? plan.maxLead : 0;

      for (const row of ledger.rows) {
        const minutesAhead: number = Math.ceil(
          (row.shiftStartsAt.getTime() - now.getTime()) /
            MILLISECONDS_PER_MINUTE,
        );
        windowMinutes = Math.max(windowMinutes, minutesAhead);
      }

      const windowEnd: Date = OneUptimeDate.addRemoveMinutes(
        now,
        windowMinutes + SHIFT_REMINDER_WINDOW_PADDING_MINUTES,
      );

      /*
       * Schedules to materialize: the ones the hook named, the ones the
       * reminded users can hold shifts on, and the ones their ledger rows
       * point at.
       */
      const scheduleIds: Array<ObjectID> = [...eventScheduleIds];

      for (const row of ledger.rows) {
        scheduleIds.push(new ObjectID(row.scheduleId));
      }

      if (plan) {
        // One batched lookup for every reminded user of this project.
        const candidatesByUser: Map<
          string,
          Array<ObjectID>
        > = await OnCallShiftMaterializer.getCandidateScheduleIdsForUsers({
          userIds: Array.from(plan.users.values()).map(
            (userPlan: UserReminderPlan) => {
              return userPlan.userId;
            },
          ),
          projectIds: [projectId],
          windowStart: now,
          windowEnd,
          includeCoveringShifts: true,
        });

        for (const candidates of candidatesByUser.values()) {
          scheduleIds.push(...candidates);
        }
      }

      const distinctScheduleIds: Array<ObjectID> =
        OnCallShiftReminderRunner.dedupeIds(scheduleIds);

      if (distinctScheduleIds.length === 0) {
        stats.skippedReason = "no-schedules";
        return stats;
      }

      const result: MaterializeResult =
        await OnCallShiftMaterializer.materializeForSchedules({
          scheduleIds: distinctScheduleIds,
          windowStart: now,
          windowEnd,
          now,
        });

      const resolvedSchedules: Map<string, MaterializedScheduleInfo> = new Map<
        string,
        MaterializedScheduleInfo
      >();

      for (const schedule of result.schedules) {
        resolvedSchedules.set(schedule.scheduleId, schedule);
      }

      const context: SendContext = {
        now,
        projectId,
        dashboardUrl: await OnCallShiftReminderRunner.getDashboardUrl(),
        users: OnCallShiftReminderRunner.toUserMap(result.users),
      };

      await OnCallShiftReminderRunner.backfillRecipients({
        userIds,
        ledger,
        context,
      });

      stats.users = userIds.length;

      for (const userId of userIds) {
        try {
          const userKey: string = userId.toString();
          const userPlan: UserReminderPlan | undefined =
            plan?.users.get(userKey);
          const heldShifts: Array<MaterializedShift> =
            OnCallShiftMaterializer.filterShiftsForUser(
              result.shifts,
              userId,
            ).filter((shift: MaterializedShift) => {
              return shift.start.getTime() > now.getTime();
            });

          if (userPlan) {
            await OnCallShiftReminderRunner.sendCatchUps({
              userPlan,
              heldShifts,
              ledger,
              context,
              stats,
            });
          }

          await OnCallShiftReminderRunner.sendReassignedNotices({
            userId,
            heldShifts,
            allShifts: result.shifts,
            ledger,
            resolvedSchedules,
            context,
            stats,
          });
        } catch (err) {
          stats.errors++;
          logger.error(
            `${SHIFT_REMINDER_LISTENER_NAME}: change pass failed for user ${userId.toString()} in project ${projectId.toString()}`,
          );
          logger.error(err);
        }
      }
    } catch (err) {
      stats.errors++;
      logger.error(
        `${SHIFT_REMINDER_LISTENER_NAME}: change pass failed (reason ${event.reason})`,
      );
      logger.error(err);
    }

    return stats;
  }

  // -- Watermark ----------------------------------------------------------

  public static async readWatermark(): Promise<Date | null> {
    try {
      const value: string | null = await GlobalCache.getString(
        SHIFT_REMINDER_WATERMARK_NAMESPACE,
        SHIFT_REMINDER_WATERMARK_KEY,
      );

      if (!value) {
        return null;
      }

      const parsed: Date = new Date(value);

      if (Number.isNaN(parsed.getTime())) {
        return null;
      }

      return parsed;
    } catch (err) {
      logger.warn(
        `${SHIFT_REMINDER_JOB_NAME}: could not read the watermark; falling back to a ${SHIFT_REMINDER_MAX_LOOKBACK_MINUTES}-minute lookback: ${err}`,
      );
      return null;
    }
  }

  public static async writeWatermark(now: Date): Promise<void> {
    try {
      await GlobalCache.setString(
        SHIFT_REMINDER_WATERMARK_NAMESPACE,
        SHIFT_REMINDER_WATERMARK_KEY,
        now.toISOString(),
        { expiresInSeconds: SHIFT_REMINDER_WATERMARK_TTL_SECONDS },
      );
    } catch (err) {
      logger.warn(
        `${SHIFT_REMINDER_JOB_NAME}: could not write the watermark; the next tick falls back to a ${SHIFT_REMINDER_MAX_LOOKBACK_MINUTES}-minute lookback: ${err}`,
      );
    }
  }

  /**
   * Lower bound of this tick's window: the previous completed tick, but
   * never more than SHIFT_REMINDER_MAX_LOOKBACK_MINUTES ago and never in the
   * future (clock skew between replicas).
   */
  public static computeLookbackFrom(now: Date, watermark: Date | null): Date {
    const floor: Date = OneUptimeDate.addRemoveMinutes(
      now,
      SHIFT_REMINDER_MAX_LOOKBACK_MINUTES * -1,
    );

    if (!watermark) {
      return floor;
    }

    const clamped: number = Math.min(watermark.getTime(), now.getTime());

    return new Date(Math.max(floor.getTime(), clamped));
  }

  // -- Pure helpers (exported for tests) -----------------------------------

  /**
   * True when a shift with this start is due for this lead inside the
   * window (lookbackFrom + lead, now + lead].
   */
  public static isDue(data: {
    start: Date;
    lead: number;
    now: Date;
    lookbackFrom: Date;
  }): boolean {
    const leadMs: number = data.lead * MILLISECONDS_PER_MINUTE;
    const startMs: number = data.start.getTime();

    return (
      startMs > data.lookbackFrom.getTime() + leadMs &&
      startMs <= data.now.getTime() + leadMs
    );
  }

  /** "1 hour", "1 hour 30 minutes", "2 weeks", "15 minutes". */
  public static describeMinutes(minutes: number): string {
    const whole: number = Math.round(minutes);

    if (whole <= 0) {
      return "less than a minute";
    }

    const units: Array<[string, number]> = [
      ["week", 7 * 24 * 60],
      ["day", 24 * 60],
      ["hour", 60],
      ["minute", 1],
    ];

    const parts: Array<string> = [];
    let remaining: number = whole;

    for (const [name, size] of units) {
      const count: number = Math.floor(remaining / size);

      if (count > 0) {
        parts.push(`${count} ${name}${count === 1 ? "" : "s"}`);
        remaining -= count * size;
      }
    }

    return parts.slice(0, 2).join(" ");
  }

  /**
   * The "starts in …" text of a regular reminder: the configured lead when
   * the sweep is at most one tick behind it, the real remaining time
   * otherwise.
   */
  public static describeRemaining(data: {
    lead: number;
    start: Date;
    now: Date;
  }): string {
    const remainingMinutes: number =
      (data.start.getTime() - data.now.getTime()) / MILLISECONDS_PER_MINUTE;

    if (
      remainingMinutes <= data.lead &&
      data.lead - remainingMinutes <= SHIFT_REMINDER_LEAD_TEXT_TOLERANCE_MINUTES
    ) {
      return OnCallShiftReminderRunner.describeMinutes(data.lead);
    }

    return OnCallShiftReminderRunner.describeMinutes(remainingMinutes);
  }

  /** The zone a recipient's wall clock is rendered in. */
  public static resolveTimezone(data: {
    userTimezone?: string | undefined;
    scheduleTimezone?: string | undefined;
  }): string {
    if (OnCallCalendarFeedUtil.isValidTimezone(data.userTimezone)) {
      return data.userTimezone as string;
    }

    if (OnCallCalendarFeedUtil.isValidTimezone(data.scheduleTimezone)) {
      return data.scheduleTimezone as string;
    }

    return Timezone.UTC;
  }

  /** "Thu 3 Sep 18:00 Europe/Berlin" */
  public static formatInstant(date: Date, timezone: string): string {
    return `${OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
      date,
      format: "ddd D MMM HH:mm",
      timezone,
    })} ${timezone}`;
  }

  /** Distinct policy names, alphabetical, joined with ", ". */
  public static describePolicyNames(
    policies: Array<MaterializedShiftPolicy>,
  ): string {
    return OnCallCalendarFeedUtil.getDistinctPolicies(policies)
      .map((policy: MaterializedShiftPolicy) => {
        return policy.policyName;
      })
      .join(", ");
  }

  /** The ledger key = the UNIQUE index of UserOnCallShiftReminderLog. */
  public static ledgerKey(data: {
    userId: string | ObjectID;
    scheduleId: string | ObjectID;
    shiftStartsAt: Date;
    minutesBeforeShift: number;
    kind: UserOnCallShiftReminderLogKind;
  }): string {
    const start: number =
      UserOnCallShiftReminderLogServiceClass.truncateToMinute(
        data.shiftStartsAt,
      ).getTime();

    return `${data.userId.toString()}|${data.scheduleId.toString()}|${start}|${data.minutesBeforeShift}|${data.kind}`;
  }

  /** Builds the regular reminder message for one shift and lead. */
  public static buildReminderMessage(data: {
    shift: MaterializedShift;
    lead: number;
    now: Date;
    timezone: string;
    dashboardUrl: string;
  }): ShiftReminderMessage {
    const { shift } = data;
    const whenText: string = OnCallShiftReminderRunner.formatInstant(
      shift.start,
      data.timezone,
    );
    const endsText: string = OnCallShiftReminderRunner.formatInstant(
      shift.end,
      data.timezone,
    );
    const remainingText: string = OnCallShiftReminderRunner.describeRemaining({
      lead: data.lead,
      start: shift.start,
      now: data.now,
    });
    const policyNames: string = OnCallShiftReminderRunner.describePolicyNames(
      shift.policies,
    );
    const coveringFor: string | null =
      shift.override && shift.override.originalUserId !== shift.userId
        ? shift.override.originalUserName
        : null;

    const coveringClause: string = coveringFor
      ? ` (you are covering for ${coveringFor})`
      : "";

    const sentence: string = `Your on-call shift on ${shift.scheduleName} for ${policyNames} starts in ${remainingText} (${whenText})${coveringClause}.`;

    const scheduleViewLink: string = OnCallCalendarFeedUtil.getScheduleUrl(
      data.dashboardUrl,
      shift.projectId,
      shift.scheduleId,
    );

    const vars: Dictionary<string> = {
      scheduleName: shift.scheduleName,
      policyNames,
      leadText: OnCallShiftReminderRunner.describeMinutes(data.lead),
      remainingText,
      startsAt: whenText,
      endsAt: endsText,
      timezone: data.timezone,
      description: sentence,
      coveringFor: coveringFor || "",
      scheduleViewLink,
    };

    return {
      subject: `Reminder: your on-call shift on ${shift.scheduleName} starts in ${remainingText}`,
      text: `This is a message from OneUptime. ${sentence} To change these reminders go to User Settings in the OneUptime Dashboard.`,
      pushTitle: "On-call shift reminder",
      pushBody: `Your on-call shift on ${shift.scheduleName} starts in ${remainingText} (${whenText}).`,
      vars,
      templateType: EmailTemplateType.UserOnCallShiftReminder,
      eventType:
        NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
      timezone: data.timezone,
      whenText,
    };
  }

  /**
   * The catch-up message: the same shape as a reminder, prefixed so it reads
   * as the late notice it is.
   *
   * It deliberately does NOT say the shift "now" starts in X. A catch-up
   * goes to anyone holding a shift inside one of their leads with no
   * reminder row, and that includes shifts that did not move at all — the
   * user configured the lead after its instant had passed, or the worker was
   * down for it — so the message would claim a change that never happened
   * the next time a colleague edits an unrelated layer on the schedule. What
   * IS always true is that they have not been told yet; when the shift did
   * change hands the covering clause says so.
   */
  public static buildCatchUpMessage(data: {
    shift: MaterializedShift;
    now: Date;
    timezone: string;
    dashboardUrl: string;
  }): ShiftReminderMessage {
    const { shift } = data;
    const whenText: string = OnCallShiftReminderRunner.formatInstant(
      shift.start,
      data.timezone,
    );
    const endsText: string = OnCallShiftReminderRunner.formatInstant(
      shift.end,
      data.timezone,
    );
    const remainingMinutes: number =
      (shift.start.getTime() - data.now.getTime()) / MILLISECONDS_PER_MINUTE;
    const remainingText: string =
      OnCallShiftReminderRunner.describeMinutes(remainingMinutes);
    const policyNames: string = OnCallShiftReminderRunner.describePolicyNames(
      shift.policies,
    );
    const coveringFor: string | null =
      shift.override && shift.override.originalUserId !== shift.userId
        ? shift.override.originalUserName
        : null;
    const coveringClause: string = coveringFor
      ? ` (you are covering for ${coveringFor})`
      : "";

    const sentence: string = `Heads up: your on-call shift on ${shift.scheduleName} for ${policyNames} starts in ${remainingText} (${whenText})${coveringClause}.`;

    const scheduleViewLink: string = OnCallCalendarFeedUtil.getScheduleUrl(
      data.dashboardUrl,
      shift.projectId,
      shift.scheduleId,
    );

    const vars: Dictionary<string> = {
      scheduleName: shift.scheduleName,
      policyNames,
      leadText: remainingText,
      remainingText,
      startsAt: whenText,
      endsAt: endsText,
      timezone: data.timezone,
      description: sentence,
      coveringFor: coveringFor || "",
      scheduleViewLink,
    };

    return {
      subject: `Heads up: your on-call shift on ${shift.scheduleName} starts in ${remainingText}`,
      text: `This is a message from OneUptime. ${sentence} To change these reminders go to User Settings in the OneUptime Dashboard.`,
      pushTitle: "On-call shift reminder",
      pushBody: `Your on-call shift on ${shift.scheduleName} starts in ${remainingText} (${whenText})${coveringClause}.`,
      vars,
      templateType: EmailTemplateType.UserOnCallShiftReminder,
      eventType:
        NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
      timezone: data.timezone,
      whenText,
    };
  }

  /** "Your shift on Payments at Thu 3 Sep 18:00 Europe/Berlin is now covered by Bob." */
  public static buildReassignedMessage(data: {
    scheduleName: string;
    projectId: string;
    scheduleId: string;
    shiftStartsAt: Date;
    coveredBy: string | null;
    timezone: string;
    dashboardUrl: string;
  }): ShiftReminderMessage {
    const whenText: string = OnCallShiftReminderRunner.formatInstant(
      data.shiftStartsAt,
      data.timezone,
    );
    const outcome: string = data.coveredBy
      ? `is now covered by ${data.coveredBy}`
      : "is no longer assigned to you";
    const sentence: string = `Your on-call shift on ${data.scheduleName} at ${whenText} ${outcome}.`;

    const scheduleViewLink: string = OnCallCalendarFeedUtil.getScheduleUrl(
      data.dashboardUrl,
      data.projectId,
      data.scheduleId,
    );

    const vars: Dictionary<string> = {
      scheduleName: data.scheduleName,
      startsAt: whenText,
      timezone: data.timezone,
      coveredBy: data.coveredBy || "",
      description: sentence,
      scheduleViewLink,
    };

    return {
      subject: `Your on-call shift on ${data.scheduleName} ${outcome}`,
      text: `This is a message from OneUptime. ${sentence} To change these notices go to User Settings in the OneUptime Dashboard.`,
      pushTitle: "On-call shift reassigned",
      pushBody: sentence,
      vars,
      templateType: EmailTemplateType.UserOnCallShiftReassigned,
      eventType:
        NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
      timezone: data.timezone,
      whenText,
    };
  }

  /** For tests: forget which (user, project, day) were already warned about. */
  public static resetMissingSettingsWarnings(): void {
    OnCallShiftReminderRunner.missingSettingsWarned = new Set<string>();
  }

  // -- Sweep internals ----------------------------------------------------

  private static async sweepProject(data: {
    plan: ProjectReminderPlan;
    now: Date;
    lookbackFrom: Date;
    dashboardUrl: string;
    stats: ShiftReminderSweepStats;
  }): Promise<void> {
    const { plan, now, lookbackFrom, stats } = data;

    const windowEnd: Date = OneUptimeDate.addRemoveMinutes(
      now,
      plan.maxLead + SHIFT_REMINDER_WINDOW_PADDING_MINUTES,
    );

    const userIds: Array<ObjectID> = Array.from(plan.users.values()).map(
      (userPlan: UserReminderPlan) => {
        return userPlan.userId;
      },
    );

    /*
     * Candidate schedules of every reminded user in ONE batched lookup —
     * two or three queries for the whole project rather than per user —
     * and then a single materialization per tick.
     */
    const candidatesByUser: Map<
      string,
      Array<ObjectID>
    > = await OnCallShiftMaterializer.getCandidateScheduleIdsForUsers({
      userIds,
      projectIds: [plan.projectId],
      windowStart: now,
      windowEnd,
      includeCoveringShifts: true,
    });

    const scheduleIds: Array<ObjectID> = [];

    for (const candidates of candidatesByUser.values()) {
      scheduleIds.push(...candidates);
    }

    const distinctScheduleIds: Array<ObjectID> =
      OnCallShiftReminderRunner.dedupeIds(scheduleIds);

    if (distinctScheduleIds.length === 0) {
      return;
    }

    const result: MaterializeResult =
      await OnCallShiftMaterializer.materializeForSchedules({
        scheduleIds: distinctScheduleIds,
        windowStart: now,
        windowEnd,
        now,
      });

    for (const schedule of result.schedules) {
      if (schedule.truncated) {
        stats.truncatedSchedules++;
        logger.warn(
          `${SHIFT_REMINDER_JOB_NAME}: schedule ${schedule.scheduleId} hit the simulation cap; reminders for it may be incomplete this tick.`,
        );
      }
    }

    const ledger: Ledger = OnCallShiftReminderRunner.buildLedger(
      await OnCallShiftReminderRunner.loadLedgerRows({
        projectId: plan.projectId,
        userIds,
        from: now,
      }),
    );

    const context: SendContext = {
      now,
      projectId: plan.projectId,
      dashboardUrl: data.dashboardUrl,
      users: OnCallShiftReminderRunner.toUserMap(result.users),
    };

    for (const userPlan of plan.users.values()) {
      try {
        await OnCallShiftReminderRunner.sweepUser({
          userPlan,
          shifts: OnCallShiftMaterializer.filterShiftsForUser(
            result.shifts,
            userPlan.userId,
          ),
          lookbackFrom,
          ledger,
          context,
          stats,
        });
      } catch (err) {
        stats.errors++;
        logger.error(
          `${SHIFT_REMINDER_JOB_NAME}: failed to process user ${userPlan.userId.toString()} in project ${plan.projectId.toString()}`,
        );
        logger.error(err);
      }
    }
  }

  private static async sweepUser(data: {
    userPlan: UserReminderPlan;
    shifts: Array<MaterializedShift>;
    lookbackFrom: Date;
    ledger: Ledger;
    context: SendContext;
    stats: ShiftReminderSweepStats;
  }): Promise<void> {
    const { userPlan, lookbackFrom, ledger, context, stats } = data;
    const now: Date = context.now;

    for (const shift of data.shifts) {
      stats.shiftsConsidered++;

      for (const lead of userPlan.leads) {
        if (
          !OnCallShiftReminderRunner.isDue({
            start: shift.start,
            lead,
            now,
            lookbackFrom,
          })
        ) {
          continue;
        }

        // Lateness cap: never "starts in 15 minutes" after it started.
        if (shift.start.getTime() <= now.getTime()) {
          stats.skippedLate++;
          OnCallShiftReminderRunner.recordMetric(
            ShiftReminderOutcome.SkippedLate,
          );
          continue;
        }

        // A schedule attached to no policy cannot page anyone.
        if (shift.policies.length === 0) {
          stats.skippedNoPolicy++;
          OnCallShiftReminderRunner.recordMetric(
            ShiftReminderOutcome.SkippedNoPolicy,
          );
          continue;
        }

        await OnCallShiftReminderRunner.sendRegularReminder({
          shift,
          lead,
          userPlan,
          ledger,
          context,
          stats,
        });
      }
    }
  }

  private static async sendRegularReminder(data: {
    shift: MaterializedShift;
    lead: number;
    userPlan: UserReminderPlan;
    ledger: Ledger;
    context: SendContext;
    stats: ShiftReminderSweepStats;
  }): Promise<void> {
    const { shift, lead, userPlan, ledger, context, stats } = data;

    /*
     * Does a catch-up already cover this lead? The change pass keys its
     * catch-up with the LARGEST matching lead, so an exact-key check alone
     * would let a smaller lead fire a near-identical message minutes later
     * (an override at T-17 with leads [60, 15]: "now starts in 17 minutes"
     * from the catch-up, then "starts in 15 minutes" from the sweep). A
     * catch-up claimed at or after this lead's instant — minus the same
     * tolerance the "starts in" text uses — already WAS this lead's
     * reminder; an older one (a catch-up at T-30 against a 15-minute lead)
     * was not, and the configured reminder still goes out.
     */
    const shiftStartsAt: Date =
      UserOnCallShiftReminderLogServiceClass.truncateToMinute(shift.start);
    const coveredFrom: number =
      shiftStartsAt.getTime() -
      (lead + SHIFT_REMINDER_LEAD_TEXT_TOLERANCE_MINUTES) *
        MILLISECONDS_PER_MINUTE;

    const coveredByCatchUp: boolean = ledger.rows.some((row: LedgerRow) => {
      return (
        row.kind === UserOnCallShiftReminderLogKind.CatchUp &&
        row.userId === userPlan.userId.toString() &&
        row.scheduleId === shift.scheduleId &&
        row.shiftStartsAt.getTime() === shiftStartsAt.getTime() &&
        row.claimedAt.getTime() >= coveredFrom
      );
    });

    if (coveredByCatchUp) {
      stats.skippedAlreadySent++;
      OnCallShiftReminderRunner.recordMetric(
        ShiftReminderOutcome.SkippedAlreadySent,
      );
      return;
    }

    const claim: ClaimResult = await OnCallShiftReminderRunner.claim({
      projectId: context.projectId,
      userId: userPlan.userId,
      scheduleId: shift.scheduleId,
      shiftStartsAt: shift.start,
      minutesBeforeShift: lead,
      kind: UserOnCallShiftReminderLogKind.Reminder,
      ledger,
      now: context.now,
    });

    switch (claim.outcome) {
      case "already-sent":
        stats.skippedAlreadySent++;
        OnCallShiftReminderRunner.recordMetric(
          ShiftReminderOutcome.SkippedAlreadySent,
        );
        return;
      case "in-flight":
        stats.skippedInFlight++;
        OnCallShiftReminderRunner.recordMetric(
          ShiftReminderOutcome.SkippedInFlight,
        );
        return;
      case "collision":
        stats.claimCollisions++;
        OnCallShiftReminderRunner.recordMetric(
          ShiftReminderOutcome.ClaimCollision,
        );
        return;
      case "reclaimed":
        stats.claimRetries++;
        OnCallShiftReminderRunner.recordMetric(ShiftReminderOutcome.ClaimRetry);
        break;
      case "claimed":
        break;
    }

    if (!claim.claimId) {
      return;
    }

    // Another pass claimed the same shift from its own snapshot: it wins.
    const conflicted: boolean =
      await OnCallShiftReminderRunner.yieldToConcurrentSibling({
        projectId: context.projectId,
        userId: userPlan.userId,
        scheduleId: shift.scheduleId,
        shiftStartsAt,
        claimId: claim.claimId,
        claimedAt: context.now,
        ledger,
      });

    if (conflicted) {
      stats.claimCollisions++;
      OnCallShiftReminderRunner.recordMetric(
        ShiftReminderOutcome.ClaimCollision,
      );
      return;
    }

    const recipient: MaterializedUserInfo | undefined = context.users.get(
      userPlan.userId.toString(),
    );

    const message: ShiftReminderMessage =
      OnCallShiftReminderRunner.buildReminderMessage({
        shift,
        lead,
        now: context.now,
        timezone: OnCallShiftReminderRunner.resolveTimezone({
          userTimezone: recipient?.timezone,
          scheduleTimezone: shift.scheduleTimezone,
        }),
        dashboardUrl: context.dashboardUrl,
      });

    const delivered: boolean = await OnCallShiftReminderRunner.deliver({
      claimId: claim.claimId,
      userId: userPlan.userId,
      projectId: context.projectId,
      scheduleId: new ObjectID(shift.scheduleId),
      policies: shift.policies,
      message,
      now: context.now,
      onMissingSettings: () => {
        stats.missingSettings++;
      },
    });

    if (delivered) {
      stats.sent++;
      OnCallShiftReminderRunner.recordMetric(ShiftReminderOutcome.Sent);
    } else {
      stats.sendFailures++;
      OnCallShiftReminderRunner.recordMetric(ShiftReminderOutcome.SendFailed);
    }
  }

  // -- Change-pass internals ------------------------------------------------

  private static async sendCatchUps(data: {
    userPlan: UserReminderPlan;
    heldShifts: Array<MaterializedShift>;
    ledger: Ledger;
    context: SendContext;
    stats: ShiftReminderChangePassStats;
  }): Promise<void> {
    const { userPlan, ledger, context, stats } = data;
    const now: Date = context.now;
    const userKey: string = userPlan.userId.toString();

    for (const shift of data.heldShifts) {
      if (shift.policies.length === 0) {
        continue;
      }

      const remainingMs: number = shift.start.getTime() - now.getTime();

      const matchingLeads: Array<number> = userPlan.leads.filter(
        (lead: number) => {
          return remainingMs <= lead * MILLISECONDS_PER_MINUTE;
        },
      );

      if (matchingLeads.length === 0) {
        continue;
      }

      const lead: number = Math.max(...matchingLeads);

      /*
       * Already told about this shift (any lead, reminder or catch-up)?
       * Then no catch-up — unless a LATER "reassigned" notice took it away
       * again, in which case the user must hear that it is theirs after
       * all.
       */
      const told: Array<LedgerRow> = ledger.rows.filter((row: LedgerRow) => {
        return (
          row.userId === userKey &&
          row.scheduleId === shift.scheduleId &&
          row.shiftStartsAt.getTime() === shift.start.getTime() &&
          (row.kind === UserOnCallShiftReminderLogKind.Reminder ||
            row.kind === UserOnCallShiftReminderLogKind.CatchUp)
        );
      });

      const reassignedRow: LedgerRow | undefined = ledger.rows.find(
        (row: LedgerRow) => {
          return (
            row.userId === userKey &&
            row.scheduleId === shift.scheduleId &&
            row.shiftStartsAt.getTime() === shift.start.getTime() &&
            row.kind === UserOnCallShiftReminderLogKind.Reassigned
          );
        },
      );

      const latestTold: number = told.reduce((max: number, row: LedgerRow) => {
        return Math.max(max, row.claimedAt.getTime());
      }, 0);

      const takenBackLater: boolean =
        reassignedRow !== undefined &&
        reassignedRow.claimedAt.getTime() >= latestTold;

      if (told.length > 0 && !takenBackLater) {
        continue;
      }

      const claim: ClaimResult = await OnCallShiftReminderRunner.claim({
        projectId: context.projectId,
        userId: userPlan.userId,
        scheduleId: shift.scheduleId,
        shiftStartsAt: shift.start,
        minutesBeforeShift: lead,
        kind: UserOnCallShiftReminderLogKind.CatchUp,
        ledger,
        now,
      });

      if (claim.outcome === "collision") {
        stats.claimCollisions++;
      }

      if (!claim.claimId || claim.outcome === "already-sent") {
        continue;
      }

      // A sweep tick claimed the same shift meanwhile: the older claim wins.
      const conflicted: boolean =
        await OnCallShiftReminderRunner.yieldToConcurrentSibling({
          projectId: context.projectId,
          userId: userPlan.userId,
          scheduleId: shift.scheduleId,
          shiftStartsAt:
            UserOnCallShiftReminderLogServiceClass.truncateToMinute(
              shift.start,
            ),
          claimId: claim.claimId,
          claimedAt: now,
          ledger,
        });

      if (conflicted) {
        stats.claimCollisions++;
        OnCallShiftReminderRunner.recordMetric(
          ShiftReminderOutcome.ClaimCollision,
        );
        continue;
      }

      const recipient: MaterializedUserInfo | undefined =
        context.users.get(userKey);

      const message: ShiftReminderMessage =
        OnCallShiftReminderRunner.buildCatchUpMessage({
          shift,
          now,
          timezone: OnCallShiftReminderRunner.resolveTimezone({
            userTimezone: recipient?.timezone,
            scheduleTimezone: shift.scheduleTimezone,
          }),
          dashboardUrl: context.dashboardUrl,
        });

      const delivered: boolean = await OnCallShiftReminderRunner.deliver({
        claimId: claim.claimId,
        userId: userPlan.userId,
        projectId: context.projectId,
        scheduleId: new ObjectID(shift.scheduleId),
        policies: shift.policies,
        message,
        now,
        onMissingSettings: () => {
          stats.missingSettings++;
        },
      });

      if (!delivered) {
        stats.sendFailures++;
        continue;
      }

      stats.catchUpsSent++;
      OnCallShiftReminderRunner.recordMetric(ShiftReminderOutcome.CatchUpSent);

      // The shift is theirs again; let a future flip produce a fresh notice.
      if (reassignedRow && takenBackLater) {
        await OnCallShiftReminderRunner.deleteLedgerRow(reassignedRow.id);
        ledger.rows = ledger.rows.filter((row: LedgerRow) => {
          return row.id.toString() !== reassignedRow.id.toString();
        });
        ledger.byKey.delete(
          OnCallShiftReminderRunner.ledgerKey({
            userId: reassignedRow.userId,
            scheduleId: reassignedRow.scheduleId,
            shiftStartsAt: reassignedRow.shiftStartsAt,
            minutesBeforeShift: reassignedRow.minutesBeforeShift,
            kind: reassignedRow.kind,
          }),
        );
      }
    }
  }

  private static async sendReassignedNotices(data: {
    userId: ObjectID;
    heldShifts: Array<MaterializedShift>;
    allShifts: Array<MaterializedShift>;
    ledger: Ledger;
    resolvedSchedules: Map<string, MaterializedScheduleInfo>;
    context: SendContext;
    stats: ShiftReminderChangePassStats;
  }): Promise<void> {
    const { ledger, context, stats } = data;
    const now: Date = context.now;
    const userKey: string = data.userId.toString();

    // One notice per (schedule, start), however many leads were reminded.
    const seen: Set<string> = new Set<string>();

    for (const row of ledger.rows) {
      if (
        row.userId !== userKey ||
        (row.kind !== UserOnCallShiftReminderLogKind.Reminder &&
          row.kind !== UserOnCallShiftReminderLogKind.CatchUp) ||
        row.shiftStartsAt.getTime() <= now.getTime()
      ) {
        continue;
      }

      const shiftKey: string = `${row.scheduleId}|${row.shiftStartsAt.getTime()}`;

      if (seen.has(shiftKey)) {
        continue;
      }

      seen.add(shiftKey);

      const schedule: MaterializedScheduleInfo | undefined =
        data.resolvedSchedules.get(row.scheduleId);

      // Not resolved this pass (or unreliable): cannot judge, say nothing.
      if (!schedule || schedule.truncated) {
        continue;
      }

      const stillHolds: boolean = data.heldShifts.some(
        (shift: MaterializedShift) => {
          return (
            shift.scheduleId === row.scheduleId &&
            shift.start.getTime() === row.shiftStartsAt.getTime()
          );
        },
      );

      if (stillHolds) {
        continue;
      }

      /*
       * A reassigned notice newer than the last reminder/catch-up was
       * already sent for this shift.
       */
      const latestTold: number = ledger.rows.reduce(
        (max: number, candidate: LedgerRow) => {
          if (
            candidate.userId === userKey &&
            candidate.scheduleId === row.scheduleId &&
            candidate.shiftStartsAt.getTime() === row.shiftStartsAt.getTime() &&
            (candidate.kind === UserOnCallShiftReminderLogKind.Reminder ||
              candidate.kind === UserOnCallShiftReminderLogKind.CatchUp)
          ) {
            return Math.max(max, candidate.claimedAt.getTime());
          }
          return max;
        },
        0,
      );

      const existingNotice: LedgerRow | undefined = ledger.byKey.get(
        OnCallShiftReminderRunner.ledgerKey({
          userId: userKey,
          scheduleId: row.scheduleId,
          shiftStartsAt: row.shiftStartsAt,
          minutesBeforeShift: 0,
          kind: UserOnCallShiftReminderLogKind.Reassigned,
        }),
      );

      if (existingNotice && existingNotice.claimedAt.getTime() >= latestTold) {
        continue;
      }

      const claim: ClaimResult = await OnCallShiftReminderRunner.claim({
        projectId: context.projectId,
        userId: data.userId,
        scheduleId: row.scheduleId,
        shiftStartsAt: row.shiftStartsAt,
        minutesBeforeShift: 0,
        kind: UserOnCallShiftReminderLogKind.Reassigned,
        ledger,
        now,
      });

      if (claim.outcome === "collision") {
        stats.claimCollisions++;
      }

      if (!claim.claimId || claim.outcome === "already-sent") {
        continue;
      }

      const replacement: MaterializedShift | undefined = data.allShifts.find(
        (shift: MaterializedShift) => {
          return (
            shift.scheduleId === row.scheduleId &&
            shift.start.getTime() === row.shiftStartsAt.getTime() &&
            shift.userId !== userKey &&
            !shift.policyVariantOf
          );
        },
      );

      const recipient: MaterializedUserInfo | undefined =
        context.users.get(userKey);

      const message: ShiftReminderMessage =
        OnCallShiftReminderRunner.buildReassignedMessage({
          scheduleName: schedule.scheduleName,
          projectId: schedule.projectId,
          scheduleId: schedule.scheduleId,
          shiftStartsAt: row.shiftStartsAt,
          coveredBy: replacement ? replacement.userName : null,
          timezone: OnCallShiftReminderRunner.resolveTimezone({
            userTimezone: recipient?.timezone,
            scheduleTimezone: schedule.scheduleTimezone,
          }),
          dashboardUrl: context.dashboardUrl,
        });

      const delivered: boolean = await OnCallShiftReminderRunner.deliver({
        claimId: claim.claimId,
        userId: data.userId,
        projectId: context.projectId,
        scheduleId: new ObjectID(schedule.scheduleId),
        policies: schedule.attachedPolicies,
        message,
        now,
        onMissingSettings: () => {
          stats.missingSettings++;
        },
      });

      if (!delivered) {
        stats.sendFailures++;
        continue;
      }

      stats.reassignedSent++;
      OnCallShiftReminderRunner.recordMetric(
        ShiftReminderOutcome.ReassignedSent,
      );
    }
  }

  // -- Ledger -------------------------------------------------------------

  /**
   * Claim the ledger row for one (user, schedule, start, lead, kind):
   * insert with sentAt NULL; on a unique violation, look at the existing
   * row — sent means done, a fresh claim means another worker is on it, a
   * stale claim is re-claimed with a conditional update so exactly one
   * worker wins.
   */
  private static async claim(data: {
    projectId: ObjectID;
    userId: ObjectID;
    scheduleId: string;
    shiftStartsAt: Date;
    minutesBeforeShift: number;
    kind: UserOnCallShiftReminderLogKind;
    ledger: Ledger;
    now: Date;
  }): Promise<ClaimResult> {
    const shiftStartsAt: Date =
      UserOnCallShiftReminderLogServiceClass.truncateToMinute(
        data.shiftStartsAt,
      );
    const key: string = OnCallShiftReminderRunner.ledgerKey({
      userId: data.userId,
      scheduleId: data.scheduleId,
      shiftStartsAt,
      minutesBeforeShift: data.minutesBeforeShift,
      kind: data.kind,
    });

    const existing: LedgerRow | undefined = data.ledger.byKey.get(key);

    if (existing) {
      return await OnCallShiftReminderRunner.reclaim(existing, data.now);
    }

    const row: UserOnCallShiftReminderLog = new UserOnCallShiftReminderLog();
    row.projectId = data.projectId;
    row.userId = data.userId;
    row.onCallDutyPolicyScheduleId = new ObjectID(data.scheduleId);
    row.shiftStartsAt = shiftStartsAt;
    row.minutesBeforeShift = data.minutesBeforeShift;
    row.kind = data.kind;
    row.claimedAt = data.now;

    try {
      const created: UserOnCallShiftReminderLog =
        await UserOnCallShiftReminderLogService.create({
          data: row,
          props: {
            isRoot: true,
          },
        });

      if (!created.id) {
        return { claimId: null, outcome: "collision" };
      }

      const ledgerRow: LedgerRow = {
        id: created.id,
        userId: data.userId.toString(),
        scheduleId: data.scheduleId,
        shiftStartsAt,
        minutesBeforeShift: data.minutesBeforeShift,
        kind: data.kind,
        claimedAt: data.now,
        sentAt: null,
      };

      data.ledger.byKey.set(key, ledgerRow);
      data.ledger.rows.push(ledgerRow);
      data.ledger.knownIds.add(created.id.toString());

      return { claimId: created.id, outcome: "claimed" };
    } catch (err) {
      if (PostgresErrorTranslator.isUniqueViolation(err)) {
        return { claimId: null, outcome: "collision" };
      }

      throw err;
    }
  }

  private static async reclaim(
    existing: LedgerRow,
    now: Date,
  ): Promise<ClaimResult> {
    if (existing.sentAt) {
      return { claimId: null, outcome: "already-sent" };
    }

    const reclaimBefore: Date = OneUptimeDate.addRemoveMinutes(
      now,
      SHIFT_REMINDER_RECLAIM_AFTER_MINUTES * -1,
    );

    if (existing.claimedAt.getTime() > reclaimBefore.getTime()) {
      return { claimId: null, outcome: "in-flight" };
    }

    // Conditional: only the worker whose UPDATE matches the stale row wins.
    const updated: number = await UserOnCallShiftReminderLogService.updateOneBy(
      {
        query: {
          _id: existing.id,
          sentAt: QueryHelper.isNull(),
          claimedAt: QueryHelper.lessThanEqualTo(reclaimBefore),
        },
        data: {
          claimedAt: now,
        },
        props: {
          isRoot: true,
        },
      },
    );

    if (updated !== 1) {
      return { claimId: null, outcome: "in-flight" };
    }

    existing.claimedAt = now;

    return { claimId: existing.id, outcome: "reclaimed" };
  }

  private static async stampSent(
    claimId: ObjectID,
    sentAt: Date,
  ): Promise<void> {
    await UserOnCallShiftReminderLogService.updateOneById({
      id: claimId,
      data: {
        sentAt,
      },
      props: {
        isRoot: true,
      },
    });
  }

  private static async deleteLedgerRow(claimId: ObjectID): Promise<void> {
    await UserOnCallShiftReminderLogService.deleteOneBy({
      query: {
        _id: claimId,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /**
   * The one duplicate the UNIQUE index cannot catch: the sweep and a
   * hook-triggered change pass deciding about the SAME (user, schedule,
   * shift start) at the same moment, in two processes. Both decide from a
   * snapshot taken before either claimed anything, and `reminder|lead` and
   * `catch-up|lead` are different keys, so both inserts succeed and both
   * messages go out seconds apart.
   *
   * So after claiming, re-read this shift's rows: a reminder/catch-up row
   * this pass did not write (not in the snapshot, not claimed by it) means
   * somebody else is notifying about the same shift. The OLDER claim wins —
   * ties broken by id, so the two sides always agree on the winner — and
   * the loser releases its claim and says nothing. Returns true when THIS
   * pass is the loser.
   *
   * A failed re-read never blocks a reminder: it logs and sends.
   */
  private static async yieldToConcurrentSibling(data: {
    projectId: ObjectID;
    userId: ObjectID;
    scheduleId: string;
    shiftStartsAt: Date;
    claimId: ObjectID;
    claimedAt: Date;
    ledger: Ledger;
  }): Promise<boolean> {
    const mine: string = data.claimId.toString();

    let rows: Array<LedgerRow> = [];

    try {
      rows = await OnCallShiftReminderRunner.loadLedgerRows({
        projectId: data.projectId,
        userIds: [data.userId],
        scheduleIds: [new ObjectID(data.scheduleId)],
        from: data.shiftStartsAt,
      });
    } catch (err) {
      logger.warn(
        `${SHIFT_REMINDER_JOB_NAME}: could not re-read the ledger after claiming ${mine}; sending anyway: ${err}`,
      );
      return false;
    }

    const winner: LedgerRow | undefined = rows.find((row: LedgerRow) => {
      const id: string = row.id.toString();

      if (
        id === mine ||
        data.ledger.knownIds.has(id) ||
        row.shiftStartsAt.getTime() !== data.shiftStartsAt.getTime() ||
        (row.kind !== UserOnCallShiftReminderLogKind.Reminder &&
          row.kind !== UserOnCallShiftReminderLogKind.CatchUp)
      ) {
        return false;
      }

      return (
        row.claimedAt.getTime() < data.claimedAt.getTime() ||
        (row.claimedAt.getTime() === data.claimedAt.getTime() && id < mine)
      );
    });

    if (!winner) {
      return false;
    }

    logger.debug(
      `${SHIFT_REMINDER_JOB_NAME}: another pass is already notifying user ${data.userId.toString()} about the shift on schedule ${data.scheduleId} starting ${data.shiftStartsAt.toISOString()}; releasing claim ${mine}.`,
    );

    await OnCallShiftReminderRunner.releaseClaim(data.claimId, data.ledger);

    return true;
  }

  /** Delete a claim this pass made and forget it, best-effort. */
  private static async releaseClaim(
    claimId: ObjectID,
    ledger: Ledger,
  ): Promise<void> {
    try {
      await OnCallShiftReminderRunner.deleteLedgerRow(claimId);
    } catch (err) {
      logger.error(
        `${SHIFT_REMINDER_JOB_NAME}: could not release claim ${claimId.toString()}; it becomes re-claimable after ${SHIFT_REMINDER_RECLAIM_AFTER_MINUTES} minutes.`,
      );
      logger.error(err);
    }

    const id: string = claimId.toString();

    ledger.rows = ledger.rows.filter((row: LedgerRow) => {
      return row.id.toString() !== id;
    });

    for (const [key, row] of ledger.byKey) {
      if (row.id.toString() === id) {
        ledger.byKey.delete(key);
      }
    }
  }

  /**
   * Send through the user's notification settings, then stamp the claim.
   * A thrown send deletes the claim so the next tick retries; returns
   * whether the row was stamped.
   */
  private static async deliver(data: {
    claimId: ObjectID;
    userId: ObjectID;
    projectId: ObjectID;
    scheduleId: ObjectID;
    policies: Array<MaterializedShiftPolicy>;
    message: ShiftReminderMessage;
    now: Date;
    onMissingSettings: () => void;
  }): Promise<boolean> {
    const { message } = data;

    try {
      const hasSettings: boolean =
        await OnCallShiftReminderRunner.warnIfSettingsMissing({
          userId: data.userId,
          projectId: data.projectId,
          eventType: message.eventType,
          now: data.now,
        });

      if (!hasSettings) {
        data.onMissingSettings();
        OnCallShiftReminderRunner.recordMetric(
          ShiftReminderOutcome.MissingSettings,
        );
      }

      const emailEnvelope: EmailEnvelope = {
        templateType: message.templateType,
        vars: message.vars,
        subject: message.subject,
      };

      const smsMessage: SMSMessage = {
        message: message.text,
      };

      const callRequestMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `${message.text} Good bye.`,
          },
        ],
      };

      const pushNotificationMessage: PushNotificationMessage =
        PushNotificationUtil.createGenericNotification({
          title: message.pushTitle,
          body: message.pushBody,
          clickAction: message.vars["scheduleViewLink"] || "",
          tag: "on-call-shift-reminder",
          requireInteraction: false,
        });

      const whatsAppMessage: WhatsAppMessagePayload | undefined =
        OnCallShiftReminderRunner.buildWhatsAppMessage(message);

      const firstPolicy: MaterializedShiftPolicy | undefined = data.policies[0];

      await UserNotificationSettingService.sendUserNotification({
        userId: data.userId,
        projectId: data.projectId,
        eventType: message.eventType,
        emailEnvelope,
        smsMessage,
        callRequestMessage,
        pushNotificationMessage,
        whatsAppMessage,
        onCallScheduleId: data.scheduleId,
        onCallPolicyId: firstPolicy
          ? new ObjectID(firstPolicy.policyId)
          : undefined,
        onCallPolicyEscalationRuleId: firstPolicy
          ? new ObjectID(firstPolicy.ruleId)
          : undefined,
      });
    } catch (err) {
      logger.error(
        `${SHIFT_REMINDER_JOB_NAME}: sending "${message.eventType}" to user ${data.userId.toString()} failed; releasing the claim so the next tick retries.`,
      );
      logger.error(err);

      try {
        await OnCallShiftReminderRunner.deleteLedgerRow(data.claimId);
      } catch (deleteErr) {
        logger.error(
          `${SHIFT_REMINDER_JOB_NAME}: could not release claim ${data.claimId.toString()}; it becomes re-claimable after ${SHIFT_REMINDER_RECLAIM_AFTER_MINUTES} minutes.`,
        );
        logger.error(deleteErr);
      }

      return false;
    }

    /*
     * The message is out. A failed stamp (a database blip between the send
     * and the UPDATE) must not throw: it would abort the rest of this
     * user's tick — every other shift and lead they are due — over a
     * notification that WAS delivered. Log it instead; the claim row stays
     * unstamped and may be re-claimed later, which is the safe direction.
     */
    try {
      await OnCallShiftReminderRunner.stampSent(
        data.claimId,
        OneUptimeDate.getCurrentDate(),
      );
    } catch (err) {
      logger.error(
        `${SHIFT_REMINDER_JOB_NAME}: "${message.eventType}" was delivered to user ${data.userId.toString()}, but claim ${data.claimId.toString()} could not be stamped as sent; it may be re-sent after ${SHIFT_REMINDER_RECLAIM_AFTER_MINUTES} minutes.`,
      );
      logger.error(err);
    }

    return true;
  }

  /**
   * WhatsApp delivers Meta-approved TEMPLATE messages only: a body-only
   * payload is rejected by the notification service before it ever reaches
   * Meta, which leaves a failed WhatsAppLog row and delivers nothing. No
   * template exists for the two new event types, and registering one is a
   * Meta approval rather than a code change — so:
   *
   *   - a shift reminder (and its catch-up) reuses the approved
   *     "you are next on-call for <policy> on <schedule>" template, whose
   *     wording fits it exactly;
   *   - a reassignment, which no approved template describes, sends no
   *     WhatsApp payload at all, so the notification service skips the
   *     channel cleanly instead of failing it.
   *
   * Email, SMS, call and push always carry the full text either way.
   */
  public static buildWhatsAppMessage(
    message: ShiftReminderMessage,
  ): WhatsAppMessagePayload | undefined {
    if (
      message.eventType !==
      NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS
    ) {
      return undefined;
    }

    const scheduleLink: string = message.vars["scheduleViewLink"] || "";

    try {
      return createWhatsAppMessageFromTemplate({
        templateKey: WhatsAppTemplateIds.OnCallUserIsNextNotification,
        actionLink: scheduleLink || undefined,
        templateVariables: {
          on_call_policy_name: message.vars["policyNames"] || "",
          schedule_name: message.vars["scheduleName"] || "",
          schedule_link: scheduleLink,
        },
      });
    } catch (err) {
      logger.warn(
        `${SHIFT_REMINDER_JOB_NAME}: could not build the WhatsApp template message for "${message.eventType}"; the channel is skipped: ${err}`,
      );
      return undefined;
    }
  }

  /**
   * sendUserNotification silently sends nothing without a
   * UserNotificationSetting row. The DataMigration backfills one for every
   * member, so this should be unreachable — log loudly (once per user, project
   * and day) if it is not, so a silent zero is impossible.
   */
  private static async warnIfSettingsMissing(data: {
    userId: ObjectID;
    projectId: ObjectID;
    eventType: NotificationSettingEventType;
    now: Date;
  }): Promise<boolean> {
    const setting: UserNotificationSetting | null =
      await UserNotificationSettingService.findOneBy({
        query: {
          userId: data.userId,
          projectId: data.projectId,
          eventType: data.eventType,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (setting) {
      return true;
    }

    const day: string = data.now.toISOString().slice(0, 10);
    const warnKey: string = `${data.userId.toString()}|${data.projectId.toString()}|${data.eventType}|${day}`;

    if (!OnCallShiftReminderRunner.missingSettingsWarned.has(warnKey)) {
      // Keep the set bounded: forget other days' entries.
      for (const key of OnCallShiftReminderRunner.missingSettingsWarned) {
        if (!key.endsWith(`|${day}`)) {
          OnCallShiftReminderRunner.missingSettingsWarned.delete(key);
        }
      }

      OnCallShiftReminderRunner.missingSettingsWarned.add(warnKey);

      logger.warn(
        `${SHIFT_REMINDER_JOB_NAME}: user ${data.userId.toString()} in project ${data.projectId.toString()} has no UserNotificationSetting row for "${data.eventType}", so nothing will be delivered. Run the AddShiftReminderNotificationSettingsForUsers data migration (or have the user re-save their notification settings).`,
      );
    }

    return false;
  }

  private static async loadLedgerRows(data: {
    projectId: ObjectID;
    userIds?: Array<ObjectID> | undefined;
    scheduleIds?: Array<ObjectID> | undefined;
    from: Date;
  }): Promise<Array<LedgerRow>> {
    if (
      (data.userIds && data.userIds.length === 0) ||
      (data.scheduleIds && data.scheduleIds.length === 0)
    ) {
      return [];
    }

    const query: Record<string, unknown> = {
      projectId: data.projectId,
      shiftStartsAt: QueryHelper.greaterThanEqualTo(data.from),
    };

    if (data.userIds) {
      query["userId"] = QueryHelper.any(data.userIds);
    }

    if (data.scheduleIds) {
      query["onCallDutyPolicyScheduleId"] = QueryHelper.any(data.scheduleIds);
    }

    const rows: Array<UserOnCallShiftReminderLog> =
      await UserOnCallShiftReminderLogService.findBy({
        query: query as never,
        select: {
          _id: true,
          userId: true,
          onCallDutyPolicyScheduleId: true,
          shiftStartsAt: true,
          minutesBeforeShift: true,
          kind: true,
          claimedAt: true,
          sentAt: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const ledgerRows: Array<LedgerRow> = [];

    for (const row of rows) {
      if (
        !row.id ||
        !row.userId ||
        !row.onCallDutyPolicyScheduleId ||
        !row.shiftStartsAt ||
        !row.kind
      ) {
        continue;
      }

      ledgerRows.push({
        id: row.id,
        userId: row.userId.toString(),
        scheduleId: row.onCallDutyPolicyScheduleId.toString(),
        shiftStartsAt: UserOnCallShiftReminderLogServiceClass.truncateToMinute(
          OneUptimeDate.fromString(row.shiftStartsAt),
        ),
        minutesBeforeShift: row.minutesBeforeShift ?? 0,
        kind: row.kind,
        claimedAt: row.claimedAt
          ? OneUptimeDate.fromString(row.claimedAt)
          : new Date(0),
        sentAt: row.sentAt ? OneUptimeDate.fromString(row.sentAt) : null,
      });
    }

    return ledgerRows;
  }

  private static buildLedger(rows: Array<LedgerRow>): Ledger {
    const byKey: Map<string, LedgerRow> = new Map<string, LedgerRow>();
    const knownIds: Set<string> = new Set<string>();

    for (const row of rows) {
      byKey.set(
        OnCallShiftReminderRunner.ledgerKey({
          userId: row.userId,
          scheduleId: row.scheduleId,
          shiftStartsAt: row.shiftStartsAt,
          minutesBeforeShift: row.minutesBeforeShift,
          kind: row.kind,
        }),
        row,
      );
      knownIds.add(row.id.toString());
    }

    return { byKey, rows: [...rows], knownIds };
  }

  // -- Plans ----------------------------------------------------------------

  private static buildProjectPlans(
    reminders: Array<UserOnCallShiftReminder>,
  ): Map<string, ProjectReminderPlan> {
    const plans: Map<string, ProjectReminderPlan> = new Map<
      string,
      ProjectReminderPlan
    >();

    for (const reminder of reminders) {
      if (
        !reminder.projectId ||
        !reminder.userId ||
        typeof reminder.minutesBeforeShift !== "number" ||
        !Number.isFinite(reminder.minutesBeforeShift) ||
        reminder.minutesBeforeShift <= 0
      ) {
        continue;
      }

      const projectKey: string = reminder.projectId.toString();
      const userKey: string = reminder.userId.toString();

      let plan: ProjectReminderPlan | undefined = plans.get(projectKey);

      if (!plan) {
        plan = {
          projectId: reminder.projectId,
          users: new Map<string, UserReminderPlan>(),
          maxLead: 0,
        };
        plans.set(projectKey, plan);
      }

      let userPlan: UserReminderPlan | undefined = plan.users.get(userKey);

      if (!userPlan) {
        userPlan = {
          userId: reminder.userId,
          projectId: reminder.projectId,
          leads: [],
          maxLead: 0,
        };
        plan.users.set(userKey, userPlan);
      }

      const lead: number = Math.round(reminder.minutesBeforeShift);

      if (!userPlan.leads.includes(lead)) {
        userPlan.leads.push(lead);
        userPlan.leads.sort((a: number, b: number) => {
          return b - a;
        });
      }

      userPlan.maxLead = Math.max(userPlan.maxLead, lead);
      plan.maxLead = Math.max(plan.maxLead, lead);
    }

    return plans;
  }

  // -- Misc -----------------------------------------------------------------

  private static async resolveProjectIdFromSchedules(
    scheduleIds: Array<ObjectID>,
  ): Promise<ObjectID | null> {
    const ids: Array<ObjectID> =
      OnCallShiftReminderRunner.dedupeIds(scheduleIds);

    if (ids.length === 0) {
      return null;
    }

    const schedules: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findBy({
        query: {
          _id: QueryHelper.any(ids),
        },
        select: {
          _id: true,
          projectId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const schedule of schedules) {
      if (schedule.projectId) {
        return schedule.projectId;
      }
    }

    return null;
  }

  private static async getDashboardUrl(): Promise<string> {
    try {
      const url: URL = await DatabaseConfig.getDashboardUrl();
      return url.toString();
    } catch (err) {
      logger.warn(
        `${SHIFT_REMINDER_JOB_NAME}: could not resolve the dashboard URL; links in reminders will be relative: ${err}`,
      );
      return "/dashboard";
    }
  }

  /**
   * The materializer only looks up users it can see in the resolution: the
   * segment holders, the parties of an override, and the schedule's CURRENT
   * layer members. A user who was just removed from the layer — or from the
   * project — is none of those, yet they are exactly who a "reassigned"
   * notice goes to. Without them the notice falls back to the SCHEDULE's
   * timezone, so a Berlin engineer would read a New York wall clock. One
   * root lookup fills in the recipients that are missing AND actually have a
   * ledger row (nobody else can receive a notice), so the common pass adds
   * no query at all.
   */
  private static async backfillRecipients(data: {
    userIds: Array<ObjectID>;
    ledger: Ledger;
    context: SendContext;
  }): Promise<void> {
    const missing: Array<ObjectID> = data.userIds.filter((userId: ObjectID) => {
      const key: string = userId.toString();

      if (data.context.users.has(key)) {
        return false;
      }

      return data.ledger.rows.some((row: LedgerRow) => {
        return row.userId === key;
      });
    });

    if (missing.length === 0) {
      return;
    }

    try {
      const rows: Array<User> = await UserService.findBy({
        query: {
          _id: QueryHelper.any(missing),
        },
        select: {
          _id: true,
          name: true,
          email: true,
          timezone: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const row of rows) {
        const userId: string | undefined = row.id?.toString();

        if (!userId) {
          continue;
        }

        const name: string = row.name?.toString().trim() || "";
        const email: string = row.email?.toString().trim() || "";
        const timezone: string = row.timezone?.toString() || "";

        const info: MaterializedUserInfo = {
          userId,
          userName: name || email || OnCallCalendarFeedUtil.FALLBACK_USER_NAME,
        };

        if (email) {
          info.email = email;
        }

        if (timezone) {
          info.timezone = timezone;
        }

        data.context.users.set(userId, info);
      }
    } catch (err) {
      logger.warn(
        `${SHIFT_REMINDER_LISTENER_NAME}: could not load ${missing.length} notice recipient(s); their messages fall back to the schedule's timezone: ${err}`,
      );
    }
  }

  private static toUserMap(
    users: Array<MaterializedUserInfo>,
  ): Map<string, MaterializedUserInfo> {
    const map: Map<string, MaterializedUserInfo> = new Map<
      string,
      MaterializedUserInfo
    >();

    for (const user of users) {
      map.set(user.userId, user);
    }

    return map;
  }

  private static dedupeIds(ids: Array<ObjectID>): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const result: Array<ObjectID> = [];

    for (const id of ids) {
      if (!id) {
        continue;
      }

      const key: string = id.toString();

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(id);
    }

    return result;
  }

  private static recordMetric(outcome: ShiftReminderOutcome): void {
    try {
      if (!OnCallShiftReminderRunner.counter) {
        OnCallShiftReminderRunner.counter = Telemetry.getCounter({
          name: METRIC_NAME,
          description:
            "On-call shift reminders and change notices by outcome (sent, skipped late, claim retry, ...).",
          unit: "1",
        });
      }

      OnCallShiftReminderRunner.counter.add(1, {
        [METRIC_OUTCOME_ATTRIBUTE]: outcome,
      });
    } catch {
      // Metrics are best-effort; a reminder must never fail on telemetry.
    }
  }
}
