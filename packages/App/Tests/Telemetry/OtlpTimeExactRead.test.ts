/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it — including all full-loop telemetry suites. Nothing in
 * this suite touches password hashing; stub the module before the service
 * import graph drags it into compilation.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelProfilesIngestService from "../../FeatureSet/Telemetry/Services/OtelProfilesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { MetricPointType } from "Common/Models/AnalyticsModels/Metric";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Every OTLP time the four ingest services store is read from its digits
 * when it came as an integer string - how OTLP/protobuf sends every time -
 * through OneUptimeDate.readExactUnixNano: the span, span event, metric
 * point, profile and log times, and the log's DateTime64 time column.
 *
 * They read a float of it before (parseFloat). Today's times are about
 * 1.8e18 ns, where doubles are 256 ns apart, so the float was up to 128 ns
 * off: the stored nanoseconds were wrong in their last digits, the Date made
 * from the float a millisecond off (early on one whole millisecond in eight,
 * late just before a millisecond ends), and a time up to 128 ns before a
 * whole second read as that second. Each
 * service is driven through its real parse on such values, and on every
 * other kind of value against master's parse, verbatim, which must still
 * decide them: numbers, non-integer strings, negative and over-long values,
 * empty and invalid strings, the fallbacks and their warnings.
 */

// 2026-10-17T10:11:12Z, a whole second of today's epoch.
const SECOND: number = Date.UTC(2026, 9, 17, 10, 11, 12) / 1000;
const SECOND_IN_MS: number = SECOND * 1000;

// The time `offsetInNanos` from SECOND, as OTLP/protobuf sends it.
function nanosFromSecond(offsetInNanos: number): string {
  return (
    BigInt(SECOND) * BigInt(1000000000) +
    BigInt(offsetInNanos)
  ).toString();
}

// 2026-10-17T10:11:11.999999900Z: the float read it as 10:11:12.000.
const JUST_BEFORE_SECOND: string = nanosFromSecond(-100);
// 2026-10-17T10:11:12.000000100Z: the float lost its 100 ns.
const JUST_AFTER_SECOND: string = nanosFromSecond(100);
// 2026-10-17T10:11:12.346Z, a whole millisecond the float read as .345.
const EARLY_MS: number = SECOND_IN_MS + 346;
const EARLY_MS_NANO: string = `${EARLY_MS}000000`;
// 2026-10-17T10:11:12.345678901Z; the float wrote ...345678800.
const PRECISE_NANO: string = "1792231872345678901";

// The clock every fallback reads here, so master and the branch agree.
const FROZEN_NOW_MS: number = Date.UTC(2026, 9, 31, 8, 0, 0, 777);

// What the float read made of a text's millisecond.
function floatReadMs(text: string): number {
  return new Date(Math.trunc(Number.parseFloat(text)) / 1000000).getTime();
}

type ParsedUnixNano = {
  unixNano: number;
  nano: string;
  iso: string;
  date: Date;
};

type MetricTimestamp = {
  nano: string;
  db: string;
  date: Date;
};

type ParseFunction<T> = (
  value: string | number | undefined,
  context: string,
  fallback?: T,
) => T;

// A private static of a service, as the ingest walk calls it.
function privateStatic<T>(service: unknown, name: string): T {
  const statics: Record<string, any> = service as Record<string, any>;
  return (statics[name] as (...args: Array<unknown>) => unknown).bind(
    service,
  ) as unknown as T;
}

const tracesParse: ParseFunction<ParsedUnixNano> = privateStatic<
  ParseFunction<ParsedUnixNano>
>(OtelTracesIngestService, "safeParseUnixNano");

const tracesDuration: (start: ParsedUnixNano, end: ParsedUnixNano) => string =
  privateStatic<(start: ParsedUnixNano, end: ParsedUnixNano) => string>(
    OtelTracesIngestService,
    "calculateDurationNano",
  );

const metricsParse: ParseFunction<MetricTimestamp> = privateStatic<
  ParseFunction<MetricTimestamp>
>(OtelMetricsIngestService, "safeParseUnixNano");

const profilesParse: ParseFunction<ParsedUnixNano> = privateStatic<
  ParseFunction<ParsedUnixNano>
>(OtelProfilesIngestService, "safeParseUnixNano");

type BuildMetricRowFunction = (data: {
  datapoint: JSONObject;
  baseAttributes: JSONObject;
  projectId: ObjectID;
  primaryEntityId: ObjectID;
  serviceName: string;
  metricName: string;
  metricPointType: MetricPointType;
  serviceMetadata: TelemetryServiceMetadata;
}) => JSONObject;

const buildMetricRow: BuildMetricRowFunction =
  privateStatic<BuildMetricRowFunction>(
    OtelMetricsIngestService,
    "buildMetricRow",
  );

// Master's OtelTracesIngestService.safeParseUnixNano, verbatim.
function masterTracesParse(
  value: string | number | undefined,
  context: string,
): ParsedUnixNano {
  let numericValue: number = OneUptimeDate.getCurrentDateAsUnixNano();

  if (value !== undefined && value !== null) {
    try {
      if (typeof value === "string") {
        const parsed: number = Number.parseFloat(value);
        if (!Number.isNaN(parsed)) {
          numericValue = parsed;
        } else {
          throw new Error(`Invalid timestamp string: ${value}`);
        }
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new Error(`Invalid timestamp number: ${value}`);
        }
        numericValue = value;
      }
    } catch (error) {
      logger.warn(
        `Error processing ${context}: ${error instanceof Error ? error.message : String(error)}, using current time`,
      );
      numericValue = OneUptimeDate.getCurrentDateAsUnixNano();
    }
  }

  numericValue = Math.trunc(numericValue);
  const date: Date = OneUptimeDate.fromUnixNano(numericValue);
  const iso: string = OneUptimeDate.toString(date);

  return {
    unixNano: numericValue,
    nano: numericValue.toString(),
    iso: iso,
    date: date,
  };
}

// Master's OtelMetricsIngestService.safeParseUnixNano, verbatim.
function masterMetricsParse(
  value: string | number | undefined,
  context: string,
): MetricTimestamp {
  let numericValue: number | null = null;

  if (value !== undefined && value !== null) {
    try {
      if (typeof value === "string") {
        const parsed: number = Number.parseFloat(value);
        if (isNaN(parsed)) {
          throw new Error(`Invalid timestamp string: ${value}`);
        }
        numericValue = parsed;
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new Error(`Invalid timestamp number: ${value}`);
        }
        numericValue = value;
      }
    } catch (error) {
      logger.warn(
        `Error processing ${context}: ${error instanceof Error ? error.message : String(error)}, using current time`,
      );
      numericValue = null;
    }
  }

  if (numericValue === null) {
    numericValue = OneUptimeDate.getCurrentDateAsUnixNano();
  }

  const date: Date = OneUptimeDate.fromUnixNano(numericValue);
  const db: string = OneUptimeDate.toClickhouseDateTime(date);

  return {
    nano: Math.trunc(numericValue).toString(),
    db: db,
    date: date,
  };
}

const MAX_STORABLE_UNIX_NANO: number = 9_223_372_036_854_774_784;

// Master's OtelProfilesIngestService.safeParseUnixNano, verbatim.
function masterProfilesParse(
  value: string | number | undefined,
  context: string,
  fallback?: ParsedUnixNano,
): ParsedUnixNano {
  let numericValue: number = OneUptimeDate.getCurrentDateAsUnixNano();

  if (value !== undefined && value !== null) {
    try {
      if (typeof value === "string") {
        const parsed: number = Number.parseFloat(value);
        if (!Number.isNaN(parsed)) {
          numericValue = parsed;
        } else {
          throw new Error(`Invalid timestamp string: ${value}`);
        }
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new Error(`Invalid timestamp number: ${value}`);
        }
        numericValue = value;
      }

      if (
        !Number.isFinite(numericValue) ||
        numericValue < 0 ||
        numericValue > MAX_STORABLE_UNIX_NANO
      ) {
        throw new Error(`Timestamp out of storable range: ${value}`);
      }
    } catch (error) {
      logger.warn(
        `Error processing ${context}: ${error instanceof Error ? error.message : String(error)}, using ${fallback ? "fallback" : "current"} time`,
      );

      if (fallback) {
        return fallback;
      }

      numericValue = OneUptimeDate.getCurrentDateAsUnixNano();
    }
  }

  numericValue = Math.trunc(numericValue);
  const date: Date = OneUptimeDate.fromUnixNano(numericValue);
  const iso: string = OneUptimeDate.toString(date);

  return {
    unixNano: numericValue,
    nano: numericValue.toString(),
    iso: iso,
    date: date,
  };
}

/*
 * Every value the exact read leaves to the float read, as before: numbers
 * (an OTLP/JSON sender's, already floats), text that is not plain digits,
 * negative and over-long values, empty and invalid text, and none at all.
 */
const READ_AS_BEFORE: Array<string | number | undefined> = [
  undefined,
  0,
  1,
  -1,
  1792231872345678848,
  // What an OTLP/JSON sender's 1792231871999999900 is once parsed.
  Number(JUST_BEFORE_SECOND),
  1.5e18,
  Number.MAX_SAFE_INTEGER,
  NaN,
  Infinity,
  -Infinity,
  "1.5e18",
  "1792231871999999900.5",
  "1792231872345678901.0",
  "-5",
  "-0",
  "-1792231872345678901",
  " 1792231872345678901",
  "1792231872345678901 ",
  "",
  " ",
  "abc",
  "12abc",
  "0x1F",
  "NaN",
  "Infinity",
  "1e400",
  "9".repeat(22),
  "9".repeat(30),
];

// What a parse gave, Dates as their instants, or what it threw.
function outcomeOf(parse: () => JSONObject | ParsedUnixNano): JSONObject {
  try {
    const parsed: Record<string, unknown> = parse() as Record<string, unknown>;
    const outcome: JSONObject = {};

    for (const key of Object.keys(parsed)) {
      const value: unknown = parsed[key];
      outcome[key] = (
        value instanceof Date ? value.getTime() : value
      ) as JSONObject[string];
    }

    return outcome;
  } catch (error) {
    return {
      threw: error instanceof Error ? `${error.name}: ${error.message}` : "?",
    };
  }
}

// The warnings a run of `work` logs, in order.
function warningsOf(work: () => void): Array<string> {
  const warnings: Array<string> = [];
  const spy: { mockRestore: () => void } = jest
    .spyOn(logger, "warn")
    .mockImplementation((message: unknown): void => {
      warnings.push(String(message));
    });

  try {
    work();
  } finally {
    spy.mockRestore();
  }

  return warnings;
}

function freezeClock(): void {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(FROZEN_NOW_MS);
  });
}

// The parse and master's give the same outcome and the same warnings.
function expectReadAsBefore(
  value: string | number | undefined,
  parse: () => JSONObject | ParsedUnixNano,
  masterParse: () => JSONObject | ParsedUnixNano,
): void {
  let branch: JSONObject = {};
  let master: JSONObject = {};

  const branchWarnings: Array<string> = warningsOf((): void => {
    branch = outcomeOf(parse);
  });
  const masterWarnings: Array<string> = warningsOf((): void => {
    master = outcomeOf(masterParse);
  });

  try {
    expect(branch).toEqual(master);
    expect(branchWarnings).toEqual(masterWarnings);
  } catch (error) {
    throw new Error(
      `${typeof value} ${JSON.stringify(String(value))}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OtelTracesIngestService.safeParseUnixNano", () => {
  test("100 ns before a whole second stays in the second before it", () => {
    const parsed: ParsedUnixNano = tracesParse(JUST_BEFORE_SECOND, "test");

    expect(parsed.nano).toBe("1792231871999999900");
    expect(parsed.date.getTime()).toBe(SECOND_IN_MS - 1);
    expect(parsed.iso).toBe("2026-10-17T10:11:11.999Z");
    // The float, for durations: the whole second, as it always was.
    expect(parsed.unixNano).toBe(Number.parseFloat(JUST_BEFORE_SECOND));

    // Master read the next second, and wrote the second's digits.
    const master: ParsedUnixNano = masterTracesParse(JUST_BEFORE_SECOND, "x");
    expect(master.iso).toBe("2026-10-17T10:11:12.000Z");
    expect(master.nano).toBe("1792231872000000000");
  });

  test("100 ns after a whole second keeps its 100 ns", () => {
    const parsed: ParsedUnixNano = tracesParse(JUST_AFTER_SECOND, "test");

    expect(parsed.nano).toBe("1792231872000000100");
    expect(parsed.date.getTime()).toBe(SECOND_IN_MS);
    expect(parsed.iso).toBe("2026-10-17T10:11:12.000Z");
    expect(masterTracesParse(JUST_AFTER_SECOND, "x").nano).toBe(
      "1792231872000000000",
    );
  });

  test("a whole millisecond the float read a millisecond early", () => {
    const parsed: ParsedUnixNano = tracesParse(EARLY_MS_NANO, "test");

    expect(floatReadMs(EARLY_MS_NANO)).toBe(EARLY_MS - 1);
    expect(parsed.date.getTime()).toBe(EARLY_MS);
    expect(parsed.iso).toBe("2026-10-17T10:11:12.346Z");
    expect(parsed.nano).toBe(EARLY_MS_NANO);
    expect(masterTracesParse(EARLY_MS_NANO, "x").iso).toBe(
      "2026-10-17T10:11:12.345Z",
    );
  });

  test("a time to the nanosecond, and with a '+' and leading zeros", () => {
    for (const text of [
      PRECISE_NANO,
      `+${PRECISE_NANO}`,
      `000${PRECISE_NANO}`,
    ]) {
      const parsed: ParsedUnixNano = tracesParse(text, "test");
      expect(parsed.nano).toBe(PRECISE_NANO);
      expect(parsed.iso).toBe("2026-10-17T10:11:12.345Z");
      expect(parsed.unixNano).toBe(Number.parseFloat(text));
    }

    expect(masterTracesParse(PRECISE_NANO, "x").nano).toBe(
      "1792231872345678800",
    );
  });

  test("durations stay float arithmetic, as before", () => {
    const start: ParsedUnixNano = tracesParse(JUST_BEFORE_SECOND, "start");
    const end: ParsedUnixNano = tracesParse(nanosFromSecond(2345678), "end");

    expect(tracesDuration(start, end)).toBe(
      tracesDuration(
        masterTracesParse(JUST_BEFORE_SECOND, "start"),
        masterTracesParse(nanosFromSecond(2345678), "end"),
      ),
    );
    expect(tracesDuration(end, start)).toBe("0");
  });

  test("every other value is read as master read it, warnings included", () => {
    freezeClock();

    for (const value of READ_AS_BEFORE) {
      expectReadAsBefore(
        value,
        (): ParsedUnixNano => {
          return tracesParse(value, "span event timeUnixNano");
        },
        (): ParsedUnixNano => {
          return masterTracesParse(value, "span event timeUnixNano");
        },
      );
    }

    // The fallback, and its warning, as the list above reaches them.
    const warnings: Array<string> = warningsOf((): void => {
      expect(tracesParse("abc", "span startTimeUnixNano").iso).toBe(
        masterTracesParse(undefined, "x").iso,
      );
    });
    expect(warnings).toEqual([
      "Error processing span startTimeUnixNano: Invalid timestamp string: abc, using current time",
    ]);
  });
});

describe("OtelMetricsIngestService.safeParseUnixNano", () => {
  test("100 ns before a whole second stays in the second before it", () => {
    const parsed: MetricTimestamp = metricsParse(JUST_BEFORE_SECOND, "test");

    expect(parsed).toEqual({
      nano: "1792231871999999900",
      db: "2026-10-17 10:11:11",
      date: new Date(SECOND_IN_MS - 1),
    });
    expect(masterMetricsParse(JUST_BEFORE_SECOND, "x").db).toBe(
      "2026-10-17 10:11:12",
    );
  });

  test("100 ns after a whole second keeps its 100 ns", () => {
    expect(metricsParse(JUST_AFTER_SECOND, "test")).toEqual({
      nano: "1792231872000000100",
      db: "2026-10-17 10:11:12",
      date: new Date(SECOND_IN_MS),
    });
  });

  test("a whole millisecond the float read a millisecond early, and a time to the nanosecond", () => {
    expect(metricsParse(EARLY_MS_NANO, "test").date.getTime()).toBe(EARLY_MS);
    expect(masterMetricsParse(EARLY_MS_NANO, "x").date.getTime()).toBe(
      EARLY_MS - 1,
    );
    expect(metricsParse(`+00${PRECISE_NANO}`, "test").nano).toBe(PRECISE_NANO);
  });

  test("a data point's row: its time and start time, to the nanosecond", () => {
    const row: JSONObject = buildMetricRow({
      datapoint: {
        timeUnixNano: JUST_BEFORE_SECOND,
        startTimeUnixNano: EARLY_MS_NANO,
        asInt: 1,
        attributes: [],
      },
      baseAttributes: { "service.name": "test-service" },
      projectId: ObjectID.generate(),
      primaryEntityId: ObjectID.generate(),
      serviceName: "test-service",
      metricName: "test_metric",
      metricPointType: MetricPointType.Gauge,
      serviceMetadata: {
        serviceName: "test-service",
        primaryEntityId: ObjectID.generate(),
        primaryEntityType: ServiceType.OpenTelemetry,
      } as TelemetryServiceMetadata,
    });

    expect(row["time"]).toBe("2026-10-17 10:11:11");
    expect(row["timeUnixNano"]).toBe("1792231871999999900");
    expect(row["startTime"]).toBe("2026-10-17 10:11:12");
    expect(row["startTimeUnixNano"]).toBe(EARLY_MS_NANO);
  });

  test("every other value is read as master read it, warnings included", () => {
    freezeClock();

    for (const value of READ_AS_BEFORE) {
      expectReadAsBefore(
        value,
        (): JSONObject => {
          return metricsParse(value, "metric datapoint timeUnixNano");
        },
        (): JSONObject => {
          return masterMetricsParse(value, "metric datapoint timeUnixNano");
        },
      );
    }
  });
});

describe("OtelProfilesIngestService.safeParseUnixNano", () => {
  const FALLBACK: ParsedUnixNano = {
    unixNano: 1,
    nano: "1",
    iso: "1970-01-01T00:00:00.000Z",
    date: new Date(0),
  };

  test("100 ns before and after a whole second, to the nanosecond", () => {
    const before: ParsedUnixNano = profilesParse(JUST_BEFORE_SECOND, "test");

    expect(before.nano).toBe("1792231871999999900");
    expect(before.iso).toBe("2026-10-17T10:11:11.999Z");
    expect(before.unixNano).toBe(Number.parseFloat(JUST_BEFORE_SECOND));
    expect(masterProfilesParse(JUST_BEFORE_SECOND, "x").iso).toBe(
      "2026-10-17T10:11:12.000Z",
    );

    expect(profilesParse(JUST_AFTER_SECOND, "test").nano).toBe(
      "1792231872000000100",
    );
    expect(profilesParse(EARLY_MS_NANO, "test").date.getTime()).toBe(EARLY_MS);
  });

  test("the storable range is decided on the float, as before; what it keeps has exact digits", () => {
    // The last int64 values the float keeps: their digits, exactly.
    for (const text of [
      "9223372036854774784",
      "9223372036854775000",
      "9223372036854775295",
    ]) {
      const parsed: ParsedUnixNano = profilesParse(text, "test", FALLBACK);
      expect(parsed.nano).toBe(text);
      expect(parsed.date.getTime()).toBe(9223372036854);
      expect(parsed.iso).toBe("2262-04-11T23:47:16.854Z");
    }

    // From here the float is 2^63, past the range: the fallback, warned.
    for (const text of [
      "9223372036854775296",
      "9223372036854775807",
      "18446744073709551615",
      "9".repeat(21),
    ]) {
      const warnings: Array<string> = warningsOf((): void => {
        expect(profilesParse(text, "sample timestampsUnixNano", FALLBACK)).toBe(
          FALLBACK,
        );
      });
      expect(warnings).toEqual([
        `Error processing sample timestampsUnixNano: Timestamp out of storable range: ${text}, using fallback time`,
      ]);
    }
  });

  test("every other value is read as master read it, with and without a fallback, warnings included", () => {
    freezeClock();

    for (const value of [
      ...READ_AS_BEFORE,
      "9223372036854775807",
      "18446744073709551615",
    ]) {
      expectReadAsBefore(
        value,
        (): ParsedUnixNano => {
          return profilesParse(value, "profile startTimeUnixNano");
        },
        (): ParsedUnixNano => {
          return masterProfilesParse(value, "profile startTimeUnixNano");
        },
      );
      expectReadAsBefore(
        value,
        (): ParsedUnixNano => {
          return profilesParse(value, "profile endTimeUnixNano", FALLBACK);
        },
        (): ParsedUnixNano => {
          return masterProfilesParse(
            value,
            "profile endTimeUnixNano",
            FALLBACK,
          );
        },
      );
    }
  });
});

// The traces and logs walks, end to end.

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "exact-time-test-service";

const AUTO_DISCOVERY_METHODS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverIoTFleet",
  "autoDiscoverDatabaseServer",
];

type OtlpAttribute = { key: string; value: { stringValue: string } };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

const EXCEPTION_ATTRIBUTES: Array<OtlpAttribute> = [
  stringAttribute("exception.message", "Something broke"),
  stringAttribute("exception.type", "Error"),
  stringAttribute(
    "exception.stacktrace",
    "Error: Something broke\n    at handler (app.js:10:5)",
  ),
];

interface CapturedWalk {
  rows: Record<string, Array<JSONObject>>;
  upserts: Array<TelemetryExceptionPayload>;
}

// Stubs every backend the walks reach, and keeps what they hand on.
function stubBackends(): CapturedWalk {
  const captured: CapturedWalk = { rows: {}, upserts: [] };

  for (const ingestService of [
    OtelTracesIngestService,
    OtelLogsIngestService,
  ]) {
    const service: Record<string, any> = ingestService as unknown as Record<
      string,
      any
    >;

    for (const method of AUTO_DISCOVERY_METHODS_RETURNING_NULL) {
      if (typeof service[method] === "function") {
        jest.spyOn(service, method).mockResolvedValue(null as never);
      }
    }

    jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
      serviceName: SERVICE_NAME,
      primaryEntityId: SERVICE_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    } as never);

    for (const submit of [
      "submitSpansBuffer",
      "submitLogsBuffer",
      "submitExceptionsBuffer",
    ]) {
      if (typeof service[submit] === "function") {
        jest
          .spyOn(service, submit)
          .mockImplementation((...args: Array<unknown>): Promise<void> => {
            // Drain like the real fan-in submit path (it splices the buffer).
            const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
            const kept: Array<JSONObject> = captured.rows[submit] || [];
            kept.push(...rows.splice(0, rows.length));
            captured.rows[submit] = kept;
            return Promise.resolve();
          });
      }
    }
  }

  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockImplementation(
      async (exceptions: Array<TelemetryExceptionPayload>): Promise<void> => {
        captured.upserts.push(...exceptions);
      },
    );

  return captured;
}

function telemetryRequest(body: JSONObject): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: body,
    headers: {},
  } as unknown as TelemetryRequest;
}

describe("the traces walk stores span and event times to the nanosecond", () => {
  test("a span across a whole second, an exception just before it and an event on a millisecond the float read early", async () => {
    const captured: CapturedWalk = stubBackends();
    const endNano: string = nanosFromSecond(2345678);

    await OtelTracesIngestService.processTracesFromQueue(
      telemetryRequest({
        resourceSpans: [
          {
            resource: {
              attributes: [stringAttribute("service.name", SERVICE_NAME)],
            },
            scopeSpans: [
              {
                scope: {},
                spans: [
                  {
                    traceId: "0af7651916cd43dd8448eb211c80319c",
                    spanId: "b7ad6b7169203331",
                    parentSpanId: "",
                    name: "GET /checkout",
                    kind: 2,
                    startTimeUnixNano: JUST_BEFORE_SECOND,
                    endTimeUnixNano: endNano,
                    status: { code: 2 },
                    attributes: [],
                    events: [
                      {
                        name: "exception",
                        timeUnixNano: JUST_BEFORE_SECOND,
                        attributes: EXCEPTION_ATTRIBUTES,
                      },
                      {
                        name: "cache.miss",
                        timeUnixNano: EARLY_MS_NANO,
                        attributes: [],
                      },
                    ],
                    links: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const spans: Array<JSONObject> = captured.rows["submitSpansBuffer"] || [];
    expect(spans).toHaveLength(1);
    const span: JSONObject = spans[0]!;

    expect(span["startTime"]).toBe("2026-10-17 10:11:11");
    expect(span["startTimeUnixNano"]).toBe("1792231871999999900");
    expect(span["endTime"]).toBe("2026-10-17 10:11:12");
    expect(span["endTimeUnixNano"]).toBe(endNano);
    // A float subtraction, as before.
    expect(span["durationUnixNano"]).toBe(
      String(
        Math.trunc(
          Number.parseFloat(endNano) - Number.parseFloat(JUST_BEFORE_SECOND),
        ),
      ),
    );

    const events: Array<JSONObject> = span["events"] as Array<JSONObject>;
    expect(
      events.map((event: JSONObject) => {
        return [event["name"], event["time"], event["timeUnixNano"]];
      }),
    ).toEqual([
      ["exception", "2026-10-17T10:11:11.999Z", "1792231871999999900"],
      ["cache.miss", "2026-10-17T10:11:12.346Z", EARLY_MS_NANO],
    ]);

    const exceptions: Array<JSONObject> =
      captured.rows["submitExceptionsBuffer"] || [];
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!["time"]).toBe("2026-10-17 10:11:11");
    expect(exceptions[0]!["timeUnixNano"]).toBe("1792231871999999900");

    expect(captured.upserts).toHaveLength(1);
    expect(captured.upserts[0]!.occurredAt!.toISOString()).toBe(
      "2026-10-17T10:11:11.999Z",
    );
  });
});

describe("the logs walk stores a record's time to the nanosecond", () => {
  function logsRequest(logRecords: Array<JSONObject>): TelemetryRequest {
    return telemetryRequest({
      resourceLogs: [
        {
          resource: {
            attributes: [stringAttribute("service.name", SERVICE_NAME)],
          },
          scopeLogs: [{ scope: {}, logRecords: logRecords }],
        },
      ],
    });
  }

  test("100 ns before a whole second: the time column's second and fraction, the timeUnixNano column, its exception and group", async () => {
    const captured: CapturedWalk = stubBackends();

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest([
        {
          timeUnixNano: JUST_BEFORE_SECOND,
          observedTimeUnixNano: JUST_AFTER_SECOND,
          severityNumber: 17,
          body: { stringValue: "Something broke" },
          attributes: EXCEPTION_ATTRIBUTES,
        },
      ]),
    );

    const logs: Array<JSONObject> = captured.rows["submitLogsBuffer"] || [];
    expect(logs).toHaveLength(1);

    // Master wrote "2026-10-17 10:11:12.000000000" and "...872000000000".
    expect(logs[0]!["time"]).toBe("2026-10-17 10:11:11.999999900");
    expect(logs[0]!["timeUnixNano"]).toBe("1792231871999999900");
    expect(logs[0]!["observedTimeUnixNano"]).toBe("1792231872000000100");

    const exceptions: Array<JSONObject> =
      captured.rows["submitExceptionsBuffer"] || [];
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!["time"]).toBe("2026-10-17 10:11:11");
    expect(exceptions[0]!["timeUnixNano"]).toBe("1792231871999999900");

    expect(captured.upserts).toHaveLength(1);
    expect(captured.upserts[0]!.occurredAt!.toISOString()).toBe(
      "2026-10-17T10:11:11.999Z",
    );
  });

  test("a whole millisecond the float read early, a time to the nanosecond, and a '+' with zeros", async () => {
    const captured: CapturedWalk = stubBackends();

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest([
        { timeUnixNano: EARLY_MS_NANO, body: { stringValue: "one" } },
        { timeUnixNano: PRECISE_NANO, body: { stringValue: "two" } },
        {
          timeUnixNano: `+000${JUST_AFTER_SECOND}`,
          observedTimeUnixNano: `+0${PRECISE_NANO}`,
          body: { stringValue: "three" },
        },
      ]),
    );

    const logs: Array<JSONObject> = captured.rows["submitLogsBuffer"] || [];

    expect(
      logs.map((row: JSONObject) => {
        return [row["time"], row["timeUnixNano"], row["observedTimeUnixNano"]];
      }),
    ).toEqual([
      ["2026-10-17 10:11:12.346000000", EARLY_MS_NANO, "0"],
      ["2026-10-17 10:11:12.345678901", PRECISE_NANO, "0"],
      ["2026-10-17 10:11:12.000000100", JUST_AFTER_SECOND, PRECISE_NANO],
    ]);
  });

  test("numbers and other text are read as the floats they were, as before", async () => {
    const captured: CapturedWalk = stubBackends();
    const asNumber: number = Number(PRECISE_NANO);

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest([
        {
          timeUnixNano: asNumber,
          observedTimeUnixNano: asNumber,
          body: { stringValue: "a number" },
        },
        {
          timeUnixNano: "1.5e18",
          observedTimeUnixNano: "1792231872345678901.5",
          body: { stringValue: "an exponent" },
        },
      ]),
    );

    const logs: Array<JSONObject> = captured.rows["submitLogsBuffer"] || [];

    expect(logs[0]!["time"]).toBe(
      OneUptimeDate.toClickhouseDateTime64(
        OneUptimeDate.fromUnixNano(asNumber),
        asNumber,
      ),
    );
    expect(logs[0]!["time"]).toBe("2026-10-17 10:11:12.345678848");
    expect(logs[0]!["timeUnixNano"]).toBe("1792231872345678800");
    expect(logs[0]!["observedTimeUnixNano"]).toBe("1792231872345678800");

    expect(logs[1]!["time"]).toBe("2017-07-14 02:40:00.000000000");
    expect(logs[1]!["timeUnixNano"]).toBe("1500000000000000000");
    expect(logs[1]!["observedTimeUnixNano"]).toBe(
      Math.trunc(Number.parseFloat("1792231872345678901.5")).toString(),
    );
  });

  test("a zero is stored as the epoch, as before", async () => {
    const captured: CapturedWalk = stubBackends();

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest([
        { timeUnixNano: "0", body: { stringValue: "zero" } },
        { timeUnixNano: "+000", body: { stringValue: "zeros" } },
      ]),
    );

    const logs: Array<JSONObject> = captured.rows["submitLogsBuffer"] || [];

    for (const row of logs) {
      expect(row["time"]).toBe("1970-01-01 00:00:00.000000000");
      expect(row["timeUnixNano"]).toBe("0");
    }
    expect(logs).toHaveLength(2);
  });

  test("text that is no time falls back to the current time, with master's warning", async () => {
    const captured: CapturedWalk = stubBackends();
    const warnings: Array<string> = [];
    jest.spyOn(logger, "warn").mockImplementation((message: unknown): void => {
      warnings.push(String(message));
    });
    const before: number = Date.now();

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest([
        {
          timeUnixNano: "abc",
          observedTimeUnixNano: "abc",
          body: { stringValue: "no time" },
        },
      ]),
    );

    const logs: Array<JSONObject> = captured.rows["submitLogsBuffer"] || [];
    const storedMs: number = Number(
      BigInt(logs[0]!["timeUnixNano"] as string) / BigInt(1000000),
    );

    expect(warnings).toContain(
      "Error processing timestamp abc: Invalid timestamp string: abc, using current time",
    );
    expect(storedMs).toBeGreaterThanOrEqual(before - 1);
    expect(storedMs).toBeLessThanOrEqual(Date.now());
    expect(logs[0]!["observedTimeUnixNano"]).toBe("0");
  });
});
