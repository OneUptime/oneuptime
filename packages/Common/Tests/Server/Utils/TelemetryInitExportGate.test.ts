import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Telemetry.init() exports OneUptime's own traces, metrics and logs only when
 * OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set AND at least one header can be
 * sent. Before, a header whose value held '=' (Authorization=Basic ...==) was
 * dropped while it was read, so an operator whose only header was that one got
 * no exporter at all, and no word about it.
 *
 * The OTLP exporters and the Node SDK are stand-ins here, so the test can see
 * what each exporter is built with without sending anything; the reader, the
 * processors and the providers around them are the real ones.
 */

interface ExporterConfig {
  url: string;
  headers: Record<string, string>;
}

const mockExporterConfigs: {
  traces: Array<ExporterConfig>;
  metrics: Array<ExporterConfig>;
  logs: Array<ExporterConfig>;
} = { traces: [], metrics: [], logs: [] };

const mockSdkStarts: { count: number } = { count: 0 };

// What the stand-in log exporter was handed: the records OneUptime exports.
interface ExportedLogRecord {
  body: unknown;
  severityNumber?: number;
  attributes?: Record<string, unknown>;
}

const mockExportedLogs: Array<ExportedLogRecord> = [];

jest.mock("@opentelemetry/exporter-trace-otlp-proto", () => {
  return {
    OTLPTraceExporter: class {
      public constructor(config: ExporterConfig) {
        mockExporterConfigs.traces.push(config);
      }

      public export(
        _items: unknown,
        done: (result: { code: number }) => void,
      ): void {
        done({ code: 0 });
      }

      public shutdown(): Promise<void> {
        return Promise.resolve();
      }

      public forceFlush(): Promise<void> {
        return Promise.resolve();
      }
    },
  };
});

jest.mock("@opentelemetry/exporter-metrics-otlp-proto", () => {
  return {
    OTLPMetricExporter: class {
      public constructor(config: ExporterConfig) {
        mockExporterConfigs.metrics.push(config);
      }

      public export(
        _items: unknown,
        done: (result: { code: number }) => void,
      ): void {
        done({ code: 0 });
      }

      public shutdown(): Promise<void> {
        return Promise.resolve();
      }

      public forceFlush(): Promise<void> {
        return Promise.resolve();
      }
    },
  };
});

jest.mock("@opentelemetry/exporter-logs-otlp-http", () => {
  return {
    OTLPLogExporter: class {
      public constructor(config: ExporterConfig) {
        mockExporterConfigs.logs.push(config);
      }

      public export(
        items: Array<ExportedLogRecord>,
        done: (result: { code: number }) => void,
      ): void {
        mockExportedLogs.push(...items);
        done({ code: 0 });
      }

      public shutdown(): Promise<void> {
        return Promise.resolve();
      }

      public forceFlush(): Promise<void> {
        return Promise.resolve();
      }
    },
  };
});

jest.mock("@opentelemetry/sdk-node", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "@opentelemetry/sdk-node",
  ) as Record<string, unknown>;

  return {
    ...actual,
    NodeSDK: class {
      public start(): void {
        mockSdkStarts.count++;
      }

      public shutdown(): Promise<void> {
        return Promise.resolve();
      }
    },
  };
});

jest.mock("../../../Server/Utils/GracefulShutdown", () => {
  const actual: { ShutdownPriority: unknown } = jest.requireActual(
    "../../../Server/Utils/GracefulShutdown",
  ) as { ShutdownPriority: unknown };

  return {
    __esModule: true,
    ShutdownPriority: actual.ShutdownPriority,
    default: {
      registerHandler: (): void => {
        return undefined;
      },
    },
  };
});

jest.mock("../../../Server/Utils/Telemetry/RuntimeMetrics", () => {
  return {
    __esModule: true,
    default: {
      init: (): void => {
        return undefined;
      },
    },
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    DisableTelemetry: false,
  };
});

import OpenTelemetryAPI from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import Telemetry from "../../../Server/Utils/Telemetry";
import logger, { EXTERNAL_FAULT } from "../../../Server/Utils/Logger";
import ConfigLogLevel from "../../../Server/Types/ConfigLogLevel";
import * as EnvironmentConfig from "../../../Server/EnvironmentConfig";
import { NOTHING_EXPORTED_WITHOUT_A_HEADER } from "../../../Server/Utils/Telemetry/OtlpExporterHeaders";

const ENDPOINT: string = "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT";
const HEADERS: string = "OPENTELEMETRY_EXPORTER_OTLP_HEADERS";

const BASIC_AUTHORIZATION: string = "Basic dXNlcjpwYXNzd29yZA==";

interface MutableEnvironment {
  DisableTelemetry: boolean;
}

interface TelemetryInternals {
  sdk: unknown;
  meter: unknown;
  meterProvider: { shutdown: () => Promise<void> } | null;
  loggerProvider: {
    shutdown: () => Promise<void>;
    forceFlush: () => Promise<void>;
  } | null;
  metricReader: unknown;
  spanExportEnabled: boolean;
  hasWarnedAboutUnreadableHeaders: boolean;
}

const environment: MutableEnvironment =
  EnvironmentConfig as unknown as MutableEnvironment;

const internals: TelemetryInternals =
  Telemetry as unknown as TelemetryInternals;

const savedEnv: NodeJS.ProcessEnv = { ...process.env };

let loggerError: ReturnType<typeof jest.spyOn>;

const loggedLines: () => Array<string> = (): Array<string> => {
  return loggerError.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
};

const exportersBuilt: () => number = (): number => {
  return (
    mockExporterConfigs.traces.length +
    mockExporterConfigs.metrics.length +
    mockExporterConfigs.logs.length
  );
};

const resetTelemetry: () => void = (): void => {
  internals.sdk = null;
  internals.meter = null;
  internals.meterProvider = null;
  internals.loggerProvider = null;
  internals.metricReader = undefined;
  internals.spanExportEnabled = false;
  internals.hasWarnedAboutUnreadableHeaders = false;
};

beforeEach(() => {
  resetTelemetry();
  environment.DisableTelemetry = false;
  mockExporterConfigs.traces.length = 0;
  mockExporterConfigs.metrics.length = 0;
  mockExporterConfigs.logs.length = 0;
  mockSdkStarts.count = 0;
  mockExportedLogs.length = 0;

  delete process.env[ENDPOINT];
  delete process.env[HEADERS];

  loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(async () => {
  jest.restoreAllMocks();

  await internals.meterProvider?.shutdown();
  await internals.loggerProvider?.shutdown();

  OpenTelemetryAPI.metrics.disable();
  logs.disable();

  resetTelemetry();
});

afterAll(() => {
  process.env = savedEnv;
});

describe("Telemetry.init with a header whose value holds '='", () => {
  test("exports traces, metrics and logs, each with the whole Basic Authorization header", () => {
    process.env[ENDPOINT] = "https://collector.example.com/otlp";
    process.env[HEADERS] = `Authorization=${BASIC_AUTHORIZATION}`;

    expect(Telemetry.init({ serviceName: "app" })).not.toBeNull();

    const headers: Record<string, string> = {
      Authorization: BASIC_AUTHORIZATION,
    };

    expect(
      mockExporterConfigs.traces.map((config: ExporterConfig) => {
        return { url: config.url, headers: config.headers };
      }),
    ).toEqual([
      { url: "https://collector.example.com/otlp/v1/traces", headers },
    ]);
    expect(
      mockExporterConfigs.metrics.map((config: ExporterConfig) => {
        return { url: config.url, headers: config.headers };
      }),
    ).toEqual([
      { url: "https://collector.example.com/otlp/v1/metrics", headers },
    ]);
    expect(
      mockExporterConfigs.logs.map((config: ExporterConfig) => {
        return { url: config.url, headers: config.headers };
      }),
    ).toEqual([{ url: "https://collector.example.com/otlp/v1/logs", headers }]);

    expect(Telemetry.isSpanExportEnabled()).toBe(true);
    expect(internals.metricReader).toBeDefined();
    expect(mockSdkStarts.count).toBe(1);
    expect(loggedLines()).toEqual([]);
  });

  test("exports with a OneUptime token that ends in '=' beside a second header", () => {
    process.env[ENDPOINT] = "https://oneuptime.example.com/otlp";
    process.env[HEADERS] = "x-oneuptime-token=c2VjcmV0=;x-extra=1";

    Telemetry.init({ serviceName: "worker" });

    for (const configs of [
      mockExporterConfigs.traces,
      mockExporterConfigs.metrics,
      mockExporterConfigs.logs,
    ]) {
      expect(configs).toHaveLength(1);
      expect(configs[0]?.headers).toEqual({
        "x-oneuptime-token": "c2VjcmV0=",
        "x-extra": "1",
      });
    }

    expect(loggedLines()).toEqual([]);
  });
});

/*
 * The form a backend's setup guide gives for OTEL_EXPORTER_OTLP_HEADERS
 * (issue #7162): ',' between headers, a space in a value written %20. Read
 * with ';' only, it was one header whose value held the other - sent, so
 * refused by the backend, and nobody told.
 */
describe("Telemetry.init with headers copied as OTEL_EXPORTER_OTLP_HEADERS writes them", () => {
  test("exports traces, metrics and logs with each header, its value decoded", () => {
    process.env[ENDPOINT] = "https://collector.example.com/otlp";
    process.env[HEADERS] =
      "Authorization=Basic%20dXNlcjpwYXNzd29yZA==,X-Scope-OrgID=tenant-1";

    expect(Telemetry.init({ serviceName: "app" })).not.toBeNull();

    for (const configs of [
      mockExporterConfigs.traces,
      mockExporterConfigs.metrics,
      mockExporterConfigs.logs,
    ]) {
      expect(configs).toHaveLength(1);
      expect(configs[0]?.headers).toEqual({
        Authorization: BASIC_AUTHORIZATION,
        "X-Scope-OrgID": "tenant-1",
      });
    }

    expect(Telemetry.isSpanExportEnabled()).toBe(true);
    expect(loggedLines()).toEqual([]);
  });

  test("exports with a OneUptime token and a second header separated by ','", () => {
    process.env[ENDPOINT] = "https://oneuptime.example.com/otlp";
    process.env[HEADERS] = "x-oneuptime-token=c2VjcmV0=,x-extra=1";

    Telemetry.init({ serviceName: "worker" });

    for (const configs of [
      mockExporterConfigs.traces,
      mockExporterConfigs.metrics,
      mockExporterConfigs.logs,
    ]) {
      expect(configs[0]?.headers).toEqual({
        "x-oneuptime-token": "c2VjcmV0=",
        "x-extra": "1",
      });
    }

    expect(loggedLines()).toEqual([]);
  });
});

describe("Telemetry.init with a header it cannot read", () => {
  test("exports with the headers it can read, and warns about the other once", () => {
    process.env[ENDPOINT] = "https://collector.example.com/otlp";
    process.env[HEADERS] =
      "x-oneuptime-token=key;Authorization: Bearer the-secret";

    Telemetry.init({ serviceName: "app" });

    expect(mockExporterConfigs.traces[0]?.headers).toEqual({
      "x-oneuptime-token": "key",
    });
    expect(mockExporterConfigs.metrics).toHaveLength(1);
    expect(mockExporterConfigs.logs).toHaveLength(1);

    expect(loggedLines()).toEqual([
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart): " +
        "OneUptime cannot read header 2 of 2, so it does not send it. " +
        "Header 2 has no '=' between a name and a value. " +
        "Write each header as name=value, and separate headers with ';' (or ',' as in OTEL_EXPORTER_OTLP_HEADERS).",
    ]);
    expect(loggerError).toHaveBeenCalledWith(
      expect.any(String),
      EXTERNAL_FAULT,
    );
  });

  test("exports nothing when no header is left, and says why in two lines that hold no secret", () => {
    process.env[ENDPOINT] = "https://collector.example.com/otlp";
    process.env[HEADERS] = "Authorization: Bearer the-secret";

    Telemetry.init({ serviceName: "app" });

    expect(exportersBuilt()).toBe(0);
    expect(Telemetry.isSpanExportEnabled()).toBe(false);
    expect(internals.metricReader).toBeUndefined();

    const lines: Array<string> = loggedLines();

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(
      "OneUptime cannot read header 1 of 1, so it does not send it.",
    );
    expect(lines[1]).toBe(NOTHING_EXPORTED_WITHOUT_A_HEADER);

    for (const line of lines) {
      expect(line).not.toContain("the-secret");
      expect(line).not.toContain("Bearer");
    }

    for (const call of loggerError.mock.calls) {
      expect(call[1]).toBe(EXTERNAL_FAULT);
    }
  });

  /*
   * The operator of a OneUptime that exports with its other headers may look
   * for the reason in the backend those headers reach, not in the process's
   * output: the warning is logged once the logger provider is in place, so it
   * is exported with the rest, at WARN, under LOG_LEVEL=ERROR too.
   */
  test("sends the warning to the exported logs too, when the other headers can be sent", async () => {
    loggerError.mockRestore();
    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.ERROR);
    jest.spyOn(console, "warn").mockImplementation((): void => {
      return undefined;
    });

    process.env[ENDPOINT] = "https://collector.example.com/otlp";
    process.env[HEADERS] =
      "x-oneuptime-token=key;Authorization: Bearer the-secret";

    Telemetry.init({ serviceName: "app" });

    await internals.loggerProvider?.forceFlush();

    const warnings: Array<ExportedLogRecord> = mockExportedLogs.filter(
      (record: ExportedLogRecord): boolean => {
        return String(record.body).includes(
          "OneUptime cannot read header 2 of 2, so it does not send it.",
        );
      },
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severityNumber).toBe(SeverityNumber.WARN);

    for (const record of mockExportedLogs) {
      expect(String(record.body)).not.toContain("the-secret");
    }
  });

  test("warns about a header it cannot read without an endpoint too, but not that nothing is sent", () => {
    process.env[HEADERS] = "x-oneuptime-token=key;broken";

    Telemetry.init({ serviceName: "app" });

    expect(exportersBuilt()).toBe(0);
    expect(loggedLines()).toEqual([
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart): " +
        "OneUptime cannot read header 2 of 2, so it does not send it. " +
        "Header 2 has no '=' between a name and a value. " +
        "Write each header as name=value, and separate headers with ';' (or ',' as in OTEL_EXPORTER_OTLP_HEADERS).",
    ]);
  });

  test("does not say it twice when the headers are read again after init", () => {
    process.env[ENDPOINT] = "https://collector.example.com/otlp";
    process.env[HEADERS] = "a=1;broken";

    Telemetry.init({ serviceName: "app" });
    Telemetry.getHeaders();
    Telemetry.init({ serviceName: "app" });

    expect(loggedLines()).toHaveLength(1);
    expect(mockExporterConfigs.traces).toHaveLength(1);
  });
});

describe("Telemetry.init's export gate", () => {
  test("an endpoint without any header exports nothing, and says so", () => {
    process.env[ENDPOINT] = "https://collector.example.com/otlp";

    Telemetry.init({ serviceName: "app" });

    expect(exportersBuilt()).toBe(0);
    expect(loggedLines()).toEqual([NOTHING_EXPORTED_WITHOUT_A_HEADER]);
    expect(loggerError).toHaveBeenCalledWith(
      NOTHING_EXPORTED_WITHOUT_A_HEADER,
      EXTERNAL_FAULT,
    );
  });

  test("an endpoint with an empty header setting is the same", () => {
    process.env[ENDPOINT] = "https://collector.example.com/otlp";
    process.env[HEADERS] = "";

    Telemetry.init({ serviceName: "app" });

    expect(exportersBuilt()).toBe(0);
    expect(loggedLines()).toEqual([NOTHING_EXPORTED_WITHOUT_A_HEADER]);
  });

  test("no endpoint, as most installations run, exports nothing and says nothing", () => {
    Telemetry.init({ serviceName: "app" });

    expect(exportersBuilt()).toBe(0);
    expect(loggedLines()).toEqual([]);
    expect(mockSdkStarts.count).toBe(1);
  });

  test("headers without an endpoint export nothing, and a readable header earns no warning", () => {
    process.env[HEADERS] = "x-oneuptime-token=key";

    Telemetry.init({ serviceName: "app" });

    expect(exportersBuilt()).toBe(0);
    expect(loggedLines()).toEqual([]);
  });

  test("telemetry turned off reads no setting and says nothing", () => {
    environment.DisableTelemetry = true;
    process.env[ENDPOINT] = "https://collector.example.com/otlp";
    process.env[HEADERS] = "broken";

    expect(Telemetry.init({ serviceName: "app" })).toBeNull();

    expect(exportersBuilt()).toBe(0);
    expect(mockSdkStarts.count).toBe(0);
    expect(loggedLines()).toEqual([]);
  });

  test("the line for an endpoint without any header names the standard's variable too", () => {
    expect(NOTHING_EXPORTED_WITHOUT_A_HEADER).toBe(
      "OneUptime sends none of its own traces, metrics or logs: " +
        "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set, but neither " +
        "OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart) " +
        "nor OTEL_EXPORTER_OTLP_HEADERS holds a header it can send, and it exports only with one. " +
        "Set at least one header, written as name=value, such as the x-oneuptime-token header with a Server ingestion key.",
    );
  });
});

/*
 * Issue #8884: the OTLP exporters read the OpenTelemetry standard's header
 * variables on their own - OTEL_EXPORTER_OTLP_HEADERS for every signal, and
 * OTEL_EXPORTER_OTLP_<SIGNAL>_HEADERS for one - and send them under the
 * headers OneUptime hands them. The gate counted OneUptime's own setting
 * only, so an endpoint whose headers were set there alone exported nothing,
 * and the line said no header could be sent. Now each signal is exported
 * when its exporter has a header to send, from either.
 */
describe("Telemetry.init with headers in the OpenTelemetry standard's own variables", () => {
  const STANDARD: string = "OTEL_EXPORTER_OTLP_HEADERS";
  const SIGNAL_VARIABLES: Array<string> = [
    "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
    "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
    "OTEL_EXPORTER_OTLP_LOGS_HEADERS",
  ];

  const built: () => Record<string, number> = (): Record<string, number> => {
    return {
      traces: mockExporterConfigs.traces.length,
      metrics: mockExporterConfigs.metrics.length,
      logs: mockExporterConfigs.logs.length,
    };
  };

  beforeEach(() => {
    delete process.env[STANDARD];

    for (const variable of SIGNAL_VARIABLES) {
      delete process.env[variable];
    }
  });

  afterAll(() => {
    delete process.env[STANDARD];

    for (const variable of SIGNAL_VARIABLES) {
      delete process.env[variable];
    }
  });

  test("exports traces, metrics and logs when OTEL_EXPORTER_OTLP_HEADERS alone holds a header, and says nothing", () => {
    process.env[ENDPOINT] = "https://oneuptime.example.com/otlp";
    process.env[STANDARD] = "x-oneuptime-token=key";

    Telemetry.init({ serviceName: "app" });

    expect(built()).toEqual({ traces: 1, metrics: 1, logs: 1 });
    expect(Telemetry.isSpanExportEnabled()).toBe(true);
    expect(internals.metricReader).toBeDefined();
    expect(loggedLines()).toEqual([]);
  });

  /*
   * The exporters read the standard's variables themselves and keep
   * OneUptime's headers over them, so OneUptime hands them its own only: its
   * own win by name, and nothing is sent twice.
   */
  test("hands the exporters none of the standard's headers, as they read those themselves", () => {
    process.env[ENDPOINT] = "https://oneuptime.example.com/otlp";
    process.env[STANDARD] = "x-oneuptime-token=standard-key,x-extra=1";

    Telemetry.init({ serviceName: "app" });

    for (const configs of [
      mockExporterConfigs.traces,
      mockExporterConfigs.metrics,
      mockExporterConfigs.logs,
    ]) {
      expect(configs[0]?.headers).toEqual({});
    }
  });

  test("hands the exporters OneUptime's own headers beside the standard's, which they keep over them", () => {
    process.env[ENDPOINT] = "https://oneuptime.example.com/otlp";
    process.env[HEADERS] = "x-oneuptime-token=own-key";
    process.env[STANDARD] = "x-oneuptime-token=standard-key,x-extra=1";

    Telemetry.init({ serviceName: "app" });

    for (const configs of [
      mockExporterConfigs.traces,
      mockExporterConfigs.metrics,
      mockExporterConfigs.logs,
    ]) {
      expect(configs[0]?.headers).toEqual({ "x-oneuptime-token": "own-key" });
    }

    expect(loggedLines()).toEqual([]);
  });

  test("a signal's own variable exports that signal, and says which are not sent", () => {
    process.env[ENDPOINT] = "https://oneuptime.example.com/otlp";
    process.env["OTEL_EXPORTER_OTLP_TRACES_HEADERS"] = "x-oneuptime-token=key";

    Telemetry.init({ serviceName: "app" });

    expect(built()).toEqual({ traces: 1, metrics: 0, logs: 0 });
    expect(loggedLines()).toEqual([
      "OneUptime sends none of its own metrics or logs: " +
        "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set, but its only headers are in OTEL_EXPORTER_OTLP_TRACES_HEADERS, " +
        "for traces alone, and it exports a signal only with a header. " +
        "Set one for every signal in OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart) " +
        "or OTEL_EXPORTER_OTLP_HEADERS, or set OTEL_EXPORTER_OTLP_METRICS_HEADERS and OTEL_EXPORTER_OTLP_LOGS_HEADERS.",
    ]);
    expect(loggerError).toHaveBeenCalledWith(
      expect.any(String),
      EXTERNAL_FAULT,
    );
  });

  test("two signals' own variables export those two, and name the third", () => {
    process.env[ENDPOINT] = "https://oneuptime.example.com/otlp";
    process.env["OTEL_EXPORTER_OTLP_METRICS_HEADERS"] = "x-oneuptime-token=key";
    process.env["OTEL_EXPORTER_OTLP_LOGS_HEADERS"] = "x-oneuptime-token=key";

    Telemetry.init({ serviceName: "app" });

    expect(built()).toEqual({ traces: 0, metrics: 1, logs: 1 });
    expect(Telemetry.isSpanExportEnabled()).toBe(false);
    expect(loggedLines()).toEqual([
      "OneUptime sends none of its own traces: " +
        "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set, but its only headers are in OTEL_EXPORTER_OTLP_METRICS_HEADERS and OTEL_EXPORTER_OTLP_LOGS_HEADERS, " +
        "for metrics and logs alone, and it exports a signal only with a header. " +
        "Set one for every signal in OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart) " +
        "or OTEL_EXPORTER_OTLP_HEADERS, or set OTEL_EXPORTER_OTLP_TRACES_HEADERS.",
    ]);
  });

  test("every signal's own variable exports all three, and says nothing", () => {
    process.env[ENDPOINT] = "https://oneuptime.example.com/otlp";

    for (const variable of SIGNAL_VARIABLES) {
      process.env[variable] = "x-oneuptime-token=key";
    }

    Telemetry.init({ serviceName: "app" });

    expect(built()).toEqual({ traces: 1, metrics: 1, logs: 1 });
    expect(loggedLines()).toEqual([]);
  });

  test.each([
    ["no '=' between a name and a value", "Authorization: Bearer the-secret"],
    ["an empty value", "x-oneuptime-token="],
    ["a value only after a ';', which the exporters leave out", "a;b=1"],
    ["a value that does not decode", "x-oneuptime-token=%E0%A4%A"],
    ["only commas and spaces", " , , "],
  ])(
    "OTEL_EXPORTER_OTLP_HEADERS with %s holds no header the exporters send, so nothing is exported and it says so",
    (_why: string, setting: string) => {
      process.env[ENDPOINT] = "https://oneuptime.example.com/otlp";
      process.env[STANDARD] = setting;

      Telemetry.init({ serviceName: "app" });

      expect(exportersBuilt()).toBe(0);
      expect(loggedLines()).toEqual([NOTHING_EXPORTED_WITHOUT_A_HEADER]);

      for (const line of loggedLines()) {
        expect(line).not.toContain("the-secret");
      }
    },
  );

  test("the standard's headers without an endpoint export nothing and say nothing", () => {
    process.env[STANDARD] = "x-oneuptime-token=key";

    Telemetry.init({ serviceName: "app" });

    expect(exportersBuilt()).toBe(0);
    expect(loggedLines()).toEqual([]);
  });

  test("an unreadable header of OneUptime's own is still reported, beside a readable standard one", () => {
    process.env[ENDPOINT] = "https://oneuptime.example.com/otlp";
    process.env[HEADERS] = "broken";
    process.env[STANDARD] = "x-oneuptime-token=key";

    Telemetry.init({ serviceName: "app" });

    expect(built()).toEqual({ traces: 1, metrics: 1, logs: 1 });
    expect(loggedLines()).toEqual([
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart): " +
        "OneUptime cannot read header 1 of 1, so it does not send it. " +
        "Header 1 has no '=' between a name and a value. " +
        "Write each header as name=value, and separate headers with ';' (or ',' as in OTEL_EXPORTER_OTLP_HEADERS).",
    ]);
  });
});
