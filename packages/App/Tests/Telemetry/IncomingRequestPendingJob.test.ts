/*
 * How a monitor's job works through its waiting Incoming Requests
 * (processPendingIncomingRequestsFromQueue, #10582): what it reads from the
 * monitor, which requests it evaluates, what it does when one fails or is
 * refused, what the monitor's log is told was skipped, and when it queues the
 * monitor's job again.
 *
 * The waiting requests are an in-memory stand-in with the store's API
 * (IncomingRequestPendingStore.test.ts runs its Lua on Redis), the monitor
 * and its evaluation are stubbed, and the real ingest worker runs between
 * them. IncomingRequestCoalescingRedis.test.ts runs the same paths on a real
 * Redis and BullMQ.
 *
 * A monitor that is not being checked - archived, turned off, or paused by
 * an incident declared by hand or a maintenance event - has each request it
 * would have evaluated listed in its Logs as not evaluated (#11141): by the
 * ingest (MonitorResourceUtil.listNotEvaluated) when the key's lookup finds
 * it paused, and by MonitorResource, before it refuses the request, when the
 * key was kept from before the pause.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(),
      listNotEvaluated: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
      // The key's lookup, by its value, through findOneBy above (#9012).
      findOneByPresentedKey: (
        jest.requireActual("./Helpers/PresentedKeyByValue") as {
          default: unknown;
        }
      ).default,
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/MonitorSecretKeyCache", () => {
  return {
    __esModule: true,
    MonitorSecretKeyKind: {
      IncomingRequest: "IncomingRequest",
    },
    default: {
      getMonitor: jest.fn(),
      setMonitor: jest.fn(),
      forget: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore", () => {
  return {
    __esModule: true,
    default: {
      track: jest.fn((input: { receivedAt: Date }) => {
        return Promise.resolve(new Date(input.receivedAt));
      }),
      getReceivedAtAsOf: (receivedAt: Date): Date => {
        return receivedAt;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/IncomingRequestSecretGate", () => {
  return {
    __esModule: true,
    default: {
      decideInWorker: jest.fn(),
    },
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
      trace: jest.fn(),
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore",
  () => {
    return {
      __esModule: true,
      default: {
        getSecretKeyHash: (secretKey: string): string => {
          return `hash-of-${secretKey}`;
        },
        peekOldest: jest.fn(),
        peekNewest: jest.fn(),
        remove: jest.fn(),
        skipAfterFailures: jest.fn(),
        removeThrough: jest.fn(),
        countFailure: jest.fn(),
        acknowledgeSkipped: jest.fn(),
        hasPending: jest.fn(),
      },
    };
  },
);

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addIncomingRequestPendingJob: jest.fn(),
      },
    };
  },
);

import {
  DEFAULT_MAX_REQUESTS_PER_JOB,
  MAX_ATTEMPTS_PER_REQUEST,
  MAX_REQUESTS_PER_JOB,
  RETRY_WAITING_REQUESTS_AFTER_MS,
  processPendingIncomingRequestsFromQueue,
  toSkippedIncomingRequestsNote,
} from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import { INCOMING_REQUEST_MAX_REQUESTS_PER_JOB } from "../../FeatureSet/Telemetry/Config";
import TelemetryQueueService, {
  IncomingRequestIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import IncomingRequestPendingStore, {
  PendingIncomingRequest,
  SkippedIncomingRequests,
} from "../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil, {
  MonitorResourceOptions,
} from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorSecretKeyCache, {
  MonitorSecretKeyKind,
} from "Common/Server/Utils/Monitor/MonitorSecretKeyCache";
import IncomingRequestSecretGate from "Common/Server/Utils/Monitor/IncomingRequestSecretGate";
import logger from "Common/Server/Utils/Logger";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  MONITOR_PAUSE_FLAGS_SELECT,
  MonitorPauseReason,
} from "Common/Utils/Monitor/MonitorPauseState";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const SECRET_KEY: string = "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const HASH: string = `hash-of-${SECRET_KEY}`;
const MONITOR_ID: string = "9f14e45f-ceea-467a-9575-1b0d0d3e7a9c";
const PROJECT_ID: string = "4c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19";

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const listNotEvaluated: jest.Mock =
  MonitorResourceUtil.listNotEvaluated as unknown as jest.Mock;
const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;
const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const getMonitor: jest.Mock =
  MonitorSecretKeyCache.getMonitor as unknown as jest.Mock;
const forgetKey: jest.Mock =
  MonitorSecretKeyCache.forget as unknown as jest.Mock;
const decideInWorker: jest.Mock =
  IncomingRequestSecretGate.decideInWorker as unknown as jest.Mock;
const addPendingJob: jest.Mock =
  TelemetryQueueService.addIncomingRequestPendingJob as unknown as jest.Mock;

function store(name: keyof typeof IncomingRequestPendingStore): jest.Mock {
  return IncomingRequestPendingStore[name] as unknown as jest.Mock;
}

// The monitor's waiting requests: ids in order, each one's request.
let waiting: Array<{ requestId: string; sequence: number }> = [];
let failures: Map<string, number> = new Map();
let skipped: SkippedIncomingRequests = { overLimit: 0, afterFailures: 0 };

let isGrouped: boolean = true;
// Why the monitor is not being checked, if it is not (MonitorPauseState).
let pausedBy: MonitorPauseReason | null = null;
let isMonitorFound: boolean = true;

// The refusal MonitorResource answers a monitor not being checked with.
const REFUSAL_FOR_REASON: Record<MonitorPauseReason, string> = {
  [MonitorPauseReason.Archived]: ExceptionMessages.MonitorArchived,
  [MonitorPauseReason.Disabled]: ExceptionMessages.MonitorDisabled,
  [MonitorPauseReason.ManualIncident]:
    ExceptionMessages.MonitorDisabledBecauseOfManualIncident,
  [MonitorPauseReason.ScheduledMaintenance]:
    ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent,
};

const PAUSE_REASONS: Array<MonitorPauseReason> =
  Object.values(MonitorPauseReason);

function payloadOf(sequence: number): IncomingRequestIngestJobData {
  return {
    secretKey: SECRET_KEY,
    requestHeaders: { "content-type": "application/json" },
    requestBody: { sequence: sequence },
    requestMethod: "POST",
    ingestionTimestamp: "2026-11-21T09:00:00.000Z" as unknown as Date,
  };
}

function keep(...sequences: Array<number>): void {
  for (const sequence of sequences) {
    waiting.push({ requestId: `request-${sequence}`, sequence: sequence });
  }
}

function read(index: number): PendingIncomingRequest | null {
  const entry: { requestId: string; sequence: number } | undefined =
    index === 0 ? waiting[0] : waiting[waiting.length - 1];

  if (!entry) {
    return null;
  }

  return {
    requestId: entry.requestId,
    payload: payloadOf(entry.sequence),
    failures: failures.get(entry.requestId) || 0,
    waiting: waiting.length,
    skipped: { ...skipped },
  };
}

function removeId(requestId: string): boolean {
  const index: number = waiting.findIndex(
    (entry: { requestId: string }): boolean => {
      return entry.requestId === requestId;
    },
  );

  failures.delete(requestId);

  if (index < 0) {
    return false;
  }

  waiting.splice(index, 1);
  return true;
}

function monitorRow(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.projectId = new ObjectID(PROJECT_ID);
  monitor.monitorType = MonitorType.IncomingRequest;
  monitor.isArchived = pausedBy === MonitorPauseReason.Archived;
  monitor.disableActiveMonitoring = pausedBy === MonitorPauseReason.Disabled;
  monitor.disableActiveMonitoringBecauseOfManualIncident =
    pausedBy === MonitorPauseReason.ManualIncident;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent =
    pausedBy === MonitorPauseReason.ScheduledMaintenance;

  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  if (isGrouped) {
    criteria.data = {
      ...criteria.data!,
      incidentGrouping: { groupByJSONPath: "requestBody.alertActiveID" },
    };
  }

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: [criteria] };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ObjectID.generate(),
  };
  monitor.monitorSteps = monitorSteps;

  return monitor;
}

// The sequences each evaluation was handed, in order.
function evaluatedSequences(): Array<number> {
  return monitorResource.mock.calls.map((call: Array<unknown>): number => {
    const request: IncomingMonitorRequest = call[0] as IncomingMonitorRequest;
    return (request.requestBody as JSONObject)["sequence"] as number;
  });
}

function optionsOf(index: number): MonitorResourceOptions {
  return monitorResource.mock.calls[index]![1] as MonitorResourceOptions;
}

/*
 * The sequences the ingest listed as not evaluated, in order, each with the
 * reason it gave (#11141).
 */
function listedSequences(): Array<[number, MonitorPauseReason]> {
  return listNotEvaluated.mock.calls.map(
    (call: Array<unknown>): [number, MonitorPauseReason] => {
      const input: {
        dataToProcess: IncomingMonitorRequest;
        reason: MonitorPauseReason;
      } = call[0] as {
        dataToProcess: IncomingMonitorRequest;
        reason: MonitorPauseReason;
      };

      return [
        (input.dataToProcess.requestBody as JSONObject)["sequence"] as number,
        input.reason,
      ];
    },
  );
}

async function run(isFinalAttempt: boolean = false): Promise<void> {
  await processPendingIncomingRequestsFromQueue(
    { secretKeyHash: HASH },
    { isFinalAttempt: isFinalAttempt },
  );
}

beforeEach(() => {
  jest.clearAllMocks();

  waiting = [];
  failures = new Map();
  skipped = { overLimit: 0, afterFailures: 0 };
  isGrouped = true;
  pausedBy = null;
  isMonitorFound = true;

  // The key's monitor, as kept for a minute.
  getMonitor.mockResolvedValue({
    monitorId: new ObjectID(MONITOR_ID),
    projectId: new ObjectID(PROJECT_ID),
  } as never);

  findOneById.mockImplementation((async () => {
    return isMonitorFound ? monitorRow() : null;
  }) as never);

  findOneBy.mockImplementation((async () => {
    return isMonitorFound ? monitorRow() : null;
  }) as never);

  decideInWorker.mockImplementation((async (data: {
    requestHeaders?: Record<string, string> | undefined;
  }) => {
    return {
      verdict: "NotRequired",
      isRefused: false,
      requestHeaders: data.requestHeaders || {},
    };
  }) as never);

  monitorResource.mockResolvedValue({} as never);
  listNotEvaluated.mockResolvedValue(undefined as never);

  store("peekOldest").mockImplementation((async () => {
    return read(0);
  }) as never);
  store("peekNewest").mockImplementation((async () => {
    return read(-1);
  }) as never);
  store("remove").mockImplementation((async (
    _hash: string,
    requestId: string,
  ) => {
    return removeId(requestId);
  }) as never);
  store("skipAfterFailures").mockImplementation((async (
    _hash: string,
    requestId: string,
  ) => {
    const removed: boolean = removeId(requestId);

    if (removed) {
      skipped.afterFailures++;
    }

    return removed;
  }) as never);
  store("removeThrough").mockImplementation((async (
    _hash: string,
    requestId: string,
  ) => {
    const through: number =
      waiting.findIndex((entry: { requestId: string }): boolean => {
        return entry.requestId === requestId;
      }) + 1;

    for (const entry of waiting.slice(0, through)) {
      removeId(entry.requestId);
    }

    return through;
  }) as never);
  store("countFailure").mockImplementation((async (
    _hash: string,
    requestId: string,
  ) => {
    const count: number = (failures.get(requestId) || 0) + 1;
    failures.set(requestId, count);
    return count;
  }) as never);
  store("acknowledgeSkipped").mockImplementation((async (
    _hash: string,
    said: SkippedIncomingRequests,
  ) => {
    skipped = {
      overLimit: skipped.overLimit - said.overLimit,
      afterFailures: skipped.afterFailures - said.afterFailures,
    };
  }) as never);
  store("hasPending").mockImplementation((async () => {
    return waiting.length > 0;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which requests a monitor's job evaluates", () => {
  test("a grouped monitor's waiting requests are each evaluated, oldest first, and removed", async () => {
    keep(1, 2, 3, 4);

    await run();

    expect(evaluatedSequences()).toEqual([1, 2, 3, 4]);
    expect(waiting).toEqual([]);
    expect(store("remove")).toHaveBeenCalledTimes(4);
    expect(store("removeThrough")).not.toHaveBeenCalled();
  });

  test("a monitor without grouping evaluates only its newest; the older ones are removed with it", async () => {
    isGrouped = false;
    keep(1, 2, 3, 4);

    await run();

    expect(evaluatedSequences()).toEqual([4]);
    expect(waiting).toEqual([]);
    expect(store("removeThrough")).toHaveBeenCalledWith(HASH, "request-4");
  });

  test("a single waiting request is evaluated without reading the monitor's criteria", async () => {
    keep(1);

    await run();

    expect(evaluatedSequences()).toEqual([1]);
    expect(findOneById).not.toHaveBeenCalled();
    expect(findOneBy).not.toHaveBeenCalled();
  });

  /*
   * #11141: it used to be read with whether it is paused too, and a paused
   * monitor counted as one that evaluates only its newest - every request
   * dropped with it. Paused or not, it now goes by its criteria: a paused
   * monitor lists each request it would have evaluated.
   */
  test("with more than one waiting, the monitor is read once a job, for its criteria only", async () => {
    keep(1, 2, 3);

    await run();

    expect(findOneById).toHaveBeenCalledTimes(1);

    const select: JSONObject = (
      findOneById.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    expect(select).toEqual({
      _id: true,
      monitorSteps: true,
      monitorType: true,
    });

    for (const pauseFlag of Object.keys(MONITOR_PAUSE_FLAGS_SELECT)) {
      expect(select).not.toHaveProperty(pauseFlag);
    }
  });

  test("a key not kept in the cache is looked up by its value, as the evaluation does", async () => {
    getMonitor.mockResolvedValue(null as never);
    keep(1, 2);

    await run();

    expect(findOneById).not.toHaveBeenCalled();
    expect(findOneBy).toHaveBeenCalled();
    expect(
      (findOneBy.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toEqual(
      expect.objectContaining({
        monitorType: MonitorType.IncomingRequest,
      }),
    );
    expect(evaluatedSequences()).toEqual([1, 2]);
  });

  /*
   * #11141: a paused monitor used to settle everything waiting with its
   * newest request, refused, and the rest were dropped without a trace. A
   * monitor whose criteria group by a payload field now has each of its
   * requests listed in its Logs as not evaluated, oldest first - as each
   * would have been evaluated - and none reaches the evaluation.
   */
  test.each(PAUSE_REASONS)(
    "a grouped monitor paused as %s lists each waiting request as not evaluated, oldest first, and evaluates none",
    async (reason: MonitorPauseReason) => {
      pausedBy = reason;
      // Looked up by its key: a paused monitor is never kept.
      getMonitor.mockResolvedValue(null as never);
      keep(1, 2, 3);

      await expect(run()).resolves.toBeUndefined();

      expect(listedSequences()).toEqual([
        [1, reason],
        [2, reason],
        [3, reason],
      ]);
      expect(monitorResource).not.toHaveBeenCalled();
      expect(waiting).toEqual([]);
      // Each removed on its own, none superseded by the newest.
      expect(store("remove")).toHaveBeenCalledTimes(3);
      expect(store("removeThrough")).not.toHaveBeenCalled();
      expect(store("countFailure")).not.toHaveBeenCalled();
      expect(addPendingJob).not.toHaveBeenCalled();
    },
  );

  /*
   * A monitor without grouping evaluates only its newest request, paused or
   * not: the newest is listed as not evaluated, and the older ones are
   * superseded by it as before.
   */
  test.each(PAUSE_REASONS)(
    "a monitor without grouping paused as %s lists only its newest request; the older ones are superseded",
    async (reason: MonitorPauseReason) => {
      pausedBy = reason;
      isGrouped = false;
      getMonitor.mockResolvedValue(null as never);
      keep(1, 2, 3);

      await expect(run()).resolves.toBeUndefined();

      expect(listedSequences()).toEqual([[3, reason]]);
      expect(monitorResource).not.toHaveBeenCalled();
      expect(waiting).toEqual([]);
      expect(store("removeThrough")).toHaveBeenCalledWith(HASH, "request-3");
      expect(store("remove")).not.toHaveBeenCalled();
    },
  );

  /*
   * The project's incoming request secret requirement is decided before a
   * paused monitor's request is listed: one it refuses is not listed.
   */
  test("a request the project's secret requirement refuses is not listed, though its monitor is paused", async () => {
    pausedBy = MonitorPauseReason.ManualIncident;
    getMonitor.mockResolvedValue(null as never);
    keep(1, 2);

    decideInWorker.mockImplementationOnce((async () => {
      return {
        verdict: "Missing",
        isRefused: true,
        requestHeaders: {},
      };
    }) as never);

    await run();

    expect(decideInWorker).toHaveBeenCalledTimes(2);
    expect(listedSequences()).toEqual([[2, MonitorPauseReason.ManualIncident]]);
    expect(monitorResource).not.toHaveBeenCalled();
    expect(waiting).toEqual([]);
  });

  /*
   * A request listed as not evaluated says nothing of what was skipped
   * before it: the next request that is evaluated says it.
   */
  test("a paused monitor's listed requests leave what was skipped for the next evaluation to say", async () => {
    pausedBy = MonitorPauseReason.ScheduledMaintenance;
    getMonitor.mockResolvedValue(null as never);
    skipped = { overLimit: 4, afterFailures: 0 };
    keep(1, 2);

    await run();

    expect(listedSequences()).toEqual([
      [1, MonitorPauseReason.ScheduledMaintenance],
      [2, MonitorPauseReason.ScheduledMaintenance],
    ]);
    expect(store("acknowledgeSkipped")).not.toHaveBeenCalled();
    expect(skipped).toEqual({ overLimit: 4, afterFailures: 0 });

    // The maintenance event ends: the next request is evaluated, and says it.
    pausedBy = null;
    keep(3);

    await run();

    expect(evaluatedSequences()).toEqual([3]);
    expect(optionsOf(0).skippedIncomingRequests).toEqual({
      overLimit: 4,
      afterFailures: 0,
      attempts: MAX_ATTEMPTS_PER_REQUEST,
    });
    expect(skipped).toEqual({ overLimit: 0, afterFailures: 0 });
  });

  /*
   * Every request waiting for a key that finds no monitor is refused alike:
   * its newest is refused, and settles all of them. Nothing is listed - there
   * is no monitor to list it on.
   */
  test("a key that finds no monitor settles everything waiting with one request", async () => {
    isMonitorFound = false;
    getMonitor.mockResolvedValue(null as never);
    keep(1, 2, 3);

    await expect(run()).rejects.toThrow(ExceptionMessages.MonitorNotFound);

    expect(monitorResource).not.toHaveBeenCalled();
    expect(listNotEvaluated).not.toHaveBeenCalled();
    expect(waiting).toEqual([]);
    expect(store("removeThrough")).toHaveBeenCalledWith(HASH, "request-3");
  });

  test("nothing waiting: nothing is read, nothing evaluated, nothing queued", async () => {
    await run();

    expect(monitorResource).not.toHaveBeenCalled();
    expect(findOneById).not.toHaveBeenCalled();
    expect(addPendingJob).not.toHaveBeenCalled();
  });

  test("a job that names no monitor is refused as bad data", async () => {
    await expect(
      processPendingIncomingRequestsFromQueue({} as never, {
        isFinalAttempt: false,
      }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("one sender takes its turn with everyone else", () => {
  test(`a job evaluates at most ${MAX_REQUESTS_PER_JOB} requests, then queues the monitor's job again for the rest`, async () => {
    keep(
      ...Array.from(
        { length: MAX_REQUESTS_PER_JOB + 5 },
        (_v: unknown, i: number) => {
          return i + 1;
        },
      ),
    );

    await run();

    expect(monitorResource).toHaveBeenCalledTimes(MAX_REQUESTS_PER_JOB);
    expect(waiting).toHaveLength(5);
    expect(addPendingJob).toHaveBeenCalledTimes(1);
    // Behind every job already waiting, now - not later.
    expect(addPendingJob).toHaveBeenCalledWith({ secretKeyHash: HASH });
  });

  /*
   * A self-hosted install sets its own (INCOMING_REQUEST_MAX_REQUESTS_PER_JOB,
   * #10652): 100 unless it does.
   */
  test("the limit is this server's setting, and 100 unless an install sets its own", () => {
    expect(MAX_REQUESTS_PER_JOB).toBe(INCOMING_REQUEST_MAX_REQUESTS_PER_JOB);
    expect(DEFAULT_MAX_REQUESTS_PER_JOB).toBe(100);
  });

  test("a job given a lower limit evaluates that many, then queues the monitor's job again", async () => {
    keep(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);

    await processPendingIncomingRequestsFromQueue(
      { secretKeyHash: HASH },
      { isFinalAttempt: false, maxRequestsPerJob: 5 },
    );

    expect(evaluatedSequences()).toEqual([1, 2, 3, 4, 5]);
    expect(waiting).toHaveLength(7);
    expect(addPendingJob).toHaveBeenCalledTimes(1);
    expect(addPendingJob).toHaveBeenCalledWith({ secretKeyHash: HASH });
  });

  test("a limit of one evaluates one request a job, in order", async () => {
    keep(1, 2, 3);

    for (let job: number = 1; job <= 3; job++) {
      await processPendingIncomingRequestsFromQueue(
        { secretKeyHash: HASH },
        { isFinalAttempt: false, maxRequestsPerJob: 1 },
      );
    }

    expect(evaluatedSequences()).toEqual([1, 2, 3]);
    // Queued again while requests were left: after the first and the second.
    expect(addPendingJob).toHaveBeenCalledTimes(2);
  });

  test("a job given a higher limit works through more than this server's default", async () => {
    keep(
      ...Array.from(
        { length: MAX_REQUESTS_PER_JOB + 20 },
        (_v: unknown, i: number) => {
          return i + 1;
        },
      ),
    );

    await processPendingIncomingRequestsFromQueue(
      { secretKeyHash: HASH },
      { isFinalAttempt: false, maxRequestsPerJob: MAX_REQUESTS_PER_JOB + 20 },
    );

    expect(monitorResource).toHaveBeenCalledTimes(MAX_REQUESTS_PER_JOB + 20);
    expect(addPendingJob).not.toHaveBeenCalled();
  });

  test("a job that reaches the end of the list queues nothing more", async () => {
    keep(
      ...Array.from(
        { length: MAX_REQUESTS_PER_JOB },
        (_v: unknown, i: number) => {
          return i + 1;
        },
      ),
    );

    await run();

    expect(monitorResource).toHaveBeenCalledTimes(MAX_REQUESTS_PER_JOB);
    expect(addPendingJob).not.toHaveBeenCalled();
  });
});

describe("what the monitor's log is told was skipped", () => {
  test("a grouped monitor's next evaluation says what was skipped before it, once", async () => {
    skipped = { overLimit: 25, afterFailures: 1 };
    keep(1, 2);

    await run();

    expect(optionsOf(0).skippedIncomingRequests).toEqual({
      overLimit: 25,
      afterFailures: 1,
      attempts: MAX_ATTEMPTS_PER_REQUEST,
    });
    expect(optionsOf(1).skippedIncomingRequests).toBeUndefined();
    expect(skipped).toEqual({ overLimit: 0, afterFailures: 0 });
  });

  /*
   * Which limit skipped them, as it was when it did (#10652): the store
   * keeps it with the count, and the evaluation's log says it.
   */
  test("says which limit skipped them, and each limit as it was", async () => {
    skipped = {
      overLimit: 30,
      overRequestLimit: 20,
      requestLimit: 5000,
      overByteLimit: 10,
      byteLimit: 64 * 1024 * 1024,
      afterFailures: 1,
    };
    keep(1, 2);

    await run();

    expect(optionsOf(0).skippedIncomingRequests).toEqual({
      overLimit: 30,
      overRequestLimit: 20,
      requestLimit: 5000,
      overByteLimit: 10,
      byteLimit: 64 * 1024 * 1024,
      afterFailures: 1,
      attempts: MAX_ATTEMPTS_PER_REQUEST,
    });
    expect(optionsOf(1).skippedIncomingRequests).toBeUndefined();
    // What was said, parts and all, is what is taken off.
    expect(store("acknowledgeSkipped")).toHaveBeenCalledWith(
      HASH,
      expect.objectContaining({
        overLimit: 30,
        overRequestLimit: 20,
        overByteLimit: 10,
        afterFailures: 1,
      }),
    );
  });

  test("a part with no limit beside it is not said as that limit's", () => {
    expect(
      toSkippedIncomingRequestsNote({
        overLimit: 5,
        overRequestLimit: 5,
        afterFailures: 0,
      }),
    ).toEqual({
      overLimit: 5,
      afterFailures: 0,
      attempts: MAX_ATTEMPTS_PER_REQUEST,
    });
    expect(
      toSkippedIncomingRequestsNote({
        overLimit: 5,
        overByteLimit: 2,
        byteLimit: 1024 * 1024,
        afterFailures: 3,
      }),
    ).toEqual({
      overLimit: 5,
      overByteLimit: 2,
      byteLimit: 1024 * 1024,
      afterFailures: 3,
      attempts: MAX_ATTEMPTS_PER_REQUEST,
    });
  });

  test("a skip left to say is said even when one request is waiting: the monitor is read to know whether to", async () => {
    skipped = { overLimit: 3, afterFailures: 0 };
    keep(1);

    await run();

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(optionsOf(0).skippedIncomingRequests).toEqual({
      overLimit: 3,
      afterFailures: 0,
      attempts: MAX_ATTEMPTS_PER_REQUEST,
    });
  });

  test("a monitor without grouping says nothing: the requests it skipped were superseded anyway", async () => {
    isGrouped = false;
    skipped = { overLimit: 25, afterFailures: 0 };
    keep(1, 2, 3);

    await run();

    expect(optionsOf(0).skippedIncomingRequests).toBeUndefined();
    expect(skipped).toEqual({ overLimit: 0, afterFailures: 0 });
  });

  test("a request refused before its evaluation leaves the skip for the next evaluation to say", async () => {
    skipped = { overLimit: 4, afterFailures: 0 };
    keep(1, 2);

    // The first request is refused by its project's secret requirement.
    decideInWorker.mockImplementationOnce((async () => {
      return {
        verdict: "Missing",
        isRefused: true,
        requestHeaders: {},
      };
    }) as never);

    await run();

    expect(evaluatedSequences()).toEqual([2]);
    expect(optionsOf(0).skippedIncomingRequests).toEqual({
      overLimit: 4,
      afterFailures: 0,
      attempts: MAX_ATTEMPTS_PER_REQUEST,
    });
    expect(skipped).toEqual({ overLimit: 0, afterFailures: 0 });
  });

  test("a failed evaluation leaves the skip for the evaluation that succeeds", async () => {
    skipped = { overLimit: 2, afterFailures: 0 };
    keep(1, 2);
    monitorResource.mockRejectedValueOnce(
      new Error("Acquire mutex timeout") as never,
    );

    await expect(run()).rejects.toThrow("Acquire mutex timeout");
    expect(skipped).toEqual({ overLimit: 2, afterFailures: 0 });

    await run();

    expect(evaluatedSequences()).toEqual([1, 1, 2]);
    expect(optionsOf(1).skippedIncomingRequests).toEqual({
      overLimit: 2,
      afterFailures: 0,
      attempts: MAX_ATTEMPTS_PER_REQUEST,
    });
    expect(skipped).toEqual({ overLimit: 0, afterFailures: 0 });
  });
});

describe("a failed evaluation", () => {
  test("leaves its request first in line, counted, and fails the job for BullMQ to retry", async () => {
    keep(1, 2);
    monitorResource.mockRejectedValueOnce(
      new Error("Acquire mutex timeout") as never,
    );

    await expect(run()).rejects.toThrow("Acquire mutex timeout");

    expect(evaluatedSequences()).toEqual([1]);
    expect(
      waiting.map((entry: { sequence: number }) => {
        return entry.sequence;
      }),
    ).toEqual([1, 2]);
    expect(failures.get("request-1")).toBe(1);
    // Not the last attempt: BullMQ retries this job.
    expect(addPendingJob).not.toHaveBeenCalled();
  });

  test("on the job's last attempt, queues the monitor's next job a while later, so the waiting requests are not left without one", async () => {
    keep(1, 2);
    monitorResource.mockRejectedValueOnce(
      new Error("Acquire mutex timeout") as never,
    );

    await expect(run(true)).rejects.toThrow("Acquire mutex timeout");

    expect(addPendingJob).toHaveBeenCalledTimes(1);
    expect(addPendingJob).toHaveBeenCalledWith({
      secretKeyHash: HASH,
      delayInMs: RETRY_WAITING_REQUESTS_AFTER_MS,
    });
  });

  test("on the job's last attempt, a failure to read the waiting requests queues the next job too", async () => {
    keep(1, 2);
    store("peekOldest").mockRejectedValueOnce(
      new Error("Redis connection reset") as never,
    );

    await expect(run(true)).rejects.toThrow("Redis connection reset");

    expect(monitorResource).not.toHaveBeenCalled();
    expect(addPendingJob).toHaveBeenCalledWith({
      secretKeyHash: HASH,
      delayInMs: RETRY_WAITING_REQUESTS_AFTER_MS,
    });
  });

  test("a next job that cannot be queued is logged, and the job's own failure passes on", async () => {
    keep(1);
    monitorResource.mockRejectedValueOnce(
      new Error("Acquire mutex timeout") as never,
    );
    addPendingJob.mockRejectedValueOnce(
      new Error("Redis is not connected") as never,
    );

    await expect(run(true)).rejects.toThrow("Acquire mutex timeout");

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Could not queue the next job"),
    );
  });

  test("a refusal on the job's last attempt queues no next job: nothing is left waiting", async () => {
    keep(1, 2);
    monitorResource.mockRejectedValueOnce(
      new BadDataException(ExceptionMessages.MonitorNotFound) as never,
    );

    await expect(run(true)).rejects.toThrow(ExceptionMessages.MonitorNotFound);

    expect(waiting).toEqual([]);
    expect(addPendingJob).not.toHaveBeenCalled();
  });

  /*
   * #11141: an archived monitor's refusal used to fail the job, settling
   * every request with it. MonitorResource lists each request as not
   * evaluated before it refuses it, so each is done with on its own and the
   * job completes - on its last attempt too, with nothing left to queue.
   */
  test("a monitor archived since its key was kept, on the job's last attempt: each request is handed over and refused, and the job completes with nothing queued", async () => {
    keep(1, 2);
    monitorResource.mockRejectedValue(
      new BadDataException(ExceptionMessages.MonitorArchived) as never,
    );

    await expect(run(true)).resolves.toBeUndefined();

    expect(evaluatedSequences()).toEqual([1, 2]);
    expect(waiting).toEqual([]);
    expect(addPendingJob).not.toHaveBeenCalled();
  });

  test(`a request whose evaluation fails for the ${MAX_ATTEMPTS_PER_REQUEST}rd time is skipped, counted, and the job goes on`, async () => {
    keep(1, 2, 3);
    failures.set("request-2", MAX_ATTEMPTS_PER_REQUEST - 1);

    monitorResource.mockImplementation((async (
      request: IncomingMonitorRequest,
    ) => {
      if ((request.requestBody as JSONObject)["sequence"] === 2) {
        throw new Error("Unexpected payload");
      }

      return {};
    }) as never);

    await run();

    expect(evaluatedSequences()).toEqual([1, 2, 3]);
    expect(store("skipAfterFailures")).toHaveBeenCalledWith(HASH, "request-2");
    expect(waiting).toEqual([]);
    // The evaluation after it is told.
    expect(optionsOf(2).skippedIncomingRequests).toEqual({
      overLimit: 0,
      afterFailures: 1,
      attempts: MAX_ATTEMPTS_PER_REQUEST,
    });
  });

  test("a monitor without grouping gives up on its newest the same way, with the older ones, and says nothing", async () => {
    isGrouped = false;
    keep(1, 2);
    failures.set("request-2", MAX_ATTEMPTS_PER_REQUEST - 1);
    monitorResource.mockRejectedValue(new Error("Unexpected payload") as never);

    await run();

    expect(evaluatedSequences()).toEqual([2]);
    expect(waiting).toEqual([]);
    expect(store("skipAfterFailures")).not.toHaveBeenCalled();
  });

  /*
   * A key that no longer finds its monitor - rotated, or the monitor
   * deleted, since it was kept: every request waiting for it is refused
   * alike, so one refusal settles them all. The kept key is forgotten, so
   * the next request looks it up, and the refusal passes on for the job to
   * complete.
   */
  test("refused as a monitor that is not found: the kept key is forgotten, every request waiting is settled, and the refusal passes on", async () => {
    keep(1, 2, 3);
    monitorResource.mockRejectedValueOnce(
      new BadDataException(ExceptionMessages.MonitorNotFound) as never,
    );

    await expect(run()).rejects.toThrow(ExceptionMessages.MonitorNotFound);

    expect(evaluatedSequences()).toEqual([1]);
    expect(waiting).toEqual([]);
    expect(store("removeThrough")).toHaveBeenCalledWith(HASH, "request-3");
    expect(store("countFailure")).not.toHaveBeenCalled();
    expect(forgetKey).toHaveBeenCalledTimes(1);
    expect(forgetKey).toHaveBeenCalledWith({
      kind: MonitorSecretKeyKind.IncomingRequest,
      secretKey: SECRET_KEY,
    });
    expect(listNotEvaluated).not.toHaveBeenCalled();
  });

  /*
   * #11141: a monitor archived, turned off or paused since its key was kept
   * used to refuse one request and settle every other with it, dropped
   * without a trace. MonitorResource now lists each request as not
   * evaluated before it refuses it: each is handed over in turn, removed,
   * and the next goes on. The job completes, the key stays kept.
   */
  test.each(PAUSE_REASONS)(
    "refused as a monitor paused as %s since its key was kept: each request is handed over in turn, removed, and the job completes",
    async (reason: MonitorPauseReason) => {
      keep(1, 2, 3);
      monitorResource.mockRejectedValue(
        new BadDataException(REFUSAL_FOR_REASON[reason]) as never,
      );

      await expect(run()).resolves.toBeUndefined();

      expect(evaluatedSequences()).toEqual([1, 2, 3]);
      expect(waiting).toEqual([]);
      expect(store("remove")).toHaveBeenCalledTimes(3);
      expect(store("removeThrough")).not.toHaveBeenCalled();
      expect(store("countFailure")).not.toHaveBeenCalled();
      expect(forgetKey).not.toHaveBeenCalled();
      expect(addPendingJob).not.toHaveBeenCalled();
      // MonitorResource lists it, as it refuses it; the ingest lists nothing.
      expect(listNotEvaluated).not.toHaveBeenCalled();
    },
  );

  test.each(PAUSE_REASONS)(
    "a monitor without grouping refused as paused as %s: its newest is handed over, and the older ones are superseded with it",
    async (reason: MonitorPauseReason) => {
      isGrouped = false;
      keep(1, 2, 3);
      monitorResource.mockRejectedValue(
        new BadDataException(REFUSAL_FOR_REASON[reason]) as never,
      );

      await expect(run()).resolves.toBeUndefined();

      expect(evaluatedSequences()).toEqual([3]);
      expect(waiting).toEqual([]);
      expect(store("removeThrough")).toHaveBeenCalledWith(HASH, "request-3");
      expect(store("countFailure")).not.toHaveBeenCalled();
    },
  );

  /*
   * Paused between two requests of a burst: the requests before the pause
   * are evaluated, the rest each handed over and refused.
   */
  test("a grouped monitor paused partway through its burst: the requests after the pause are each refused, none dropped with another", async () => {
    keep(1, 2, 3, 4);
    monitorResource.mockImplementation((async (
      request: IncomingMonitorRequest,
    ) => {
      if (((request.requestBody as JSONObject)["sequence"] as number) >= 3) {
        throw new BadDataException(
          ExceptionMessages.MonitorDisabledBecauseOfManualIncident,
        );
      }

      return {};
    }) as never);

    await expect(run()).resolves.toBeUndefined();

    expect(evaluatedSequences()).toEqual([1, 2, 3, 4]);
    expect(waiting).toEqual([]);
    expect(store("remove")).toHaveBeenCalledTimes(4);
    expect(store("countFailure")).not.toHaveBeenCalled();
  });
});
