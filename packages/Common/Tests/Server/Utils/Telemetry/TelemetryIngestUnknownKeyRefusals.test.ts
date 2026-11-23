import logger from "../../../../Server/Utils/Logger";
import {
  MAX_UNKNOWN_KEY_REFUSAL_COUNTS,
  TelemetryIngestUnknownKeyRefusalCounter,
  UNKNOWN_KEY_REFUSAL_LOG_INTERVAL_MS,
  UnknownIngestionKeyRefusal,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestUnknownKeyRefusals";
import TelemetryIngestSurface from "../../../../Types/Telemetry/TelemetryIngestSurface";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TELEMETRY REFUSED FOR A MISSING OR UNKNOWN INGESTION KEY, COUNTED PER
 * PROCESS (#10703, #6427): such a request names no project, so no key's
 * refusal count holds it, and it comes from anyone - it was one error-level
 * line a request. The counts are logged at warn at most once a minute, on
 * the first refusal after the minute, with everything counted since the
 * line before it.
 */

type MockFn = jest.Mock;

const START: number = Date.parse("2026-11-22T10:00:00.000Z");

let now: number = START;
let counter: TelemetryIngestUnknownKeyRefusalCounter;
let warn: MockFn;

const warnLines: () => Array<string> = (): Array<string> => {
  return warn.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
};

beforeEach(() => {
  now = START;
  counter = new TelemetryIngestUnknownKeyRefusalCounter((): number => {
    return now;
  });
  warn = jest
    .spyOn(logger, "warn")
    .mockImplementation((): void => {}) as unknown as MockFn;
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a missing or unknown key's refusals", () => {
  test("the first is logged at once, at warn, with its surface", () => {
    counter.record({
      refusal: UnknownIngestionKeyRefusal.Missing,
      surface: TelemetryIngestSurface.Fluent,
    });

    expect(warnLines()).toEqual([
      "TelemetryIngest: refused 1 request with no ingestion key (fluent: 1). Each is logged at debug; these counts at most once a minute.",
    ]);
    expect(counter.getCounts().size).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("the rest of the minute are counted, not logged, by why and by surface", () => {
    counter.record({
      refusal: UnknownIngestionKeyRefusal.Missing,
      surface: TelemetryIngestSurface.Fluent,
    });

    for (let index: number = 0; index < 1000; index++) {
      now = START + (index % 59) * 1000;
      counter.record({
        refusal:
          index % 3 === 0
            ? UnknownIngestionKeyRefusal.Unknown
            : UnknownIngestionKeyRefusal.Missing,
        surface:
          index % 2 === 0
            ? TelemetryIngestSurface.Syslog
            : TelemetryIngestSurface.OtelLogs,
      });
    }

    // One line for the 1,001 of them.
    expect(warnLines()).toHaveLength(1);

    const counts: Record<string, number> = Object.fromEntries(
      counter.getCounts(),
    );

    expect(
      Object.values(counts).reduce((sum: number, count: number): number => {
        return sum + count;
      }, 0),
    ).toBe(1000);
    expect(Object.keys(counts).sort()).toEqual([
      "missing|otel-logs",
      "missing|syslog",
      "unknown|otel-logs",
      "unknown|syslog",
    ]);
  });

  test("the first after the minute is logged with everything since the line before it, and the counts start again", () => {
    counter.record({
      refusal: UnknownIngestionKeyRefusal.Unknown,
      surface: TelemetryIngestSurface.Pyroscope,
    });

    for (let index: number = 0; index < 5; index++) {
      now = START + 10_000;
      counter.record({
        refusal: UnknownIngestionKeyRefusal.Missing,
        surface: TelemetryIngestSurface.Fluent,
      });
      counter.record({
        refusal: UnknownIngestionKeyRefusal.Unknown,
        surface: TelemetryIngestSurface.Grpc,
      });
    }

    now = START + UNKNOWN_KEY_REFUSAL_LOG_INTERVAL_MS;
    counter.record({
      refusal: UnknownIngestionKeyRefusal.Missing,
      surface: TelemetryIngestSurface.Syslog,
    });

    expect(warnLines()).toEqual([
      "TelemetryIngest: refused 1 request with an unknown ingestion key (pyroscope: 1). Each is logged at debug; these counts at most once a minute.",
      "TelemetryIngest: refused 6 requests with no ingestion key (fluent: 5, syslog: 1) and 5 requests with an unknown ingestion key (grpc: 5) since 2026-11-22T10:00:00.000Z. Each is logged at debug; these counts at most once a minute.",
    ]);
    expect(counter.getCounts().size).toBe(0);

    // A minute less a millisecond later: counted, not logged.
    now = START + 2 * UNKNOWN_KEY_REFUSAL_LOG_INTERVAL_MS - 1;
    counter.record({
      refusal: UnknownIngestionKeyRefusal.Missing,
      surface: TelemetryIngestSurface.Syslog,
    });

    expect(warnLines()).toHaveLength(2);
    expect(Object.fromEntries(counter.getCounts())).toEqual({
      "missing|syslog": 1,
    });
  });

  test("the legacy guard, which names no surface, is counted as unnamed", () => {
    counter.record({
      refusal: UnknownIngestionKeyRefusal.Missing,
      surface: null,
    });

    expect(warnLines()[0]).toContain("(unnamed: 1)");
  });

  test("holds a bounded number of counts", () => {
    counter.record({
      refusal: UnknownIngestionKeyRefusal.Missing,
      surface: TelemetryIngestSurface.Fluent,
    });

    for (
      let index: number = 0;
      index < MAX_UNKNOWN_KEY_REFUSAL_COUNTS * 2;
      index++
    ) {
      counter.record({
        refusal: UnknownIngestionKeyRefusal.Missing,
        surface: `surface-${index}` as TelemetryIngestSurface,
      });
    }

    expect(counter.getCounts().size).toBe(MAX_UNKNOWN_KEY_REFUSAL_COUNTS);

    // A reason and surface already counted is counted still.
    counter.record({
      refusal: UnknownIngestionKeyRefusal.Missing,
      surface: "surface-0" as TelemetryIngestSurface,
    });

    expect(counter.getCounts().get("missing|surface-0")).toBe(2);
  });

  test("never throws, whatever the logger does", () => {
    warn.mockImplementation((): void => {
      throw new Error("the log sink is down");
    });

    expect(() => {
      counter.record({
        refusal: UnknownIngestionKeyRefusal.Unknown,
        surface: TelemetryIngestSurface.Syslog,
      });
    }).not.toThrow();
  });

  test("clear forgets the counts and the last line", () => {
    counter.record({
      refusal: UnknownIngestionKeyRefusal.Missing,
      surface: TelemetryIngestSurface.Fluent,
    });
    counter.record({
      refusal: UnknownIngestionKeyRefusal.Missing,
      surface: TelemetryIngestSurface.Fluent,
    });

    counter.clear();

    expect(counter.getCounts().size).toBe(0);

    counter.record({
      refusal: UnknownIngestionKeyRefusal.Missing,
      surface: TelemetryIngestSurface.Fluent,
    });

    expect(warnLines()).toHaveLength(2);
  });
});
