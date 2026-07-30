import Monitor from "Common/Models/DatabaseModels/Monitor";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";

/*
 * Regression tests for the IncomingEmailMonitor:CheckOnlineStatus cron's write
 * path — the email twin of IncomingRequestMonitor:CheckHeartbeat. The
 * heartbeat bookkeeping stamp is written for EVERY incoming-email monitor
 * every 30 seconds; it used to go through updateOneById, whose full pipeline
 * is ~4 statements per row plus — because Monitor is @EnableWorkflow +
 * @EnableAuditLog — an on-update workflow HTTP trigger and an audit-log
 * insert per monitor per tick. The perf fix rewired the stamp to the
 * single-UPDATE updateColumnsByIdWithoutHooks fast path. These tests pin:
 *   1. the stamp goes through the hookless fast path with EXACTLY the
 *      incomingEmailMonitorHeartbeatCheckedAt column, and updateOneById is
 *      never called (the regression the change removes),
 *   2. the per-monitor control flow around the stamp is unchanged: both
 *      findAllBy batches (never-checked isNull first, then notNull) are
 *      concatenated; a monitor without monitorSteps is skipped with no
 *      write; only a monitor whose criteria check CheckOn.EmailReceivedAt
 *      (NOT the request monitor's CheckOn.IncomingRequest) is handed to
 *      MonitorResourceUtil.monitorResource; one failing monitor does not
 *      prevent the others.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to CAPTURE the handler (the same recorder the other
 * App/Tests/Workers/Jobs suites use) and each test drives one full tick.
 */

type CronHandler = () => Promise<void>;

/*
 * Captured cron handlers, keyed by job name. Must be declared before the job
 * import below so the mock factory closure can see it.
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
 * updateOneById is mocked ALONGSIDE the fast path precisely so the suite can
 * prove it is never called: if the job regressed back to the hooked pipeline,
 * the assertion would flag it instead of the mock throwing "not a function".
 */
jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      getEnabledMonitorQuery: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { getActiveProjectStatusQuery: jest.fn() },
  };
});

/*
 * The real MonitorResource util transitively loads the native `isolated-vm`
 * addon (via MonitorCriteriaEvaluator -> VMRunner); the job only needs its
 * monitorResource entry point, so the whole module is replaced.
 */
jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: { monitorResource: jest.fn() },
  };
});

import MonitorService from "Common/Server/Services/MonitorService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/IncomingEmailMonitor/CheckOnlineStatus";

interface MonitorServiceMock {
  findAllBy: jest.Mock;
  getEnabledMonitorQuery: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
  updateOneById: jest.Mock;
}

const monitorService: MonitorServiceMock =
  MonitorService as unknown as MonitorServiceMock;
const projectService: { getActiveProjectStatusQuery: jest.Mock } =
  ProjectService as unknown as { getActiveProjectStatusQuery: jest.Mock };
const monitorResourceMock: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const NOW: Date = new Date("2026-07-27T10:00:00.000Z");
const CREATED_AT: Date = new Date("2026-07-01T00:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const MONITOR_A_ID: ObjectID = new ObjectID("monitor-a");
const MONITOR_B_ID: ObjectID = new ObjectID("monitor-b");

// Sentinels for the enabled-monitor / active-project sub-queries the job spreads in.
const ENABLED_MONITOR_QUERY: Record<string, unknown> = {
  disableActiveMonitoring: false,
};
const ACTIVE_PROJECT_QUERY: Record<string, unknown> = {
  markedForDeletion: false,
};

/*
 * shouldProcessRequest only walks the plain data shape
 * monitorSteps.data.monitorStepsInstanceArray[].data.monitorCriteria.data
 *   .monitorCriteriaInstanceArray[].data.filters[].checkOn
 * so a cast plain object stands in for a fully-constructed MonitorSteps.
 */
function stepsWithCheckOn(checkOn: CheckOn): MonitorSteps {
  return {
    data: {
      monitorStepsInstanceArray: [
        {
          data: {
            monitorCriteria: {
              data: {
                monitorCriteriaInstanceArray: [
                  { data: { filters: [{ checkOn: checkOn }] } },
                ],
              },
            },
          },
        },
      ],
    },
  } as unknown as MonitorSteps;
}

function makeMonitor(data: {
  id: ObjectID;
  monitorSteps?: MonitorSteps | undefined;
  incomingEmailMonitorRequest?: IncomingEmailMonitorRequest | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(data.id);
  monitor.projectId = PROJECT_ID;
  monitor.createdAt = CREATED_AT;

  if (data.monitorSteps) {
    monitor.monitorSteps = data.monitorSteps;
  }

  if (data.incomingEmailMonitorRequest) {
    monitor.incomingEmailMonitorRequest = data.incomingEmailMonitorRequest;
  }

  return monitor;
}

interface FindAllByArgs {
  query: Record<string, unknown>;
  sort: Record<string, unknown>;
  select: Record<string, unknown>;
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

async function runWorkerTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["IncomingEmailMonitor:CheckOnlineStatus"];

  if (!handler) {
    throw new Error(
      "IncomingEmailMonitor:CheckOnlineStatus did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();

  /*
   * The per-monitor work is fire-and-forget (`checkOnlineStatus(m).catch(...)`),
   * so the handler resolves before the stamps do. A couple of macrotask turns
   * let every mocked-promise chain settle.
   */
  for (let turn: number = 0; turn < 3; turn++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

describe("IncomingEmailMonitor:CheckOnlineStatus worker", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    monitorService.findAllBy.mockResolvedValue([]);
    monitorService.getEnabledMonitorQuery.mockReturnValue(
      ENABLED_MONITOR_QUERY,
    );
    monitorService.updateColumnsByIdWithoutHooks.mockResolvedValue(undefined);
    monitorService.updateOneById.mockResolvedValue(undefined);
    projectService.getActiveProjectStatusQuery.mockReturnValue(
      ACTIVE_PROJECT_QUERY,
    );
    monitorResourceMock.mockResolvedValue(undefined);
  });

  test("concatenates the never-checked and already-checked batches and stamps each through the hookless fast path only", async () => {
    const neverChecked: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.ResponseTime),
    });
    const alreadyChecked: Monitor = makeMonitor({
      id: MONITOR_B_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.ResponseTime),
    });

    monitorService.findAllBy
      .mockResolvedValueOnce([neverChecked])
      .mockResolvedValueOnce([alreadyChecked]);

    await runWorkerTick();

    // Two batches: isNull (sorted by createdAt) then notNull (sorted by last check).
    expect(monitorService.findAllBy).toHaveBeenCalledTimes(2);

    const firstBatch: FindAllByArgs = monitorService.findAllBy.mock
      .calls[0]![0] as FindAllByArgs;
    const secondBatch: FindAllByArgs = monitorService.findAllBy.mock
      .calls[1]![0] as FindAllByArgs;

    for (const batch of [firstBatch, secondBatch]) {
      expect(batch.query["monitorType"]).toBe(MonitorType.IncomingEmail);
      // the enabled-monitor and active-project gates stay in both queries.
      expect(batch.query["disableActiveMonitoring"]).toBe(false);
      expect(batch.query["project"]).toEqual(ACTIVE_PROJECT_QUERY);
      expect(
        batch.query["incomingEmailMonitorHeartbeatCheckedAt"],
      ).toBeDefined();
    }

    expect(firstBatch.sort).toEqual({ createdAt: SortOrder.Ascending });
    expect(secondBatch.sort).toEqual({
      incomingEmailMonitorHeartbeatCheckedAt: SortOrder.Ascending,
    });

    // One fast-path stamp per monitor, batches concatenated in order.
    const stamps: Array<UpdateCallArgs> = stampCalls();
    expect(stamps).toHaveLength(2);
    expect(
      stamps.map((call: UpdateCallArgs) => {
        return call.id.toString();
      }),
    ).toEqual([MONITOR_A_ID.toString(), MONITOR_B_ID.toString()]);

    for (const stamp of stamps) {
      // EXACTLY the bookkeeping column - nothing else rides along.
      expect(Object.keys(stamp.data)).toEqual([
        "incomingEmailMonitorHeartbeatCheckedAt",
      ]);
      expect(
        (
          stamp.data["incomingEmailMonitorHeartbeatCheckedAt"] as Date
        ).getTime(),
      ).toBe(NOW.getTime());
    }

    // THE regression this change removed: the full hooked pipeline per tick.
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
  });

  test("a monitor without monitorSteps is skipped with no write at all", async () => {
    monitorService.findAllBy
      .mockResolvedValueOnce([makeMonitor({ id: MONITOR_A_ID })])
      .mockResolvedValueOnce([]);

    await runWorkerTick();

    expect(monitorService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
    expect(monitorResourceMock).not.toHaveBeenCalled();
  });

  test("criteria checking CheckOn.EmailReceivedAt hand the monitor to monitorResource with the incoming-email payload", async () => {
    const receivedAt: Date = new Date("2026-07-27T09:55:00.000Z");
    const monitor: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.EmailReceivedAt),
      incomingEmailMonitorRequest: {
        emailReceivedAt: receivedAt,
        emailFrom: "alerts@acme.dev",
      } as IncomingEmailMonitorRequest,
    });

    monitorService.findAllBy
      .mockResolvedValueOnce([monitor])
      .mockResolvedValueOnce([]);

    await runWorkerTick();

    expect(monitorResourceMock).toHaveBeenCalledTimes(1);

    const payload: IncomingEmailMonitorRequest = monitorResourceMock.mock
      .calls[0]![0] as IncomingEmailMonitorRequest;

    expect(payload.monitorId.toString()).toBe(MONITOR_A_ID.toString());
    expect(payload.projectId.toString()).toBe(PROJECT_ID.toString());
    // the worker-side check only validates liveness, never re-runs criteria.
    expect(payload.onlyCheckForIncomingEmailReceivedAt).toBe(true);
    expect(payload.emailReceivedAt.getTime()).toBe(receivedAt.getTime());
    expect(payload.checkedAt.getTime()).toBe(NOW.getTime());
    expect(payload.emailFrom).toBe("alerts@acme.dev");
    // unset email fields are defaulted to empty strings, not undefined.
    expect(payload.emailTo).toBe("");
    expect(payload.emailSubject).toBe("");
    expect(payload.emailBody).toBe("");

    // the heartbeat stamp is written BEFORE the resource evaluation.
    expect(
      monitorService.updateColumnsByIdWithoutHooks.mock.invocationCallOrder[0],
    ).toBeLessThan(monitorResourceMock.mock.invocationCallOrder[0]!);
  });

  test("a monitor that never received an email falls back to createdAt as the received timestamp", async () => {
    const monitor: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.EmailReceivedAt),
    });

    monitorService.findAllBy
      .mockResolvedValueOnce([monitor])
      .mockResolvedValueOnce([]);

    await runWorkerTick();

    const payload: IncomingEmailMonitorRequest = monitorResourceMock.mock
      .calls[0]![0] as IncomingEmailMonitorRequest;

    expect(payload.emailReceivedAt.getTime()).toBe(CREATED_AT.getTime());
  });

  test("criteria checking only CheckOn.IncomingRequest (the request monitor's filter) are stamped but never evaluated", async () => {
    monitorService.findAllBy
      .mockResolvedValueOnce([
        makeMonitor({
          id: MONITOR_A_ID,
          monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
        }),
      ])
      .mockResolvedValueOnce([]);

    await runWorkerTick();

    expect(monitorService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(
      1,
    );
    expect(monitorResourceMock).not.toHaveBeenCalled();
  });

  test("one monitor whose stamp write fails does not prevent the other monitors from processing", async () => {
    const failing: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.EmailReceivedAt),
    });
    const healthy: Monitor = makeMonitor({
      id: MONITOR_B_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.EmailReceivedAt),
    });

    monitorService.findAllBy
      .mockResolvedValueOnce([failing])
      .mockResolvedValueOnce([healthy]);

    monitorService.updateColumnsByIdWithoutHooks.mockImplementation(
      (args: UpdateCallArgs) => {
        if (args.id.toString() === MONITOR_A_ID.toString()) {
          return Promise.reject(new Error("db connection reset"));
        }
        return Promise.resolve(undefined);
      },
    );

    await runWorkerTick();

    expect(mockedLogger.error).toHaveBeenCalled();

    // the failing monitor aborts after its stamp; the healthy one still runs.
    expect(monitorResourceMock).toHaveBeenCalledTimes(1);

    const payload: IncomingEmailMonitorRequest = monitorResourceMock.mock
      .calls[0]![0] as IncomingEmailMonitorRequest;
    expect(payload.monitorId.toString()).toBe(MONITOR_B_ID.toString());
  });
});
