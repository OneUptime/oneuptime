import { recordingLogger, testConfig } from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { after, before, describe, test } from "node:test";
import { AgentConfig } from "../Config";
import { createExecutor } from "../Executors/ExecutorFactory";
import { GuardPolicy } from "../Executors/PrepareGuard";
import ProxmoxExecutor, {
  AI_PVE_API_TOKEN_ID_ENV,
  AI_PVE_API_TOKEN_SECRET_ENV,
  DEFAULT_PVE_PORT,
  MAX_PVE_RESPONSE_BYTES,
  MAX_TASK_LOG_LINES,
  POSTURE_REQUEST_TIMEOUT_MS,
  ProxmoxConnectionResult,
  ProxmoxHttpRequest,
  ProxmoxHttpResponse,
  ProxmoxTransportError,
  ProxmoxTransportFailureKind,
  RenderedData,
  TASK_WAIT_HEADROOM_MS,
  buildProxmoxRequestPath,
  describeRequiredPrivilege,
  encodeProxmoxParams,
  parseProxmoxEnvelope,
  parsePveHost,
  renderProxmoxData,
  resolveProxmoxConnection,
} from "../Executors/ProxmoxExecutor";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  PreparedCommand,
  ResourceCommandRequest,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import { fakePolicy } from "./Helpers/FakeExecutor";
import { makeTempDir } from "./Helpers/FakeBinary";
import { TEST_RESOURCE_ID } from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_RESOURCE_AGENT_OUTPUT_BYTES,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";

/*
 * The Proxmox executor against a FAKE transport: every HTTPS request it
 * would send is recorded exactly (method, host, port, path, headers, body,
 * TLS settings, budget) and answered from a script, so each check, each
 * request it builds and each answer it reads is pinned without a Proxmox VE
 * node. The real HTTPS transport is tested against a local TLS server in
 * ProxmoxHttpsTransport.test.ts.
 */

const URL: string = "https://oneuptime.example.com";
const CLUSTER: string = "pve-prod";
const PVE_HOST: string = "192.168.1.10";
const TOKEN_ID: string = "monitoring@pam!oneuptime";
const TOKEN_SECRET: string = "0b7f2a1e-5c3d-4e8f-9a6b-1c2d3e4f5a6b";
const AI_TOKEN_ID: string = "oneuptime-ai@pve!fixes";
const AI_TOKEN_SECRET: string = "7d1c9e3a-2b4f-4c6d-8e0a-9f1b2c3d4e5f";
const USER_AGENT: string = "oneuptime-resource-ai-agent/14.0.8";
const UPID: string =
  "UPID:pve1:0001A2B3:0C4D5E6F:65A1B2C3:qmstart:101:oneuptime-ai@pve!fixes:";
// encodeURIComponent leaves "!" as it is (a valid path character).
const ENCODED_UPID: string =
  "UPID%3Apve1%3A0001A2B3%3A0C4D5E6F%3A65A1B2C3%3Aqmstart%3A101%3Aoneuptime-ai%40pve!fixes%3A";
const START: string = "pvesh create /nodes/pve1/qemu/101/status/start";

let tmpDir: string;

before((): void => {
  tmpDir = makeTempDir("agent-proxmox-");
});

after((): void => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---- Fakes ---------------------------------------------------------------------

type FakeAnswer = ProxmoxHttpResponse | Error;

class FakeTransport {
  public readonly requests: Array<ProxmoxHttpRequest> = [];

  public constructor(
    public responder: (
      request: ProxmoxHttpRequest,
      index: number,
    ) => FakeAnswer | Promise<FakeAnswer> = (): FakeAnswer => {
      return reply({ version: "8.2.4", release: "8.2" });
    },
  ) {}

  public readonly send: (
    request: ProxmoxHttpRequest,
  ) => Promise<ProxmoxHttpResponse> = async (
    request: ProxmoxHttpRequest,
  ): Promise<ProxmoxHttpResponse> => {
    this.requests.push(request);
    const answer: FakeAnswer = await this.responder(
      request,
      this.requests.length - 1,
    );

    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  };

  public paths(): Array<string> {
    return this.requests.map((request: ProxmoxHttpRequest): string => {
      return `${request.method} ${request.path}`;
    });
  }
}

// An API answer: {"data": data} with a 200 unless overridden.
function reply(
  data: unknown,
  overrides: Partial<ProxmoxHttpResponse> = {},
): ProxmoxHttpResponse {
  return {
    statusCode: 200,
    statusMessage: "OK",
    location: null,
    contentType: "application/json;charset=UTF-8",
    body: JSON.stringify({ data }),
    truncated: false,
    ...overrides,
  };
}

// An API error answer: PVE puts its reason in the status line.
function failure(
  statusCode: number,
  statusMessage: string,
  extra: Record<string, unknown> = {},
): ProxmoxHttpResponse {
  return reply(null, {
    statusCode,
    statusMessage,
    body: JSON.stringify({ data: null, ...extra }),
  });
}

function transportError(
  kind: ProxmoxTransportFailureKind,
  code: string | null = null,
  message: string = "failed",
): ProxmoxTransportError {
  return new ProxmoxTransportError({ kind, message, code });
}

// A clock that only moves when the executor sleeps.
class FakeClock {
  public nowMs: number = Date.parse("2026-09-29T10:00:00.000Z");
  public readonly sleeps: Array<number> = [];

  public readonly now: () => Date = (): Date => {
    return new Date(this.nowMs);
  };

  public readonly sleep: (ms: number) => Promise<void> = (
    ms: number,
  ): Promise<void> => {
    this.sleeps.push(ms);
    this.nowMs += ms;
    return Promise.resolve();
  };
}

function agentConfig(overrides: Record<string, string> = {}): AgentConfig {
  return testConfig(URL, {
    DOCKER_HOST_NAME: "",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "proxmox",
    PROXMOX_CLUSTER_NAME: CLUSTER,
    ...overrides,
  });
}

const WRITES_ON: Record<string, string> = { ONEUPTIME_AI_ALLOW_WRITES: "true" };

function pveEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PVE_HOST,
    PVE_API_TOKEN_ID: TOKEN_ID,
    PVE_API_TOKEN_SECRET: TOKEN_SECRET,
    ...overrides,
  };
}

interface Harness {
  executor: ProxmoxExecutor;
  transport: FakeTransport;
  clock: FakeClock;
}

function harness(
  data: {
    config?: AgentConfig | undefined;
    env?: NodeJS.ProcessEnv | undefined;
    transport?: FakeTransport | undefined;
    guardPolicy?: GuardPolicy | undefined;
    pollIntervalMs?: number | undefined;
  } = {},
): Harness {
  const transport: FakeTransport = data.transport || new FakeTransport();
  const clock: FakeClock = new FakeClock();
  const options: ExecutorOptions = {
    config: data.config || agentConfig(),
    env: data.env || pveEnv(),
    tmpDir,
    logger: recordingLogger(),
    now: clock.now,
    guardPolicy: data.guardPolicy,
  };

  return {
    executor: new ProxmoxExecutor(options, {
      transport: transport.send,
      sleep: clock.sleep,
      pollIntervalMs: data.pollIntervalMs ?? 1_000,
    }),
    transport,
    clock,
  };
}

// The argv of a command written with single spaces (no quoting needed).
function argvOf(command: string | Array<string>): Array<string> {
  return Array.isArray(command) ? command.slice() : command.split(" ");
}

// The payload OneUptime would send: the tier the real policy gives.
function payload(
  command: string | Array<string>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const argv: Array<string> = argvOf(command);

  return {
    resourceType: AiResourceType.ProxmoxCluster,
    resourceId: TEST_RESOURCE_ID,
    resourceIdentifier: CLUSTER,
    program: argv[0],
    args: argv.slice(1),
    displayCommand: argv.join(" "),
    tier: ResourceCommandPolicy.evaluateArgv({
      resourceType: AiResourceType.ProxmoxCluster,
      argv,
    }).tier,
    ...overrides,
  };
}

function request(
  command: string | Array<string>,
  overrides: Partial<ResourceCommandRequest> = {},
  payloadOverrides: Record<string, unknown> = {},
): ResourceCommandRequest {
  return {
    payload: payload(command, payloadOverrides),
    origin: "AiInvestigation",
    timeoutInMs: 30_000,
    agentResourceId: TEST_RESOURCE_ID,
    ...overrides,
  };
}

function writeRequest(
  command: string | Array<string>,
  overrides: Partial<ResourceCommandRequest> = {},
): ResourceCommandRequest {
  return request(command, { origin: "AiRemediation", ...overrides });
}

function prepared(result: PrepareResult): PreparedCommand {
  assert.strictEqual(
    result.refusal,
    null,
    `expected the command to be prepared, got: ${String(result.refusal)}`,
  );
  return result as PreparedCommand;
}

async function runCommand(
  h: Harness,
  req: ResourceCommandRequest,
): Promise<ExecResult> {
  return prepared(h.executor.prepare(req)).run();
}

function refusalOf(h: Harness, req: ResourceCommandRequest): string {
  const result: PrepareResult = h.executor.prepare(req);
  assert.notStrictEqual(result.refusal, null, "expected a refusal");
  return String(result.refusal);
}

// Each result the executor reports must hold neither token secret.
function assertNoSecret(value: unknown): void {
  const text: string = JSON.stringify(value);
  assert.ok(!text.includes(TOKEN_SECRET), `leaked the token secret: ${text}`);
  assert.ok(
    !text.includes(AI_TOKEN_SECRET),
    `leaked the AI token secret: ${text}`,
  );
}

const REFUSED: string = "Refused by the Proxmox AI agent";

// ---- prepare: PrepareGuard first -------------------------------------------------

describe("prepare: the shared checks run first", () => {
  test("a command for another Proxmox cluster is refused, and nothing is sent", () => {
    const h: Harness = harness();
    const refusal: string = refusalOf(
      h,
      request("pvesh get /version", {}, { resourceIdentifier: "pve-staging" }),
    );

    assert.match(
      refusal,
      /^Refused by the Proxmox AI agent: this command is for Proxmox cluster "pve-staging", but this agent serves "pve-prod"\. Check PROXMOX_CLUSTER_NAME/,
    );
    assert.strictEqual(h.transport.requests.length, 0);
  });

  test("a payload for another resource id is refused", () => {
    const h: Harness = harness();

    assert.match(
      refusalOf(
        h,
        request("pvesh get /version", {}, { resourceId: "someone-else" }),
      ),
      /this command is for resource id "someone-else", but this agent is registered for/,
    );
  });

  test("a payload for another resource type is refused", () => {
    const h: Harness = harness();

    assert.match(
      refusalOf(
        h,
        request("pvesh get /version", {}, { resourceType: "DockerHost" }),
      ),
      /this command is for a "DockerHost" resource, and this agent serves a Proxmox cluster/,
    );
  });

  test("a program other than pvesh is refused", () => {
    const h: Harness = harness();

    assert.match(
      refusalOf(h, request(["curl", "-k", "https://pve1:8006/api2/json"])),
      /"curl" is not a program the Proxmox AI agent runs \(it runs pvesh\)/,
    );
  });

  test("a job that is not from OneUptime AI is refused", () => {
    const h: Harness = harness();

    assert.match(
      refusalOf(h, request("pvesh get /version", { origin: "Runbook" })),
      /this job came from "Runbook"/,
    );
  });

  test("arguments that are not a list of strings are refused", () => {
    const h: Harness = harness();

    assert.match(
      refusalOf(h, request("pvesh get /version", {}, { args: ["get", 42] })),
      /without a command to run/,
    );
  });

  test("a Denied command never runs: pvesh set, /access, consoles", () => {
    const h: Harness = harness();

    for (const [command, reason] of [
      [
        "pvesh set /nodes/pve1/qemu/101/config",
        /pvesh set changes configuration/,
      ],
      ["pvesh get /access/users", /everything under \/access/],
      [
        "pvesh create /nodes/pve1/qemu/101/vncproxy",
        /console and terminal proxies/,
      ],
      ["pvesh delete /nodes/pve1/qemu/101", /pvesh delete removes objects/],
    ] as Array<[string, RegExp]>) {
      const refusal: string = refusalOf(h, writeRequest(command, {}));

      assert.ok(refusal.startsWith(`${REFUSED}: `), refusal);
      assert.match(refusal, reason);
    }

    assert.strictEqual(h.transport.requests.length, 0);
  });

  test("an investigation may only read", () => {
    const h: Harness = harness({ config: agentConfig(WRITES_ON) });

    assert.match(
      refusalOf(h, request(START)),
      /an investigation may only run read-only commands, and "pvesh create \/nodes\/pve1\/qemu\/101\/status\/start" is SafeWrite/,
    );
  });

  test("a write needs ONEUPTIME_AI_ALLOW_WRITES=true", () => {
    const h: Harness = harness();

    assert.match(
      refusalOf(h, writeRequest(START)),
      /changes the Proxmox cluster, and this agent is read-only \(ONEUPTIME_AI_ALLOW_WRITES is not set\)\. To let OneUptime AI apply fixes, set ONEUPTIME_AI_ALLOW_WRITES=true/,
    );
  });

  test("a write to a guest outside ONEUPTIME_AI_WRITE_TARGETS is refused", () => {
    const h: Harness = harness({
      config: agentConfig({
        ...WRITES_ON,
        ONEUPTIME_AI_WRITE_TARGETS: "2*",
      }),
    });

    assert.match(refusalOf(h, writeRequest(START)), /101/);
    assert.match(
      refusalOf(h, writeRequest(START)),
      /ONEUPTIME_AI_WRITE_TARGETS/,
    );

    // A guest inside the scope passes.
    prepared(
      h.executor.prepare(
        writeRequest("pvesh create /nodes/pve1/lxc/200/status/reboot"),
      ),
    );
  });

  test("a protected guest or node service is never changed", () => {
    const h: Harness = harness({
      config: agentConfig({
        ...WRITES_ON,
        ONEUPTIME_AI_PROTECTED_TARGETS: "101,pve1/pveproxy",
      }),
    });

    assert.match(refusalOf(h, writeRequest(START)), /101/);
    assert.match(
      refusalOf(
        h,
        writeRequest("pvesh create /nodes/pve1/services/pveproxy/restart"),
      ),
      /pve1\/pveproxy/,
    );
  });

  test("a command sent as a lower tier than the agent reads it is refused", () => {
    const h: Harness = harness({ config: agentConfig(WRITES_ON) });

    assert.match(
      refusalOf(
        h,
        writeRequest("pvesh create /nodes/pve1/qemu/101/status/stop", {
          payload: payload("pvesh create /nodes/pve1/qemu/101/status/stop", {
            tier: ResourceCommandTier.SafeWrite,
          }),
        }),
      ),
      /OneUptime sent "pvesh create \/nodes\/pve1\/qemu\/101\/status\/stop" as SafeWrite, but this agent's policy reads it as RiskyWrite/,
    );
  });
});

// ---- prepare: the executor's own checks --------------------------------------------

describe("prepare: the pvesh translation", () => {
  test("a command the policy passes but the pvesh translation refuses does not run", () => {
    // Only an injected policy can disagree with the real translation.
    const h: Harness = harness({
      guardPolicy: fakePolicy({
        "pvesh get /cluster/secrets": ResourceCommandTier.Read,
      }),
    });

    assert.match(
      refusalOf(h, request("pvesh get /cluster/secrets", {}, { tier: "Read" })),
      /^Refused by the Proxmox AI agent: its pvesh translation refuses "pvesh get \/cluster\/secrets": \/cluster\/secrets is not a path OneUptime AI may read/,
    );
    assert.strictEqual(h.transport.requests.length, 0);
  });

  test("a read tier on an HTTP POST (or a write tier on a GET) is refused", () => {
    const readPost: Harness = harness({
      guardPolicy: fakePolicy({ [START]: ResourceCommandTier.Read }),
    });

    assert.match(
      refusalOf(readPost, request(START, {}, { tier: "Read" })),
      /reads "pvesh create \/nodes\/pve1\/qemu\/101\/status\/start" as Read but it would be an HTTP POST/,
    );

    const writeGet: Harness = harness({
      config: agentConfig(WRITES_ON),
      guardPolicy: fakePolicy({
        "pvesh get /version": ResourceCommandTier.SafeWrite,
      }),
    });

    assert.match(
      refusalOf(
        writeGet,
        writeRequest("pvesh get /version", {
          payload: payload("pvesh get /version", { tier: "SafeWrite" }),
        }),
      ),
      /reads "pvesh get \/version" as SafeWrite but it would be an HTTP GET/,
    );
  });

  test("a prepared command says what it is and sends nothing until run", () => {
    const h: Harness = harness({ config: agentConfig(WRITES_ON) });
    const result: PreparedCommand = prepared(
      h.executor.prepare(writeRequest(`${START} --timeout 30`)),
    );

    assert.strictEqual(result.displayCommand, `${START} --timeout 30`);
    assert.strictEqual(result.tier, ResourceCommandTier.SafeWrite);
    assert.strictEqual(h.transport.requests.length, 0);
  });
});

describe("prepare: the agent's Proxmox settings", () => {
  const cases: Array<[string, NodeJS.ProcessEnv, RegExp]> = [
    [
      "PVE_HOST unset",
      pveEnv({ PVE_HOST: "" }),
      /PVE_HOST is not set\. Set it in the \.env file the AI agent shares with the Proxmox collector/,
    ],
    [
      "an http:// PVE_HOST",
      pveEnv({ PVE_HOST: "http://pve1:8006" }),
      /PVE_HOST="http:\/\/pve1:8006" is a http:\/\/ address, but the Proxmox VE API is served over HTTPS only/,
    ],
    [
      "a PVE_HOST with a path",
      pveEnv({ PVE_HOST: "https://pve1/some/path" }),
      /is not a host name or address\. Set it to a node's address only/,
    ],
    [
      "a PVE_HOST with credentials (never echoed)",
      pveEnv({ PVE_HOST: "http://root:Hunter2Pw@pve1" }),
      /^Refused by the Proxmox AI agent: PVE_HOST holds an "@", as if it carried a user name or password\. Set it to a node's address only/,
    ],
    [
      "a bad port in PVE_HOST",
      pveEnv({ PVE_HOST: "pve1:99999" }),
      /names a port that is not a number from 1 to 65535/,
    ],
    [
      "a bad PVE_PORT",
      pveEnv({ PVE_PORT: "eighty" }),
      /PVE_PORT="eighty" is not a port \(1-65535\)/,
    ],
    [
      "two different ports",
      pveEnv({ PVE_HOST: "pve1:8443", PVE_PORT: "8006" }),
      /PVE_HOST="pve1:8443" names port 8443 and PVE_PORT says 8006/,
    ],
    [
      "no token at all",
      pveEnv({ PVE_API_TOKEN_ID: "", PVE_API_TOKEN_SECRET: "" }),
      /No Proxmox VE API token is set\. Set PVE_API_TOKEN_ID and PVE_API_TOKEN_SECRET .* or ONEUPTIME_AI_PVE_API_TOKEN_ID and ONEUPTIME_AI_PVE_API_TOKEN_SECRET/,
    ],
    [
      "the collector's token id without its secret",
      pveEnv({ PVE_API_TOKEN_SECRET: "" }),
      /PVE_API_TOKEN_ID is set but PVE_API_TOKEN_SECRET is not/,
    ],
    [
      "the AI token's secret without its id",
      pveEnv({ [AI_PVE_API_TOKEN_SECRET_ENV]: AI_TOKEN_SECRET }),
      /ONEUPTIME_AI_PVE_API_TOKEN_SECRET is set but ONEUPTIME_AI_PVE_API_TOKEN_ID is not\. .* or neither, to use PVE_API_TOKEN_ID and PVE_API_TOKEN_SECRET/,
    ],
    [
      "a token id that is not user@realm!tokenname",
      pveEnv({ PVE_API_TOKEN_ID: `PVEAPIToken=${TOKEN_ID}` }),
      /PVE_API_TOKEN_ID is not a Proxmox VE API token id\. Write it exactly as the Proxmox UI shows it, user@realm!tokenname/,
    ],
    [
      "a token id without the token name",
      pveEnv({ PVE_API_TOKEN_ID: "monitoring@pam" }),
      /PVE_API_TOKEN_ID is not a Proxmox VE API token id/,
    ],
    [
      "a token id that cannot go into an HTTP header",
      pveEnv({ PVE_API_TOKEN_ID: "m\u00f6nitoring@pam!oneuptime" }),
      /PVE_API_TOKEN_ID is not a Proxmox VE API token id/,
    ],
    [
      "a secret with a space in it",
      pveEnv({ PVE_API_TOKEN_SECRET: "abc def" }),
      /PVE_API_TOKEN_SECRET is not a Proxmox VE API token secret/,
    ],
  ];

  for (const [name, env, expected] of cases) {
    test(`${name}: refused, naming what to set, and nothing is sent`, () => {
      const h: Harness = harness({ env });
      const refusal: string = refusalOf(h, request("pvesh get /version"));

      assert.ok(refusal.startsWith(`${REFUSED}: `), refusal);
      assert.match(refusal, expected);
      assertNoSecret(refusal);
      assert.ok(!refusal.includes("Hunter2Pw"), refusal);
      assert.strictEqual(h.transport.requests.length, 0);
    });
  }

  test("the settings come from the executor's env only, never process.env", () => {
    const saved: string | undefined = process.env["PVE_HOST"];
    process.env["PVE_HOST"] = "10.9.9.9";

    try {
      const h: Harness = harness({ env: pveEnv({ PVE_HOST: "" }) });

      assert.match(
        refusalOf(h, request("pvesh get /version")),
        /PVE_HOST is not set/,
      );
    } finally {
      if (saved === undefined) {
        delete process.env["PVE_HOST"];
      } else {
        process.env["PVE_HOST"] = saved;
      }
    }
  });
});

// ---- Connection settings -------------------------------------------------------------

describe("resolveProxmoxConnection / parsePveHost", () => {
  test("PVE_HOST spellings", () => {
    assert.deepStrictEqual(parsePveHost("192.168.1.10"), {
      host: "192.168.1.10",
      port: null,
    });
    assert.deepStrictEqual(parsePveHost(" pve1.example.com "), {
      host: "pve1.example.com",
      port: null,
    });
    assert.deepStrictEqual(parsePveHost("https://pve1.example.com:8443/"), {
      host: "pve1.example.com",
      port: 8443,
    });
    assert.deepStrictEqual(
      parsePveHost("HTTPS://pve1.example.com:8006/api2/json/"),
      { host: "pve1.example.com", port: 8006 },
    );
    assert.deepStrictEqual(parsePveHost("[fd00::10]:8006"), {
      host: "fd00::10",
      port: 8006,
    });
    assert.deepStrictEqual(parsePveHost("[fd00::10]"), {
      host: "fd00::10",
      port: null,
    });
    assert.deepStrictEqual(parsePveHost("fd00::10"), {
      host: "fd00::10",
      port: null,
    });
    assert.strictEqual(typeof parsePveHost("[pve1]:8006"), "string");
    assert.strictEqual(typeof parsePveHost("pve 1"), "string");
    assert.strictEqual(typeof parsePveHost("-pve1"), "string");
    assert.strictEqual(typeof parsePveHost("pve1:0"), "string");
    assert.strictEqual(typeof parsePveHost("ftp://pve1"), "string");
  });

  test("the collector's token by default; the AI agent's own when set", () => {
    const collector: ProxmoxConnectionResult =
      resolveProxmoxConnection(pveEnv());

    assert.deepStrictEqual(collector, {
      connection: {
        host: PVE_HOST,
        port: DEFAULT_PVE_PORT,
        endpoint: "https://192.168.1.10:8006",
        tokenId: TOKEN_ID,
        tokenSecret: TOKEN_SECRET,
        tokenSource: "PVE_API_TOKEN_ID",
        tokenSecretSource: "PVE_API_TOKEN_SECRET",
        isAgentToken: false,
        verifyTls: false,
        caFile: null,
      },
      problem: null,
    });

    const own: ProxmoxConnectionResult = resolveProxmoxConnection(
      pveEnv({
        [AI_PVE_API_TOKEN_ID_ENV]: AI_TOKEN_ID,
        [AI_PVE_API_TOKEN_SECRET_ENV]: AI_TOKEN_SECRET,
      }),
    );

    assert.strictEqual(own.connection?.tokenId, AI_TOKEN_ID);
    assert.strictEqual(own.connection?.tokenSecret, AI_TOKEN_SECRET);
    assert.strictEqual(own.connection?.tokenSource, AI_PVE_API_TOKEN_ID_ENV);
    assert.strictEqual(own.connection?.isAgentToken, true);
  });

  test("TLS verification: off by default, on with PVE_VERIFY_SSL, a typo verifies, and a CA file always verifies", () => {
    const verify: (env: Record<string, string>) => boolean | undefined = (
      env: Record<string, string>,
    ): boolean | undefined => {
      return resolveProxmoxConnection(pveEnv(env)).connection?.verifyTls;
    };

    assert.strictEqual(verify({}), false);
    assert.strictEqual(verify({ PVE_VERIFY_SSL: "false" }), false);
    assert.strictEqual(verify({ PVE_VERIFY_SSL: "0" }), false);
    assert.strictEqual(verify({ PVE_VERIFY_SSL: "No" }), false);
    assert.strictEqual(verify({ PVE_VERIFY_SSL: "true" }), true);
    assert.strictEqual(verify({ PVE_VERIFY_SSL: "1" }), true);
    assert.strictEqual(verify({ PVE_VERIFY_SSL: "flase" }), true);
    assert.strictEqual(verify({ PVE_CA_FILE: "/etc/pve-ca.pem" }), true);
    /*
     * The Proxmox compose file passes PVE_VERIFY_SSL=false by default for the
     * exporter, so an explicit "off" must not cancel a CA the operator named.
     */
    assert.strictEqual(
      verify({ PVE_CA_FILE: "/etc/pve-ca.pem", PVE_VERIFY_SSL: "false" }),
      true,
    );
  });

  test("PVE_PORT is used when PVE_HOST names none, and may repeat the one it names", () => {
    assert.strictEqual(
      resolveProxmoxConnection(pveEnv({ PVE_PORT: "8443" })).connection?.port,
      8443,
    );
    assert.strictEqual(
      resolveProxmoxConnection(
        pveEnv({ PVE_HOST: "pve1:8443", PVE_PORT: "8443" }),
      ).connection?.endpoint,
      "https://pve1:8443",
    );
    assert.strictEqual(
      resolveProxmoxConnection(pveEnv({ PVE_HOST: "fd00::10" })).connection
        ?.endpoint,
      "https://[fd00::10]:8006",
    );
  });
});

// ---- The request it sends -----------------------------------------------------------

describe("the HTTPS request", () => {
  test("a read: GET with the token header, nothing else, no body", async () => {
    const h: Harness = harness();
    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /cluster/status"),
    );

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(h.transport.requests, [
      {
        method: "GET",
        hostname: PVE_HOST,
        port: 8006,
        path: "/api2/json/cluster/status",
        headers: {
          Authorization: `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        body: null,
        verifyTls: false,
        ca: null,
        timeoutInMs: 30_000,
        maxResponseBytes: MAX_PVE_RESPONSE_BYTES,
      },
    ]);
  });

  test("the agent's environment adds nothing: no proxy, no stray header", async () => {
    const h: Harness = harness({
      env: pveEnv({
        HTTPS_PROXY: "http://proxy.corp:3128",
        HTTP_PROXY: "http://proxy.corp:3128",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: "ingestion-key-1",
        PVEAPIToken: "x",
      }),
    });

    await runCommand(h, request("pvesh get /version"));

    const sent: ProxmoxHttpRequest | undefined = h.transport.requests[0];
    assert.ok(sent);
    assert.strictEqual(sent.hostname, PVE_HOST);
    assert.deepStrictEqual(Object.keys(sent.headers).sort(), [
      "Accept",
      "Authorization",
      "User-Agent",
    ]);
    assert.ok(!JSON.stringify(sent).includes("ingestion-key-1"));
    assert.ok(!JSON.stringify(sent).includes("proxy.corp"));
  });

  test("options become the query string, in order, spaces as %20", async () => {
    const h: Harness = harness();

    await runCommand(
      h,
      request([
        "pvesh",
        "get",
        "/nodes/pve1/syslog",
        "--since",
        "2025-01-31 14:05",
        "--limit",
        "10",
      ]),
    );
    await runCommand(
      h,
      request("pvesh get /nodes/pve1/tasks --errors 1 --limit 20"),
    );

    assert.deepStrictEqual(h.transport.paths(), [
      "GET /api2/json/nodes/pve1/syslog?since=2025-01-31%2014%3A05&limit=10",
      "GET /api2/json/nodes/pve1/tasks?errors=1&limit=20",
    ]);
  });

  test("--output-format is the agent's, never sent to the API", async () => {
    const h: Harness = harness();

    await runCommand(
      h,
      request("pvesh get /cluster/resources --type vm --output-format json"),
    );

    assert.deepStrictEqual(h.transport.paths(), [
      "GET /api2/json/cluster/resources?type=vm",
    ]);
  });

  test("a task id in the path is percent-encoded segment by segment", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply({ status: "stopped", exitstatus: "OK" });
      }),
    });

    await runCommand(h, request(`pvesh get /nodes/pve1/tasks/${UPID}/status`));

    assert.deepStrictEqual(h.transport.paths(), [
      `GET /api2/json/nodes/pve1/tasks/${ENCODED_UPID}/status`,
    ]);
  });

  test("a write: POST with a form body and its length", async () => {
    const h: Harness = harness({
      config: agentConfig(WRITES_ON),
      transport: new FakeTransport((): FakeAnswer => {
        return reply(null);
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      writeRequest(`${START} --timeout 30`),
    );

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(h.transport.requests[0], {
      method: "POST",
      hostname: PVE_HOST,
      port: 8006,
      path: "/api2/json/nodes/pve1/qemu/101/status/start",
      headers: {
        Authorization: `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": "10",
      },
      body: "timeout=30",
      verifyTls: false,
      ca: null,
      timeoutInMs: 30_000,
      maxResponseBytes: MAX_PVE_RESPONSE_BYTES,
    });
  });

  test("a write without options still sends an (empty) form body", async () => {
    const h: Harness = harness({
      config: agentConfig(WRITES_ON),
      transport: new FakeTransport((): FakeAnswer => {
        return reply(null);
      }),
    });

    await runCommand(
      h,
      writeRequest("pvesh create /nodes/pve1/qemu/101/status/stop"),
    );

    assert.strictEqual(h.transport.requests[0]?.body, "");
    assert.strictEqual(h.transport.requests[0]?.headers["Content-Length"], "0");
  });

  test("the AI agent's own token wins over the collector's", async () => {
    const h: Harness = harness({
      env: pveEnv({
        [AI_PVE_API_TOKEN_ID_ENV]: AI_TOKEN_ID,
        [AI_PVE_API_TOKEN_SECRET_ENV]: AI_TOKEN_SECRET,
      }),
    });

    await runCommand(h, request("pvesh get /version"));

    assert.strictEqual(
      h.transport.requests[0]?.headers["Authorization"],
      `PVEAPIToken=${AI_TOKEN_ID}=${AI_TOKEN_SECRET}`,
    );
  });

  test("host, port and the command's time budget are passed through", async () => {
    const h: Harness = harness({
      env: pveEnv({ PVE_HOST: "https://[fd00::10]:8443" }),
    });

    await runCommand(h, request("pvesh get /version", { timeoutInMs: 7_500 }));

    assert.strictEqual(h.transport.requests[0]?.hostname, "fd00::10");
    assert.strictEqual(h.transport.requests[0]?.port, 8443);
    assert.strictEqual(h.transport.requests[0]?.timeoutInMs, 7_500);
  });

  test("with verification on, PVE_CA_FILE's certificate is the trust anchor", async () => {
    const caFile: string = path.join(tmpDir, "pve-root-ca.pem");
    fs.writeFileSync(
      caFile,
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
    );
    const h: Harness = harness({ env: pveEnv({ PVE_CA_FILE: caFile }) });

    await runCommand(h, request("pvesh get /version"));

    assert.strictEqual(h.transport.requests[0]?.verifyTls, true);
    assert.match(String(h.transport.requests[0]?.ca), /BEGIN CERTIFICATE/);
  });

  test("an unreadable PVE_CA_FILE: nothing is sent, and it says what to mount", async () => {
    const h: Harness = harness({
      env: pveEnv({ PVE_CA_FILE: path.join(tmpDir, "missing.pem") }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /version"),
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.output, "");
    assert.strictEqual(result.exitCode, undefined);
    assert.match(
      String(result.errorMessage),
      /Could not read PVE_CA_FILE=".*missing\.pem" \(ENOENT\)\. Mount the cluster's CA certificate \(\/etc\/pve\/pve-root-ca\.pem on any node\)/,
    );
    assert.strictEqual(h.transport.requests.length, 0);
  });

  test("buildProxmoxRequestPath and encodeProxmoxParams", () => {
    assert.strictEqual(
      buildProxmoxRequestPath({
        method: "GET",
        path: "/nodes/pve1/disks/smart",
        params: { disk: "/dev/sda", healthonly: "1" },
        outputFormat: null,
      }),
      "/api2/json/nodes/pve1/disks/smart?disk=%2Fdev%2Fsda&healthonly=1",
    );
    assert.strictEqual(
      buildProxmoxRequestPath({
        method: "POST",
        path: "/nodes/pve1/lxc/200/migrate",
        params: { target: "pve2", restart: "1" },
        outputFormat: null,
      }),
      "/api2/json/nodes/pve1/lxc/200/migrate",
    );
    assert.strictEqual(
      encodeProxmoxParams({ target: "pve2", restart: "1" }),
      "target=pve2&restart=1",
    );
    assert.strictEqual(encodeProxmoxParams({}), "");
  });
});

// ---- Output ----------------------------------------------------------------------------

describe("output", () => {
  const RESOURCES: Array<Record<string, unknown>> = [
    {
      id: "qemu/101",
      type: "qemu",
      node: "pve1",
      vmid: 101,
      name: "web-1",
      status: "running",
      maxmem: 4294967296,
    },
    {
      id: "lxc/200",
      type: "lxc",
      node: "pve2",
      vmid: 200,
      name: "dns",
      status: "stopped",
      tags: ["infra", "dns"],
    },
  ];

  test("json-pretty by default: the data member, not the {data} envelope", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply({ version: "8.2.4", release: "8.2", repoid: "faa83925" });
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /version"),
    );

    assert.deepStrictEqual(result, {
      success: true,
      exitCode: 0,
      output:
        '[stdout]\n{\n  "version": "8.2.4",\n  "release": "8.2",\n  "repoid": "faa83925"\n}',
    });
  });

  test("json: one line", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply(RESOURCES);
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /cluster/resources --type vm --output-format json"),
    );

    assert.strictEqual(result.output, `[stdout]\n${JSON.stringify(RESOURCES)}`);
  });

  test("text: a list of objects is an aligned table", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply(RESOURCES);
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /cluster/resources --output-format text"),
    );

    assert.strictEqual(
      result.output,
      [
        "[stdout]",
        "id        type  node  vmid  name   status   maxmem      tags",
        "qemu/101  qemu  pve1  101   web-1  running  4294967296",
        'lxc/200   lxc   pve2  200   dns    stopped              ["infra","dns"]',
      ].join("\n"),
    );
  });

  test("text: an object is sorted key: value lines, secrets masked", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply({
          name: "web-1",
          cipassword: "hunter2",
          cores: 4,
          net0: "virtio=BC:24:11:00:00:01,bridge=vmbr0",
          description: "line one\nline two",
        });
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /nodes/pve1/qemu/101/config --output-format text"),
    );

    assert.strictEqual(
      result.output,
      [
        "[stdout]",
        "cipassword: [redacted]",
        "cores: 4",
        'description: "line one\\nline two"',
        "name: web-1",
        "net0: virtio=BC:24:11:00:00:01,bridge=vmbr0",
      ].join("\n"),
    );
  });

  for (const format of ["json-pretty", "json", "text"]) {
    test(`${format}: a guest's cloud-init password and pending secrets never leave the agent`, async () => {
      const h: Harness = harness({
        transport: new FakeTransport((req: ProxmoxHttpRequest): FakeAnswer => {
          return req.path.endsWith("/pending")
            ? reply([
                {
                  key: "cipassword",
                  value: "old-secret",
                  pending: "new-secret",
                },
                { key: "cores", value: 2, pending: 4 },
              ])
            : reply({
                cipassword: "hunter2",
                sshkeys: "ssh-ed25519%20AAAAC3NzaC1lZDI1NTE5AAAAIPp",
                name: "web-1",
              });
        }),
      });

      const config: ExecResult = await runCommand(
        h,
        request(
          `pvesh get /nodes/pve1/qemu/101/config --output-format ${format}`,
        ),
      );
      const pending: ExecResult = await runCommand(
        h,
        request(
          `pvesh get /nodes/pve1/qemu/101/pending --output-format ${format}`,
        ),
      );

      for (const result of [config, pending]) {
        assert.strictEqual(result.success, true);
        for (const secret of [
          "hunter2",
          "old-secret",
          "new-secret",
          "AAAAC3Nza",
        ]) {
          assert.ok(
            !result.output.includes(secret),
            `${format} leaked ${secret}: ${result.output}`,
          );
        }
      }

      assert.match(config.output, /web-1/);
      assert.match(pending.output, /cores/);
    });
  }

  test("text: a secret-named column of a table is masked", () => {
    const rendered: RenderedData = renderProxmoxData(
      [
        {
          storage: "pbs",
          type: "pbs",
          password: "s3cret",
          "encryption-key": "k",
        },
        { storage: "local", type: "dir" },
      ],
      "text",
      {
        budgetBytes: 100_000,
        isSecretName: (name: string): boolean => {
          return ["password", "encryption-key"].includes(name);
        },
      },
    );

    assert.strictEqual(
      rendered.text,
      [
        "type  encryption-key  password    storage",
        "pbs   [redacted]      [redacted]  pbs",
        "dir                               local",
      ].join("\n"),
    );
  });

  test("text: a list of values is one per line; a scalar is itself", () => {
    const isSecretName: (name: string) => boolean = (): boolean => {
      return false;
    };

    assert.strictEqual(
      renderProxmoxData(["a", 1, true, null], "text", {
        budgetBytes: 1_000,
        isSecretName,
      }).text,
      "a\n1\ntrue\n",
    );
    assert.strictEqual(
      renderProxmoxData(UPID, "text", { budgetBytes: 1_000, isSecretName })
        .text,
      UPID,
    );
    assert.strictEqual(
      renderProxmoxData(null, "json-pretty", {
        budgetBytes: 1_000,
        isSecretName,
      }).text,
      "null",
    );
    assert.strictEqual(
      renderProxmoxData([], "json-pretty", { budgetBytes: 1_000, isSecretName })
        .text,
      "[]",
    );
    assert.strictEqual(
      renderProxmoxData({}, "json", { budgetBytes: 1_000, isSecretName }).text,
      "{}",
    );
  });

  test("json-pretty renders entry by entry exactly as JSON.stringify would", () => {
    const data: Record<string, unknown> = {
      a: [1, { b: "c" }],
      d: { e: null, f: [] },
      g: "h",
    };

    assert.strictEqual(
      renderProxmoxData(data, "json-pretty", {
        budgetBytes: 100_000,
        isSecretName: (): boolean => {
          return false;
        },
      }).text,
      JSON.stringify(data, null, 2),
    );
    assert.strictEqual(
      renderProxmoxData(RESOURCES, "json-pretty", {
        budgetBytes: 100_000,
        isSecretName: (): boolean => {
          return false;
        },
      }).text,
      JSON.stringify(RESOURCES, null, 2),
    );
  });

  test("a long list is printed in whole entries, then capped at the output limit", async () => {
    const lines: Array<Record<string, unknown>> = [];

    for (let n: number = 1; n <= 20_000; n++) {
      lines.push({
        n,
        t: `Sep 29 10:00:00 pve1 pvedaemon[1234]: <root@pam> starting task ${n}`,
      });
    }

    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply(lines);
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /nodes/pve1/syslog --limit 5000"),
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(
      Buffer.byteLength(result.output, "utf8") <=
        MAX_RESOURCE_AGENT_OUTPUT_BYTES + 200,
      `output is ${Buffer.byteLength(result.output, "utf8")} bytes`,
    );
    assert.match(result.output, /^\[stdout\]\n\[\n {2}\{\n {4}"n": 1,/);
    assert.match(
      result.output,
      /\.\.\. \[output truncated: stdout cut at \d+ bytes\]$/,
    );
  });

  test("the render budget leaves out whole entries and says how many", () => {
    const items: Array<Record<string, unknown>> = [];

    for (let n: number = 0; n < 100; n++) {
      items.push({ n, t: "x".repeat(100) });
    }

    const rendered: RenderedData = renderProxmoxData(items, "json", {
      budgetBytes: 1_000,
      isSecretName: (): boolean => {
        return false;
      },
    });

    assert.ok(rendered.omitted > 0 && rendered.omitted < 100);
    // What is printed is still whole, valid JSON.
    const printed: Array<unknown> = JSON.parse(rendered.text) as Array<unknown>;
    assert.strictEqual(printed.length + rendered.omitted, 100);
  });

  test("an answer larger than the read limit is not printed at all", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply(null, {
          body: '{"data":[{"t":"password=hunt',
          truncated: true,
        });
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /nodes/pve1/syslog"),
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.exitCode, 0);
    assert.match(
      result.output,
      /larger than 4194304 bytes, so the agent does not print it\. Ask for less: most lists take --limit/,
    );
    assert.ok(!result.output.includes("hunt"));
  });

  test("a NUL in the answer is replaced (a Postgres text column cannot hold it)", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply(["a\u0000b"]);
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /nodes/pve1/syslog --output-format text"),
    );

    assert.ok(!result.output.includes("\u0000"));
  });

  test("a secret in a task's exit status or a redirect's target is redacted", async () => {
    const task: Harness = harness({
      config: agentConfig(WRITES_ON),
      transport: new FakeTransport((req: ProxmoxHttpRequest): FakeAnswer => {
        return req.method === "POST"
          ? reply(UPID)
          : reply({
              status: "stopped",
              exitstatus: "mount failed (password=Sup3rS3cret!)",
            });
      }),
    });

    const failed: ExecResult = await runCommand(task, writeRequest(START));

    assert.strictEqual(failed.exitCode, 1);
    assert.ok(!JSON.stringify(failed).includes("Sup3rS3cret"));

    const redirect: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply(null, {
          statusCode: 302,
          location: "https://admin:Sup3rS3cret@sso.example.com/login",
          body: "",
        });
      }),
    });

    const redirected: ExecResult = await runCommand(
      redirect,
      request("pvesh get /version"),
    );

    assert.ok(!JSON.stringify(redirected).includes("Sup3rS3cret"));
    assert.match(String(redirected.errorMessage), /sso\.example\.com/);
  });

  test("a secret in the API's status line is redacted from the error too", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return failure(500, "storage error: password=Sup3rS3cret!");
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /storage"),
    );

    assert.strictEqual(result.success, false);
    assert.ok(!String(result.errorMessage).includes("Sup3rS3cret"));
    assert.ok(!result.output.includes("Sup3rS3cret"));
  });
});

// ---- HTTP answers --------------------------------------------------------------------

describe("HTTP errors", () => {
  test("403 on a write with the collector's token: which privilege, and a token of its own", async () => {
    const h: Harness = harness({
      config: agentConfig(WRITES_ON),
      transport: new FakeTransport((): FakeAnswer => {
        return failure(403, "Permission check failed (/vms/101, VM.PowerMgmt)");
      }),
    });

    const result: ExecResult = await runCommand(h, writeRequest(START));

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(
      result.output,
      "[stderr]\nHTTP 403 Permission check failed (/vms/101, VM.PowerMgmt)",
    );
    assert.strictEqual(
      result.errorMessage,
      `Exit code 1: the Proxmox VE API answered HTTP 403 (Permission check failed (/vms/101, VM.PowerMgmt)). The token "${TOKEN_ID}" (PVE_API_TOKEN_ID) lacks the permission for this call: it typically needs VM.PowerMgmt on /vms/101 (the PVEVMUser role has it). Grant it under Datacenter → Permissions (to the token itself when it has privilege separation). The collector's token is meant to stay read-only (PVEAuditor): give the AI agent a token of its own with this privilege in ONEUPTIME_AI_PVE_API_TOKEN_ID and ONEUPTIME_AI_PVE_API_TOKEN_SECRET.`,
    );
    assertNoSecret(result);
  });

  test("403 with the AI agent's own token does not suggest another token", async () => {
    const h: Harness = harness({
      config: agentConfig(WRITES_ON),
      env: pveEnv({
        [AI_PVE_API_TOKEN_ID_ENV]: AI_TOKEN_ID,
        [AI_PVE_API_TOKEN_SECRET_ENV]: AI_TOKEN_SECRET,
      }),
      transport: new FakeTransport((): FakeAnswer => {
        return failure(
          403,
          "Permission check failed (/nodes/pve1, Sys.Modify)",
        );
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      writeRequest("pvesh create /nodes/pve1/services/pveproxy/restart"),
    );

    assert.match(
      String(result.errorMessage),
      /The token "oneuptime-ai@pve!fixes" \(ONEUPTIME_AI_PVE_API_TOKEN_ID\) lacks the permission for this call: it typically needs Sys\.Modify on \/nodes\/pve1/,
    );
    assert.ok(!String(result.errorMessage).includes("a token of its own"));
    assertNoSecret(result);
  });

  test("401: the token was not accepted; check its id and secret", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return failure(401, "authentication failure");
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /version"),
    );

    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /^Exit code 1: the Proxmox VE API answered HTTP 401 \(authentication failure\)\. The API did not accept the token "monitoring@pam!oneuptime" \(PVE_API_TOKEN_ID\): check the token id \(user@realm!tokenname\) and its secret \(PVE_API_TOKEN_SECRET\)/,
    );
    assertNoSecret(result);
  });

  test("400: the API's per-parameter errors are quoted", async () => {
    const h: Harness = harness({
      config: agentConfig(WRITES_ON),
      transport: new FakeTransport((): FakeAnswer => {
        return failure(400, "Parameter verification failed.", {
          errors: { timeout: "value must have a maximum value of 3600" },
        });
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      writeRequest(`${START} --timeout 30`),
    );

    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(
      result.errorMessage,
      "Exit code 1: the Proxmox VE API answered HTTP 400 (Parameter verification failed.: timeout: value must have a maximum value of 3600).",
    );
    assert.strictEqual(
      result.output,
      "[stderr]\nHTTP 400 Parameter verification failed.: timeout: value must have a maximum value of 3600",
    );
  });

  test("500: the API's reason (a guest already running) is the error", async () => {
    const h: Harness = harness({
      config: agentConfig(WRITES_ON),
      transport: new FakeTransport((): FakeAnswer => {
        return failure(500, "VM 101 already running");
      }),
    });

    const result: ExecResult = await runCommand(h, writeRequest(START));

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(
      result.errorMessage,
      "Exit code 1: the Proxmox VE API answered HTTP 500 (VM 101 already running).",
    );
  });

  test("595: the target node is unreachable from the node the agent talks to", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return failure(595, "Connection refused");
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /nodes/pve3/status"),
    );

    assert.match(
      String(result.errorMessage),
      /could not reach the node this call is for: that node may be offline/,
    );
  });

  test("404/501: the path may not exist on this version", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return failure(501, "Method 'GET /nodes/pve1/journal' not implemented");
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /nodes/pve1/journal --lastentries 5"),
    );

    assert.match(
      String(result.errorMessage),
      /This Proxmox VE version may not have \/nodes\/pve1\/journal/,
    );
  });

  test("a redirect is never followed, and reads as never ran", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply(null, {
          statusCode: 302,
          statusMessage: "Found",
          location: "https://sso.example.com/login",
          body: "",
        });
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /version"),
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage:
        "The server at https://192.168.1.10:8006 answered GET /version with a redirect (HTTP 302 to https://sso.example.com/login), which the agent never follows. Point PVE_HOST (and PVE_PORT) at a Proxmox VE node's API itself, not at a proxy or a login page.",
    });
    assert.strictEqual(h.transport.requests.length, 1);
  });

  test("a 200 that is not the API's JSON (a proxy's page) fails", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply(null, {
          contentType: "text/html",
          body: "<html><body>Welcome to nginx</body></html>",
        });
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /version"),
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, /Welcome to nginx/);
    assert.match(
      result.output,
      /\[stderr\]\nHTTP 200: the answer is not the Proxmox VE API's JSON \(text\/html\)/,
    );
    assert.match(
      String(result.errorMessage),
      /Check that PVE_HOST and PVE_PORT point at a Proxmox VE node's API \(port 8006 by default\)/,
    );
  });

  test("describeRequiredPrivilege names the usual privilege per call", () => {
    const privilege: (method: "GET" | "POST", apiPath: string) => string = (
      method: "GET" | "POST",
      apiPath: string,
    ): string => {
      return describeRequiredPrivilege({
        method,
        path: apiPath,
        params: {},
        outputFormat: null,
      });
    };

    assert.match(
      privilege("POST", "/nodes/pve1/lxc/200/status/reboot"),
      /^VM\.PowerMgmt on \/vms\/200/,
    );
    assert.match(
      privilege("POST", "/nodes/pve1/qemu/101/migrate"),
      /^VM\.Migrate on \/vms\/101 \(the PVEVMAdmin role/,
    );
    assert.match(
      privilege("POST", "/nodes/pve2/services/pvestatd/restart"),
      /^Sys\.Modify on \/nodes\/pve2/,
    );
    assert.match(
      privilege("GET", "/nodes/pve1/syslog"),
      /^Sys\.Syslog on \/nodes\/pve1 \(the PVEAuditor role does not have it/,
    );
    assert.match(privilege("GET", "/nodes/pve1/journal"), /^Sys\.Syslog/);
    assert.match(
      privilege("GET", "/nodes/pve1/qemu/101/agent/get-osinfo"),
      /^VM\.GuestAgent\.Audit on \/vms\/101/,
    );
    assert.match(
      privilege("GET", "/nodes/pve1/qemu/101/config"),
      /^VM\.Audit on \/vms\/101/,
    );
    assert.match(privilege("GET", "/storage"), /^Datastore\.Audit/);
    assert.match(
      privilege("GET", "/nodes/pve1/storage/local/status"),
      /^Datastore\.Audit/,
    );
    assert.match(privilege("GET", "/pools"), /^Pool\.Audit/);
    assert.match(privilege("GET", "/nodes/pve1/apt/update"), /^Sys\.Modify/);
    assert.match(privilege("GET", "/cluster/status"), /^Sys\.Audit/);
  });

  test("parseProxmoxEnvelope", () => {
    assert.deepStrictEqual(parseProxmoxEnvelope('{"data":[1]}'), {
      data: [1],
      errors: null,
    });
    assert.deepStrictEqual(
      parseProxmoxEnvelope('{"data":null,"errors":{"vmid":"bad"}}'),
      { data: null, errors: { vmid: "bad" } },
    );
    assert.strictEqual(parseProxmoxEnvelope("[1]"), null);
    assert.strictEqual(parseProxmoxEnvelope("<html>"), null);
  });
});

describe("no answer", () => {
  test("connection refused: never ran (no exit code, no output); localhost says why", async () => {
    const h: Harness = harness({
      env: pveEnv({ PVE_HOST: "localhost" }),
      transport: new FakeTransport((): FakeAnswer => {
        return transportError(
          "connect",
          "ECONNREFUSED",
          "connect ECONNREFUSED 127.0.0.1:8006",
        );
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /version"),
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage:
        "Could not connect to the Proxmox VE API at https://localhost:8006: nothing is listening there (connection refused). Check PVE_HOST (any node of the cluster) and PVE_PORT (8006 by default), and that the agent's network reaches it. PVE_HOST is \"localhost\", which inside the agent's container is the container itself: set it to a node's address.",
    });
  });

  test("a name that does not resolve, no route, no connection in time", async () => {
    const cases: Array<[ProxmoxTransportError, RegExp]> = [
      [
        transportError("connect", "ENOTFOUND"),
        /the name "192\.168\.1\.10" does not resolve \(ENOTFOUND\)/,
      ],
      [
        transportError("connect", "EHOSTUNREACH"),
        /there is no route to it \(EHOSTUNREACH\)/,
      ],
      [transportError("connect-timeout"), /no connection within 30000ms/],
      [
        transportError("connect", "EWHATEVER", "odd failure"),
        /odd failure \(EWHATEVER\)/,
      ],
    ];

    for (const [error, expected] of cases) {
      const h: Harness = harness({
        transport: new FakeTransport((): FakeAnswer => {
          return error;
        }),
      });

      const result: ExecResult = await runCommand(
        h,
        request("pvesh get /version"),
      );

      assert.strictEqual(result.output, "", error.kind);
      assert.strictEqual(result.exitCode, undefined);
      assert.match(String(result.errorMessage), expected);
      assert.ok(
        !String(result.errorMessage).includes("inside the agent's container"),
      );
    }
  });

  test("a TLS failure: never ran; names PVE_CA_FILE and PVE_VERIFY_SSL", async () => {
    const h: Harness = harness({
      env: pveEnv({ PVE_VERIFY_SSL: "true" }),
      transport: new FakeTransport((): FakeAnswer => {
        return transportError(
          "tls",
          "DEPTH_ZERO_SELF_SIGNED_CERT",
          "self-signed certificate",
        );
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /version"),
    );

    assert.strictEqual(result.output, "");
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(
      result.errorMessage,
      "The TLS handshake with the Proxmox VE API at https://192.168.1.10:8006 failed (DEPTH_ZERO_SELF_SIGNED_CERT): self-signed certificate. Proxmox VE ships a self-signed certificate: set PVE_CA_FILE to the cluster's CA certificate (/etc/pve/pve-root-ca.pem on any node, mounted into the agent), or set PVE_VERIFY_SSL=false to skip verification (the collector's default).",
    );
  });

  test("a TLS failure against PVE_CA_FILE: says the certificate does not chain to it", async () => {
    const caFile: string = path.join(tmpDir, "pve-root-ca.pem");
    fs.writeFileSync(
      caFile,
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
    );
    const h: Harness = harness({
      // The compose default: the exporter needs PVE_VERIFY_SSL=false.
      env: pveEnv({ PVE_CA_FILE: caFile, PVE_VERIFY_SSL: "false" }),
      transport: new FakeTransport((): FakeAnswer => {
        return transportError(
          "tls",
          "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          "unable to verify the first certificate",
        );
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /version"),
    );

    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(h.transport.requests[0]?.verifyTls, true);
    assert.match(
      String(result.errorMessage),
      /does not chain to PVE_CA_FILE=".*pve-root-ca\.pem": mount the cluster's own CA certificate/,
    );
  });

  test("a TLS failure without verification: probably not the HTTPS port", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return transportError(
          "tls",
          "ERR_SSL_WRONG_VERSION_NUMBER",
          "wrong version number",
        );
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /version"),
    );

    assert.match(
      String(result.errorMessage),
      /Check that PVE_PORT is the API's HTTPS port \(8006 by default\)\.$/,
    );
  });

  test("a timeout after the request went out reads as ran: a write may have landed", async () => {
    const h: Harness = harness({
      config: agentConfig(WRITES_ON),
      transport: new FakeTransport((): FakeAnswer => {
        return transportError("timeout");
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      writeRequest(START, { timeoutInMs: 5_000 }),
    );
    const message: string =
      "Killed (timeout 5000ms): the Proxmox VE API at https://192.168.1.10:8006 did not answer POST /nodes/pve1/qemu/101/status/start in time. \"pvesh create /nodes/pve1/qemu/101/status/start\" may still have been carried out: read the guest's or service's state (or the node's tasks) before trying it again.";

    assert.deepStrictEqual(result, {
      success: false,
      output: `[stderr]\n${message}`,
      errorMessage: message,
    });
  });

  test("a connection dropped after the request went out reads as ran", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return transportError("reset", "ECONNRESET", "socket hang up");
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /version"),
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.notStrictEqual(result.output, "");
    assert.match(
      String(result.errorMessage),
      /closed before it answered GET \/version \(ECONNRESET\)\.$/,
    );
  });

  test("run never throws: an unexpected transport failure is reported, as possibly sent", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return new TypeError("boom");
      }),
    });

    const result: ExecResult = await runCommand(
      h,
      request("pvesh get /version"),
    );

    assert.strictEqual(result.success, false);
    assert.notStrictEqual(result.output, "");
    assert.match(String(result.errorMessage), /failed: boom\./);
  });
});

// ---- Tasks -------------------------------------------------------------------------------

describe("a write's task", () => {
  const STATUS_PATH: string = `/api2/json/nodes/pve1/tasks/${ENCODED_UPID}/status`;
  const LOG_PATH: string = `/api2/json/nodes/pve1/tasks/${ENCODED_UPID}/log?limit=${MAX_TASK_LOG_LINES}`;

  function taskHarness(
    statuses: Array<FakeAnswer>,
    extra: {
      log?: FakeAnswer | undefined;
      pollIntervalMs?: number | undefined;
      env?: NodeJS.ProcessEnv | undefined;
    } = {},
  ): Harness {
    let polls: number = 0;

    return harness({
      config: agentConfig(WRITES_ON),
      env: extra.env,
      pollIntervalMs: extra.pollIntervalMs,
      transport: new FakeTransport((req: ProxmoxHttpRequest): FakeAnswer => {
        if (req.method === "POST") {
          return reply(UPID);
        }

        if (req.path === LOG_PATH) {
          return extra.log || reply([]);
        }

        const answer: FakeAnswer | undefined =
          statuses[Math.min(polls, statuses.length - 1)];
        polls++;
        return answer || reply({ status: "running" });
      }),
    });
  }

  test("followed until it stops: OK is success", async () => {
    const h: Harness = taskHarness([
      reply({ status: "running", upid: UPID }),
      reply({ status: "running", upid: UPID }),
      reply({ status: "stopped", exitstatus: "OK", upid: UPID }),
    ]);

    const result: ExecResult = await runCommand(h, writeRequest(START));

    assert.deepStrictEqual(result, {
      success: true,
      exitCode: 0,
      output: `[stdout]\n"${UPID}"\n\nTask ${UPID} finished: OK`,
    });
    assert.deepStrictEqual(h.transport.paths(), [
      "POST /api2/json/nodes/pve1/qemu/101/status/start",
      `GET ${STATUS_PATH}`,
      `GET ${STATUS_PATH}`,
      `GET ${STATUS_PATH}`,
    ]);
    // Polled at once, then once a second.
    assert.deepStrictEqual(h.clock.sleeps, [1_000, 1_000]);
  });

  test("a failed task fails the command, with the first lines of its log", async () => {
    const h: Harness = taskHarness(
      [
        reply({
          status: "stopped",
          exitstatus: "command 'qm start 101' failed: exit code 1",
        }),
      ],
      {
        log: reply([
          {
            n: 1,
            t: "kvm: -drive file=/dev/pve/vm-101-disk-0: Could not open",
          },
          { n: 2, t: "TASK ERROR: start failed" },
        ]),
      },
    );

    const result: ExecResult = await runCommand(h, writeRequest(START));

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(
      result.errorMessage,
      `Exit code 1: Proxmox VE task ${UPID} failed: command 'qm start 101' failed: exit code 1`,
    );
    assert.strictEqual(
      result.output,
      `[stdout]\n"${UPID}"\n\nTask ${UPID} failed: command 'qm start 101' failed: exit code 1\nTask log (first ${MAX_TASK_LOG_LINES} lines):\nkvm: -drive file=/dev/pve/vm-101-disk-0: Could not open\nTASK ERROR: start failed`,
    );
    assert.ok(h.transport.paths().includes(`GET ${LOG_PATH}`));
  });

  test("warnings are success, and say where the log is", async () => {
    const h: Harness = taskHarness([
      reply({ status: "stopped", exitstatus: "WARNINGS: 2" }),
    ]);

    const result: ExecResult = await runCommand(h, writeRequest(START));

    assert.strictEqual(result.success, true);
    assert.match(
      result.output,
      /finished with WARNINGS: 2\. Read its log with: pvesh get \/nodes\/pve1\/tasks\/UPID:.*\/log/,
    );
  });

  test("still running when the budget runs out: accepted, and how to follow it", async () => {
    const h: Harness = taskHarness([reply({ status: "running" })]);

    const result: ExecResult = await runCommand(
      h,
      writeRequest(START, { timeoutInMs: 10_000 }),
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.exitCode, 0);
    assert.match(
      result.output,
      /Task UPID:.* was still running when the agent stopped waiting \(8\.5 s after the call\)\. Follow it with: pvesh get \/nodes\/pve1\/tasks\/UPID:.*\/status$/,
    );
    // It stopped TASK_WAIT_HEADROOM_MS before the budget ran out.
    const waited: number = h.clock.sleeps.reduce(
      (sum: number, ms: number): number => {
        return sum + ms;
      },
      0,
    );
    assert.strictEqual(waited, 10_000 - TASK_WAIT_HEADROOM_MS);
    // Each poll had only the budget that was left.
    const budgets: Array<number> = h.transport.requests
      .slice(1)
      .map((req: ProxmoxHttpRequest): number => {
        return req.timeoutInMs;
      });
    assert.strictEqual(budgets[0], 10_000 - TASK_WAIT_HEADROOM_MS);
    assert.ok(
      budgets.every((ms: number): boolean => {
        return ms > 0 && ms <= 10_000;
      }),
    );
  });

  test("a poll that is refused ends the wait, not the command", async () => {
    const h: Harness = taskHarness([failure(403, "Permission check failed")]);

    const result: ExecResult = await runCommand(h, writeRequest(START));

    assert.strictEqual(result.success, true);
    assert.match(
      result.output,
      /The agent could not follow task UPID:.* \(HTTP 403 Permission check failed\)\. Check it with: pvesh get/,
    );
  });

  test("a poll that gets no answer ends the wait, not the command", async () => {
    const h: Harness = taskHarness([
      transportError("reset", "ECONNRESET", "socket hang up"),
    ]);

    const result: ExecResult = await runCommand(h, writeRequest(START));

    assert.strictEqual(result.success, true);
    assert.match(
      result.output,
      /could not follow task UPID:.* \(socket hang up\)/,
    );
  });

  test("a POST answer that is not a task id is printed as it is", async () => {
    const h: Harness = harness({
      config: agentConfig(WRITES_ON),
      transport: new FakeTransport((): FakeAnswer => {
        return reply("not-a-upid");
      }),
    });

    const result: ExecResult = await runCommand(h, writeRequest(START));

    assert.deepStrictEqual(result, {
      success: true,
      exitCode: 0,
      output: '[stdout]\n"not-a-upid"',
    });
    assert.strictEqual(h.transport.requests.length, 1);
  });

  test("a read that returns a task id is not followed", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        return reply(UPID);
      }),
    });

    await runCommand(h, request("pvesh get /nodes/pve1/tasks"));

    assert.strictEqual(h.transport.requests.length, 1);
  });
});

// ---- Posture -----------------------------------------------------------------------------

describe("probePosture", () => {
  const CLUSTER_STATUS: Array<Record<string, unknown>> = [
    {
      type: "cluster",
      id: "cluster",
      name: "homelab",
      nodes: 3,
      quorate: 1,
      version: 5,
    },
    { type: "node", id: "node/pve1", name: "pve1", online: 1, local: 1 },
    { type: "node", id: "node/pve2", name: "pve2", online: 1 },
    { type: "node", id: "node/pve3", name: "pve3", online: 0 },
  ];

  function postureHarness(
    answers: Record<string, FakeAnswer>,
    env: NodeJS.ProcessEnv = pveEnv(),
  ): Harness {
    return harness({
      env,
      transport: new FakeTransport((req: ProxmoxHttpRequest): FakeAnswer => {
        return (
          answers[req.path] ||
          failure(404, `no answer scripted for ${req.path}`)
        );
      }),
    });
  }

  test("reachable: the version, node counts, quorum and which token — never its secret", async () => {
    const h: Harness = postureHarness({
      "/api2/json/version": reply({ version: "8.2.4", release: "8.2" }),
      "/api2/json/cluster/status": reply(CLUSTER_STATUS),
    });

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: "8.2.4",
      reachable: true,
      reachError: null,
      details: {
        apiEndpoint: "https://192.168.1.10:8006",
        tokenId: TOKEN_ID,
        tokenSource: "PVE_API_TOKEN_ID",
        agentTokenConfigured: false,
        tlsVerified: false,
        nodes: 3,
        onlineNodes: 2,
        quorate: true,
        pveClusterName: "homelab",
      },
      protectedTargets: [],
    });
    assertNoSecret(probe);
    assert.deepStrictEqual(
      h.transport.requests.map((req: ProxmoxHttpRequest): number => {
        return req.timeoutInMs;
      }),
      [POSTURE_REQUEST_TIMEOUT_MS, POSTURE_REQUEST_TIMEOUT_MS],
    );
  });

  test("a standalone node has no quorum to report", async () => {
    const h: Harness = postureHarness({
      "/api2/json/version": reply({ version: "9.0.3" }),
      "/api2/json/cluster/status": reply([
        { type: "node", id: "node/pve", name: "pve", online: 1, local: 1 },
      ]),
    });

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.reachable, true);
    assert.strictEqual(probe.details?.["nodes"], 1);
    assert.strictEqual(probe.details?.["quorate"], null);
    assert.strictEqual(probe.details?.["pveClusterName"], null);
  });

  test("a lost quorum is reported", async () => {
    const h: Harness = postureHarness({
      "/api2/json/version": reply({ version: "8.2.4" }),
      "/api2/json/cluster/status": reply([
        { type: "cluster", name: "homelab", quorate: 0 },
        { type: "node", name: "pve1", online: 1 },
      ]),
    });

    assert.strictEqual(
      (await h.executor.probePosture()).details?.["quorate"],
      false,
    );
  });

  test("/cluster/status refused: still reachable, with the reason", async () => {
    const h: Harness = postureHarness({
      "/api2/json/version": reply({ version: "8.2.4" }),
      "/api2/json/cluster/status": failure(
        403,
        "Permission check failed (/, Sys.Audit)",
      ),
    });

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.reachable, true);
    assert.strictEqual(probe.toolVersion, "8.2.4");
    assert.strictEqual(
      probe.details?.["clusterStatusError"],
      "HTTP 403 Permission check failed (/, Sys.Audit)",
    );
  });

  test("a token the API does not accept: unreachable, and why", async () => {
    const h: Harness = postureHarness({
      "/api2/json/version": failure(401, "authentication failure"),
    });

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(probe.toolVersion, null);
    assert.match(
      String(probe.reachError),
      /^the Proxmox VE API answered HTTP 401 \(authentication failure\)\. The API did not accept the token "monitoring@pam!oneuptime"/,
    );
    assertNoSecret(probe);
  });

  test("no connection: unreachable, and why", async () => {
    const h: Harness = postureHarness({
      "/api2/json/version": transportError("connect", "ECONNREFUSED"),
    });

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /^Could not connect to the Proxmox VE API at https:\/\/192\.168\.1\.10:8006: nothing is listening there/,
    );
    assert.strictEqual(probe.details?.["tokenId"], TOKEN_ID);
  });

  test("no answer in time: unreachable, without a kill message", async () => {
    const h: Harness = postureHarness({
      "/api2/json/version": transportError("timeout"),
    });

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(
      probe.reachError,
      `The Proxmox VE API at https://192.168.1.10:8006 did not answer GET /version within ${POSTURE_REQUEST_TIMEOUT_MS}ms.`,
    );
  });

  test("a server that is not Proxmox VE: unreachable", async () => {
    const h: Harness = postureHarness({
      "/api2/json/version": reply(null, { body: "<html></html>" }),
    });

    assert.match(
      String((await h.executor.probePosture()).reachError),
      /answered \/version, but not as the Proxmox VE API does/,
    );
  });

  test("a redirect: unreachable", async () => {
    const h: Harness = postureHarness({
      "/api2/json/version": reply(null, { statusCode: 301, body: "" }),
    });

    assert.match(
      String((await h.executor.probePosture()).reachError),
      /answered \/version with a redirect \(HTTP 301\)/,
    );
  });

  test("misconfigured: unreachable with the setting to fix, and nothing is sent", async () => {
    const h: Harness = postureHarness({}, pveEnv({ PVE_API_TOKEN_SECRET: "" }));

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: null,
      reachable: false,
      reachError:
        "PVE_API_TOKEN_ID is set but PVE_API_TOKEN_SECRET is not. Set both in the .env file the AI agent shares with the Proxmox collector (or the agent container's environment): the token id (user@realm!tokenname) and its secret.",
      details: {},
      protectedTargets: [],
    });
    assert.strictEqual(h.transport.requests.length, 0);
  });

  test("an unreadable CA file: unreachable", async () => {
    const h: Harness = postureHarness(
      {},
      pveEnv({ PVE_CA_FILE: path.join(tmpDir, "nope.pem") }),
    );

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(String(probe.reachError), /Could not read PVE_CA_FILE/);
    assert.strictEqual(probe.details?.["tlsVerified"], true);
  });

  test("the AI agent's own token is reported as such", async () => {
    const h: Harness = postureHarness(
      {
        "/api2/json/version": reply({ version: "8.2.4" }),
        "/api2/json/cluster/status": reply(CLUSTER_STATUS),
      },
      pveEnv({
        [AI_PVE_API_TOKEN_ID_ENV]: AI_TOKEN_ID,
        [AI_PVE_API_TOKEN_SECRET_ENV]: AI_TOKEN_SECRET,
      }),
    );

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.details?.["tokenId"], AI_TOKEN_ID);
    assert.strictEqual(probe.details?.["tokenSource"], AI_PVE_API_TOKEN_ID_ENV);
    assert.strictEqual(probe.details?.["agentTokenConfigured"], true);
    assertNoSecret(probe);
  });

  test("never throws, whatever the transport does", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((): FakeAnswer => {
        throw new Error("exploded");
      }),
    });

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(String(probe.reachError), /exploded/);
  });
});

// ---- The factory's view ------------------------------------------------------------------

describe("as the agent builds it", () => {
  test("ExecutorFactory builds a ProxmoxExecutor with the options alone", () => {
    const executor: unknown = createExecutor({
      config: agentConfig(),
      env: pveEnv(),
      tmpDir,
      logger: recordingLogger(),
    });

    assert.ok(executor instanceof ProxmoxExecutor);
  });

  test("there are no job directories to sweep or remove", async () => {
    const h: Harness = harness();

    await h.executor.sweepOrphanedJobDirs();
    await h.executor.removeAllJobDirs();
    assert.deepStrictEqual(
      fs.readdirSync(tmpDir).filter((entry: string): boolean => {
        return entry.startsWith("oneuptime-");
      }),
      [],
    );
  });

  test("the Test connection commands are reads it runs", async () => {
    const h: Harness = harness({
      transport: new FakeTransport((req: ProxmoxHttpRequest): FakeAnswer => {
        return req.path.endsWith("/version")
          ? reply({ version: "8.2.4" })
          : reply([{ type: "node", name: "pve1", online: 1 }]);
      }),
    });

    for (const command of ["pvesh get /version", "pvesh get /cluster/status"]) {
      const result: ExecResult = await runCommand(h, request(command));
      assert.strictEqual(result.success, true, command);
    }
  });
});
