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
 *      to now+1min (and the monitor is still stamped and enqueued), monitors
 *      without steps are stamped but not enqueued, and one failed enqueue
 *      neither rejects the sweep nor starves the other monitors.
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
      updateColumnsByIdWithoutHooks: jest.fn(),
      updateOneById: jest.fn(),
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
import TelemetryQueueService from "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { enqueueDueTelemetryMonitorEvaluationJobs } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

interface MonitorServiceMock {
  findAllBy: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
  updateOneById: jest.Mock;
}

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
    enqueueJobMock.mockResolvedValue(undefined);
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

  test("monitors with steps are enqueued with monitorId + projectId; monitors without steps are stamped but not enqueued", async () => {
    monitorService.findAllBy.mockResolvedValue([
      makeMonitor({ id: MONITOR_A_ID, monitorSteps: NON_EMPTY_STEPS }),
      makeMonitor({ id: MONITOR_B_ID }),
    ]);

    await enqueueDueTelemetryMonitorEvaluationJobs();

    // both were stamped...
    expect(stampCalls()).toHaveLength(2);

    // ...but only the one with steps was handed to the queue.
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);

    const enqueueArgs: { monitorId: ObjectID; projectId: ObjectID } =
      enqueueJobMock.mock.calls[0]![0] as {
        monitorId: ObjectID;
        projectId: ObjectID;
      };
    expect(enqueueArgs.monitorId.toString()).toBe(MONITOR_A_ID.toString());
    expect(enqueueArgs.projectId.toString()).toBe(PROJECT_ID.toString());
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
