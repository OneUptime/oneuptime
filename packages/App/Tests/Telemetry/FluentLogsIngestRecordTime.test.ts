import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * The Fluentd ingest stores a log at its own time (issue #8010): the
 * record's time field, else the time Fluentd gave the event (the guide's
 * fluentd_time), else the time it is taken in. Before, every Fluentd log
 * was stored at the time it was processed, whatever its record said. The
 * service runs as it does in the worker, from the queued job's body to the
 * rows it hands the fan-in writer; only the database and the queue are
 * replaced.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/OpenTelemetryIngestService", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Services/OpenTelemetryIngestService",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: { telemetryServiceFromName: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Telemetry/TelemetryFanInWriter", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Telemetry/TelemetryFanInWriter",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: { submit: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Telemetry/Services/LogPipelineService", () => {
  return {
    __esModule: true,
    default: { loadPipelines: jest.fn(), processLog: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Telemetry/Services/LogDropFilterService", () => {
  return {
    __esModule: true,
    default: { loadDropFilters: jest.fn(), shouldDropLog: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Telemetry/Services/LogScrubRuleService", () => {
  return {
    __esModule: true,
    default: { loadScrubRules: jest.fn(), scrubLog: jest.fn() },
  };
});

import OTelIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { ExpressRequest } from "Common/Server/Utils/Express";
import FluentLogsIngestService from "../../FeatureSet/Telemetry/Services/FluentLogsIngestService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";

type MockedFn = jest.Mock;

const submitMock: MockedFn = TelemetryFanInWriter.submit as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

// When the worker takes the job in.
const NOW: Date = new Date("2026-11-15T10:17:18.703Z");
const NOW_COLUMN: string = "2026-11-15 10:17:18.703000000";
const NOW_NANOS: string = `${NOW.getTime()}000000`;

// The rows the job hands the fan-in writer.
const ingest: (entries: Array<unknown>) => Promise<Array<JSONObject>> = async (
  entries: Array<unknown>,
): Promise<Array<JSONObject>> => {
  await FluentLogsIngestService.processFluentLogsFromQueue({
    projectId: PROJECT_ID,
    body: { entries },
    headers: { "x-oneuptime-service-name": "checkout" },
  } as unknown as ExpressRequest);

  return submitMock.mock.calls.flatMap((call: Array<unknown>) => {
    return call[1] as Array<JSONObject>;
  });
};

const attributesOf: (row: JSONObject) => JSONObject = (
  row: JSONObject,
): JSONObject => {
  return row["attributes"] as JSONObject;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(NOW.getTime());
  });
  (
    OTelIngestService.telemetryServiceFromName as unknown as MockedFn
  ).mockImplementation((async () => {
    return {
      serviceName: "checkout",
      primaryEntityId: SERVICE_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      entityKeys: [],
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  }) as never);
  (LogPipelineService.loadPipelines as unknown as MockedFn).mockImplementation(
    (async () => {
      return [];
    }) as never,
  );
  (
    LogDropFilterService.loadDropFilters as unknown as MockedFn
  ).mockImplementation((async () => {
    return [];
  }) as never);
  (
    LogScrubRuleService.loadScrubRules as unknown as MockedFn
  ).mockImplementation((async () => {
    return [];
  }) as never);
  submitMock.mockReturnValue({ flushed: Promise.resolve() } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Fluentd log's time", () => {
  test("a JSON line's own time: stored at it, to the nanosecond, and not kept as an attribute", async () => {
    const [row] = await ingest([
      {
        time: "2026-11-14T08:00:00.123456789Z",
        level: "error",
        message: "payment failed",
        fluentd_time: "2026-11-15T10:17:12.834701377Z",
      },
    ]);

    expect(row!["time"]).toBe("2026-11-14 08:00:00.123456789");
    expect(row!["timeUnixNano"]).toBe("1794643200123456789");
    expect(row!["body"]).toBe("payment failed");
    expect(attributesOf(row!)["fluentd.time"]).toBeUndefined();
    // When Fluentd read it stays, as an attribute: the log says when it happened.
    expect(attributesOf(row!)["fluentd.fluentd_time"]).toBe(
      "2026-11-15T10:17:12.834701377Z",
    );
    expect(row!["attributeKeys"]).not.toContain("fluentd.time");
  });

  test("a line with no time of its own: stored at the time Fluentd gave the event", async () => {
    const [row] = await ingest([
      {
        message: "plain line: GET /health 200 3ms",
        fluentd_time: "2026-11-15T10:17:12.834740045Z",
      },
    ]);

    expect(row!["time"]).toBe("2026-11-15 10:17:12.834740045");
    expect(row!["timeUnixNano"]).toBe("1794737832834740045");
    expect(attributesOf(row!)["fluentd.fluentd_time"]).toBeUndefined();
  });

  test("a forwarded event (the Docker log driver's): stored at its sender's time", async () => {
    const [row] = await ingest([
      {
        log: "GET / 200",
        container_name: "web",
        source: "stdout",
        fluentd_time: "2026-11-15T09:59:59.000000001Z",
      },
    ]);

    expect(row!["time"]).toBe("2026-11-15 09:59:59.000000001");
    expect(attributesOf(row!)["fluentd.container_name"]).toBe("web");
  });

  test("a record with no time: stored at the time it is taken in, as before", async () => {
    const [row] = await ingest([{ message: "no time at all" }]);

    expect(row!["time"]).toBe(NOW_COLUMN);
    expect(row!["timeUnixNano"]).toBe(NOW_NANOS);
  });

  test("a string sent on its own: stored at the time it is taken in", async () => {
    const [row] = await ingest(["just a line"]);

    expect(row!["body"]).toBe("just a line");
    expect(row!["time"]).toBe(NOW_COLUMN);
  });

  test("a time field that holds no time: stored at the time it is taken in, and kept as an attribute", async () => {
    const [duration, word] = await ingest([
      { message: "took 125 ms", time: 125 },
      { message: "later", timestamp: "soon" },
    ]);

    expect(duration!["time"]).toBe(NOW_COLUMN);
    expect(attributesOf(duration!)["fluentd.time"]).toBe(125);
    expect(word!["time"]).toBe(NOW_COLUMN);
    expect(attributesOf(word!)["fluentd.timestamp"]).toBe("soon");
  });

  test("the other time fields stay attributes; only the one read is taken out", async () => {
    const [row] = await ingest([
      {
        message: "x",
        timestamp: "2026-11-14T08:00:00Z",
        ts: 1763107205.5,
        "@timestamp": "2026-11-14T07:00:00Z",
      },
    ]);

    expect(row!["time"]).toBe("2026-11-14 08:00:00.000000000");
    expect(attributesOf(row!)).toMatchObject({
      "fluentd.ts": 1763107205.5,
      "fluentd.@timestamp": "2026-11-14T07:00:00Z",
    });
    expect(attributesOf(row!)["fluentd.timestamp"]).toBeUndefined();
  });

  test("pino's milliseconds and zap's seconds", async () => {
    const [pino, zap] = await ingest([
      { level: 30, time: 1763107204123, pid: 7, msg: "pino" },
      { ts: 1763107205.5, msg: "zap" },
    ]);

    expect(pino!["time"]).toBe("2025-11-14 08:00:04.123000000");
    expect(attributesOf(pino!)["fluentd.pid"]).toBe(7);
    expect(zap!["time"]).toBe("2025-11-14 08:00:05.500000000");
  });

  test("an offset is taken off: the time column is UTC", async () => {
    const [row] = await ingest([
      { message: "x", time: "2026-11-14T09:00:00.5+01:00" },
    ]);

    expect(row!["time"]).toBe("2026-11-14 08:00:00.500000000");
  });

  test("when it was stored, and how long it is kept, count from the time it is taken in", async () => {
    const [row] = await ingest([
      { message: "old", time: "2026-10-01T08:00:00Z" },
    ]);

    expect(row!["time"]).toBe("2026-10-01 08:00:00.000000000");
    expect(row!["createdAt"]).toBe(OneUptimeDate.toClickhouseDateTime(NOW));
    expect(row!["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(OneUptimeDate.addRemoveDays(NOW, 15)),
    );
  });

  test("a time too far ahead, or before 2000, is not a log's time", async () => {
    const [ahead, before] = await ingest([
      { message: "a", time: "2026-11-17T00:00:00Z" },
      { message: "b", time: "1999-12-31T23:59:59Z" },
    ]);

    expect(ahead!["time"]).toBe(NOW_COLUMN);
    expect(before!["time"]).toBe(NOW_COLUMN);
  });

  test("every log of a batch the guide's Fluentd sent, at its own time", async () => {
    // What the stub of /fluentd/logs got from fluent/fluentd 1.20.1 running the guide's files.
    const rows: Array<JSONObject> = await ingest([
      {
        time: "2026-11-14T08:00:00.123Z",
        level: "error",
        message: "iso time line",
        fluentd_time: "2026-11-15T10:17:12.834701377Z",
      },
      {
        time: "2026-11-14T08:00:01+01:00",
        message: "iso offset line",
        fluentd_time: "2026-11-15T10:17:12.834712844Z",
      },
      {
        time: 1763107202,
        message: "epoch seconds line",
        fluentd_time: "2026-11-15T10:17:12.834714917Z",
      },
      {
        timestamp: "2026-11-14T08:00:06.000Z",
        message: "winston timestamp line",
        fluentd_time: "2026-11-15T10:17:12.834725794Z",
      },
      {
        message: "no time line",
        fluentd_time: "2026-11-15T10:17:12.834730932Z",
      },
      {
        message: "plain line: GET /health 200 3ms",
        fluentd_time: "2026-11-15T10:17:12.834740045Z",
      },
    ]);

    expect(
      rows.map((row: JSONObject): [unknown, unknown] => {
        return [row["body"], row["time"]];
      }),
    ).toEqual([
      ["iso time line", "2026-11-14 08:00:00.123000000"],
      ["iso offset line", "2026-11-14 07:00:01.000000000"],
      ["epoch seconds line", "2025-11-14 08:00:02.000000000"],
      ["winston timestamp line", "2026-11-14 08:00:06.000000000"],
      ["no time line", "2026-11-15 10:17:12.834730932"],
      ["plain line: GET /health 200 3ms", "2026-11-15 10:17:12.834740045"],
    ]);
    // Lines read one after another keep their order.
    expect(
      rows.slice(4).map((row: JSONObject): string => {
        return row["timeUnixNano"] as string;
      }),
    ).toEqual(["1794737832834730932", "1794737832834740045"]);
  });
});
