import Monitor from "Common/Models/DatabaseModels/Monitor";
import OneUptimeDate from "Common/Types/Date";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import ObjectID from "Common/Types/ObjectID";

/*
 * Regression tests for the telemetry-monitor scheduler's write path
 * (enqueueDueTelemetryMonitorEvaluationJobs, the EVERY_MINUTE cron body
 * registered by ScheduleTelemetryMonitorEvaluations.ts). The scheduler bumps
 * telemetryMonitorLastMonitorAt / telemetryMonitorNextMonitorAt for every due
 * telemetry/infra monitor every minute; those stamps used to go through
 * updateOneById, whose full pipeline is ~4 statements per row plus — because
 * Monitor is @EnableWorkflow + @EnableAuditLog — an on-update workflow HTTP
 * trigger and an audit-log insert per monitor per tick. The perf fix rewired
 * them to the single-UPDATE updateColumnsByIdWithoutHooks fast path. These
 * tests pin:
 *   1. exactly one hookless stamp per due monitor carrying BOTH scheduler
 *      columns, and updateOneById is never called (the regression the change
 *      removes),
 *   2. the scheduling control flow is unchanged: a cron monitoringInterval
 *      drives nextMonitorAt through CronTab, an invalid interval falls back
 *      to now+1min (and the monitor is still stamped and enqueued), and one
 *      failed enqueue neither rejects the sweep nor starves the other
 *      monitors;
 *   3. the sweep reads no monitor's steps (their JSON, every due monitor,
 *      every minute): every due monitor is queued, and the evaluation job
 *      skips one without steps before it evaluates anything (2026-10-27).
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

/*
 * The worker transitively imports MonitorResource -> MonitorCriteriaEvaluator
 * -> VMAPI -> VMRunner, which loads the native `isolated-vm` addon. The
 * scheduler never evaluates JavaScript expressions, so stub the VM runner out
 * to keep the module importable in a plain jest environment.
 */
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
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
 * updateOneById is mocked ALONGSIDE the fast path precisely so the suite can
 * prove it is never called: if the scheduler regressed back to the hooked
 * pipeline, the assertion would flag it instead of the mock throwing
 * "not a function".
 */
jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
      updateOneById: jest.fn(),
      getEnabledMonitorQuery: jest.fn(),
    },
  };
});

jest.mock(
  "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: { addTelemetryMonitorEvaluationJob: jest.fn() },
    };
  },
);

import MonitorService from "Common/Server/Services/MonitorService";
import CronTab from "Common/Server/Utils/CronTab";
import logger from "Common/Server/Utils/Logger";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import TelemetryQueueService from "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  enqueueDueTelemetryMonitorEvaluationJobs,
  processTelemetryMonitorEvaluationFromQueue,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

interface MonitorServiceMock {
  findAllBy: jest.Mock;
  findOneById: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
  updateOneById: jest.Mock;
  getEnabledMonitorQuery: jest.Mock;
}

/*
 * What MonitorService.getEnabledMonitorQuery returns: none of the four pause
 * flags set. The scheduler spreads it into its sweep, so an archived or
 * disabled telemetry monitor is never stamped or queued.
 */
const ENABLED_MONITOR_QUERY: Record<string, boolean> = {
  isArchived: false,
  disableActiveMonitoring: false,
  disableActiveMonitoringBecauseOfManualIncident: false,
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
};

const monitorService: MonitorServiceMock =
  MonitorService as unknown as MonitorServiceMock;
const enqueueJobMock: jest.Mock =
  TelemetryQueueService.addTelemetryMonitorEvaluationJob as unknown as jest.Mock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const NOW: Date = new Date("2026-07-27T10:00:00.000Z");
const CRON_NEXT: Date = new Date("2026-07-27T10:05:00.000Z");
const ONE_MINUTE_MS: number = 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const MONITOR_A_ID: ObjectID = new ObjectID("monitor-a");
const MONITOR_B_ID: ObjectID = new ObjectID("monitor-b");

/*
 * The scheduler only checks monitorSteps.data.monitorStepsInstanceArray for
 * non-emptiness, so a cast plain object stands in for a fully-constructed
 * MonitorSteps.
 */
const NON_EMPTY_STEPS: MonitorSteps = {
  data: { monitorStepsInstanceArray: [{}] },
} as unknown as MonitorSteps;

function makeMonitor(data: {
  id: ObjectID;
  monitorSteps?: MonitorSteps | undefined;
  monitoringInterval?: string | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(data.id);
  monitor.projectId = PROJECT_ID;

  if (data.monitorSteps) {
    monitor.monitorSteps = data.monitorSteps;
  }

  if (data.monitoringInterval) {
    monitor.monitoringInterval = data.monitoringInterval;
  }

  return monitor;
}

interface UpdateCallArgs {
  id: ObjectID;
  data: Record<string, unknown>;
}

function stampCalls(): Array<UpdateCallArgs> {
  return monitorService.updateColumnsByIdWithoutHooks.mock.calls.map(
    (args: Array<unknown>) => {
      return args[0] as UpdateCallArgs;
    },
  );
}

function stampFor(monitorId: ObjectID): UpdateCallArgs {
  const matches: Array<UpdateCallArgs> = stampCalls().filter(
    (call: UpdateCallArgs) => {
      return call.id.toString() === monitorId.toString();
    },
  );

  expect(matches).toHaveLength(1);
  return matches[0]!;
}

describe("TelemetryMonitor scheduler (enqueueDueTelemetryMonitorEvaluationJobs)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    monitorService.findAllBy.mockResolvedValue([]);
    monitorService.updateColumnsByIdWithoutHooks.mockResolvedValue(undefined);
    monitorService.updateOneById.mockResolvedValue(undefined);
    monitorService.getEnabledMonitorQuery.mockReturnValue({
      ...ENABLED_MONITOR_QUERY,
    });
    enqueueJobMock.mockResolvedValue(undefined);
  });

  test("sweeps only monitors that are checked: the enabled-monitor query, archived ones left out", async () => {
    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(monitorService.getEnabledMonitorQuery).toHaveBeenCalled();
    expect(monitorService.findAllBy).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = (
      monitorService.findAllBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(query).toMatchObject(ENABLED_MONITOR_QUERY);
    expect(query["isArchived"]).toBe(false);
  });

  test("stamps every due monitor exactly once through the hookless fast path with BOTH scheduler columns", async () => {
    jest.spyOn(CronTab, "getNextExecutionTime").mockReturnValue(CRON_NEXT);

    const withInterval: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: NON_EMPTY_STEPS,
      monitoringInterval: "*/5 * * * *",
    });
    // stamped even though it has no steps: the bump is scheduler bookkeeping.
    const withoutSteps: Monitor = makeMonitor({ id: MONITOR_B_ID });

    monitorService.findAllBy.mockResolvedValue([withInterval, withoutSteps]);

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(monitorService.findAllBy).toHaveBeenCalledTimes(1);

    const stamps: Array<UpdateCallArgs> = stampCalls();
    expect(stamps).toHaveLength(2);

    for (const stamp of stamps) {
      // EXACTLY the two bookkeeping columns - nothing else rides along.
      expect(Object.keys(stamp.data).sort()).toEqual([
        "telemetryMonitorLastMonitorAt",
        "telemetryMonitorNextMonitorAt",
      ]);
      expect(
        (stamp.data["telemetryMonitorLastMonitorAt"] as Date).getTime(),
      ).toBe(NOW.getTime());
    }

    // the cron interval drives nextMonitorAt through CronTab...
    expect(CronTab.getNextExecutionTime).toHaveBeenCalledWith("*/5 * * * *");
    expect(
      (
        stampFor(MONITOR_A_ID).data["telemetryMonitorNextMonitorAt"] as Date
      ).getTime(),
    ).toBe(CRON_NEXT.getTime());

    // ...and no interval means the default one-minute cadence.
    expect(
      (
        stampFor(MONITOR_B_ID).data["telemetryMonitorNextMonitorAt"] as Date
      ).getTime(),
    ).toBe(NOW.getTime() + ONE_MINUTE_MS);

    // THE regression this change removed: the full hooked pipeline per tick.
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
  });

  test("an invalid monitoringInterval is logged, falls back to now+1min, and the monitor is still enqueued", async () => {
    // no CronTab spy: the real parser rejects the string, the job catches.
    monitorService.findAllBy.mockResolvedValue([
      makeMonitor({
        id: MONITOR_A_ID,
        monitorSteps: NON_EMPTY_STEPS,
        monitoringInterval: "not-a-valid-cron",
      }),
    ]);

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(mockedLogger.error).toHaveBeenCalled();

    const stamp: UpdateCallArgs = stampFor(MONITOR_A_ID);
    expect(
      (stamp.data["telemetryMonitorNextMonitorAt"] as Date).getTime(),
    ).toBe(NOW.getTime() + ONE_MINUTE_MS);
    expect(monitorService.updateOneById).not.toHaveBeenCalled();

    // the bad interval must not cost the monitor its evaluation.
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
  });

  test("reads only what scheduling needs: never a monitor's steps", async () => {
    await enqueueDueTelemetryMonitorEvaluationJobs();

    const select: Record<string, unknown> = (
      monitorService.findAllBy.mock.calls[0]![0] as {
        select: Record<string, unknown>;
      }
    ).select;

    expect(Object.keys(select).sort()).toEqual([
      "_id",
      "createdAt",
      "monitorType",
      "monitoringInterval",
      "projectId",
    ]);
    expect(select).not.toHaveProperty("monitorSteps");
  });

  test("every due monitor is stamped and enqueued with monitorId + projectId, steps or not: the evaluation job reads the steps", async () => {
    monitorService.findAllBy.mockResolvedValue([
      makeMonitor({ id: MONITOR_A_ID, monitorSteps: NON_EMPTY_STEPS }),
      makeMonitor({ id: MONITOR_B_ID }),
    ]);

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(stampCalls()).toHaveLength(2);
    expect(enqueueJobMock).toHaveBeenCalledTimes(2);

    const enqueued: Array<string> = enqueueJobMock.mock.calls.map(
      (args: Array<unknown>): string => {
        const job: { monitorId: ObjectID; projectId: ObjectID } = args[0] as {
          monitorId: ObjectID;
          projectId: ObjectID;
        };
        return `${job.monitorId.toString()}@${job.projectId.toString()}`;
      },
    );
    expect(enqueued.sort()).toEqual(
      [
        `${MONITOR_A_ID.toString()}@${PROJECT_ID.toString()}`,
        `${MONITOR_B_ID.toString()}@${PROJECT_ID.toString()}`,
      ].sort(),
    );
  });

  test("the evaluation job of a monitor without steps reads its steps and stops before it evaluates anything", async () => {
    const plan: jest.SpiedFunction<
      typeof ReceivingCoverage.planTelemetryEvaluation
    > = jest.spyOn(ReceivingCoverage, "planTelemetryEvaluation");

    for (const monitorSteps of [
      undefined,
      { data: { monitorStepsInstanceArray: [] } } as unknown as MonitorSteps,
    ]) {
      const monitor: Monitor = makeMonitor({ id: MONITOR_B_ID, monitorSteps });
      monitorService.findOneById.mockResolvedValue(monitor);

      await processTelemetryMonitorEvaluationFromQueue({
        monitorId: MONITOR_B_ID.toString(),
        projectId: PROJECT_ID.toString(),
      } as Parameters<typeof processTelemetryMonitorEvaluationFromQueue>[0]);
    }

    // The job asked for the steps itself...
    expect(monitorService.findOneById).toHaveBeenCalledTimes(2);
    expect(
      (
        monitorService.findOneById.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }
      ).select,
    ).toHaveProperty("monitorSteps", true);
    // ...and went no further: no window planned, nothing stamped or queued.
    expect(plan).not.toHaveBeenCalled();
    expect(monitorService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  test("one rejected enqueue is logged and neither rejects the sweep nor starves the other monitors", async () => {
    monitorService.findAllBy.mockResolvedValue([
      makeMonitor({ id: MONITOR_A_ID, monitorSteps: NON_EMPTY_STEPS }),
      makeMonitor({ id: MONITOR_B_ID, monitorSteps: NON_EMPTY_STEPS }),
    ]);
    enqueueJobMock
      .mockRejectedValueOnce(new Error("redis connection reset"))
      .mockResolvedValue(undefined);

    await expect(
      enqueueDueTelemetryMonitorEvaluationJobs(),
    ).resolves.toBeUndefined();

    expect(enqueueJobMock).toHaveBeenCalledTimes(2);
    expect(mockedLogger.error).toHaveBeenCalled();
  });

  test("a tick with no due monitors writes nothing and enqueues nothing", async () => {
    monitorService.findAllBy.mockResolvedValue([]);

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(monitorService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });
});
