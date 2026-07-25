import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import User from "Common/Models/DatabaseModels/User";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import { DisableAutomaticAlertCreation } from "Common/Server/EnvironmentConfig";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import AlertService from "Common/Server/Services/AlertService";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ServiceLevelObjectiveBurnRateRuleService from "Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import SloHistoryService, {
  SloHistoryRow,
} from "Common/Server/Services/SloHistoryService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import SloUtil, {
  ErrorBudgetResult,
  MonitorTimelineSet,
  TimeSliResult,
} from "Common/Utils/Slo/SloUtil";
import { UptimeWindow } from "Common/Utils/Uptime/UptimeUtil";
import {
  SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
  SLO_EVALUATION_CADENCE_MINUTES,
} from "Common/Utils/Slo/SloEvaluation";
import { isBurnRateRuleFiring } from "Common/Utils/Slo/SloBurnRateRuleState";

/*
 * How far in the future the next full evaluation is scheduled, and the
 * lookback for the "current burn rate" state column. Both live in
 * Common/Utils/Slo/SloEvaluation so the dashboard copy that describes them
 * cannot drift away from what this worker actually does.
 */
const EVALUATION_CADENCE_MINUTES: number = SLO_EVALUATION_CADENCE_MINUTES;

const CURRENT_BURN_RATE_WINDOW_MINUTES: number =
  SLO_CURRENT_BURN_RATE_WINDOW_MINUTES;

// Minimum interval between status-change owner notifications for one SLO.
const STATUS_NOTIFICATION_MIN_INTERVAL_MINUTES: number = 60;

const DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE: number = 20;

const DEFAULT_ROLLING_WINDOW_DAYS: number = 30;

// Wall-clock budget of one sweep, mirrored by the job's own timeoutInMS.
const SWEEP_TIMEOUT_MINUTES: number = 10;

/*
 * Redis mutex that serializes the whole sweep across every worker replica.
 *
 * The per-SLO cadence columns are NOT an overlap guard: getDueSlos() snapshots
 * the entire due set up front and each SLO is only stamped once the loop
 * reaches it, so a sweep that takes longer than the one-minute schedule (a few
 * hundred SLOs is enough) still has hundreds of unstamped SLOs in flight when
 * the next tick starts — and that next tick re-selects every one of them.
 * runJobWithTimeout is a Promise.race with no cancellation, and the worker
 * concurrency defaults to 100, so the overlapping sweeps really do run the same
 * SLOs side by side: duplicate owner notifications and duplicate burn-rate
 * alerts (both dedupes are read-then-write, so they interleave).
 *
 * An affected-row count on an `updateBy` cannot be used instead:
 * DatabaseService._updateBy is a _findBy followed by a per-row
 * repository.save() and returns the SELECT count, so two interleaved sweeps
 * both see 1 and both proceed.
 *
 * The lock timeout deliberately outlives the job's own 10-minute timeout, so a
 * sweep that overruns (Promise.race does not stop the body) keeps holding the
 * lock rather than letting a second sweep in behind it. redis-semaphore's Mutex
 * auto-refreshes while it is held, so this value only bounds how long a CRASHED
 * worker's lock lingers before another replica may take over.
 */
const SWEEP_LOCK_KEY: string = "Slo:EvaluateSlos";
const SWEEP_LOCK_NAMESPACE: string = "Workers.Cron";
const SWEEP_LOCK_TIMEOUT_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(SWEEP_TIMEOUT_MINUTES + 1);

/**
 * Evaluates every due Service Level Objective:
 * - recomputes the time-based SLI and error budget over the SLO's window,
 * - persists the worker-owned state columns,
 * - writes SloHistory rows for charting,
 * - notifies owners on AtRisk / BudgetExhausted transitions,
 * - evaluates multi-window burn rate rules and raises / resolves Alerts.
 */
RunCron(
  "Slo:EvaluateSlos",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(
      SWEEP_TIMEOUT_MINUTES,
    ),
  },
  async () => {
    /*
     * acquireAttemptsLimit: 1 — never queue behind the in-flight sweep. This
     * job re-runs every minute anyway, so waiting would only stack ticks up
     * behind a slow sweep; skipping is the correct backpressure.
     */
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: SWEEP_LOCK_KEY,
        namespace: SWEEP_LOCK_NAMESPACE,
        lockTimeout: SWEEP_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    } catch (err) {
      logger.debug(
        `Slo:EvaluateSlos - Could not acquire the sweep lock; a sweep is already in flight (or Redis is unavailable). Skipping this tick: ${err}`,
      );
      return;
    }

    /*
     * Everything below runs under the lock, and the lock is released in
     * `finally` so a throw anywhere in the sweep still frees it for the next
     * tick instead of wedging the job until the lock times out.
     */
    try {
      const dueSlos: Array<ServiceLevelObjective> =
        await ServiceLevelObjectiveService.getDueSlos();

      for (const slo of dueSlos) {
        try {
          await evaluateSlo(slo);
        } catch (err) {
          // one bad SLO must never abort the whole sweep.
          logger.error(
            `Slo:EvaluateSlos - Error evaluating SLO ${slo.id?.toString()}: ${err}`,
            {
              projectId: slo.projectId?.toString(),
              sloId: slo.id?.toString(),
            } as LogAttributes,
          );
        }
      }
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        // a release failure only means the lock expires on its own timeout.
        logger.error(
          `Slo:EvaluateSlos - Error releasing the sweep lock: ${err}`,
        );
      }
    }
  },
);

interface SloEvaluationContext {
  slo: ServiceLevelObjective;
  sloId: ObjectID;
  projectId: ObjectID;
  perMonitorTimelines: Array<MonitorTimelineSet>;
  downtimeStatuses: Array<MonitorStatus>;
  multiMonitorMode: SloMultiMonitorMode;
  targetPercentage: number;
  budget: ErrorBudgetResult;
  now: Date;
  /*
   * Earliest event start across this SLO's monitors over the WHOLE fetched
   * window — i.e. how far back the burn-rate math can actually see data.
   * Computed once per evaluation (not per rule) and null when there is no data
   * at all. Burn rate rules use it to refuse to judge a long window they do not
   * have the history for.
   */
  earliestEventStart: Date | null;
  /*
   * Lazily resolved (and memoized) "is any of this SLO's monitors inside an
   * ongoing scheduled maintenance window?" — queried at most once per SLO,
   * and only when a burn rate rule actually fires.
   */
  isAnyMonitorUnderOngoingMaintenance: () => Promise<boolean>;
}

async function evaluateSlo(slo: ServiceLevelObjective): Promise<void> {
  if (!slo.id || !slo.projectId) {
    return;
  }

  const sloId: ObjectID = slo.id;
  const projectId: ObjectID = slo.projectId;
  const now: Date = OneUptimeDate.getCurrentDate();

  /*
   * Stamp the cadence columns FIRST so that even if this evaluation throws
   * below, the SLO is not retried on every one-minute tick. (Concurrency
   * between two overlapping sweeps is handled by the sweep-wide Redis mutex,
   * NOT by these columns — see SWEEP_LOCK_KEY above.)
   *
   * These two columns are pure worker bookkeeping: nothing user-facing reads
   * them and no workflow can meaningfully trigger on them, so they go through
   * the hookless fast path. `updateOneById` would fire this model's
   * @EnableWorkflow({update:true}) HTTP POST and a realtime broadcast for every
   * SLO on every tick (~400 POSTs/minute at 2,000 SLOs) purely to record when
   * the worker last looked at the row.
   */
  await ServiceLevelObjectiveService.updateColumnsByIdWithoutHooks({
    id: sloId,
    data: {
      lastEvaluatedAt: now,
      nextEvaluationAt: OneUptimeDate.addRemoveMinutes(
        now,
        EVALUATION_CADENCE_MINUTES,
      ),
    },
  });

  const monitorIds: Array<ObjectID> = (slo.monitors || [])
    .map((monitor: Monitor) => {
      return monitor.id!;
    })
    .filter((monitorId: ObjectID) => {
      return Boolean(monitorId);
    });

  /*
   * Misconfigured guard: Metric SLIs are Phase 2, and an SLO with no monitors
   * (e.g. all monitors deleted — M2M rows cascade) must never read as 100%
   * SLI. A target outside (0, 100) would NaN every budget formula, so it is
   * treated the same way (create/update hooks validate it, this is defense).
   */
  const targetPercentage: number = slo.targetPercentage || 0;

  if (
    slo.sliType !== SliType.MonitorUptime ||
    monitorIds.length === 0 ||
    targetPercentage <= 0 ||
    targetPercentage >= 100
  ) {
    await setGuardStatusAndResolveOpenAlerts({
      slo: slo,
      sloId: sloId,
      projectId: projectId,
      status: SloStatus.Misconfigured,
    });
    return;
  }

  /*
   * Paused guard: if every attached monitor is disabled (manually, because of
   * a manual incident, or because of a scheduled maintenance event — the same
   * three flags MonitorService.getEnabledMonitorQuery filters on), there is
   * no live signal: mark Paused and skip evaluation and alerts.
   */
  const monitors: Array<Monitor> = await MonitorService.findBy({
    query: {
      _id: QueryHelper.any(monitorIds),
      projectId: projectId,
    },
    select: {
      _id: true,
      disableActiveMonitoring: true,
      disableActiveMonitoringBecauseOfManualIncident: true,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
    },
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: {
      isRoot: true,
    },
  });

  if (monitors.length === 0) {
    await setGuardStatusAndResolveOpenAlerts({
      slo: slo,
      sloId: sloId,
      projectId: projectId,
      status: SloStatus.Misconfigured,
    });
    return;
  }

  const areAllMonitorsDisabled: boolean = monitors.every((monitor: Monitor) => {
    return (
      monitor.disableActiveMonitoring === true ||
      monitor.disableActiveMonitoringBecauseOfManualIncident === true ||
      monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent === true
    );
  });

  if (areAllMonitorsDisabled) {
    await setGuardStatusAndResolveOpenAlerts({
      slo: slo,
      sloId: sloId,
      projectId: projectId,
      status: SloStatus.Paused,
    });
    return;
  }

  /*
   * Compliance window.
   *
   * Rolling: SLI and budget denominator both come from the (data-age clamped)
   * elapsed window, so the budget denominator is sli.totalSeconds.
   *
   * CalendarMonth: the SLI is measured over the elapsed part of the month
   * (computeTimeSli clips the window end to "now" internally), but the budget
   * denominator is the FULL period — fixed at period start — otherwise a
   * 1-minute blip at 00:10 on the 1st reads as instant budget exhaustion.
   */
  let window: UptimeWindow;
  let budgetTotalSecondsOverride: number | null = null;

  if (slo.windowType === SloWindowType.CalendarMonth) {
    const calendarWindow: ReturnType<typeof SloUtil.getCalendarMonthWindow> =
      SloUtil.getCalendarMonthWindow({
        timezone: slo.timezone || "UTC",
        at: now,
      });

    window = {
      startDate: calendarWindow.startDate,
      endDate: calendarWindow.endDate,
    };
    budgetTotalSecondsOverride = calendarWindow.totalSecondsInFullPeriod;
  } else {
    const windowDays: number = slo.windowDays || DEFAULT_ROLLING_WINDOW_DAYS;

    window = {
      startDate: OneUptimeDate.getSomeDaysAgo(windowDays),
      endDate: now,
    };
  }

  /*
   * Enabled burn rate rules — loaded before the timeline fetch so the fetch
   * window can be extended to cover the longest rule lookback (a burn window
   * can start before a calendar month does on the 1st of the month).
   */
  const burnRateRules: Array<ServiceLevelObjectiveBurnRateRule> =
    await ServiceLevelObjectiveBurnRateRuleService.findBy({
      query: {
        serviceLevelObjectiveId: sloId,
        projectId: projectId,
        isEnabled: true,
      },
      select: {
        _id: true,
        projectId: true,
        serviceLevelObjectiveId: true,
        name: true,
        isEnabled: true,
        burnRateThreshold: true,
        longWindowInMinutes: true,
        shortWindowInMinutes: true,
        /*
         * minimumSampleCount is deliberately NOT selected: it only has
         * meaning for event-based (Metric) SLIs, which this worker does not
         * evaluate yet — every SLO it can reach is time-based, where every
         * second is a sample. The column and its server-side validation
         * stay for that later phase; selecting it here would imply a guard
         * that does not run.
         */
        refireSuppressionMinutes: true,
        alertSeverityId: true,
        onCallDutyPolicies: {
          _id: true,
        },
        lastAlertCreatedAt: true,
        lastAlertResolvedAt: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

  const longestLookbackInMinutes: number = burnRateRules.reduce(
    (longestSoFar: number, rule: ServiceLevelObjectiveBurnRateRule): number => {
      return Math.max(longestSoFar, rule.longWindowInMinutes || 0);
    },
    CURRENT_BURN_RATE_WINDOW_MINUTES,
  );

  const fetchWindowStart: Date = OneUptimeDate.getLesserDate(
    window.startDate,
    OneUptimeDate.addRemoveMinutes(now, -1 * longestLookbackInMinutes),
  );
  const fetchWindowEnd: Date = OneUptimeDate.getGreaterDate(
    window.endDate,
    now,
  );

  /*
   * One timeline fetch per SLO — every sub-window (SLI, current burn, rule
   * long/short windows) is computed from this same in-memory set.
   */
  const perMonitorTimelines: Array<MonitorTimelineSet> =
    await fetchPerMonitorTimelines({
      projectId: projectId,
      monitorIds: monitorIds,
      windowStart: fetchWindowStart,
      windowEnd: fetchWindowEnd,
    });

  const downtimeStatuses: Array<MonitorStatus> = await getDowntimeStatuses({
    projectId: projectId,
    configuredStatusIds: (slo.downtimeMonitorStatuses || [])
      .map((status: MonitorStatus) => {
        return status.id!;
      })
      .filter((statusId: ObjectID) => {
        return Boolean(statusId);
      }),
  });

  const multiMonitorMode: SloMultiMonitorMode =
    slo.multiMonitorMode || SloMultiMonitorMode.AnyDown;

  const sli: TimeSliResult = SloUtil.computeTimeSli({
    perMonitorTimelines: perMonitorTimelines,
    downtimeStatuses: downtimeStatuses,
    window: window,
    mode: multiMonitorMode,
  });

  /*
   * Zero-data guard. computeTimeSli's contract is explicit that totalSeconds
   * === 0 means "no data at all", NOT "perfect service", and that callers must
   * never treat it as a healthy 100%: without this guard an enabled SLO whose
   * monitor has not written a single MonitorStatusTimeline row yet is persisted
   * as Healthy with currentSliPercentage 100, a full error budget, and
   * sli.percent = 100 history rows — a green SLO that measures nothing.
   *
   * Misconfigured is the same signal the "no monitors" guard uses: there is no
   * usable measurement. The cadence columns were already stamped at the top of
   * this function, so the SLO is simply re-evaluated on its normal cadence and
   * self-heals into a real status on the first tick that has data.
   *
   * Benign edge: for a CalendarMonth window evaluated in the very first second
   * of a new month the elapsed window is 0 seconds long, so an SLO WITH data can
   * read as zero-data for a single tick and flip back on the next one.
   */
  if (sli.totalSeconds === 0) {
    logger.debug(
      `Slo:EvaluateSlos - SLO ${sloId.toString()} has no timeline data in its window; marking Misconfigured instead of a healthy 100% SLI.`,
      {
        projectId: projectId.toString(),
        sloId: sloId.toString(),
      } as LogAttributes,
    );

    await setGuardStatusAndResolveOpenAlerts({
      slo: slo,
      sloId: sloId,
      projectId: projectId,
      status: SloStatus.Misconfigured,
    });
    return;
  }

  const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
    badSeconds: sli.badSeconds,
    totalSeconds:
      budgetTotalSecondsOverride !== null
        ? budgetTotalSecondsOverride
        : sli.totalSeconds,
    targetPercentage: targetPercentage,
  });

  const currentBurnRate: number = computeBurnRateForLookback({
    perMonitorTimelines: perMonitorTimelines,
    downtimeStatuses: downtimeStatuses,
    mode: multiMonitorMode,
    targetPercentage: targetPercentage,
    lookbackInMinutes: CURRENT_BURN_RATE_WINDOW_MINUTES,
    now: now,
  });

  /*
   * Status with hysteresis. Misconfigured / Paused are set by the guards
   * above, never by the math — treat them as Healthy on re-entry so the SLO
   * classifies purely from the remaining budget.
   */
  const previousStatus: SloStatus = slo.sloStatus || SloStatus.Healthy;

  const hysteresisInputStatus: SloStatus =
    previousStatus === SloStatus.Misconfigured ||
    previousStatus === SloStatus.Paused
      ? SloStatus.Healthy
      : previousStatus;

  const newStatus: SloStatus = SloUtil.computeSloStatus({
    budgetRemainingPercentage: budget.budgetRemainingPercentage,
    currentStatus: hysteresisInputStatus,
    atRiskThresholdPercentage:
      slo.atRiskThresholdPercentage ?? DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  });

  /*
   * Owner notification on a transition INTO AtRisk / BudgetExhausted, rate
   * limited so a rolling window re-crossing a boundary as bad seconds age
   * out does not spam owners.
   *
   * The rate limit must NEVER swallow an escalation into BudgetExhausted.
   * Healthy -> AtRisk notifies and stamps the timer; if the budget then hits 0
   * ten minutes later, the BudgetExhausted transition would be suppressed —
   * and because sloStatus is still persisted as BudgetExhausted, every later
   * tick sees no transition at all, so the notification is never retried. The
   * single most severe event in the system would be dropped permanently. An
   * escalation into BudgetExhausted therefore ignores the interval (it can
   * happen at most once per entry into the state, so it cannot spam).
   */
  const isEscalationToExhausted: boolean =
    newStatus === SloStatus.BudgetExhausted &&
    previousStatus !== SloStatus.BudgetExhausted;

  const isNotificationRateLimitCleared: boolean =
    !slo.statusChangeNotificationSentAt ||
    OneUptimeDate.getDifferenceInMinutes(
      now,
      slo.statusChangeNotificationSentAt,
    ) >= STATUS_NOTIFICATION_MIN_INTERVAL_MINUTES;

  const shouldNotifyOwners: boolean =
    newStatus !== previousStatus &&
    (newStatus === SloStatus.AtRisk ||
      newStatus === SloStatus.BudgetExhausted) &&
    (isEscalationToExhausted || isNotificationRateLimitCleared);

  /*
   * statusChangeNotificationSentAt is deliberately NOT part of this update: it
   * records that owners WERE notified, so it is stamped only after the send
   * actually dispatched something (see below). Stamping it up-front means a
   * failed send silences the next 60 minutes of notifications.
   *
   * INTEGER COLUMNS. errorBudgetRemainingSeconds / errorBudgetTotalSeconds are
   * ColumnType.Number === Postgres `integer`, and the budget seconds are almost
   * never integral: `1 - 99.9/100` is 0.0009999999999998899 in IEEE-754, so a
   * 30-day 99.9% SLO computes a total budget of 2591.9999999997144 seconds and
   * Postgres rejects the whole UPDATE with
   * `invalid input syntax for type integer`. That throw is swallowed by the
   * per-SLO try/catch in the sweep, so it silently took out EVERYTHING
   * downstream of this write — state columns, history rows (empty charts
   * forever), owner notifications and every burn-rate rule — leaving the
   * feature inert with one error log per SLO per minute.
   *
   * Whole seconds is the right resolution for these two display columns, and
   * Math.round keeps the sign of a negative (over-budget) remainder. Only the
   * values persisted here are rounded: the status/threshold decisions above,
   * the history rows and the notification/alert bodies below all keep the full
   * precision of the budget result.
   */
  const stateUpdate: {
    currentSliPercentage: number;
    errorBudgetRemainingPercentage: number;
    errorBudgetRemainingSeconds: number;
    errorBudgetTotalSeconds: number;
    currentBurnRate: number;
    sloStatus: SloStatus;
  } = {
    // Decimal columns — persisted unrounded.
    currentSliPercentage: sli.sliPercentage,
    errorBudgetRemainingPercentage: budget.budgetRemainingPercentage,
    currentBurnRate: currentBurnRate,
    // Integer columns — must be whole numbers.
    errorBudgetRemainingSeconds: Math.round(budget.budgetRemainingSeconds), // signed.
    errorBudgetTotalSeconds: Math.round(budget.budgetTotalSeconds),
    sloStatus: newStatus,
  };

  /*
   * This one write stays on the HOOKED path on purpose. Unlike the cadence and
   * notification stamps it carries user-facing state — above all the sloStatus
   * transition, the one event in this job with real semantic meaning, which
   * customer workflows subscribe to — and the model's
   * enableRealtimeEventsOn.update is what refreshes an open SLO page with the
   * new SLI / budget numbers. Routing it hookless would silently break both.
   * Dropping the other two writes already takes this job from 2-3 hooked
   * updates per evaluation down to exactly one.
   */
  await ServiceLevelObjectiveService.updateOneById({
    id: sloId,
    data: stateUpdate,
    props: {
      isRoot: true,
    },
  });

  // History rows (unrounded values, minute-floored bucket). Non-fatal.
  try {
    const bucketStart: Date = new Date(
      Math.floor(now.getTime() / 60000) * 60000,
    );

    const historyRows: Array<SloHistoryRow> = [
      {
        projectId: projectId,
        sloId: sloId,
        metricName: "sli.percent",
        bucketStart: bucketStart,
        value: sli.sliPercentage,
      },
      {
        projectId: projectId,
        sloId: sloId,
        metricName: "error.budget.remaining.percent",
        bucketStart: bucketStart,
        value: budget.budgetRemainingPercentage,
      },
      {
        projectId: projectId,
        sloId: sloId,
        metricName: "burn.rate",
        bucketStart: bucketStart,
        value: currentBurnRate,
      },
    ];

    await SloHistoryService.insertHistoryRows(historyRows);
  } catch (err) {
    logger.error(
      `Slo:EvaluateSlos - Error writing history rows for SLO ${sloId.toString()}: ${err}`,
      {
        projectId: projectId.toString(),
        sloId: sloId.toString(),
      } as LogAttributes,
    );
  }

  if (shouldNotifyOwners) {
    const wasNotificationSent: boolean = await sendStatusChangeNotification({
      slo: slo,
      newStatus: newStatus,
      sli: sli,
      budget: budget,
      targetPercentage: targetPercentage,
    });

    /*
     * Stamp the rate-limit timer only on a send that actually dispatched at
     * least one owner notification. On failure the timer stays where it was, so
     * the next transition is free to notify instead of being silenced for an
     * hour by a notification nobody received.
     *
     * Hookless: this column is the worker's own rate-limit bookkeeping. The
     * notification it records has already gone out through the notification
     * pipeline, and the status change it belongs to was already broadcast by the
     * hooked state write above — a second workflow POST and realtime event for
     * the timestamp would be pure duplication.
     */
    if (wasNotificationSent) {
      await ServiceLevelObjectiveService.updateColumnsByIdWithoutHooks({
        id: sloId,
        data: {
          statusChangeNotificationSentAt: now,
        },
      });
    }
  }

  // Burn rate rules.
  let maintenanceCheckPromise: Promise<boolean> | null = null;

  /*
   * Data age of this SLO, computed ONCE for all rules over the full fetched
   * window (which already covers the longest rule lookback). Each rule then
   * compares it against its own long window.
   */
  const earliestEventStart: Date | null = SloUtil.getEarliestEventStartDate(
    perMonitorTimelines,
    {
      startDate: fetchWindowStart,
      endDate: fetchWindowEnd,
    },
  );

  const context: SloEvaluationContext = {
    slo: slo,
    sloId: sloId,
    projectId: projectId,
    perMonitorTimelines: perMonitorTimelines,
    downtimeStatuses: downtimeStatuses,
    multiMonitorMode: multiMonitorMode,
    targetPercentage: targetPercentage,
    budget: budget,
    now: now,
    earliestEventStart: earliestEventStart,
    isAnyMonitorUnderOngoingMaintenance: (): Promise<boolean> => {
      if (!maintenanceCheckPromise) {
        maintenanceCheckPromise = isAnySloMonitorUnderOngoingMaintenance({
          projectId: projectId,
          monitorIds: monitorIds,
        });
      }
      return maintenanceCheckPromise;
    },
  };

  for (const rule of burnRateRules) {
    try {
      await evaluateBurnRateRule({
        context: context,
        rule: rule,
      });
    } catch (err) {
      logger.error(
        `Slo:EvaluateSlos - Error evaluating burn rate rule ${rule.id?.toString()} for SLO ${sloId.toString()}: ${err}`,
        {
          projectId: projectId.toString(),
          sloId: sloId.toString(),
        } as LogAttributes,
      );
    }
  }
}

/*
 * Commits sloStatus, and only when it actually changed — used by the
 * Misconfigured / Paused guards, which skip evaluation entirely.
 *
 * Stays on the HOOKED update path: a status transition is exactly the event
 * customer workflows and the realtime dashboard care about.
 */
async function setSloStatusIfChanged(
  slo: ServiceLevelObjective,
  newStatus: SloStatus,
): Promise<void> {
  if (slo.sloStatus === newStatus) {
    return;
  }

  await ServiceLevelObjectiveService.updateOneById({
    id: slo.id!,
    data: {
      sloStatus: newStatus,
    },
    props: {
      isRoot: true,
    },
  });

  // keep the in-memory copy consistent for the rest of this evaluation.
  slo.sloStatus = newStatus;
}

/*
 * Guard exit path (Paused / Misconfigured): set the status and, ON THE
 * TRANSITION ONLY, resolve every open burn-rate alert of this SLO.
 *
 * Why: the guards return before the burn-rate rule loop, so an alert that is
 * already open (possibly with an on-call escalation attached) would otherwise
 * never be resolved while the SLO sits Paused/Misconfigured — the rule loop
 * that owns resolution is simply not reached. Resolving here is safe because
 * no NEW burn-rate alert can be created while the SLO is in one of these
 * states, and doing it only on the transition keeps it from re-resolving the
 * same alerts every tick.
 *
 * lastAlertResolvedAt is deliberately NOT stamped: that column drives the
 * re-fire suppression window of a live rule, and this is a state change of the
 * SLO, not a burn rate that recovered.
 *
 * ORDER MATTERS: resolve FIRST, commit the status LAST. The status write is what
 * makes this a one-shot ("only on the transition"), so committing it before the
 * resolve turns any resolve failure into a permanent one — the next tick sees no
 * transition, returns early, and never retries, stranding the alert and its
 * on-call escalation forever. resolveOpenBurnRateAlertsForSlo loads its rules
 * with a findBy that is not internally guarded, so this is not hypothetical.
 * Resolving first means a failure simply leaves the status where it was and the
 * next tick tries the whole thing again; the resolve itself is idempotent, so
 * the retry is harmless, and the status guard still keeps it to once per
 * transition in the happy path.
 */
async function setGuardStatusAndResolveOpenAlerts(data: {
  slo: ServiceLevelObjective;
  sloId: ObjectID;
  projectId: ObjectID;
  status: SloStatus;
}): Promise<void> {
  if (data.slo.sloStatus === data.status) {
    // already committed: this transition was handled by an earlier tick.
    return;
  }

  /*
   * resolveOpenBurnRateAlertsForSlo takes no rootCause override (it applies its
   * own "SLO was disabled or deleted" default) — left untouched on purpose, the
   * service is shared with the SLO lifecycle hooks.
   */
  await ServiceLevelObjectiveService.resolveOpenBurnRateAlertsForSlo({
    sloId: data.sloId,
    projectId: data.projectId,
  });

  await setSloStatusIfChanged(data.slo, data.status);
}

/*
 * Timeline overlap fetch, one query per monitor (SloUtil combines monitors
 * with explicit semantics — never feed it a merged multi-monitor array).
 * The overlap predicate is the StatusPageService contract: a row overlaps
 * [start, end] when it started on or before the window end AND it either
 * ended on or after the window start or is still open (endsAt IS NULL).
 * findAllBy pages internally past the 10k LIMIT_MAX for long windows.
 */
async function fetchPerMonitorTimelines(data: {
  projectId: ObjectID;
  monitorIds: Array<ObjectID>;
  windowStart: Date;
  windowEnd: Date;
}): Promise<Array<MonitorTimelineSet>> {
  const perMonitorTimelines: Array<MonitorTimelineSet> = [];

  for (const monitorId of data.monitorIds) {
    const timelines: Array<MonitorStatusTimeline> =
      await MonitorStatusTimelineService.findAllBy({
        query: {
          monitorId: monitorId,
          projectId: data.projectId,
          startsAt: QueryHelper.lessThanEqualTo(data.windowEnd),
          endsAt: QueryHelper.greaterThanEqualToOrNull(data.windowStart),
        },
        select: {
          _id: true,
          startsAt: true,
          endsAt: true,
          monitorId: true,
          monitorStatusId: true,
          monitorStatus: {
            _id: true,
            priority: true,
            name: true,
            color: true,
            isOperationalState: true,
          },
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    perMonitorTimelines.push({
      monitorId: monitorId,
      timelines: timelines,
    });
  }

  return perMonitorTimelines;
}

/*
 * Full MonitorStatus rows for the SLO's configured downtime statuses.
 * When the SLO has none configured, fall back to every non-operational
 * status of the project (the StatusPage default).
 */
async function getDowntimeStatuses(data: {
  projectId: ObjectID;
  configuredStatusIds: Array<ObjectID>;
}): Promise<Array<MonitorStatus>> {
  if (data.configuredStatusIds.length > 0) {
    return await MonitorStatusService.findBy({
      query: {
        _id: QueryHelper.any(data.configuredStatusIds),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
        color: true,
        priority: true,
        isOperationalState: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });
  }

  const allStatuses: Array<MonitorStatus> = await MonitorStatusService.findBy({
    query: {
      projectId: data.projectId,
    },
    select: {
      _id: true,
      name: true,
      color: true,
      priority: true,
      isOperationalState: true,
    },
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: {
      isRoot: true,
    },
  });

  return allStatuses.filter((status: MonitorStatus) => {
    return !status.isOperationalState;
  });
}

/*
 * Burn rate over the trailing lookback window, computed from the already
 * fetched timelines. No data in the lookback => burn 0 (computeBurnRate's
 * contract) — no evidence of burn.
 *
 * CAVEAT: computeTimeSli clamps its denominator forward to the first observed
 * event, so on an SLO younger than `lookbackInMinutes` this measures the data
 * age, not the requested window, and reads high. Alerting callers must gate on
 * having a full window of history first (see the gate in evaluateBurnRateRule).
 * The currentBurnRate state column accepts that caveat: it is a display value,
 * it never pages, and reading the observed burn of a young SLO is what the
 * overview is supposed to show.
 */
function computeBurnRateForLookback(data: {
  perMonitorTimelines: Array<MonitorTimelineSet>;
  downtimeStatuses: Array<MonitorStatus>;
  mode: SloMultiMonitorMode;
  targetPercentage: number;
  lookbackInMinutes: number;
  now: Date;
}): number {
  const lookbackWindow: UptimeWindow = {
    startDate: OneUptimeDate.addRemoveMinutes(
      data.now,
      -1 * data.lookbackInMinutes,
    ),
    endDate: data.now,
  };

  const sli: TimeSliResult = SloUtil.computeTimeSli({
    perMonitorTimelines: data.perMonitorTimelines,
    downtimeStatuses: data.downtimeStatuses,
    window: lookbackWindow,
    mode: data.mode,
  });

  return SloUtil.computeBurnRate({
    badSeconds: sli.badSeconds,
    totalSeconds: sli.totalSeconds,
    targetPercentage: data.targetPercentage,
  });
}

/*
 * Simplified form of MonitorAlert's scheduled-maintenance suppression: the
 * SLO alerting layer suppresses burn-rate alert CREATION while any attached
 * monitor is attached to an ongoing ScheduledMaintenance (same
 * currentScheduledMaintenanceState.isOngoingState query
 * MonitorMaintenanceSuppression uses, intersected against the SLO's monitors
 * instead of series labels). Existing open alerts still resolve normally.
 */
async function isAnySloMonitorUnderOngoingMaintenance(data: {
  projectId: ObjectID;
  monitorIds: Array<ObjectID>;
}): Promise<boolean> {
  const ongoingEvents: Array<ScheduledMaintenance> =
    await ScheduledMaintenanceService.findBy({
      query: {
        projectId: data.projectId,
        currentScheduledMaintenanceState: {
          isOngoingState: true,
        },
      },
      select: {
        _id: true,
        monitors: {
          _id: true,
        },
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

  if (ongoingEvents.length === 0) {
    return false;
  }

  const sloMonitorIds: Set<string> = new Set<string>(
    data.monitorIds.map((monitorId: ObjectID) => {
      return monitorId.toString();
    }),
  );

  for (const event of ongoingEvents) {
    for (const monitor of event.monitors || []) {
      if (monitor.id && sloMonitorIds.has(monitor.id.toString())) {
        return true;
      }
    }
  }

  return false;
}

async function evaluateBurnRateRule(data: {
  context: SloEvaluationContext;
  rule: ServiceLevelObjectiveBurnRateRule;
}): Promise<void> {
  const { context, rule } = data;

  if (
    !rule.id ||
    !rule.burnRateThreshold ||
    rule.burnRateThreshold <= 0 ||
    !rule.longWindowInMinutes ||
    !rule.shortWindowInMinutes
  ) {
    return;
  }

  const threshold: number = rule.burnRateThreshold;

  /*
   * Full-long-window gate — it gates FIRING ONLY.
   *
   * computeTimeSli clamps its denominator forward to the earliest observed event
   * (AnyDown directly; MonitorSecondsAverage through
   * UptimeUtil.getTotalDowntimeInSeconds). That is correct for a compliance
   * window, but inside a FIXED-LENGTH burn window it silently turns the
   * denominator into the DATA AGE: a monitor whose first event is 5 minutes old
   * with 20 seconds of downtime computes 66.7x over a "60-minute" long window
   * instead of 5.6x. Both windows then measure the same few minutes, both
   * breach, and the multi-window rule — whose whole purpose is to require
   * SUSTAINED evidence before paging — pages on seconds of data. Every freshly
   * created SLO + monitor pair would page on its first blip.
   *
   * So a rule may only FIRE once the SLO has at least a full long window of
   * history. RESOLUTION, though, is the one decision that is safe without a
   * fresh long-window measurement, and gating it too was its own bug: a rule
   * that can no longer justify a page must not keep one open. Swap an SLO's
   * monitor for a 10-minute-old one while its "slow burn" (360-minute) rule is
   * firing and every subsequent tick used to return here — leaving the alert and
   * its on-call escalation open forever, with nothing in the product able to
   * close it. So when the window is short we skip the firing decision (and the
   * long-window hold state, which is equally unmeasurable) and fall through to
   * the resolution branch below.
   */
  const longWindowStart: Date = OneUptimeDate.addRemoveMinutes(
    context.now,
    -1 * rule.longWindowInMinutes,
  );

  const hasFullLongWindow: boolean = Boolean(
    context.earliestEventStart &&
      context.earliestEventStart.getTime() <= longWindowStart.getTime(),
  );

  if (hasFullLongWindow) {
    const burnRateLong: number = computeBurnRateForLookback({
      perMonitorTimelines: context.perMonitorTimelines,
      downtimeStatuses: context.downtimeStatuses,
      mode: context.multiMonitorMode,
      targetPercentage: context.targetPercentage,
      lookbackInMinutes: rule.longWindowInMinutes,
      now: context.now,
    });

    const burnRateShort: number = computeBurnRateForLookback({
      perMonitorTimelines: context.perMonitorTimelines,
      downtimeStatuses: context.downtimeStatuses,
      mode: context.multiMonitorMode,
      targetPercentage: context.targetPercentage,
      lookbackInMinutes: rule.shortWindowInMinutes,
      now: context.now,
    });

    // Multi-window firing: both windows must breach (Google SRE Workbook).
    const isFiring: boolean =
      burnRateLong >= threshold && burnRateShort >= threshold;

    if (isFiring) {
      await fireBurnRateAlert({
        context: context,
        rule: rule,
        burnRateLong: burnRateLong,
        burnRateShort: burnRateShort,
      });
      return;
    }

    /*
     * Resolve ONLY when the long window drops below the threshold — resolving
     * on the short window guarantees paging flap on recurring outages (fires,
     * recovers 5 minutes, refires all night). A long-window breach with a
     * recovered short window is neither firing nor resolved: hold state.
     */
    if (burnRateLong >= threshold) {
      return;
    }
  } else {
    logger.debug(
      `Slo:EvaluateSlos - Not firing burn rate rule ${rule.id.toString()} for SLO ${context.sloId.toString()}: not enough history to evaluate a ${rule.longWindowInMinutes}-minute burn window (earliest observed data: ${context.earliestEventStart?.toISOString() || "none"}). An already-open alert for this rule is still resolved.`,
      {
        projectId: context.projectId.toString(),
        sloId: context.sloId.toString(),
      } as LogAttributes,
    );
  }

  /*
   * Resolution branch. Reached either because the long window is measurable and
   * has recovered, or because it is no longer measurable at all — in both cases
   * nothing here can justify keeping a page open.
   */
  const hasUnresolvedFiringState: boolean = isBurnRateRuleFiring(rule);

  if (!hasUnresolvedFiringState) {
    return;
  }

  await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
    serviceLevelObjectiveId: context.sloId,
    burnRateRuleId: rule.id,
    projectId: context.projectId,
    rootCause: hasFullLongWindow
      ? "Burn rate dropped below threshold."
      : `The SLO no longer has ${rule.longWindowInMinutes} minutes of monitoring history, so this burn rate rule can no longer justify an open alert.`,
  });

  await ServiceLevelObjectiveBurnRateRuleService.updateOneById({
    id: rule.id,
    data: {
      lastAlertResolvedAt: context.now,
    },
    props: {
      isRoot: true,
    },
  });
}

async function fireBurnRateAlert(data: {
  context: SloEvaluationContext;
  rule: ServiceLevelObjectiveBurnRateRule;
  burnRateLong: number;
  burnRateShort: number;
}): Promise<void> {
  const { context, rule } = data;

  const logAttributes: LogAttributes = {
    projectId: context.projectId.toString(),
    sloId: context.sloId.toString(),
  };

  // (a) scheduled-maintenance suppression — creation only.
  if (await context.isAnyMonitorUnderOngoingMaintenance()) {
    logger.debug(
      `Slo:EvaluateSlos - Skipping burn rate alert for rule ${rule.id?.toString()}: a monitor of this SLO is under an active scheduled maintenance window.`,
      logAttributes,
    );
    return;
  }

  // (b) re-fire suppression after a recent resolve.
  const refireSuppressionMinutes: number =
    rule.refireSuppressionMinutes ?? rule.longWindowInMinutes!;

  if (
    rule.lastAlertResolvedAt &&
    OneUptimeDate.getDifferenceInMinutes(
      context.now,
      rule.lastAlertResolvedAt,
    ) < refireSuppressionMinutes
  ) {
    logger.debug(
      `Slo:EvaluateSlos - Skipping burn rate alert for rule ${rule.id?.toString()}: within the re-fire suppression window after the last resolve.`,
      logAttributes,
    );
    return;
  }

  // (c) dedupe against an already open alert for this rule.
  const fingerprint: string =
    ServiceLevelObjectiveBurnRateRuleService.getBurnRateAlertFingerprint({
      serviceLevelObjectiveId: context.sloId,
      burnRateRuleId: rule.id!,
    });

  const openAlert: Alert | null = await AlertService.findOneBy({
    query: {
      projectId: context.projectId,
      seriesFingerprint: fingerprint,
      currentAlertState: {
        isResolvedState: false,
      },
    },
    select: {
      _id: true,
    },
    props: {
      isRoot: true,
    },
  });

  if (openAlert) {
    return;
  }

  if (DisableAutomaticAlertCreation) {
    logger.debug(
      `Slo:EvaluateSlos - Skipping burn rate alert for rule ${rule.id?.toString()}: automatic alert creation is disabled by environment configuration.`,
      logAttributes,
    );
    return;
  }

  /*
   * Severity: the rule's configured severity, falling back to the project's
   * lowest-order (most severe) severity — the MonitorAlert fallback.
   */
  let alertSeverityId: ObjectID | undefined = rule.alertSeverityId;

  if (!alertSeverityId) {
    const severity: AlertSeverity | null = await AlertSeverityService.findOneBy(
      {
        query: {
          projectId: context.projectId,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      },
    );

    alertSeverityId = severity?.id || undefined;
  }

  if (!alertSeverityId) {
    logger.error(
      `Slo:EvaluateSlos - Cannot create burn rate alert for rule ${rule.id?.toString()}: project has no alert severity.`,
      logAttributes,
    );
    return;
  }

  const budgetRemainingMinutes: number = roundToTwoDecimals(
    context.budget.budgetRemainingSeconds / 60,
  );

  const description: string = `SLO "${context.slo.name}" is burning its error budget too fast. Rule "${rule.name}": burn rate over the last ${rule.longWindowInMinutes} minutes is ${roundToTwoDecimals(data.burnRateLong)}x and over the last ${rule.shortWindowInMinutes} minutes is ${roundToTwoDecimals(data.burnRateShort)}x — both at or above the threshold of ${roundToTwoDecimals(rule.burnRateThreshold!)}x. Error budget remaining: ${roundToTwoDecimals(context.budget.budgetRemainingPercentage)}% (${budgetRemainingMinutes} minutes).`;

  const alert: Alert = new Alert();
  alert.projectId = context.projectId;
  alert.title = `SLO burn rate: ${context.slo.name} — ${rule.name}`;
  alert.description = description;
  alert.rootCause = `Error budget burn rate breached the "${rule.name}" rule of SLO "${context.slo.name}".`;
  alert.alertSeverityId = alertSeverityId;
  alert.seriesFingerprint = fingerprint;
  alert.isCreatedAutomatically = true;

  // On-call policy id-stubs, the MonitorAlert pattern.
  alert.onCallDutyPolicies = (rule.onCallDutyPolicies || [])
    .filter((policy: OnCallDutyPolicy) => {
      return Boolean(policy.id);
    })
    .map((policy: OnCallDutyPolicy) => {
      const policyStub: OnCallDutyPolicy = new OnCallDutyPolicy();
      policyStub._id = policy.id!.toString();
      return policyStub;
    });

  await AlertService.create({
    data: alert,
    props: {
      isRoot: true,
    },
  });

  await ServiceLevelObjectiveBurnRateRuleService.updateOneById({
    id: rule.id!,
    data: {
      lastAlertCreatedAt: context.now,
    },
    props: {
      isRoot: true,
    },
  });
}

/*
 * Owner notification on a transition into AtRisk / BudgetExhausted. Clones
 * the CheckSlaBreaches multi-channel envelope. WhatsApp: there is no
 * registered SLO WhatsApp template (createWhatsAppMessageFromTemplate would
 * throw for this event type), so a plain-body payload is sent instead — the
 * send path only attaches templateKey when present.
 *
 * Returns TRUE when at least one owner notification was dispatched without
 * throwing. Errors are still swallowed (a failed notification must never abort
 * the evaluation), but the caller needs to know whether anything got out before
 * it stamps the rate-limit timer.
 */
async function sendStatusChangeNotification(data: {
  slo: ServiceLevelObjective;
  newStatus: SloStatus;
  sli: TimeSliResult;
  budget: ErrorBudgetResult;
  targetPercentage: number;
}): Promise<boolean> {
  const { slo, newStatus, sli, budget } = data;

  if (!slo.id || !slo.projectId) {
    return false;
  }

  let didDispatchAnyNotification: boolean = false;

  try {
    let owners: Array<User> = await ServiceLevelObjectiveService.findOwners(
      slo.id,
    );

    if (owners.length === 0) {
      owners = await ProjectService.getOwners(slo.projectId);
    }

    if (owners.length === 0) {
      return false;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: slo.projectId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    const projectName: string = project?.name || "OneUptime";
    const sloName: string = slo.name || "SLO";

    const sloViewLink: string = (
      await ServiceLevelObjectiveService.getSloLinkInDashboard(
        slo.projectId,
        slo.id,
      )
    ).toString();

    const subject: string = `[SLO ${newStatus}] ${sloName}`;

    const currentSliPercentage: number = roundToTwoDecimals(sli.sliPercentage);
    const errorBudgetRemainingPercentage: number = roundToTwoDecimals(
      budget.budgetRemainingPercentage,
    );
    const errorBudgetRemainingMinutes: number = roundToTwoDecimals(
      budget.budgetRemainingSeconds / 60,
    );

    // Bare numbers — the email template appends the % sign itself.
    const vars: Dictionary<string> = {
      sloName: sloName,
      projectName: projectName,
      sloStatus: newStatus,
      targetPercentage: String(roundToTwoDecimals(data.targetPercentage)),
      currentSliPercentage: String(currentSliPercentage),
      errorBudgetRemainingPercentage: String(errorBudgetRemainingPercentage),
      errorBudgetRemainingMinutes: String(errorBudgetRemainingMinutes),
      sloViewLink: sloViewLink,
    };

    const eventType: NotificationSettingEventType =
      NotificationSettingEventType.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION;

    for (const user of owners) {
      if (!user.id) {
        continue;
      }

      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.SloOwnerStatusChanged,
        vars: {
          ...vars,
          subject: subject,
        },
        subject: subject,
      };

      const sms: SMSMessage = {
        message: `SLO ${newStatus}: "${sloName}" in ${projectName}. Error budget remaining: ${errorBudgetRemainingPercentage}% (${errorBudgetRemainingMinutes} minutes). View: ${sloViewLink}`,
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is an alert from OneUptime. The service level objective ${sloName} is now ${newStatus}. Error budget remaining is ${errorBudgetRemainingPercentage} percent. Please check the OneUptime Dashboard.`,
          },
        ],
      };

      /*
       * Built through PushNotificationUtil rather than as a bare literal so
       * the notification carries a clickAction: a push that names a burning
       * error budget but cannot be tapped through to the SLO makes the
       * recipient go hunting for it. Mirrors SloOwners/SendOwnerAddedNotification.
       */
      const pushMessage: PushNotificationMessage =
        PushNotificationUtil.createGenericNotification({
          title: `SLO ${newStatus}`,
          body: `SLO "${sloName}" is now ${newStatus}. Error budget remaining: ${errorBudgetRemainingPercentage}%. Click to view details.`,
          clickAction: sloViewLink,
          tag: "slo-status-changed",
          requireInteraction: false,
        });

      const whatsAppMessage: WhatsAppMessagePayload = {
        body: sms.message,
      };

      /*
       * Per-owner isolation: one owner with a broken notification setting must
       * not cost the remaining owners their notification, and only an owner that
       * was actually reached counts towards "the notification was sent".
       */
      try {
        await UserNotificationSettingService.ensureSettingExistsForUser({
          userId: user.id,
          projectId: slo.projectId,
          eventType: eventType,
        });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id,
          projectId: slo.projectId,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage: whatsAppMessage,
          eventType: eventType,
        });

        didDispatchAnyNotification = true;
      } catch (err) {
        logger.error(
          `Slo:EvaluateSlos - Error notifying owner ${user.id.toString()} of SLO ${slo.id.toString()} status change: ${err}`,
          {
            projectId: slo.projectId.toString(),
            sloId: slo.id.toString(),
          } as LogAttributes,
        );
      }
    }

    if (didDispatchAnyNotification) {
      logger.info(
        `Slo:EvaluateSlos - Sent SLO status change notification for SLO ${slo.id.toString()} (now ${newStatus}).`,
        {
          projectId: slo.projectId.toString(),
          sloId: slo.id.toString(),
        } as LogAttributes,
      );
    }
  } catch (err) {
    logger.error(
      `Slo:EvaluateSlos - Error sending status change notification for SLO ${slo.id?.toString()}: ${err}`,
      {
        projectId: slo.projectId?.toString(),
        sloId: slo.id?.toString(),
      } as LogAttributes,
    );
  }

  return didDispatchAnyNotification;
}

/*
 * Display-only rounding for alert descriptions and notification bodies.
 * State columns and history rows are always persisted unrounded.
 */
function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
