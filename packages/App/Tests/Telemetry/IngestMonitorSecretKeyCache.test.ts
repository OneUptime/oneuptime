/*
 * A server agent reports every 30 seconds, and a sender can call its
 * incoming request URL every few. Each report used to look its monitor up by
 * secret key in Postgres before MonitorResource read the same monitor again.
 * The ingest jobs now keep which monitor a key belongs to for a minute
 * (MonitorSecretKeyCache), and hand MonitorResource the key so the read it
 * makes anyway checks the key is still the monitor's.
 *
 * What must hold: a key is looked up once and then not again while kept;
 * every report - looked up or kept - has its key checked; a key that finds
 * no monitor is never kept, and one that no longer finds its monitor is
 * forgotten; a paused incoming request monitor is never kept. A paused
 * server monitor is found by its key all the same (#11141): MonitorResource
 * lists its report as not evaluated before it refuses it.
 *
 * MonitorResource, the monitor lookup and the arrival store are mocked at
 * their module boundary; Redis is a map.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
      // Lists what a monitor that is not being checked received (#11141).
      listNotEvaluated: jest.fn(() => {
        return Promise.resolve();
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      // The key's lookup, by its value, through findOneBy above (#9012).
      findOneByPresentedKey: (
        jest.requireActual("./Helpers/PresentedKeyByValue") as {
          default: unknown;
        }
      ).default,
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getActiveProjectStatusQuery: jest.fn(() => {
        return {};
      }),
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

jest.mock("Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore", () => {
  type ActualStore = {
    default: { getReceivedAtAsOf: (receivedAt: Date, checkedAt: Date) => Date };
  };

  const actual: ActualStore = jest.requireActual(
    "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore",
  ) as ActualStore;

  return {
    __esModule: true,
    default: {
      track: jest.fn((input: { receivedAt: Date }) => {
        return Promise.resolve(new Date(input.receivedAt));
      }),
      getReceivedAtAsOf: actual.default.getReceivedAtAsOf,
    },
  };
});

/*
 * A project's incoming request secret requirement (IncomingRequestSecretGate)
 * is not what this suite is about: every request counts, as it did before
 * projects could require a secret. IncomingRequestSecretEndpoint.test.ts and
 * IncomingRequestSecretWorker.test.ts cover the requirement.
 */
jest.mock("Common/Server/Utils/Monitor/IncomingRequestSecretGate", () => {
  return {
    __esModule: true,
    default: {
      decideAtEdge: async (): Promise<{ mayRecordArrival: boolean }> => {
        return { mayRecordArrival: true };
      },
      decideInWorker: async (data: {
        requestHeaders?: Record<string, string> | undefined;
      }): Promise<{
        verdict: string;
        isRefused: boolean;
        requestHeaders: Record<string, string>;
      }> => {
        return {
          verdict: "NotRequired",
          isRefused: false,
          requestHeaders: data.requestHeaders || {},
        };
      },
    },
  };
});

import { processIncomingRequestFromQueue } from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import { processServerMonitorFromQueue } from "../../FeatureSet/Telemetry/Jobs/ServerMonitorIngest/ProcessServerMonitorIngest";
import {
  IncomingRequestIngestJobData,
  ServerMonitorIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil, {
  MonitorResourceOptions,
} from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorSecretKeyCache from "Common/Server/Utils/Monitor/MonitorSecretKeyCache";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
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

const SECRET_KEY: string = "6a1f0c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const MONITOR_ID: string = "7b2e1d3f-4c5a-4b6e-9f0a-1b2c3d4e5f6a";
const PROJECT_ID: string = "8c3f2e4a-5d6b-4c7f-a01b-2c3d4e5f6a7b";

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const listNotEvaluated: jest.Mock =
  MonitorResourceUtil.listNotEvaluated as unknown as jest.Mock;
const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;

let redis: Map<string, string>;

function activeMonitor(values: Partial<Monitor> = {}): Monitor {
  const row: Monitor = new Monitor();
  row._id = MONITOR_ID;
  row.projectId = new ObjectID(PROJECT_ID);
  row.isArchived = false;
  row.disableActiveMonitoring = false;
  row.disableActiveMonitoringBecauseOfManualIncident = false;
  row.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;
  Object.assign(row, values);
  return row;
}

function serverReport(): ServerMonitorIngestJobData {
  return {
    secretKey: SECRET_KEY,
    serverMonitorResponse: {
      serverMonitorResponse: {
        hostname: "db-1",
        onlyCheckRequestReceivedAt: false,
      } as JSONObject,
    },
    ingestionTimestamp: new Date(),
  } as unknown as ServerMonitorIngestJobData;
}

function incomingRequest(): IncomingRequestIngestJobData {
  return {
    secretKey: SECRET_KEY,
    requestHeaders: { "user-agent": "curl/8.12.1" },
    requestBody: {},
    requestMethod: "POST",
    ingestionTimestamp: new Date(),
  };
}

function optionsOfEvaluation(index: number): MonitorResourceOptions {
  return monitorResource.mock.calls[index]![1] as MonitorResourceOptions;
}

function evaluatedMonitorId(index: number): string {
  return (
    (
      monitorResource.mock.calls[index]![0] as { monitorId: ObjectID }
    ).monitorId?.toString() || ""
  );
}

function notFound(): BadDataException {
  return new BadDataException(ExceptionMessages.MonitorNotFound);
}

beforeEach(() => {
  jest.clearAllMocks();
  redis = new Map<string, string>();

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return redis.get(`${namespace}-${key}`) ?? null;
    });

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        redis.set(`${namespace}-${key}`, value);
      },
    );

  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (namespace: string, key: string) => {
      redis.delete(`${namespace}-${key}`);
    });

  monitorResource.mockImplementation(() => {
    return Promise.resolve({});
  });
  findOneBy.mockResolvedValue(activeMonitor() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a server agent's reports", () => {
  test("the first report looks its key up and keeps the monitor; the next is not looked up", async () => {
    await processServerMonitorFromQueue(serverReport());
    await processServerMonitorFromQueue(serverReport());

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(monitorResource).toHaveBeenCalledTimes(2);
    expect(evaluatedMonitorId(0)).toBe(MONITOR_ID);
    expect(evaluatedMonitorId(1)).toBe(MONITOR_ID);
  });

  test("every report, looked up or kept, has its key checked by the evaluation", async () => {
    await processServerMonitorFromQueue(serverReport());
    await processServerMonitorFromQueue(serverReport());

    for (const index of [0, 1]) {
      expect(optionsOfEvaluation(index).secretKey).toEqual({
        column: "serverMonitorSecretKey",
        value: SECRET_KEY,
      });
    }
  });

  /*
   * #11141: it used to ask only for an enabled one, so a paused monitor's
   * report was refused as a monitor that does not exist. It asks for a
   * server monitor of an active project, checked or not: MonitorResource
   * lists a paused one's report as not evaluated, then refuses it.
   */
  test("the lookup asks for a server monitor of an active project, whether or not it is being checked", async () => {
    await processServerMonitorFromQueue(serverReport());

    const lookup: { query: Record<string, unknown> } = findOneBy.mock
      .calls[0]![0] as { query: Record<string, unknown> };

    expect(Object.keys(lookup.query)).toEqual(
      expect.arrayContaining([
        "serverMonitorSecretKey",
        "monitorType",
        "project",
      ]),
    );
    expect(lookup.query["monitorType"]).toBe(MonitorType.Server);

    for (const pauseFlag of Object.keys(MONITOR_PAUSE_FLAGS_SELECT)) {
      expect(lookup.query).not.toHaveProperty(pauseFlag);
    }

    expect(MonitorService.getEnabledMonitorQuery).not.toHaveBeenCalled();
  });

  test.each(Object.values(MonitorPauseReason))(
    "a monitor paused as %s is found by its key, and its report goes to the evaluation, which lists and refuses it",
    async (reason: MonitorPauseReason) => {
      findOneBy.mockResolvedValue(
        activeMonitor({
          isArchived: reason === MonitorPauseReason.Archived,
          disableActiveMonitoring: reason === MonitorPauseReason.Disabled,
          disableActiveMonitoringBecauseOfManualIncident:
            reason === MonitorPauseReason.ManualIncident,
          disableActiveMonitoringBecauseOfScheduledMaintenanceEvent:
            reason === MonitorPauseReason.ScheduledMaintenance,
        }) as never,
      );

      await processServerMonitorFromQueue(serverReport());

      expect(monitorResource).toHaveBeenCalledTimes(1);
      expect(evaluatedMonitorId(0)).toBe(MONITOR_ID);
      expect(optionsOfEvaluation(0).secretKey).toEqual({
        column: "serverMonitorSecretKey",
        value: SECRET_KEY,
      });
      // The ingest lists nothing itself: MonitorResource does, as it refuses.
      expect(listNotEvaluated).not.toHaveBeenCalled();
    },
  );

  test("a key that finds no monitor is not kept, and is looked up again", async () => {
    findOneBy.mockResolvedValue(null as never);

    await expect(processServerMonitorFromQueue(serverReport())).rejects.toThrow(
      notFound(),
    );
    await expect(processServerMonitorFromQueue(serverReport())).rejects.toThrow(
      notFound(),
    );

    expect(redis.size).toBe(0);
    expect(findOneBy).toHaveBeenCalledTimes(2);
    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("a kept key that no longer finds its monitor is forgotten, and the next report looks it up", async () => {
    await processServerMonitorFromQueue(serverReport());
    expect(redis.size).toBe(1);

    // Rotated: the evaluation's own read no longer finds this key on the monitor.
    monitorResource.mockImplementationOnce(() => {
      return Promise.reject(notFound());
    });

    await expect(processServerMonitorFromQueue(serverReport())).rejects.toThrow(
      notFound(),
    );

    expect(redis.size).toBe(0);

    findOneBy.mockResolvedValue(null as never);

    await expect(processServerMonitorFromQueue(serverReport())).rejects.toThrow(
      notFound(),
    );
    expect(findOneBy).toHaveBeenCalledTimes(2);
  });

  test("a kept key whose evaluation fails for any other reason stays kept", async () => {
    await processServerMonitorFromQueue(serverReport());

    monitorResource.mockImplementationOnce(() => {
      return Promise.reject(new Error("lock timeout"));
    });

    await expect(processServerMonitorFromQueue(serverReport())).rejects.toThrow(
      "lock timeout",
    );

    expect(redis.size).toBe(1);
  });

  test("a Redis that cannot be reached looks every report up, as before", async () => {
    (GlobalCache.getString as unknown as jest.Mock).mockImplementation(() => {
      return Promise.reject(new Error("Redis is down"));
    });
    (GlobalCache.setString as unknown as jest.Mock).mockImplementation(() => {
      return Promise.reject(new Error("Redis is down"));
    });

    await processServerMonitorFromQueue(serverReport());
    await processServerMonitorFromQueue(serverReport());

    expect(findOneBy).toHaveBeenCalledTimes(2);
    expect(monitorResource).toHaveBeenCalledTimes(2);
  });
});

describe("an incoming request monitor's requests", () => {
  test("the first request looks its key up and keeps the monitor; the next is not looked up", async () => {
    await processIncomingRequestFromQueue(incomingRequest());
    await processIncomingRequestFromQueue(incomingRequest());

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(monitorResource).toHaveBeenCalledTimes(2);

    for (const index of [0, 1]) {
      const evaluated: { monitorId: ObjectID; projectId: ObjectID } =
        monitorResource.mock.calls[index]![0] as {
          monitorId: ObjectID;
          projectId: ObjectID;
        };

      expect(evaluated.monitorId.toString()).toBe(MONITOR_ID);
      expect(evaluated.projectId.toString()).toBe(PROJECT_ID);
      expect(optionsOfEvaluation(index).secretKey).toEqual({
        column: "incomingRequestSecretKey",
        value: SECRET_KEY,
      });
    }
  });

  test("a paused monitor is never kept: every request looks it up and is skipped", async () => {
    findOneBy.mockResolvedValue(
      activeMonitor({ disableActiveMonitoring: true }) as never,
    );

    await processIncomingRequestFromQueue(incomingRequest());
    await processIncomingRequestFromQueue(incomingRequest());

    expect(redis.size).toBe(0);
    expect(findOneBy).toHaveBeenCalledTimes(2);
    expect(monitorResource).not.toHaveBeenCalled();

    // #11141: skipped from the evaluation, each is listed as not evaluated.
    expect(listNotEvaluated).toHaveBeenCalledTimes(2);

    for (const call of listNotEvaluated.mock.calls) {
      expect((call[0] as { reason: MonitorPauseReason }).reason).toBe(
        MonitorPauseReason.Disabled,
      );
    }
  });

  test("a key that finds no monitor is not kept", async () => {
    findOneBy.mockResolvedValue(null as never);

    await expect(
      processIncomingRequestFromQueue(incomingRequest()),
    ).rejects.toThrow(notFound());

    expect(redis.size).toBe(0);
    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("a kept key that no longer finds its monitor is forgotten", async () => {
    await processIncomingRequestFromQueue(incomingRequest());
    expect(redis.size).toBe(1);

    monitorResource.mockImplementationOnce(() => {
      return Promise.reject(notFound());
    });

    await expect(
      processIncomingRequestFromQueue(incomingRequest()),
    ).rejects.toThrow(notFound());

    expect(redis.size).toBe(0);
  });

  test("a key kept for one kind of monitor is not the other kind's", async () => {
    await processServerMonitorFromQueue(serverReport());
    await processIncomingRequestFromQueue(incomingRequest());

    // Same key string, different kinds: each looked up once.
    expect(findOneBy).toHaveBeenCalledTimes(2);
    expect(redis.size).toBe(2);
  });

  test("the key never appears in Redis", async () => {
    await processIncomingRequestFromQueue(incomingRequest());

    for (const [name, value] of Array.from(redis.entries())) {
      expect(name).not.toContain(SECRET_KEY);
      expect(value).not.toContain(SECRET_KEY);
    }

    expect(MonitorSecretKeyCache.NAMESPACE).toBe("monitor-secret-key");
  });
});
