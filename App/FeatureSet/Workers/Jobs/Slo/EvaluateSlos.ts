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
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import { DisableAutomaticAlertCreation } from "Common/Server/EnvironmentConfig";
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

// How far in the future the next full evaluation is scheduled.
const EVALUATION_CADENCE_MINUTES: number = 5;

// Lookback for the "current burn rate" state column shown on the SLO overview.
const CURRENT_BURN_RATE_WINDOW_MINUTES: number = 60;

// Minimum interval between status-change owner notifications for one SLO.
const STATUS_NOTIFICATION_MIN_INTERVAL_MINUTES: number = 60;

const DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE: number = 20;

const DEFAULT_ROLLING_WINDOW_DAYS: number = 30;

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
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(10),
  },
  async () => {
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
   * Stamp the cadence columns FIRST — this is the overlap guard: even if this
   * evaluation throws below, the SLO is not retried every minute, and two
   * worker ticks never evaluate the same SLO concurrently.
   */
  await ServiceLevelObjectiveService.updateOneById({
    id: sloId,
    data: {
      lastEvaluatedAt: now,
      nextEvaluationAt: OneUptimeDate.addRemoveMinutes(
        now,
        EVALUATION_CADENCE_MINUTES,
      ),
    },
    props: {
      isRoot: true,
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
    await setSloStatusIfChanged(slo, SloStatus.Misconfigured);
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
    await setSloStatusIfChanged(slo, SloStatus.Misconfigured);
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
    await setSloStatusIfChanged(slo, SloStatus.Paused);
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
        minimumSampleCount: true,
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
   */
  const shouldNotifyOwners: boolean =
    newStatus !== previousStatus &&
    (newStatus === SloStatus.AtRisk ||
      newStatus === SloStatus.BudgetExhausted) &&
    (!slo.statusChangeNotificationSentAt ||
      OneUptimeDate.getDifferenceInMinutes(
        now,
        slo.statusChangeNotificationSentAt,
      ) >= STATUS_NOTIFICATION_MIN_INTERVAL_MINUTES);

  const stateUpdate: {
    currentSliPercentage: number;
    errorBudgetRemainingPercentage: number;
    errorBudgetRemainingSeconds: number;
    errorBudgetTotalSeconds: number;
    currentBurnRate: number;
    sloStatus: SloStatus;
    statusChangeNotificationSentAt?: Date;
  } = {
    currentSliPercentage: sli.sliPercentage,
    errorBudgetRemainingPercentage: budget.budgetRemainingPercentage,
    errorBudgetRemainingSeconds: budget.budgetRemainingSeconds, // signed.
    errorBudgetTotalSeconds: budget.budgetTotalSeconds,
    currentBurnRate: currentBurnRate,
    sloStatus: newStatus,
  };

  if (shouldNotifyOwners) {
    stateUpdate.statusChangeNotificationSentAt = now;
  }

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
    await sendStatusChangeNotification({
      slo: slo,
      newStatus: newStatus,
      sli: sli,
      budget: budget,
      targetPercentage: targetPercentage,
    });
  }

  // Burn rate rules.
  let maintenanceCheckPromise: Promise<boolean> | null = null;

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
 * Sets sloStatus only when it actually changed — used by the Misconfigured /
 * Paused guards, which skip evaluation entirely.
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

  const hasUnresolvedFiringState: boolean = Boolean(
    rule.lastAlertCreatedAt &&
      (!rule.lastAlertResolvedAt ||
        rule.lastAlertResolvedAt.getTime() < rule.lastAlertCreatedAt.getTime()),
  );

  if (!hasUnresolvedFiringState) {
    return;
  }

  await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
    serviceLevelObjectiveId: context.sloId,
    burnRateRuleId: rule.id,
    projectId: context.projectId,
    rootCause: "Burn rate dropped below threshold.",
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
 */
async function sendStatusChangeNotification(data: {
  slo: ServiceLevelObjective;
  newStatus: SloStatus;
  sli: TimeSliResult;
  budget: ErrorBudgetResult;
  targetPercentage: number;
}): Promise<void> {
  const { slo, newStatus, sli, budget } = data;

  if (!slo.id || !slo.projectId) {
    return;
  }

  try {
    let owners: Array<User> = await ServiceLevelObjectiveService.findOwners(
      slo.id,
    );

    if (owners.length === 0) {
      owners = await ProjectService.getOwners(slo.projectId);
    }

    if (owners.length === 0) {
      return;
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
        message: `SLO ${newStatus}: "${sloName}" in ${projectName}. Error budget remaining: ${errorBudgetRemainingPercentage}% (${errorBudgetRemainingMinutes} minutes). View the SLO in the OneUptime Dashboard.`,
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is an alert from OneUptime. The service level objective ${sloName} is now ${newStatus}. Error budget remaining is ${errorBudgetRemainingPercentage} percent. Please check the OneUptime Dashboard.`,
          },
        ],
      };

      const pushMessage: PushNotificationMessage = {
        title: `SLO ${newStatus}`,
        body: `SLO "${sloName}" is now ${newStatus}. Error budget remaining: ${errorBudgetRemainingPercentage}%.`,
      };

      const whatsAppMessage: WhatsAppMessagePayload = {
        body: sms.message,
      };

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
    }

    logger.info(
      `Slo:EvaluateSlos - Sent SLO status change notification for SLO ${slo.id.toString()} (now ${newStatus}).`,
      {
        projectId: slo.projectId.toString(),
        sloId: slo.id.toString(),
      } as LogAttributes,
    );
  } catch (err) {
    logger.error(
      `Slo:EvaluateSlos - Error sending status change notification for SLO ${slo.id?.toString()}: ${err}`,
      {
        projectId: slo.projectId?.toString(),
        sloId: slo.id?.toString(),
      } as LogAttributes,
    );
  }
}

/*
 * Display-only rounding for alert descriptions and notification bodies.
 * State columns and history rows are always persisted unrounded.
 */
function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
