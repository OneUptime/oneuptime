import assert from "assert";
import { afterEach, beforeEach, test } from "node:test";
import { AgentConfig } from "../Config";
import {
  ProxmoxHttpRequest,
  ProxmoxHttpResponse,
  ProxmoxTransportError,
} from "../Executors/ProxmoxExecutor";
import ProxmoxGuestTaskReporter, {
  DEFAULT_GUEST_TASKS_INTERVAL_MS,
  GUEST_TASKS_READ_CONCURRENCY,
  MAX_GUESTS_PER_ROUND,
  MIN_GUEST_TASKS_INTERVAL_MS,
  OTLP_METRICS_PATH,
  TASKS_PER_GUEST,
  buildGuestTaskMetrics,
  parseClusterGuests,
  parseTaskLog,
  readGuestTasksIntervalMs,
} from "../ProxmoxGuestTasks";
import { CapturedLogs, captureLogs, testConfig } from "./Helpers/TestSupport";
import {
  PROXMOX_GUEST_POWER_TASK_METRIC_NAME,
  PROXMOX_GUEST_POWER_TASK_SCOPE_NAME,
} from "../Common/Utils/Proxmox/ProxmoxGuestPowerTask";
import Logger from "../Logger";

/*
 * The Proxmox AI agent's read of the guests' task log (#10017), against a
 * fake Proxmox VE API and a fake OneUptime. The answers are the API's own:
 * GET /cluster/resources?type=vm and GET /nodes/{node}/tasks as a Proxmox
 * VE 8 node writes them (field for field, UPIDs and all), so each guest's
 * last start or stop is picked as the agent will pick it on a real cluster.
 */

const URL: string = "https://oneuptime.example.com";
const CLUSTER: string = "pve-prod";
const PVE_HOST: string = "192.168.1.10";
const PVE_NODE_2: string = "192.168.1.11";
const TOKEN_ID: string = "monitoring@pam!oneuptime";
const TOKEN_SECRET: string = "0b7f2a1e-5c3d-4e8f-9a6b-1c2d3e4f5a6b";
const AI_TOKEN_ID: string = "oneuptime-ai@pve!fixes";
const AI_TOKEN_SECRET: string = "7d1c9e3a-2b4f-4c6d-8e0a-9f1b2c3d4e5f";
const NOW_MS: number = Date.parse("2026-11-20T12:00:00.000Z");

// Unix seconds, so many minutes before now.
function minutesAgo(minutes: number): number {
  return Math.round(NOW_MS / 1000) - minutes * 60;
}

// A task as /nodes/{node}/tasks lists it.
function task(fields: {
  node: string;
  type: string;
  vmid: number;
  user: string;
  start: number;
  end?: number;
  status?: string;
}): Record<string, unknown> {
  const upid: string = `UPID:${fields.node}:0001A2B3:0C4D5E6F:${fields.start.toString(16).toUpperCase()}:${fields.type}:${fields.vmid}:${fields.user}:`;
  return {
    upid: upid,
    node: fields.node,
    pid: 107187,
    pstart: 12899814,
    starttime: fields.start,
    type: fields.type,
    id: String(fields.vmid),
    user: fields.user,
    ...(fields.end !== undefined ? { endtime: fields.end } : {}),
    ...(fields.status !== undefined ? { status: fields.status } : {}),
  };
}

// A guest as /cluster/resources?type=vm lists it.
function guest(fields: {
  vmid: number;
  node: string;
  type?: string;
  status: string;
  name: string;
  template?: number;
  hastate?: string;
}): Record<string, unknown> {
  const type: string = fields.type || "qemu";
  return {
    id: `${type}/${fields.vmid}`,
    type: type,
    vmid: fields.vmid,
    node: fields.node,
    status: fields.status,
    name: fields.name,
    template: fields.template ?? 0,
    maxcpu: 2,
    maxmem: 4294967296,
    maxdisk: 34359738368,
    cpu: 0,
    mem: 0,
    disk: 0,
    uptime: fields.status === "running" ? 86400 : 0,
    netin: 0,
    netout: 0,
    diskread: 0,
    diskwrite: 0,
    ...(fields.hastate ? { hastate: fields.hastate } : {}),
  };
}

/*
 * The cluster: web-1 stopped by alice; db-1 stopped through HA by bob, the
 * stop run by HA's local resource manager as root@pam; api-1 failed to
 * start; cache-1 started fine and went down without a task; ct-200 (a
 * container) has only consoles and backups in its log; tmpl-900 is a
 * template; app-1 runs.
 */
const GUESTS: Array<Record<string, unknown>> = [
  guest({ vmid: 101, node: "pve1", status: "stopped", name: "web-1" }),
  guest({
    vmid: 102,
    node: "pve2",
    status: "stopped",
    name: "db-1",
    hastate: "stopped",
  }),
  guest({
    vmid: 103,
    node: "pve1",
    status: "stopped",
    name: "api-1",
    hastate: "error",
  }),
  guest({ vmid: 104, node: "pve2", status: "stopped", name: "cache-1" }),
  guest({
    vmid: 200,
    node: "pve1",
    type: "lxc",
    status: "stopped",
    name: "ct-200",
  }),
  guest({
    vmid: 900,
    node: "pve1",
    status: "stopped",
    name: "tmpl-900",
    template: 1,
  }),
  guest({ vmid: 105, node: "pve1", status: "running", name: "app-1" }),
];

const TASK_LOGS: Record<string, Array<Record<string, unknown>>> = {
  "pve1/101": [
    task({
      node: "pve1",
      type: "qmstop",
      vmid: 101,
      user: "alice@pve",
      start: minutesAgo(120),
      end: minutesAgo(120) + 2,
      status: "OK",
    }),
    task({
      node: "pve1",
      type: "vncproxy",
      vmid: 101,
      user: "alice@pve",
      start: minutesAgo(125),
      end: minutesAgo(121),
      status: "OK",
    }),
    task({
      node: "pve1",
      type: "qmstart",
      vmid: 101,
      user: "root@pam",
      start: minutesAgo(3000),
      end: minutesAgo(3000) + 3,
      status: "OK",
    }),
  ],
  "pve2/102": [
    task({
      node: "pve2",
      type: "qmshutdown",
      vmid: 102,
      user: "root@pam",
      start: minutesAgo(30),
      end: minutesAgo(29),
      status: "OK",
    }),
    task({
      node: "pve2",
      type: "hastop",
      vmid: 102,
      user: "bob@pve",
      start: minutesAgo(30) - 6,
      end: minutesAgo(30) - 5,
      status: "OK",
    }),
  ],
  "pve1/103": [
    task({
      node: "pve1",
      type: "qmstart",
      vmid: 103,
      user: "root@pam",
      start: minutesAgo(10),
      end: minutesAgo(10) + 1,
      status: "start failed: QEMU exited with code 1",
    }),
    task({
      node: "pve1",
      type: "qmstart",
      vmid: 103,
      user: "root@pam",
      start: minutesAgo(12),
      end: minutesAgo(12) + 1,
      status: "start failed: QEMU exited with code 1",
    }),
  ],
  "pve2/104": [
    task({
      node: "pve2",
      type: "qmstart",
      vmid: 104,
      user: "root@pam",
      start: minutesAgo(4000),
      end: minutesAgo(4000) + 2,
      status: "OK",
    }),
  ],
  "pve1/200": [
    task({
      node: "pve1",
      type: "vncshell",
      vmid: 200,
      user: "root@pam",
      start: minutesAgo(5),
      end: minutesAgo(4),
      status: "OK",
    }),
    task({
      node: "pve1",
      type: "vzdump",
      vmid: 200,
      user: "root@pam",
      start: minutesAgo(600),
      end: minutesAgo(590),
      status: "OK",
    }),
  ],
};

class FakeApi {
  public readonly requests: Array<ProxmoxHttpRequest> = [];
  public unreachableHosts: Set<string> = new Set<string>();
  public refuseTasks: boolean = false;
  public guests: Array<Record<string, unknown>> = GUESTS;

  public readonly send: (
    request: ProxmoxHttpRequest,
  ) => Promise<ProxmoxHttpResponse> = async (
    request: ProxmoxHttpRequest,
  ): Promise<ProxmoxHttpResponse> => {
    this.requests.push(request);
    if (this.unreachableHosts.has(request.hostname)) {
      throw new ProxmoxTransportError({
        kind: "connect",
        message: `connect ECONNREFUSED ${request.hostname}:8006`,
        code: "ECONNREFUSED",
      });
    }
    const url: URL = new globalThis.URL(`https://pve${request.path}`);
    if (url.pathname === "/api2/json/cluster/resources") {
      return this.reply(this.guests);
    }
    const match: RegExpMatchArray | null = url.pathname.match(
      /^\/api2\/json\/nodes\/([^/]+)\/tasks$/,
    );
    if (match) {
      if (this.refuseTasks) {
        return {
          statusCode: 403,
          statusMessage: "Permission check failed (/nodes/pve1, Sys.Audit)",
          location: null,
          contentType: "application/json",
          body: JSON.stringify({ data: null }),
          truncated: false,
        };
      }
      return this.reply(
        TASK_LOGS[`${match[1]}/${url.searchParams.get("vmid")}`] || [],
      );
    }
    return this.reply(null);
  };

  public paths(): Array<string> {
    return this.requests.map((request: ProxmoxHttpRequest): string => {
      return `${request.hostname} ${request.path}`;
    });
  }

  private reply(data: unknown): ProxmoxHttpResponse {
    return {
      statusCode: 200,
      statusMessage: "OK",
      location: null,
      contentType: "application/json;charset=UTF-8",
      body: JSON.stringify({ data: data }),
      truncated: false,
    };
  }
}

interface SentRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

class FakeOneUptime {
  public readonly sent: Array<SentRequest> = [];
  public status: number = 200;

  public readonly fetch: typeof fetch = (async (
    input: string | URL | Request,
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    this.sent.push({
      url: String(input),
      headers: (init?.headers || {}) as Record<string, string>,
      body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
    });
    return new Response("{}", {
      status: this.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

interface Point {
  value: number;
  attributes: Record<string, string>;
}

// The datapoints one request sent, by guest id.
function pointsOf(request: SentRequest): Record<string, Point> {
  const resourceMetrics: Array<Record<string, unknown>> = request.body[
    "resourceMetrics"
  ] as Array<Record<string, unknown>>;
  const scope: Record<string, unknown> = (
    resourceMetrics[0]!["scopeMetrics"] as Array<Record<string, unknown>>
  )[0]!;
  const metric: Record<string, unknown> = (
    scope["metrics"] as Array<Record<string, unknown>>
  )[0]!;
  const points: Array<Record<string, unknown>> = (
    metric["gauge"] as Record<string, unknown>
  )["dataPoints"] as Array<Record<string, unknown>>;
  const byId: Record<string, Point> = {};
  for (const point of points) {
    const attributes: Record<string, string> = {};
    for (const attribute of point["attributes"] as Array<
      Record<string, unknown>
    >) {
      attributes[String(attribute["key"])] = String(
        (attribute["value"] as Record<string, unknown>)["stringValue"],
      );
    }
    byId[attributes["id"]!] = {
      value: Number(point["asDouble"]),
      attributes: attributes,
    };
  }
  return byId;
}

function agentConfig(): AgentConfig {
  return testConfig(URL, {
    DOCKER_HOST_NAME: "",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "proxmox",
    PROXMOX_CLUSTER_NAME: CLUSTER,
  });
}

function pveEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PVE_HOST: PVE_HOST,
    PVE_NODES: `[${PVE_HOST},${PVE_NODE_2}]`,
    PVE_API_TOKEN_ID: TOKEN_ID,
    PVE_API_TOKEN_SECRET: TOKEN_SECRET,
    ...overrides,
  };
}

let api: FakeApi;
let oneuptime: FakeOneUptime;
let logs: CapturedLogs;

function reporter(env: NodeJS.ProcessEnv = pveEnv()): ProxmoxGuestTaskReporter {
  return new ProxmoxGuestTaskReporter({
    config: agentConfig(),
    env: env,
    logger: Logger,
    transport: api.send,
    fetchImpl: oneuptime.fetch,
    nowMs: (): number => {
      return NOW_MS;
    },
  });
}

beforeEach((): void => {
  api = new FakeApi();
  oneuptime = new FakeOneUptime();
  logs = captureLogs();
});

afterEach((): void => {
  logs.restore();
});

test("reads the cluster's guests, then the task log of each stopped one that is not a template, on its own node", async (): Promise<void> => {
  await reporter().tick();

  const paths: Array<string> = api.paths();
  assert.strictEqual(
    paths[0],
    `${PVE_HOST} /api2/json/cluster/resources?type=vm`,
  );
  assert.deepStrictEqual(
    paths.slice(1).sort(),
    [
      `${PVE_HOST} /api2/json/nodes/pve1/tasks?vmid=101&limit=${TASKS_PER_GUEST}`,
      `${PVE_HOST} /api2/json/nodes/pve2/tasks?vmid=102&limit=${TASKS_PER_GUEST}`,
      `${PVE_HOST} /api2/json/nodes/pve1/tasks?vmid=103&limit=${TASKS_PER_GUEST}`,
      `${PVE_HOST} /api2/json/nodes/pve2/tasks?vmid=104&limit=${TASKS_PER_GUEST}`,
      `${PVE_HOST} /api2/json/nodes/pve1/tasks?vmid=200&limit=${TASKS_PER_GUEST}`,
    ].sort(),
  );
  // Reads only.
  for (const request of api.requests) {
    assert.strictEqual(request.method, "GET");
    assert.strictEqual(request.body, null);
  }
});

test("sends each guest's last power task to OneUptime, on the cluster the collector reports", async (): Promise<void> => {
  await reporter().tick();

  assert.strictEqual(oneuptime.sent.length, 1);
  const request: SentRequest = oneuptime.sent[0]!;
  assert.strictEqual(request.url, `${URL}${OTLP_METRICS_PATH}`);
  assert.strictEqual(request.headers["x-oneuptime-token"], "ingestion-key-1");
  assert.strictEqual(request.headers["Content-Type"], "application/json");

  const resource: Record<string, unknown> = (
    request.body["resourceMetrics"] as Array<Record<string, unknown>>
  )[0]!["resource"] as Record<string, unknown>;
  assert.deepStrictEqual(resource["attributes"], [
    { key: "proxmox.cluster.name", value: { stringValue: CLUSTER } },
  ]);
  const scope: Record<string, unknown> = (
    (request.body["resourceMetrics"] as Array<Record<string, unknown>>)[0]![
      "scopeMetrics"
    ] as Array<Record<string, unknown>>
  )[0]!;
  assert.strictEqual(
    (scope["scope"] as Record<string, unknown>)["name"],
    PROXMOX_GUEST_POWER_TASK_SCOPE_NAME,
  );
  assert.strictEqual(
    (scope["metrics"] as Array<Record<string, unknown>>)[0]!["name"],
    PROXMOX_GUEST_POWER_TASK_METRIC_NAME,
  );

  const points: Record<string, Point> = pointsOf(request);
  assert.deepStrictEqual(Object.keys(points).sort(), [
    "lxc/200",
    "qemu/101",
    "qemu/102",
    "qemu/103",
    "qemu/104",
  ]);
  // Its identity, as the collector's pve-identity transform writes it.
  assert.deepStrictEqual(points["qemu/101"]!.attributes, {
    id: "qemu/101",
    "pve.scope": "guest",
    "pve.type": "qemu",
    "pve.id": "101",
    node: "pve1",
    "pve.task.type": "qmstop",
    "pve.task.user": "alice@pve",
    "pve.task.status": "OK",
    "pve.task.node": "pve1",
  });
  // When it ended, in Unix seconds.
  assert.strictEqual(points["qemu/101"]!.value, minutesAgo(120) + 2);
});

test("a stop HA ran for someone's request is that request, naming who asked", async (): Promise<void> => {
  await reporter().tick();

  const db: Point = pointsOf(oneuptime.sent[0]!)["qemu/102"]!;
  assert.strictEqual(db.attributes["pve.task.type"], "hastop");
  assert.strictEqual(db.attributes["pve.task.user"], "bob@pve");
});

test("a start that failed is sent with Proxmox's own reason", async (): Promise<void> => {
  await reporter().tick();

  const api1: Point = pointsOf(oneuptime.sent[0]!)["qemu/103"]!;
  assert.strictEqual(api1.attributes["pve.task.type"], "qmstart");
  assert.strictEqual(
    api1.attributes["pve.task.status"],
    "start failed: QEMU exited with code 1",
  );
  assert.strictEqual(api1.value, minutesAgo(10) + 1);
});

test("a guest whose last power task is a start that went well is sent with it: nothing stopped it", async (): Promise<void> => {
  await reporter().tick();

  const cache: Point = pointsOf(oneuptime.sent[0]!)["qemu/104"]!;
  assert.strictEqual(cache.attributes["pve.task.type"], "qmstart");
  assert.strictEqual(cache.attributes["pve.task.status"], "OK");
});

test("a guest with no start or stop in its log is sent with none, so what OneUptime kept of it is cleared", async (): Promise<void> => {
  await reporter().tick();

  const container: Point = pointsOf(oneuptime.sent[0]!)["lxc/200"]!;
  assert.strictEqual(container.value, 0);
  assert.strictEqual(container.attributes["pve.task.type"], "");
  assert.strictEqual(container.attributes["pve.task.user"], "");
  assert.strictEqual(container.attributes["pve.type"], "lxc");
});

test("reads with the collector's PVEAuditor token, which sees every user's tasks, even when the agent has its own", async (): Promise<void> => {
  await reporter(
    pveEnv({
      ONEUPTIME_AI_PVE_API_TOKEN_ID: AI_TOKEN_ID,
      ONEUPTIME_AI_PVE_API_TOKEN_SECRET: AI_TOKEN_SECRET,
    }),
  ).tick();

  for (const request of api.requests) {
    assert.strictEqual(
      request.headers["Authorization"],
      `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`,
    );
  }
});

test("with only the agent's token set, it reads with that one", async (): Promise<void> => {
  await reporter({
    PVE_HOST: PVE_HOST,
    ONEUPTIME_AI_PVE_API_TOKEN_ID: AI_TOKEN_ID,
    ONEUPTIME_AI_PVE_API_TOKEN_SECRET: AI_TOKEN_SECRET,
  }).tick();

  assert.strictEqual(
    api.requests[0]!.headers["Authorization"],
    `PVEAPIToken=${AI_TOKEN_ID}=${AI_TOKEN_SECRET}`,
  );
  assert.strictEqual(oneuptime.sent.length, 1);
});

test("when PVE_HOST's API cannot be reached it reads from the next node of PVE_NODES, and keeps to it", async (): Promise<void> => {
  api.unreachableHosts = new Set<string>([PVE_HOST]);
  await reporter().tick();

  assert.strictEqual(oneuptime.sent.length, 1);
  const hosts: Array<string> = api.requests.map(
    (request: ProxmoxHttpRequest): string => {
      return request.hostname;
    },
  );
  // Tried once, then never again this round.
  assert.strictEqual(
    hosts.filter((host: string): boolean => {
      return host === PVE_HOST;
    }).length,
    1,
  );
  assert.strictEqual(hosts[hosts.length - 1], PVE_NODE_2);
});

test("a task log the token may not read sends nothing and says why once, however many rounds it lasts", async (): Promise<void> => {
  api.refuseTasks = true;
  const reporterUnderTest: ProxmoxGuestTaskReporter = reporter();
  await reporterUnderTest.tick();
  await reporterUnderTest.tick();

  assert.strictEqual(oneuptime.sent.length, 0);
  const warnings: Array<string> = logs.messages("warn");
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0]!, /HTTP 403 Permission check failed/);

  // Once the token may read it again, it says so and sends.
  api.refuseTasks = false;
  await reporterUnderTest.tick();
  assert.strictEqual(oneuptime.sent.length, 1);
  assert.strictEqual(logs.messages("warn").length, 1);
  assert.match(
    logs.messages("info").join("\n"),
    /Reading the guests' task log again/,
  );
});

test("OneUptime refusing the readings is said once", async (): Promise<void> => {
  oneuptime.status = 401;
  const reporterUnderTest: ProxmoxGuestTaskReporter = reporter();
  await reporterUnderTest.tick();
  await reporterUnderTest.tick();

  assert.strictEqual(oneuptime.sent.length, 2);
  const warnings: Array<string> = logs.messages("warn");
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0]!, /OneUptime answered HTTP 401/);
});

test("a cluster with no stopped guest is read and nothing is sent", async (): Promise<void> => {
  api.guests = [
    guest({ vmid: 105, node: "pve1", status: "running", name: "app-1" }),
  ];
  await reporter().tick();

  assert.deepStrictEqual(api.paths(), [
    `${PVE_HOST} /api2/json/cluster/resources?type=vm`,
  ]);
  assert.strictEqual(oneuptime.sent.length, 0);
});

test("a round reads at most MAX_GUESTS_PER_ROUND guests, a few at a time, and the next round reads on from there", async (): Promise<void> => {
  api.guests = Array.from(
    { length: MAX_GUESTS_PER_ROUND + 20 },
    (_: unknown, index: number): Record<string, unknown> => {
      return guest({
        vmid: 1000 + index,
        node: "pve1",
        status: "stopped",
        name: `vm-${index}`,
      });
    },
  );
  let inFlight: number = 0;
  let mostInFlight: number = 0;
  const send: (request: ProxmoxHttpRequest) => Promise<ProxmoxHttpResponse> =
    api.send;
  const reporterUnderTest: ProxmoxGuestTaskReporter =
    new ProxmoxGuestTaskReporter({
      config: agentConfig(),
      env: pveEnv(),
      logger: Logger,
      transport: async (
        request: ProxmoxHttpRequest,
      ): Promise<ProxmoxHttpResponse> => {
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise<void>((resolve: () => void): void => {
          setImmediate(resolve);
        });
        inFlight--;
        return send(request);
      },
      fetchImpl: oneuptime.fetch,
    });

  await reporterUnderTest.tick();
  assert.strictEqual(
    Object.keys(pointsOf(oneuptime.sent[0]!)).length,
    MAX_GUESTS_PER_ROUND,
  );
  assert.ok(mostInFlight <= GUEST_TASKS_READ_CONCURRENCY);

  await reporterUnderTest.tick();
  const second: Array<string> = Object.keys(pointsOf(oneuptime.sent[1]!));
  // The 20 left over first, then from the start again.
  assert.ok(second.includes(`qemu/${1000 + MAX_GUESTS_PER_ROUND}`));
  assert.ok(second.includes(`qemu/${1000 + MAX_GUESTS_PER_ROUND + 19}`));
});

test("without a token it reads nothing, and says what to set", async (): Promise<void> => {
  await reporter({ PVE_HOST: PVE_HOST }).tick();

  assert.strictEqual(api.requests.length, 0);
  assert.match(logs.messages("warn")[0]!, /No Proxmox VE API token is set/);
});

test("how often: every 5 minutes by default, never more than once a minute, and 0 is off", (): void => {
  assert.strictEqual(
    readGuestTasksIntervalMs({}),
    DEFAULT_GUEST_TASKS_INTERVAL_MS,
  );
  assert.strictEqual(
    readGuestTasksIntervalMs({
      ONEUPTIME_PROXMOX_GUEST_TASKS_INTERVAL_SECONDS: "600",
    }),
    600_000,
  );
  assert.strictEqual(
    readGuestTasksIntervalMs({
      ONEUPTIME_PROXMOX_GUEST_TASKS_INTERVAL_SECONDS: "5",
    }),
    MIN_GUEST_TASKS_INTERVAL_MS,
  );
  assert.strictEqual(
    readGuestTasksIntervalMs({
      ONEUPTIME_PROXMOX_GUEST_TASKS_INTERVAL_SECONDS: "0",
    }),
    null,
  );
  assert.strictEqual(
    readGuestTasksIntervalMs({
      ONEUPTIME_PROXMOX_GUEST_TASKS_INTERVAL_SECONDS: "often",
    }),
    DEFAULT_GUEST_TASKS_INTERVAL_MS,
  );
  assert.strictEqual(
    reporter(
      pveEnv({ ONEUPTIME_PROXMOX_GUEST_TASKS_INTERVAL_SECONDS: "0" }),
    ).isEnabled(),
    false,
  );
});

test("the API's answers are read as they are written, and anything else is left out", (): void => {
  assert.deepStrictEqual(parseClusterGuests(GUESTS).length, GUESTS.length);
  assert.deepStrictEqual(
    parseClusterGuests([
      { type: "storage", node: "pve1", storage: "local" },
      { type: "qemu", vmid: "abc", node: "pve1" },
      { type: "lxc", vmid: 300 },
      "not a guest",
    ]),
    [],
  );
  assert.deepStrictEqual(parseTaskLog([{ id: 101 }, null, "x"]), []);
  assert.deepStrictEqual(
    parseTaskLog([
      { type: "qmstop", id: 101, user: "alice@pve", starttime: "1731457185" },
    ]),
    [{ type: "qmstop", id: "101", user: "alice@pve", starttime: 1731457185 }],
  );
});

test("the readings are one OTLP/JSON request with a datapoint per guest", (): void => {
  const body: Record<string, unknown> = buildGuestTaskMetrics({
    clusterName: CLUSTER,
    readings: [
      {
        guest: {
          vmid: 101,
          node: "pve1",
          type: "qemu",
          isStopped: true,
          isTemplate: false,
        },
        task: {
          type: "qmstop",
          user: "alice@pve",
          status: "OK",
          node: "pve1",
          at: 1731457187,
        },
      },
    ],
    nowMs: NOW_MS,
    agentVersion: "17.1.0",
  });
  const point: Point = pointsOf({ url: "", headers: {}, body: body })[
    "qemu/101"
  ]!;
  assert.strictEqual(point.value, 1731457187);
  const raw: Record<string, unknown> = (
    (
      (
        (body["resourceMetrics"] as Array<Record<string, unknown>>)[0]![
          "scopeMetrics"
        ] as Array<Record<string, unknown>>
      )[0]!["metrics"] as Array<Record<string, unknown>>
    )[0]!["gauge"] as Record<string, unknown>
  )["dataPoints"] as unknown as Record<string, unknown>;
  assert.strictEqual(
    (raw as unknown as Array<Record<string, unknown>>)[0]!["timeUnixNano"],
    `${NOW_MS}000000`,
  );
});
