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
 *   - Docker, for the collector (otel/opentelemetry-collector-contrib).
 *   - Node.js 22.15 or later for the Node.js guides: the one on PATH, or
 *     OTEL_GUIDES_NODE_BIN, a folder holding node, npm and npx.
 *   - OTEL_GUIDES_BUN and OTEL_GUIDES_DENO, the binaries, for those guides.
 *   - Chromium as Common's Playwright installs it, for the browser guides,
 *     or OTEL_GUIDES_CHROMIUM, the path of another Chromium to launch.
 *
 * OTEL_GUIDES_CONTAINER_NAME names the collector's container, and
 * OTEL_GUIDES_WORK_DIR the folder the apps are written to (the system's
 * temporary folder otherwise). The container is removed when the run ends.
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
  OpenTelemetryGuide,
  VerificationCommand,
  VerificationRequest,
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
  GuideVerificationRecord,
  VERIFICATIONS_FILE,
  guideSnippetDigest,
} from "../Utils/Integrations/OpenTelemetry/GuideVerifications";
import { OPEN_TELEMETRY_GUIDE_PAGES } from "../Utils/Integrations/OpenTelemetry/OpenTelemetryGuides";
import {
  importedPackages,
  installedPackageNames,
} from "../Utils/Integrations/OpenTelemetry/GuideCodeChecks";

const COLLECTOR_IMAGE: string = "otel/opentelemetry-collector-contrib:0.161.0";
const TEST_KEY: string = "otel-guides-test-key";
const COMMON: string = path.join(__dirname, "..", "..", "Common");

// Short export intervals, so a run takes seconds; the semantics are the SDKs' own.
const FAST_EXPORT: Record<string, string> = {
  OTEL_METRIC_EXPORT_INTERVAL: "2000",
  OTEL_BSP_SCHEDULE_DELAY: "500",
  OTEL_BLRP_SCHEDULE_DELAY: "500",
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
  verification: GuideVerification,
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

function runtimeVersion(
  verification: GuideVerification,
  env: NodeJS.ProcessEnv,
): string {
  const version: (command: string, args: Array<string>) => string = (
    command: string,
    args: Array<string>,
  ): string => {
    const result: SpawnSyncReturns<string> = spawnSync(command, args, {
      encoding: "utf8",
      env: env,
    });
    return (result.stdout || "").trim().split("\n")[0] || "";
  };

  switch (verification.runtime) {
    case "bun":
      return `Bun ${version(process.env["OTEL_GUIDES_BUN"] || "bun", ["--version"])}`;
    case "deno":
      return `Deno ${
        version(process.env["OTEL_GUIDES_DENO"] || "deno", ["--version"])
          .replace("deno ", "")
          .split(" ")[0]
      }`;
    case "browser":
      // "Google Chrome for Testing 153.0.8010.12" is Chrome 153.
      return process.env["OTEL_GUIDES_CHROMIUM"]
        ? version(process.env["OTEL_GUIDES_CHROMIUM"], ["--version"]).replace(
            "Google Chrome for Testing",
            "Chrome",
          )
        : "Chromium, as Common's Playwright installs it";
    default:
      return `Node.js ${version("node", ["--version"]).replace("v", "")}`;
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

async function verifyGuide(
  guide: OpenTelemetryGuide,
  receiver: Receiver,
  workDir: string,
): Promise<GuideVerificationRecord> {
  const verification: GuideVerification = guide.verification;
  const appDir: string = path.join(workDir, guide.slug);
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  for (const file of verification.files) {
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

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.env["OTEL_GUIDES_NODE_BIN"]) {
    env["PATH"] =
      `${process.env["OTEL_GUIDES_NODE_BIN"]}${path.delimiter}${env["PATH"] || ""}`;
  }
  for (const [name, value] of Object.entries(
    environmentOf(findGuideSnippet(guide, "env-cloud")),
  )) {
    env[name] = forLocalRun(value, receiver.proxyPort);
  }
  Object.assign(env, FAST_EXPORT);
  if (process.env["OTEL_GUIDES_BUN"]) {
    env["PATH"] =
      `${path.dirname(process.env["OTEL_GUIDES_BUN"])}${path.delimiter}${env["PATH"]}`;
  }
  if (process.env["OTEL_GUIDES_DENO"]) {
    env["PATH"] =
      `${path.dirname(process.env["OTEL_GUIDES_DENO"])}${path.delimiter}${env["PATH"]}`;
    env["DENO_DIR"] = path.join(workDir, "deno-cache");
  }

  const before: Record<string, number> = fileSizes(receiver.outDir);
  const requestCountBefore: number = receiver.requests.length;
  let server: ChildProcess | null = null;
  let staticServer: http.Server | null = null;
  const output: Array<string> = [];

  try {
    for (const command of verification.commands) {
      const text: string = forLocalRun(
        commandText(guide, command),
        receiver.proxyPort,
      );

      if (command.isServer) {
        log(`  $ ${text} &`);
        // Its own process group, so stopping it reaches every process it starts.
        server = spawn("bash", ["-c", text], {
          cwd: appDir,
          env: env,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        server.stdout?.on("data", (chunk: Buffer) => {
          output.push(chunk.toString());
        });
        server.stderr?.on("data", (chunk: Buffer) => {
          output.push(chunk.toString());
        });
        continue;
      }

      log(`  $ ${text}`);
      const result: SpawnSyncReturns<string> = spawnSync("bash", ["-c", text], {
        cwd: appDir,
        env: env,
        encoding: "utf8",
        timeout: 15 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
      });

      if (result.status !== 0) {
        throw new Error(
          `${guide.slug}: \`${text}\` failed:\n${(result.stdout || "").slice(-2000)}\n${(result.stderr || "").slice(-4000)}`,
        );
      }
    }

    if (verification.serve) {
      staticServer = await serveStatic(
        path.join(appDir, verification.serve),
        verification.port,
      );
    }

    if (!(await waitForPort(verification.port, 180000))) {
      throw new Error(
        `${guide.slug}: nothing listened on ${verification.port}:\n${output.join("").slice(-4000)}`,
      );
    }
    await sleep(1000);

    for (const request of verification.requests) {
      log(`  ${await sendRequest(verification.port, request)}`);
    }

    if (verification.runtime === "browser") {
      const messages: Array<string> = await driveBrowser(
        `http://127.0.0.1:${verification.port}/`,
        verification.clicks || [],
      );
      for (const message of messages) {
        log(`  ${message}`);
      }
    }

    await sleep(4000);
  } finally {
    if (server && server.pid) {
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
          server!.once("exit", () => {
            clearTimeout(timer);
            resolve(true);
          });
          if (server!.exitCode !== null) {
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
    if (staticServer) {
      staticServer.close();
    }
  }

  // The collector writes its files once a second.
  await sleep(3000);

  const observed: Observed = collect(receiver.outDir, before);
  const failures: Array<string> = check(verification, observed);
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
      `${guide.slug} failed:\n  - ${failures.join("\n  - ")}\n\nApp output:\n${output.join("").slice(-6000)}`,
    );
  }

  const packages: Record<string, string> = {};
  const commandsText: string = verification.commands
    .map((command: VerificationCommand): string => {
      return commandText(guide, command);
    })
    .join("\n");
  for (const packageName of installedPackageNames(commandsText)) {
    const version: string | undefined = installedVersion(appDir, packageName);
    if (version) {
      packages[packageName] = version;
    }
  }

  // What each package exports: at run time, and in its type declarations.
  const packageExports: Record<string, Array<string>> = {};
  for (const specifier of importedPackages(guideSnippets(guide))) {
    packageExports[specifier] = Array.from(
      new Set([
        ...exportsOf(appDir, specifier, verification, env),
        ...declaredExportsOf(appDir, specifier),
      ]),
    ).sort();
  }

  const frameworkVersion: string | undefined = verification.framework.package
    ? packages[verification.framework.package] ||
      installedVersion(appDir, verification.framework.package)
    : undefined;

  const unique: (values: Array<string>) => Array<string> = (
    values: Array<string>,
  ): Array<string> => {
    return Array.from(new Set(values)).sort();
  };

  return {
    checkedOn: new Date().toISOString().slice(0, 10),
    runtime: runtimeVersion(verification, env),
    packages: packages,
    framework: frameworkVersion
      ? `${verification.framework.name} ${frameworkVersion}`
      : verification.framework.name,
    receiver: VERIFICATION_RECEIVER,
    snippetDigest: guideSnippetDigest(guide),
    observed: {
      spans: unique(
        observed.spans.map((span: ObservedSpan): string => {
          return span.name;
        }),
      ),
      metrics: unique(observed.metrics),
      logs: unique(
        observed.logs.map((record: ObservedLog): string => {
          return record.body.slice(0, 120);
        }),
      ),
    },
    packageExports: packageExports,
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
