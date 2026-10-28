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
 *
 * OTEL_GUIDES_CONTAINER_NAME names the collector's container (and starts
 * the names of the services'), OTEL_GUIDES_WORK_DIR the folder the apps are
 * written to (the system's temporary folder otherwise), and
 * OTEL_GUIDES_CACHE_DIR where pip, Maven, Gradle and NuGet keep what they
 * download between runs. The containers are removed when the run ends.
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
  importedPackages,
  installedPackageNames,
  installedPackages,
  isBuildFileSnippet,
} from "../Utils/Integrations/OpenTelemetry/GuideCodeChecks";

const COLLECTOR_IMAGE: string = "otel/opentelemetry-collector-contrib:0.161.0";
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
            expected.hasException === record.hasException)
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
        firstLineOf(process.env["OTEL_GUIDES_DENO"] || "deno", ["--version"], env)
          .replace("deno ", "")
          .split(" ")[0]
      }`;
    case "browser":
      // "Google Chrome for Testing 153.0.8010.12" is Chrome 153.
      return process.env["OTEL_GUIDES_CHROMIUM"]
        ? firstLineOf(process.env["OTEL_GUIDES_CHROMIUM"], ["--version"], env).replace(
            "Google Chrome for Testing",
            "Chrome",
          )
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

// group:artifact tokens of a dependency report, with the version each resolved to.
const MAVEN_COORDINATE: RegExp =
  /([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):(?:jar|pom):([A-Za-z0-9_.+-]+):[a-z]+/g;
const GRADLE_COORDINATE: RegExp =
  /([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::([A-Za-z0-9_.+-]+))?(?: -> ([A-Za-z0-9_.+-]+))?/g;

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
      for (const match of fs.readFileSync(report, "utf8").matchAll(MAVEN_COORDINATE)) {
        versions[`${match[1]}:${match[2]}`] = match[3]!;
      }
    }

    for (const dependency of buildFileDependencies({
      id: "pom",
      language: "xml",
      title: "pom.xml",
      code: fs.readFileSync(path.join(appDir, "pom.xml"), "utf8"),
      check: "parse",
    })) {
      if (dependency.version && !versions[dependency.name]) {
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
        { cwd: appDir, env: env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );

      for (const match of (result.stdout || "").matchAll(GRADLE_COORDINATE)) {
        const resolved: string | undefined = match[4] || match[3];

        if (!resolved || !match[1]!.includes(".")) {
          continue;
        }

        // A plugin's marker artifact: io.ktor.plugin:io.ktor.plugin.gradle.plugin.
        const name: string = match[2]!.endsWith(".gradle.plugin")
          ? match[1]!
          : `${match[1]}:${match[2]}`;
        versions[name] = resolved;
      }
    }
  }

  const agent: string = path.join(appDir, "opentelemetry-javaagent.jar");

  if (fs.existsSync(agent)) {
    versions[JAVA_AGENT_PACKAGE] = firstLineOf("java", ["-jar", agent], env);
  }

  return versions;
}

// What a .NET restore resolved: obj/project.assets.json's packages.
function dotnetVersions(appDir: string): Record<string, string> {
  const versions: Record<string, string> = {};
  const assets: Array<string> = [];
  const look: (directory: string, depth: number) => void = (
    directory: string,
    depth: number,
  ): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isFile() && entry.name === "project.assets.json") {
        assets.push(full);
      } else if (entry.isDirectory() && depth < 3 && entry.name !== "node_modules") {
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
        prependPath(env, path.join(process.env["OTEL_GUIDES_JAVA_HOME"], "bin"));
      }
      for (const variable of ["OTEL_GUIDES_MAVEN_BIN", "OTEL_GUIDES_GRADLE_BIN"]) {
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
    default:
      break;
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
          `${logs.stdout || ""}${logs.stderr || ""}`.split(service.readyLog.text)
            .length -
            1 >=
          service.readyLog.times;

        if (!isReady) {
          await sleep(500);
        }
      }

      if (!isReady) {
        throw new Error(`${service.name} never logged "${service.readyLog.text}"`);
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
 * A command run to its end, without blocking: the receiver and the
 * stand-in API answer from this same process, so a command that runs while
 * a server calls them - a script queuing tasks for a worker - must not
 * hold the event loop.
 */
function runCommand(
  text: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve: (result: CommandResult) => void) => {
    const child: ChildProcess = spawn("bash", ["-c", text], {
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
  server: ChildProcess,
  output: Array<string>,
): Promise<void> {
  if (!server.pid) {
    return;
  }

  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // Already gone.
  }

  const exited: boolean = await new Promise(
    (resolve: (exited: boolean) => void) => {
      const timer: NodeJS.Timeout = setTimeout(() => {
        resolve(false);
      }, 25000);
      server.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
      if (server.exitCode !== null || server.signalCode !== null) {
        clearTimeout(timer);
        resolve(true);
      }
    },
  );

  if (!exited) {
    output.push("\n[the app did not stop within 25 seconds of SIGTERM]\n");
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
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
    if (file.content && (file.path.endsWith("pom.xml") || file.path.endsWith(".csproj") || file.path.endsWith(".gradle.kts"))) {
      for (const dependency of buildFileDependencies({
        id: file.path,
        language: file.path.endsWith(".gradle.kts") ? "kotlin" : "xml",
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
      resolved = dotnetVersions(appDir);
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

interface RunResult {
  observed: Observed;
  packages: Record<string, string>;
  env: NodeJS.ProcessEnv;
  appDir: string;
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
  const servers: Array<ChildProcess> = [];
  const containerBase: string =
    process.env["OTEL_GUIDES_CONTAINER_NAME"] ||
    `oneuptime-otel-guides-${process.pid}`;
  let containers: Array<string> = [];
  let staticServer: http.Server | null = null;
  let stubApi: http.Server | null = null;
  const output: Array<string> = [];

  try {
    if (run.services && run.services.length > 0) {
      const started: { containers: Array<string>; env: Record<string, string> } =
        await startServices(run.services, containerBase);
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
        // Its own process group, so stopping it reaches every process it starts.
        const server: ChildProcess = spawn("bash", ["-c", text], {
          cwd: appDir,
          env: commandEnv,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        server.stdout?.on("data", (chunk: Buffer) => {
          output.push(chunk.toString());
        });
        server.stderr?.on("data", (chunk: Buffer) => {
          output.push(chunk.toString());
        });
        servers.push(server);

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
      const result: CommandResult = await runCommand(text, appDir, commandEnv);

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
    packages: recordedVersions(guide, run, appDir, env),
    env: env,
    appDir: appDir,
  };
}

function observedRecord(observed: Observed): GuideVerificationRecord["observed"] {
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

  const frameworkVersion: string | undefined = verification.framework.package
    ? main.packages[verification.framework.package] ||
      installedVersion(main.appDir, verification.framework.package)
    : undefined;

  return {
    checkedOn: new Date().toISOString().slice(0, 10),
    runtime: runtimeVersion(verification, main.env, main.appDir),
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

function writeRecord(slug: string, record: GuideVerificationRecord): void {
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

  fs.writeFileSync(VERIFICATIONS_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
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
        writeRecord(guide.slug, record);
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
