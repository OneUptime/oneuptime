/*
 * Pinned before any import: EnvironmentConfig reads it at module load time, and
 * these tests assert that burn-rate alerts ARE created.
 */
process.env["DISABLE_AUTOMATIC_ALERT_CREATION"] = "false";

import Alert from "Common/Models/DatabaseModels/Alert";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import User from "Common/Models/DatabaseModels/User";
import { Green, Red } from "Common/Types/BrandColors";
import OneUptimeDate, { Moment } from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";

/*
 * End-to-end regression tests for the SLO evaluation worker.
 *
 * EvaluateSlos.ts has no exported functions: it registers one cron job at import
 * time and keeps every helper module-local. So the Cron util is mocked to CAPTURE
 * the registered handler instead of scheduling it (the same mock the other
 * App/Tests/Workers/Jobs suites use, extended from a no-op to a recorder), and
 * every service the job touches is replaced with just the methods it calls. Each
 * test then drives one full worker tick through the captured handler and asserts
 * on what was persisted / notified / alerted.
 *
 * The behaviours pinned here are the six adversarial-review fixes:
 *   1. the full-long-window gate (a 5-minute-old monitor must not page a
 *      60-minute burn rule),
 *   2a. an escalation into BudgetExhausted bypasses the 60-minute notification
 *      rate limit, 2b. the rate-limit timer is stamped only after a send that
 *      actually dispatched,
 *   3. the zero-data guard (no timeline rows => Misconfigured, never a healthy
 *      100% SLI with history rows),
 *   4. the Paused / Misconfigured guards resolve open burn-rate alerts on the
 *      TRANSITION (and only then),
 *   5. burn-rate alerts resolve on the LONG window only,
 *   6. an already-open alert with the same fingerprint suppresses duplicates.
 *
 * ...plus the five fixes of the second adversarial review:
 *   7. the two error-budget SECOND columns are Postgres integers and must be
 *      persisted rounded (unrounded, every 99.9% SLO killed its own evaluation
 *      with `invalid input syntax for type integer`),
 *   8. the whole sweep runs under one Redis mutex (the per-SLO cadence stamp was
 *      never an overlap guard),
 *   9. the full-long-window gate blocks FIRING only — an already-open alert is
 *      still resolved when the long window is no longer measurable,
 *  10. the guard-path resolve runs BEFORE the status is committed, so a failure
 *      is retried on the next tick instead of stranding the alert,
 *  11. worker bookkeeping columns are written through the hookless fast path
 *      (no workflow POST / realtime broadcast per tick per SLO).
 */

type CronHandler = () => Promise<void>;

/*
 * Captured cron handlers, keyed by job name. Must be declared before the
 * EvaluateSlos import below so the mock factory closure can see it.
 */
const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * The sweep now holds a Redis mutex for its whole duration. There is no Redis in
 * a unit test, so the real Semaphore would throw on every tick and the job would
 * skip the sweep entirely — it is mocked, and the tests below drive both the
 * acquired and the contended path explicitly.
 */
jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ServiceLevelObjectiveService", () => {
  return {
    __esModule: true,
    default: {
      getDueSlos: jest.fn(),
      updateOneById: jest.fn(),
      // the hookless fast path used for worker-owned bookkeeping columns.
      updateColumnsByIdWithoutHooks: jest.fn(),
      resolveOpenBurnRateAlertsForSlo: jest.fn(),
      findOwners: jest.fn(),
      getSloLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock(
  "Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService",
  () => {
    return {
      __esModule: true,
      default: {
        findBy: jest.fn(),
        updateOneById: jest.fn(),
        resolveOpenAlertsForRule: jest.fn(),
        getBurnRateAlertFingerprint: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Services/MonitorStatusTimelineService", () => {
  return { __esModule: true, default: { findAllBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/SloHistoryService", () => {
  return { __esModule: true, default: { insertHistoryRows: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn(), create: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertSeverityService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { getOwners: jest.fn(), findOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return {
    __esModule: true,
    default: {
      ensureSettingExistsForUser: jest.fn(),
      sendUserNotification: jest.fn(),
    },
  };
});

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
import SloHistoryService from "Common/Server/Services/SloHistoryService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Slo/EvaluateSlos";

interface SloServiceMock {
  getDueSlos: jest.Mock;
  updateOneById: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
  resolveOpenBurnRateAlertsForSlo: jest.Mock;
  findOwners: jest.Mock;
  getSloLinkInDashboard: jest.Mock;
}

interface BurnRuleServiceMock {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  resolveOpenAlertsForRule: jest.Mock;
  getBurnRateAlertFingerprint: jest.Mock;
}

const sloService: SloServiceMock =
  ServiceLevelObjectiveService as unknown as SloServiceMock;
const burnRuleService: BurnRuleServiceMock =
  ServiceLevelObjectiveBurnRateRuleService as unknown as BurnRuleServiceMock;
const timelineService: { findAllBy: jest.Mock } =
  MonitorStatusTimelineService as unknown as { findAllBy: jest.Mock };
const monitorStatusService: { findBy: jest.Mock } =
  MonitorStatusService as unknown as { findBy: jest.Mock };
const monitorService: { findBy: jest.Mock } = MonitorService as unknown as {
  findBy: jest.Mock;
};
const historyService: { insertHistoryRows: jest.Mock } =
  SloHistoryService as unknown as { insertHistoryRows: jest.Mock };
const alertService: { findOneBy: jest.Mock; create: jest.Mock } =
  AlertService as unknown as { findOneBy: jest.Mock; create: jest.Mock };
const severityService: { findOneBy: jest.Mock } =
  AlertSeverityService as unknown as { findOneBy: jest.Mock };
const projectService: { getOwners: jest.Mock; findOneById: jest.Mock } =
  ProjectService as unknown as { getOwners: jest.Mock; findOneById: jest.Mock };
const maintenanceService: { findBy: jest.Mock } =
  ScheduledMaintenanceService as unknown as { findBy: jest.Mock };
const notificationService: {
  ensureSettingExistsForUser: jest.Mock;
  sendUserNotification: jest.Mock;
} = UserNotificationSettingService as unknown as {
  ensureSettingExistsForUser: jest.Mock;
  sendUserNotification: jest.Mock;
};
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};
const semaphore: { lock: jest.Mock; release: jest.Mock } =
  Semaphore as unknown as { lock: jest.Mock; release: jest.Mock };

// Stand-in for the redis-semaphore Mutex the job holds for the whole sweep.
const SWEEP_MUTEX: SemaphoreMutex = {
  identifier: "sweep-mutex",
} as unknown as SemaphoreMutex;

/*
 * Everything is relative to a pinned "now" so the burn windows and the data-age
 * gate are exact - the same discipline as SloUtil.test.ts.
 */
const NOW: Date = new Date("2026-07-19T00:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const SLO_ID: ObjectID = new ObjectID("slo-1");
const RULE_ID: ObjectID = new ObjectID("rule-1");
const MONITOR_A_ID: ObjectID = new ObjectID("monitor-a");
const MONITOR_B_ID: ObjectID = new ObjectID("monitor-b");
const OFFLINE_STATUS_ID: ObjectID = new ObjectID("status-offline");
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID("status-operational");
const SEVERITY_ID: ObjectID = new ObjectID("severity-1");
const POLICY_ID: ObjectID = new ObjectID("policy-1");
const OWNER_ID: ObjectID = new ObjectID("user-1");
const SECOND_OWNER_ID: ObjectID = new ObjectID("user-2");

/*
 * The fingerprint format of ServiceLevelObjectiveBurnRateRuleService, mirrored
 * here so the mocked service returns what the real one would.
 */
const EXPECTED_FINGERPRINT: string = "slo:slo-1:burn-rule:rule-1";

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function hoursAgo(hours: number): Date {
  return minutesAgo(hours * 60);
}

function daysAgo(days: number): Date {
  return hoursAgo(days * 24);
}

const offlineStatus: MonitorStatus = new MonitorStatus();
offlineStatus.id = OFFLINE_STATUS_ID;
offlineStatus.name = "Offline";
offlineStatus.priority = 2;
offlineStatus.color = Red;
offlineStatus.isOperationalState = false;

const operationalStatus: MonitorStatus = new MonitorStatus();
operationalStatus.id = OPERATIONAL_STATUS_ID;
operationalStatus.name = "Operational";
operationalStatus.priority = 1;
operationalStatus.color = Green;
operationalStatus.isOperationalState = true;

function timelineRow(data: {
  monitorId: ObjectID;
  status: MonitorStatus;
  startsAt: Date;
  endsAt?: Date | undefined;
}): MonitorStatusTimeline {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row.monitorId = data.monitorId;
  row.monitorStatusId = data.status.id!;
  row.monitorStatus = data.status;
  row.startsAt = data.startsAt;

  // endsAt is left unset for open rows, matching the database rows.
  if (data.endsAt) {
    row.endsAt = data.endsAt;
  }

  return row;
}

function down(
  startsAt: Date,
  endsAt?: Date | undefined,
  monitorId: ObjectID = MONITOR_A_ID,
): MonitorStatusTimeline {
  return timelineRow({
    monitorId: monitorId,
    status: offlineStatus,
    startsAt: startsAt,
    endsAt: endsAt,
  });
}

function up(
  startsAt: Date,
  endsAt?: Date | undefined,
  monitorId: ObjectID = MONITOR_A_ID,
): MonitorStatusTimeline {
  return timelineRow({
    monitorId: monitorId,
    status: operationalStatus,
    startsAt: startsAt,
    endsAt: endsAt,
  });
}

function enabledMonitor(monitorId: ObjectID): Monitor {
  const monitor: Monitor = new Monitor(monitorId);
  monitor.disableActiveMonitoring = false;
  monitor.disableActiveMonitoringBecauseOfManualIncident = false;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;
  return monitor;
}

interface SloOverrides {
  sloStatus?: SloStatus | undefined;
  monitors?: Array<Monitor> | undefined;
  targetPercentage?: number | undefined;
  windowDays?: number | undefined;
  windowType?: SloWindowType | undefined;
  timezone?: string | undefined;
  sliType?: SliType | undefined;
  multiMonitorMode?: SloMultiMonitorMode | undefined;
  atRiskThresholdPercentage?: number | undefined;
  statusChangeNotificationSentAt?: Date | undefined;
}

/*
 * A rolling 1-day / 99% SLO over one always-monitored monitor: the error budget
 * is exactly 864 seconds, which makes every status assertion below arithmetic
 * rather than guesswork.
 */
function makeSlo(overrides: SloOverrides = {}): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(SLO_ID);
  slo.projectId = PROJECT_ID;
  slo.name = "Checkout availability";
  slo.sliType = overrides.sliType ?? SliType.MonitorUptime;
  slo.multiMonitorMode =
    overrides.multiMonitorMode ?? SloMultiMonitorMode.AnyDown;
  slo.monitors = overrides.monitors ?? [new Monitor(MONITOR_A_ID)];
  slo.downtimeMonitorStatuses = [offlineStatus];
  slo.targetPercentage = overrides.targetPercentage ?? 99;
  slo.windowType = overrides.windowType ?? SloWindowType.Rolling;
  slo.windowDays = overrides.windowDays ?? 1;
  slo.sloStatus = overrides.sloStatus ?? SloStatus.Healthy;
  slo.atRiskThresholdPercentage = overrides.atRiskThresholdPercentage ?? 20;

  if (overrides.timezone) {
    slo.timezone = overrides.timezone;
  }

  if (overrides.statusChangeNotificationSentAt) {
    slo.statusChangeNotificationSentAt =
      overrides.statusChangeNotificationSentAt;
  }

  return slo;
}

interface RuleOverrides {
  burnRateThreshold?: number | undefined;
  longWindowInMinutes?: number | undefined;
  shortWindowInMinutes?: number | undefined;
  refireSuppressionMinutes?: number | undefined;
  lastAlertCreatedAt?: Date | undefined;
  lastAlertResolvedAt?: Date | undefined;
  onCallDutyPolicies?: Array<OnCallDutyPolicy> | undefined;
}

// A canonical fast-burn rule: 14.4x over a 60-minute long / 5-minute short window.
function makeRule(
  overrides: RuleOverrides = {},
): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule(RULE_ID);
  rule.projectId = PROJECT_ID;
  rule.serviceLevelObjectiveId = SLO_ID;
  rule.name = "Fast burn";
  rule.isEnabled = true;
  rule.burnRateThreshold = overrides.burnRateThreshold ?? 14.4;
  rule.longWindowInMinutes = overrides.longWindowInMinutes ?? 60;
  rule.shortWindowInMinutes = overrides.shortWindowInMinutes ?? 5;
  rule.alertSeverityId = SEVERITY_ID;
  rule.onCallDutyPolicies = overrides.onCallDutyPolicies ?? [];

  if (overrides.refireSuppressionMinutes !== undefined) {
    rule.refireSuppressionMinutes = overrides.refireSuppressionMinutes;
  }

  if (overrides.lastAlertCreatedAt) {
    rule.lastAlertCreatedAt = overrides.lastAlertCreatedAt;
  }

  if (overrides.lastAlertResolvedAt) {
    rule.lastAlertResolvedAt = overrides.lastAlertResolvedAt;
  }

  return rule;
}

interface TimelineQueryArgs {
  query: { monitorId: ObjectID };
}

function stubTimelines(
  rowsByMonitorId: Record<string, Array<MonitorStatusTimeline>>,
): void {
  timelineService.findAllBy.mockImplementation((args: unknown) => {
    const monitorId: string = (
      args as TimelineQueryArgs
    ).query.monitorId.toString();

    return Promise.resolve(rowsByMonitorId[monitorId] || []);
  });
}

interface UpdateCallArgs {
  id: ObjectID;
  data: Record<string, unknown>;
}

function payloadsOf(mock: jest.Mock): Array<Record<string, unknown>> {
  return mock.mock.calls.map((args: Array<unknown>) => {
    return (args[0] as UpdateCallArgs).data;
  });
}

/*
 * The SLO row is written through two paths, and which one a column takes is
 * itself a pinned behaviour (fix 11): `updateOneById` runs the full pipeline
 * (workflow HTTP POST + realtime broadcast) and carries user-facing state, while
 * `updateColumnsByIdWithoutHooks` is the raw single-UPDATE fast path used for the
 * worker's own bookkeeping columns.
 */
function sloHookedUpdatePayloads(): Array<Record<string, unknown>> {
  return payloadsOf(sloService.updateOneById);
}

function sloHooklessUpdatePayloads(): Array<Record<string, unknown>> {
  return payloadsOf(sloService.updateColumnsByIdWithoutHooks);
}

// Every column written this tick, whichever path it took.
function sloUpdatePayloads(): Array<Record<string, unknown>> {
  return [...sloHookedUpdatePayloads(), ...sloHooklessUpdatePayloads()];
}

function payloadsContaining(
  calls: Array<Record<string, unknown>>,
  field: string,
): Array<Record<string, unknown>> {
  return calls.filter((data: Record<string, unknown>) => {
    return Object.prototype.hasOwnProperty.call(data, field);
  });
}

/*
 * The last sloStatus the worker actually persisted for this tick. Read from the
 * HOOKED path deliberately: a status transition must stay observable to
 * workflows and to the realtime dashboard.
 */
function persistedSloStatus(): unknown {
  const statusWrites: Array<Record<string, unknown>> = payloadsContaining(
    sloHookedUpdatePayloads(),
    "sloStatus",
  );

  return statusWrites.length > 0
    ? statusWrites[statusWrites.length - 1]!["sloStatus"]
    : undefined;
}

function persistedStateUpdate(): Record<string, unknown> {
  const stateWrites: Array<Record<string, unknown>> = payloadsContaining(
    sloHookedUpdatePayloads(),
    "currentSliPercentage",
  );

  expect(stateWrites).toHaveLength(1);
  return stateWrites[0]!;
}

function createdAlert(): Alert {
  expect(alertService.create).toHaveBeenCalledTimes(1);
  return (alertService.create.mock.calls[0]![0] as { data: Alert }).data;
}

/*
 * Reads the date bound into one of QueryHelper's Raw predicates (typeorm keeps
 * the bound parameters on the FindOperator).
 */
function boundDateOf(predicate: unknown): Date {
  const parameters: Record<string, Date> | undefined = (
    predicate as { objectLiteralParameters?: Record<string, Date> | undefined }
  ).objectLiteralParameters;

  expect(parameters).toBeDefined();

  const values: Array<Date> = Object.values(parameters!);

  expect(values).toHaveLength(1);

  return values[0]!;
}

function historyRowsWritten(): Array<{ metricName: string; value: number }> {
  const rows: Array<{ metricName: string; value: number }> = [];

  for (const call of historyService.insertHistoryRows.mock.calls) {
    rows.push(...(call[0] as Array<{ metricName: string; value: number }>));
  }

  return rows;
}

async function runWorkerTick(): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs["Slo:EvaluateSlos"];

  if (!handler) {
    throw new Error(
      "Slo:EvaluateSlos did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("Slo:EvaluateSlos worker", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    /*
     * "now" is pinned by stubbing the two clock sources OneUptimeDate exposes
     * (getCurrentDate, and getCurrentMomentDate which getSomeDaysAgo builds the
     * rolling window from) rather than with jest fake timers: the node test
     * environment cannot hijack the read-only global `performance`. Stubbing the
     * shared OneUptimeDate module pins the clock for the job, SloUtil and
     * UptimeUtil alike - they all resolve to the same module instance.
     */
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    jest.spyOn(OneUptimeDate, "getCurrentMomentDate").mockImplementation(() => {
      // a fresh moment per call: getSomeDaysAgo mutates what it is given.
      return Moment(NOW);
    });

    semaphore.lock.mockResolvedValue(SWEEP_MUTEX);
    semaphore.release.mockResolvedValue(undefined);

    sloService.getDueSlos.mockResolvedValue([]);
    sloService.updateOneById.mockResolvedValue(undefined);
    sloService.updateColumnsByIdWithoutHooks.mockResolvedValue(undefined);
    sloService.resolveOpenBurnRateAlertsForSlo.mockResolvedValue(undefined);
    sloService.findOwners.mockResolvedValue([]);
    sloService.getSloLinkInDashboard.mockResolvedValue(
      "https://oneuptime.com/dashboard/slo/slo-1",
    );

    burnRuleService.findBy.mockResolvedValue([]);
    burnRuleService.updateOneById.mockResolvedValue(undefined);
    burnRuleService.resolveOpenAlertsForRule.mockResolvedValue(undefined);
    burnRuleService.getBurnRateAlertFingerprint.mockReturnValue(
      EXPECTED_FINGERPRINT,
    );

    timelineService.findAllBy.mockResolvedValue([]);
    monitorStatusService.findBy.mockResolvedValue([offlineStatus]);
    monitorService.findBy.mockResolvedValue([enabledMonitor(MONITOR_A_ID)]);
    historyService.insertHistoryRows.mockResolvedValue(undefined);
    alertService.findOneBy.mockResolvedValue(null);
    alertService.create.mockResolvedValue(new Alert());
    severityService.findOneBy.mockResolvedValue(null);
    projectService.getOwners.mockResolvedValue([]);
    projectService.findOneById.mockResolvedValue(null);
    maintenanceService.findBy.mockResolvedValue([]);
    notificationService.ensureSettingExistsForUser.mockResolvedValue(undefined);
    notificationService.sendUserNotification.mockResolvedValue(undefined);
  });

  describe("cadence stamping", () => {
    test("stamps lastEvaluatedAt / nextEvaluationAt BEFORE any evaluation so a throwing SLO is not retried every minute", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo({ monitors: [] })]);

      await runWorkerTick();

      const cadenceWrites: Array<Record<string, unknown>> = payloadsContaining(
        sloHooklessUpdatePayloads(),
        "lastEvaluatedAt",
      );

      expect(cadenceWrites).toHaveLength(1);
      expect((cadenceWrites[0]!["lastEvaluatedAt"] as Date).getTime()).toBe(
        NOW.getTime(),
      );
      // five minutes ahead: the evaluation cadence, not the one-minute tick.
      expect((cadenceWrites[0]!["nextEvaluationAt"] as Date).getTime()).toBe(
        NOW.getTime() + 5 * 60 * 1000,
      );
    });

    test("one failing SLO is logged and the sweep still evaluates the next one", async () => {
      const failing: ServiceLevelObjective = makeSlo();
      const healthy: ServiceLevelObjective = makeSlo();

      sloService.getDueSlos.mockResolvedValue([failing, healthy]);
      monitorService.findBy
        .mockRejectedValueOnce(new Error("db connection reset"))
        .mockResolvedValue([enabledMonitor(MONITOR_A_ID)]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(10))] });

      await runWorkerTick();

      expect(mockedLogger.error).toHaveBeenCalled();
      // the second SLO still produced a full evaluation.
      expect(historyService.insertHistoryRows).toHaveBeenCalledTimes(1);
    });
  });

  describe("Misconfigured guard", () => {
    test("an SLO with no monitors is persisted Misconfigured, writes no history and creates no alert", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo({ monitors: [] })]);

      await runWorkerTick();

      expect(persistedSloStatus()).toBe(SloStatus.Misconfigured);
      expect(historyService.insertHistoryRows).not.toHaveBeenCalled();
      expect(alertService.create).not.toHaveBeenCalled();
      // returned before the monitor query - nothing to look up.
      expect(monitorService.findBy).not.toHaveBeenCalled();
    });

    test("a Metric SLI is Misconfigured (Phase 2) rather than evaluated as uptime", async () => {
      sloService.getDueSlos.mockResolvedValue([
        makeSlo({ sliType: SliType.Metric }),
      ]);

      await runWorkerTick();

      expect(persistedSloStatus()).toBe(SloStatus.Misconfigured);
      expect(historyService.insertHistoryRows).not.toHaveBeenCalled();
    });

    test.each([0, 100, 100.5, -1])(
      "a target of %s%% is Misconfigured instead of NaN-ing every budget formula",
      async (targetPercentage: number) => {
        sloService.getDueSlos.mockResolvedValue([
          makeSlo({ targetPercentage: targetPercentage }),
        ]);

        await runWorkerTick();

        expect(persistedSloStatus()).toBe(SloStatus.Misconfigured);
        expect(historyService.insertHistoryRows).not.toHaveBeenCalled();
      },
    );

    test("an SLO whose monitor rows no longer exist is Misconfigured", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      monitorService.findBy.mockResolvedValue([]);

      await runWorkerTick();

      expect(persistedSloStatus()).toBe(SloStatus.Misconfigured);
      expect(historyService.insertHistoryRows).not.toHaveBeenCalled();
    });
  });

  describe("zero-data guard (fix 3)", () => {
    test("monitors with zero timeline rows are Misconfigured, NOT a healthy 100% SLI", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubTimelines({});

      await runWorkerTick();

      expect(persistedSloStatus()).toBe(SloStatus.Misconfigured);
      // the state update (currentSliPercentage etc.) must never have run.
      expect(
        payloadsContaining(sloUpdatePayloads(), "currentSliPercentage"),
      ).toHaveLength(0);
    });

    test("writes NO sli.percent = 100 history row for a monitor that has never reported", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubTimelines({});

      await runWorkerTick();

      expect(historyService.insertHistoryRows).not.toHaveBeenCalled();
      expect(historyRowsWritten()).toHaveLength(0);
    });

    test("the same SLO self-heals into a real status on the first tick that has data", async () => {
      const slo: ServiceLevelObjective = makeSlo();
      sloService.getDueSlos.mockResolvedValue([slo]);
      stubTimelines({});

      await runWorkerTick();

      expect(persistedSloStatus()).toBe(SloStatus.Misconfigured);
      expect(slo.sloStatus).toBe(SloStatus.Misconfigured);

      // the monitor starts reporting; the very next tick measures for real.
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(10))] });

      await runWorkerTick();

      expect(persistedSloStatus()).toBe(SloStatus.Healthy);
      expect(persistedStateUpdate()["currentSliPercentage"]).toBe(100);
    });
  });

  describe("Paused guard (fix 4)", () => {
    test.each([
      "disableActiveMonitoring",
      "disableActiveMonitoringBecauseOfManualIncident",
      "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent",
    ])(
      "an SLO whose only monitor is disabled by %s is Paused",
      async (flag: string) => {
        const monitor: Monitor = enabledMonitor(MONITOR_A_ID);
        (monitor as unknown as Record<string, boolean>)[flag] = true;

        sloService.getDueSlos.mockResolvedValue([makeSlo()]);
        monitorService.findBy.mockResolvedValue([monitor]);

        await runWorkerTick();

        expect(persistedSloStatus()).toBe(SloStatus.Paused);
        expect(historyService.insertHistoryRows).not.toHaveBeenCalled();
      },
    );

    test("one still-enabled monitor keeps the SLO evaluating instead of Paused", async () => {
      const disabled: Monitor = enabledMonitor(MONITOR_B_ID);
      disabled.disableActiveMonitoring = true;

      sloService.getDueSlos.mockResolvedValue([
        makeSlo({
          monitors: [new Monitor(MONITOR_A_ID), new Monitor(MONITOR_B_ID)],
        }),
      ]);
      monitorService.findBy.mockResolvedValue([
        enabledMonitor(MONITOR_A_ID),
        disabled,
      ]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(10))] });

      await runWorkerTick();

      expect(persistedSloStatus()).toBe(SloStatus.Healthy);
    });

    test("resolves open burn-rate alerts ON THE TRANSITION into Paused", async () => {
      const monitor: Monitor = enabledMonitor(MONITOR_A_ID);
      monitor.disableActiveMonitoring = true;

      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      monitorService.findBy.mockResolvedValue([monitor]);

      await runWorkerTick();

      expect(sloService.resolveOpenBurnRateAlertsForSlo).toHaveBeenCalledTimes(
        1,
      );
      const resolveArgs: { sloId: ObjectID; projectId: ObjectID } = sloService
        .resolveOpenBurnRateAlertsForSlo.mock.calls[0]![0] as {
        sloId: ObjectID;
        projectId: ObjectID;
      };
      expect(resolveArgs.sloId.toString()).toBe(SLO_ID.toString());
      expect(resolveArgs.projectId.toString()).toBe(PROJECT_ID.toString());
    });

    test("does NOT re-resolve on a second tick that is already Paused", async () => {
      const monitor: Monitor = enabledMonitor(MONITOR_A_ID);
      monitor.disableActiveMonitoring = true;

      // the same SLO instance the worker mutates, as getDueSlos would return it.
      const slo: ServiceLevelObjective = makeSlo();
      sloService.getDueSlos.mockResolvedValue([slo]);
      monitorService.findBy.mockResolvedValue([monitor]);

      await runWorkerTick();
      await runWorkerTick();

      expect(slo.sloStatus).toBe(SloStatus.Paused);
      expect(sloService.resolveOpenBurnRateAlertsForSlo).toHaveBeenCalledTimes(
        1,
      );
      // and only the first tick wrote the status.
      expect(payloadsContaining(sloUpdatePayloads(), "sloStatus")).toHaveLength(
        1,
      );
    });

    test("an already-Misconfigured SLO does not re-resolve alerts either", async () => {
      sloService.getDueSlos.mockResolvedValue([
        makeSlo({ monitors: [], sloStatus: SloStatus.Misconfigured }),
      ]);

      await runWorkerTick();

      expect(sloService.resolveOpenBurnRateAlertsForSlo).not.toHaveBeenCalled();
    });
  });

  describe("state, budget and history for a real measurement", () => {
    /*
     * 800 seconds of downtime in the last 24 hours against a 99% target: the
     * budget is 864s, so 64s (7.41%) remain - inside the default 20% at-risk
     * threshold.
     */
    function stubAtRiskDowntime(): void {
      const downSince: Date = new Date(NOW.getTime() - 800 * 1000);

      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), downSince),
          down(downSince, NOW),
        ],
      });
    }

    test("persists unrounded SLI, signed budget seconds, burn rate and status in one update", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubAtRiskDowntime();

      await runWorkerTick();

      const state: Record<string, unknown> = persistedStateUpdate();

      // 800s bad out of 86400s.
      expect(state["currentSliPercentage"]).toBeCloseTo(99.0740740741, 8);
      expect(state["errorBudgetTotalSeconds"]).toBeCloseTo(864, 6);
      expect(state["errorBudgetRemainingSeconds"]).toBeCloseTo(64, 6);
      expect(state["errorBudgetRemainingPercentage"]).toBeCloseTo(
        7.4074074074,
        8,
      );
      // the display burn rate is the trailing 60 minutes: 800s / 3600s / 1%.
      expect(state["currentBurnRate"]).toBeCloseTo(22.2222222222, 8);
      expect(state["sloStatus"]).toBe(SloStatus.AtRisk);
    });

    test("writes exactly three unrounded, minute-floored history rows", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubAtRiskDowntime();

      await runWorkerTick();

      expect(historyService.insertHistoryRows).toHaveBeenCalledTimes(1);

      const rows: Array<{
        metricName: string;
        value: number;
        bucketStart: Date;
      }> = historyService.insertHistoryRows.mock.calls[0]![0] as Array<{
        metricName: string;
        value: number;
        bucketStart: Date;
      }>;

      expect(
        rows.map((row: { metricName: string }) => {
          return row.metricName;
        }),
      ).toEqual(["sli.percent", "error.budget.remaining.percent", "burn.rate"]);

      expect(rows[0]!.value).toBeCloseTo(99.0740740741, 8);
      expect(rows[1]!.value).toBeCloseTo(7.4074074074, 8);
      expect(rows[2]!.value).toBeCloseTo(22.2222222222, 8);
      expect(rows[0]!.bucketStart.getTime()).toBe(NOW.getTime());
    });

    test("a failing history write does not abort the evaluation or the burn rules", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([makeRule()]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), hoursAgo(3)),
          down(hoursAgo(3)),
        ],
      });
      historyService.insertHistoryRows.mockRejectedValue(
        new Error("clickhouse down"),
      );

      await runWorkerTick();

      expect(mockedLogger.error).toHaveBeenCalled();
      // the burn rule still fired despite the history failure.
      expect(alertService.create).toHaveBeenCalledTimes(1);
    });

    test("re-entering from Misconfigured classifies from the budget alone, never from the guard status", async () => {
      sloService.getDueSlos.mockResolvedValue([
        makeSlo({ sloStatus: SloStatus.Misconfigured }),
      ]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(10))] });

      await runWorkerTick();

      expect(persistedSloStatus()).toBe(SloStatus.Healthy);
    });

    test("a CalendarMonth SLO uses the FULL month as the budget denominator, not the elapsed part", async () => {
      // now is 19 July: 18 days elapsed of a 31-day month.
      sloService.getDueSlos.mockResolvedValue([
        makeSlo({ windowType: SloWindowType.CalendarMonth, timezone: "UTC" }),
      ]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(60))] });

      await runWorkerTick();

      // 1% of a 31-day month = 26784s of budget (not 1% of 18 days = 15552s).
      expect(persistedStateUpdate()["errorBudgetTotalSeconds"]).toBeCloseTo(
        26784,
        3,
      );
    });
  });

  describe("owner notification rate limit and escalation (fix 2)", () => {
    function stubAtRisk(): void {
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), new Date(NOW.getTime() - 800 * 1000)),
          down(new Date(NOW.getTime() - 800 * 1000), NOW),
        ],
      });
    }

    // 2000s of downtime against an 864s budget: the budget is gone.
    function stubExhausted(): void {
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), new Date(NOW.getTime() - 2000 * 1000)),
          down(new Date(NOW.getTime() - 2000 * 1000), NOW),
        ],
      });
    }

    function stubOneOwner(): void {
      const owner: User = new User(OWNER_ID);
      sloService.findOwners.mockResolvedValue([owner]);

      const project: Project = new Project();
      project.name = "Acme";
      projectService.findOneById.mockResolvedValue(project);
    }

    test("Healthy -> AtRisk notifies the owners and stamps statusChangeNotificationSentAt", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubAtRisk();
      stubOneOwner();

      await runWorkerTick();

      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);

      const stampWrites: Array<Record<string, unknown>> = payloadsContaining(
        sloHooklessUpdatePayloads(),
        "statusChangeNotificationSentAt",
      );
      expect(stampWrites).toHaveLength(1);
      expect(
        (stampWrites[0]!["statusChangeNotificationSentAt"] as Date).getTime(),
      ).toBe(NOW.getTime());
    });

    test("a send that throws for EVERY owner does NOT stamp the rate-limit timer (fix 2b)", async () => {
      /*
       * Stamping up front would silence the next 60 minutes of notifications
       * because of a notification nobody ever received - and since the new status
       * is persisted, no later tick sees a transition to retry.
       */
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubAtRisk();
      stubOneOwner();
      notificationService.sendUserNotification.mockRejectedValue(
        new Error("smtp down"),
      );

      await runWorkerTick();

      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);
      expect(
        payloadsContaining(
          sloUpdatePayloads(),
          "statusChangeNotificationSentAt",
        ),
      ).toHaveLength(0);
      // the status itself is still persisted.
      expect(persistedSloStatus()).toBe(SloStatus.AtRisk);
    });

    test("one broken owner does not cost the other owner its notification, and the stamp is written", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubAtRisk();
      sloService.findOwners.mockResolvedValue([
        new User(OWNER_ID),
        new User(SECOND_OWNER_ID),
      ]);
      notificationService.sendUserNotification
        .mockRejectedValueOnce(new Error("no notification setting"))
        .mockResolvedValue(undefined);

      await runWorkerTick();

      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(2);
      expect(
        payloadsContaining(
          sloHooklessUpdatePayloads(),
          "statusChangeNotificationSentAt",
        ),
      ).toHaveLength(1);
    });

    test("a repeated transition into AtRisk within 60 minutes is rate limited", async () => {
      sloService.getDueSlos.mockResolvedValue([
        makeSlo({ statusChangeNotificationSentAt: minutesAgo(10) }),
      ]);
      stubAtRisk();
      stubOneOwner();

      await runWorkerTick();

      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
      expect(persistedSloStatus()).toBe(SloStatus.AtRisk);
    });

    test("AtRisk -> BudgetExhausted notifies even 10 minutes into the rate-limit window (fix 2a)", async () => {
      /*
       * The escalation must never be swallowed: sloStatus is persisted as
       * BudgetExhausted, so a suppressed notification here is never retried -
       * the single most severe event in the system would be dropped for good.
       */
      sloService.getDueSlos.mockResolvedValue([
        makeSlo({
          sloStatus: SloStatus.AtRisk,
          statusChangeNotificationSentAt: minutesAgo(10),
        }),
      ]);
      stubExhausted();
      stubOneOwner();

      await runWorkerTick();

      expect(persistedSloStatus()).toBe(SloStatus.BudgetExhausted);
      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);

      const sendArgs: { emailEnvelope: { subject: string } } =
        notificationService.sendUserNotification.mock.calls[0]![0] as {
          emailEnvelope: { subject: string };
        };
      expect(sendArgs.emailEnvelope.subject).toContain("Budget Exhausted");

      expect(
        payloadsContaining(
          sloHooklessUpdatePayloads(),
          "statusChangeNotificationSentAt",
        ),
      ).toHaveLength(1);
    });

    test("staying BudgetExhausted tick after tick notifies nobody", async () => {
      sloService.getDueSlos.mockResolvedValue([
        makeSlo({ sloStatus: SloStatus.BudgetExhausted }),
      ]);
      stubExhausted();
      stubOneOwner();

      await runWorkerTick();

      expect(persistedSloStatus()).toBe(SloStatus.BudgetExhausted);
      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
    });

    test("a recovery to Healthy notifies nobody (only AtRisk / BudgetExhausted page owners)", async () => {
      sloService.getDueSlos.mockResolvedValue([
        makeSlo({ sloStatus: SloStatus.AtRisk }),
      ]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(10))] });
      stubOneOwner();

      await runWorkerTick();

      expect(persistedSloStatus()).toBe(SloStatus.Healthy);
      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
    });

    test("with no SLO owners and no project owners nothing is sent and no stamp is written", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubAtRisk();
      sloService.findOwners.mockResolvedValue([]);
      projectService.getOwners.mockResolvedValue([]);

      await runWorkerTick();

      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
      expect(
        payloadsContaining(
          sloUpdatePayloads(),
          "statusChangeNotificationSentAt",
        ),
      ).toHaveLength(0);
    });

    test("project owners are notified when the SLO itself has none", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubAtRisk();
      sloService.findOwners.mockResolvedValue([]);
      projectService.getOwners.mockResolvedValue([new User(OWNER_ID)]);

      await runWorkerTick();

      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe("burn rate rules: the full-long-window gate (fix 1)", () => {
    test("a monitor whose first event is 5 minutes ago does NOT page a 60-minute rule on 20 seconds of downtime", async () => {
      /*
       * THE REGRESSION, with the numbers chosen so the bug WOULD page:
       * computeTimeSli clamps its denominator to the earliest observed event, so
       * a 5-minute-old monitor with 20s of downtime measures 20s/300s = 66.7x
       * against a 99.9% target instead of the honest 20s/3600s = 5.6x. Both the
       * long and the short window then see the same few minutes, both breach
       * 14.4x, and the multi-window rule - which exists to demand SUSTAINED
       * evidence - pages on seconds of data. Every fresh SLO + monitor pair paged
       * on its first blip.
       */
      sloService.getDueSlos.mockResolvedValue([
        makeSlo({ targetPercentage: 99.9 }),
      ]);
      burnRuleService.findBy.mockResolvedValue([makeRule()]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          down(minutesAgo(5), minutesAgo(5 - 20 / 60)),
          up(minutesAgo(5 - 20 / 60)),
        ],
      });

      await runWorkerTick();

      expect(alertService.create).not.toHaveBeenCalled();
      // the gate returns before the dedupe lookup, which proves it skipped the rule.
      expect(alertService.findOneBy).not.toHaveBeenCalled();
      expect(burnRuleService.updateOneById).not.toHaveBeenCalled();

      /*
       * The compliance window is still clamped to the data age ON PURPOSE - a
       * young SLO is judged over the life it has, so 20s against 5 minutes of
       * existence really is an exhausted budget (0.3s of budget over 300s), and
       * the display burn rate really is the collapsed 66.7x. The fix does not
       * change any of that: it only refuses to PAGE a fixed-length burn window it
       * has no history for.
       */
      expect(persistedSloStatus()).toBe(SloStatus.BudgetExhausted);
      /*
       * The budget over those 5 minutes of existence is 0.3s, but
       * errorBudgetTotalSeconds is a Postgres integer column, so the persisted
       * value is the rounded 0 (fix 7). The decimal currentBurnRate column keeps
       * its full precision.
       */
      expect(persistedStateUpdate()["errorBudgetTotalSeconds"]).toBe(0);
      expect(persistedStateUpdate()["errorBudgetRemainingSeconds"]).toBe(-20);
      expect(persistedStateUpdate()["currentBurnRate"]).toBeCloseTo(
        66.6666666667,
        6,
      );
    });

    test("a monitor that is DOWN and only 5 minutes old still does not page a 60-minute rule", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([makeRule()]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [down(minutesAgo(5))] });

      await runWorkerTick();

      // the compliance window still reports the outage...
      expect(persistedSloStatus()).toBe(SloStatus.BudgetExhausted);
      // ...but no burn-rate page goes out on five minutes of history.
      expect(alertService.create).not.toHaveBeenCalled();
      expect(alertService.findOneBy).not.toHaveBeenCalled();
    });

    test("a 5-minute-old monitor DOES page a rule whose long window is only 2 minutes", async () => {
      // the gate is about having a full long window, not about being new.
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([
        makeRule({ longWindowInMinutes: 2, shortWindowInMinutes: 1 }),
      ]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [down(minutesAgo(5))] });

      await runWorkerTick();

      expect(alertService.create).toHaveBeenCalledTimes(1);
    });

    test("sustained downtime longer than the long window creates exactly ONE alert with the rule fingerprint", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([
        makeRule({ onCallDutyPolicies: [new OnCallDutyPolicy(POLICY_ID)] }),
      ]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), hoursAgo(3)),
          down(hoursAgo(3)),
        ],
      });

      await runWorkerTick();

      const alert: Alert = createdAlert();

      expect(alert.seriesFingerprint).toBe("slo:slo-1:burn-rule:rule-1");
      expect(alert.projectId!.toString()).toBe(PROJECT_ID.toString());
      expect(alert.alertSeverityId!.toString()).toBe(SEVERITY_ID.toString());
      expect(alert.isCreatedAutomatically).toBe(true);
      expect(alert.title).toContain("Checkout availability");
      expect(alert.description).toContain("Fast burn");
      expect(
        (alert.onCallDutyPolicies || []).map((policy: OnCallDutyPolicy) => {
          return policy._id;
        }),
      ).toEqual([POLICY_ID.toString()]);

      // and the rule records the fire so re-fire suppression can work.
      const ruleUpdate: UpdateCallArgs = burnRuleService.updateOneById.mock
        .calls[0]![0] as UpdateCallArgs;
      expect((ruleUpdate.data["lastAlertCreatedAt"] as Date).getTime()).toBe(
        NOW.getTime(),
      );
    });

    test("the dedupe lookup queries the SAME fingerprint the alert is created with", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([makeRule()]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), hoursAgo(3)),
          down(hoursAgo(3)),
        ],
      });

      await runWorkerTick();

      const lookupArgs: { query: { seriesFingerprint: string } } = alertService
        .findOneBy.mock.calls[0]![0] as {
        query: { seriesFingerprint: string };
      };

      expect(lookupArgs.query.seriesFingerprint).toBe(
        "slo:slo-1:burn-rule:rule-1",
      );
      expect(createdAlert().seriesFingerprint).toBe(
        lookupArgs.query.seriesFingerprint,
      );
    });

    test("an already-open alert with the same fingerprint suppresses a duplicate (fix 6)", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([makeRule()]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), hoursAgo(3)),
          down(hoursAgo(3)),
        ],
      });

      const openAlert: Alert = new Alert(new ObjectID("alert-1"));
      alertService.findOneBy.mockResolvedValue(openAlert);

      await runWorkerTick();

      expect(alertService.create).not.toHaveBeenCalled();
      // lastAlertCreatedAt must not move either - nothing new fired.
      expect(burnRuleService.updateOneById).not.toHaveBeenCalled();
    });

    test("an ongoing scheduled maintenance on an attached monitor suppresses alert CREATION", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([makeRule()]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), hoursAgo(3)),
          down(hoursAgo(3)),
        ],
      });

      const event: ScheduledMaintenance = new ScheduledMaintenance();
      event.monitors = [new Monitor(MONITOR_A_ID)];
      maintenanceService.findBy.mockResolvedValue([event]);

      await runWorkerTick();

      expect(alertService.create).not.toHaveBeenCalled();
    });

    test("a maintenance window on an UNRELATED monitor does not suppress the alert", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([makeRule()]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), hoursAgo(3)),
          down(hoursAgo(3)),
        ],
      });

      const event: ScheduledMaintenance = new ScheduledMaintenance();
      event.monitors = [new Monitor(MONITOR_B_ID)];
      maintenanceService.findBy.mockResolvedValue([event]);

      await runWorkerTick();

      expect(alertService.create).toHaveBeenCalledTimes(1);
    });

    test("a rule that resolved 10 minutes ago is inside its re-fire suppression window", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([
        makeRule({
          lastAlertCreatedAt: hoursAgo(4),
          lastAlertResolvedAt: minutesAgo(10),
          refireSuppressionMinutes: 60,
        }),
      ]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), hoursAgo(3)),
          down(hoursAgo(3)),
        ],
      });

      await runWorkerTick();

      expect(alertService.create).not.toHaveBeenCalled();
    });

    test("a rule with a zero or missing threshold is skipped entirely", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([
        makeRule({ burnRateThreshold: 0 }),
      ]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), hoursAgo(3)),
          down(hoursAgo(3)),
        ],
      });

      await runWorkerTick();

      expect(alertService.create).not.toHaveBeenCalled();
      expect(alertService.findOneBy).not.toHaveBeenCalled();
    });
  });

  describe("burn rate rules: resolution follows the LONG window only (fix 5)", () => {
    test("a long window still breaching with a recovered short window neither fires nor resolves", async () => {
      /*
       * Resolving on the short window guarantees paging flap: fire, recover for
       * five minutes, re-fire all night. A long-window breach with a recovered
       * short window is a hold state.
       *
       * 50 minutes of downtime inside the 60-minute window = 83.3x burn (long,
       * breaching); the trailing 5 minutes are clean = 0x (short, recovered).
       */
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([
        makeRule({ lastAlertCreatedAt: minutesAgo(30) }),
      ]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), minutesAgo(60)),
          down(minutesAgo(60), minutesAgo(10)),
          up(minutesAgo(10)),
        ],
      });

      await runWorkerTick();

      expect(burnRuleService.resolveOpenAlertsForRule).not.toHaveBeenCalled();
      expect(alertService.create).not.toHaveBeenCalled();
      expect(burnRuleService.updateOneById).not.toHaveBeenCalled();
    });

    test("resolves once the LONG window drops below the threshold, stamping lastAlertResolvedAt", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([
        makeRule({ lastAlertCreatedAt: hoursAgo(4) }),
      ]);
      // the outage ended four hours ago: the 60-minute window is clean.
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), hoursAgo(5)),
          down(hoursAgo(5), hoursAgo(4)),
          up(hoursAgo(4)),
        ],
      });

      await runWorkerTick();

      expect(burnRuleService.resolveOpenAlertsForRule).toHaveBeenCalledTimes(1);

      const resolveArgs: {
        serviceLevelObjectiveId: ObjectID;
        burnRateRuleId: ObjectID;
        projectId: ObjectID;
        rootCause: string;
      } = burnRuleService.resolveOpenAlertsForRule.mock.calls[0]![0] as {
        serviceLevelObjectiveId: ObjectID;
        burnRateRuleId: ObjectID;
        projectId: ObjectID;
        rootCause: string;
      };

      expect(resolveArgs.serviceLevelObjectiveId.toString()).toBe(
        SLO_ID.toString(),
      );
      expect(resolveArgs.burnRateRuleId.toString()).toBe(RULE_ID.toString());
      expect(resolveArgs.rootCause).toBe("Burn rate dropped below threshold.");

      const ruleUpdate: UpdateCallArgs = burnRuleService.updateOneById.mock
        .calls[0]![0] as UpdateCallArgs;
      expect((ruleUpdate.data["lastAlertResolvedAt"] as Date).getTime()).toBe(
        NOW.getTime(),
      );
    });

    test("a recovered rule that never fired resolves nothing", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([makeRule()]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(10))] });

      await runWorkerTick();

      expect(burnRuleService.resolveOpenAlertsForRule).not.toHaveBeenCalled();
      expect(burnRuleService.updateOneById).not.toHaveBeenCalled();
    });

    test("a rule already resolved after its last fire is not resolved again", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([
        makeRule({
          lastAlertCreatedAt: hoursAgo(5),
          lastAlertResolvedAt: hoursAgo(4),
        }),
      ]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(10))] });

      await runWorkerTick();

      expect(burnRuleService.resolveOpenAlertsForRule).not.toHaveBeenCalled();
    });

    test("a young SLO with no open alert neither fires nor resolves anything", async () => {
      /*
       * The gate refuses to judge a long window it cannot measure, so nothing
       * fires - and with no open alert there is nothing to resolve either. (An
       * OPEN alert is a different story: see fix 9 below.)
       */
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      burnRuleService.findBy.mockResolvedValue([makeRule()]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(minutesAgo(5))] });

      await runWorkerTick();

      expect(alertService.create).not.toHaveBeenCalled();
      expect(burnRuleService.resolveOpenAlertsForRule).not.toHaveBeenCalled();
      expect(burnRuleService.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("multi-monitor burn windows", () => {
    test("AnyDown pages when one of two monitors is down for the whole long window", async () => {
      sloService.getDueSlos.mockResolvedValue([
        makeSlo({
          monitors: [new Monitor(MONITOR_A_ID), new Monitor(MONITOR_B_ID)],
        }),
      ]);
      monitorService.findBy.mockResolvedValue([
        enabledMonitor(MONITOR_A_ID),
        enabledMonitor(MONITOR_B_ID),
      ]);
      burnRuleService.findBy.mockResolvedValue([makeRule()]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [up(daysAgo(10), undefined, MONITOR_A_ID)],
        [MONITOR_B_ID.toString()]: [
          up(daysAgo(10), hoursAgo(3), MONITOR_B_ID),
          down(hoursAgo(3), undefined, MONITOR_B_ID),
        ],
      });

      await runWorkerTick();

      expect(timelineService.findAllBy).toHaveBeenCalledTimes(2);
      expect(alertService.create).toHaveBeenCalledTimes(1);
      expect(persistedSloStatus()).toBe(SloStatus.BudgetExhausted);
    });

    test("the timeline fetch window is widened to cover the longest rule lookback, not just the compliance window", async () => {
      // a 3-day long window on a 1-day compliance window must widen the fetch.
      sloService.getDueSlos.mockResolvedValue([makeSlo({ windowDays: 1 })]);
      burnRuleService.findBy.mockResolvedValue([
        makeRule({ longWindowInMinutes: 3 * 24 * 60 }),
      ]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(10))] });

      await runWorkerTick();

      expect(timelineService.findAllBy).toHaveBeenCalledTimes(1);

      const fetchArgs: {
        query: { startsAt: unknown; endsAt: unknown };
      } = timelineService.findAllBy.mock.calls[0]![0] as {
        query: { startsAt: unknown; endsAt: unknown };
      };

      /*
       * The overlap predicate binds the fetch window through QueryHelper's Raw
       * operators: `endsAt >= fetchStart OR endsAt IS NULL` and
       * `startsAt <= fetchEnd`.
       */
      expect(boundDateOf(fetchArgs.query.endsAt).getTime()).toBe(
        daysAgo(3).getTime(),
      );
      expect(boundDateOf(fetchArgs.query.startsAt).getTime()).toBe(
        NOW.getTime(),
      );
    });
  });

  describe("error budget SECOND columns are Postgres integers (fix 7)", () => {
    /*
     * THE REGRESSION: errorBudgetRemainingSeconds / errorBudgetTotalSeconds are
     * ColumnType.Number === `integer`. The budget seconds are essentially never
     * integral - `1 - 99.9/100` is 0.0009999999999998899 in IEEE-754 - so a
     * 99.9% / 30-day SLO used to send 2591.9999999997144 to Postgres, which
     * rejected the whole UPDATE with `invalid input syntax for type integer`.
     * The per-SLO try/catch in the sweep swallowed it, so EVERYTHING downstream
     * of that write silently never ran: no state columns, no history rows (empty
     * charts forever), no owner notifications, no burn-rate evaluation.
     */
    function stubThirtyDaySlo(downtimeSeconds: number): void {
      sloService.getDueSlos.mockResolvedValue([
        makeSlo({ targetPercentage: 99.9, windowDays: 30 }),
      ]);

      const downFrom: Date = daysAgo(10);
      const downTo: Date = new Date(
        downFrom.getTime() + downtimeSeconds * 1000,
      );

      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(60), downFrom),
          down(downFrom, downTo),
          up(downTo),
        ],
      });
    }

    test("both second columns are persisted as integers for a 99.9% / 30-day SLO", async () => {
      // the raw arithmetic really is fractional - that is the whole bug.
      expect(Number.isInteger((1 - 99.9 / 100) * 30 * 24 * 60 * 60)).toBe(
        false,
      );

      stubThirtyDaySlo(1000);

      await runWorkerTick();

      const state: Record<string, unknown> = persistedStateUpdate();

      expect(Number.isInteger(state["errorBudgetTotalSeconds"])).toBe(true);
      expect(Number.isInteger(state["errorBudgetRemainingSeconds"])).toBe(true);
      expect(state["errorBudgetTotalSeconds"]).toBe(2592);
      expect(state["errorBudgetRemainingSeconds"]).toBe(1592);

      /*
       * The decimal columns must NOT be rounded - they are the values the
       * dashboard charts and the status math read.
       */
      expect(Number.isInteger(state["errorBudgetRemainingPercentage"])).toBe(
        false,
      );
      expect(state["errorBudgetRemainingPercentage"]).toBeCloseTo(
        61.4197530864,
        8,
      );
      expect(state["currentSliPercentage"]).toBeCloseTo(99.9614197531, 8);
    });

    test("an over-budget SLO keeps a NEGATIVE whole-second remainder", async () => {
      // 3600s burnt against a 2592s budget: the remainder must stay signed.
      stubThirtyDaySlo(3600);

      await runWorkerTick();

      const state: Record<string, unknown> = persistedStateUpdate();

      expect(state["errorBudgetRemainingSeconds"]).toBe(-1008);
      expect(state["errorBudgetRemainingSeconds"] as number).toBeLessThan(0);
      expect(Number.isInteger(state["errorBudgetRemainingSeconds"])).toBe(true);
      expect(persistedSloStatus()).toBe(SloStatus.BudgetExhausted);
    });

    test("history rows keep the full unrounded precision the columns cannot", async () => {
      stubThirtyDaySlo(1000);

      await runWorkerTick();

      const rows: Array<{ metricName: string; value: number }> =
        historyRowsWritten();

      expect(rows).toHaveLength(3);
      expect(
        rows.find((row: { metricName: string }) => {
          return row.metricName === "error.budget.remaining.percent";
        })!.value,
      ).toBeCloseTo(61.4197530864, 8);
    });
  });

  describe("the sweep holds one Redis mutex (fix 8)", () => {
    /*
     * THE REGRESSION: the per-SLO cadence stamp was never an overlap guard.
     * getDueSlos() snapshots the whole due set and each SLO is stamped only when
     * the loop reaches it, so a sweep slower than the one-minute schedule still
     * has hundreds of unstamped SLOs in flight when the next tick re-selects
     * them - and runJobWithTimeout is a Promise.race that never cancels the
     * body. The result was duplicate owner notifications and duplicate
     * burn-rate alerts. (An affected-row count on an updateBy cannot substitute:
     * DatabaseService._updateBy is a _findBy + per-row save() and returns the
     * SELECT count, so two interleaved sweeps both see 1.)
     */
    test("the whole sweep runs under one mutex, acquired without retrying and released after", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(10))] });

      await runWorkerTick();

      expect(semaphore.lock).toHaveBeenCalledTimes(1);

      const lockArgs: {
        key: string;
        namespace: string;
        lockTimeout: number;
        acquireAttemptsLimit: number;
      } = semaphore.lock.mock.calls[0]![0] as {
        key: string;
        namespace: string;
        lockTimeout: number;
        acquireAttemptsLimit: number;
      };

      expect(lockArgs.key).toBe("Slo:EvaluateSlos");
      expect(lockArgs.namespace).toBe("Workers.Cron");
      // never queue behind the in-flight sweep - the job re-runs in a minute.
      expect(lockArgs.acquireAttemptsLimit).toBe(1);
      // the lock must outlive the job's own 10-minute timeout.
      expect(lockArgs.lockTimeout).toBeGreaterThan(10 * 60 * 1000);

      expect(semaphore.release).toHaveBeenCalledTimes(1);
      expect(semaphore.release).toHaveBeenCalledWith(SWEEP_MUTEX);

      // and the sweep still did its work.
      expect(historyService.insertHistoryRows).toHaveBeenCalledTimes(1);
    });

    test("a tick that cannot acquire the lock evaluates NOTHING and returns", async () => {
      semaphore.lock.mockRejectedValue(new Error("acquire-timeout"));
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(10))] });

      await runWorkerTick();

      // the due set is not even queried: a sweep is already in flight.
      expect(sloService.getDueSlos).not.toHaveBeenCalled();
      expect(sloService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
      expect(sloService.updateOneById).not.toHaveBeenCalled();
      expect(historyService.insertHistoryRows).not.toHaveBeenCalled();
      expect(alertService.create).not.toHaveBeenCalled();
      // nothing was acquired, so nothing may be released.
      expect(semaphore.release).not.toHaveBeenCalled();
    });

    test("the lock is released even when the sweep itself throws", async () => {
      sloService.getDueSlos.mockRejectedValue(new Error("db pool exhausted"));

      await expect(runWorkerTick()).rejects.toThrow("db pool exhausted");

      expect(semaphore.release).toHaveBeenCalledTimes(1);
      expect(semaphore.release).toHaveBeenCalledWith(SWEEP_MUTEX);
    });

    test("a release failure is logged, never rethrown", async () => {
      semaphore.release.mockRejectedValue(new Error("redis closed"));

      await runWorkerTick();

      expect(mockedLogger.error).toHaveBeenCalled();
    });
  });

  describe("the long-window gate blocks FIRING only (fix 9)", () => {
    /*
     * THE REGRESSION: the gate returned before the resolution branch as well as
     * the firing branch. Swap an SLO's monitor for a fresh one while its slow
     * burn rule (360-minute long window) is firing and earliestEventStart is
     * suddenly newer than the window start - so every tick returned early and
     * the alert plus its on-call escalation stayed open forever, with nothing in
     * the product able to close it. Resolution is the one decision that is safe
     * without a fresh long-window measurement: a rule that can no longer justify
     * a page must not keep one open.
     */
    function stubTenMinutesOfHistory(): void {
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(minutesAgo(10))] });
    }

    test("an OPEN alert is resolved once the SLO no longer has a full long window", async () => {
      stubTenMinutesOfHistory();
      burnRuleService.findBy.mockResolvedValue([
        makeRule({
          longWindowInMinutes: 360,
          shortWindowInMinutes: 30,
          lastAlertCreatedAt: hoursAgo(2),
        }),
      ]);

      await runWorkerTick();

      expect(burnRuleService.resolveOpenAlertsForRule).toHaveBeenCalledTimes(1);

      const resolveArgs: { burnRateRuleId: ObjectID; rootCause: string } =
        burnRuleService.resolveOpenAlertsForRule.mock.calls[0]![0] as {
          burnRateRuleId: ObjectID;
          rootCause: string;
        };

      expect(resolveArgs.burnRateRuleId.toString()).toBe(RULE_ID.toString());
      // the root cause says why, rather than claiming the burn rate recovered.
      expect(resolveArgs.rootCause).toContain("360 minutes");

      // the bookkeeping is unchanged: lastAlertResolvedAt is still stamped.
      const ruleUpdate: UpdateCallArgs = burnRuleService.updateOneById.mock
        .calls[0]![0] as UpdateCallArgs;
      expect((ruleUpdate.data["lastAlertResolvedAt"] as Date).getTime()).toBe(
        NOW.getTime(),
      );

      // and still nothing FIRES on ten minutes of data.
      expect(alertService.create).not.toHaveBeenCalled();
      expect(alertService.findOneBy).not.toHaveBeenCalled();
    });

    test("a young SLO with NO open alert still does not fire and resolves nothing", async () => {
      stubTenMinutesOfHistory();
      burnRuleService.findBy.mockResolvedValue([
        makeRule({ longWindowInMinutes: 360, shortWindowInMinutes: 30 }),
      ]);

      await runWorkerTick();

      expect(alertService.create).not.toHaveBeenCalled();
      expect(burnRuleService.resolveOpenAlertsForRule).not.toHaveBeenCalled();
      expect(burnRuleService.updateOneById).not.toHaveBeenCalled();
    });

    test("an alert already resolved after its last fire is not re-resolved every tick", async () => {
      stubTenMinutesOfHistory();
      burnRuleService.findBy.mockResolvedValue([
        makeRule({
          longWindowInMinutes: 360,
          shortWindowInMinutes: 30,
          lastAlertCreatedAt: hoursAgo(5),
          lastAlertResolvedAt: hoursAgo(4),
        }),
      ]);

      await runWorkerTick();

      expect(burnRuleService.resolveOpenAlertsForRule).not.toHaveBeenCalled();
    });
  });

  describe("guard-path resolve runs before the status commit (fix 10)", () => {
    /*
     * THE REGRESSION: the status was committed first, and the status IS the
     * one-shot latch. A resolve that threw therefore never ran again - every
     * later tick saw no transition and returned early - so the alert and its
     * escalation were stranded forever. Resolving first means a failure leaves
     * the status untouched and the next tick retries the whole thing.
     */
    test("a failing resolve does NOT commit the status, and the next tick retries", async () => {
      const slo: ServiceLevelObjective = makeSlo({ monitors: [] });
      sloService.getDueSlos.mockResolvedValue([slo]);
      sloService.resolveOpenBurnRateAlertsForSlo.mockRejectedValueOnce(
        new Error("could not load burn rate rules"),
      );

      await runWorkerTick();

      expect(mockedLogger.error).toHaveBeenCalled();
      expect(payloadsContaining(sloUpdatePayloads(), "sloStatus")).toHaveLength(
        0,
      );
      // the in-memory copy is untouched too, so the retry still sees a transition.
      expect(slo.sloStatus).toBe(SloStatus.Healthy);

      await runWorkerTick();

      expect(sloService.resolveOpenBurnRateAlertsForSlo).toHaveBeenCalledTimes(
        2,
      );
      expect(persistedSloStatus()).toBe(SloStatus.Misconfigured);
      expect(slo.sloStatus).toBe(SloStatus.Misconfigured);
    });

    test("a successful resolve commits the status, and a second tick resolves nothing", async () => {
      const slo: ServiceLevelObjective = makeSlo({ monitors: [] });
      sloService.getDueSlos.mockResolvedValue([slo]);

      await runWorkerTick();

      // resolve strictly before the status write - the whole point of the fix.
      expect(
        sloService.resolveOpenBurnRateAlertsForSlo.mock.invocationCallOrder[0]!,
      ).toBeLessThan(sloService.updateOneById.mock.invocationCallOrder[0]!);

      await runWorkerTick();

      expect(sloService.resolveOpenBurnRateAlertsForSlo).toHaveBeenCalledTimes(
        1,
      );
      expect(payloadsContaining(sloUpdatePayloads(), "sloStatus")).toHaveLength(
        1,
      );
    });
  });

  describe("worker bookkeeping skips the hooked write path (fix 11)", () => {
    /*
     * THE REGRESSION: the model has @EnableWorkflow({update:true}) and
     * enableRealtimeEventsOn.update, and each evaluation issued 2-3
     * updateOneById calls - roughly 800-1,200 fire-and-forget workflow HTTP
     * POSTs a minute at 2,000 SLOs, almost all of it recording when the worker
     * last looked at a row.
     */
    test("the cadence stamp and the notification stamp both take the hookless path", async () => {
      // one tick that writes all three: cadence, state/status, notification stamp.
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubTimelines({
        [MONITOR_A_ID.toString()]: [
          up(daysAgo(10), new Date(NOW.getTime() - 800 * 1000)),
          down(new Date(NOW.getTime() - 800 * 1000), NOW),
        ],
      });
      sloService.findOwners.mockResolvedValue([new User(OWNER_ID)]);

      await runWorkerTick();

      const hookless: Array<Record<string, unknown>> =
        sloHooklessUpdatePayloads();

      expect(payloadsContaining(hookless, "lastEvaluatedAt")).toHaveLength(1);
      expect(payloadsContaining(hookless, "nextEvaluationAt")).toHaveLength(1);
      expect(
        payloadsContaining(hookless, "statusChangeNotificationSentAt"),
      ).toHaveLength(1);

      // ...and never through the hooked path.
      const hooked: Array<Record<string, unknown>> = sloHookedUpdatePayloads();

      expect(payloadsContaining(hooked, "lastEvaluatedAt")).toHaveLength(0);
      expect(payloadsContaining(hooked, "nextEvaluationAt")).toHaveLength(0);
      expect(
        payloadsContaining(hooked, "statusChangeNotificationSentAt"),
      ).toHaveLength(0);

      /*
       * The raw path takes only { id, data } - it has no props/access-control
       * pipeline to hand isRoot to.
       */
      for (const call of sloService.updateColumnsByIdWithoutHooks.mock.calls) {
        expect(Object.keys(call[0] as Record<string, unknown>).sort()).toEqual([
          "data",
          "id",
        ]);
      }
    });

    test("the SLI / status write is the ONE hooked update left per evaluation", async () => {
      /*
       * Deliberate: sloStatus is the only event in this job with real semantic
       * meaning (customer workflows subscribe to it) and the model's realtime
       * update event is what refreshes an open SLO page with the new numbers.
       */
      sloService.getDueSlos.mockResolvedValue([makeSlo()]);
      stubTimelines({ [MONITOR_A_ID.toString()]: [up(daysAgo(10))] });

      await runWorkerTick();

      expect(sloService.updateOneById).toHaveBeenCalledTimes(1);

      const hookedCall: UpdateCallArgs = sloService.updateOneById.mock
        .calls[0]![0] as UpdateCallArgs;

      expect(hookedCall.data["sloStatus"]).toBe(SloStatus.Healthy);
      expect(hookedCall.data["currentSliPercentage"]).toBe(100);
    });

    test("the guard-path status write also stays on the hooked path", async () => {
      sloService.getDueSlos.mockResolvedValue([makeSlo({ monitors: [] })]);

      await runWorkerTick();

      expect(
        payloadsContaining(sloHookedUpdatePayloads(), "sloStatus"),
      ).toHaveLength(1);
      expect(
        payloadsContaining(sloHooklessUpdatePayloads(), "sloStatus"),
      ).toHaveLength(0);
    });
  });
});
