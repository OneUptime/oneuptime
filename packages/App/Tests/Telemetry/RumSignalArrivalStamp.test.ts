/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced - same idiom as
 * OtelIngestDiscoveredResourceGone.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import OtelIngestBaseService, {
  RUM_SIGNAL_FENCE_SCOPE,
} from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import LabelService from "Common/Server/Services/LabelService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import RumApplicationClientService from "Common/Server/Services/RumApplicationClientService";
import { ResourceHeartbeatResult } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "Common/Server/Utils/SingleFlight";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  RUM_TELEMETRY_SIGNAL_COLUMNS,
  RumTelemetrySignal,
} from "Common/Types/Rum/RumTelemetrySignal";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHEN EACH KIND OF TELEMETRY LAST ARRIVED FROM A RUM APPLICATION (issue
 * #5770).
 *
 * The OpenTelemetry browser SDK sends page loads and requests on its own,
 * and logs and metrics only once a pipeline for them is added. So that an
 * empty Logs chart can say "logs aren't set up" rather than "no data in
 * this time range", ingest stamps the application's tracesLastReceivedAt,
 * logsLastReceivedAt or metricsLastReceivedAt as a batch of that kind is
 * filed under it. What is pinned here:
 *
 *   1. Each ingest path stamps its own signal, and the profiles path none.
 *   2. The stamp sits behind a fence of its own per (application, signal):
 *      at most once per window however many batches arrive, and a logs
 *      batch never waits for the traces stamp's window.
 *   3. A stamp that fails releases its fence for the next batch, is
 *      logged, and never costs the batch its RUM application.
 *   4. Telemetry that is not a RUM application's stamps nothing.
 *   5. The write itself: one column, hook-free, updatedAt untouched.
 *
 * Redis is a Map with GlobalCache's semantics; the services' find-or-create
 * and heartbeat are the seams.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6c8b5e0e-8f3a-4c51-9b52-0a6f2a1d4b10",
);
const APP_ID: string = "33333333-3333-4333-8333-333333333333";
const FENCE_NAMESPACE: string = "otel-maintenance-fence";

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

const BROWSER_ATTRIBUTES: JSONArray = [
  stringAttribute("browser.platform", "macOS"),
  stringAttribute("service.name", "storefront-web"),
  stringAttribute("telemetry.sdk.language", "webjs"),
] as JSONArray;

// A backend service: no browser.* or device.* attribute.
const SERVICE_ATTRIBUTES: JSONArray = [
  stringAttribute("service.name", "checkout-api"),
  stringAttribute("telemetry.sdk.language", "nodejs"),
] as JSONArray;

interface Stamp {
  rumApplicationId: string;
  signal: RumTelemetrySignal;
}

describe("a RUM application's signal arrival stamps", () => {
  let redis: Map<string, string>;
  let stamps: Array<Stamp>;
  let failNextStamps: number;
  let warnings: Array<string>;

  async function ingest(data: {
    signal?: RumTelemetrySignal | undefined;
    attributes?: JSONArray;
  }): Promise<string | null> {
    const id: ObjectID | null = (await baseService["autoDiscoverRum"]({
      projectId: PROJECT_ID,
      attributes: data.attributes || BROWSER_ATTRIBUTES,
      ...(data.signal ? { signal: data.signal } : {}),
    })) as ObjectID | null;

    return id ? id.toString() : null;
  }

  function signalFence(signal: RumTelemetrySignal): string {
    return `${FENCE_NAMESPACE}:${RUM_SIGNAL_FENCE_SCOPE}:${APP_ID}:${signal}`;
  }

  beforeEach(() => {
    redis = new Map<string, string>();
    stamps = [];
    failNextStamps = 0;
    warnings = [];

    OtelIngestBaseService.clearInProcessMemos();
    SingleFlight.clear();

    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (ns: string, k: string) => {
        return redis.get(`${ns}:${k}`) ?? null;
      });
    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(async (ns: string, k: string, value: string) => {
        redis.set(`${ns}:${k}`, value);
      });
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(async (ns: string, k: string) => {
        redis.delete(`${ns}:${k}`);
      });
    // SET NX: the first claim of a fence wins it for its window.
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(async (ns: string, k: string, value: string) => {
        if (redis.has(`${ns}:${k}`)) {
          return false;
        }
        redis.set(`${ns}:${k}`, value);
        return true;
      });

    jest
      .spyOn(RumApplicationService, "findOrCreateByAppIdentifier")
      .mockImplementation(async () => {
        return { _id: APP_ID, id: new ObjectID(APP_ID) } as never;
      });
    jest
      .spyOn(RumApplicationService, "updateLastSeen")
      .mockImplementation(async (): Promise<ResourceHeartbeatResult> => {
        return { isRowGone: false };
      });
    jest
      .spyOn(RumApplicationService, "markTelemetrySignalReceived")
      .mockImplementation(
        async (data: {
          rumApplicationId: ObjectID;
          signal: RumTelemetrySignal;
        }): Promise<void> => {
          if (failNextStamps > 0) {
            failNextStamps--;
            throw new Error("deadlock detected");
          }
          stamps.push({
            rumApplicationId: data.rumApplicationId.toString(),
            signal: data.signal,
          });
        },
      );

    jest.spyOn(LabelService, "findOrCreateLabelsByNames").mockResolvedValue([]);
    jest
      .spyOn(RumApplicationClientService, "recordClient")
      .mockResolvedValue(undefined);
    jest.spyOn(logger, "info").mockImplementation(() => {
      return undefined as never;
    });
    jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
      warnings.push(String(message));
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    OtelIngestBaseService.clearInProcessMemos();
    SingleFlight.clear();
  });

  test.each([
    RumTelemetrySignal.Traces,
    RumTelemetrySignal.Logs,
    RumTelemetrySignal.Metrics,
  ])(
    "a batch of %s stamps that signal on the application",
    async (signal: RumTelemetrySignal) => {
      await expect(ingest({ signal })).resolves.toBe(APP_ID);

      expect(stamps).toEqual([{ rumApplicationId: APP_ID, signal }]);
    },
  );

  test("a batch that names no signal (the profiles path) stamps nothing", async () => {
    await expect(ingest({})).resolves.toBe(APP_ID);

    expect(stamps).toEqual([]);
  });

  test("a stamp runs once per fence window, however many batches arrive", async () => {
    for (let batch: number = 0; batch < 5; batch++) {
      await expect(ingest({ signal: RumTelemetrySignal.Logs })).resolves.toBe(
        APP_ID,
      );
    }

    expect(stamps).toEqual([
      { rumApplicationId: APP_ID, signal: RumTelemetrySignal.Logs },
    ]);
    expect(redis.has(signalFence(RumTelemetrySignal.Logs))).toBe(true);
  });

  test("each signal has a fence of its own: logs never wait for the traces stamp's window", async () => {
    await ingest({ signal: RumTelemetrySignal.Traces });
    await ingest({ signal: RumTelemetrySignal.Traces });
    await ingest({ signal: RumTelemetrySignal.Logs });
    await ingest({ signal: RumTelemetrySignal.Metrics });
    await ingest({ signal: RumTelemetrySignal.Logs });

    expect(
      stamps.map((stamp: Stamp): RumTelemetrySignal => {
        return stamp.signal;
      }),
    ).toEqual([
      RumTelemetrySignal.Traces,
      RumTelemetrySignal.Logs,
      RumTelemetrySignal.Metrics,
    ]);
  });

  test("the stamp's fence is not the heartbeat's: a held heartbeat fence still lets the first logs stamp through", async () => {
    // The heartbeat ran a minute ago, from another worker.
    redis.set(`${FENCE_NAMESPACE}:rum-application:${APP_ID}`, "1");

    await expect(ingest({ signal: RumTelemetrySignal.Logs })).resolves.toBe(
      APP_ID,
    );

    expect(RumApplicationService.updateLastSeen).not.toHaveBeenCalled();
    expect(stamps).toEqual([
      { rumApplicationId: APP_ID, signal: RumTelemetrySignal.Logs },
    ]);
  });

  test("a stamp that fails releases its fence, says so, and the batch keeps its RUM application", async () => {
    failNextStamps = 1;

    await expect(ingest({ signal: RumTelemetrySignal.Logs })).resolves.toBe(
      APP_ID,
    );

    expect(stamps).toEqual([]);
    expect(redis.has(signalFence(RumTelemetrySignal.Logs))).toBe(false);
    expect(warnings).toEqual([
      `RUM application ${APP_ID}: could not record that logs arrived: deadlock detected`,
    ]);
    // The heartbeat's fence, armed for the same batch, is left alone.
    expect(redis.has(`${FENCE_NAMESPACE}:rum-application:${APP_ID}`)).toBe(
      true,
    );

    // The next batch tries again, and lands.
    await expect(ingest({ signal: RumTelemetrySignal.Logs })).resolves.toBe(
      APP_ID,
    );
    expect(stamps).toEqual([
      { rumApplicationId: APP_ID, signal: RumTelemetrySignal.Logs },
    ]);
  });

  test("an application deleted while it keeps sending is stamped on the row that answers now", async () => {
    const newAppId: string = "44444444-4444-4444-8444-444444444444";
    const rows: Array<string> = [APP_ID, newAppId];

    jest
      .spyOn(RumApplicationService, "findOrCreateByAppIdentifier")
      .mockImplementation(async () => {
        const id: string = rows.shift() || newAppId;
        return { _id: id, id: new ObjectID(id) } as never;
      });
    jest
      .spyOn(RumApplicationService, "updateLastSeen")
      .mockImplementation(
        async (id: unknown): Promise<ResourceHeartbeatResult> => {
          return { isRowGone: (id as ObjectID).toString() === APP_ID };
        },
      );

    await expect(ingest({ signal: RumTelemetrySignal.Logs })).resolves.toBe(
      newAppId,
    );

    expect(stamps).toEqual([
      { rumApplicationId: newAppId, signal: RumTelemetrySignal.Logs },
    ]);
  });

  test("with Redis down, the stamp still runs", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("Redis is down"));

    await expect(ingest({ signal: RumTelemetrySignal.Metrics })).resolves.toBe(
      APP_ID,
    );

    expect(stamps).toEqual([
      { rumApplicationId: APP_ID, signal: RumTelemetrySignal.Metrics },
    ]);
  });

  test("telemetry that is not a RUM application's stamps nothing", async () => {
    await expect(
      ingest({
        signal: RumTelemetrySignal.Logs,
        attributes: SERVICE_ATTRIBUTES,
      }),
    ).resolves.toBeNull();

    expect(stamps).toEqual([]);
    expect(
      RumApplicationService.findOrCreateByAppIdentifier,
    ).not.toHaveBeenCalled();
  });
});

describe("RumApplicationService.markTelemetrySignalReceived", () => {
  interface CapturedQuery {
    sql: string;
    params: Array<unknown>;
  }

  let captured: Array<CapturedQuery>;
  let failQuery: boolean;

  beforeEach(() => {
    captured = [];
    failQuery = false;

    const columns: Record<string, string> = {
      tracesLastReceivedAt: "tracesLastReceivedAt",
      logsLastReceivedAt: "logsLastReceivedAt",
      metricsLastReceivedAt: "metricsLastReceivedAt",
      _id: "_id",
      updatedAt: "updatedAt",
    };

    jest.spyOn(RumApplicationService, "getRepository").mockReturnValue({
      metadata: {
        tableName: "RumApplication",
        findColumnWithPropertyName: (
          propertyName: string,
        ): { databaseName: string } | undefined => {
          return columns[propertyName]
            ? { databaseName: columns[propertyName]! }
            : undefined;
        },
        updateDateColumn: { databaseName: "updatedAt" },
        primaryColumns: [{ databaseName: "_id" }],
      },
      manager: {
        connection: {
          driver: {
            preparePersistentValue: (value: unknown): unknown => {
              return value;
            },
          },
        },
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<unknown> => {
          if (failQuery) {
            throw new Error("connection terminated");
          }
          captured.push({ sql, params });
          return [];
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [RumTelemetrySignal.Traces, "tracesLastReceivedAt"],
    [RumTelemetrySignal.Logs, "logsLastReceivedAt"],
    [RumTelemetrySignal.Metrics, "metricsLastReceivedAt"],
  ])(
    "%s: one column set to now, with no hooks and updatedAt untouched",
    async (signal: RumTelemetrySignal, column: string) => {
      const before: number = Date.now();

      await RumApplicationService.markTelemetrySignalReceived({
        rumApplicationId: new ObjectID(APP_ID),
        signal,
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]!.sql).toBe(
        `UPDATE "RumApplication" SET "${column}" = $1 WHERE "_id" = $2`,
      );
      const stampedAt: Date = captured[0]!.params[0] as Date;
      expect(stampedAt).toBeInstanceOf(Date);
      expect(stampedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(stampedAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(captured[0]!.params[1]).toBe(APP_ID);
    },
  );

  test("a signal with no column writes nothing", async () => {
    await RumApplicationService.markTelemetrySignalReceived({
      rumApplicationId: new ObjectID(APP_ID),
      signal: "profiles" as RumTelemetrySignal,
    });

    expect(captured).toEqual([]);
  });

  test("a write that fails throws, so the caller can release its fence", async () => {
    failQuery = true;

    await expect(
      RumApplicationService.markTelemetrySignalReceived({
        rumApplicationId: new ObjectID(APP_ID),
        signal: RumTelemetrySignal.Logs,
      }),
    ).rejects.toThrow("connection terminated");
  });

  test("every signal has a column of its own", () => {
    const columns: Array<string> = Object.values(RUM_TELEMETRY_SIGNAL_COLUMNS);

    expect(Object.keys(RUM_TELEMETRY_SIGNAL_COLUMNS).sort()).toEqual(
      Object.values(RumTelemetrySignal).sort(),
    );
    expect(new Set(columns).size).toBe(columns.length);
  });
});

describe("the ingest paths that stamp a RUM application", () => {
  const SERVICES_DIR: string = path.resolve(
    __dirname,
    "../../FeatureSet/Telemetry/Services",
  );

  // The signal each service's autoDiscoverRum call names, or null for none.
  function signalsNamed(file: string): Array<string | null> {
    const source: string = fs.readFileSync(
      path.join(SERVICES_DIR, file),
      "utf8",
    );

    return Array.from(
      source.matchAll(/this\.autoDiscoverRum\(\{([^}]*)\}\)/g),
    ).map((match: RegExpMatchArray): string | null => {
      const signal: RegExpMatchArray | null = match[1]!.match(
        /signal:\s*RumTelemetrySignal\.(\w+)/,
      );
      return signal ? signal[1]! : null;
    });
  }

  test("traces, logs and metrics each stamp their own signal, profiles none", () => {
    expect({
      traces: signalsNamed("OtelTracesIngestService.ts"),
      logs: signalsNamed("OtelLogsIngestService.ts"),
      metrics: signalsNamed("OtelMetricsIngestService.ts"),
      profiles: signalsNamed("OtelProfilesIngestService.ts"),
    }).toEqual({
      traces: ["Traces"],
      logs: ["Logs"],
      metrics: ["Metrics"],
      profiles: [null],
    });
  });
});
