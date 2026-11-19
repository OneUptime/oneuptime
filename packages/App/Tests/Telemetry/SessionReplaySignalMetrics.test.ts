import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import {
  SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE,
  SESSION_REPLAY_SIGNAL_METRIC_INTERVAL_MS,
  SESSION_REPLAY_SIGNAL_NAME_ATTRIBUTE,
  SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
  SESSION_REPLAY_SIGNAL_SESSIONS_METRIC_DESCRIPTION,
} from "Common/Types/Rum/SessionReplaySignalMetric";

/*
 * SessionReplaySignalMetrics (issue #6518): how many recorded sessions hit
 * each of a RUM application's own signals, minute by minute - the series
 * its "Sessions hit <signal>" alerts sum. A session counts once for a
 * signal, from the first chunk that names it, whatever re-delivers that
 * chunk or how many tabs the session has; with Redis unreachable nothing is
 * counted at all. Points are Delta Sums under the application, written once
 * their minute is over.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (): void => {
        // No-op decorator: the real one needs a live tracer provider.
      };
    },
  };
});

jest.mock("Common/Server/Utils/GracefulShutdown", () => {
  return {
    __esModule: true,
    default: { registerHandler: jest.fn() },
    ShutdownPriority: { Workers: 20 },
  };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { insertJsonRows: jest.fn() },
  };
});

jest.mock("Common/Server/Services/OpenTelemetryIngestService", () => {
  return {
    __esModule: true,
    default: { buildResourceMetadataForNonService: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Telemetry/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      getAttributeKeys: (
        attributes: Record<string, unknown>,
      ): Array<string> => {
        return Object.keys(attributes).sort();
      },
      indexMetricNameServiceNameMap: jest.fn(),
    },
  };
});

/*
 * Redis as the counting needs it: one set per session, a MULTI of SADDs
 * and an EXPIRE whose results say which members were new.
 */
const sets: Map<string, Set<string>> = new Map<string, Set<string>>();
const expiries: Map<string, number> = new Map<string, number>();
let isRedisConnected: boolean = true;
let failNextExec: boolean = false;

class FakeTransaction {
  private readonly commands: Array<() => [Error | null, unknown]> = [];

  public sadd(key: string, member: string): FakeTransaction {
    this.commands.push((): [Error | null, unknown] => {
      const set: Set<string> = sets.get(key) ?? new Set<string>();
      const isNew: boolean = !set.has(member);

      set.add(member);
      sets.set(key, set);

      return [null, isNew ? 1 : 0];
    });

    return this;
  }

  public expire(key: string, seconds: number): FakeTransaction {
    this.commands.push((): [Error | null, unknown] => {
      expiries.set(key, seconds);
      return [null, 1];
    });

    return this;
  }

  public async exec(): Promise<Array<[Error | null, unknown]> | null> {
    if (failNextExec) {
      failNextExec = false;
      throw new Error("Connection is closed.");
    }

    return this.commands.map((command: () => [Error | null, unknown]) => {
      return command();
    });
  }
}

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return {
          multi: (): FakeTransaction => {
            return new FakeTransaction();
          },
        };
      },
      isConnected: (): boolean => {
        return isRedisConnected;
      },
    },
  };
});

import GracefulShutdown from "Common/Server/Utils/GracefulShutdown";
import MetricService from "Common/Server/Services/MetricService";
import OTelIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import SessionReplaySignalMetrics, {
  SESSION_REPLAY_SIGNAL_GRACE_MS,
  SESSION_REPLAY_SIGNAL_SET_TTL_SECONDS,
  SessionReplaySignalBucket,
} from "../../FeatureSet/Telemetry/Utils/SessionReplaySignalMetrics";

type MockedFn = ReturnType<typeof jest.fn>;

const insertMock: MockedFn =
  MetricService.insertJsonRows as unknown as MockedFn;
const metadataMock: MockedFn =
  OTelIngestService.buildResourceMetadataForNonService as unknown as MockedFn;
const indexMock: MockedFn =
  TelemetryUtil.indexMetricNameServiceNameMap as unknown as MockedFn;
const registerHandlerMock: MockedFn =
  GracefulShutdown.registerHandler as unknown as MockedFn;

const PROJECT_ID: string = ObjectID.generate().toString();
const APP_ID: string = ObjectID.generate().toString();
const SESSION_A: string = "a".repeat(32);
const SESSION_B: string = "b".repeat(32);

/* 12:00:00 UTC; every chunk arrives in the minutes after it. */
const MINUTE: number = Date.UTC(2026, 10, 19, 12, 0, 0);

const IDS: Record<string, string> = {
  "payment failed": "signal-payment",
  "support chat opened": "signal-chat",
};

function signals(
  ...names: Array<string>
): Array<{ name: string; count: number; frustrationCount: number }> {
  return names.map((name: string) => {
    return { name: name, count: 1, frustrationCount: 1 };
  });
}

async function chunk(
  sessionId: string,
  names: Array<string>,
  receivedAtUnixMs: number = MINUTE + 10_000,
): Promise<void> {
  await SessionReplaySignalMetrics.countChunk({
    projectId: PROJECT_ID,
    rumApplicationId: APP_ID,
    sessionId: sessionId,
    customSignals: signals(...names),
    customSignalIds: IDS,
    receivedAtUnixMs: receivedAtUnixMs,
  });
}

function due(): Array<SessionReplaySignalBucket> {
  return SessionReplaySignalMetrics.takeDue({
    nowMs: Number.MAX_SAFE_INTEGER,
    everything: true,
  }).sort(
    (left: SessionReplaySignalBucket, right: SessionReplaySignalBucket) => {
      return (
        left.minuteStartMs - right.minuteStartMs ||
        left.signalName.localeCompare(right.signalName)
      );
    },
  );
}

function writtenRows(): Array<JSONObject> {
  return insertMock.mock.calls.flatMap((call: Array<unknown>) => {
    return call[0] as Array<JSONObject>;
  });
}

beforeEach(() => {
  SessionReplaySignalMetrics.resetForTests();
  sets.clear();
  expiries.clear();
  isRedisConnected = true;
  failNextExec = false;
  insertMock.mockReset();
  insertMock.mockImplementation(async (): Promise<void> => {});
  metadataMock.mockReset();
  metadataMock.mockImplementation(async (): Promise<unknown> => {
    return {
      serviceRetentionConfig: null,
      serviceRetentionInDays: 15,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  });
  indexMock.mockReset();
  indexMock.mockImplementation(async (): Promise<void> => {});
});

afterEach(() => {
  SessionReplaySignalMetrics.resetForTests();
});

describe("which signals a chunk counts", () => {
  test("each name once, ignoring case and blanks, as the session row merges them", () => {
    expect(
      SessionReplaySignalMetrics.namesOf([
        { name: "Payment failed", count: 2, frustrationCount: 2 },
        { name: "payment FAILED", count: 1, frustrationCount: 1 },
        { name: "  ", count: 1, frustrationCount: 0 },
        { name: " Support chat opened ", count: 1, frustrationCount: 0 },
      ]),
    ).toEqual(["Payment failed", "Support chat opened"]);
    expect(SessionReplaySignalMetrics.namesOf(undefined)).toEqual([]);
  });
});

describe("a session counts once for a signal", () => {
  test("the first chunk that names a signal counts the session, in the minute it arrived", async () => {
    await chunk(SESSION_A, ["Payment failed"]);

    expect(due()).toEqual([
      {
        projectId: PROJECT_ID,
        rumApplicationId: APP_ID,
        signalId: "signal-payment",
        signalName: "Payment failed",
        minuteStartMs: MINUTE,
        count: 1,
      },
    ]);
  });

  test("a later chunk, a chunk sent again or a second tab of the session counts nothing more", async () => {
    await chunk(SESSION_A, ["Payment failed"]);
    await chunk(SESSION_A, ["Payment failed", "Support chat opened"]);
    await chunk(SESSION_A, ["payment failed"], MINUTE + 70_000);

    expect(
      due().map((bucket: SessionReplaySignalBucket) => {
        return [bucket.signalName, bucket.count];
      }),
    ).toEqual([
      ["Payment failed", 1],
      ["Support chat opened", 1],
    ]);
  });

  test("every session that hits a signal counts, in the minute its chunk arrived", async () => {
    await chunk(SESSION_A, ["Payment failed"], MINUTE + 1_000);
    await chunk(SESSION_B, ["Payment failed"], MINUTE + 2_000);
    await chunk("c".repeat(32), ["Payment failed"], MINUTE + 61_000);

    expect(
      due().map((bucket: SessionReplaySignalBucket) => {
        return [bucket.minuteStartMs, bucket.count];
      }),
    ).toEqual([
      [MINUTE, 2],
      [MINUTE + SESSION_REPLAY_SIGNAL_METRIC_INTERVAL_MS, 1],
    ]);
  });

  test("keeps each session's set of counted signals for a day after its last chunk", async () => {
    await chunk(SESSION_A, ["Payment failed"]);

    const key: string = SessionReplaySignalMetrics.sessionSetKey(
      PROJECT_ID,
      SESSION_A,
    );

    expect(Array.from(sets.get(key) ?? [])).toEqual(["payment failed"]);
    expect(expiries.get(key)).toBe(SESSION_REPLAY_SIGNAL_SET_TTL_SECONDS);
  });

  test("files a name the settings no longer hold under no id - a page loaded before a rename", async () => {
    await chunk(SESSION_A, ["Payment declined"]);

    expect(due()[0]?.signalId).toBe("");
  });

  test("counts nothing with Redis unreachable, or when it fails, rather than count a session twice", async () => {
    isRedisConnected = false;
    await chunk(SESSION_A, ["Payment failed"]);

    isRedisConnected = true;
    failNextExec = true;
    await chunk(SESSION_B, ["Payment failed"]);

    expect(due()).toEqual([]);
    /* The next chunk of a session whose first was missed counts it then. */
    await chunk(SESSION_A, ["Payment failed"]);
    expect(due()).toHaveLength(1);
  });

  test("a chunk that names no signal asks Redis nothing", async () => {
    await SessionReplaySignalMetrics.countChunk({
      projectId: PROJECT_ID,
      rumApplicationId: APP_ID,
      sessionId: SESSION_A,
      customSignals: [],
      customSignalIds: IDS,
      receivedAtUnixMs: MINUTE,
    });

    expect(sets.size).toBe(0);
  });
});

describe("what is written", () => {
  test("a Delta Sum point per signal per minute, under the application, by id and name", () => {
    const rows: Array<JSONObject> = SessionReplaySignalMetrics.buildRows({
      buckets: [
        {
          projectId: PROJECT_ID,
          rumApplicationId: APP_ID,
          signalId: "signal-payment",
          signalName: "Payment failed",
          minuteStartMs: MINUTE,
          count: 3,
        },
      ],
      retentionInDaysByApplication: new Map<string, number>([[APP_ID, 15]]),
      writtenAt: new Date(MINUTE + 65_000),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: PROJECT_ID,
      primaryEntityId: APP_ID,
      primaryEntityType: ServiceType.RealUserMonitor,
      name: SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
      aggregationTemporality: AggregationTemporality.Delta,
      metricPointType: MetricPointType.Sum,
      isMonotonic: true,
      value: 3,
      attributes: {
        [SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE]: "signal-payment",
        [SESSION_REPLAY_SIGNAL_NAME_ATTRIBUTE]: "Payment failed",
      },
      attributeKeys: [
        SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE,
        SESSION_REPLAY_SIGNAL_NAME_ATTRIBUTE,
      ].sort(),
    });
  });

  test("leaves the id out when it is not known, so a filter on an id never matches it", () => {
    const rows: Array<JSONObject> = SessionReplaySignalMetrics.buildRows({
      buckets: [
        {
          projectId: PROJECT_ID,
          rumApplicationId: APP_ID,
          signalId: "",
          signalName: "Payment declined",
          minuteStartMs: MINUTE,
          count: 1,
        },
      ],
      retentionInDaysByApplication: new Map<string, number>(),
      writtenAt: new Date(MINUTE + 65_000),
    });

    expect(rows[0]?.["attributes"]).toEqual({
      [SESSION_REPLAY_SIGNAL_NAME_ATTRIBUTE]: "Payment declined",
    });
  });

  test("writes a minute once it and its grace are over, and puts the series in the catalog once", async () => {
    const now: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Date, "now")
      .mockReturnValue(MINUTE + 10_000);

    try {
      await chunk(SESSION_A, ["Payment failed"]);
      await chunk(SESSION_B, ["Support chat opened"]);

      await SessionReplaySignalMetrics.flush({ everything: false });
      expect(insertMock).not.toHaveBeenCalled();

      now.mockReturnValue(
        MINUTE +
          SESSION_REPLAY_SIGNAL_METRIC_INTERVAL_MS +
          SESSION_REPLAY_SIGNAL_GRACE_MS,
      );
      await SessionReplaySignalMetrics.flush({ everything: false });

      expect(insertMock).toHaveBeenCalledTimes(1);
      expect(
        writtenRows().map((row: JSONObject) => {
          return (row["attributes"] as JSONObject)[
            SESSION_REPLAY_SIGNAL_NAME_ATTRIBUTE
          ];
        }),
      ).toEqual(["Payment failed", "Support chat opened"]);
      expect(SessionReplaySignalMetrics.getBucketCountForTests()).toBe(0);

      expect(indexMock).toHaveBeenCalledTimes(1);
      const catalog: Record<string, { description?: string }> = (
        indexMock.mock.calls[0]?.[0] as {
          metricNameServiceNameMap: Record<string, { description?: string }>;
        }
      ).metricNameServiceNameMap;
      expect(Object.keys(catalog)).toEqual([
        SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
      ]);
      expect(catalog[SESSION_REPLAY_SIGNAL_SESSIONS_METRIC]?.description).toBe(
        SESSION_REPLAY_SIGNAL_SESSIONS_METRIC_DESCRIPTION,
      );

      /* A second write in the same process registers nothing again. */
      await chunk("c".repeat(32), ["Payment failed"]);
      await SessionReplaySignalMetrics.flush({ everything: true });
      expect(indexMock).toHaveBeenCalledTimes(1);
      expect(registerHandlerMock).toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  test("a failed write is logged and lost, never thrown into the ingest", async () => {
    insertMock.mockImplementation(async (): Promise<void> => {
      throw new Error("ClickHouse is down");
    });

    await chunk(SESSION_A, ["Payment failed"]);

    await expect(
      SessionReplaySignalMetrics.flush({ everything: true }),
    ).resolves.toBeUndefined();
    expect(SessionReplaySignalMetrics.getBucketCountForTests()).toBe(0);
  });
});
