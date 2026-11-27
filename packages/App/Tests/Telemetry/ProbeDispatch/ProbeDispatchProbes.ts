import ProbeCapability from "Common/Types/Probe/ProbeCapability";
// One seeded stream, so two runs ask alike.
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";
import http from "http";

/*
 * THE PROBES OF THE PROBE DISPATCH BENCHMARK (issue #10819).
 *
 * Every replica of every probe, asking the App replicas for work the way the
 * probe's own jobs do - packages/Probe/Jobs/Monitor/FetchList.ts and
 * FetchMonitorTest.ts, which this mirrors and must keep mirroring:
 *
 *   - monitors: at every minute (and at start), each of `workers` workers
 *     that is not still fetching waits a random 0..staggerMaxMs, then asks
 *     /monitor/list for as many monitors as it has room for (at most
 *     `fetchLimit`, at least half of it: MonitorCheckSlots), starts a check
 *     of each, and asks again while it is handed a full batch. A short batch
 *     means nothing more is due: the worker waits for the next minute. A
 *     busy answer (429) makes every worker of the replica wait the answer's
 *     Retry-After (ServerBusy); any other failure ends the worker's minute.
 *   - monitor tests: every ten seconds (and at start), unless the last
 *     fetch is still in flight or the server asked it to wait, the replica
 *     asks /monitor-test/list for up to 100 tests.
 *
 * A check is a timer of checkMs (uniform between its bounds): the benchmark
 * measures handing monitors out, not checking them. Each request goes to an
 * App replica picked at random, as a Kubernetes Service spreads new
 * connections.
 *
 * Or, with `keepAliveOrigin` (issue #11121), every request goes to that one
 * origin - a Service's cluster IP (ConnectionBalancer), or an nginx in front
 * of it - over connections kept alive as a probe keeps them: each replica
 * has an http.Agent of its own with the settings of Node's global agent,
 * which the probe's HTTP client uses (keep-alive, the most recently freed
 * socket first, a free socket closed after 5 s). With `postResults`, each
 * check sends its result before giving its slot back, as the probe's
 * monitor jobs do, on the same connections.
 */

export interface SimulatedProbeFleetOptions {
  probeIds: Array<string>;
  replicasPerProbe: number;
  // PROBE_MONITORING_WORKERS.
  workersPerReplica: number;
  // PROBE_MONITOR_FETCH_LIMIT.
  fetchLimit: number;
  checkMs: { min: number; max: number };
  // MONITOR_FETCH_STAGGER_MAX_MS (45 s in the probe); 0 starts at once.
  staggerMaxMs: number;
  appOrigins: Array<string>;
  /*
   * The one origin every request goes to, over kept-alive connections, in
   * place of an App replica picked per request; null: per request.
   */
  keepAliveOrigin?: string | null | undefined;
  // Whether each check sends its result, as the probe's monitor jobs do.
  postResults?: boolean | undefined;
  // The probe's API timeout (PROBE_API_REQUEST_TIMEOUT_IN_MS).
  requestTimeoutMs: number;
  testPollEveryMs: number;
  // Seeds the stagger, the checks' durations and the App replica picked.
  seed: number;
}

export interface FetchRecord {
  at: number;
  ms: number;
  probe: number;
  replica: number;
  // "ok", "busy" (429), "error" (anything else), "timeout".
  outcome: string;
  asked: number;
  handed: number;
}

export interface TestHandOut {
  testId: string;
  at: number;
}

export const PROBE_FLEET_CAPABILITIES: Array<string> = [
  ProbeCapability.NetworkDevicePing,
  ProbeCapability.SnmpTables,
  ProbeCapability.SnmpWalk,
  ProbeCapability.DataSecurityScan,
  ProbeCapability.DataObservabilityCollect,
  ProbeCapability.RetryWhenBusy,
  ProbeCapability.RetryAllWorkWhenBusy,
  ProbeCapability.TotpCodes,
  ProbeCapability.AnyRequestBody,
  ProbeCapability.HideSecretValuesInLogs,
];

// The probe's own default wait after a busy answer with no Retry-After.
const DEFAULT_BUSY_BACK_OFF_MS: number = 10_000;
const MAX_BUSY_BACK_OFF_MS: number = 60_000;
const MONITOR_TEST_FETCH_LIMIT: number = 100;
const MINUTE_MS: number = 60_000;

/*
 * Node's global agent, which a probe's HTTP client sends on when no proxy
 * is set (Node 19 and later): connections kept alive, the most recently
 * freed one used first, one left free for 5 s closed.
 */
export const PROBE_AGENT_OPTIONS: http.AgentOptions = {
  keepAlive: true,
  scheduling: "lifo",
  timeout: 5000,
};

// A check's result, as sent: a monitor log of a couple of kilobytes.
const RESULT_BODY: string = JSON.stringify({
  isOnline: true,
  responseTimeInMs: 123,
  responseBody: "x".repeat(2048),
});

// MonitorCheckSlots, as the probe has it.
class CheckSlots {
  private inUse: number = 0;
  private waiters: Array<{
    want: number;
    atLeast: number;
    resolve: (taken: number) => void;
  }> = [];

  public constructor(private capacity: number) {}

  public free(): number {
    return Math.max(0, this.capacity - this.inUse);
  }

  public reserve(want: number, atLeast: number): Promise<number> {
    const enough: number = Math.min(want, this.capacity, Math.max(1, atLeast));

    if (this.waiters.length === 0 && this.free() >= enough) {
      const taken: number = Math.min(want, this.free());
      this.inUse += taken;
      return Promise.resolve(taken);
    }

    return new Promise<number>((resolve: (taken: number) => void): void => {
      this.waiters.push({ want, atLeast: enough, resolve });
    });
  }

  public take(count: number): void {
    this.inUse += count;
  }

  public release(count: number): void {
    if (count <= 0) {
      return;
    }

    this.inUse = Math.max(0, this.inUse - count);

    while (this.waiters.length > 0) {
      const first: {
        want: number;
        atLeast: number;
        resolve: (taken: number) => void;
      } = this.waiters[0]!;

      if (this.free() < first.atLeast) {
        return;
      }

      this.waiters.shift();
      const taken: number = Math.min(first.want, this.free());
      this.inUse += taken;
      first.resolve(taken);
    }
  }

  public drain(): void {
    this.inUse = 0;

    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve(0);
    }
  }
}

interface Answer {
  outcome: string;
  retryAfterMs: number | null;
  items: Array<{ _id?: unknown }>;
}

class SimulatedProbeReplica {
  private slots: CheckSlots;
  private workersFetching: Set<number> = new Set<number>();
  private backOffUntil: Map<string, number> = new Map<string, number>();
  private testFetchInFlight: boolean = false;
  private stopped: boolean = false;
  private timers: Set<ReturnType<typeof setTimeout>> = new Set<
    ReturnType<typeof setTimeout>
  >();

  public constructor(
    private fleet: SimulatedProbeFleet,
    private probe: number,
    private replica: number,
  ) {
    this.slots = new CheckSlots(
      fleet.options.workersPerReplica * fleet.options.fetchLimit,
    );
  }

  public stop(): void {
    this.stopped = true;

    for (const timer of this.timers) {
      clearTimeout(timer);
    }

    this.timers.clear();
    this.slots.drain();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }

  // The minute's tick: every worker that is not still fetching starts.
  public onMinute(): void {
    for (
      let worker: number = 1;
      worker <= this.fleet.options.workersPerReplica;
      worker++
    ) {
      if (this.workersFetching.has(worker)) {
        continue;
      }

      this.workersFetching.add(worker);

      this.runWorker()
        .catch((): void => {
          // A worker's failure ends its minute, as the probe's does.
        })
        .finally((): void => {
          this.workersFetching.delete(worker);
        });
    }
  }

  private isBackingOff(work: string): boolean {
    const until: number | undefined = this.backOffUntil.get(work);

    if (until === undefined) {
      return false;
    }

    if (Date.now() >= until) {
      this.backOffUntil.delete(work);
      return false;
    }

    return true;
  }

  private async runWorker(): Promise<void> {
    const options: SimulatedProbeFleetOptions = this.fleet.options;

    if (options.staggerMaxMs > 0) {
      await this.sleep(this.fleet.random() * options.staggerMaxMs);
    }

    for (;;) {
      if (this.stopped || this.isBackingOff("monitors")) {
        return;
      }

      const room: number = await this.slots.reserve(
        options.fetchLimit,
        Math.max(1, Math.ceil(options.fetchLimit / 2)),
      );

      if (this.stopped || room <= 0) {
        return;
      }

      const answer: Answer = await this.fleet.post(
        "/monitor/list",
        this.probe,
        this.replica,
        room,
      );

      if (answer.outcome !== "ok") {
        this.slots.release(room);

        if (answer.outcome === "busy") {
          this.backOffUntil.set(
            "monitors",
            Date.now() + (answer.retryAfterMs ?? DEFAULT_BUSY_BACK_OFF_MS),
          );
        }

        return;
      }

      const handed: number = answer.items.length;

      if (handed > room) {
        this.slots.take(handed - room);
      } else {
        this.slots.release(room - handed);
      }

      for (let check: number = 0; check < handed; check++) {
        const duration: number =
          options.checkMs.min +
          this.fleet.random() * (options.checkMs.max - options.checkMs.min);

        void this.sleep(duration)
          .then(async (): Promise<void> => {
            if (options.postResults && !this.stopped) {
              await this.fleet.postResult(this.probe, this.replica);
            }
          })
          .finally((): void => {
            this.slots.release(1);
          });
      }

      if (handed < room) {
        return;
      }
    }
  }

  // The ten-second tick of the monitor test fetch.
  public onTestTick(): void {
    if (
      this.stopped ||
      this.testFetchInFlight ||
      this.isBackingOff("monitor tests")
    ) {
      return;
    }

    this.testFetchInFlight = true;

    this.fleet
      .post(
        "/monitor-test/list",
        this.probe,
        this.replica,
        MONITOR_TEST_FETCH_LIMIT,
      )
      .then((answer: Answer): void => {
        if (answer.outcome === "busy") {
          this.backOffUntil.set(
            "monitor tests",
            Date.now() + (answer.retryAfterMs ?? DEFAULT_BUSY_BACK_OFF_MS),
          );
        }

        for (const item of answer.items) {
          this.fleet.noteTestHandedOut(String(item._id || ""));
        }
      })
      .catch((): void => {
        // Asked again at the next tick.
      })
      .finally((): void => {
        this.testFetchInFlight = false;
      });
  }
}

export default class SimulatedProbeFleet {
  public readonly options: SimulatedProbeFleetOptions;
  public readonly random: () => number;
  public readonly monitorFetches: Array<FetchRecord> = [];
  public readonly testFetches: Array<FetchRecord> = [];
  public readonly testsHandedOut: Array<TestHandOut> = [];
  public monitorsHandedOut: number = 0;
  // Monitors handed out in each second since the fleet started.
  public readonly handedOutPerSecond: Array<number> = [];
  private replicas: Array<SimulatedProbeReplica> = [];
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private startedAt: number = 0;
  private stopped: boolean = false;

  public constructor(options: SimulatedProbeFleetOptions) {
    this.options = options;
    this.random = seededRandom(options.seed);

    for (let probe: number = 0; probe < options.probeIds.length; probe++) {
      for (
        let replica: number = 0;
        replica < options.replicasPerProbe;
        replica++
      ) {
        this.replicas.push(new SimulatedProbeReplica(this, probe, replica));
      }
    }
  }

  public start(): void {
    this.startedAt = Date.now();

    // runOnStartup, then on the minute and every ten seconds, as cron does.
    for (const replica of this.replicas) {
      replica.onMinute();
      replica.onTestTick();
    }

    this.every(MINUTE_MS, (): void => {
      for (const replica of this.replicas) {
        replica.onMinute();
      }
    });

    this.every(this.options.testPollEveryMs, (): void => {
      for (const replica of this.replicas) {
        replica.onTestTick();
      }
    });
  }

  public stop(): void {
    this.stopped = true;

    for (const timer of this.timers) {
      clearTimeout(timer);
    }

    for (const replica of this.replicas) {
      replica.stop();
    }
  }

  // Calls `tick` at every wall-clock multiple of `periodMs`, as cron does.
  private every(periodMs: number, tick: () => void): void {
    const schedule: () => void = (): void => {
      if (this.stopped) {
        return;
      }

      const wait: number = periodMs - (Date.now() % periodMs);
      this.timers.push(
        setTimeout((): void => {
          tick();
          schedule();
        }, wait),
      );
    };

    schedule();
  }

  public noteTestHandedOut(testId: string): void {
    this.testsHandedOut.push({ testId: testId, at: Date.now() });
  }

  private noteMonitorsHandedOut(count: number): void {
    this.monitorsHandedOut += count;
    const second: number = Math.floor((Date.now() - this.startedAt) / 1000);

    while (this.handedOutPerSecond.length <= second) {
      this.handedOutPerSecond.push(0);
    }

    this.handedOutPerSecond[second]! += count;
  }

  /*
   * Each probe replica's own connections, when they are kept alive: the
   * agent a probe process's HTTP client sends on (Node's global agent, as
   * the probe uses it with no proxy set).
   */
  private agents: Map<string, http.Agent> = new Map<string, http.Agent>();

  private agentOf(probe: number, replica: number): http.Agent {
    const key: string = `${probe}:${replica}`;
    let agent: http.Agent | undefined = this.agents.get(key);

    if (!agent) {
      agent = new http.Agent(PROBE_AGENT_OPTIONS);
      this.agents.set(key, agent);
    }

    return agent;
  }

  // The connections the probes' agents hold open now.
  public openConnections(): number {
    let open: number = 0;

    for (const agent of this.agents.values()) {
      for (const sockets of [
        ...Object.values(agent.sockets),
        ...Object.values(agent.freeSockets),
      ]) {
        open += sockets?.length || 0;
      }
    }

    return open;
  }

  public destroyConnections(): void {
    for (const agent of this.agents.values()) {
      agent.destroy();
    }

    this.agents.clear();
  }

  /*
   * One request, as the probe sends it: to an App replica picked at
   * random (fetch, a connection of its own each time), or to the one
   * origin over the replica's kept-alive connections.
   */
  private async send(
    path: string,
    probe: number,
    replica: number,
    body: string,
  ): Promise<{
    status: number;
    retryAfter: string | null;
    body: unknown;
  }> {
    if (!this.options.keepAliveOrigin) {
      const origin: string =
        this.options.appOrigins[
          Math.floor(this.random() * this.options.appOrigins.length)
        ]!;

      const response: globalThis.Response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body,
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      });

      return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        body: await response.json().catch((): null => {
          return null;
        }),
      };
    }

    const url: URL = new URL(`${this.options.keepAliveOrigin}${path}`);
    const agent: http.Agent = this.agentOf(probe, replica);

    return await new Promise<{
      status: number;
      retryAfter: string | null;
      body: unknown;
    }>(
      (
        resolve: (answer: {
          status: number;
          retryAfter: string | null;
          body: unknown;
        }) => void,
        reject: (error: Error) => void,
      ): void => {
        const request: http.ClientRequest = http.request(
          {
            host: url.hostname,
            port: url.port,
            path: url.pathname,
            method: "POST",
            agent: agent,
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
            timeout: this.options.requestTimeoutMs,
          },
          (response: http.IncomingMessage): void => {
            const chunks: Array<Buffer> = [];

            response.on("data", (chunk: Buffer): void => {
              chunks.push(chunk);
            });
            response.on("error", reject);
            response.on("end", (): void => {
              let parsed: unknown = null;

              try {
                parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              } catch {
                // Not JSON: an error page.
              }

              const retryAfter: string | string[] | undefined =
                response.headers["retry-after"];

              resolve({
                status: response.statusCode || 0,
                retryAfter: Array.isArray(retryAfter)
                  ? retryAfter[0] || null
                  : retryAfter || null,
                body: parsed,
              });
            });
          },
        );

        request.on("timeout", (): void => {
          const timeout: Error = new Error("timed out");
          timeout.name = "TimeoutError";
          request.destroy(timeout);
        });
        request.on("error", reject);
        request.end(body);
      },
    );
  }

  public async post(
    route: string,
    probe: number,
    replica: number,
    limit: number,
  ): Promise<Answer> {
    const startedAt: number = Date.now();
    let answer: Answer;

    try {
      const response: {
        status: number;
        retryAfter: string | null;
        body: unknown;
      } = await this.send(
        `/probe-ingest${route}`,
        probe,
        replica,
        JSON.stringify({
          probeKey: "benchmark",
          probeId: this.options.probeIds[probe],
          probeCapabilities: PROBE_FLEET_CAPABILITIES,
          probeVersion: "benchmark",
          limit: limit,
        }),
      );

      if (response.status === 429) {
        const retryAfter: number = Number(response.retryAfter);
        answer = {
          outcome: "busy",
          retryAfterMs:
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(
                  MAX_BUSY_BACK_OFF_MS,
                  Math.max(1000, retryAfter * 1000),
                )
              : null,
          items: [],
        };
      } else if (response.status < 200 || response.status >= 300) {
        answer = { outcome: "error", retryAfterMs: null, items: [] };
      } else {
        const data: unknown = (response.body as { data?: unknown } | null)
          ?.data;
        answer = {
          outcome: "ok",
          retryAfterMs: null,
          items: Array.isArray(data) ? (data as Array<{ _id?: unknown }>) : [],
        };
      }
    } catch (error) {
      answer = {
        outcome:
          (error as { name?: string }).name === "TimeoutError"
            ? "timeout"
            : "error",
        retryAfterMs: null,
        items: [],
      };
    }

    const record: FetchRecord = {
      at: startedAt,
      ms: Date.now() - startedAt,
      probe: probe,
      replica: replica,
      outcome: answer.outcome,
      asked: limit,
      handed: answer.items.length,
    };

    if (route === "/monitor/list") {
      this.monitorFetches.push(record);
      this.noteMonitorsHandedOut(answer.items.length);
    } else {
      this.testFetches.push(record);
    }

    return answer;
  }

  /*
   * A check's result, as the probe's monitor jobs send one: a monitor
   * log of a couple of kilobytes. Its answer is not measured; a failed
   * one is counted.
   */
  public resultsPosted: number = 0;
  public resultsFailed: number = 0;

  public async postResult(probe: number, replica: number): Promise<void> {
    try {
      const response: { status: number } = await this.send(
        "/probe-ingest/probe/response/ingest",
        probe,
        replica,
        JSON.stringify({
          probeKey: "benchmark",
          probeId: this.options.probeIds[probe],
          probeMonitorResponse: RESULT_BODY,
        }),
      );

      if (response.status >= 200 && response.status < 300) {
        this.resultsPosted++;
      } else {
        this.resultsFailed++;
      }
    } catch {
      this.resultsFailed++;
    }
  }
}
