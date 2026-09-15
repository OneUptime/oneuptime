import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import { ServiceLevelObjectiveFeedEventType } from "Common/Models/DatabaseModels/ServiceLevelObjectiveFeed";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green500, Red500 } from "Common/Types/BrandColors";
import ColumnLength from "Common/Types/Database/ColumnLength";
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
import {
  DisableAutomaticAlertCreation,
  DisableAutomaticIncidentCreation,
} from "Common/Server/EnvironmentConfig";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import AlertService from "Common/Server/Services/AlertService";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import AlertOwnerTeamService from "Common/Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "Common/Server/Services/AlertOwnerUserService";
import IncidentOwnerTeamService from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "Common/Server/Services/IncidentOwnerUserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "Common/Server/Utils/Rules/OwnerRuleAssignment";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ServiceLevelObjectiveBurnRateRuleService from "Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveFeedService from "Common/Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import SloHistoryService, {
  SloHistoryRow,
} from "Common/Server/Services/SloHistoryService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import SloMetricUtil from "Common/Server/Utils/Slo/SloMetricUtil";
import SloMetricType from "Common/Types/ServiceLevelObjective/SloMetricType";
import SloMetricTypeUtil from "Common/Utils/Slo/SloMetricType";
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
import {
  isBurnRateRuleAlertFiring,
  isBurnRateRuleIncidentFiring,
} from "Common/Utils/Slo/SloBurnRateRuleState";
import {
  DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
  SloBurnRateTemplateVariable,
  SloBurnRateTemplateVariables,
  buildSloBurnRateTemplateVariables,
  renderSloBurnRateTemplate,
} from "Common/Utils/Slo/SloBurnRateTemplate";
import { escapeMarkdownInline } from "Common/Utils/Markdown/MarkdownEscape";
import {
  SloFeedMarkdown,
  SloFeedStatusMeasurement,
  getSloStatusChangedFeedMarkdown,
} from "Common/Utils/Slo/SloFeedMarkdown";
import { getSloStatusColor } from "Common/Utils/Slo/SloStatusColor";

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
  /*
   * The SLI and status this evaluation just persisted. Carried here (rather
   * than read back off `slo`, which still holds the previous tick's values)
   * so burn rate alert and incident templates describe the same numbers the
   * SLO page now shows.
   */
  currentSliPercentage: number;
  sloStatus: SloStatus;
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
  /*
   * The evaluation's memoized "is this SLO still enabled and unarchived right
   * now?". By the time a burn rate rule runs it has already been read once,
   * right before the state write, so firing reuses that answer rather than
   * reading again. See isSloStillEvaluated.
   */
  isSloStillEvaluated: SloStillEvaluatedCheckFunction;
}

type SloStillEvaluatedCheckFunction = () => Promise<boolean>;

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

  /*
   * "Is this SLO still enabled and unarchived?" - read from the database at
   * most once per evaluation, and only right before this evaluation would
   * first write something that describes the SLO (see isSloStillEvaluated).
   * Every gate below shares this one memoized read, burn rate firing included,
   * so they can never disagree about the answer.
   *
   * The cadence stamp above deliberately stays ungated: it is the worker's own
   * bookkeeping, and a disabled or archived SLO is out of getDueSlos anyway.
   */
  let stillEvaluatedCheckPromise: Promise<boolean> | null = null;

  const checkSloStillEvaluated: SloStillEvaluatedCheckFunction =
    (): Promise<boolean> => {
      if (!stillEvaluatedCheckPromise) {
        stillEvaluatedCheckPromise = isSloStillEvaluated({
          sloId: sloId,
        });
      }

      return stillEvaluatedCheckPromise;
    };

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
      now: now,
      isSloStillEvaluated: checkSloStillEvaluated,
      reason: getMisconfiguredGuardReason({
        sliType: slo.sliType,
        monitorCount: monitorIds.length,
      }),
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
      now: now,
      isSloStillEvaluated: checkSloStillEvaluated,
      reason: "None of the monitors attached to this SLO exist any more.",
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
      now: now,
      isSloStillEvaluated: checkSloStillEvaluated,
      reason:
        "Every monitor attached to this SLO is disabled - by hand, by a manual incident or by a scheduled maintenance event - so there is no live signal to measure.",
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
        shouldCreateAlert: true,
        shouldCreateIncident: true,
        alertSeverityId: true,
        onCallDutyPolicies: {
          _id: true,
        },
        /*
         * The alert and incident options. Every one of these is read with its
         * column default in mind (`!== false` for the auto-resolve pair,
         * `=== true` for the private flags and addSloOwnersAsOwners), so a
         * column missing here would not throw - it would silently configure
         * every alert with the default instead of what the user chose. The
         * many-to-many lists only need ids: they become id-stubs and owner
         * ids, never loaded entities.
         */
        alertTitleTemplate: true,
        alertDescriptionTemplate: true,
        alertRemediationNotes: true,
        isAlertPrivate: true,
        autoResolveAlert: true,
        alertLabels: {
          _id: true,
        },
        alertOwnerTeams: {
          _id: true,
        },
        alertOwnerUsers: {
          _id: true,
        },
        incidentSeverityId: true,
        incidentOnCallDutyPolicies: {
          _id: true,
        },
        incidentTitleTemplate: true,
        incidentDescriptionTemplate: true,
        incidentRemediationNotes: true,
        isIncidentPrivate: true,
        autoResolveIncident: true,
        incidentLabels: {
          _id: true,
        },
        incidentOwnerTeams: {
          _id: true,
        },
        incidentOwnerUsers: {
          _id: true,
        },
        addSloOwnersAsOwners: true,
        lastAlertCreatedAt: true,
        lastAlertResolvedAt: true,
        lastIncidentCreatedAt: true,
        lastIncidentResolvedAt: true,
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
      now: now,
      isSloStillEvaluated: checkSloStillEvaluated,
      reason:
        "The monitors attached to this SLO have not recorded any status in its window yet. It is measured automatically once they do.",
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
   * The re-read, as late as it can be: everything above only read, and the
   * state write below is the evaluation's first write. An SLO disabled,
   * archived or deleted after the sweep took its snapshot stops here - before
   * its status, the StatusChanged feed item, history rows, oneuptime.slo.*
   * metrics, owner notifications and burn rate rules. Its update hook has
   * already resolved whatever was open, and an archived SLO's numbers are
   * promised to stay as they were at archive time. A failed read throws into
   * the sweep's per-SLO catch: nothing is written this tick, and the SLO is
   * measured again on its next cadence.
   */
  if (!(await checkSloStillEvaluated())) {
    logSloNoLongerEvaluated({
      sloId: sloId,
      projectId: projectId,
    });
    return;
  }

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

  /*
   * StatusChanged on the SLO feed, for a transition this write just committed.
   * After the write, so a failed write posts nothing and the next tick meets
   * the same transition again. previousStatus reads an SLO that was never
   * evaluated as Healthy, so a first evaluation into Healthy stays silent;
   * the item itself names the stored status, which is what the reader saw.
   */
  if (newStatus !== previousStatus) {
    await postSloStatusChangedFeedItem({
      slo: slo,
      previousStatus: slo.sloStatus,
      newStatus: newStatus,
      now: now,
      measurement: {
        sliPercentage: sli.sliPercentage,
        targetPercentage: targetPercentage,
        errorBudgetRemainingPercentage: budget.budgetRemainingPercentage,
        errorBudgetRemainingSeconds: budget.budgetRemainingSeconds,
        currentBurnRate: currentBurnRate,
        currentBurnRateWindowInMinutes: CURRENT_BURN_RATE_WINDOW_MINUTES,
        atRiskThresholdPercentage:
          slo.atRiskThresholdPercentage ?? DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
      },
    });
  }

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

  /*
   * The same reading as oneuptime.slo.* metrics, so an SLO charts, filters
   * and dashboards like any monitor series. The values are the ones the
   * history rows above just recorded (unrounded), plus the target and the
   * status as an ordinal. The Paused / Misconfigured / zero-data guards
   * returned before this point and post only their target, through
   * setGuardStatusAndResolveOpenAlerts: no SLI, budget, burn rate or status.
   *
   * Its own try/catch, and after the history write rather than instead of
   * it: SloHistory keeps 400 days for the long-range charts while metric rows
   * follow the monitor-metric retention, and a ClickHouse failure on either
   * must never cost the owner notification or the burn-rate rules below.
   */
  try {
    await SloMetricUtil.saveSloMetrics({
      projectId: projectId,
      sloId: sloId,
      sloName: slo.name,
      labels: slo.labels,
      values: {
        [SloMetricType.SliPercent]: sli.sliPercentage,
        [SloMetricType.TargetPercent]: targetPercentage,
        [SloMetricType.ErrorBudgetRemainingPercent]:
          budget.budgetRemainingPercentage,
        [SloMetricType.ErrorBudgetRemainingSeconds]:
          budget.budgetRemainingSeconds,
        [SloMetricType.BurnRate]: currentBurnRate,
        [SloMetricType.Status]:
          SloMetricTypeUtil.getStatusMetricValue(newStatus),
      },
    });
  } catch (err) {
    logger.error(
      `Slo:EvaluateSlos - Error writing SLO metrics for SLO ${sloId.toString()}: ${err}`,
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
    currentSliPercentage: sli.sliPercentage,
    sloStatus: newStatus,
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
    // The same memoized read the state write already made: never a second one.
    isSloStillEvaluated: checkSloStillEvaluated,
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
  transition?: { now?: Date | undefined; reason?: string | undefined },
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

  const previousStatus: SloStatus | undefined = slo.sloStatus;

  // keep the in-memory copy consistent for the rest of this evaluation.
  slo.sloStatus = newStatus;

  /*
   * The guard paths' StatusChanged. Posted after the commit, which is the
   * guard's one-shot: the next tick sees no transition, so this never repeats,
   * and a failed resolve (which skips the commit) posts nothing either.
   */
  await postSloStatusChangedFeedItem({
    slo: slo,
    previousStatus: previousStatus,
    newStatus: newStatus,
    now: transition?.now || OneUptimeDate.getCurrentDate(),
    reason: transition?.reason,
  });
}

/*
 * The first Misconfigured guard folds three different problems into one
 * status. The feed says which, because "Misconfigured" alone sends the reader
 * looking in the wrong place. (The target check is defence in depth - the
 * create and update hooks reject such a target - so it is the fallback.)
 */
function getMisconfiguredGuardReason(data: {
  sliType: SliType | undefined;
  monitorCount: number;
}): string {
  if (data.sliType !== SliType.MonitorUptime) {
    return "This SLO's SLI type is not Monitor Uptime, which is the only SLI type OneUptime measures today.";
  }

  if (data.monitorCount === 0) {
    return "No monitors are attached to this SLO, so there is nothing to measure. Attach monitors, or add a monitor rule that matches some.";
  }

  return "This SLO's target is outside the valid range - it must be greater than 0 and below 100.";
}

/*
 * StatusChanged on the SLO feed: the transition, colored like the status
 * pill, with the numbers behind it (or, for a guard, the reason there are
 * none). No acting user - the worker decided this, not a person - and posted
 * at the evaluation's own clock so it sorts with the rest of the tick.
 *
 * Never throws. The feed describes the evaluation; it must never be able to
 * cost the history rows, owner notifications or burn rate rules that follow.
 */
async function postSloStatusChangedFeedItem(data: {
  slo: ServiceLevelObjective;
  previousStatus: SloStatus | undefined;
  newStatus: SloStatus;
  now: Date;
  measurement?: SloFeedStatusMeasurement | undefined;
  reason?: string | undefined;
}): Promise<void> {
  if (!data.slo.id || !data.slo.projectId) {
    return;
  }

  try {
    const sloMarkdownLink: string =
      await ServiceLevelObjectiveService.getSloMarkdownLink({
        projectId: data.slo.projectId,
        sloId: data.slo.id,
        // getDueSlos selects the name; "" keeps a nameless row from a lookup.
        sloName: data.slo.name || "",
      });

    const markdown: SloFeedMarkdown = getSloStatusChangedFeedMarkdown({
      sloMarkdownLink: sloMarkdownLink,
      previousStatus: data.previousStatus,
      newStatus: data.newStatus,
      measurement: data.measurement,
      reason: data.reason,
    });

    await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
      serviceLevelObjectiveId: data.slo.id,
      projectId: data.slo.projectId,
      serviceLevelObjectiveFeedEventType:
        ServiceLevelObjectiveFeedEventType.StatusChanged,
      displayColor: getSloStatusColor(data.newStatus),
      feedInfoInMarkdown: markdown.feedInfoInMarkdown,
      moreInformationInMarkdown: markdown.moreInformationInMarkdown,
      postedAt: data.now,
    });
  } catch (err) {
    logger.error(
      `Slo:EvaluateSlos - Error posting the status change feed item for SLO ${data.slo.id.toString()}: ${err}`,
      {
        projectId: data.slo.projectId.toString(),
        sloId: data.slo.id.toString(),
      } as LogAttributes,
    );
  }
}

/*
 * Guard exit path (Paused / Misconfigured): set the status and, ON THE
 * TRANSITION ONLY, resolve everything this SLO's burn-rate rules have open —
 * the Alerts they raised and the Incidents they declared.
 *
 * Why: the guards return before the burn-rate rule loop, so a record that is
 * already open (possibly with an on-call escalation attached) would otherwise
 * never be resolved while the SLO sits Paused/Misconfigured — the rule loop
 * that owns resolution is simply not reached. Resolving here is safe because
 * nothing NEW can be declared while the SLO is in one of these states, and
 * doing it only on the transition keeps it from re-resolving the same records
 * every tick.
 *
 * The resolve columns are deliberately NOT stamped: they drive the re-fire
 * suppression window of a live rule, and this is a state change of the SLO, not
 * a burn rate that recovered. What the service DOES clear is the rule's
 * created columns — the worker's own firing gate reads those, so leaving them
 * set would silence the rule for the rest of the burn once the SLO comes back.
 *
 * ORDER MATTERS: resolve FIRST, commit the status LAST. The status write is what
 * makes this a one-shot ("only on the transition"), so committing it before the
 * resolve turns any resolve failure into a permanent one — the next tick sees no
 * transition, returns early, and never retries, stranding the alert and its
 * on-call escalation forever. resolveOpenBurnRateAlertsAndIncidentsForSlo loads
 * its rules with a findBy that is not internally guarded, so this is not
 * hypothetical. Resolving first means a failure simply leaves the status where
 * it was and the next tick tries the whole thing again; the resolve itself is
 * idempotent, so the retry is harmless, and the status guard still keeps it to
 * once per transition in the happy path.
 */
async function setGuardStatusAndResolveOpenAlerts(data: {
  slo: ServiceLevelObjective;
  sloId: ObjectID;
  projectId: ObjectID;
  status: SloStatus;
  // The evaluation clock and the why, for the StatusChanged feed item.
  now?: Date | undefined;
  reason?: string | undefined;
  // The evaluation's one shared re-read of isEnabled / isArchived.
  isSloStillEvaluated: SloStillEvaluatedCheckFunction;
}): Promise<void> {
  if (data.slo.sloStatus === data.status) {
    /*
     * Already committed: this transition was handled by an earlier tick.
     *
     * The target point still goes out on every such tick. The SLO dashboard
     * picker lists only the names posted in the last day, and an SLO can sit
     * Paused or Misconfigured for weeks. It is deliberately not gated on the
     * mid-sweep re-read, which this branch never pays for: the point is
     * configuration rather than a measurement, so for an SLO retired after
     * the sweep started it only keeps the name pickable one cadence longer.
     */
    await saveGuardTargetMetric(data);
    return;
  }

  /*
   * A guard transition resolves, commits a status and posts a feed item, so
   * it re-reads first, the same as the measured path does before its state
   * write. Only a real transition pays for the read: an unchanged status
   * already returned above.
   */
  if (!(await data.isSloStillEvaluated())) {
    logSloNoLongerEvaluated({
      sloId: data.sloId,
      projectId: data.projectId,
    });
    return;
  }

  /*
   * Before the resolve, not after the status commit: saveSloGuardMetrics never
   * throws, and a resolve that keeps failing (retried every tick, see ORDER
   * MATTERS above) must not also keep the SLO out of the dashboard picker.
   */
  await saveGuardTargetMetric(data);

  /*
   * No rootCause is passed, so the service applies its own "SLO was disabled
   * or deleted" default. The override exists for the archive hook, which needs
   * its own wording; this path has never passed one.
   */
  await ServiceLevelObjectiveService.resolveOpenBurnRateAlertsAndIncidentsForSlo(
    {
      sloId: data.sloId,
      projectId: data.projectId,
    },
  );

  await setSloStatusIfChanged(data.slo, data.status, {
    now: data.now,
    reason: data.reason,
  });
}

/*
 * The guard paths' only metric: the SLO's target, with the same name, id and
 * label attributes as an evaluation, so the SLO dashboard's toolbar picker
 * keeps listing an SLO that is Paused, Misconfigured or not yet measured. See
 * SloMetricUtil.saveSloGuardMetrics for why nothing else is posted. It never
 * throws, so no call site needs its own try/catch.
 */
async function saveGuardTargetMetric(data: {
  slo: ServiceLevelObjective;
  sloId: ObjectID;
  projectId: ObjectID;
}): Promise<void> {
  await SloMetricUtil.saveSloGuardMetrics({
    projectId: data.projectId,
    sloId: data.sloId,
    sloName: data.slo.name,
    labels: data.slo.labels,
    targetPercentage: data.slo.targetPercentage,
  });
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

/*
 * Re-reads the two flags that take an SLO out of evaluation, mirroring
 * getDueSlos' own filter (enabled AND not archived) so the two gates can never
 * disagree about what "still evaluated" means.
 *
 * Why it exists: the sweep evaluates a SNAPSHOT of due SLOs taken when it
 * started, and a large sweep can take minutes to reach the last one. An SLO a
 * user disables or archives in that gap has already had everything open
 * resolved by the service's update hook, and an archived SLO is promised to
 * keep the numbers it had at archive time. Evaluating it from the stale
 * snapshot would overwrite its status and budget, post a StatusChanged item
 * under the "Archived" one, write history and metrics, email, text and call
 * its owners - and open a fresh alert or incident that nothing would ever
 * resolve, because the worker will not look at that SLO again. A deleted SLO
 * (no row) is treated the same way.
 *
 * So every write an evaluation makes is gated on it, through one memoized read
 * per evaluation: the measured path reads right before its state write, a
 * guard right before it commits a transition, and burn rate firing reuses that
 * answer. Resolving is gated too - the disable, archive and delete hooks have
 * already resolved what was open, so the worker would only post a second
 * "resolved" for it. The read and the writes are not atomic: this narrows the
 * window from a whole sweep to a single evaluation, it does not close it.
 */
function logSloNoLongerEvaluated(data: {
  sloId: ObjectID;
  projectId: ObjectID;
}): void {
  logger.debug(
    `Slo:EvaluateSlos - Skipping SLO ${data.sloId.toString()}: it was disabled, archived or deleted after this sweep started, so this evaluation writes nothing for it.`,
    {
      projectId: data.projectId.toString(),
      sloId: data.sloId.toString(),
    } as LogAttributes,
  );
}

async function isSloStillEvaluated(data: {
  sloId: ObjectID;
}): Promise<boolean> {
  const current: ServiceLevelObjective | null =
    await ServiceLevelObjectiveService.findOneById({
      id: data.sloId,
      select: {
        _id: true,
        isEnabled: true,
        isArchived: true,
      },
      props: {
        isRoot: true,
      },
    });

  if (!current) {
    return false;
  }

  return current.isEnabled === true && current.isArchived === false;
}

async function evaluateBurnRateRule(data: {
  context: SloEvaluationContext;
  rule: ServiceLevelObjectiveBurnRateRule;
}): Promise<void> {
  const { context, rule } = data;

  if (!rule.id) {
    return;
  }

  const ruleId: ObjectID = rule.id;

  /*
   * Unevaluatable configuration. The create/update hooks reject all of this,
   * so reaching here means a row written before those validators existed (or
   * one whose windows were nulled out directly in the database).
   *
   * It still has to RESOLVE. Returning early — which is what this guard used
   * to do — left a rule that had already fired holding its alert, its
   * incident and their on-call escalations open forever, with nothing in the
   * product able to close them: the worker is the only resolver, and it never
   * got past this line.
   */
  if (
    !rule.burnRateThreshold ||
    rule.burnRateThreshold <= 0 ||
    !rule.longWindowInMinutes ||
    !rule.shortWindowInMinutes
  ) {
    await resolveBurnRateRuleOutputs({
      context: context,
      rule: rule,
      ruleId: ruleId,
      rootCause:
        "Auto-resolved because this SLO burn rate rule no longer has a valid threshold and window configuration, so it can no longer justify staying open.",
      // Not a recovery: the rule cannot justify the record at all any more.
      honourAutoResolve: false,
    });
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
      /*
       * Last check before anything is created: was this SLO disabled,
       * archived or deleted after the sweep took its snapshot? The evaluation
       * already asked right before its state write, and stopped there if so,
       * so this reuses that memoized answer instead of reading again. It stays
       * so that no path can ever reach a page without passing the gate.
       */
      if (!(await context.isSloStillEvaluated())) {
        logger.debug(
          `Slo:EvaluateSlos - Not firing burn rate rule ${ruleId.toString()}: SLO ${context.sloId.toString()} was disabled, archived or deleted after this sweep started.`,
          {
            projectId: context.projectId.toString(),
            sloId: context.sloId.toString(),
          } as LogAttributes,
        );
        return;
      }

      await fireBurnRateRule({
        context: context,
        rule: rule,
        ruleId: ruleId,
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
      `Slo:EvaluateSlos - Not firing burn rate rule ${ruleId.toString()} for SLO ${context.sloId.toString()}: not enough history to evaluate a ${rule.longWindowInMinutes}-minute burn window (earliest observed data: ${context.earliestEventStart?.toISOString() || "none"}). An already-open alert or incident for this rule is still resolved.`,
      {
        projectId: context.projectId.toString(),
        sloId: context.sloId.toString(),
      } as LogAttributes,
    );
  }

  /*
   * Resolution branch. Reached either because the long window is measurable and
   * has recovered, or because it is no longer measurable at all — in both cases
   * nothing here can justify keeping a page open, whether that page came from
   * an Alert or from an Incident.
   */
  await resolveBurnRateRuleOutputs({
    context: context,
    rule: rule,
    ruleId: ruleId,
    rootCause: hasFullLongWindow
      ? "Burn rate dropped below threshold."
      : `The SLO no longer has ${rule.longWindowInMinutes} minutes of monitoring history, so this burn rate rule can no longer justify an open alert or incident.`,
    /*
     * Only a measured recovery is what the rule's auto-resolve switches
     * describe. Losing the history to measure at all is not a recovery - the
     * rule can no longer justify the record - so it resolves either way.
     */
    honourAutoResolve: hasFullLongWindow,
  });
}

/*
 * Close whichever of the rule's two outputs is currently open, and stamp only
 * the ones that actually closed.
 *
 * Each output is resolved from its OWN lifecycle columns rather than from what
 * the rule is configured to declare today: a rule that raised an alert last
 * week and has since been switched to incidents only must still get that alert
 * closed, and the configuration says nothing about what is already open.
 *
 * A failure on one side must not strand the other, and a side that failed must
 * NOT be stamped — the stamp is what tells the next tick there is nothing left
 * to resolve. So both sides are attempted, only the successful ones are
 * stamped, and the first error is rethrown for the per-rule handler to log.
 *
 * Auto-resolve. `honourAutoResolve` is true only on the measured-recovery
 * branch, because that is the one decision the rule's autoResolveAlert /
 * autoResolveIncident switches describe. With a side's switch off, that side
 * is not resolved; the worker only asks whether a human has closed it yet:
 *   - still open: nothing is written, so the rule keeps reading that output as
 *     firing and cannot declare a duplicate on top of it;
 *   - closed by hand: the resolve is stamped now, so the lifecycle ends and the
 *     rule can fire again once its suppression window has passed. Without this
 *     a manually resolved record would leave the rule stamped as firing - and
 *     silent - forever.
 * The other callers (an unevaluatable rule, an SLO without a long window of
 * history) pass false: the rule can no longer justify the record at all, the
 * same reasoning the administrative resolves in the rule and SLO lifecycle
 * hooks follow, and those never consult the switches either.
 */
async function resolveBurnRateRuleOutputs(data: {
  context: SloEvaluationContext;
  rule: ServiceLevelObjectiveBurnRateRule;
  ruleId: ObjectID;
  rootCause: string;
  honourAutoResolve: boolean;
}): Promise<void> {
  const { context, rule, ruleId, rootCause } = data;

  const isAlertOpen: boolean = isBurnRateRuleAlertFiring(rule);
  const isIncidentOpen: boolean = isBurnRateRuleIncidentFiring(rule);

  if (!isAlertOpen && !isIncidentOpen) {
    return;
  }

  const resolvedColumns: {
    lastAlertResolvedAt?: Date;
    lastIncidentResolvedAt?: Date;
  } = {};

  // How each side closed, kept for the feed items posted after the stamp.
  let alertClosure: BurnRateOutputClosure | null = null;
  let incidentClosure: BurnRateOutputClosure | null = null;

  let firstError: unknown = null;

  if (isAlertOpen) {
    try {
      alertClosure = await closeBurnRateOutput({
        output: "alert",
        context: context,
        rule: rule,
        ruleId: ruleId,
        rootCause: rootCause,
        honourAutoResolve: data.honourAutoResolve,
      });

      if (alertClosure) {
        resolvedColumns.lastAlertResolvedAt = context.now;
      }
    } catch (err) {
      firstError = err;
    }
  }

  if (isIncidentOpen) {
    try {
      incidentClosure = await closeBurnRateOutput({
        output: "incident",
        context: context,
        rule: rule,
        ruleId: ruleId,
        rootCause: rootCause,
        honourAutoResolve: data.honourAutoResolve,
      });

      if (incidentClosure) {
        resolvedColumns.lastIncidentResolvedAt = context.now;
      }
    } catch (err) {
      if (firstError === null) {
        firstError = err;
      }
    }
  }

  if (Object.keys(resolvedColumns).length > 0) {
    await ServiceLevelObjectiveBurnRateRuleService.updateOneById({
      id: ruleId,
      data: resolvedColumns,
      props: {
        isRoot: true,
      },
    });

    /*
     * Posted only once the stamp has committed. A stamp that fails leaves the
     * side to be closed again next tick, and posting first would put a second
     * "resolved" item on the feed for the one record.
     */
    if (alertClosure) {
      await postBurnRateResolvedFeedItem({
        output: "alert",
        closure: alertClosure,
        context: context,
        rule: rule,
        rootCause: rootCause,
      });
    }

    if (incidentClosure) {
      await postBurnRateResolvedFeedItem({
        output: "incident",
        closure: incidentClosure,
        context: context,
        rule: rule,
        rootCause: rootCause,
      });
    }
  }

  if (firstError !== null) {
    throw firstError;
  }
}

type BurnRateOutputKind = "alert" | "incident";

/*
 * "auto-resolved": the worker resolved the record (or found nothing left open
 * with auto-resolve on - the resolvers treat that as success, as they always
 * have). "resolved-by-hand": auto-resolve is off and a human closed it.
 */
type BurnRateOutputClosure = "auto-resolved" | "resolved-by-hand";

/*
 * One side of resolveBurnRateRuleOutputs. Returns how the record closed, or
 * null when it must stay open (auto-resolve is off and nobody has resolved it
 * yet). A failed resolve or lookup throws, and the caller leaves that side
 * unstamped so the next tick retries it.
 */
async function closeBurnRateOutput(data: {
  output: BurnRateOutputKind;
  context: SloEvaluationContext;
  rule: ServiceLevelObjectiveBurnRateRule;
  ruleId: ObjectID;
  rootCause: string;
  honourAutoResolve: boolean;
}): Promise<BurnRateOutputClosure | null> {
  const { context, rule, ruleId } = data;
  const isAlert: boolean = data.output === "alert";

  // `!== false`: both columns default to true, and so has every rule to date.
  const isAutoResolveOn: boolean = isAlert
    ? rule.autoResolveAlert !== false
    : rule.autoResolveIncident !== false;

  if (data.honourAutoResolve && !isAutoResolveOn) {
    const fingerprint: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint({
        serviceLevelObjectiveId: context.sloId,
        burnRateRuleId: ruleId,
      });

    const isStillOpen: boolean = isAlert
      ? Boolean(await findOpenBurnRateAlert({ context, fingerprint }))
      : Boolean(await findOpenBurnRateIncident({ context, fingerprint }));

    return isStillOpen ? null : "resolved-by-hand";
  }

  const resolveArguments: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
    projectId: ObjectID;
    rootCause: string;
  } = {
    serviceLevelObjectiveId: context.sloId,
    burnRateRuleId: ruleId,
    projectId: context.projectId,
    rootCause: data.rootCause,
  };

  if (isAlert) {
    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule(
      resolveArguments,
    );
  } else {
    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule(
      resolveArguments,
    );
  }

  return "auto-resolved";
}

/*
 * The rule fired.
 *
 * Scheduled maintenance silences the WHOLE rule — planned work should not page
 * anyone, through either output. Everything after that is per-output: each has
 * its own open/closed lifecycle columns, its own re-fire suppression measured
 * from its own resolve, its own dedupe and its own severity table, so one can
 * fail, or be switched off, without touching the other.
 *
 * The entry gate for each output is "this output is not already open", not
 * "nothing exists with this fingerprint". An Incident is a human-owned object:
 * a responder resolves it in the UI while the burn is still going, and a
 * declaration gated only on the dedupe query would re-declare it on the next
 * one-minute tick — burning an incident number, re-running on-call escalation
 * and emailing subscribers, every minute, forever. Gating on the rule's own
 * lifecycle means the responder wins until the burn recovers and the rule
 * genuinely re-fires.
 */
async function fireBurnRateRule(data: {
  context: SloEvaluationContext;
  rule: ServiceLevelObjectiveBurnRateRule;
  ruleId: ObjectID;
  burnRateLong: number;
  burnRateShort: number;
}): Promise<void> {
  const { context, rule, ruleId } = data;

  const logAttributes: LogAttributes = {
    projectId: context.projectId.toString(),
    sloId: context.sloId.toString(),
  };

  // scheduled-maintenance suppression — creation only, and for both outputs.
  if (await context.isAnyMonitorUnderOngoingMaintenance()) {
    logger.debug(
      `Slo:EvaluateSlos - Skipping burn rate rule ${ruleId.toString()}: a monitor of this SLO is under an active scheduled maintenance window.`,
      logAttributes,
    );
    return;
  }

  const refireSuppressionMinutes: number =
    rule.refireSuppressionMinutes ?? rule.longWindowInMinutes!;

  const fingerprint: string =
    ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint({
      serviceLevelObjectiveId: context.sloId,
      burnRateRuleId: ruleId,
    });

  /*
   * What both outputs need beyond the fingerprint, built on first use and
   * shared by the pair. Most ticks of a sustained burn find both outputs
   * already open and never get this far, and an adopted record needs neither -
   * so the SLO link lookup behind the templates and the SLO owner read only
   * happen for a record that is really about to be created, at most once.
   */
  let declarationPromise: Promise<BurnRateDeclaration> | null = null;
  let sloOwnerUsersPromise: Promise<Array<User>> | null = null;

  const fire: BurnRateFire = {
    fingerprint: fingerprint,
    getDeclaration: (): Promise<BurnRateDeclaration> => {
      if (!declarationPromise) {
        declarationPromise = buildBurnRateDeclaration({
          context: context,
          rule: rule,
          fingerprint: fingerprint,
          burnRateLong: data.burnRateLong,
          burnRateShort: data.burnRateShort,
          logAttributes: logAttributes,
        });
      }

      return declarationPromise;
    },
    getSloOwnerUsers: (): Promise<Array<User>> => {
      if (!sloOwnerUsersPromise) {
        sloOwnerUsersPromise = loadSloOwnerUsers({
          context: context,
          logAttributes: logAttributes,
        });
      }

      return sloOwnerUsersPromise;
    },
  };

  /*
   * `!== false` for the alert and `=== true` for the incident, the asymmetry
   * DetectionRuleEvaluator documents: the alert column defaults to true and a
   * rule read without it must keep paging, while the incident column defaults
   * to false and must never read as "probably on".
   */
  const shouldCreateAlert: boolean = rule.shouldCreateAlert !== false;
  const shouldCreateIncident: boolean = rule.shouldCreateIncident === true;

  const firedColumns: {
    lastAlertCreatedAt?: Date;
    lastIncidentCreatedAt?: Date;
  } = {};

  let firstError: unknown = null;

  if (shouldCreateAlert && !isBurnRateRuleAlertFiring(rule)) {
    if (
      isWithinRefireSuppression({
        now: context.now,
        lastResolvedAt: rule.lastAlertResolvedAt,
        refireSuppressionMinutes: refireSuppressionMinutes,
      })
    ) {
      logger.debug(
        `Slo:EvaluateSlos - Skipping burn rate alert for rule ${ruleId.toString()}: within the ${refireSuppressionMinutes}-minute re-fire suppression window after the last alert resolve.`,
        logAttributes,
      );
    } else {
      try {
        const hasOpenAlert: boolean = await createBurnRateAlert({
          context: context,
          rule: rule,
          ruleId: ruleId,
          fire: fire,
          logAttributes: logAttributes,
        });

        if (hasOpenAlert) {
          firedColumns.lastAlertCreatedAt = context.now;
        }
      } catch (err) {
        firstError = err;
      }
    }
  }

  if (shouldCreateIncident && !isBurnRateRuleIncidentFiring(rule)) {
    if (
      isWithinRefireSuppression({
        now: context.now,
        lastResolvedAt: rule.lastIncidentResolvedAt,
        refireSuppressionMinutes: refireSuppressionMinutes,
      })
    ) {
      logger.debug(
        `Slo:EvaluateSlos - Skipping burn rate incident for rule ${ruleId.toString()}: within the ${refireSuppressionMinutes}-minute re-fire suppression window after the last incident resolve.`,
        logAttributes,
      );
    } else {
      try {
        const hasOpenIncident: boolean = await declareBurnRateIncident({
          context: context,
          rule: rule,
          ruleId: ruleId,
          fire: fire,
          logAttributes: logAttributes,
        });

        if (hasOpenIncident) {
          firedColumns.lastIncidentCreatedAt = context.now;
        }
      } catch (err) {
        if (firstError === null) {
          firstError = err;
        }
      }
    }
  }

  /*
   * Stamp whichever outputs actually opened, in one write. Stamping is what
   * makes the rule resolvable later, so a side that threw is deliberately left
   * unstamped and retried on the next tick — and a side that succeeded is
   * stamped even when the OTHER side threw, which is the whole reason the two
   * lifecycles are separate columns.
   */
  if (Object.keys(firedColumns).length > 0) {
    await ServiceLevelObjectiveBurnRateRuleService.updateOneById({
      id: ruleId,
      data: firedColumns,
      props: {
        isRoot: true,
      },
    });
  }

  if (firstError !== null) {
    throw firstError;
  }
}

/*
 * The quiet period after an output resolved, before the same output may be
 * declared again. Measured from that output's OWN resolve stamp: an incident
 * that resolved an hour ago must not be held back by an alert that resolved a
 * minute ago.
 */
function isWithinRefireSuppression(data: {
  now: Date;
  lastResolvedAt: Date | undefined;
  refireSuppressionMinutes: number;
}): boolean {
  if (!data.lastResolvedAt) {
    return false;
  }

  return (
    OneUptimeDate.getDifferenceInMinutes(data.now, data.lastResolvedAt) <
    data.refireSuppressionMinutes
  );
}

/*
 * What one burn rate record says. Each output renders its own copy from its own
 * templates; without templates both fall back to the same built-in wording,
 * which is deliberate - they carry the same fingerprint and describe the same
 * burn, so anyone correlating the two sees the same numbers.
 */
interface BurnRateOutputCopy {
  title: string;
  description: string;
  remediationNotes: string | undefined;
}

interface BurnRateDeclaration {
  fingerprint: string;
  rootCause: string;
  // Also read by the feed items, so they quote the numbers the record carries.
  variables: SloBurnRateTemplateVariables;
  alert: BurnRateOutputCopy;
  incident: BurnRateOutputCopy;
}

// Per-fire state shared by the two create paths; see fireBurnRateRule.
interface BurnRateFire {
  fingerprint: string;
  getDeclaration: () => Promise<BurnRateDeclaration>;
  getSloOwnerUsers: () => Promise<Array<User>>;
}

/*
 * Renders both outputs' copy from the rule's templates and the numbers that
 * made it fire. The root cause is not templated: it is the evaluation's own
 * statement of why the record exists, the way MonitorAlert treats it.
 */
async function buildBurnRateDeclaration(data: {
  context: SloEvaluationContext;
  rule: ServiceLevelObjectiveBurnRateRule;
  fingerprint: string;
  burnRateLong: number;
  burnRateShort: number;
  logAttributes: LogAttributes;
}): Promise<BurnRateDeclaration> {
  const { context, rule } = data;

  /*
   * {{sloLink}} is the only variable that needs a lookup, and a failure costs
   * the link rather than the page: the variable renders empty and the record
   * is still created.
   */
  let sloLink: string = "";

  try {
    sloLink = (
      await ServiceLevelObjectiveService.getSloLinkInDashboard(
        context.projectId,
        context.sloId,
      )
    ).toString();
  } catch (err) {
    logger.error(
      `Slo:EvaluateSlos - Could not build the SLO link for the templates of burn rate rule ${rule.id?.toString()}; {{sloLink}} renders empty: ${err}`,
      data.logAttributes,
    );
  }

  const variables: SloBurnRateTemplateVariables =
    buildSloBurnRateTemplateVariables({
      sloId: context.sloId.toString(),
      sloName: context.slo.name,
      sloLink: sloLink,
      sloStatus: context.sloStatus,
      ruleName: rule.name,
      /*
       * Number(): a decimal column can reach the worker as a string, and the
       * template formatter renders anything that is not a real number as
       * empty. The pre-template text coerced these the same way, through
       * roundToTwoDecimals' arithmetic.
       */
      burnRateThreshold: Number(rule.burnRateThreshold),
      longWindowBurnRate: data.burnRateLong,
      shortWindowBurnRate: data.burnRateShort,
      longWindowInMinutes: Number(rule.longWindowInMinutes),
      shortWindowInMinutes: Number(rule.shortWindowInMinutes),
      targetPercentage: Number(context.targetPercentage),
      currentSliPercentage: context.currentSliPercentage,
      errorBudgetRemainingPercentage: context.budget.budgetRemainingPercentage,
      errorBudgetRemainingSeconds: context.budget.budgetRemainingSeconds,
      windowType: context.slo.windowType,
      windowDays: context.slo.windowDays,
      timezone: context.slo.timezone,
    });

  const defaultCopy: { title: string; description: string } = {
    title:
      renderSloBurnRateTemplate(
        DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
        variables,
      ) || "",
    description:
      renderSloBurnRateTemplate(
        DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
        variables,
      ) || "",
  };

  return {
    fingerprint: data.fingerprint,
    rootCause: `Error budget burn rate breached the "${rule.name}" rule of SLO "${context.slo.name}".`,
    variables: variables,
    alert: renderBurnRateOutputCopy({
      titleTemplate: rule.alertTitleTemplate,
      descriptionTemplate: rule.alertDescriptionTemplate,
      remediationNotesTemplate: rule.alertRemediationNotes,
      variables: variables,
      defaultCopy: defaultCopy,
    }),
    incident: renderBurnRateOutputCopy({
      titleTemplate: rule.incidentTitleTemplate,
      descriptionTemplate: rule.incidentDescriptionTemplate,
      remediationNotesTemplate: rule.incidentRemediationNotes,
      variables: variables,
      defaultCopy: defaultCopy,
    }),
  };
}

function renderBurnRateOutputCopy(data: {
  titleTemplate: string | undefined;
  descriptionTemplate: string | undefined;
  remediationNotesTemplate: string | undefined;
  variables: SloBurnRateTemplateVariables;
  defaultCopy: { title: string; description: string };
}): BurnRateOutputCopy {
  return {
    title: toRecordTitle(
      renderSloBurnRateTemplate(data.titleTemplate, data.variables),
      data.defaultCopy.title,
    ),
    description:
      renderSloBurnRateTemplate(data.descriptionTemplate, data.variables) ??
      data.defaultCopy.description,
    // No built-in remediation notes: a blank template simply sets none.
    remediationNotes:
      renderSloBurnRateTemplate(
        data.remediationNotesTemplate,
        data.variables,
      ) || undefined,
  };
}

const TITLE_LINE_BREAK_PATTERN: RegExp = /\s*[\r\n]+\s*/g;

/*
 * Alert.title and Incident.title are required varchar(ColumnLength.LongText)
 * columns. A template the rule service accepted can still render past that once
 * {{sloName}} or {{sloLink}} expands, or render to nothing ("{{sloLink}}" with
 * no link) - and either fails the INSERT on every one-minute tick, a page that
 * never arrives. So line breaks are folded (a title is one line), an empty
 * result falls back to the built-in title, and an over-long one is cut with an
 * ellipsis - by code point, so an emoji is never split in half.
 */
function toRecordTitle(
  renderedTitle: string | null,
  defaultTitle: string,
): string {
  const title: string =
    renderedTitle === null
      ? defaultTitle
      : renderedTitle.replace(TITLE_LINE_BREAK_PATTERN, " ");

  const usableTitle: string = title.trim() === "" ? defaultTitle : title;

  const characters: Array<string> = Array.from(usableTitle);

  if (characters.length <= ColumnLength.LongText) {
    return usableTitle;
  }

  return `${characters.slice(0, ColumnLength.LongText - 1).join("")}…`;
}

/*
 * The SLO's owners, for rules with addSloOwnersAsOwners. findOwners resolves
 * owner teams into their members - exactly the people the SLO's own
 * status-change notification reaches - so they are added as owner users. A
 * failed read is logged and treated as "no SLO owners": the rule's own owners
 * must still be added, and the record already exists.
 */
async function loadSloOwnerUsers(data: {
  context: SloEvaluationContext;
  logAttributes: LogAttributes;
}): Promise<Array<User>> {
  try {
    return await ServiceLevelObjectiveService.findOwners(data.context.sloId);
  } catch (err) {
    logger.error(
      `Slo:EvaluateSlos - Could not load the owners of SLO ${data.context.sloId.toString()} to add to its burn rate alerts and incidents: ${err}`,
      data.logAttributes,
    );
    return [];
  }
}

/*
 * Returns TRUE when this rule now has an open Alert that the rule's own
 * columns do not yet record — i.e. when it is the caller's turn to stamp.
 *
 * That includes finding an alert that was ALREADY open. The caller only gets
 * here when the rule is not stamped as alert-firing, so an already-open alert
 * with this fingerprint means a previous tick created the alert and then failed
 * to stamp it. Left alone, that alert could never be resolved: the resolution
 * branch keys on the stamp. Stamping it now repairs the lifecycle, at the cost
 * of reporting a "last fired" that is later than the truth.
 */
async function createBurnRateAlert(data: {
  context: SloEvaluationContext;
  rule: ServiceLevelObjectiveBurnRateRule;
  ruleId: ObjectID;
  fire: BurnRateFire;
  logAttributes: LogAttributes;
}): Promise<boolean> {
  const { context, rule, ruleId, fire, logAttributes } = data;

  const openAlert: Alert | null = await findOpenBurnRateAlert({
    context: context,
    fingerprint: fire.fingerprint,
  });

  if (openAlert) {
    logger.debug(
      `Slo:EvaluateSlos - Burn rate rule ${ruleId.toString()} already has an open alert that it had not recorded; adopting it instead of creating a duplicate.`,
      logAttributes,
    );
    return true;
  }

  if (DisableAutomaticAlertCreation) {
    logger.debug(
      `Slo:EvaluateSlos - Skipping burn rate alert for rule ${ruleId.toString()}: automatic alert creation is disabled by environment configuration.`,
      logAttributes,
    );
    return false;
  }

  /*
   * Severity: the rule's configured severity, falling back to the project's
   * lowest-order (most severe) severity — the MonitorAlert fallback. A project
   * with no alert severity skips the ALERT only; the incident half of the same
   * rule is unaffected.
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
      `Slo:EvaluateSlos - Cannot create burn rate alert for rule ${ruleId.toString()}: project has no alert severity.`,
      logAttributes,
    );
    return false;
  }

  const declaration: BurnRateDeclaration = await fire.getDeclaration();

  const alert: Alert = new Alert();
  alert.projectId = context.projectId;
  alert.title = declaration.alert.title;
  alert.description = declaration.alert.description;
  alert.rootCause = declaration.rootCause;
  alert.alertSeverityId = alertSeverityId;
  alert.seriesFingerprint = declaration.fingerprint;
  alert.isCreatedAutomatically = true;

  if (declaration.alert.remediationNotes) {
    alert.remediationNotes = declaration.alert.remediationNotes;
  }

  /*
   * `=== true`: the column defaults to false, and a rule read without it must
   * never hide an alert from the project it is paging.
   */
  if (rule.isAlertPrivate === true) {
    alert.isPrivate = true;
  }

  // On-call policy id-stubs, the MonitorAlert pattern.
  alert.onCallDutyPolicies = toIdStubs(
    rule.onCallDutyPolicies,
    OnCallDutyPolicy,
  );

  /*
   * Set only when the rule has labels, so a rule without any hands the create
   * path exactly what it always did.
   */
  const labels: Array<Label> = toIdStubs(rule.alertLabels, Label);

  if (labels.length > 0) {
    alert.labels = labels;
  }

  /*
   * The SLO as the alert's affected resource, so the alert names it and the
   * SLO's Alerts tab finds it by relation. An id-stub like every relation
   * here. Never the SLO's monitors - see declareBurnRateIncident.
   */
  alert.serviceLevelObjectives = [
    toIdStub(context.sloId, ServiceLevelObjective),
  ];

  const createdAlert: Alert | undefined = await AlertService.create({
    data: alert,
    props: {
      isRoot: true,
    },
  });

  /*
   * The alert exists from here on, so nothing below may throw: returning true
   * is what gets it stamped, and an unstamped alert is one the resolution
   * branch never closes (the next tick would adopt it, but only after a
   * failure had already been logged against a page that did go out). Both
   * helpers catch and log their own failures.
   */
  await addBurnRateRecordOwners({
    output: "alert",
    context: context,
    ruleId: ruleId,
    recordId: createdAlert?.id || undefined,
    ownerUsers: rule.alertOwnerUsers,
    ownerTeams: rule.alertOwnerTeams,
    addSloOwners: rule.addSloOwnersAsOwners === true,
    fire: fire,
    logAttributes: logAttributes,
  });

  await postBurnRateRaisedFeedItem({
    output: "alert",
    context: context,
    rule: rule,
    recordId: createdAlert?.id || undefined,
    recordNumber: formatRecordNumber(
      createdAlert?.alertNumberWithPrefix,
      createdAlert?.alertNumber,
    ),
    // The rule's flag, or a create hook that already made it private.
    isPrivate: alert.isPrivate === true || createdAlert?.isPrivate === true,
    declaration: declaration,
    copy: declaration.alert,
    logAttributes: logAttributes,
  });

  return true;
}

/*
 * The Incident twin. Deliberately NOT folded into createBurnRateAlert: the
 * dedupe query, the severity table, the on-call list and the failure mode all
 * differ.
 *
 * Three things this incident deliberately does NOT do:
 *
 *  - it does not attach the SLO's monitors. Resolving an incident that has
 *    monitors runs IncidentService.markMonitorsActiveForMonitoring, which
 *    flips each monitor to its operational status and writes a
 *    MonitorStatusTimeline row — the very rows this worker computes the SLI
 *    from. A burn-rate incident that attached monitors would therefore repair
 *    its own SLO's uptime number on resolve, close a real ongoing downtime
 *    interval, and notify the monitors' owners of a recovery that never
 *    happened. The SLO is attached as the affected resource instead
 *    (serviceLevelObjectives, which no resolve hook reads), and the
 *    fingerprint still drives dedupe and resolution.
 *
 *  - it does not set changeMonitorStatusToId. A burn rate is a statement about
 *    the error budget, not about whether a monitor is up right now.
 *
 *  - it is not visible on status pages and does not notify subscribers. Both
 *    columns default to TRUE on the model, so they have to be written
 *    explicitly: an internal error-budget rule crossing 14.4x is an
 *    engineering signal, and publishing it (and SMS-ing every subscriber)
 *    because an SLO is spending budget fast would be a surprise nobody asked
 *    for.
 *
 * Returns TRUE when this rule now has an open Incident its columns do not yet
 * record — created here, or already open and being adopted (see
 * createBurnRateAlert for why adoption matters).
 */
async function declareBurnRateIncident(data: {
  context: SloEvaluationContext;
  rule: ServiceLevelObjectiveBurnRateRule;
  ruleId: ObjectID;
  fire: BurnRateFire;
  logAttributes: LogAttributes;
}): Promise<boolean> {
  const { context, rule, ruleId, fire, logAttributes } = data;

  const openIncident: Incident | null = await findOpenBurnRateIncident({
    context: context,
    fingerprint: fire.fingerprint,
  });

  if (openIncident) {
    logger.debug(
      `Slo:EvaluateSlos - Burn rate rule ${ruleId.toString()} already has an open incident that it had not recorded; adopting it instead of declaring a duplicate.`,
      logAttributes,
    );
    return true;
  }

  if (DisableAutomaticIncidentCreation) {
    logger.debug(
      `Slo:EvaluateSlos - Skipping burn rate incident for rule ${ruleId.toString()}: automatic incident creation is disabled by environment configuration.`,
      logAttributes,
    );
    return false;
  }

  /*
   * Severity: the rule's configured incident severity, falling back to the
   * project's lowest-order (most severe) one — the same precedence the alert
   * path uses, against the IncidentSeverity table.
   */
  let incidentSeverityId: ObjectID | undefined = rule.incidentSeverityId;

  if (!incidentSeverityId) {
    const severity: IncidentSeverity | null =
      await IncidentSeverityService.findOneBy({
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
      });

    incidentSeverityId = severity?.id || undefined;
  }

  if (!incidentSeverityId) {
    logger.error(
      `Slo:EvaluateSlos - Cannot declare burn rate incident for rule ${ruleId.toString()}: project has no incident severity.`,
      logAttributes,
    );
    return false;
  }

  const declaration: BurnRateDeclaration = await fire.getDeclaration();

  const incident: Incident = new Incident();
  incident.projectId = context.projectId;
  incident.title = declaration.incident.title;
  incident.description = declaration.incident.description;
  incident.rootCause = declaration.rootCause;
  incident.incidentSeverityId = incidentSeverityId;
  incident.seriesFingerprint = declaration.fingerprint;
  incident.isCreatedAutomatically = true;
  incident.isVisibleOnStatusPage = false;
  incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = false;

  if (declaration.incident.remediationNotes) {
    incident.remediationNotes = declaration.incident.remediationNotes;
  }

  // `=== true`, for the same reason as the alert's private flag.
  if (rule.isIncidentPrivate === true) {
    incident.isPrivate = true;
  }

  incident.onCallDutyPolicies = toIdStubs(
    rule.incidentOnCallDutyPolicies,
    OnCallDutyPolicy,
  );

  const labels: Array<Label> = toIdStubs(rule.incidentLabels, Label);

  if (labels.length > 0) {
    incident.labels = labels;
  }

  /*
   * The SLO as the affected resource - the link the monitors must never be.
   * Nothing in IncidentService's resolve path iterates serviceLevelObjectives,
   * so resolving this incident writes no monitor status and leaves the SLI
   * history alone.
   */
  incident.serviceLevelObjectives = [
    toIdStub(context.sloId, ServiceLevelObjective),
  ];

  const createdIncident: Incident | undefined = await IncidentService.create({
    data: incident,
    props: {
      isRoot: true,
    },
  });

  // The incident exists: nothing below may cost it its stamp (see the alert).
  await addBurnRateRecordOwners({
    output: "incident",
    context: context,
    ruleId: ruleId,
    recordId: createdIncident?.id || undefined,
    ownerUsers: rule.incidentOwnerUsers,
    ownerTeams: rule.incidentOwnerTeams,
    addSloOwners: rule.addSloOwnersAsOwners === true,
    fire: fire,
    logAttributes: logAttributes,
  });

  await postBurnRateRaisedFeedItem({
    output: "incident",
    context: context,
    rule: rule,
    recordId: createdIncident?.id || undefined,
    recordNumber: formatRecordNumber(
      createdIncident?.incidentNumberWithPrefix,
      createdIncident?.incidentNumber,
    ),
    isPrivate:
      incident.isPrivate === true || createdIncident?.isPrivate === true,
    declaration: declaration,
    copy: declaration.incident,
    logAttributes: logAttributes,
  });

  return true;
}

/*
 * Both create paths hand their service id-stubs rather than the loaded
 * entities: the relation is written by id, and passing a partially selected
 * entity through would let a stale column overwrite the real row.
 */
function toIdStub<TModel extends DatabaseBaseModel>(
  id: ObjectID,
  modelType: { new (): TModel },
): TModel {
  const stub: TModel = new modelType();
  stub._id = id.toString();
  return stub;
}

function toIdStubs<TModel extends DatabaseBaseModel>(
  records: Array<TModel> | undefined,
  modelType: { new (): TModel },
): Array<TModel> {
  return (records || [])
    .filter((record: TModel): boolean => {
      return Boolean(record.id);
    })
    .map((record: TModel): TModel => {
      return toIdStub(record.id!, modelType);
    });
}

/*
 * Ids from loaded relation lists, deduplicated case-insensitively (ObjectID
 * keeps whatever case it was handed; Postgres renders a uuid lower-cased). A
 * user who is both a rule owner and an SLO owner must be added - and notified
 * - once.
 */
function uniqueIdsOf(
  records: Array<DatabaseBaseModel> | undefined,
): Array<ObjectID> {
  const seen: Set<string> = new Set<string>();
  const ids: Array<ObjectID> = [];

  for (const record of records || []) {
    if (!record.id) {
      continue;
    }

    const key: string = record.id.toString().toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    ids.push(record.id);
  }

  return ids;
}

/*
 * The one open record a rule may have per table, found by its fingerprint.
 * Shared by the adoption check on the create paths and by the auto-resolve-off
 * check on the resolve path, so the two can never disagree about "open".
 */
async function findOpenBurnRateAlert(data: {
  context: SloEvaluationContext;
  fingerprint: string;
}): Promise<Alert | null> {
  return await AlertService.findOneBy({
    query: {
      projectId: data.context.projectId,
      seriesFingerprint: data.fingerprint,
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
}

async function findOpenBurnRateIncident(data: {
  context: SloEvaluationContext;
  fingerprint: string;
}): Promise<Incident | null> {
  return await IncidentService.findOneBy({
    query: {
      projectId: data.context.projectId,
      seriesFingerprint: data.fingerprint,
      currentIncidentState: {
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
}

/*
 * Adds the rule's owner teams and users - and the SLO's owners, when the rule
 * asks for them - to a record that was just created.
 *
 * Owners are added after the create, the MonitorAlert / MonitorIncident way,
 * and with notifyOwners on, the same as monitor criteria: an owner nobody tells
 * about the page they own is not much of an owner.
 *
 * Never throws. The record already exists, and a failure here (a user removed
 * mid-tick, a transient write error) must not leave it unstamped - the
 * resolution branch would never close it.
 */
async function addBurnRateRecordOwners(data: {
  output: BurnRateOutputKind;
  context: SloEvaluationContext;
  ruleId: ObjectID;
  recordId: ObjectID | undefined;
  ownerUsers: Array<User> | undefined;
  ownerTeams: Array<Team> | undefined;
  addSloOwners: boolean;
  fire: BurnRateFire;
  logAttributes: LogAttributes;
}): Promise<void> {
  try {
    const sloOwnerUsers: Array<User> = data.addSloOwners
      ? await data.fire.getSloOwnerUsers()
      : [];

    const requestedUserIds: Array<ObjectID> = uniqueIdsOf([
      ...(data.ownerUsers || []),
      ...sloOwnerUsers,
    ]);
    const requestedTeamIds: Array<ObjectID> = uniqueIdsOf(data.ownerTeams);

    if (requestedUserIds.length === 0 && requestedTeamIds.length === 0) {
      return;
    }

    if (!data.recordId) {
      logger.error(
        `Slo:EvaluateSlos - Cannot add owners to the ${data.output} burn rate rule ${data.ruleId.toString()} just created: the create returned no id.`,
        data.logAttributes,
      );
      return;
    }

    const owners: OwnersToAssign = await getBurnRateOwnersToAssign({
      output: data.output,
      recordId: data.recordId,
      userIds: requestedUserIds,
      teamIds: requestedTeamIds,
      logAttributes: data.logAttributes,
    });

    if (owners.userIds.length === 0 && owners.teamIds.length === 0) {
      return;
    }

    if (data.output === "alert") {
      await AlertService.addOwners(
        data.context.projectId,
        data.recordId,
        owners.userIds,
        owners.teamIds,
        true,
        {
          isRoot: true,
        },
      );
    } else {
      await IncidentService.addOwners(
        data.context.projectId,
        data.recordId,
        owners.userIds,
        owners.teamIds,
        true,
        {
          isRoot: true,
        },
      );
    }
  } catch (err) {
    logger.error(
      `Slo:EvaluateSlos - Error adding owners to the ${data.output} created by burn rate rule ${data.ruleId.toString()}: ${err}`,
      data.logAttributes,
    );
  }
}

/*
 * The owners actually worth adding. Owner rows have no unique constraint, and
 * the owner-added jobs notify every member of a team row and every user row
 * independently, so two overlaps would each add - and notify - one person
 * twice:
 *
 *   - an owner already on the record. The project's own alert and incident
 *     owner rules run from the create hook and can get there first; the rule
 *     engines skip owners already present through this same helper.
 *   - a user who is a member of a team being added. With "add SLO owners" on,
 *     the SLO's owner teams arrive expanded into users (see
 *     ServiceLevelObjectiveService.findOwners), so a team that owns both the
 *     SLO and the rule's output reached each of its members twice. The team
 *     row already covers them: TeamMemberService.getUsersInTeams is the same
 *     membership the owner-added job notifies from.
 *
 * A failed read must not cost the record its owners, so it falls back to the
 * requested set: a duplicate notification beats an owner nobody told.
 */
async function getBurnRateOwnersToAssign(data: {
  output: BurnRateOutputKind;
  recordId: ObjectID;
  userIds: Array<ObjectID>;
  teamIds: Array<ObjectID>;
  logAttributes: LogAttributes;
}): Promise<OwnersToAssign> {
  try {
    const notYetAssigned: OwnersToAssign =
      data.output === "alert"
        ? await OwnerRuleAssignment.getOwnersNotYetAssigned({
            ownerUserService: AlertOwnerUserService,
            ownerTeamService: AlertOwnerTeamService,
            resourceIdColumn: "alertId",
            resourceId: data.recordId,
            userIds: data.userIds,
            teamIds: data.teamIds,
          })
        : await OwnerRuleAssignment.getOwnersNotYetAssigned({
            ownerUserService: IncidentOwnerUserService,
            ownerTeamService: IncidentOwnerTeamService,
            resourceIdColumn: "incidentId",
            resourceId: data.recordId,
            userIds: data.userIds,
            teamIds: data.teamIds,
          });

    if (notYetAssigned.userIds.length === 0 || data.teamIds.length === 0) {
      return notYetAssigned;
    }

    /*
     * Every requested team counts, including one already on the record: its
     * row covers its members just the same.
     */
    const teamMembers: Array<User> = await TeamMemberService.getUsersInTeams(
      data.teamIds,
    );

    const coveredUserIds: Set<string> = new Set<string>(
      teamMembers.map((member: User): string => {
        return member.id?.toString().toLowerCase() || "";
      }),
    );

    return {
      userIds: notYetAssigned.userIds.filter((userId: ObjectID): boolean => {
        return !coveredUserIds.has(userId.toString().toLowerCase());
      }),
      teamIds: notYetAssigned.teamIds,
    };
  } catch (err) {
    logger.error(
      `Slo:EvaluateSlos - Could not de-duplicate the owners of the ${data.output} ${data.recordId.toString()}; adding them as requested: ${err}`,
      data.logAttributes,
    );

    return {
      userIds: data.userIds,
      teamIds: data.teamIds,
    };
  }
}

// "ALT-12" when the project numbers with a prefix, "#12" otherwise.
function formatRecordNumber(
  numberWithPrefix: string | undefined,
  recordNumber: number | undefined,
): string | undefined {
  if (numberWithPrefix) {
    return numberWithPrefix;
  }

  if (typeof recordNumber === "number") {
    return `#${recordNumber}`;
  }

  return undefined;
}

/*
 * "Burn rate rule X raised Alert #12" on the SLO's own feed.
 *
 * Posted from the create paths only after a REAL create - never on adoption,
 * which finds a record an earlier tick already created (and posted). The feed
 * service never throws, but building the item can (the record link reads the
 * dashboard URL), and a feed item must never cost a record its stamp, so the
 * whole post is caught here. Every user-controlled name is escaped: feeds
 * render without safe mode. `postedAt` is the evaluation clock, so the item
 * sits at the moment the rule fired.
 *
 * A PRIVATE record is redacted: no title, no number, no link. Only its owners
 * and project admins may see a private alert or incident, but the SLO feed is
 * readable by every project member and viewer, and no alert or incident
 * privacy filter applies to feed rows. So the item says only that the rule
 * raised a private record, plus the burn numbers - SLO data those readers can
 * already see on the SLO itself.
 */
async function postBurnRateRaisedFeedItem(data: {
  output: BurnRateOutputKind;
  context: SloEvaluationContext;
  rule: ServiceLevelObjectiveBurnRateRule;
  recordId: ObjectID | undefined;
  recordNumber: string | undefined;
  isPrivate: boolean;
  declaration: BurnRateDeclaration;
  copy: BurnRateOutputCopy;
  logAttributes: LogAttributes;
}): Promise<void> {
  const { context, rule } = data;
  const isAlert: boolean = data.output === "alert";

  try {
    if (data.isPrivate) {
      const variables: SloBurnRateTemplateVariables =
        data.declaration.variables;

      await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
        {
          serviceLevelObjectiveId: context.sloId,
          projectId: context.projectId,
          serviceLevelObjectiveFeedEventType: isAlert
            ? ServiceLevelObjectiveFeedEventType.BurnRateAlertRaised
            : ServiceLevelObjectiveFeedEventType.BurnRateIncidentDeclared,
          feedInfoInMarkdown: `Burn rate rule **${escapeMarkdownInline(rule.name)}** ${isAlert ? "raised a private alert" : "declared a private incident"}.`,
          moreInformationInMarkdown: [
            `**Visibility:** Private - only its owners and project admins can see this ${isAlert ? "alert" : "incident"}.`,
            ...getBurnRateFeedMeasurementLines(variables),
          ]
            .map((line: string): string => {
              return `- ${line}`;
            })
            .join("\n"),
          displayColor: Red500,
          postedAt: context.now,
        },
      );
      return;
    }

    const recordLabel: string = data.recordNumber
      ? `${isAlert ? "Alert" : "Incident"} ${escapeMarkdownInline(data.recordNumber)}`
      : isAlert
        ? "an alert"
        : "an incident";

    let recordReference: string = recordLabel;

    if (data.recordId) {
      const recordLink: string = isAlert
        ? (
            await AlertService.getAlertLinkInDashboard(
              context.projectId,
              data.recordId,
            )
          ).toString()
        : (
            await IncidentService.getIncidentLinkInDashboard(
              context.projectId,
              data.recordId,
            )
          ).toString();

      recordReference = `[${recordLabel}](${recordLink})`;
    }

    const variables: SloBurnRateTemplateVariables = data.declaration.variables;

    const moreInformation: Array<string> = [
      `**Title:** ${escapeMarkdownInline(data.copy.title)}`,
      ...getBurnRateFeedMeasurementLines(variables),
    ];

    await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
      serviceLevelObjectiveId: context.sloId,
      projectId: context.projectId,
      serviceLevelObjectiveFeedEventType: isAlert
        ? ServiceLevelObjectiveFeedEventType.BurnRateAlertRaised
        : ServiceLevelObjectiveFeedEventType.BurnRateIncidentDeclared,
      feedInfoInMarkdown: `Burn rate rule **${escapeMarkdownInline(rule.name)}** ${isAlert ? "raised" : "declared"} ${recordReference}.`,
      moreInformationInMarkdown: moreInformation
        .map((line: string): string => {
          return `- ${line}`;
        })
        .join("\n"),
      displayColor: Red500,
      postedAt: context.now,
    });
  } catch (err) {
    logger.error(
      `Slo:EvaluateSlos - Error posting the feed item for the ${data.output} burn rate rule ${rule.id?.toString()} created: ${err}`,
      data.logAttributes,
    );
  }
}

/*
 * The burn numbers a raised item quotes - the same ones the record carries.
 * All of it is SLO data (windows, rates, threshold, budget), which is why a
 * private record's redacted item may still show it.
 */
function getBurnRateFeedMeasurementLines(
  variables: SloBurnRateTemplateVariables,
): Array<string> {
  return [
    `**Burn rate over the last ${variables[SloBurnRateTemplateVariable.LongWindowInMinutes]} minutes:** ${variables[SloBurnRateTemplateVariable.LongWindowBurnRate]}x`,
    `**Burn rate over the last ${variables[SloBurnRateTemplateVariable.ShortWindowInMinutes]} minutes:** ${variables[SloBurnRateTemplateVariable.ShortWindowBurnRate]}x`,
    `**Threshold:** ${variables[SloBurnRateTemplateVariable.BurnRateThreshold]}x`,
    `**Error budget remaining:** ${variables[SloBurnRateTemplateVariable.ErrorBudgetRemainingPercentage]}% (${variables[SloBurnRateTemplateVariable.ErrorBudgetRemaining]})`,
  ];
}

/*
 * "The alert raised by burn rate rule X was resolved" - posted only for a side
 * whose resolve stamp was just written. A record closed by hand while
 * auto-resolve is off gets its own wording: the rule did not resolve it, it
 * only noticed that someone had, and that the rule can now fire again.
 */
async function postBurnRateResolvedFeedItem(data: {
  output: BurnRateOutputKind;
  closure: BurnRateOutputClosure;
  context: SloEvaluationContext;
  rule: ServiceLevelObjectiveBurnRateRule;
  rootCause: string;
}): Promise<void> {
  const { context, rule } = data;
  const isAlert: boolean = data.output === "alert";
  const record: string = isAlert ? "alert" : "incident";
  const createdVerb: string = isAlert ? "raised" : "declared";
  const ruleName: string = escapeMarkdownInline(rule.name);

  try {
    await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
      serviceLevelObjectiveId: context.sloId,
      projectId: context.projectId,
      serviceLevelObjectiveFeedEventType: isAlert
        ? ServiceLevelObjectiveFeedEventType.BurnRateAlertResolved
        : ServiceLevelObjectiveFeedEventType.BurnRateIncidentResolved,
      feedInfoInMarkdown:
        data.closure === "resolved-by-hand"
          ? `The ${record} ${createdVerb} by burn rate rule **${ruleName}** was resolved by hand. The burn has recovered, so the rule can fire again.`
          : `The ${record} ${createdVerb} by burn rate rule **${ruleName}** was resolved.`,
      moreInformationInMarkdown:
        data.closure === "resolved-by-hand"
          ? `Auto-resolve is off for this rule's ${record}, so it stayed open until someone resolved it.`
          : `**Reason:** ${data.rootCause}`,
      displayColor: Green500,
      postedAt: context.now,
    });
  } catch (err) {
    logger.error(
      `Slo:EvaluateSlos - Error posting the resolved feed item for the ${record} of burn rate rule ${rule.id?.toString()}: ${err}`,
      {
        projectId: context.projectId.toString(),
        sloId: context.sloId.toString(),
      } as LogAttributes,
    );
  }
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
