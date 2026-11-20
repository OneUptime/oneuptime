import fs from "fs";
import { AgentConfig } from "./Config";
import {
  AI_PVE_API_TOKEN_ID_ENV,
  AI_PVE_API_TOKEN_SECRET_ENV,
  MAX_PVE_RESPONSE_BYTES,
  PVE_API_BASE_PATH,
  PVE_API_TOKEN_ID_ENV,
  PVE_API_TOKEN_SECRET_ENV,
  ProxmoxConnection,
  ProxmoxConnectionResult,
  ProxmoxEndpoint,
  ProxmoxHttpResponse,
  ProxmoxTransport,
  httpsTransport,
  resolveProxmoxConnection,
} from "./Executors/ProxmoxExecutor";
import { USER_AGENT_PREFIX } from "./IngestClient";
import { AgentLogger } from "./Logger";
import { waitAtMost } from "./Sleep";
import {
  PROXMOX_GUEST_POWER_TASK_METRIC_NAME,
  PROXMOX_GUEST_POWER_TASK_SCOPE_NAME,
  ProxmoxGuestPowerTask,
  ProxmoxGuestPowerTaskAttribute,
  ProxmoxTaskLogEntry,
  selectProxmoxGuestPowerTask,
} from "./Common/Utils/Proxmox/ProxmoxGuestPowerTask";

/*
 * WHO OR WHAT STOPPED EACH STOPPED GUEST, FROM THE CLUSTER'S TASK LOG
 * (#10017).
 *
 * The collector beside this agent reads a cluster through
 * prometheus-pve-exporter, which says whether each guest runs, starts on
 * boot and what HA makes of it - never why one stopped. The Proxmox VE API
 * does, in each node's task log (Common/Utils/Proxmox/ProxmoxGuestPowerTask
 * says what is read and how). So, every few minutes, the Proxmox AI agent
 * reads:
 *
 *   1. GET /cluster/resources?type=vm - every guest, and which are stopped;
 *   2. for each stopped guest that is not a template, GET
 *      /nodes/{node}/tasks?vmid={vmid}&limit=25 - its newest tasks;
 *
 * and sends OneUptime, for each, the last task that started or stopped it
 * (qmstop by alice@pve, a start that failed and why, HA's stop request and
 * who asked), as one gauge datapoint of pve_guest_last_power_task, on the
 * cluster the collector reports. A guest with none in its log is sent too,
 * with an empty type, so what OneUptime kept of it before is cleared.
 *
 * It reads with the collector's own token (PVE_API_TOKEN_ID, PVEAuditor,
 * which sees every user's tasks) when it is set, else with the agent's,
 * from PVE_HOST, then the other nodes of PVE_NODES when PVE_HOST's API
 * cannot be reached, as every call the agent makes does. Reads only: it
 * writes nothing, anywhere, and runs whatever OneUptime AI may do.
 * ONEUPTIME_PROXMOX_GUEST_TASKS_INTERVAL_SECONDS sets how often (300 by
 * default; at least 60), and 0 turns it off.
 *
 * Gentle by design: one read of the cluster's guests, then one per stopped
 * guest, at most 100 a round (more wait for the next rounds, in turn) and
 * four at a time. A round that cannot reach the API, or OneUptime, says so
 * once in the log, and the next round tries again. Never throws.
 */

export const GUEST_TASKS_INTERVAL_ENV: string =
  "ONEUPTIME_PROXMOX_GUEST_TASKS_INTERVAL_SECONDS";
export const DEFAULT_GUEST_TASKS_INTERVAL_MS: number = 5 * 60_000;
export const MIN_GUEST_TASKS_INTERVAL_MS: number = 60_000;

// The first round, a little after start-up, once the agent has settled.
export const FIRST_GUEST_TASKS_ROUND_DELAY_MS: number = 15_000;

// At most this many stopped guests are read in one round; the rest in the next.
export const MAX_GUESTS_PER_ROUND: number = 100;

// How many of a guest's newest tasks are read: enough to reach its last start or stop.
export const TASKS_PER_GUEST: number = 25;

// How many reads are in flight at once.
export const GUEST_TASKS_READ_CONCURRENCY: number = 4;

// Each read, and the send to OneUptime, gives up after this long.
export const GUEST_TASKS_REQUEST_TIMEOUT_MS: number = 15_000;

// The OTLP metrics path on OneUptime, as the collector's otlphttp exporter posts.
export const OTLP_METRICS_PATH: string = "/otlp/v1/metrics";

// The guest as /cluster/resources lists it.
export interface ProxmoxClusterGuest {
  vmid: number;
  node: string;
  // qemu or lxc.
  type: string;
  isStopped: boolean;
  isTemplate: boolean;
}

// What one round read of one guest.
export interface ProxmoxGuestTaskReading {
  guest: ProxmoxClusterGuest;
  task: ProxmoxGuestPowerTask | null;
}

/*
 * How often the task log is read, from the environment: the default when
 * unset or not a number, never more often than once a minute, null when
 * it is 0 (off).
 */
export function readGuestTasksIntervalMs(
  env: NodeJS.ProcessEnv,
): number | null {
  const setting: string = (env[GUEST_TASKS_INTERVAL_ENV] || "").trim();
  if (!setting) {
    return DEFAULT_GUEST_TASKS_INTERVAL_MS;
  }
  const seconds: number = Number(setting);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_GUEST_TASKS_INTERVAL_MS;
  }
  if (seconds === 0) {
    return null;
  }
  return Math.max(MIN_GUEST_TASKS_INTERVAL_MS, Math.round(seconds * 1000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The API answers every read as {"data": ...}.
function dataOf(body: string): unknown {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed["data"] : null;
  } catch {
    return null;
  }
}

// Every guest of the cluster, as GET /cluster/resources?type=vm lists them.
export function parseClusterGuests(data: unknown): Array<ProxmoxClusterGuest> {
  if (!Array.isArray(data)) {
    return [];
  }
  const guests: Array<ProxmoxClusterGuest> = [];
  for (const entry of data) {
    if (!isRecord(entry)) {
      continue;
    }
    const type: string = String(entry["type"] || "");
    const vmid: number = Number(entry["vmid"]);
    const node: string = String(entry["node"] || "").trim();
    if (
      (type !== "qemu" && type !== "lxc") ||
      !Number.isInteger(vmid) ||
      vmid <= 0 ||
      !node
    ) {
      continue;
    }
    guests.push({
      vmid: vmid,
      node: node,
      type: type,
      isStopped: String(entry["status"] || "") === "stopped",
      isTemplate: Number(entry["template"]) === 1,
    });
  }
  return guests;
}

// A guest's tasks, as GET /nodes/{node}/tasks lists them.
export function parseTaskLog(data: unknown): Array<ProxmoxTaskLogEntry> {
  if (!Array.isArray(data)) {
    return [];
  }
  const tasks: Array<ProxmoxTaskLogEntry> = [];
  for (const entry of data) {
    if (!isRecord(entry) || typeof entry["type"] !== "string") {
      continue;
    }
    const task: ProxmoxTaskLogEntry = { type: entry["type"] };
    for (const key of ["upid", "node", "id", "user", "status"] as const) {
      const value: unknown = entry[key];
      if (typeof value === "string") {
        task[key] = value;
      } else if (typeof value === "number" && key === "id") {
        task.id = String(value);
      }
    }
    for (const key of ["starttime", "endtime"] as const) {
      const value: number = Number(entry[key]);
      if (Number.isFinite(value) && value > 0) {
        task[key] = value;
      }
    }
    tasks.push(task);
  }
  return tasks;
}

function stringAttribute(key: string, value: string): Record<string, unknown> {
  return { key: key, value: { stringValue: value } };
}

/*
 * The round's readings as one OTLP/JSON metrics request: a gauge datapoint
 * per guest, its identity as the collector's pve-identity transform writes
 * it (id qemu/104, pve.scope guest, pve.type, pve.id) and its last power
 * task beside it, on the cluster the collector reports.
 */
export function buildGuestTaskMetrics(data: {
  clusterName: string;
  readings: ReadonlyArray<ProxmoxGuestTaskReading>;
  nowMs: number;
  agentVersion?: string | null | undefined;
}): Record<string, unknown> {
  const timeUnixNano: string = `${Math.round(data.nowMs)}000000`;
  const dataPoints: Array<Record<string, unknown>> = data.readings.map(
    (reading: ProxmoxGuestTaskReading): Record<string, unknown> => {
      const task: ProxmoxGuestPowerTask | null = reading.task;
      return {
        timeUnixNano: timeUnixNano,
        asDouble: task ? task.at : 0,
        attributes: [
          stringAttribute("id", `${reading.guest.type}/${reading.guest.vmid}`),
          stringAttribute("pve.scope", "guest"),
          stringAttribute("pve.type", reading.guest.type),
          stringAttribute("pve.id", String(reading.guest.vmid)),
          stringAttribute("node", reading.guest.node),
          stringAttribute(
            ProxmoxGuestPowerTaskAttribute.Type,
            task?.type || "",
          ),
          stringAttribute(
            ProxmoxGuestPowerTaskAttribute.User,
            task?.user || "",
          ),
          stringAttribute(
            ProxmoxGuestPowerTaskAttribute.Status,
            task?.status || "",
          ),
          stringAttribute(
            ProxmoxGuestPowerTaskAttribute.Node,
            task?.node || "",
          ),
        ],
      };
    },
  );

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            stringAttribute("proxmox.cluster.name", data.clusterName),
          ],
        },
        scopeMetrics: [
          {
            scope: {
              name: PROXMOX_GUEST_POWER_TASK_SCOPE_NAME,
              ...(data.agentVersion ? { version: data.agentVersion } : {}),
            },
            metrics: [
              {
                name: PROXMOX_GUEST_POWER_TASK_METRIC_NAME,
                description:
                  "When a Proxmox VE guest's last start, stop, shutdown, hibernation or restore task ended, in Unix seconds, with the task in its attributes; 0 when its task log holds none.",
                unit: "s",
                gauge: { dataPoints: dataPoints },
              },
            ],
          },
        ],
      },
    ],
  };
}

/*
 * The token the task log is read with: the collector's PVEAuditor token
 * when it is set (Sys.Audit lists every user's tasks; a token that may
 * only power guests on and off sees only its own), else the agent's.
 */
export function resolveTaskLogConnection(
  env: NodeJS.ProcessEnv,
): ProxmoxConnectionResult {
  const hasCollectorToken: boolean =
    Boolean((env[PVE_API_TOKEN_ID_ENV] || "").trim()) &&
    Boolean((env[PVE_API_TOKEN_SECRET_ENV] || "").trim());
  if (!hasCollectorToken) {
    return resolveProxmoxConnection(env);
  }
  return resolveProxmoxConnection({
    ...env,
    [AI_PVE_API_TOKEN_ID_ENV]: "",
    [AI_PVE_API_TOKEN_SECRET_ENV]: "",
  });
}

export interface ProxmoxGuestTaskReporterOptions {
  config: AgentConfig;
  env: NodeJS.ProcessEnv;
  logger: AgentLogger;
  // Tests hand in a fake API and OneUptime.
  transport?: ProxmoxTransport | undefined;
  fetchImpl?: typeof fetch | undefined;
  nowMs?: (() => number) | undefined;
  // Overrides the environment's interval (tests).
  intervalMs?: number | null | undefined;
  firstRoundDelayMs?: number | undefined;
}

export default class ProxmoxGuestTaskReporter {
  private readonly transport: ProxmoxTransport;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;
  private readonly intervalMs: number | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstRound: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped: boolean = false;
  // Where the next round starts in the cluster's stopped guests.
  private nextGuest: number = 0;
  // The node that answered last, tried first next time.
  private answering: string | null = null;
  // The problem said last, so a lasting one is logged once.
  private lastProblem: string | null = null;

  public constructor(
    private readonly options: ProxmoxGuestTaskReporterOptions,
  ) {
    this.transport = options.transport || httpsTransport;
    this.fetchImpl = options.fetchImpl || fetch;
    this.nowMs =
      options.nowMs ||
      ((): number => {
        return Date.now();
      });
    this.intervalMs =
      options.intervalMs !== undefined
        ? options.intervalMs
        : readGuestTasksIntervalMs(options.env);
  }

  // Whether it reads at all (ONEUPTIME_PROXMOX_GUEST_TASKS_INTERVAL_SECONDS=0 is off).
  public isEnabled(): boolean {
    return this.intervalMs !== null;
  }

  public start(): void {
    if (this.stopped || this.timer || this.intervalMs === null) {
      return;
    }
    const intervalMs: number = this.intervalMs;
    // The agent's health server keeps it running: these never do on their own.
    this.firstRound = setTimeout((): void => {
      void this.tick();
    }, this.options.firstRoundDelayMs ?? FIRST_GUEST_TASKS_ROUND_DELAY_MS);
    this.firstRound.unref();
    this.timer = setInterval((): void => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
  }

  /*
   * Stop for good, waiting up to maxWaitMs for a round already under way
   * (its reads stop starting at once). Resolves true when none was left.
   */
  public async stop(maxWaitMs: number): Promise<boolean> {
    this.stopped = true;
    if (this.firstRound) {
      clearTimeout(this.firstRound);
      this.firstRound = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return waitAtMost(this.inFlight, maxWaitMs);
  }

  // One round, unless one is under way. Never throws.
  public tick(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.round()
      .catch((err: unknown): void => {
        this.sayProblem(
          `Could not read the guests' task log: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally((): void => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async round(): Promise<void> {
    const clusterName: string = this.options.config.resourceIdentifier || "";
    if (!clusterName) {
      return;
    }
    const resolved: ProxmoxConnectionResult = resolveTaskLogConnection(
      this.options.env,
    );
    if (!resolved.connection) {
      this.sayProblem(`Not reading the guests' task log: ${resolved.problem}`);
      return;
    }
    const connection: ProxmoxConnection = resolved.connection;
    const ca: string | null =
      connection.verifyTls && connection.caFile
        ? fs.readFileSync(connection.caFile, "utf8")
        : null;

    const guests: Array<ProxmoxClusterGuest> = parseClusterGuests(
      dataOf(await this.get(connection, ca, "/cluster/resources?type=vm")),
    ).filter((guest: ProxmoxClusterGuest): boolean => {
      return guest.isStopped && !guest.isTemplate;
    });

    if (guests.length === 0) {
      this.sayProblem(null);
      return;
    }

    // At most MAX_GUESTS_PER_ROUND, in turn: the rest wait for the next round.
    const start: number = this.nextGuest % guests.length;
    const chosen: Array<ProxmoxClusterGuest> = [
      ...guests.slice(start),
      ...guests.slice(0, start),
    ].slice(0, MAX_GUESTS_PER_ROUND);
    this.nextGuest = start + chosen.length;

    const readings: Array<ProxmoxGuestTaskReading> = [];
    let next: number = 0;
    const worker: () => Promise<void> = async (): Promise<void> => {
      while (next < chosen.length && !this.stopped) {
        const guest: ProxmoxClusterGuest = chosen[next++]!;
        const body: string = await this.get(
          connection,
          ca,
          `/nodes/${encodeURIComponent(guest.node)}/tasks?vmid=${guest.vmid}&limit=${TASKS_PER_GUEST}`,
        );
        readings.push({
          guest: guest,
          task: selectProxmoxGuestPowerTask(parseTaskLog(dataOf(body))),
        });
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(GUEST_TASKS_READ_CONCURRENCY, chosen.length) },
        worker,
      ),
    );

    if (this.stopped || readings.length === 0) {
      return;
    }

    await this.send(
      buildGuestTaskMetrics({
        clusterName: clusterName,
        readings: readings,
        nowMs: this.nowMs(),
        agentVersion: this.options.config.agentVersion,
      }),
    );
    this.sayProblem(null);
  }

  /*
   * One read, from the node that answered last, then PVE_HOST's, then the
   * others of PVE_NODES. A read changes nothing, so any node that gives no
   * answer moves it on; an answer that is an error (a refused token, a
   * missing privilege) is the same on every node, and ends it.
   */
  private async get(
    connection: ProxmoxConnection,
    ca: string | null,
    path: string,
  ): Promise<string> {
    const all: Array<ProxmoxEndpoint> = [
      {
        host: connection.host,
        port: connection.port,
        endpoint: connection.endpoint,
      },
      ...connection.fallbacks,
    ];
    const ordered: Array<ProxmoxEndpoint> = [
      ...all.filter((endpoint: ProxmoxEndpoint): boolean => {
        return endpoint.endpoint === this.answering;
      }),
      ...all.filter((endpoint: ProxmoxEndpoint): boolean => {
        return endpoint.endpoint !== this.answering;
      }),
    ];

    let failure: unknown = null;
    for (const endpoint of ordered) {
      let response: ProxmoxHttpResponse;
      try {
        response = await this.transport({
          method: "GET",
          hostname: endpoint.host,
          port: endpoint.port,
          path: `${PVE_API_BASE_PATH}${path}`,
          headers: {
            Authorization: `PVEAPIToken=${connection.tokenId}=${connection.tokenSecret}`,
            Accept: "application/json",
            "User-Agent": `${USER_AGENT_PREFIX}${this.options.config.agentVersion || "dev"}`,
          },
          body: null,
          verifyTls: connection.verifyTls,
          ca: connection.verifyTls ? ca : null,
          timeoutInMs: GUEST_TASKS_REQUEST_TIMEOUT_MS,
          maxResponseBytes: MAX_PVE_RESPONSE_BYTES,
        });
      } catch (err: unknown) {
        failure = err;
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
          `${endpoint.endpoint}${path} answered HTTP ${response.statusCode} ${response.statusMessage}`.trim(),
        );
      }
      this.answering = endpoint.endpoint;
      return response.body;
    }
    throw new Error(
      `no node's Proxmox VE API answered: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
  }

  // The round's readings to OneUptime, as the collector sends its metrics.
  private async send(body: Record<string, unknown>): Promise<void> {
    const controller: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      controller.abort();
    }, GUEST_TASKS_REQUEST_TIMEOUT_MS);
    try {
      const response: Response = await this.fetchImpl(
        `${this.options.config.oneuptimeUrl.replace(/\/+$/, "")}${OTLP_METRICS_PATH}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-oneuptime-token": this.options.config.apiKey,
            "User-Agent": `${USER_AGENT_PREFIX}${this.options.config.agentVersion || "dev"}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
          redirect: "manual",
        },
      );
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `OneUptime answered HTTP ${response.status} to the guests' last tasks`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // Says a problem once, while it lasts, and that it cleared.
  private sayProblem(problem: string | null): void {
    if (problem === this.lastProblem) {
      return;
    }
    if (problem) {
      this.options.logger.warn(problem);
    } else if (this.lastProblem) {
      this.options.logger.info(
        "Reading the guests' task log again: who or what stopped each stopped guest reaches OneUptime.",
      );
    }
    this.lastProblem = problem;
  }
}
