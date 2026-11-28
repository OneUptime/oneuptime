import ProbeIngestMonitorAPI from "../../../FeatureSet/Telemetry/API/ProbeIngest/Monitor";
import { ProbeExpressRequest } from "../../../FeatureSet/Telemetry/Types/Request";
import Probe from "Common/Models/DatabaseModels/Probe";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Express, {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ProbeSchedulingLimiterInstance from "Common/Server/Utils/Probe/ProbeSchedulingLimiter";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import fs from "fs";
import http from "http";
import inspector from "inspector";
import { AddressInfo } from "net";
import path from "path";
import { IntervalHistogram, monitorEventLoopDelay } from "perf_hooks";

/*
 * ONE APP REPLICA OF THE PROBE DISPATCH BENCHMARK (issue #10819).
 *
 * A child process ProbeDispatchHarness starts once per App replica: the
 * real probe-ingest Monitor router (/monitor/list, /monitor-test/list,
 * /monitor/pending-count) behind the real probe scheduling limit, on the
 * real services, over a Postgres pool of DATABASE_MAX_OPEN_CONNECTIONS as
 * an App pod has. Its connections read the benchmark's own schema first
 * (search_path, from PGOPTIONS), so the claim statements read the copied
 * tables. The probe's key is taken as checked: the key check runs before
 * the limit and holds no slot, and a request that names its probe
 * (req.probe) is not checked again (ProbeAuthorization).
 *
 * Where the time goes, measured from inside: each statement by kind, as
 * the pool's client sends it and reads its answer; the wait for a pool
 * connection; the wait for a scheduling slot; each request from its arrival
 * to its answer; the event loop's delay and the process's CPU. The harness
 * asks for them over IPC ("stats"), clears them ("reset"), and has the
 * process CPU-profiled ("profile-start", "profile-stop").
 */

interface Timing {
  count: number;
  totalMs: number;
  maxMs: number;
  // Every sample, for percentiles; a run has at most a few hundred thousand.
  samples: Array<number>;
}

export interface TimingSummary {
  count: number;
  totalMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface AppReplicaStats {
  replica: number;
  statements: Record<string, TimingSummary>;
  poolWait: TimingSummary;
  slotWait: TimingSummary;
  requests: Record<string, TimingSummary>;
  answers: Record<string, number>;
  slotRefusals: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  eventLoopDelayP99Ms: number;
  eventLoopDelayMaxMs: number;
  elapsedMs: number;
  metrics: JSONObject | null;
}

/*
 * What a replica is doing at one moment (issue #11121): the probe
 * scheduling work lane's requests running and waiting, the monitor
 * fetches it has answered and the connections it has accepted since it
 * started, the connections it holds open, and the answers it sent with
 * "Connection: close".
 */
export interface AppReplicaSample {
  replica: number;
  running: number;
  waiting: number;
  monitorListAnswered: number;
  connectionsAccepted: number;
  connectionsOpen: number;
  closingAnswers: number;
}

export type AppReplicaMessage =
  | { type: "stats"; id: number }
  | { type: "sample"; id: number }
  | { type: "reset" }
  | { type: "profile-start" }
  | { type: "profile-stop"; file: string }
  | { type: "stop" };

const REPLICA: number = Number(process.env["PROBE_DISPATCH_REPLICA"] || "0");
const STATEMENT_LATENCY_MS: number = Number(
  process.env["PROBE_DISPATCH_STATEMENT_LATENCY_MS"] || "0",
);
const BUSY_PERCENT: number = Math.min(
  90,
  Number(process.env["PROBE_DISPATCH_BUSY_PERCENT"] || "0"),
);

const timings: Map<string, Timing> = new Map<string, Timing>();
const answers: Map<string, number> = new Map<string, number>();
let slotRefusals: number = 0;
// Since the process started, for samples: never reset.
let monitorListAnswered: number = 0;
let connectionsAccepted: number = 0;
let closingAnswers: number = 0;
let cpuAtReset: NodeJS.CpuUsage = process.cpuUsage();
let resetAt: number = Date.now();
const eventLoopDelay: IntervalHistogram = monitorEventLoopDelay({
  resolution: 10,
});
eventLoopDelay.enable();

function record(name: string, ms: number): void {
  let timing: Timing | undefined = timings.get(name);

  if (!timing) {
    timing = { count: 0, totalMs: 0, maxMs: 0, samples: [] };
    timings.set(name, timing);
  }

  timing.count++;
  timing.totalMs += ms;
  timing.maxMs = Math.max(timing.maxMs, ms);
  timing.samples.push(ms);
}

function percentile(sorted: Array<number>, fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ]!;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarize(name: string): TimingSummary {
  const timing: Timing | undefined = timings.get(name);

  if (!timing || timing.count === 0) {
    return {
      count: 0,
      totalMs: 0,
      meanMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
    };
  }

  const sorted: Array<number> = timing.samples
    .slice()
    .sort((a: number, b: number): number => {
      return a - b;
    });

  return {
    count: timing.count,
    totalMs: round(timing.totalMs),
    meanMs: round(timing.totalMs / timing.count),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(timing.maxMs),
  };
}

function summarizeAll(prefix: string): Record<string, TimingSummary> {
  const result: Record<string, TimingSummary> = {};

  for (const name of Array.from(timings.keys()).sort()) {
    if (name.startsWith(prefix)) {
      result[name.substring(prefix.length)] = summarize(name);
    }
  }

  return result;
}

// What kind of statement `text` is: the dispatch path's, by a phrase of each.
export function statementKind(text: string): string {
  if (text.includes(`WITH "claimable"`)) {
    return "monitor claim";
  }

  if (text.includes(`WITH "steppedOver"`)) {
    return "monitor set-aside";
  }

  if (text.includes(`m."monitoringInterval"`) && text.includes("LIMIT $3")) {
    return "monitor candidates";
  }

  if (text.includes(`WITH "pending"`) && text.includes(`"MonitorTest"`)) {
    return "monitor test claim";
  }

  if (text.includes(`AS "pending"`)) {
    return "pending count";
  }

  if (text.includes(`FROM "MonitorProbe"`)) {
    return "monitor read (findBy)";
  }

  if (text.includes(`FROM "MonitorTest"`)) {
    return "monitor test read (findBy)";
  }

  if (text.includes(`"MonitorSecret"`)) {
    return "secrets";
  }

  return "other";
}

interface QueryableClient {
  prototype: {
    query: (...args: Array<unknown>) => unknown;
  };
}

/*
 * Times every statement the pool's clients send, from the call to its
 * answer: a client runs one at a time, so this is the database's time plus
 * the round trip, never another statement's.
 */
function timeStatements(): void {
  const options: { extra?: { Client?: QueryableClient } } =
    PostgresAppInstance.getDataSource()!.options as {
      extra?: { Client?: QueryableClient };
    };
  const client: QueryableClient | undefined = options.extra?.Client;

  if (!client) {
    return;
  }

  const original: (...args: Array<unknown>) => unknown = client.prototype.query;

  client.prototype.query = function (
    this: unknown,
    ...args: Array<unknown>
  ): unknown {
    const first: unknown = args[0];
    const text: string =
      typeof first === "string"
        ? first
        : String((first as { text?: string } | null)?.text || "");
    const startedAt: number = performance.now();
    const usesCallback: boolean = typeof args[args.length - 1] === "function";

    /*
     * A database busier than this one: each statement's answer comes
     * STATEMENT_LATENCY_MS later, its connection held meanwhile.
     */
    const result: unknown =
      STATEMENT_LATENCY_MS > 0 && !usesCallback
        ? new Promise<void>((resolve: () => void): void => {
            setTimeout(resolve, STATEMENT_LATENCY_MS);
          }).then((): unknown => {
            return original.apply(this, args);
          })
        : original.apply(this, args);

    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).finally((): void => {
        record(
          `statement:${statementKind(text)}`,
          performance.now() - startedAt,
        );
      });
    }

    return result;
  };
}

/*
 * An App busier than this one: of every 100 ms, BUSY_PERCENT go to other
 * work on the event loop - the probe results, telemetry and jobs an App pod
 * also handles - done here as JSON round trips of a monitor log.
 */
function keepBusy(): void {
  if (BUSY_PERCENT <= 0) {
    return;
  }

  const sample: string = JSON.stringify({
    monitorStepId: ObjectID.generate().toString(),
    responseBody: "x".repeat(2048),
    responseHeaders: { "content-type": "text/html", server: "benchmark" },
    responseTimeInMs: 123,
    isOnline: true,
  });

  setInterval((): void => {
    const until: number = performance.now() + BUSY_PERCENT;

    while (performance.now() < until) {
      JSON.parse(sample);
    }
  }, 100).unref();
}

interface PoolOwner {
  obtainMasterConnection: () => Promise<unknown>;
}

// Times the wait for a pool connection (TypeORM's driver asks pg-pool).
function timePoolWaits(): void {
  const driver: PoolOwner = PostgresAppInstance.getDataSource()!
    .driver as unknown as PoolOwner;
  const original: () => Promise<unknown> = driver.obtainMasterConnection;

  driver.obtainMasterConnection = async function (
    this: unknown,
  ): Promise<unknown> {
    const startedAt: number = performance.now();

    try {
      return await original.apply(this);
    } finally {
      record("pool-wait", performance.now() - startedAt);
    }
  };
}

// Times the wait for a scheduling slot, and counts the refusals.
function timeSlotWaits(): void {
  const limiter: { acquire: (...args: Array<unknown>) => Promise<unknown> } =
    ProbeSchedulingLimiterInstance as unknown as {
      acquire: (...args: Array<unknown>) => Promise<unknown>;
    };
  const original: (...args: Array<unknown>) => Promise<unknown> =
    limiter.acquire.bind(ProbeSchedulingLimiterInstance);

  limiter.acquire = async (...args: Array<unknown>): Promise<unknown> => {
    const startedAt: number = performance.now();

    try {
      return await original(...args);
    } catch (error) {
      slotRefusals++;
      throw error;
    } finally {
      record("slot-wait", performance.now() - startedAt);
    }
  };
}

// The inspector's profiler, as the grouped metric benchmark uses it.
class ReplicaProfiler {
  private session: inspector.Session | null = null;

  private post<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return new Promise<T>(
      (resolve: (value: T) => void, reject: (error: Error) => void): void => {
        this.session!.post(
          method,
          params || {},
          (error: Error | null, result?: unknown): void => {
            if (error) {
              reject(error);
              return;
            }

            resolve(result as T);
          },
        );
      },
    );
  }

  public async start(): Promise<void> {
    this.session = new inspector.Session();
    this.session.connect();
    await this.post("Profiler.enable");
    await this.post("Profiler.setSamplingInterval", { interval: 500 });
    await this.post("Profiler.start");
  }

  public async stop(file: string): Promise<void> {
    if (!this.session) {
      return;
    }

    const result: { profile: unknown } = await this.post<{
      profile: unknown;
    }>("Profiler.stop");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result.profile));
    this.session.disconnect();
    this.session = null;
  }
}

function stats(metrics: JSONObject | null): AppReplicaStats {
  const cpu: NodeJS.CpuUsage = process.cpuUsage(cpuAtReset);

  return {
    replica: REPLICA,
    statements: summarizeAll("statement:"),
    poolWait: summarize("pool-wait"),
    slotWait: summarize("slot-wait"),
    requests: summarizeAll("request:"),
    answers: Object.fromEntries(answers.entries()),
    slotRefusals: slotRefusals,
    cpuUserMs: Math.round(cpu.user / 1000),
    cpuSystemMs: Math.round(cpu.system / 1000),
    eventLoopDelayP99Ms: round(eventLoopDelay.percentile(99) / 1e6),
    eventLoopDelayMaxMs: round(eventLoopDelay.max / 1e6),
    elapsedMs: Date.now() - resetAt,
    metrics: metrics,
  };
}

function reset(): void {
  timings.clear();
  answers.clear();
  slotRefusals = 0;
  cpuAtReset = process.cpuUsage();
  resetAt = Date.now();
  eventLoopDelay.reset();
}

/*
 * This replica's probe scheduling metrics (ProbeSchedulingMetrics, issue
 * #10819), when the code it runs has them. The benchmark also runs code
 * from before them (a baseline), so they are looked up, not imported.
 */
function readSchedulingMetrics(): JSONObject | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const metricsModule: {
      default?: { snapshot?: () => unknown };
    } = require("Common/Server/Utils/Probe/ProbeSchedulingMetrics");
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const snapshot: unknown = metricsModule.default?.snapshot?.();
    return snapshot ? (snapshot as JSONObject) : null;
  } catch {
    return null;
  }
}

/*
 * The scheduling metrics this replica keeps, or serves: from the process,
 * or read from its own metrics endpoint, as an operator's scraper would.
 */
async function readMetrics(origin: string): Promise<JSONObject | null> {
  const own: JSONObject | null = readSchedulingMetrics();

  if (own) {
    return own;
  }

  const metricsPath: string | undefined =
    process.env["PROBE_DISPATCH_METRICS_PATH"];

  if (!metricsPath) {
    return null;
  }

  try {
    const response: globalThis.Response = await fetch(
      `${origin}${metricsPath}`,
    );
    return response.ok ? ((await response.json()) as JSONObject) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  await PostgresAppInstance.connect();

  timeStatements();
  timePoolWaits();
  timeSlotWaits();
  keepBusy();

  const app: ExpressApplication = Express.getExpressApp();

  app.use(ExpressJson({ limit: "10mb" }));

  app.use(
    (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
      const startedAt: number = performance.now();
      const route: string = req.path;

      res.once("finish", (): void => {
        record(`request:${route}`, performance.now() - startedAt);
        const answer: string = `${route} ${res.statusCode}`;
        answers.set(answer, (answers.get(answer) || 0) + 1);

        if (route === "/probe-ingest/monitor/list") {
          monitorListAnswered++;
        }

        if (
          String(res.getHeader("connection") || "").toLowerCase() === "close"
        ) {
          closingAnswers++;
        }
      });

      // The probe's key, as checked: see the comment at the top.
      const probeId: unknown = (req.body as JSONObject | undefined)?.[
        "probeId"
      ];

      if (typeof probeId === "string" && probeId) {
        (req as ProbeExpressRequest).probe = new Probe(new ObjectID(probeId));
      }

      next();
    },
  );

  /*
   * A probe's check result, which the probe sends on the connections it
   * asks for work on (ProbeDispatchProbes, postResults): answered at once.
   * Storing it is not what the benchmark measures.
   */
  app.post(
    "/probe-ingest/probe/response/ingest",
    (_req: ExpressRequest, res: ExpressResponse): void => {
      res.status(200).send({});
    },
  );

  app.use(["/probe-ingest"], ProbeIngestMonitorAPI);

  const server: http.Server = http.createServer(app);
  // As the App's own server keeps a connection (Common/Server/Utils/Express).
  server.keepAliveTimeout = 75_000;
  server.headersTimeout = 76_000;
  server.on("connection", (): void => {
    connectionsAccepted++;
  });

  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (server.address() as AddressInfo).port;
  const origin: string = `http://127.0.0.1:${port}`;
  const profiler: ReplicaProfiler = new ReplicaProfiler();

  process.on("message", (message: AppReplicaMessage): void => {
    const answer: (reply: unknown) => void = (reply: unknown): void => {
      if (process.send) {
        process.send(reply);
      }
    };

    switch (message.type) {
      case "sample":
        server.getConnections((_error: Error | null, open: number): void => {
          const sample: AppReplicaSample = {
            replica: REPLICA,
            running: ProbeSchedulingLimiterInstance.runningCount(),
            waiting: ProbeSchedulingLimiterInstance.waitingCount(),
            monitorListAnswered: monitorListAnswered,
            connectionsAccepted: connectionsAccepted,
            connectionsOpen: open || 0,
            closingAnswers: closingAnswers,
          };
          answer({ type: "sample", id: message.id, sample: sample });
        });
        return;
      case "stats":
        readMetrics(origin)
          .then((metrics: JSONObject | null): void => {
            answer({ type: "stats", id: message.id, stats: stats(metrics) });
          })
          .catch((): void => {
            answer({ type: "stats", id: message.id, stats: stats(null) });
          });
        return;
      case "reset":
        reset();
        answer({ type: "reset-done" });
        return;
      case "profile-start":
        profiler
          .start()
          .then((): void => {
            answer({ type: "profile-started" });
          })
          .catch((): void => {
            answer({ type: "profile-started" });
          });
        return;
      case "profile-stop":
        profiler
          .stop(message.file)
          .then((): void => {
            answer({ type: "profile-stopped" });
          })
          .catch((): void => {
            answer({ type: "profile-stopped" });
          });
        return;
      case "stop":
        server.closeAllConnections();
        server.close();
        PostgresAppInstance.disconnect()
          .catch((): void => {
            // Leaving anyway.
          })
          .finally((): void => {
            process.exit(0);
          });
        return;
    }
  });

  if (process.send) {
    process.send({ type: "ready", port: port });
  }
}

main().catch((error: unknown): void => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exit(1);
});
