import { readPage } from "./DocsContentSupport";
import { describe, expect, it, jest } from "@jest/globals";
import * as grpc from "@grpc/grpc-js";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import StartupGate from "Common/Server/Utils/StartupGate";
import LogExceptionExtractor from "Common/Server/Utils/Telemetry/LogExceptionExtractor";
import StackTraceParser from "Common/Server/Utils/Telemetry/StackTraceParser";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import { DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE } from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import fs from "fs";
import path from "path";
import { buildTelemetryRequest } from "../../../FeatureSet/Telemetry/GrpcServer";
import { SUPPORTED_OTLP_CONTENT_ENCODINGS } from "../../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";

/*
 * What the English OpenTelemetry page says about the product, held to the
 * code that makes it true: the status each refusal answers with over HTTP and
 * over gRPC, the Retry-After a restarting instance sends, the compressions
 * the ingest path accepts, the ingestion key's settings and the Browser key's
 * default limit, the key settings gRPC does not apply, the self-hosted kill
 * switches, and how exceptions are found in logs. The page's collector
 * example has its own suite (OpenTelemetryCollectorExampleDocs), the request
 * size and encoding claims theirs (OtlpIngestDocsClaims), and the
 * translations are held to this page by OtelDatabaseCephRollupDocsTranslations.
 */

/*
 * GrpcServer pulls in the per-signal queue services, which load BullMQ at
 * import time. Nothing queue-side is checked here.
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

const PAGE: string = "telemetry/open-telemetry";
const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function englishPage(): string {
  return readPage("en", PAGE);
}

// The rows of the Markdown table whose header row is `header`.
function tableAfter(page: string, header: string): Array<Array<string>> {
  const lines: Array<string> = page.split("\n");
  const start: number = lines.indexOf(header);

  expect({ header, found: start >= 0 }).toEqual({ header, found: true });

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows;
}

// The text of a function in a source file, from its name to the next export.
function sourceBlock(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  expect({ from, found: start >= 0 }).toEqual({ from, found: true });

  const end: number = source.indexOf(to, start + from.length);

  return source.slice(start, end < 0 ? undefined : end);
}

// A status argument of 503 in an ingest service's response.
const ANSWERS_503: RegExp = /\b503,/;

const RESPONSES_HEADER: string =
  "| Response | gRPC status | Meaning | What to do |";

interface ResponseRow {
  http: string;
  grpc: string;
}

function responseRows(): Array<ResponseRow> {
  return tableAfter(englishPage(), RESPONSES_HEADER).map(
    (cells: Array<string>): ResponseRow => {
      return {
        http: (cells[0] as string).replace(/`/g, ""),
        grpc: (cells[1] as string).replace(/`/g, ""),
      };
    },
  );
}

const GRPC_SERVER: string = "App/FeatureSet/Telemetry/GrpcServer.ts";
const HTTP_INGEST_MIDDLEWARE: string =
  "Common/Server/Middleware/TelemetryIngest.ts";
const OTEL_REQUEST_MIDDLEWARE: string =
  "App/FeatureSet/Telemetry/Middleware/OtelRequestMiddleware.ts";

describe("the OpenTelemetry page's responses", () => {
  it("lists exactly the responses below, in this order", () => {
    expect(
      responseRows().map((row: ResponseRow): string => {
        return row.http;
      }),
    ).toEqual(["200", "401", "402", "413", "415", "422", "429", "503"]);
  });

  it("answers a missing, unknown or expired key with 401, and gRPC UNAUTHENTICATED", () => {
    const row: ResponseRow | undefined = responseRows().find(
      (candidate: ResponseRow): boolean => {
        return candidate.http === "401";
      },
    );

    expect(row?.grpc).toBe("UNAUTHENTICATED");
    expect(ExceptionCode.NotAuthenticatedException).toBe(401);
    expect(readSource(HTTP_INGEST_MIDDLEWARE)).toContain(
      "new NotAuthenticatedException(",
    );

    const grpcServer: string = readSource(GRPC_SERVER);

    expect(grpcServer).toContain(
      "[TelemetryIngestionKeyRefusalReason.Expired]: grpc.status.UNAUTHENTICATED",
    );
    expect(grpcServer).toContain("code: grpc.status.UNAUTHENTICATED");
  });

  it("answers a disabled key, or a Browser key off its origins, with 422, and gRPC PERMISSION_DENIED", () => {
    const row: ResponseRow | undefined = responseRows().find(
      (candidate: ResponseRow): boolean => {
        return candidate.http === "422";
      },
    );

    expect(row?.grpc).toBe("PERMISSION_DENIED");
    expect(ExceptionCode.NotAuthorizedException).toBe(422);
    expect(readSource(HTTP_INGEST_MIDDLEWARE)).toContain(
      "new NotAuthorizedException(",
    );

    const grpcServer: string = readSource(GRPC_SERVER);

    expect(grpcServer).toContain(
      "[TelemetryIngestionKeyRefusalReason.Disabled]: grpc.status.PERMISSION_DENIED",
    );
    expect(grpcServer).toMatch(
      /\[TelemetryIngestionKeyRefusalReason\.SurfaceNotAllowedForBrowserKey\]:\s*grpc\.status\.PERMISSION_DENIED/,
    );
  });

  it("answers an unpaid Free plan project with 402, and gRPC PERMISSION_DENIED", () => {
    const row: ResponseRow | undefined = responseRows().find(
      (candidate: ResponseRow): boolean => {
        return candidate.http === "402";
      },
    );

    expect(row?.grpc).toBe("PERMISSION_DENIED");
    expect(ExceptionCode.PaymentRequiredException).toBe(402);

    const paymentBranch: string = sourceBlock(
      readSource(GRPC_SERVER),
      "if (err instanceof PaymentRequiredException) {",
      "return;",
    );

    expect(paymentBranch).toContain("code: grpc.status.PERMISSION_DENIED");
  });

  it("answers a key over its Requests Per Minute Limit with 429 and a Retry-After", () => {
    const row: ResponseRow | undefined = responseRows().find(
      (candidate: ResponseRow): boolean => {
        return candidate.http === "429";
      },
    );

    // The limiter runs on OTLP/HTTP only, so there is no gRPC status.
    expect(row?.grpc).toBe("—");
    expect(ExceptionCode.TooManyRequestsException).toBe(429);

    const middleware: string = readSource(HTTP_INGEST_MIDDLEWARE);

    expect(middleware).toContain("new TooManyRequestsException(");
    expect(middleware).toContain('"Retry-After"');
  });

  it("answers an oversized body with 413 and an unsupported Content-Encoding with 415, over HTTP only", () => {
    const rows: Array<ResponseRow> = responseRows();
    const middleware: string = readSource(OTEL_REQUEST_MIDDLEWARE);

    for (const code of ["413", "415"]) {
      expect({
        code,
        grpc: rows.find((row: ResponseRow): boolean => {
          return row.http === code;
        })?.grpc,
      }).toEqual({ code, grpc: "—" });
      expect(middleware).toContain(`res.status(${code})`);
    }
  });

  it("answers 503 while OneUptime starts or the queue is down, and gRPC UNAVAILABLE", () => {
    const row: ResponseRow | undefined = responseRows().find(
      (candidate: ResponseRow): boolean => {
        return candidate.http === "503";
      },
    );

    expect(row?.grpc).toBe("UNAVAILABLE");
    expect(readSource("Common/Server/Utils/StartupGate.ts")).toContain(
      "res.status(503);",
    );
    expect(readSource(GRPC_SERVER)).toContain("grpc.status.UNAVAILABLE");

    // Each signal's HTTP ingest answers 503 when its job cannot be queued.
    for (const service of [
      "OtelTracesIngestService",
      "OtelMetricsIngestService",
      "OtelLogsIngestService",
      "OtelProfilesIngestService",
    ]) {
      expect({
        service,
        answers503: ANSWERS_503.test(
          readSource(`App/FeatureSet/Telemetry/Services/${service}.ts`),
        ),
      }).toEqual({ service, answers503: true });
    }
  });

  it("says a restarting instance asks exporters to retry after the startup gate's interval", () => {
    const page: string = englishPage();

    expect(page).toContain(
      `\`503\` and \`Retry-After: ${StartupGate.RETRY_AFTER_SECONDS}\``,
    );
    expect(page).toContain(
      "(/docs/monitor/when-oneuptime-is-not-receiving#starting-up)",
    );
    expect(readPage("en", "monitor/when-oneuptime-is-not-receiving")).toContain(
      "\n### Starting up\n",
    );
  });
});

describe("the OpenTelemetry page's endpoints", () => {
  it("names every compression the OTLP/HTTP ingest path accepts, and only those", () => {
    const compression: Array<string> | undefined = tableAfter(
      englishPage(),
      "| Setting | OTLP/HTTP (recommended) | OTLP/gRPC |",
    ).find((cells: Array<string>): boolean => {
      return cells[0] === "Compression";
    });

    expect(compression).toBeDefined();

    const named: Array<string> = Array.from(
      (compression![1] as string).matchAll(/`([a-z]+)`/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect([...named].sort()).toEqual(
      [...SUPPORTED_OTLP_CONTENT_ENCODINGS].sort(),
    );
    expect(compression![1]).toMatch(/^None, /);
  });
});

describe("the OpenTelemetry page's ingestion keys", () => {
  const SETTINGS_HEADER: string = "| Setting | What it does |";

  // The ingestion key's column behind each setting the page lists.
  const COLUMN_OF_SETTING: Record<string, string> = {
    "Key Type": "keyType",
    "Allowed Origins": "allowedOrigins",
    "Pinned Service Name": "pinnedServiceName",
    Enabled: "isEnabled",
    "Expires At": "expiresAt",
    "Requests Per Minute Limit": "requestsPerMinuteLimit",
    "Last Used At": "lastUsedAt",
  };

  it("lists each key setting by the title the key's page shows", () => {
    const settings: Array<string> = tableAfter(
      englishPage(),
      SETTINGS_HEADER,
    ).map((cells: Array<string>): string => {
      return (cells[0] as string).replace(/\*\*/g, "");
    });

    expect(settings).toEqual(Object.keys(COLUMN_OF_SETTING));

    const key: TelemetryIngestionKey = new TelemetryIngestionKey();

    for (const setting of settings) {
      expect({
        setting,
        title: key.getDisplayColumnTitleAs(
          COLUMN_OF_SETTING[setting] as string,
        ),
      }).toEqual({ setting, title: setting });
    }
  });

  it("gives a Browser key's default limit as the code sets it", () => {
    const limit: Array<string> | undefined = tableAfter(
      englishPage(),
      SETTINGS_HEADER,
    ).find((cells: Array<string>): boolean => {
      return cells[0] === "**Requests Per Minute Limit**";
    });

    expect(limit?.[1]).toContain(
      `and ${DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE.toLocaleString("en-US")} on a Browser key`,
    );
  });

  it("says the Pinned Service Name and the per-key limit do not apply over gRPC", () => {
    /*
     * The gRPC path authenticates the token itself and builds its request
     * by hand: no key policy rides on it, so the queue has no service name
     * to pin, and the per-key limiter (HTTP middleware) never runs.
     */
    const metadata: grpc.Metadata = new grpc.Metadata();

    metadata.set("x-oneuptime-token", "secret");

    const request: TelemetryRequest = buildTelemetryRequest(
      { resourceSpans: [] },
      metadata,
      ObjectID.generate(),
      ProductType.Traces,
    );

    expect(
      (request as Partial<TelemetryRequest>).ingestionKeyPolicy,
    ).toBeUndefined();
    expect(
      readSource(
        "App/FeatureSet/Telemetry/Services/Queue/TelemetryQueueService.ts",
      ),
    ).toContain("ingestionKeyPolicy?.pinnedServiceName");
    expect(readSource(GRPC_SERVER)).not.toContain("requestsPerMinuteLimit");

    expect(englishPage()).toContain(
      "Two of a key's settings apply to OTLP/HTTP only: its **Requests Per Minute Limit** and its **Pinned Service Name**.",
    );
  });
});

describe("the OpenTelemetry page's self-hosted switches", () => {
  it("names the ingestion kill switch and the value that turns it on", () => {
    expect(readSource("Common/Server/EnvironmentConfig.ts")).toContain(
      'process.env["DISABLE_TELEMETRY_INGESTION"] === "true"',
    );
    expect(englishPage()).toContain("`DISABLE_TELEMETRY_INGESTION=true`");
  });

  it("names the log exception switch and the value that turns it off", () => {
    expect(readSource("App/FeatureSet/Telemetry/Config.ts")).toContain(
      'process.env["TELEMETRY_LOG_EXCEPTION_EXTRACTION_ENABLED"] !== "false"',
    );
    expect(englishPage()).toContain(
      "`TELEMETRY_LOG_EXCEPTION_EXTRACTION_ENABLED=false`",
    );
  });
});

describe("the OpenTelemetry page's exceptions from logs", () => {
  const ERROR: number = 17;
  const FATAL: number = 21;
  const WARN: number = 13;

  const PYTHON_TRACEBACK: string = [
    "Traceback (most recent call last):",
    '  File "/app/main.py", line 22, in run',
    "    do_thing()",
    '  File "/app/service.py", line 5, in do_thing',
    "    raise ValueError()",
    "ValueError: bad input",
  ].join("\n");

  function bodyScan(input: {
    body: string;
    severityNumber: number;
    hasTraceAndSpan: boolean;
  }): boolean {
    return (
      LogExceptionExtractor.extractFromLogRecord({
        body: input.body,
        attributes: {},
        severityNumber: input.severityNumber,
        hasTraceAndSpan: input.hasTraceAndSpan,
      }) !== null
    );
  }

  it("turns a log with exception attributes into an exception, whatever its severity", () => {
    expect(
      LogExceptionExtractor.extractFromLogRecord({
        body: "",
        attributes: { "exception.type": "ValueError" },
        severityNumber: 9,
        hasTraceAndSpan: true,
      })?.exceptionType,
    ).toBe("ValueError");
    expect(englishPage()).toContain(
      "`exception.type`, `exception.message` or `exception.stacktrace` attribute",
    );
  });

  it("scans the body of error and fatal logs only, and not when the log carries a trace ID and a span ID", () => {
    expect(
      bodyScan({
        body: PYTHON_TRACEBACK,
        severityNumber: ERROR,
        hasTraceAndSpan: false,
      }),
    ).toBe(true);
    expect(
      bodyScan({
        body: PYTHON_TRACEBACK,
        severityNumber: FATAL,
        hasTraceAndSpan: false,
      }),
    ).toBe(true);
    expect(
      bodyScan({
        body: PYTHON_TRACEBACK,
        severityNumber: WARN,
        hasTraceAndSpan: false,
      }),
    ).toBe(false);
    expect(
      bodyScan({
        body: PYTHON_TRACEBACK,
        severityNumber: ERROR,
        hasTraceAndSpan: true,
      }),
    ).toBe(false);
    expect(englishPage()).toContain(
      "| **Stack trace in the body** | Error and fatal logs that do not carry a trace ID and a span ID |",
    );
  });

  it("scans the first 16 KB of a body", () => {
    const kilobytes: number = 16;
    const filler: string = "x".repeat(kilobytes * 1024);

    expect(
      bodyScan({
        body: `${filler.slice(0, filler.length - 1024)}\n${PYTHON_TRACEBACK}`,
        severityNumber: ERROR,
        hasTraceAndSpan: false,
      }),
    ).toBe(true);
    expect(
      bodyScan({
        body: `${filler}\n${PYTHON_TRACEBACK}`,
        severityNumber: ERROR,
        hasTraceAndSpan: false,
      }),
    ).toBe(false);
    expect(englishPage()).toContain(
      `scans the first ${kilobytes} KB of the body`,
    );
  });

  it("reads a stack trace in every language the page names", () => {
    const traces: Record<string, string> = {
      JavaScript: [
        "Error: boom",
        "    at doWork (/app/src/worker.js:42:15)",
        "    at main (/app/src/index.js:10:3)",
      ].join("\n"),
      Python: PYTHON_TRACEBACK,
      Java: [
        "java.lang.NullPointerException",
        "    at com.example.Service.process(Service.java:42)",
        "    at com.example.Main.main(Main.java:10)",
      ].join("\n"),
      Go: [
        "goroutine 1 [running]:",
        "main.doWork(0x1, 0x2)",
        "\t/app/main.go:25 +0x1a",
        "main.main()",
        "\t/app/main.go:10 +0x2b",
      ].join("\n"),
      Ruby: [
        "/app/service.rb:12:in `process'",
        "/app/main.rb:3:in `<main>'",
      ].join("\n"),
      "C#/.NET": [
        "System.NullReferenceException: boom",
        "   at MyApp.Service.Process(String id) in /app/Service.cs:line 42",
        "   at MyApp.Program.Main() in /app/Program.cs:line 10",
      ].join("\n"),
      PHP: [
        "#0 /app/service.php(42): Service->process()",
        "#1 /app/index.php(10): Service->run()",
        "#2 {main}",
      ].join("\n"),
    };

    expect(englishPage()).toContain(
      "for a JavaScript, Python, Java, Go, Ruby, C#/.NET or PHP stack trace",
    );

    for (const [language, trace] of Object.entries(traces)) {
      expect({
        language,
        frames: StackTraceParser.parse(trace).frames.length > 0,
      }).toEqual({ language, frames: true });
    }
  });
});
