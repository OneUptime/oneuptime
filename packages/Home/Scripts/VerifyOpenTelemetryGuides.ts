/*
 * Runs every OpenTelemetry guide end to end and records what arrived.
 *
 *   npm run verify:otel-guides                         every guide
 *   npm run verify:otel-guides -- --guide express      one guide (repeatable)
 *
 * For each guide (Utils/Integrations/OpenTelemetry/Guides) it writes the
 * guide's app into an empty folder - the page's own snippets, word for word,
 * and the scaffolding its verification names - installs the packages the
 * page pins, starts the app with the page's command, asks it the guide's
 * requests (or, for a browser guide, opens it in Chromium and clicks), stops
 * it, and reads what reached the receiver: a stand-in for OneUptime's
 * /otlp endpoint (same paths, 401 without the x-oneuptime-token header) in
 * front of a real OpenTelemetry Collector that decodes every request.
 *
 * The page's endpoint (https://oneuptime.com/otlp) and key placeholders are
 * replaced with the local receiver's and a test key, and the export
 * intervals are shortened; nothing else of the snippets changes.
 *
 * When every span, metric and log the guide expects arrived, it writes the
 * guide's record to Utils/Integrations/OpenTelemetry/Verifications.json:
 * the day, the runtime, the packages' versions and exports, what arrived,
 * and the digest of the snippets it ran. Tests/OpenTelemetryGuides fails a
 * guide whose snippets no longer match their record, so a changed snippet
 * is checked again before it ships.
 *
 * Needs:
 *   - Docker, for the collector (otel/opentelemetry-collector-contrib) and
 *     the services a guide's app needs (the broker Celery reads).
 *   - Node.js 22.15 or later for the Node.js guides: the one on PATH, or
 *     OTEL_GUIDES_NODE_BIN, a folder holding node, npm and npx.
 *   - OTEL_GUIDES_BUN and OTEL_GUIDES_DENO, the binaries, for those guides.
 *   - Chromium as Common's Playwright installs it, for the browser guides,
 *     or OTEL_GUIDES_CHROMIUM, the path of another Chromium to launch.
 *   - For the Python guides, OTEL_GUIDES_PYTHON: the Python each app's
 *     virtual environment is made with (python3 on PATH otherwise).
 *   - For the Java and Kotlin guides, OTEL_GUIDES_JAVA_HOME (a JDK) and
 *     OTEL_GUIDES_MAVEN_BIN and OTEL_GUIDES_GRADLE_BIN, the folders holding
 *     mvn and gradle.
 *   - For the .NET guides, OTEL_GUIDES_DOTNET_ROOT: a .NET SDK's folder.
 *   - Nothing more for the Go, Ruby, PHP, Rust and Elixir guides: each run
 *     works in a container of the language's official image (see
 *     CONTAINER_RUNTIMES), and OTEL_GUIDES_GO_IMAGE, _RUBY_IMAGE,
 *     _PHP_IMAGE, _RUST_IMAGE and _ELIXIR_IMAGE pick another.
 *
 * OTEL_GUIDES_CONTAINER_NAME names the collector's container (and starts
 * the names of the services'), OTEL_GUIDES_WORK_DIR the folder the apps are
 * written to (the system's temporary folder otherwise), and
 * OTEL_GUIDES_CACHE_DIR where pip, Maven, Gradle, NuGet, Go, Bundler,
 * Composer, Cargo and Mix keep what they download between runs. The
 * containers are removed when the run ends.
 */
import {
  ChildProcess,
  spawn,
  spawnSync,
  SpawnSyncReturns,
} from "child_process";
import fs from "fs";
import http from "http";
import net from "net";
import os from "os";
import path from "path";
import ts from "typescript";
import {
  GuideRuntime,
  GuideSnippet,
  GuideVerification,
  GuideVerificationRun,
  OpenTelemetryGuide,
  VerificationCommand,
  VerificationFile,
  VerificationRequest,
  VerificationService,
} from "../Utils/Integrations/OpenTelemetry/GuideTypes";
import {
  BROWSER_KEY_PLACEHOLDER,
  CLOUD_OTLP_ENDPOINT,
  INGESTION_KEY_PLACEHOLDER,
  VERIFICATION_RECEIVER,
} from "../Utils/Integrations/OpenTelemetry/GuideShared";
import {
  findGuideSnippet,
  guideSnippets,
} from "../Utils/Integrations/OpenTelemetry/GuideSnippets";
import {
  GuideVariantRecord,
  GuideVerificationRecord,
  VERIFICATIONS_FILE,
  guideSnippetDigest,
} from "../Utils/Integrations/OpenTelemetry/GuideVerifications";
import { OPEN_TELEMETRY_GUIDE_PAGES } from "../Utils/Integrations/OpenTelemetry/OpenTelemetryGuides";
import {
  JAVA_AGENT_PACKAGE,
  buildFileDependencies,
  gradleReportVersions,
  mavenReportVersions,
  importedPackages,
  installedPackageNames,
  installedPackages,
  isBuildFileSnippet,
} from "../Utils/Integrations/OpenTelemetry/GuideCodeChecks";

const COLLECTOR_IMAGE: string = "otel/opentelemetry-collector-contrib:0.161.0";
// The v of a Go module's version: v1.12.0.
const GO_VERSION_PREFIX: RegExp = /^v(?=[0-9])/;
const TEST_KEY: string = "otel-guides-test-key";
const COMMON: string = path.join(__dirname, "..", "..", "Common");

/*
 * Short export intervals, so a run takes seconds; the semantics are the
 * SDKs' own. Quarkus reads names of its own.
 */
const FAST_EXPORT: Record<string, string> = {
  OTEL_METRIC_EXPORT_INTERVAL: "2000",
  OTEL_BSP_SCHEDULE_DELAY: "500",
  OTEL_BLRP_SCHEDULE_DELAY: "500",
  QUARKUS_OTEL_METRIC_EXPORT_INTERVAL: "2s",
  QUARKUS_OTEL_BSP_SCHEDULE_DELAY: "500ms",
  QUARKUS_OTEL_BLRP_SCHEDULE_DELAY: "500ms",
};

interface Receiver {
  collectorName: string;
  outDir: string;
  proxyServer: http.Server;
  proxyPort: number;
  requests: Array<ReceivedRequest>;
}

interface ReceivedRequest {
  method: string;
  path: string;
  status: number;
  hasToken: boolean;
  contentType: string;
}

interface Observed {
  spans: Array<ObservedSpan>;
  metrics: Array<string>;
  logs: Array<ObservedLog>;
  resources: Array<Record<string, unknown>>;
}

interface ObservedSpan {
  name: string;
  spanId: string;
  parentSpanId: string;
  attributes: Record<string, unknown>;
  hasException: boolean;
  // The exception.message of each of its exception events.
  exceptionMessages: Array<string>;
}

interface ObservedLog {
  body: string;
  traceId: string;
  // exception.* attributes: OneUptime files the record under Exceptions.
  hasException: boolean;
  attributes: Record<string, unknown>;
}

const EXCEPTION_ATTRIBUTES: Array<string> = [
  "exception.type",
  "exception.message",
  "exception.stacktrace",
];

type JsonObject = Record<string, unknown>;

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function freePort(): Promise<number> {
  return new Promise(
    (resolve: (port: number) => void, reject: (error: Error) => void) => {
      const server: net.Server = net.createServer();
      server.unref();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address: net.AddressInfo = server.address() as net.AddressInfo;
        server.close(() => {
          resolve(address.port);
        });
      });
    },
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline: number = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const open: boolean = await new Promise(
      (resolve: (open: boolean) => void) => {
        const socket: net.Socket = net.connect(port, "127.0.0.1");
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => {
          resolve(false);
        });
      },
    );

    if (open) {
      return true;
    }

    await sleep(250);
  }

  return false;
}

const COLLECTOR_CONFIG: string = [
  "receivers:",
  "  otlp:",
  "    protocols:",
  "      http:",
  "        endpoint: 0.0.0.0:4318",
  "exporters:",
  "  file/traces:",
  "    path: /out/traces.jsonl",
  "    flush_interval: 1s",
  "  file/metrics:",
  "    path: /out/metrics.jsonl",
  "    flush_interval: 1s",
  "  file/logs:",
  "    path: /out/logs.jsonl",
  "    flush_interval: 1s",
  "service:",
  "  telemetry:",
  "    logs:",
  "      level: warn",
  "  pipelines:",
  "    traces: { receivers: [otlp], exporters: [file/traces] }",
  "    metrics: { receivers: [otlp], exporters: [file/metrics] }",
  "    logs: { receivers: [otlp], exporters: [file/logs] }",
  "",
].join("\n");

function postJson(port: number, urlPath: string): Promise<number> {
  return new Promise((resolve: (status: number) => void) => {
    const request: http.ClientRequest = http.request(
      {
        host: "127.0.0.1",
        port: port,
        method: "POST",
        path: urlPath,
        headers: { "content-type": "application/json" },
      },
      (response: http.IncomingMessage) => {
        response.resume();
        resolve(response.statusCode || 0);
      },
    );
    request.on("error", () => {
      resolve(0);
    });
    request.end("{}");
  });
}

// OneUptime's /otlp endpoint, as far as an SDK can tell: its paths, its 401.
function startIngestStandIn(
  collectorPort: number,
  requests: Array<ReceivedRequest>,
): http.Server {
  const signalPath: RegExp = /^\/otlp\/v1\/(traces|metrics|logs)$/;

  return http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const cors: Record<string, string> = req.headers["origin"]
        ? {
            "access-control-allow-origin": String(req.headers["origin"]),
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": String(
              req.headers["access-control-request-headers"] ||
                "content-type, x-oneuptime-token",
            ),
            vary: "Origin",
          }
        : {};

      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        res.end();
        return;
      }

      const chunks: Array<Buffer> = [];
      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on("end", () => {
        const body: Buffer = Buffer.concat(chunks);
        const urlPath: string = new URL(req.url || "/", "http://localhost")
          .pathname;
        const match: RegExpExecArray | null = signalPath.exec(urlPath);
        const hasToken: boolean = req.headers["x-oneuptime-token"] === TEST_KEY;
        const record: (status: number) => void = (status: number): void => {
          requests.push({
            method: req.method || "",
            path: urlPath,
            status: status,
            hasToken: hasToken,
            contentType: String(req.headers["content-type"] || ""),
          });
        };

        if (req.method !== "POST" || !match) {
          record(404);
          res.writeHead(404, cors);
          res.end("Not found");
          return;
        }

        if (!hasToken) {
          record(401);
          res.writeHead(401, { "content-type": "application/json", ...cors });
          res.end('{"message":"Invalid or missing x-oneuptime-token"}');
          return;
        }

        const upstream: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: collectorPort,
            method: "POST",
            path: `/v1/${match[1]}`,
            headers: {
              "content-type": String(
                req.headers["content-type"] || "application/x-protobuf",
              ),
              ...(req.headers["content-encoding"]
                ? {
                    "content-encoding": String(req.headers["content-encoding"]),
                  }
                : {}),
              "content-length": body.length,
            },
          },
          (upstreamResponse: http.IncomingMessage) => {
            const parts: Array<Buffer> = [];
            upstreamResponse.on("data", (part: Buffer) => {
              parts.push(part);
            });
            upstreamResponse.on("end", () => {
              record(upstreamResponse.statusCode || 502);
              res.writeHead(upstreamResponse.statusCode || 502, {
                "content-type": String(
                  upstreamResponse.headers["content-type"] ||
                    "application/x-protobuf",
                ),
                ...cors,
              });
              res.end(Buffer.concat(parts));
            });
          },
        );
        upstream.on("error", () => {
          record(503);
          res.writeHead(503, cors);
          res.end();
        });
        upstream.end(body);
      });
    },
  );
}

async function startReceiver(workDir: string): Promise<Receiver> {
  const outDir: string = path.join(workDir, "collector-out");
  fs.mkdirSync(outDir, { recursive: true });
  fs.chmodSync(outDir, 0o777);
  const configFile: string = path.join(workDir, "collector.yaml");
  fs.writeFileSync(configFile, COLLECTOR_CONFIG);

  const collectorPort: number = await freePort();
  const collectorName: string =
    process.env["OTEL_GUIDES_CONTAINER_NAME"] ||
    `oneuptime-otel-guides-${process.pid}`;
  const started: SpawnSyncReturns<string> = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      collectorName,
      "-p",
      `127.0.0.1:${collectorPort}:4318`,
      "-v",
      `${configFile}:/etc/otelcol-contrib/config.yaml:ro`,
      "-v",
      `${outDir}:/out`,
      COLLECTOR_IMAGE,
    ],
    { encoding: "utf8" },
  );

  if (started.status !== 0) {
    throw new Error(`Could not start the collector: ${started.stderr}`);
  }

  const deadline: number = Date.now() + 60000;
  while ((await postJson(collectorPort, "/v1/traces")) !== 200) {
    if (Date.now() > deadline) {
      throw new Error("The collector did not start answering OTLP.");
    }
    await sleep(500);
  }

  const requests: Array<ReceivedRequest> = [];
  const proxyServer: http.Server = startIngestStandIn(collectorPort, requests);
  const proxyPort: number = await freePort();
  await new Promise<void>((resolve: () => void) => {
    proxyServer.listen(proxyPort, "127.0.0.1", resolve);
  });

  return {
    collectorName: collectorName,
    outDir: outDir,
    proxyServer: proxyServer,
    proxyPort: proxyPort,
    requests: requests,
  };
}

function stopReceiver(receiver: Receiver): void {
  receiver.proxyServer.close();
  spawnSync("docker", ["rm", "-f", "-v", receiver.collectorName], {
    encoding: "utf8",
  });
}

// The page's endpoint and key, pointed at the local receiver.
function forLocalRun(text: string, proxyPort: number): string {
  return text
    .split(CLOUD_OTLP_ENDPOINT)
    .join(`http://127.0.0.1:${proxyPort}/otlp`)
    .split(INGESTION_KEY_PLACEHOLDER)
    .join(TEST_KEY)
    .split(BROWSER_KEY_PLACEHOLDER)
    .join(TEST_KEY);
}

// `export NAME="value"` lines of the page's Cloud environment snippet.
function environmentOf(
  snippet: GuideSnippet | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  const line: RegExp = /^export ([A-Z_]+)="([^"]*)"$/;

  for (const text of (snippet?.code || "").split("\n")) {
    const match: RegExpExecArray | null = line.exec(text.trim());

    if (match && match[1] && match[2] !== undefined) {
      env[match[1]] = match[2];
    }
  }

  return env;
}

function commandText(
  guide: OpenTelemetryGuide,
  command: VerificationCommand,
): string {
  if (command.snippet) {
    const snippet: GuideSnippet | undefined = findGuideSnippet(
      guide,
      command.snippet,
    );

    if (!snippet) {
      throw new Error(`${guide.slug}: no snippet ${command.snippet}`);
    }

    return snippet.code;
  }

  return command.command || "";
}

function fileSizes(outDir: string): Record<string, number> {
  const sizes: Record<string, number> = {};

  for (const name of ["traces.jsonl", "metrics.jsonl", "logs.jsonl"]) {
    const file: string = path.join(outDir, name);
    sizes[name] = fs.existsSync(file) ? fs.statSync(file).size : 0;
  }

  return sizes;
}

function readSince(
  outDir: string,
  name: string,
  from: number,
): Array<JsonObject> {
  const file: string = path.join(outDir, name);

  if (!fs.existsSync(file)) {
    return [];
  }

  const text: string = fs.readFileSync(file).subarray(from).toString("utf8");

  return text
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim().length > 0;
    })
    .map((line: string): JsonObject => {
      return JSON.parse(line) as JsonObject;
    });
}

function attributeValue(value: JsonObject | undefined): unknown {
  if (!value) {
    return undefined;
  }

  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue"]) {
    if (key in value) {
      return value[key];
    }
  }

  return value;
}

function attributesOf(items: unknown): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};

  for (const item of (items as Array<JsonObject>) || []) {
    attributes[String(item["key"])] = attributeValue(
      item["value"] as JsonObject,
    );
  }

  return attributes;
}

function collect(outDir: string, from: Record<string, number>): Observed {
  const observed: Observed = {
    spans: [],
    metrics: [],
    logs: [],
    resources: [],
  };

  for (const exportRequest of readSince(
    outDir,
    "traces.jsonl",
    from["traces.jsonl"] || 0,
  )) {
    for (const resourceSpans of (exportRequest[
      "resourceSpans"
    ] as Array<JsonObject>) || []) {
      observed.resources.push(
        attributesOf(
          (resourceSpans["resource"] as JsonObject | undefined)?.["attributes"],
        ),
      );
      for (const scopeSpans of (resourceSpans[
        "scopeSpans"
      ] as Array<JsonObject>) || []) {
        for (const span of (scopeSpans["spans"] as Array<JsonObject>) || []) {
          const exceptionEvents: Array<JsonObject> = (
            (span["events"] as Array<JsonObject>) || []
          ).filter((event: JsonObject): boolean => {
            return event["name"] === "exception";
          });
          observed.spans.push({
            name: String(span["name"]),
            spanId: String(span["spanId"] || ""),
            parentSpanId: String(span["parentSpanId"] || ""),
            attributes: attributesOf(span["attributes"]),
            hasException: exceptionEvents.length > 0,
            exceptionMessages: exceptionEvents.map(
              (event: JsonObject): string => {
                return String(
                  attributesOf(event["attributes"])["exception.message"] ?? "",
                );
              },
            ),
          });
        }
      }
    }
  }

  for (const exportRequest of readSince(
    outDir,
    "metrics.jsonl",
    from["metrics.jsonl"] || 0,
  )) {
    for (const resourceMetrics of (exportRequest[
      "resourceMetrics"
    ] as Array<JsonObject>) || []) {
      observed.resources.push(
        attributesOf(
          (resourceMetrics["resource"] as JsonObject | undefined)?.[
            "attributes"
          ],
        ),
      );
      for (const scopeMetrics of (resourceMetrics[
        "scopeMetrics"
      ] as Array<JsonObject>) || []) {
        for (const metric of (scopeMetrics["metrics"] as Array<JsonObject>) ||
          []) {
          observed.metrics.push(String(metric["name"]));
        }
      }
    }
  }

  for (const exportRequest of readSince(
    outDir,
    "logs.jsonl",
    from["logs.jsonl"] || 0,
  )) {
    for (const resourceLogs of (exportRequest[
      "resourceLogs"
    ] as Array<JsonObject>) || []) {
      observed.resources.push(
        attributesOf(
          (resourceLogs["resource"] as JsonObject | undefined)?.["attributes"],
        ),
      );
      for (const scopeLogs of (resourceLogs[
        "scopeLogs"
      ] as Array<JsonObject>) || []) {
        for (const record of (scopeLogs["logRecords"] as Array<JsonObject>) ||
          []) {
          const body: unknown = attributeValue(record["body"] as JsonObject);
          const attributes: Record<string, unknown> = attributesOf(
            record["attributes"],
          );
          observed.logs.push({
            body: typeof body === "string" ? body : JSON.stringify(body),
            traceId: String(record["traceId"] || ""),
            hasException: EXCEPTION_ATTRIBUTES.some((key: string): boolean => {
              return attributes[key] !== undefined;
            }),
            attributes: attributes,
          });
        }
      }
    }
  }

  return observed;
}

function check(
  verification: GuideVerificationRun,
  observed: Observed,
): Array<string> {
  const failures: Array<string> = [];

  for (const expected of verification.expect.spans) {
    const found: boolean = observed.spans.some(
      (span: ObservedSpan): boolean => {
        if (span.name !== expected.name) {
          return false;
        }
        if (
          expected.hasException !== undefined &&
          expected.hasException !== span.hasException
        ) {
          return false;
        }
        if (
          expected.exceptionMessage !== undefined &&
          !span.exceptionMessages.some((message: string): boolean => {
            return message.includes(expected.exceptionMessage || "");
          })
        ) {
          return false;
        }
        if (
          expected.parent !== undefined &&
          !observed.spans.some((candidate: ObservedSpan): boolean => {
            return (
              candidate.name === expected.parent &&
              candidate.spanId.length > 0 &&
              candidate.spanId === span.parentSpanId
            );
          })
        ) {
          return false;
        }
        if (
          (expected.absentAttributes || []).some((key: string): boolean => {
            return span.attributes[key] !== undefined;
          })
        ) {
          return false;
        }
        return Object.entries(expected.attributes || {}).every(
          ([key, value]: [string, string]): boolean => {
            return String(span.attributes[key]) === value;
          },
        );
      },
    );

    if (!found) {
      failures.push(`no span ${JSON.stringify(expected)}`);
    }
  }

  for (const metric of verification.expect.metrics) {
    if (!observed.metrics.includes(metric)) {
      failures.push(`no metric ${metric}`);
    }
  }

  for (const expected of verification.expect.logs) {
    const found: boolean = observed.logs.some(
      (record: ObservedLog): boolean => {
        return (
          record.body.includes(expected.body) &&
          (!expected.hasTraceContext || record.traceId.length > 0) &&
          (expected.hasException === undefined ||
            expected.hasException === record.hasException) &&
          Object.entries(expected.attributes || {}).every(
            ([key, value]: [string, string]): boolean => {
              return String(record.attributes[key]) === value;
            },
          )
        );
      },
    );

    if (!found) {
      failures.push(`no log ${JSON.stringify(expected)}`);
    }
  }

  for (const [key, value] of Object.entries(
    verification.expect.resource || {},
  )) {
    const found: boolean = observed.resources.some(
      (resource: Record<string, unknown>): boolean => {
        return String(resource[key]) === value;
      },
    );

    if (!found) {
      failures.push(`no resource with ${key}=${value}`);
    }
  }

  for (const untraced of verification.expect.untracedPaths || []) {
    const traced: ObservedSpan | undefined = observed.spans.find(
      (span: ObservedSpan): boolean => {
        return (
          span.attributes["url.path"] === untraced ||
          span.attributes["http.target"] === untraced
        );
      },
    );

    if (traced) {
      failures.push(
        `a span for ${untraced}, which the guide leaves out: ${traced.name}`,
      );
    }
  }

  for (const absent of verification.expect.absentSpans || []) {
    if (
      observed.spans.some((span: ObservedSpan): boolean => {
        return span.name === absent;
      })
    ) {
      failures.push(`a span named ${absent}, which the guide turns off`);
    }
  }

  for (const absent of verification.expect.absentMetrics || []) {
    if (observed.metrics.includes(absent)) {
      failures.push(`a metric named ${absent}, which the guide leaves out`);
    }
  }

  for (const absent of verification.expect.absentLogs || []) {
    const found: ObservedLog | undefined = observed.logs.find(
      (record: ObservedLog): boolean => {
        return record.body.includes(absent);
      },
    );

    if (found) {
      failures.push(
        `a log line with ${absent}, which the guide leaves out: ${found.body}`,
      );
    }
  }

  return failures;
}

function sendRequest(
  port: number,
  request: VerificationRequest,
): Promise<string> {
  return new Promise((resolve: (result: string) => void) => {
    const body: string | undefined = request.body
      ? JSON.stringify(request.body)
      : undefined;
    const outgoing: http.ClientRequest = http.request(
      {
        host: "127.0.0.1",
        port: port,
        method: request.method,
        path: request.path,
        /*
         * A connection per request: a server that closes after each response
         * (uWSGI's HTTP router) would otherwise hang up on the next request.
         */
        agent: false,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(request.headers || {}),
        },
      },
      (response: http.IncomingMessage) => {
        response.resume();
        response.on("end", () => {
          resolve(
            `${request.method} ${request.path} -> ${response.statusCode}`,
          );
        });
      },
    );
    outgoing.setTimeout(30000, () => {
      outgoing.destroy();
    });
    outgoing.on("error", (error: Error) => {
      resolve(`${request.method} ${request.path} -> ${error.message}`);
    });
    outgoing.end(body);
  });
}

// A built browser app, with a small API beside it for the page to call.
function serveStatic(root: string, port: number): Promise<http.Server> {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
  };

  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const urlPath: string = new URL(req.url || "/", "http://localhost")
        .pathname;

      if (urlPath.startsWith("/api/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            items: 2,
            traceparent: req.headers["traceparent"] || null,
          }),
        );
        return;
      }

      let file: string = path.join(root, path.normalize(urlPath));
      if (!path.extname(file)) {
        file = path.join(root, "index.html");
      }

      if (!file.startsWith(root) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, {
        "content-type": types[path.extname(file)] || "application/octet-stream",
      });
      fs.createReadStream(file).pipe(res);
    },
  );

  return new Promise((resolve: (server: http.Server) => void) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

interface PlaywrightPage {
  goto: (url: string, options: Record<string, unknown>) => Promise<unknown>;
  click: (selector: string) => Promise<void>;
  waitForTimeout: (milliseconds: number) => Promise<void>;
  evaluate: (script: () => void) => Promise<unknown>;
  close: (options: Record<string, unknown>) => Promise<void>;
  on: (
    event: string,
    listener: (value: { message?: string; text?: () => string }) => void,
  ) => void;
}

interface PlaywrightBrowser {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
}

async function driveBrowser(
  url: string,
  clicks: Array<string>,
): Promise<Array<string>> {
  /*
   * Common's Playwright, with the Chromium it installs. Home does not depend
   * on Playwright: the check reaches Common's copy by path, at run time.
   */
  type PlaywrightModule = {
    chromium: {
      launch: (options: Record<string, unknown>) => Promise<PlaywrightBrowser>;
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const playwright: PlaywrightModule = require(
    path.join(COMMON, "node_modules", "playwright"),
  );
  const executablePath: string | undefined =
    process.env["OTEL_GUIDES_CHROMIUM"];
  const browser: PlaywrightBrowser = await playwright.chromium.launch(
    executablePath ? { executablePath: executablePath } : {},
  );
  const page: PlaywrightPage = await browser.newPage();
  const messages: Array<string> = [];
  page.on("pageerror", (error: { message?: string }) => {
    messages.push(`page error: ${error.message}`);
  });

  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  for (const selector of clicks) {
    await page.click(selector);
    await page.waitForTimeout(800);
  }

  await page.waitForTimeout(2500);
  // Hiding the page is what makes the browser SDK send what it holds.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(2000);
  await page.close({ runBeforeUnload: true });
  await browser.close();

  return messages;
}

// A command's first line of output: "Python 3.14.10".
function firstLineOf(
  command: string,
  args: Array<string>,
  env: NodeJS.ProcessEnv,
  options: { cwd?: string; stderr?: boolean } = {},
): string {
  const result: SpawnSyncReturns<string> = spawnSync(command, args, {
    encoding: "utf8",
    env: env,
    cwd: options.cwd,
  });
  const text: string = options.stderr
    ? `${result.stderr || ""}${result.stdout || ""}`
    : result.stdout || "";

  return text.trim().split("\n")[0] || "";
}

// The runtime a check ran on, as the page names it: "Python 3.14.10", "Java 25.0.5".
function runtimeVersion(
  verification: GuideVerification,
  env: NodeJS.ProcessEnv,
  appDir: string,
): string {
  switch (verification.runtime) {
    case "bun":
      return `Bun ${firstLineOf(process.env["OTEL_GUIDES_BUN"] || "bun", ["--version"], env)}`;
    case "deno":
      return `Deno ${
        firstLineOf(
          process.env["OTEL_GUIDES_DENO"] || "deno",
          ["--version"],
          env,
        )
          .replace("deno ", "")
          .split(" ")[0]
      }`;
    case "browser":
      // "Google Chrome for Testing 153.0.8010.12" is Chrome 153.
      return process.env["OTEL_GUIDES_CHROMIUM"]
        ? firstLineOf(
            process.env["OTEL_GUIDES_CHROMIUM"],
            ["--version"],
            env,
          ).replace("Google Chrome for Testing", "Chrome")
        : "Chromium, as Common's Playwright installs it";
    case "python":
      // The virtual environment's own: "Python 3.14.10".
      return firstLineOf(
        path.join(appDir, ".venv", "bin", "python"),
        ["--version"],
        env,
      );
    case "jvm": {
      // 'openjdk version "25.0.5" 2026-10-20 LTS' is Java 25.0.5.
      const line: string = firstLineOf("java", ["-version"], env, {
        stderr: true,
      });
      const quoted: Array<string> = line.split('"');

      return `Java ${quoted[1] || line}`;
    }
    case "dotnet": {
      // "Microsoft.NETCore.App 10.0.14 [...]": the newest runtime, .NET 10.0.14.
      const result: SpawnSyncReturns<string> = spawnSync(
        "dotnet",
        ["--list-runtimes"],
        { encoding: "utf8", env: env },
      );
      const versions: Array<string> = (result.stdout || "")
        .split("\n")
        .filter((runtimeLine: string): boolean => {
          return runtimeLine.startsWith("Microsoft.NETCore.App ");
        })
        .map((runtimeLine: string): string => {
          return runtimeLine.split(" ")[1] || "";
        });

      return `.NET ${versions[versions.length - 1] || "?"}`;
    }
    default:
      return `Node.js ${firstLineOf("node", ["--version"], env).replace("v", "")}`;
  }
}

function installedVersion(
  appDir: string,
  packageName: string,
): string | undefined {
  const file: string = path.join(
    appDir,
    "node_modules",
    packageName,
    "package.json",
  );

  if (fs.existsSync(file)) {
    return (JSON.parse(fs.readFileSync(file, "utf8")) as { version?: string })
      .version;
  }

  // Deno keeps npm packages in its cache, and their versions in deno.lock.
  const lockFile: string = path.join(appDir, "deno.lock");

  if (!fs.existsSync(lockFile)) {
    return undefined;
  }

  const specifiers: Record<string, string> =
    (
      JSON.parse(fs.readFileSync(lockFile, "utf8")) as {
        specifiers?: Record<string, string>;
      }
    ).specifiers || {};

  for (const [specifier, version] of Object.entries(specifiers)) {
    if (specifier.startsWith(`npm:${packageName}@`)) {
      return version;
    }
  }

  return undefined;
}

// What the app's virtual environment has installed, by distribution name.
function pythonVersions(
  appDir: string,
  names: Array<string>,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const script: string = [
    "import importlib.metadata as metadata, json, sys",
    "found = {}",
    "for name in sys.argv[1:]:",
    "    try:",
    "        found[name] = metadata.version(name)",
    "    except metadata.PackageNotFoundError:",
    "        pass",
    "print(json.dumps(found))",
  ].join("\n");
  const result: SpawnSyncReturns<string> = spawnSync(
    path.join(appDir, ".venv", "bin", "python"),
    ["-c", script, ...names],
    { encoding: "utf8", env: env, cwd: appDir },
  );

  try {
    return JSON.parse((result.stdout || "{}").trim()) as Record<string, string>;
  } catch {
    return {};
  }
}

/*
 * What a JVM build resolved: Maven's dependency:list or Gradle's
 * dependencies and buildEnvironment (its plugins, by id), the pom's parent
 * as the build used it, and the Java agent's own version, which
 * `java -jar opentelemetry-javaagent.jar` prints.
 */
function jvmVersions(
  appDir: string,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const versions: Record<string, string> = {};

  if (fs.existsSync(path.join(appDir, "pom.xml"))) {
    const report: string = path.join(appDir, ".otel-guides-dependencies.txt");
    spawnSync(
      "mvn",
      ["-q", "-B", "dependency:list", `-DoutputFile=${report}`],
      { cwd: appDir, env: env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );

    if (fs.existsSync(report)) {
      Object.assign(
        versions,
        mavenReportVersions(fs.readFileSync(report, "utf8")),
      );
    }

    for (const dependency of buildFileDependencies({
      id: "pom",
      language: "xml",
      title: "pom.xml",
      code: fs.readFileSync(path.join(appDir, "pom.xml"), "utf8"),
      check: "parse",
    })) {
      // A version from a property the parent defines is the parent's to record.
      if (
        dependency.version &&
        !dependency.version.includes("${") &&
        !dependency.name.includes("${") &&
        !versions[dependency.name]
      ) {
        versions[dependency.name] = dependency.version;
      }
    }
  }

  if (fs.existsSync(path.join(appDir, "build.gradle.kts"))) {
    for (const task of [
      ["-q", "dependencies", "--configuration", "runtimeClasspath"],
      ["-q", "buildEnvironment"],
    ]) {
      const result: SpawnSyncReturns<string> = spawnSync(
        "gradle",
        ["--no-daemon", ...task],
        {
          cwd: appDir,
          env: env,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        },
      );

      Object.assign(versions, gradleReportVersions(result.stdout || ""));
    }
  }

  const agent: string = path.join(appDir, "opentelemetry-javaagent.jar");

  if (fs.existsSync(agent)) {
    versions[JAVA_AGENT_PACKAGE] = firstLineOf("java", ["-jar", agent], env);
  }

  return versions;
}

/*
 * What a .NET restore resolved: obj/project.assets.json's packages, and the
 * shared frameworks the app runs on, as `dotnet --list-runtimes` names
 * them - "Microsoft.AspNetCore.App 10.0.14", the newest of each.
 */
function dotnetVersions(
  appDir: string,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const versions: Record<string, string> = {};
  const runtimes: SpawnSyncReturns<string> = spawnSync(
    "dotnet",
    ["--list-runtimes"],
    { encoding: "utf8", env: env },
  );

  for (const line of (runtimes.stdout || "").split("\n")) {
    const [name, version] = line.split(" ");

    if (name && version) {
      versions[name] = version;
    }
  }
  const assets: Array<string> = [];
  const look: (directory: string, depth: number) => void = (
    directory: string,
    depth: number,
  ): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isFile() && entry.name === "project.assets.json") {
        assets.push(full);
      } else if (
        entry.isDirectory() &&
        depth < 3 &&
        entry.name !== "node_modules"
      ) {
        look(full, depth + 1);
      }
    }
  };
  look(appDir, 0);

  for (const file of assets) {
    const libraries: Record<string, { type?: string }> =
      (
        JSON.parse(fs.readFileSync(file, "utf8")) as {
          libraries?: Record<string, { type?: string }>;
        }
      ).libraries || {};

    for (const [key, library] of Object.entries(libraries)) {
      const slash: number = key.indexOf("/");

      if (library.type === "package" && slash > 0) {
        versions[key.slice(0, slash)] = key.slice(slash + 1);
      }
    }
  }

  return versions;
}

/*
 * The names a package's type declarations export, as the app's own
 * TypeScript resolves it: its interfaces and types too, and the exports of
 * packages that cannot be imported outside their runtime (Angular's need
 * its compiler to load in Node.js). Empty for a package with no types.
 */
function declaredExportsOf(appDir: string, specifier: string): Array<string> {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const resolved: ts.ResolvedModuleFull | undefined = ts.resolveModuleName(
    specifier,
    path.join(appDir, "index.ts"),
    options,
    ts.sys,
  ).resolvedModule;

  if (
    !resolved ||
    (!resolved.resolvedFileName.endsWith(".d.ts") &&
      !resolved.resolvedFileName.endsWith(".d.mts") &&
      !resolved.resolvedFileName.endsWith(".d.cts"))
  ) {
    return [];
  }

  const program: ts.Program = ts.createProgram(
    [resolved.resolvedFileName],
    options,
  );
  const checker: ts.TypeChecker = program.getTypeChecker();
  const sourceFile: ts.SourceFile | undefined = program.getSourceFile(
    resolved.resolvedFileName,
  );
  const moduleSymbol: ts.Symbol | undefined = sourceFile
    ? checker.getSymbolAtLocation(sourceFile)
    : undefined;

  if (!moduleSymbol) {
    return [];
  }

  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol: ts.Symbol): string => {
      return symbol.getName();
    });
}

// The names a package exports, as the app's runtime imports it.
function exportsOf(
  appDir: string,
  specifier: string,
  verification: GuideVerification,
  env: NodeJS.ProcessEnv,
): Array<string> {
  const script: string = `const m = await import(${JSON.stringify(specifier)}); console.log(JSON.stringify(Object.keys(m).sort()));`;
  const result: SpawnSyncReturns<string> =
    verification.runtime === "deno"
      ? spawnSync(process.env["OTEL_GUIDES_DENO"] || "deno", ["eval", script], {
          cwd: appDir,
          env: env,
          encoding: "utf8",
        })
      : spawnSync("node", ["--input-type=module", "-e", script], {
          cwd: appDir,
          env: env,
          encoding: "utf8",
        });

  try {
    return JSON.parse(
      (result.stdout || "").trim().split("\n").pop() || "[]",
    ) as Array<string>;
  } catch {
    return [];
  }
}

function prependPath(env: NodeJS.ProcessEnv, directory: string): void {
  env["PATH"] = `${directory}${path.delimiter}${env["PATH"] || ""}`;
}

/*
 * Where the package managers keep what they download, between runs and
 * between guides: OTEL_GUIDES_CACHE_DIR, or a folder beside the apps.
 */
function cacheDirOf(workRoot: string): string {
  return (
    process.env["OTEL_GUIDES_CACHE_DIR"] ||
    path.join(workRoot, "otel-guides-cache")
  );
}

/*
 * The environment a run's commands get: the runtime's binaries first on
 * PATH (a Python run's own virtual environment), the package managers'
 * caches, the page's Cloud variables pointed at the receiver, and short
 * export intervals.
 */
function runEnvironment(
  guide: OpenTelemetryGuide,
  appDir: string,
  cacheDir: string,
  receiver: Receiver,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (process.env["OTEL_GUIDES_NODE_BIN"]) {
    prependPath(env, process.env["OTEL_GUIDES_NODE_BIN"]);
  }
  for (const [name, value] of Object.entries(
    environmentOf(findGuideSnippet(guide, "env-cloud")),
  )) {
    env[name] = forLocalRun(value, receiver.proxyPort);
  }
  Object.assign(env, FAST_EXPORT);
  if (process.env["OTEL_GUIDES_BUN"]) {
    prependPath(env, path.dirname(process.env["OTEL_GUIDES_BUN"]));
  }
  if (process.env["OTEL_GUIDES_DENO"]) {
    prependPath(env, path.dirname(process.env["OTEL_GUIDES_DENO"]));
    env["DENO_DIR"] = path.join(cacheDir, "deno");
  }

  switch (guide.verification.runtime) {
    case "python":
      // The app's own virtual environment, as the page's commands assume.
      prependPath(env, path.join(appDir, ".venv", "bin"));
      env["VIRTUAL_ENV"] = path.join(appDir, ".venv");
      env["PIP_CACHE_DIR"] = path.join(cacheDir, "pip");
      env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1";
      env["PYTHONUNBUFFERED"] = "1";
      break;
    case "jvm":
      if (process.env["OTEL_GUIDES_JAVA_HOME"]) {
        env["JAVA_HOME"] = process.env["OTEL_GUIDES_JAVA_HOME"];
        prependPath(
          env,
          path.join(process.env["OTEL_GUIDES_JAVA_HOME"], "bin"),
        );
      }
      for (const variable of [
        "OTEL_GUIDES_MAVEN_BIN",
        "OTEL_GUIDES_GRADLE_BIN",
      ]) {
        if (process.env[variable]) {
          prependPath(env, process.env[variable]!);
        }
      }
      env["MAVEN_OPTS"] = `-Dmaven.repo.local=${path.join(cacheDir, "m2")}`;
      env["GRADLE_USER_HOME"] = path.join(cacheDir, "gradle");
      break;
    case "dotnet":
      if (process.env["OTEL_GUIDES_DOTNET_ROOT"]) {
        env["DOTNET_ROOT"] = process.env["OTEL_GUIDES_DOTNET_ROOT"];
        prependPath(env, process.env["OTEL_GUIDES_DOTNET_ROOT"]);
      }
      env["NUGET_PACKAGES"] = path.join(cacheDir, "nuget");
      env["DOTNET_CLI_HOME"] = path.join(cacheDir, "dotnet-home");
      env["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1";
      env["DOTNET_NOLOGO"] = "1";
      env["DOTNET_SKIP_FIRST_TIME_EXPERIENCE"] = "1";
      break;
    default: {
      // A toolbox's package manager keeps its downloads in the cache folder.
      const container: ContainerRuntime | undefined = containerRuntimeOf(
        guide.verification,
      );

      if (container) {
        Object.assign(env, container.cacheEnvironment(cacheDir));
      }
      break;
    }
  }

  return env;
}

// The broker or database a run needs, in a container named after the check's.
async function startServices(
  services: Array<VerificationService>,
  baseName: string,
): Promise<{ containers: Array<string>; env: Record<string, string> }> {
  const containers: Array<string> = [];
  const env: Record<string, string> = {};

  for (const service of services) {
    const port: number = await freePort();
    const container: string = `${baseName}-${service.name}`;
    spawnSync("docker", ["rm", "-f", "-v", container], { encoding: "utf8" });
    const started: SpawnSyncReturns<string> = spawnSync(
      "docker",
      [
        "run",
        "-d",
        "--rm",
        "--name",
        container,
        "-p",
        `127.0.0.1:${port}:${service.containerPort}`,
        ...Object.entries(service.environment || {}).flatMap(
          ([name, value]: [string, string]): Array<string> => {
            return ["-e", `${name}=${value}`];
          },
        ),
        service.image,
      ],
      { encoding: "utf8" },
    );

    if (started.status !== 0) {
      throw new Error(`Could not start ${service.name}: ${started.stderr}`);
    }

    containers.push(container);

    if (!(await waitForPort(port, 60000))) {
      throw new Error(`${service.name} did not take connections on ${port}`);
    }

    if (service.readyLog) {
      const deadline: number = Date.now() + 120000;
      let isReady: boolean = false;

      while (!isReady && Date.now() < deadline) {
        const logs: SpawnSyncReturns<string> = spawnSync(
          "docker",
          ["logs", container],
          { encoding: "utf8" },
        );
        isReady =
          `${logs.stdout || ""}${logs.stderr || ""}`.split(
            service.readyLog.text,
          ).length -
            1 >=
          service.readyLog.times;

        if (!isReady) {
          await sleep(500);
        }
      }

      if (!isReady) {
        throw new Error(
          `${service.name} never logged "${service.readyLog.text}"`,
        );
      }
    }
    await sleep(1500);

    for (const [name, value] of Object.entries(service.appEnvironment)) {
      env[name] = value.split("{port}").join(String(port));
    }
  }

  return { containers: containers, env: env };
}

function stopServices(containers: Array<string>): void {
  for (const container of containers) {
    spawnSync("docker", ["rm", "-f", "-v", container], { encoding: "utf8" });
  }
}

/*
 * The other services a guide's app calls, played by the check: any request
 * to /api/* gets two invoices back (and the traceparent it carried).
 */
function serveStubApi(port: number): Promise<http.Server> {
  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      req.resume();
      req.on("end", () => {
        const urlPath: string = new URL(req.url || "/", "http://localhost")
          .pathname;

        if (!urlPath.startsWith("/api/")) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            items: [
              { id: "inv_1", total: 120 },
              { id: "inv_2", total: 80 },
            ],
            traceparent: req.headers["traceparent"] || null,
          }),
        );
      });
    },
  );

  return new Promise((resolve: (server: http.Server) => void) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/*
 * The runtimes a run works in a container for, instead of on this
 * machine: Go, Ruby, PHP, Rust and Elixir, each the language's official
 * image at a pinned version. One container per run - its toolbox - mounts
 * the work folder and the download caches at the same paths and shares
 * this machine's network, so the app reaches the receiver, the stand-in
 * API and the services at 127.0.0.1 as a local run's does, and the check
 * reaches the app's port. What a reader's machine has before a guide's
 * first step - Composer, Hex - is set up as the toolbox starts.
 */
interface ContainerRuntime {
  image: string;
  // Run once as the toolbox starts: what the page assumes is there.
  setup?: string | undefined;
  // Where its package manager keeps downloads: in the check's cache folder.
  cacheEnvironment: (cacheDir: string) => Record<string, string>;
  // The command that prints its version, and the page's name for what it prints.
  version: { command: string; read: (output: string) => string };
  /*
   * A command that prints what the run installed outside any lock file, a
   * name=version a line: PHP's extensions, which PECL builds into PHP, and
   * the tools `go install` builds, such as protoc's Go plugins.
   */
  installed?: string | undefined;
}

const COMPOSER_VERSION: string = "2.10.3";

const CONTAINER_RUNTIMES: Partial<Record<GuideRuntime, ContainerRuntime>> = {
  go: {
    image: "golang:1.27.3-trixie",
    cacheEnvironment: (cacheDir: string): Record<string, string> => {
      return {
        GOMODCACHE: path.join(cacheDir, "go", "mod"),
        GOCACHE: path.join(cacheDir, "go", "build"),
      };
    },
    // "go1.27.3" is Go 1.27.3.
    version: {
      command: "go env GOVERSION",
      read: (output: string): string => {
        return `Go ${output.trim().replace("go", "")}`;
      },
    },
    // Each binary `go install` built: its package's path, at its module's version.
    installed: [
      'for binary in "$(go env GOPATH)"/bin/*; do',
      '[ -f "$binary" ] || continue;',
      'info=$(go version -m "$binary");',
      'package=$(printf "%s\\n" "$info" | grep -m1 "^\tpath\t" | cut -f3);',
      'version=$(printf "%s\\n" "$info" | grep -m1 "^\tmod\t" | cut -f4);',
      'echo "$package=$version";',
      "done",
    ].join(" "),
  },
  ruby: {
    image: "ruby:4.0.9-trixie",
    cacheEnvironment: (cacheDir: string): Record<string, string> => {
      return {
        BUNDLE_USER_CACHE: path.join(cacheDir, "bundler"),
        BUNDLE_GLOBAL_GEM_CACHE: "true",
      };
    },
    version: {
      command: "ruby -e 'print RUBY_VERSION'",
      read: (output: string): string => {
        return `Ruby ${output.trim()}`;
      },
    },
  },
  php: {
    image: "php:8.5.12-cli-trixie",
    // Composer, and unzip for the packages it downloads.
    setup: [
      "apt-get update -qq",
      "apt-get install -y -qq unzip > /dev/null",
      `curl -sSfL -o /usr/local/bin/composer https://getcomposer.org/download/${COMPOSER_VERSION}/composer.phar`,
      "chmod +x /usr/local/bin/composer",
    ].join(" && "),
    cacheEnvironment: (cacheDir: string): Record<string, string> => {
      return {
        COMPOSER_CACHE_DIR: path.join(cacheDir, "composer"),
        COMPOSER_ALLOW_SUPERUSER: "1",
        COMPOSER_NO_INTERACTION: "1",
      };
    },
    version: {
      command: "php -r 'echo PHP_VERSION;'",
      read: (output: string): string => {
        return `PHP ${output.trim()}`;
      },
    },
    installed:
      "php -r 'foreach (get_loaded_extensions() as $e) { $v = phpversion($e); if ($v) { echo $e, \"=\", $v, PHP_EOL; } }'",
  },
  rust: {
    image: "rust:1.99.1-trixie",
    cacheEnvironment: (cacheDir: string): Record<string, string> => {
      return {
        CARGO_HOME: path.join(cacheDir, "cargo"),
        // One build folder for every Rust run: the crates they share build once.
        CARGO_TARGET_DIR: path.join(cacheDir, "cargo-target"),
      };
    },
    // "rustc 1.99.1 (5b0...e 2026-10-...)" is Rust 1.99.1.
    version: {
      command: "rustc --version",
      read: (output: string): string => {
        return `Rust ${output.trim().split(" ")[1] || "?"}`;
      },
    },
  },
  elixir: {
    image: "elixir:1.20.4-otp-29",
    setup: "mix local.hex --force && mix local.rebar --force",
    cacheEnvironment: (cacheDir: string): Record<string, string> => {
      return {
        MIX_HOME: path.join(cacheDir, "mix"),
        HEX_HOME: path.join(cacheDir, "hex"),
      };
    },
    version: {
      command: "elixir --short-version",
      read: (output: string): string => {
        return `Elixir ${output.trim()}`;
      },
    },
  },
};

function containerRuntimeOf(
  verification: GuideVerification,
): ContainerRuntime | undefined {
  const runtime: ContainerRuntime | undefined =
    CONTAINER_RUNTIMES[verification.runtime];

  if (!runtime) {
    return undefined;
  }

  const image: string | undefined =
    process.env[`OTEL_GUIDES_${verification.runtime.toUpperCase()}_IMAGE`];

  return image ? { ...runtime, image: image } : runtime;
}

/*
 * The script each server is started by in a toolbox: the page's command
 * in a process group of its own, whose id it writes down, so the check can
 * stop every process the command started with one signal, as it does on
 * this machine.
 */
const TOOLBOX_SERVE_SCRIPT: string = [
  "#!/bin/bash",
  "set -m",
  'bash -c "$2" &',
  'echo $! > "$1"',
  "wait $!",
  "",
].join("\n");

interface Toolbox {
  container: string;
  // The variables every command gets, beside its own.
  environment: Record<string, string>;
  serveScript: string;
  servers: number;
}

// The variables a run set beside this machine's own, for a toolbox's commands.
function variablesForToolbox(env: NodeJS.ProcessEnv): Record<string, string> {
  const variables: Record<string, string> = {};

  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && process.env[name] !== value && name !== "PATH") {
      variables[name] = value;
    }
  }

  return variables;
}

function toolboxEnvironmentFlags(
  variables: Record<string, string>,
): Array<string> {
  return Object.entries(variables).flatMap(
    ([name, value]: [string, string]): Array<string> => {
      return ["-e", `${name}=${value}`];
    },
  );
}

async function startToolbox(
  runtime: ContainerRuntime,
  name: string,
  workDir: string,
  cacheDir: string,
  appDir: string,
  env: NodeJS.ProcessEnv,
): Promise<Toolbox> {
  spawnSync("docker", ["rm", "-f", "-v", name], { encoding: "utf8" });
  const started: SpawnSyncReturns<string> = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--init",
      "--name",
      name,
      "--network",
      "host",
      "-v",
      `${workDir}:${workDir}`,
      "-v",
      `${cacheDir}:${cacheDir}`,
      "-w",
      appDir,
      runtime.image,
      "sleep",
      "infinity",
    ],
    { encoding: "utf8" },
  );

  if (started.status !== 0) {
    throw new Error(`Could not start ${runtime.image}: ${started.stderr}`);
  }

  const serveScript: string = path.join(workDir, "otel-guides-serve.sh");
  fs.writeFileSync(serveScript, TOOLBOX_SERVE_SCRIPT);

  const toolbox: Toolbox = {
    container: name,
    environment: variablesForToolbox(env),
    serveScript: serveScript,
    servers: 0,
  };

  if (runtime.setup) {
    log(`  (toolbox) $ ${runtime.setup}`);
    const result: CommandResult = await runCommand(
      runtime.setup,
      appDir,
      env,
      toolbox,
    );

    if (result.status !== 0) {
      stopToolbox(toolbox);
      throw new Error(
        `Could not set ${runtime.image} up:\n${result.stdout.slice(-2000)}\n${result.stderr.slice(-3000)}`,
      );
    }
  }

  return toolbox;
}

function stopToolbox(toolbox: Toolbox): void {
  spawnSync("docker", ["rm", "-f", "-v", toolbox.container], {
    encoding: "utf8",
  });
}

// The command line that runs `text` in the toolbox, in `cwd`, with `env`'s variables.
function toolboxExec(
  toolbox: Toolbox,
  cwd: string,
  env: NodeJS.ProcessEnv,
  command: Array<string>,
): Array<string> {
  return [
    "exec",
    "-w",
    cwd,
    ...toolboxEnvironmentFlags({
      ...toolbox.environment,
      ...variablesForToolbox(env),
    }),
    toolbox.container,
    ...command,
  ];
}

// What a command prints in the toolbox, its first line: a runtime's version.
function toolboxOutput(toolbox: Toolbox, command: string): string {
  const result: SpawnSyncReturns<string> = spawnSync(
    "docker",
    ["exec", toolbox.container, "bash", "-c", command],
    { encoding: "utf8" },
  );

  return (result.stdout || "").trim();
}

/*
 * A server the check started: on this machine, a process group it stops
 * with a signal; in a toolbox, the group the serve script wrote down.
 */
interface RunningServer {
  process: ChildProcess;
  signal: (signal: "SIGTERM" | "SIGKILL") => void;
}

function startServer(
  text: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  output: Array<string>,
  toolbox: Toolbox | null,
): RunningServer {
  let child: ChildProcess;
  let signal: (name: "SIGTERM" | "SIGKILL") => void;

  if (toolbox) {
    toolbox.servers++;
    const pidFile: string = `/tmp/otel-guides-server-${toolbox.servers}.pid`;
    child = spawn(
      "docker",
      toolboxExec(toolbox, cwd, env, [
        "bash",
        toolbox.serveScript,
        pidFile,
        text,
      ]),
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    signal = (name: "SIGTERM" | "SIGKILL"): void => {
      spawnSync(
        "docker",
        [
          "exec",
          toolbox.container,
          "bash",
          "-c",
          `kill -${name === "SIGTERM" ? "TERM" : "KILL"} -- -$(cat ${pidFile})`,
        ],
        { encoding: "utf8" },
      );
    };
  } else {
    // Its own process group, so stopping it reaches every process it starts.
    child = spawn("bash", ["-c", text], {
      cwd: cwd,
      env: env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    signal = (name: "SIGTERM" | "SIGKILL"): void => {
      if (child.pid) {
        try {
          process.kill(-child.pid, name);
        } catch {
          // Already gone.
        }
      }
    };
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    output.push(chunk.toString());
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output.push(chunk.toString());
  });

  return { process: child, signal: signal };
}

/*
 * A command run to its end, without blocking: the receiver and the
 * stand-in API answer from this same process, so a command that runs while
 * a server calls them - a script queuing tasks for a worker - must not
 * hold the event loop.
 */
function runCommand(
  text: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  toolbox: Toolbox | null = null,
): Promise<CommandResult> {
  return new Promise((resolve: (result: CommandResult) => void) => {
    const child: ChildProcess = toolbox
      ? spawn("docker", toolboxExec(toolbox, cwd, env, ["bash", "-c", text]), {
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn("bash", ["-c", text], {
          cwd: cwd,
          env: env,
          stdio: ["ignore", "pipe", "pipe"],
        });
    const stdout: Array<Buffer> = [];
    const stderr: Array<Buffer> = [];
    const timer: NodeJS.Timeout = setTimeout(
      () => {
        child.kill("SIGKILL");
      },
      20 * 60 * 1000,
    );

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("close", (status: number | null) => {
      clearTimeout(timer);
      resolve({
        status: status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function waitForText(
  output: Array<string>,
  text: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline: number = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (output.join("").includes(text)) {
      return true;
    }
    await sleep(250);
  }

  return false;
}

async function stopServer(
  server: RunningServer,
  output: Array<string>,
): Promise<void> {
  if (!server.process.pid) {
    return;
  }

  const exited: Promise<boolean> = new Promise(
    (resolve: (exited: boolean) => void) => {
      const timer: NodeJS.Timeout = setTimeout(() => {
        resolve(false);
      }, 25000);
      server.process.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
      if (
        server.process.exitCode !== null ||
        server.process.signalCode !== null
      ) {
        clearTimeout(timer);
        resolve(true);
      }
    },
  );

  server.signal("SIGTERM");

  if (!(await exited)) {
    output.push("\n[the app did not stop within 25 seconds of SIGTERM]\n");
    server.signal("SIGKILL");
  }
}

function snippetsOfRun(
  guide: OpenTelemetryGuide,
  run: GuideVerificationRun,
): Array<GuideSnippet> {
  return run.files
    .map((file: VerificationFile): GuideSnippet | undefined => {
      return file.snippet ? findGuideSnippet(guide, file.snippet) : undefined;
    })
    .filter((snippet: GuideSnippet | undefined): snippet is GuideSnippet => {
      return Boolean(snippet);
    });
}

/*
 * The versions a run installed, for every package the page or the run
 * names: its install commands, its build files (as the run wrote them),
 * and the framework.
 */
function recordedVersions(
  guide: OpenTelemetryGuide,
  run: GuideVerificationRun,
  appDir: string,
  env: NodeJS.ProcessEnv,
  installedOutside: Record<string, string>,
): Record<string, string> {
  const verification: GuideVerification = guide.verification;
  const commandsText: string = run.commands
    .map((command: VerificationCommand): string => {
      return commandText(guide, command);
    })
    .join("\n");
  const names: Set<string> = new Set(installedPackageNames(commandsText));

  for (const snippet of [
    ...snippetsOfRun(guide, run),
    ...guideSnippets(guide).filter(isBuildFileSnippet),
  ]) {
    for (const dependency of buildFileDependencies(snippet)) {
      names.add(dependency.name);
    }
    for (const dependency of installedPackages(snippet.code)) {
      names.add(dependency.name);
    }
  }
  for (const file of run.files) {
    const language: GuideSnippet["language"] | undefined = buildFileLanguage(
      file.path,
    );

    if (file.content && language) {
      for (const dependency of buildFileDependencies({
        id: file.path,
        language: language,
        title: file.path,
        code: file.content,
        check: "parse",
      })) {
        names.add(dependency.name);
      }
    }
  }
  if (verification.framework.package) {
    names.add(verification.framework.package);
  }

  let resolved: Record<string, string> = {};

  switch (verification.runtime) {
    case "python":
      resolved = pythonVersions(appDir, [...names], env);
      break;
    case "jvm":
      resolved = jvmVersions(appDir, env);
      break;
    case "dotnet":
      resolved = dotnetVersions(appDir, env);
      break;
    case "go":
      resolved = { ...installedOutside, ...goModuleVersions(appDir) };
      break;
    case "ruby":
      resolved = gemfileLockVersions(appDir);
      break;
    case "php":
      resolved = { ...installedOutside, ...composerLockVersions(appDir) };
      break;
    case "rust":
      resolved = cargoLockVersions(appDir);
      break;
    case "elixir":
      resolved = mixLockVersions(appDir);
      break;
    default:
      for (const name of names) {
        const version: string | undefined = installedVersion(appDir, name);
        if (version) {
          resolved[name] = version;
        }
      }
      break;
  }

  const packages: Record<string, string> = {};

  for (const name of [...names].sort()) {
    if (resolved[name]) {
      packages[name] = resolved[name]!;
    }
  }

  return packages;
}

// A build file's language by its name, for a file a run writes that the page does not show.
function buildFileLanguage(
  filePath: string,
): GuideSnippet["language"] | undefined {
  const name: string = path.basename(filePath);

  if (name === "pom.xml" || name.endsWith(".csproj")) {
    return "xml";
  }
  if (name.endsWith(".gradle.kts")) {
    return "kotlin";
  }
  if (name === "Gemfile") {
    return "ruby";
  }
  if (name === "composer.json") {
    return "json";
  }
  if (name === "Cargo.toml") {
    return "toml";
  }
  if (name === "mix.exs") {
    return "elixir";
  }

  return undefined;
}

function readIfThere(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/*
 * The modules a Go build selected, from go.mod as the run left it: since
 * Go 1.17 it lists every module the build needs, each at the version the
 * build used.
 */
function goModuleVersions(appDir: string): Record<string, string> {
  const versions: Record<string, string> = {};
  let inRequireBlock: boolean = false;

  for (const rawLine of readIfThere(path.join(appDir, "go.mod")).split("\n")) {
    const line: string = rawLine.trim();

    if (line === "require (") {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ")") {
      inRequireBlock = false;
      continue;
    }

    const words: Array<string> = (
      line.startsWith("require ") ? line.slice("require ".length) : line
    )
      .split(" ")
      .filter((word: string): boolean => {
        return word.length > 0;
      });

    if (
      (inRequireBlock || line.startsWith("require ")) &&
      words.length >= 2 &&
      words[0] &&
      words[1]
    ) {
      versions[words[0]] = words[1];
    }
  }

  return versions;
}

/*
 * The gems Bundler resolved, from Gemfile.lock's specs (four spaces in):
 * "    sqlite3 (2.10.2-x86_64-linux-gnu)" is sqlite3 2.10.2.
 */
function gemfileLockVersions(appDir: string): Record<string, string> {
  const versions: Record<string, string> = {};

  for (const line of readIfThere(path.join(appDir, "Gemfile.lock")).split(
    "\n",
  )) {
    if (!line.startsWith("    ") || line.startsWith("     ")) {
      continue;
    }

    const open: number = line.indexOf(" (");
    const close: number = line.indexOf(")", open);

    if (open > 0 && close > open) {
      const version: string = line.slice(open + 2, close);
      versions[line.slice(0, open).trim()] = version.split("-")[0] || version;
    }
  }

  return versions;
}

// The packages Composer installed, from composer.lock: "v13.39.0" is 13.39.0.
function composerLockVersions(appDir: string): Record<string, string> {
  const versions: Record<string, string> = {};
  const text: string = readIfThere(path.join(appDir, "composer.lock"));

  if (!text) {
    return versions;
  }

  const lock: {
    packages?: Array<{ name: string; version: string }>;
    "packages-dev"?: Array<{ name: string; version: string }>;
  } = JSON.parse(text) as {
    packages?: Array<{ name: string; version: string }>;
    "packages-dev"?: Array<{ name: string; version: string }>;
  };

  for (const item of [
    ...(lock.packages || []),
    ...(lock["packages-dev"] || []),
  ]) {
    versions[item.name] = item.version.replace(GO_VERSION_PREFIX, "");
  }

  return versions;
}

/*
 * The crates Cargo resolved, from Cargo.lock: [[package]] blocks with a
 * name and a version. A crate the build needs at two versions is recorded
 * at the higher.
 */
function cargoLockVersions(appDir: string): Record<string, string> {
  const versions: Record<string, string> = {};
  let name: string = "";

  for (const rawLine of readIfThere(path.join(appDir, "Cargo.lock")).split(
    "\n",
  )) {
    const line: string = rawLine.trim();

    if (line === "[[package]]") {
      name = "";
      continue;
    }

    const [key, value] = line.split(" = ");
    const unquoted: string = (value || "").split('"').join("");

    if (key === "name") {
      name = unquoted;
    } else if (key === "version" && name) {
      const known: string | undefined = versions[name];

      if (!known || compareVersions(unquoted, known) > 0) {
        versions[name] = unquoted;
      }
    }
  }

  return versions;
}

function compareVersions(a: string, b: string): number {
  const partsA: Array<number> = a.split(".").map(Number);
  const partsB: Array<number> = b.split(".").map(Number);

  for (
    let index: number = 0;
    index < Math.max(partsA.length, partsB.length);
    index++
  ) {
    const difference: number = (partsA[index] || 0) - (partsB[index] || 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

/*
 * The Hex packages Mix resolved, from mix.lock:
 *   "opentelemetry": {:hex, :opentelemetry, "1.7.0", "...", [:rebar3], [...], "hexpm", "..."},
 */
function mixLockVersions(appDir: string): Record<string, string> {
  const versions: Record<string, string> = {};

  for (const line of readIfThere(path.join(appDir, "mix.lock")).split("\n")) {
    const marker: string = "{:hex, :";
    const at: number = line.indexOf(marker);

    if (at < 0) {
      continue;
    }

    const rest: string = line.slice(at + marker.length);
    const comma: number = rest.indexOf(",");
    const quoteStart: number = rest.indexOf('"', comma);
    const quoteEnd: number = rest.indexOf('"', quoteStart + 1);

    if (comma > 0 && quoteStart > comma && quoteEnd > quoteStart) {
      versions[rest.slice(0, comma)] = rest.slice(quoteStart + 1, quoteEnd);
    }
  }

  return versions;
}

interface RunResult {
  observed: Observed;
  packages: Record<string, string>;
  env: NodeJS.ProcessEnv;
  appDir: string;
  // A toolbox's runtime, as its image reported it: "Go 1.27.3".
  runtime?: string | undefined;
}

/*
 * One run: the app written into an empty folder, its services and stand-in
 * API started, its commands run (each after the server before it is
 * ready), its requests asked, the server stopped with SIGTERM, and what
 * reached the receiver checked against what the run expects.
 */
async function verifyRun(
  guide: OpenTelemetryGuide,
  run: GuideVerificationRun,
  runName: string,
  receiver: Receiver,
  workDir: string,
  cacheDir: string,
): Promise<RunResult> {
  const verification: GuideVerification = guide.verification;
  const appDir: string = path.join(workDir, runName);
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  for (const file of run.files) {
    const snippet: GuideSnippet | undefined = file.snippet
      ? findGuideSnippet(guide, file.snippet)
      : undefined;

    if (file.snippet && !snippet) {
      throw new Error(`${guide.slug}: no snippet ${file.snippet}`);
    }

    const content: string = snippet ? snippet.code : file.content || "";
    const target: string = path.join(appDir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${forLocalRun(content, receiver.proxyPort)}\n`);
  }

  const env: NodeJS.ProcessEnv = runEnvironment(
    guide,
    appDir,
    cacheDir,
    receiver,
  );

  for (const id of run.environmentSnippets || []) {
    const snippet: GuideSnippet | undefined = findGuideSnippet(guide, id);

    if (!snippet) {
      throw new Error(`${guide.slug}: no snippet ${id}`);
    }

    for (const [name, value] of Object.entries(environmentOf(snippet))) {
      env[name] = forLocalRun(value, receiver.proxyPort);
    }
  }

  if (verification.runtime === "python") {
    const created: SpawnSyncReturns<string> = spawnSync(
      process.env["OTEL_GUIDES_PYTHON"] || "python3",
      ["-m", "venv", ".venv"],
      { cwd: appDir, encoding: "utf8" },
    );

    if (created.status !== 0) {
      throw new Error(`${runName}: no virtual environment: ${created.stderr}`);
    }
  }

  const before: Record<string, number> = fileSizes(receiver.outDir);
  const requestCountBefore: number = receiver.requests.length;
  const servers: Array<RunningServer> = [];
  const containerBase: string =
    process.env["OTEL_GUIDES_CONTAINER_NAME"] ||
    `oneuptime-otel-guides-${process.pid}`;
  const containerRuntime: ContainerRuntime | undefined =
    containerRuntimeOf(verification);
  let toolbox: Toolbox | null = null;
  let runtime: string | undefined = undefined;
  // What the toolbox reports installed outside the app's lock files.
  const installedOutside: Record<string, string> = {};
  let containers: Array<string> = [];
  let staticServer: http.Server | null = null;
  let stubApi: http.Server | null = null;
  const output: Array<string> = [];

  // Another program on the app's port would answer the check in its place.
  if (run.port !== undefined && (await waitForPort(run.port, 500))) {
    throw new Error(
      `${runName}: something already listens on ${run.port}; stop it first`,
    );
  }

  try {
    if (containerRuntime) {
      toolbox = await startToolbox(
        containerRuntime,
        `${containerBase}-${runName}`,
        workDir,
        cacheDir,
        appDir,
        env,
      );
      runtime = containerRuntime.version.read(
        toolboxOutput(toolbox, containerRuntime.version.command),
      );
    }

    if (run.services && run.services.length > 0) {
      const started: {
        containers: Array<string>;
        env: Record<string, string>;
      } = await startServices(run.services, containerBase);
      containers = started.containers;
      Object.assign(env, started.env);
    }

    if (run.stubApiPort !== undefined) {
      stubApi = await serveStubApi(run.stubApiPort);
    }

    for (const command of run.commands) {
      const text: string = forLocalRun(
        commandText(guide, command),
        receiver.proxyPort,
      );
      const commandEnv: NodeJS.ProcessEnv = {
        ...env,
        ...(command.environment || {}),
      };

      if (command.isServer) {
        log(`  $ ${text} &`);
        servers.push(startServer(text, appDir, commandEnv, output, toolbox));

        const isReady: boolean = command.readyText
          ? await waitForText(output, command.readyText, 300000)
          : run.port !== undefined
            ? await waitForPort(run.port, 300000)
            : true;

        if (!isReady) {
          throw new Error(
            `${runName}: the server was not ready:\n${output.join("").slice(-4000)}`,
          );
        }
        await sleep(1000);
        continue;
      }

      log(`  $ ${text}`);
      const result: CommandResult = await runCommand(
        text,
        appDir,
        commandEnv,
        toolbox,
      );

      if (result.status !== 0) {
        throw new Error(
          `${runName}: \`${text}\` failed:\n${(result.stdout || "").slice(-3000)}\n${(result.stderr || "").slice(-4000)}`,
        );
      }

      output.push(result.stdout || "", result.stderr || "");
    }

    if (run.serve && run.port !== undefined) {
      staticServer = await serveStatic(path.join(appDir, run.serve), run.port);
    }

    if (run.port !== undefined) {
      if (!(await waitForPort(run.port, 180000))) {
        throw new Error(
          `${runName}: nothing listened on ${run.port}:\n${output.join("").slice(-4000)}`,
        );
      }
      await sleep(1000);

      for (const request of run.requests) {
        log(`  ${await sendRequest(run.port, request)}`);
      }

      if (verification.runtime === "browser") {
        const messages: Array<string> = await driveBrowser(
          `http://127.0.0.1:${run.port}/`,
          run.clicks || [],
        );
        for (const message of messages) {
          log(`  ${message}`);
        }
      }
    }

    if (toolbox && containerRuntime?.installed) {
      for (const line of toolboxOutput(
        toolbox,
        containerRuntime.installed,
      ).split("\n")) {
        const equals: number = line.indexOf("=");

        if (equals > 0) {
          installedOutside[line.slice(0, equals)] = line.slice(equals + 1);
        }
      }
    }

    await sleep(4000);
  } finally {
    for (const server of [...servers].reverse()) {
      await stopServer(server, output);
    }
    if (staticServer) {
      staticServer.close();
    }
    if (stubApi) {
      stubApi.close();
    }
    stopServices(containers);
    if (toolbox) {
      stopToolbox(toolbox);
    }
  }

  // The collector writes its files once a second.
  await sleep(3000);

  const observed: Observed = collect(receiver.outDir, before);
  const failures: Array<string> = check(run, observed);
  const received: Array<ReceivedRequest> =
    receiver.requests.slice(requestCountBefore);

  if (received.length === 0) {
    failures.push("nothing reached the endpoint");
  }
  for (const request of received) {
    if (!request.hasToken) {
      failures.push(
        `a request without the key: ${request.method} ${request.path}`,
      );
    }
    if (request.status !== 200) {
      failures.push(
        `a request answered ${request.status}: ${request.method} ${request.path}`,
      );
    }
  }
  if (output.join("").includes("[the app did not stop")) {
    failures.push("the app did not stop on SIGTERM");
  }

  if (failures.length > 0) {
    throw new Error(
      `${runName} failed:\n  - ${failures.join("\n  - ")}\n\nApp output:\n${output.join("").slice(-6000)}`,
    );
  }

  return {
    observed: observed,
    packages: recordedVersions(guide, run, appDir, env, installedOutside),
    runtime: runtime,
    env: env,
    appDir: appDir,
  };
}

function observedRecord(
  observed: Observed,
): GuideVerificationRecord["observed"] {
  const unique: (values: Array<string>) => Array<string> = (
    values: Array<string>,
  ): Array<string> => {
    return Array.from(new Set(values)).sort();
  };

  return {
    spans: unique(
      observed.spans.map((span: ObservedSpan): string => {
        return span.name;
      }),
    ),
    metrics: unique(observed.metrics),
    /*
     * The machine the check ran on is no one's business: its name and the
     * folder the apps ran in are left out of the record.
     */
    logs: unique(
      observed.logs.map((record: ObservedLog): string => {
        return record.body
          .split(process.env["OTEL_GUIDES_WORK_DIR"] || os.tmpdir())
          .join("<work>")
          .split(os.hostname())
          .join("<host>")
          .slice(0, 120);
      }),
    ),
  };
}

// A variant's folder: "django--uwsgi".
function variantFolder(slug: string, name: string): string {
  return `${slug}--${name.toLowerCase().split(" ").join("-")}`;
}

async function verifyGuide(
  guide: OpenTelemetryGuide,
  receiver: Receiver,
  workDir: string,
  cacheDir: string,
): Promise<GuideVerificationRecord> {
  const verification: GuideVerification = guide.verification;
  const main: RunResult = await verifyRun(
    guide,
    verification,
    guide.slug,
    receiver,
    workDir,
    cacheDir,
  );

  const variants: Record<string, GuideVariantRecord> = {};

  for (const variant of verification.variants || []) {
    log(`\n${guide.slug}: ${variant.name}`);
    const result: RunResult = await verifyRun(
      guide,
      variant,
      variantFolder(guide.slug, variant.name),
      receiver,
      workDir,
      cacheDir,
    );
    variants[variant.name] = {
      observed: observedRecord(result.observed),
      packages: result.packages,
    };
  }

  // What each package exports: at run time, and in its type declarations.
  const packageExports: Record<string, Array<string>> = {};
  for (const specifier of importedPackages(guideSnippets(guide))) {
    packageExports[specifier] = Array.from(
      new Set([
        ...exportsOf(main.appDir, specifier, verification, main.env),
        ...declaredExportsOf(main.appDir, specifier),
      ]),
    ).sort();
  }

  /*
   * Go names a module's versions with a v, the page names the framework
   * without: Gin 1.12.0.
   */
  const frameworkVersion: string | undefined = verification.framework.package
    ? (
        main.packages[verification.framework.package] ||
        installedVersion(main.appDir, verification.framework.package)
      )?.replace(GO_VERSION_PREFIX, "")
    : undefined;

  return {
    checkedOn: new Date().toISOString().slice(0, 10),
    runtime:
      main.runtime || runtimeVersion(verification, main.env, main.appDir),
    packages: main.packages,
    framework: frameworkVersion
      ? `${verification.framework.name} ${frameworkVersion}`
      : verification.framework.name,
    receiver: VERIFICATION_RECEIVER,
    snippetDigest: guideSnippetDigest(guide),
    observed: observedRecord(main.observed),
    packageExports: packageExports,
    ...(Object.keys(variants).length > 0 ? { variants: variants } : {}),
  };
}

/*
 * The record as the repository's Prettier writes JSON - short arrays on one
 * line - so a run changes only what it saw, and the file passes the lint
 * that checks every changed file. As JSON.stringify writes it where the
 * repository's Prettier cannot be loaded.
 */
interface PrettierApi {
  resolveConfig: (file: string) => Promise<Record<string, unknown> | null>;
  format: (source: string, options: Record<string, unknown>) => Promise<string>;
}

async function formatRecords(text: string): Promise<string> {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const prettier: PrettierApi = require("prettier");
    const options: Record<string, unknown> =
      (await prettier.resolveConfig(VERIFICATIONS_FILE)) || {};

    return await prettier.format(text, {
      ...options,
      filepath: VERIFICATIONS_FILE,
    });
  } catch {
    return text;
  }
}

async function writeRecord(
  slug: string,
  record: GuideVerificationRecord,
): Promise<void> {
  const records: Record<string, GuideVerificationRecord> = fs.existsSync(
    VERIFICATIONS_FILE,
  )
    ? (JSON.parse(fs.readFileSync(VERIFICATIONS_FILE, "utf8")) as Record<
        string,
        GuideVerificationRecord
      >)
    : {};
  records[slug] = record;

  const sorted: Record<string, GuideVerificationRecord> = {};
  for (const key of Object.keys(records).sort()) {
    sorted[key] = records[key]!;
  }

  fs.writeFileSync(
    VERIFICATIONS_FILE,
    await formatRecords(`${JSON.stringify(sorted, null, 2)}\n`),
  );
}

async function main(): Promise<void> {
  const args: Array<string> = process.argv.slice(2);
  const wanted: Array<string> = [];
  for (let index: number = 0; index < args.length; index++) {
    if (args[index] === "--guide" && args[index + 1]) {
      wanted.push(args[index + 1]!);
      index++;
    }
  }

  const guides: Array<OpenTelemetryGuide> = OPEN_TELEMETRY_GUIDE_PAGES.filter(
    (guide: OpenTelemetryGuide): boolean => {
      return wanted.length === 0 || wanted.includes(guide.slug);
    },
  );

  if (guides.length === 0) {
    throw new Error(`No guide named ${wanted.join(", ")}`);
  }

  // OTEL_GUIDES_WORK_DIR keeps the apps somewhere of your choosing.
  const workRoot: string = process.env["OTEL_GUIDES_WORK_DIR"] || os.tmpdir();
  fs.mkdirSync(workRoot, { recursive: true });
  const workDir: string = fs.mkdtempSync(path.join(workRoot, "otel-guides-"));
  const cacheDir: string = cacheDirOf(workRoot);
  fs.mkdirSync(cacheDir, { recursive: true });
  log(`Working in ${workDir}`);
  const receiver: Receiver = await startReceiver(workDir);
  const failed: Array<string> = [];

  try {
    for (const guide of guides) {
      log(`\n${guide.slug}`);
      try {
        const record: GuideVerificationRecord = await verifyGuide(
          guide,
          receiver,
          workDir,
          cacheDir,
        );
        await writeRecord(guide.slug, record);
        log(
          `  passed: ${record.observed.spans.length} span names, ${record.observed.metrics.length} metrics, ${record.observed.logs.length} log lines`,
        );
      } catch (error) {
        failed.push(guide.slug);
        log(`  FAILED\n${String((error as Error).message || error)}`);
      }
    }
  } finally {
    stopReceiver(receiver);
  }

  if (failed.length > 0) {
    log(`\nFailed: ${failed.join(", ")}`);
    process.exit(1);
  }

  log("\nEvery guide passed.");
}

main().catch((error: Error) => {
  log(String(error.stack || error));
  process.exit(1);
});
