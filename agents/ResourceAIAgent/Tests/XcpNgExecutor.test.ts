import {
  CapturedLogs,
  captureLogs,
  recordingLogger,
  testConfig,
} from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { after, before, describe, test } from "node:test";
import { AgentConfig, parseConfig } from "../Config";
import { createExecutor } from "../Executors/ExecutorFactory";
import XcpNgExecutor, {
  CERTIFICATE_NAMES_NO_ADDRESS,
  READ_TOKEN_CHECK_TTL_MS,
  XenOrchestraConnectionResult,
  XoHttpRequest,
  XoHttpResponse,
  XoTransportError,
  buildXoRequestPath,
  describeXoError,
  parseXoAddress,
  readAllowedChanges,
  readMissingPrivileges,
  renderXoData,
  resolveXenOrchestraConnection,
  scopeFilterToPool,
} from "../Executors/XcpNgExecutor";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  PreparedCommand,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import { makeTempDir } from "./Helpers/FakeBinary";
import { TEST_RESOURCE_ID } from "./Helpers/FakeOneUptime";
import {
  ADMIN_TOKEN,
  FIX_TOKEN,
  FakeXenOrchestra,
  FakeXoPrivilege,
  FakeXoRequest,
  FakeXoUser,
  MIXED_TOKEN,
  POWER_TOKEN,
  PROD_ONLY_READ_TOKEN,
  READ_TOKEN,
  SECOND_READ_TOKEN,
} from "./Helpers/FakeXenOrchestra";
import {
  BACKUP_LOG_FAILED,
  CIFS_PASSWORD,
  CLOUD_INIT_ROOT_PASSWORD,
  HOST_LAB_1,
  HOST_PROD_1,
  HOST_PROD_2,
  LAB_POOL,
  PBD_NFS_PROD_2,
  PBD_NFS_PROD_3,
  PROD_POOL,
  SCHEDULE_NIGHTLY,
  SR_PROD_NFS,
  VM_APP_02,
  VM_DB_01,
  VM_LAB_01,
  VM_REPORT_05,
  VM_WEB_01,
  XSCONTAINER_SECRET,
  XoObject,
} from "./Helpers/XenOrchestraLab";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { tokenizeResourceCommand } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The XCP-ng AI agent's executor against a FAKE Xen Orchestra
 * (Helpers/FakeXenOrchestra): the REST API's routes, authentication, RBAC
 * with xo-server's own role templates, complex-matcher filters, tasks and
 * the state they change, serving the recorded two-pool lab
 * (Helpers/XenOrchestraLab). Every request the executor sends is recorded
 * exactly, so each check, each request it builds and each answer it reads
 * is pinned without a Xen Orchestra. The real HTTPS transport is tested
 * against the same fake over TLS in XcpNgHttpsTransport.test.ts.
 */

const URL: string = "https://oneuptime.example.com";
const ALL_TOKENS: ReadonlyArray<string> = [
  READ_TOKEN,
  FIX_TOKEN,
  ADMIN_TOKEN,
  POWER_TOKEN,
  MIXED_TOKEN,
  SECOND_READ_TOKEN,
  PROD_ONLY_READ_TOKEN,
];

let tmpDir: string;
let caFile: string;

before((): void => {
  tmpDir = makeTempDir("agent-xcp-ng-");
  caFile = path.join(tmpDir, "xo-ca.pem");
  fs.writeFileSync(
    caFile,
    "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n",
  );
});

after((): void => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// A clock that only moves when the executor waits.
class FakeClock {
  public nowMs: number = Date.parse("2026-11-26T10:00:00.000Z");
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

function xoEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "xcp-ng",
    DOCKER_HOST_NAME: "",
    XCP_NG_POOL_ID: PROD_POOL,
    XO_SCHEME: "https",
    XO_ADDRESS: "xo.lab.example:443",
    ONEUPTIME_AI_XO_READ_TOKEN: READ_TOKEN,
    ONEUPTIME_AI_XO_CA_FILE: caFile,
    ...overrides,
  };
}

const FIXES_ON: Record<string, string> = {
  ONEUPTIME_AI_ALLOW_WRITES: "true",
  ONEUPTIME_AI_XO_WRITE_TOKEN: FIX_TOKEN,
};

interface Harness {
  fake: FakeXenOrchestra;
  clock: FakeClock;
  executor: XcpNgExecutor;
  config: AgentConfig;
  logger: ReturnType<typeof recordingLogger>;
}

function harness(
  overrides: Record<string, string> = {},
  options: { fake?: FakeXenOrchestra; clock?: FakeClock } = {},
): Harness {
  const env: Record<string, string> = xoEnv(overrides);
  const config: AgentConfig = testConfig(URL, env);
  const fake: FakeXenOrchestra = options.fake || new FakeXenOrchestra();
  const clock: FakeClock = options.clock || new FakeClock();
  const logger: ReturnType<typeof recordingLogger> = recordingLogger();
  const executorOptions: ExecutorOptions = {
    config,
    env,
    tmpDir,
    logger,
    now: clock.now,
  };

  return {
    fake,
    clock,
    config,
    logger,
    executor: new XcpNgExecutor(executorOptions, {
      transport: fake.transport,
      sleep: clock.sleep,
    }),
  };
}

function argvOf(command: string): Array<string> {
  const argv: Array<string> | undefined = tokenizeResourceCommand(command).argv;

  if (!argv) {
    throw new Error(`does not tokenize: ${command}`);
  }

  return argv;
}

function payload(
  command: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const argv: Array<string> = argvOf(command);

  return {
    resourceType: AiResourceType.XcpNgPool,
    resourceId: TEST_RESOURCE_ID,
    resourceIdentifier: PROD_POOL,
    program: argv[0],
    args: argv.slice(1),
    displayCommand: command,
    tier: ResourceCommandPolicy.evaluateArgv({
      resourceType: AiResourceType.XcpNgPool,
      argv,
    }).tier,
    ...overrides,
  };
}

function prepare(
  h: Harness,
  command: string,
  origin: string = "AiInvestigation",
  timeoutInMs: number = 30_000,
): PrepareResult {
  return h.executor.prepare({
    payload: payload(command),
    origin,
    timeoutInMs,
    agentResourceId: TEST_RESOURCE_ID,
  });
}

async function run(
  h: Harness,
  command: string,
  origin: string = "AiInvestigation",
  timeoutInMs: number = 30_000,
): Promise<ExecResult> {
  const prepared: PrepareResult = prepare(h, command, origin, timeoutInMs);

  if (prepared.refusal !== null) {
    throw new Error(`refused: ${prepared.refusal}`);
  }

  return (prepared as PreparedCommand).run();
}

function fix(h: Harness, command: string): Promise<ExecResult> {
  return run(h, command, "AiRemediation");
}

// The requests to Xen Orchestra itself, without the read token's own check.
function commandRequests(fake: FakeXenOrchestra): Array<FakeXoRequest> {
  return fake.requests.filter((request: FakeXoRequest): boolean => {
    return !request.path.startsWith("/users/");
  });
}

function snapshot(fake: FakeXenOrchestra): string {
  return JSON.stringify(Array.from(fake.objects.entries()));
}

function vmPowerState(fake: FakeXenOrchestra, id: string): unknown {
  return (fake.find("vms", id) as XoObject)["power_state"];
}

// ---- Settings --------------------------------------------------------------------

describe("settings", () => {
  test("XO_ADDRESS is read as install.sh writes it, and as people paste it", () => {
    assert.deepStrictEqual(parseXoAddress("xo.lab.example:443"), {
      host: "xo.lab.example",
      port: 443,
    });
    assert.deepStrictEqual(parseXoAddress("XO.Lab.Example"), {
      host: "xo.lab.example",
      port: 443,
    });
    assert.deepStrictEqual(parseXoAddress("https://xo.lab.example:8443/"), {
      host: "xo.lab.example",
      port: 8443,
    });
    assert.deepStrictEqual(parseXoAddress("[2001:db8::5]:443"), {
      host: "2001:db8::5",
      port: 443,
    });
    assert.deepStrictEqual(parseXoAddress("2001:db8::5"), {
      host: "2001:db8::5",
      port: 443,
    });
    assert.deepStrictEqual(parseXoAddress("10.0.0.5"), {
      host: "10.0.0.5",
      port: 443,
    });
  });

  test("an XO_ADDRESS that is not one is refused, in words an operator can act on", () => {
    assert.match(String(parseXoAddress("")), /XO_ADDRESS is not set/);
    assert.match(
      String(parseXoAddress("http://xo.lab.example")),
      /HTTPS only: its tokens never cross the network in clear/,
    );
    assert.match(
      String(parseXoAddress(`${READ_TOKEN}@xo.lab.example`)),
      /holds an "@"/,
    );
    assert.doesNotMatch(
      String(parseXoAddress(`${READ_TOKEN}@xo.lab.example`)),
      new RegExp(READ_TOKEN),
    );
    assert.match(
      String(parseXoAddress("xo.lab.example/rest/v0")),
      /not a host and port/,
    );
    assert.match(String(parseXoAddress("xo.lab.example:99999")), /port/);
    assert.match(String(parseXoAddress("[xo]:443")), /no IPv6 address/);
    assert.match(String(parseXoAddress("xo lab")), /not a host name/);
  });

  test("the connection takes the collector's address and certificate, and the agent's tokens", () => {
    const resolved: XenOrchestraConnectionResult =
      resolveXenOrchestraConnection(
        xoEnv({
          XO_TLS_SERVER_NAME: "XO.Example.Lan",
          ONEUPTIME_AI_XO_WRITE_TOKEN: FIX_TOKEN,
        }),
      );

    assert.deepStrictEqual(resolved, {
      connection: {
        host: "xo.lab.example",
        port: 443,
        endpoint: "https://xo.lab.example",
        tlsServerName: "xo.example.lan",
        tlsServerNameConfigured: true,
        caFile,
        readToken: READ_TOKEN,
        writeToken: FIX_TOKEN,
      },
      problem: null,
    });
  });

  test("without a CA file named, the agent trusts the collector's xo-ca.pem, mounted", () => {
    const env: Record<string, string> = xoEnv();
    delete env["ONEUPTIME_AI_XO_CA_FILE"];

    assert.strictEqual(
      resolveXenOrchestraConnection(env).connection?.caFile,
      "/etc/oneuptime/xo-ca.pem",
    );
    assert.strictEqual(
      resolveXenOrchestraConnection(xoEnv({ XO_ADDRESS: "xo:8443" })).connection
        ?.endpoint,
      "https://xo:8443",
    );
  });

  for (const [name, env, reason] of [
    ["http", { XO_SCHEME: "http" }, /HTTPS only/],
    ["no read token", { ONEUPTIME_AI_XO_READ_TOKEN: "" }, /Read only role/],
    [
      "a read token with a space",
      { ONEUPTIME_AI_XO_READ_TOKEN: "abc def ghi" },
      /not a Xen Orchestra token/,
    ],
    [
      "a cookie pasted as the token",
      { ONEUPTIME_AI_XO_READ_TOKEN: `authenticationToken=${READ_TOKEN};` },
      /not a Xen Orchestra token/,
    ],
    [
      "a write token with quotes",
      { ONEUPTIME_AI_XO_WRITE_TOKEN: '"abc def"' },
      /ONEUPTIME_AI_XO_WRITE_TOKEN is not a Xen Orchestra token/,
    ],
    [
      "a server name that is not one",
      { XO_TLS_SERVER_NAME: "xo lab" },
      /XO_TLS_SERVER_NAME/,
    ],
    ["no address", { XO_ADDRESS: "" }, /XO_ADDRESS is not set/],
  ] as Array<[string, Record<string, string>, RegExp]>) {
    test(`${name} is a problem before anything is sent`, () => {
      const resolved: XenOrchestraConnectionResult =
        resolveXenOrchestraConnection(xoEnv(env));

      assert.strictEqual(resolved.connection, null);
      assert.match(String(resolved.problem), reason);

      for (const token of ALL_TOKENS) {
        assert.doesNotMatch(String(resolved.problem), new RegExp(token));
      }
    });
  }

  test("an answer is printed as indented JSON, in whole entries within the budget", () => {
    assert.deepStrictEqual(renderXoData([{ a: 1 }, { b: "x" }], 1000), {
      text: '[\n  {\n    "a": 1\n  },\n  {\n    "b": "x"\n  }\n]',
      omitted: 0,
    });
    assert.deepStrictEqual(renderXoData([], 1000), { text: "[]", omitted: 0 });
    assert.deepStrictEqual(renderXoData({}, 1000), { text: "{}", omitted: 0 });
    assert.deepStrictEqual(renderXoData("x", 1000), {
      text: '"x"',
      omitted: 0,
    });

    const many: Array<{ body: string }> = Array.from(
      { length: 10 },
      (_: unknown, i: number) => {
        return { body: `${"y".repeat(100)}${i}` };
      },
    );
    const cut: { text: string; omitted: number } = renderXoData(many, 250);

    // Always the first, then whole entries only.
    assert.strictEqual(cut.omitted, 8);
    assert.match(cut.text, /y0"/);
    assert.match(cut.text, /y1"/);
    assert.doesNotMatch(cut.text, /y2"/);
    assert.strictEqual(
      renderXoData([{ big: "z".repeat(5000) }], 10).omitted,
      0,
    );
  });

  test("a list is narrowed to the pool as Xen Orchestra narrows its own", () => {
    assert.strictEqual(
      scopeFilterToPool(undefined, PROD_POOL),
      `$pool:${PROD_POOL}`,
    );
    assert.strictEqual(
      scopeFilterToPool("  ", PROD_POOL),
      `$pool:${PROD_POOL}`,
    );
    assert.strictEqual(
      scopeFilterToPool("power_state:Halted tags:prod", PROD_POOL),
      `(power_state:Halted tags:prod) $pool:${PROD_POOL}`,
    );
    assert.strictEqual(
      scopeFilterToPool("|(a:1 b:2)", PROD_POOL),
      `(|(a:1 b:2)) $pool:${PROD_POOL}`,
    );
  });

  test("a request path is /rest/v0 and the path, its parameters in order", () => {
    assert.strictEqual(
      buildXoRequestPath("/vms", {
        fields: "name_label,power_state",
        filter: "(power_state:Halted) $pool:x",
      }),
      "/rest/v0/vms?fields=name_label%2Cpower_state&filter=%28power_state%3AHalted%29+%24pool%3Ax",
    );
    assert.strictEqual(
      buildXoRequestPath(`/vms/${VM_WEB_01}`, {}),
      `/rest/v0/vms/${VM_WEB_01}`,
    );
  });

  test("Xen Orchestra's errors, missing privileges and allowed changes are read as it writes them", () => {
    assert.strictEqual(
      describeXoError({
        error: "no such VM x",
        data: { code: "HANDLE_INVALID" },
        info: "This is a XenServer/XCP-ng error, not an XO error",
      }),
      "no such VM x - HANDLE_INVALID - This is a XenServer/XCP-ng error, not an XO error",
    );
    assert.strictEqual(describeXoError("text"), "");
    assert.deepStrictEqual(
      readMissingPrivileges({
        error: "not enough privileges",
        data: {
          missingPrivileges: [
            { objectId: "x", action: "start", resource: "vm" },
            { action: "allow-vm", resource: "host" },
          ],
        },
      }),
      ["vm:start", "host:allow-vm"],
    );
    assert.deepStrictEqual(readMissingPrivileges({ error: "x" }), []);
    assert.deepStrictEqual(
      readAllowedChanges([
        { action: "read", resource: "vm", effect: "allow" },
        { action: "start", resource: "vm", effect: "allow" },
        { action: "*", resource: "pbd", effect: "allow" },
        { action: "delete", resource: "vm", effect: "deny" },
        { action: "start", resource: "vm", effect: "allow" },
        "garbage",
      ]),
      ["vm:start", "pbd:*"],
    );
    assert.deepStrictEqual(readAllowedChanges("x"), []);
  });
});

// ---- Investigation ----------------------------------------------------------------

describe("an investigation reads the pool, read-only", () => {
  test("the pool's halted VMs, and only this pool's", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      "xo-cli rest get vms fields=name_label,power_state filter=power_state:Halted",
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.output, /"name_label": "app-02"/);
    assert.match(result.output, /"power_state": "Halted"/);
    // lab-vm-01 is halted too, in the other pool.
    assert.doesNotMatch(result.output, /lab-vm-01/);

    const read: Array<FakeXoRequest> = h.fake.sent("GET", "/vms");

    assert.strictEqual(read.length, 1);
    assert.deepStrictEqual(read[0]!.query, {
      fields: "name_label,power_state",
      filter: `(power_state:Halted) $pool:${PROD_POOL}`,
    });
    assert.strictEqual(read[0]!.token, "read");
  });

  test("the pool's hosts, storage repositories, alarms, recent tasks and backup logs", async () => {
    const h: Harness = harness();
    const hosts: ExecResult = await run(
      h,
      "xo-cli rest get hosts fields=name_label,power_state,enabled",
    );
    const srs: ExecResult = await run(
      h,
      "xo-cli rest get srs fields=name_label,SR_type,size,physical_usage",
    );
    const alarms: ExecResult = await run(
      h,
      "xo-cli rest get alarms fields=body,time,object",
    );
    const tasks: ExecResult = await run(
      h,
      "xo-cli rest get tasks fields=properties,status,result filter=status:failure limit=20",
    );
    const backups: ExecResult = await run(
      h,
      "xo-cli rest get backup-logs fields=jobName,status,scheduleId,tasks,result filter=status:failure limit=10",
    );

    assert.match(hosts.output, /"name_label": "xcp-prod-02"/);
    assert.match(hosts.output, /"enabled": false/);
    assert.doesNotMatch(hosts.output, /xcp-lab-01/);
    assert.match(srs.output, /NFS VM store/);
    assert.match(alarms.output, /physical_utilisation/);
    assert.match(alarms.output, /0\.925/);
    assert.match(tasks.output, /SR_BACKEND_FAILURE_73/);
    assert.match(backups.output, /Nightly delta/);
    assert.match(backups.output, /"status": "failure"/);
    assert.match(backups.output, new RegExp(SCHEDULE_NIGHTLY));
    // The storage password the backup's error quoted never reaches the model.
    assert.doesNotMatch(backups.output, /SmbPass9/);

    // Xen Orchestra's own records are not a pool's: no $pool added.
    assert.deepStrictEqual(h.fake.sent("GET", "/tasks")[0]!.query, {
      fields: "properties,status,result",
      filter: "status:failure",
      limit: "20",
    });
    assert.strictEqual(
      h.fake.sent("GET", "/alarms")[0]!.query["filter"],
      `$pool:${PROD_POOL}`,
    );
  });

  test("which host a storage repository is unplugged from", async () => {
    const h: Harness = harness();
    const pbds: ExecResult = await run(
      h,
      "xo-cli rest get pbds fields=attached,host,SR filter='!attached?'",
    );

    assert.strictEqual(pbds.success, true);
    assert.match(pbds.output, new RegExp(PBD_NFS_PROD_2));
    assert.match(pbds.output, new RegExp(`"host": "${HOST_PROD_2}"`));
    assert.match(pbds.output, new RegExp(`"SR": "${SR_PROD_NFS}"`));
    assert.match(pbds.output, new RegExp(PBD_NFS_PROD_3));
    assert.doesNotMatch(pbds.output, /"attached": true/);

    const host: ExecResult = await run(
      h,
      `xo-cli rest get hosts/${HOST_PROD_2}`,
    );

    assert.match(host.output, /"name_label": "xcp-prod-02"/);

    const messages: ExecResult = await run(
      h,
      `xo-cli rest get hosts/${HOST_PROD_2}/messages fields=name,body,time`,
    );

    assert.match(messages.output, /PBD_PLUG_FAILED_ON_SERVER_START/);
    assert.match(messages.output, /mount\.nfs: Connection timed out/);
  });

  test("one object, its stats and what belongs to it", async () => {
    const h: Harness = harness();

    assert.match(
      (await run(h, `xo-cli rest get vms/${VM_WEB_01}`)).output,
      /"name_label": "web-01"/,
    );
    assert.match(
      (await run(h, `xo-cli rest get vms/${VM_WEB_01}/stats granularity=hours`))
        .output,
      /"interval": 3600/,
    );
    assert.match(
      (await run(h, `xo-cli rest get srs/${SR_PROD_NFS}/alarms fields=body`))
        .output,
      /physical_utilisation/,
    );
    assert.match(
      (await run(h, `xo-cli rest get pools/${PROD_POOL}/missing_patches`))
        .output,
      /^\[stdout\]\n\[\]$/,
    );
  });

  test("one object of another pool is read but not shown", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(h, `xo-cli rest get vms/${VM_LAB_01}`);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      new RegExp(
        `VM ${VM_LAB_01} is in pool ${LAB_POOL}, not in pool ${PROD_POOL}`,
      ),
    );
    assert.doesNotMatch(result.output, /lab-vm-01/);
  });

  test("what belongs to another pool's object is never read", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      `xo-cli rest get vms/${VM_LAB_01}/alarms`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.output, "");
    assert.match(
      String(result.errorMessage),
      /neither reads nor changes another pool's objects/,
    );
    assert.strictEqual(
      h.fake.sent("GET", `/vms/${VM_LAB_01}/alarms`).length,
      0,
    );
  });

  test("an object Xen Orchestra does not have is said so", async () => {
    const h: Harness = harness();
    const missing: string = "00000000-0000-4000-8000-000000000000";
    const result: ExecResult = await run(h, `xo-cli rest get vms/${missing}`);

    assert.strictEqual(result.exitCode, 1);
    assert.match(String(result.errorMessage), /HTTP 404 \(no such VM 0{8}/);
  });

  test("every read uses the read token, and the read token only", async () => {
    const h: Harness = harness(FIXES_ON);

    await run(h, "xo-cli rest get vms fields=name_label");
    await run(h, `xo-cli rest get pools/${PROD_POOL}`);
    await run(h, "xo-cli rest get backup-jobs fields=name,mode");

    for (const request of h.fake.requests) {
      assert.strictEqual(
        request.token,
        "read",
        `${request.method} ${request.path}`,
      );
      assert.strictEqual(request.method, "GET");
      assert.strictEqual(request.headers["authorization"], undefined);
    }
  });

  test("the read token's standing is checked once, then kept for a while", async () => {
    const h: Harness = harness();

    await run(h, "xo-cli rest get vms fields=name_label");
    await run(h, "xo-cli rest get hosts fields=name_label");
    await run(h, "xo-cli rest get srs fields=name_label");

    const checks: number = h.fake.requests.filter(
      (request: FakeXoRequest): boolean => {
        return request.path === "/users/me";
      },
    ).length;

    assert.strictEqual(checks, 1);

    h.clock.nowMs += READ_TOKEN_CHECK_TTL_MS + 1;
    await run(h, "xo-cli rest get srs fields=name_label");

    assert.strictEqual(
      h.fake.requests.filter((request: FakeXoRequest): boolean => {
        return request.path === "/users/me";
      }).length,
      2,
    );
  });

  test("an investigation never runs a change", () => {
    const h: Harness = harness(FIXES_ON);
    const prepared: PrepareResult = prepare(
      h,
      `xo-cli rest post vms/${VM_APP_02}/actions/start`,
      "AiInvestigation",
    );

    assert.match(
      String(prepared.refusal),
      /an investigation may only run read-only commands/,
    );
  });

  test("a large answer is cut at whole entries, and says so", async () => {
    const fake: FakeXenOrchestra = new FakeXenOrchestra();
    const messages: Array<XoObject> = fake.objects.get("messages") || [];

    for (let i: number = 0; i < 6000; i++) {
      messages.push({
        type: "message",
        id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
        name: "VM_STARTED",
        time: 1764000000 + i,
        $object: VM_WEB_01,
        body: `${"x".repeat(900)} ${i}`,
        $pool: PROD_POOL,
        $poolId: PROD_POOL,
      });
    }

    const h: Harness = harness({}, { fake });
    const result: ExecResult = await run(
      h,
      "xo-cli rest get messages fields=name,body limit=5000",
    );

    assert.strictEqual(result.success, true);
    assert.match(result.output, /more entries not shown|output truncated/);
    assert.ok(Buffer.byteLength(result.output, "utf8") <= 1024 * 1024 + 512);
  });
});

// ---- The read token ---------------------------------------------------------------

describe("the read token must be Xen Orchestra's Read only", () => {
  test("an administrator's token makes the agent run nothing", async () => {
    const h: Harness = harness({ ONEUPTIME_AI_XO_READ_TOKEN: ADMIN_TOKEN });
    const result: ExecResult = await run(
      h,
      "xo-cli rest get vms fields=name_label",
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.output, "");
    assert.match(
      String(result.errorMessage),
      /belongs to a Xen Orchestra administrator \(admin@admin\.net\), whom Xen Orchestra lets change anything/,
    );
    assert.match(
      String(result.errorMessage),
      /copy of the built-in Read only role/,
    );
    assert.strictEqual(h.fake.sent("GET", "/vms").length, 0);
  });

  test("a token whose roles allow a change makes the agent run nothing", async () => {
    const h: Harness = harness({ ONEUPTIME_AI_XO_READ_TOKEN: MIXED_TOKEN });
    const result: ExecResult = await run(
      h,
      "xo-cli rest get vms fields=name_label",
    );

    assert.strictEqual(result.exitCode, undefined);
    assert.match(
      String(result.errorMessage),
      /whose roles allow changes \(vm:start\)/,
    );
    assert.strictEqual(h.fake.sent("GET", "/vms").length, 0);
  });

  test("a token Xen Orchestra does not know says so", async () => {
    const h: Harness = harness({
      ONEUPTIME_AI_XO_READ_TOKEN: "expired-Tok3nXoForgotItAfterItsExpiration_1",
    });
    const result: ExecResult = await run(
      h,
      "xo-cli rest get vms fields=name_label",
    );

    assert.strictEqual(result.exitCode, undefined);
    assert.match(
      String(result.errorMessage),
      /did not accept ONEUPTIME_AI_XO_READ_TOKEN, which is wrong or has expired/,
    );
  });

  test("a problem is checked again at the next command, never kept", async () => {
    const fake: FakeXenOrchestra = new FakeXenOrchestra();
    const h: Harness = harness(
      { ONEUPTIME_AI_XO_READ_TOKEN: MIXED_TOKEN },
      { fake },
    );

    assert.strictEqual(
      (await run(h, "xo-cli rest get vms")).exitCode,
      undefined,
    );

    // The operator fixes the user's roles in Xen Orchestra.
    const user: FakeXoUser = fake.users.get(
      "c8715f02-20e7-4881-8b02-28ce2260c39f",
    )!;
    user.privileges = user.privileges.filter(
      (privilege: FakeXoPrivilege): boolean => {
        return privilege.action === "read";
      },
    );

    assert.strictEqual((await run(h, "xo-cli rest get vms")).success, true);
  });
});

// ---- Fixes ------------------------------------------------------------------------

describe("fixes, only when allowed", () => {
  test("starting a halted VM: read it, change it with the fix token, follow its task, read it again", async () => {
    const h: Harness = harness(FIXES_ON);

    h.fake.pollsUntilDone = 2;

    const result: ExecResult = await fix(
      h,
      `xo-cli rest post vms/${VM_APP_02}/actions/start`,
    );

    assert.strictEqual(result.success, true, String(result.errorMessage));
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.output, /"taskId": "0mt000001"/);
    assert.match(result.output, /task 0mt000001 finished: success/);
    assert.match(
      result.output,
      new RegExp(
        `VM ${VM_APP_02} now: name_label: app-02, power_state: Running`,
      ),
    );
    assert.strictEqual(vmPowerState(h.fake, VM_APP_02), "Running");

    assert.deepStrictEqual(
      commandRequests(h.fake).map((request: FakeXoRequest): string => {
        return `${request.method} ${request.path} ${request.token}`;
      }),
      [
        `GET /vms/${VM_APP_02} read`,
        `POST /vms/${VM_APP_02}/actions/start fix`,
        "GET /tasks/0mt000001 read",
        "GET /tasks/0mt000001 read",
        `GET /vms/${VM_APP_02} read`,
      ],
    );

    const post: FakeXoRequest = h.fake.sent(
      "POST",
      `/vms/${VM_APP_02}/actions/start`,
    )[0]!;

    assert.strictEqual(post.body, "{}");
    assert.strictEqual(post.headers["content-type"], "application/json");
    assert.strictEqual(
      post.headers["cookie"],
      `authenticationToken=${FIX_TOKEN}`,
    );
    // The agent waited between polls on its own clock.
    assert.deepStrictEqual(h.clock.sleeps, [1000]);
  });

  test("re-plugging a storage repository on the host it is unplugged from", async () => {
    const h: Harness = harness(FIXES_ON);
    const result: ExecResult = await fix(
      h,
      `xo-cli rest post pbds/${PBD_NFS_PROD_2}/actions/plug`,
    );

    assert.strictEqual(result.success, true, String(result.errorMessage));
    assert.match(
      result.output,
      new RegExp(`PBD ${PBD_NFS_PROD_2} now: attached: true`),
    );
    assert.strictEqual(
      (h.fake.find("pbds", PBD_NFS_PROD_2) as XoObject)["attached"],
      true,
    );
  });

  test("a PBD whose host is down: Xen Orchestra's task fails, and the command with it", async () => {
    const h: Harness = harness(FIXES_ON);
    const result: ExecResult = await fix(
      h,
      `xo-cli rest post pbds/${PBD_NFS_PROD_3}/actions/plug`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /task 0mt000001 failed: HOST_OFFLINE/,
    );
    assert.strictEqual(
      (h.fake.find("pbds", PBD_NFS_PROD_3) as XoObject)["attached"],
      false,
    );
  });

  test("running a failed backup's schedule again", async () => {
    const h: Harness = harness(FIXES_ON);
    const logs: number = (h.fake.objects.get("backup-logs") || []).length;
    const result: ExecResult = await fix(
      h,
      `xo-cli rest post schedules/${SCHEDULE_NIGHTLY}/actions/run`,
    );

    assert.strictEqual(result.success, true, String(result.errorMessage));
    assert.strictEqual(
      (h.fake.objects.get("backup-logs") || []).length,
      logs + 1,
    );
    // A schedule is Xen Orchestra's: no object of the pool to read first.
    assert.strictEqual(
      h.fake.sent("GET", `/schedules/${SCHEDULE_NIGHTLY}`).length,
      0,
    );
    assert.ok(BACKUP_LOG_FAILED);
  });

  test("enabling a disabled host, a snapshot and a migration within the pool", async () => {
    const h: Harness = harness(FIXES_ON);

    assert.strictEqual(
      (await fix(h, `xo-cli rest post hosts/${HOST_PROD_2}/actions/enable`))
        .success,
      true,
    );
    assert.strictEqual(
      (h.fake.find("hosts", HOST_PROD_2) as XoObject)["enabled"],
      true,
    );

    const snapshot: ExecResult = await fix(
      h,
      `xo-cli rest post vms/${VM_WEB_01}/actions/snapshot 'name_label=before fix'`,
    );

    assert.strictEqual(snapshot.success, true);
    assert.strictEqual(
      h.fake.sent("POST", `/vms/${VM_WEB_01}/actions/snapshot`)[0]!.body,
      JSON.stringify({ name_label: "before fix" }),
    );

    const migrate: ExecResult = await fix(
      h,
      `xo-cli rest post vms/${VM_DB_01}/actions/migrate hostId=${HOST_PROD_1}`,
    );

    assert.strictEqual(migrate.success, true, String(migrate.errorMessage));
    assert.strictEqual(
      (h.fake.find("vms", VM_DB_01) as XoObject)["$container"],
      HOST_PROD_1,
    );
    assert.strictEqual(
      h.fake.sent("GET", `/hosts/${HOST_PROD_1}`).length,
      1,
      "the destination is read first",
    );
  });

  test("a VM already as the change would leave it is not changed again", async () => {
    const h: Harness = harness(FIXES_ON);
    const result: ExecResult = await fix(
      h,
      `xo-cli rest post vms/${VM_WEB_01}/actions/start`,
    );

    assert.strictEqual(result.success, true);
    assert.match(
      result.output,
      new RegExp(
        `VM ${VM_WEB_01} is already power_state Running: nothing was changed`,
      ),
    );
    assert.strictEqual(h.fake.changes().length, 0);
  });

  test("a change that does not apply is refused before it is sent, with what to do instead", async () => {
    const h: Harness = harness(FIXES_ON);
    const resume: ExecResult = await fix(
      h,
      `xo-cli rest post vms/${VM_APP_02}/actions/resume`,
    );
    const start: ExecResult = await fix(
      h,
      `xo-cli rest post vms/${VM_REPORT_05}/actions/start`,
    );

    assert.strictEqual(resume.exitCode, undefined);
    assert.match(
      String(resume.errorMessage),
      /is Halted, but resume needs it Suspended; start it instead/,
    );
    assert.strictEqual(start.exitCode, undefined);
    assert.match(
      String(start.errorMessage),
      /is Paused, but start needs it Halted; unpause it instead/,
    );
    assert.strictEqual(h.fake.changes().length, 0);
  });

  test("another pool's VM is never changed", async () => {
    const h: Harness = harness(FIXES_ON);
    const result: ExecResult = await fix(
      h,
      `xo-cli rest post vms/${VM_LAB_01}/actions/start`,
    );

    assert.strictEqual(result.exitCode, undefined);
    assert.match(
      String(result.errorMessage),
      new RegExp(`is in pool ${LAB_POOL}, not in pool ${PROD_POOL}`),
    );
    assert.strictEqual(h.fake.changes().length, 0);
    assert.strictEqual(vmPowerState(h.fake, VM_LAB_01), "Halted");
  });

  test("a migration to another pool's host, or to where the VM already runs, is refused", async () => {
    const h: Harness = harness(FIXES_ON);
    const away: ExecResult = await fix(
      h,
      `xo-cli rest post vms/${VM_WEB_01}/actions/migrate hostId=${HOST_LAB_1}`,
    );
    const nowhere: ExecResult = await fix(
      h,
      `xo-cli rest post vms/${VM_WEB_01}/actions/migrate hostId=${HOST_PROD_1}`,
    );

    assert.match(
      String(away.errorMessage),
      new RegExp(`host ${HOST_LAB_1} is in pool ${LAB_POOL}`),
    );
    assert.match(String(nowhere.errorMessage), /already runs on host/);
    assert.strictEqual(h.fake.changes().length, 0);
  });

  test("an object Xen Orchestra does not have is never changed", async () => {
    const h: Harness = harness(FIXES_ON);
    const result: ExecResult = await fix(
      h,
      "xo-cli rest post vms/00000000-0000-4000-8000-000000000000/actions/start",
    );

    assert.strictEqual(result.exitCode, undefined);
    assert.match(String(result.errorMessage), /Xen Orchestra has no VM 0{8}/);
    assert.strictEqual(h.fake.changes().length, 0);
  });

  test("a change Xen Orchestra's task fails: the reason, from XAPI, fails the command", async () => {
    const h: Harness = harness(FIXES_ON);

    h.fake.failNextTaskWith = {
      code: "VM_REQUIRES_SR",
      message: `VM_REQUIRES_SR(OpaqueRef:7b8c9d0e, OpaqueRef:1d2c3b4a)`,
    };

    const result: ExecResult = await fix(
      h,
      `xo-cli rest post vms/${VM_APP_02}/actions/start`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /task 0mt000001 failed: VM_REQUIRES_SR\(OpaqueRef/,
    );
    assert.match(result.output, /task 0mt000001 failed/);
    assert.strictEqual(vmPowerState(h.fake, VM_APP_02), "Halted");
  });

  test("a task still running when the budget ends says how to follow it", async () => {
    const h: Harness = harness(FIXES_ON);

    h.fake.pollsUntilDone = 1_000_000;

    const prepared: PrepareResult = prepare(
      h,
      `xo-cli rest post vms/${VM_APP_02}/actions/start`,
      "AiRemediation",
      10_000,
    );
    const result: ExecResult = await (prepared as PreparedCommand).run();

    assert.strictEqual(result.success, true);
    assert.match(
      result.output,
      /was still running when the agent stopped waiting/,
    );
    assert.match(result.output, /xo-cli rest get tasks\/0mt000001/);
    assert.ok(h.clock.sleeps.length >= 5);
  });

  test("without the fix token the agent changes nothing, and says what it needs", () => {
    const h: Harness = harness({ ONEUPTIME_AI_ALLOW_WRITES: "true" });

    assert.strictEqual(h.config.allowWrites, false);

    const prepared: PrepareResult = prepare(
      h,
      `xo-cli rest post vms/${VM_APP_02}/actions/start`,
      "AiRemediation",
    );

    assert.match(
      String(prepared.refusal),
      /Changes use a Xen Orchestra token of their own, so set ONEUPTIME_AI_XO_WRITE_TOKEN/,
    );
  });

  test("the read token as the fix token is refused before anything", () => {
    const h: Harness = harness({
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_XO_WRITE_TOKEN: READ_TOKEN,
    });

    assert.strictEqual(h.config.allowWrites, false);
    assert.match(
      String(
        prepare(
          h,
          `xo-cli rest post vms/${VM_APP_02}/actions/start`,
          "AiRemediation",
        ).refusal,
      ),
      /ONEUPTIME_AI_XO_WRITE_TOKEN is the read token/,
    );
  });

  test("a fix token whose user lacks the privilege: Xen Orchestra refuses, and the agent says what to grant", async () => {
    const h: Harness = harness({
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_XO_WRITE_TOKEN: POWER_TOKEN,
    });
    const result: ExecResult = await fix(
      h,
      `xo-cli rest post pbds/${PBD_NFS_PROD_2}/actions/plug`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /HTTP 403 \(not enough privileges\)/,
    );
    assert.match(String(result.errorMessage), /lacks pbd:plug/);
    assert.strictEqual(
      (h.fake.find("pbds", PBD_NFS_PROD_2) as XoObject)["attached"],
      false,
    );
  });
});

// ---- Xen Orchestra keeps the read token read-only ----------------------------

describe("with a Read only token, Xen Orchestra refuses what the policy wrongly allowed", () => {
  test("a change sent with a Read only user's token is refused, and changes nothing", async () => {
    // The fix token is, by mistake, another Read only user's.
    const h: Harness = harness({
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_XO_WRITE_TOKEN: SECOND_READ_TOKEN,
    });
    const before: string = snapshot(h.fake);
    const result: ExecResult = await fix(
      h,
      `xo-cli rest post vms/${VM_APP_02}/actions/start`,
    );

    assert.strictEqual(result.success, false);
    assert.match(
      String(result.errorMessage),
      /HTTP 403 \(not enough privileges\)/,
    );
    assert.match(String(result.errorMessage), /lacks vm:start/);
    assert.strictEqual(vmPowerState(h.fake, VM_APP_02), "Halted");
    assert.strictEqual(snapshot(h.fake), before);
  });

  /*
   * Every change Xen Orchestra's REST API takes on the lab's objects -
   * those the policy allows and those it denies - sent straight to it with
   * the read token, as if the policy (and the agent's own checks) had let
   * each one through: Xen Orchestra refuses each, and nothing changes.
   */
  const CHANGES: ReadonlyArray<[string, string, string | null]> = [
    ["POST", `/vms/${VM_APP_02}/actions/start`, "{}"],
    ["POST", `/vms/${VM_WEB_01}/actions/clean_shutdown`, "{}"],
    ["POST", `/vms/${VM_WEB_01}/actions/hard_reboot`, "{}"],
    ["POST", `/vms/${VM_WEB_01}/actions/snapshot`, "{}"],
    [
      "POST",
      `/vms/${VM_WEB_01}/actions/migrate`,
      JSON.stringify({ hostId: HOST_PROD_2 }),
    ],
    ["POST", `/vms/${VM_WEB_01}/actions/clone`, "{}"],
    ["POST", `/vms/${VM_WEB_01}/actions/revert_snapshot`, "{}"],
    ["POST", `/pbds/${PBD_NFS_PROD_2}/actions/plug`, null],
    ["POST", `/pbds/${PBD_NFS_PROD_2}/actions/unplug`, null],
    ["POST", `/schedules/${SCHEDULE_NIGHTLY}/actions/run`, null],
    ["POST", `/hosts/${HOST_PROD_2}/actions/enable`, null],
    ["POST", `/hosts/${HOST_PROD_1}/actions/disable`, null],
    ["POST", `/hosts/${HOST_PROD_1}/actions/clean_shutdown`, "{}"],
    ["POST", `/hosts/${HOST_PROD_1}/actions/restart_toolstack`, "{}"],
    ["POST", `/pools/${PROD_POOL}/actions/rolling_reboot`, "{}"],
    ["POST", `/pools/${PROD_POOL}/actions/emergency_shutdown`, null],
    ["POST", `/srs/${SR_PROD_NFS}/actions/forget`, null],
    ["DELETE", `/vms/${VM_WEB_01}`, null],
    ["DELETE", `/srs/${SR_PROD_NFS}`, null],
    ["PATCH", `/vms/${VM_WEB_01}`, JSON.stringify({ name_label: "renamed" })],
    ["PUT", `/vms/${VM_WEB_01}/tags/x`, null],
  ];

  for (const [method, routePath, body] of CHANGES) {
    test(`${method} ${routePath} with the read token: 403, nothing changed`, async () => {
      const fake: FakeXenOrchestra = new FakeXenOrchestra();
      const before: string = snapshot(fake);
      const request: XoHttpRequest = {
        method: method as XoHttpRequest["method"],
        hostname: "xo.lab.example",
        port: 443,
        path: `/rest/v0${routePath}`,
        headers: {
          Cookie: `authenticationToken=${READ_TOKEN}`,
          "Content-Type": "application/json",
        },
        body,
        ca: "",
        tlsServerName: "xo.lab.example",
        timeoutInMs: 1000,
        maxResponseBytes: 1024 * 1024,
      };
      const response: XoHttpResponse = await fake.transport(request);

      assert.strictEqual(response.statusCode, 403, response.body);
      assert.strictEqual(
        JSON.parse(response.body).error,
        "not enough privileges",
      );
      assert.strictEqual(snapshot(fake), before);
    });
  }

  test("the same changes with the fix token are what its role allows, no more", async () => {
    const fake: FakeXenOrchestra = new FakeXenOrchestra();
    const allowedByRole: Array<string> = [];

    for (const [method, routePath, body] of CHANGES) {
      const response: XoHttpResponse = await fake.transport({
        method: method as XoHttpRequest["method"],
        hostname: "xo.lab.example",
        port: 443,
        path: `/rest/v0${routePath}`,
        headers: { Cookie: `authenticationToken=${FIX_TOKEN}` },
        body,
        ca: "",
        tlsServerName: "xo.lab.example",
        timeoutInMs: 1000,
        maxResponseBytes: 1024 * 1024,
      });

      if (response.statusCode !== 403) {
        allowedByRole.push(
          `${method} ${routePath.split("/").slice(0, 2).join("/")}/${routePath.split("/").slice(3).join("/")}`,
        );
      }
    }

    assert.deepStrictEqual(allowedByRole, [
      "POST /vms/actions/start",
      "POST /vms/actions/clean_shutdown",
      "POST /vms/actions/hard_reboot",
      "POST /vms/actions/snapshot",
      "POST /vms/actions/migrate",
      "POST /pbds/actions/plug",
      "POST /schedules/actions/run",
      "POST /hosts/actions/enable",
      "POST /hosts/actions/restart_toolstack",
    ]);
  });
});

// ---- Answers and failures -------------------------------------------------------

describe("what Xen Orchestra answers, and what goes wrong on the way", () => {
  function answering(
    h: Harness,
    path: string,
    answer: {
      statusCode: number;
      headers?: Record<string, string>;
      body: string;
    },
  ): void {
    h.fake.intercept = (request: FakeXoRequest) => {
      return request.path === path
        ? {
            statusCode: answer.statusCode,
            headers: answer.headers || {},
            body: answer.body,
          }
        : null;
    };
  }

  test("a token that stopped working mid-way", async () => {
    const h: Harness = harness();

    answering(h, "/vms", {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "invalid credentials" }),
    });

    const result: ExecResult = await run(
      h,
      "xo-cli rest get vms fields=name_label",
    );

    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /HTTP 401 \(invalid credentials\)/,
    );
    assert.match(String(result.errorMessage), /which is wrong or has expired/);
  });

  test("an XCP-ng error, as Xen Orchestra passes it on", async () => {
    const h: Harness = harness();

    answering(h, `/hosts/${HOST_PROD_1}/stats`, {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "HOST_OFFLINE(OpaqueRef:9a9b0a02)",
        info: "This is a XenServer/XCP-ng error, not an XO error",
      }),
    });

    const result: ExecResult = await run(
      h,
      `xo-cli rest get hosts/${HOST_PROD_1}/stats`,
    );

    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /HTTP 500 \(HOST_OFFLINE\(OpaqueRef:9a9b0a02\) - This is a XenServer\/XCP-ng error/,
    );
  });

  test("a login page instead of Xen Orchestra's JSON", async () => {
    const h: Harness = harness();

    answering(h, "/vms", {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: "<!DOCTYPE html><html><body>Sign in</body></html>",
    });

    const result: ExecResult = await run(
      h,
      "xo-cli rest get vms fields=name_label",
    );

    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /not as Xen Orchestra's REST API does/,
    );
  });

  test("a redirect is never followed, and nothing ran", async () => {
    const h: Harness = harness();

    answering(h, "/vms", {
      statusCode: 302,
      headers: { Location: "https://sso.example.lan/login" },
      body: "",
    });

    const result: ExecResult = await run(
      h,
      "xo-cli rest get vms fields=name_label",
    );

    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.output, "");
    assert.match(
      String(result.errorMessage),
      /redirect \(HTTP 302 to https:\/\/sso\.example\.lan\/login\), which the agent never follows/,
    );
  });

  function failingTransport(
    fake: FakeXenOrchestra,
    when: (request: XoHttpRequest) => boolean,
    error: XoTransportError,
  ): (request: XoHttpRequest) => Promise<XoHttpResponse> {
    return async (request: XoHttpRequest): Promise<XoHttpResponse> => {
      if (when(request)) {
        throw error;
      }

      return fake.transport(request);
    };
  }

  function harnessWithTransport(
    overrides: Record<string, string>,
    transport: (request: XoHttpRequest) => Promise<XoHttpResponse>,
  ): XcpNgExecutor {
    const env: Record<string, string> = xoEnv(overrides);

    return new XcpNgExecutor(
      {
        config: testConfig(URL, env),
        env,
        tmpDir,
        logger: recordingLogger(),
        now: new FakeClock().now,
      },
      { transport, sleep: new FakeClock().sleep },
    );
  }

  async function runWith(
    executor: XcpNgExecutor,
    command: string,
    origin: string = "AiInvestigation",
  ): Promise<ExecResult> {
    const prepared: PrepareResult = executor.prepare({
      payload: payload(command),
      origin,
      timeoutInMs: 30_000,
      agentResourceId: TEST_RESOURCE_ID,
    });

    return (prepared as PreparedCommand).run();
  }

  test("Xen Orchestra's own certificate: refused, and how to replace it", async () => {
    const fake: FakeXenOrchestra = new FakeXenOrchestra();
    const executor: XcpNgExecutor = harnessWithTransport(
      {},
      failingTransport(
        fake,
        () => {
          return true;
        },
        new XoTransportError({
          kind: "tls",
          message: CERTIFICATE_NAMES_NO_ADDRESS,
          code: "ERR_TLS_CERT_ALTNAME_INVALID",
        }),
      ),
    );
    const result: ExecResult = await runWith(executor, "xo-cli rest get vms");

    assert.strictEqual(result.exitCode, undefined);
    assert.match(
      String(result.errorMessage),
      /the certificate Xen Orchestra makes for itself when it has none, and no TLS client can check it, pinned or not/,
    );
    assert.match(
      String(result.errorMessage),
      /When Xen Orchestra uses its own self-signed certificate/,
    );
  });

  test("a certificate for another name says to set XO_TLS_SERVER_NAME", async () => {
    const executor: XcpNgExecutor = harnessWithTransport(
      {},
      failingTransport(
        new FakeXenOrchestra(),
        () => {
          return true;
        },
        new XoTransportError({
          kind: "tls",
          message: "Hostname/IP does not match certificate's altnames",
          code: "ERR_TLS_CERT_ALTNAME_INVALID",
        }),
      ),
    );
    const result: ExecResult = await runWith(executor, "xo-cli rest get vms");

    assert.match(
      String(result.errorMessage),
      /does not list "xo\.lab\.example"\. Set XO_TLS_SERVER_NAME/,
    );
  });

  test("Xen Orchestra that cannot be reached: nothing ran", async () => {
    const executor: XcpNgExecutor = harnessWithTransport(
      { XO_ADDRESS: "localhost:443" },
      failingTransport(
        new FakeXenOrchestra(),
        () => {
          return true;
        },
        new XoTransportError({
          kind: "connect",
          message: "connect ECONNREFUSED",
          code: "ECONNREFUSED",
        }),
      ),
    );
    const result: ExecResult = await runWith(executor, "xo-cli rest get vms");

    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.output, "");
    assert.match(
      String(result.errorMessage),
      /nothing is listening there \(connection refused\)/,
    );
    assert.match(
      String(result.errorMessage),
      /inside the agent's container is the container itself/,
    );
  });

  test("a change whose answer never came may have landed, and says so in its output", async () => {
    const fake: FakeXenOrchestra = new FakeXenOrchestra();
    const executor: XcpNgExecutor = harnessWithTransport(
      FIXES_ON,
      failingTransport(
        fake,
        (request: XoHttpRequest) => {
          return request.method === "POST";
        },
        new XoTransportError({
          kind: "timeout",
          message: "no answer within 30000ms",
        }),
      ),
    );
    const result: ExecResult = await runWith(
      executor,
      `xo-cli rest post vms/${VM_APP_02}/actions/start`,
      "AiRemediation",
    );

    assert.strictEqual(result.success, false);
    assert.notStrictEqual(result.output, "");
    assert.match(
      String(result.errorMessage),
      /may still have been carried out: read the object's state/,
    );
  });

  test("an unreadable CA file: nothing ran, and where to mount it", async () => {
    const h: Harness = harness({
      ONEUPTIME_AI_XO_CA_FILE: path.join(tmpDir, "missing.pem"),
    });
    const result: ExecResult = await run(h, "xo-cli rest get vms");

    assert.strictEqual(result.exitCode, undefined);
    assert.match(
      String(result.errorMessage),
      /\.\/xo-ca\.pem:\/etc\/oneuptime\/xo-ca\.pem:ro/,
    );
    assert.strictEqual(h.fake.requests.length, 0);
  });
});

// ---- Secrets ----------------------------------------------------------------------

describe("no password, key or token reaches the model, or a log", () => {
  test("a CIFS repository's password, a cloud-init payload and a pool's secret are masked", async () => {
    const h: Harness = harness();
    const pbds: ExecResult = await run(h, "xo-cli rest get pbds fields=*");
    const vm: ExecResult = await run(h, `xo-cli rest get vms/${VM_APP_02}`);
    const pools: ExecResult = await run(h, "xo-cli rest get pools fields=*");

    assert.match(pbds.output, /nas01\.example\.lan\/isos/);
    assert.doesNotMatch(
      pbds.output,
      new RegExp(CIFS_PASSWORD.replace(/[!]/g, "\\!")),
    );
    assert.match(vm.output, /"name_label": "app-02"/);
    assert.doesNotMatch(vm.output, new RegExp(CLOUD_INIT_ROOT_PASSWORD));
    assert.match(pools.output, /"name_label": "Production"/);
    assert.doesNotMatch(pools.output, new RegExp(XSCONTAINER_SECRET));
  });

  test("no token appears in any output, error, posture or log, whatever happens", async () => {
    const logs: CapturedLogs = captureLogs();

    try {
      const outputs: Array<string> = [];
      const h: Harness = harness(FIXES_ON);
      const results: Array<ExecResult> = [
        await run(h, "xo-cli rest get vms fields=*"),
        await run(h, "xo-cli rest get pbds fields=*"),
        await fix(h, `xo-cli rest post vms/${VM_APP_02}/actions/start`),
        await fix(h, `xo-cli rest post vms/${VM_LAB_01}/actions/start`),
        await run(
          harness({ ONEUPTIME_AI_XO_READ_TOKEN: ADMIN_TOKEN }),
          "xo-cli rest get vms",
        ),
        await run(
          harness({ ONEUPTIME_AI_XO_READ_TOKEN: MIXED_TOKEN }),
          "xo-cli rest get vms",
        ),
      ];
      const posture: ResourcePostureProbe = await h.executor.probePosture();
      const badPosture: ResourcePostureProbe = await harness({
        ONEUPTIME_AI_XO_READ_TOKEN: ADMIN_TOKEN,
        ONEUPTIME_AI_XO_WRITE_TOKEN: ADMIN_TOKEN,
      }).executor.probePosture();

      for (const result of results) {
        outputs.push(result.output, String(result.errorMessage));
      }

      outputs.push(JSON.stringify(posture), JSON.stringify(badPosture));
      outputs.push(
        JSON.stringify(h.logger.records),
        JSON.stringify(logs.records),
      );

      const everything: string = outputs.join("\n");

      for (const token of ALL_TOKENS) {
        assert.strictEqual(
          everything.includes(token),
          false,
          `a token leaked: ${token.slice(0, 5)}...`,
        );
      }

      // The cookie is the only place a token travels.
      for (const request of h.fake.requests) {
        assert.strictEqual(String(request.body).includes(READ_TOKEN), false);
        assert.strictEqual(String(request.body).includes(FIX_TOKEN), false);
        assert.match(
          String(request.headers["cookie"]),
          /^authenticationToken=/,
        );
      }
    } finally {
      logs.restore();
    }
  });
});

// ---- Posture ---------------------------------------------------------------------

describe("posture", () => {
  test("a pool whose Xen Orchestra answers and whose read token only reads", async () => {
    const h: Harness = harness({ ONEUPTIME_AI_XO_WRITE_TOKEN: FIX_TOKEN });
    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: "XCP-ng 8.3.0",
      reachable: true,
      reachError: null,
      details: {
        xenOrchestra: "https://xo.lab.example",
        tlsTrust: caFile,
        tlsVerified: true,
        writeTokenConfigured: true,
        poolsVisible: 2,
        readTokenUser: "oneuptime-ai-read",
        readTokenReadOnly: true,
        poolId: PROD_POOL,
        poolName: "Production",
        haEnabled: false,
        poolMaster: "xcp-prod-01",
        writeTokenUser: "oneuptime-ai-fixes",
        writeTokenRole:
          "may vm:start, vm:shutdown, vm:reboot, vm:pause, vm:suspend, vm:resume and 9 more",
      },
      protectedTargets: [],
    });
  });

  test("the read token's problem makes the pool unreachable, plainly", async () => {
    const probe: ResourcePostureProbe = await harness({
      ONEUPTIME_AI_XO_READ_TOKEN: ADMIN_TOKEN,
    }).executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /belongs to a Xen Orchestra administrator/,
    );
    assert.strictEqual(probe.details?.["readTokenReadOnly"], false);
  });

  test("a pool Xen Orchestra does not show the token", async () => {
    const probe: ResourcePostureProbe = await harness({
      XCP_NG_POOL_ID: "00000000-0000-4000-8000-0000000000aa",
    }).executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /shows ONEUPTIME_AI_XO_READ_TOKEN no pool 0{8}-0000-4000-8000-0000000000aa: check XCP_NG_POOL_ID/,
    );
  });

  test("an administrator's fix token is said, and warned about", async () => {
    const h: Harness = harness({ ONEUPTIME_AI_XO_WRITE_TOKEN: ADMIN_TOKEN });
    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.reachable, true);
    assert.match(String(probe.details?.["writeTokenRole"]), /^administrator/);
    assert.ok(
      h.logger.records.some((record: { level: string; message: string }) => {
        return (
          record.level === "warn" && record.message.includes("administrator")
        );
      }),
    );
  });

  test("the read token as the fix token is said", async () => {
    const probe: ResourcePostureProbe = await harness({
      ONEUPTIME_AI_XO_WRITE_TOKEN: READ_TOKEN,
    }).executor.probePosture();

    assert.match(String(probe.details?.["writeTokenRole"]), /the read token/);
  });

  test("settings that do not reach Xen Orchestra are the reason", async () => {
    const probe: ResourcePostureProbe = await harness({
      XO_SCHEME: "http",
    }).executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(String(probe.reachError), /HTTPS only/);
  });
});

// ---- Which pool ---------------------------------------------------------------

describe("the pool it serves", () => {
  test("Xen Orchestra with one pool for the token: that pool", async () => {
    const h: Harness = harness({
      XCP_NG_POOL_ID: "",
      ONEUPTIME_AI_XO_READ_TOKEN: PROD_ONLY_READ_TOKEN,
    });

    assert.strictEqual(h.config.resourceIdentifier, null);
    assert.strictEqual(await h.executor.resolveResourceIdentifier(), PROD_POOL);
  });

  test("several pools: which ones, and what to set", async () => {
    const h: Harness = harness({ XCP_NG_POOL_ID: "" });

    await assert.rejects(
      h.executor.resolveResourceIdentifier(),
      new RegExp(
        `manages 2 pools \\("Production" ${PROD_POOL}, ${LAB_POOL}\\): set XCP_NG_POOL_ID to the UUID of the one this agent serves`,
      ),
    );
  });

  test("no pool: what the token's user needs", async () => {
    const fake: FakeXenOrchestra = new FakeXenOrchestra();

    fake.addUser("n0P00l-Tok3nXoUserWhoMayReadNothingAtAll_55", {
      id: "f8715f02-20e7-4881-8b02-28ce2260c3a2",
      name: "nobody",
      permission: "none",
      privileges: [],
    });

    const h: Harness = harness(
      {
        XCP_NG_POOL_ID: "",
        ONEUPTIME_AI_XO_READ_TOKEN:
          "n0P00l-Tok3nXoUserWhoMayReadNothingAtAll_55",
      },
      { fake },
    );

    await assert.rejects(
      h.executor.resolveResourceIdentifier(),
      /shows ONEUPTIME_AI_XO_READ_TOKEN no pool/,
    );
  });

  test("the factory builds this executor for an XCP-ng pool", () => {
    const env: Record<string, string> = xoEnv();

    assert.ok(
      createExecutor({
        config: testConfig(URL, env),
        env,
        tmpDir,
        logger: recordingLogger(),
      }) instanceof XcpNgExecutor,
    );
  });
});

// ---- Config ------------------------------------------------------------------

describe("the agent's configuration for an XCP-ng pool", () => {
  function config(
    overrides: Record<string, string>,
  ): ReturnType<typeof parseConfig> {
    return parseConfig({
      ONEUPTIME_URL: URL,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: "ingestion-key-1",
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "xcp-ng",
      ONEUPTIME_AI_XO_READ_TOKEN: READ_TOKEN,
      ...overrides,
    });
  }

  test("the pool is its UUID, in lower case", () => {
    const parsed: ReturnType<typeof parseConfig> = config({
      XCP_NG_POOL_ID: PROD_POOL.toUpperCase(),
    });

    assert.deepStrictEqual(parsed.problems, []);
    assert.strictEqual(parsed.config.resourceIdentifier, PROD_POOL);
    assert.strictEqual(parsed.config.identitySource, "XCP_NG_POOL_ID");
  });

  test("a name is not a pool's UUID, and never looked up", () => {
    for (const overrides of [
      { XCP_NG_POOL_ID: "Production" },
      { ONEUPTIME_AI_AGENT_RESOURCE_NAME: "Production" },
    ]) {
      const parsed: ReturnType<typeof parseConfig> = config(overrides);

      assert.strictEqual(parsed.config.resourceIdentifier, null);
      assert.match(parsed.problems.join(" "), /is not a pool's UUID/);
    }
  });

  test("no pool named is no problem: the agent asks Xen Orchestra", () => {
    const parsed: ReturnType<typeof parseConfig> = config({});

    assert.deepStrictEqual(parsed.problems, []);
    assert.strictEqual(parsed.config.resourceIdentifier, null);
  });

  test("the override wins, and is a UUID too", () => {
    const parsed: ReturnType<typeof parseConfig> = config({
      XCP_NG_POOL_ID: PROD_POOL,
      ONEUPTIME_AI_AGENT_RESOURCE_NAME: LAB_POOL,
    });

    assert.strictEqual(parsed.config.resourceIdentifier, LAB_POOL);
    assert.strictEqual(
      parsed.config.identitySource,
      "ONEUPTIME_AI_AGENT_RESOURCE_NAME",
    );
  });

  test("fixes need the fix token, which is not the read token", () => {
    const withoutToken: ReturnType<typeof parseConfig> = config({
      XCP_NG_POOL_ID: PROD_POOL,
      ONEUPTIME_AI_ALLOW_WRITES: "true",
    });
    const sameToken: ReturnType<typeof parseConfig> = config({
      XCP_NG_POOL_ID: PROD_POOL,
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_XO_WRITE_TOKEN: READ_TOKEN,
    });
    const withToken: ReturnType<typeof parseConfig> = config({
      XCP_NG_POOL_ID: PROD_POOL,
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_XO_WRITE_TOKEN: FIX_TOKEN,
    });

    assert.strictEqual(withoutToken.config.allowWrites, false);
    assert.match(
      String(withoutToken.config.writesOffReason),
      /set ONEUPTIME_AI_XO_WRITE_TOKEN/,
    );
    assert.strictEqual(sameToken.config.allowWrites, false);
    assert.match(String(sameToken.config.writesOffReason), /is the read token/);
    assert.strictEqual(withToken.config.allowWrites, true);
    assert.strictEqual(withToken.config.writesOffReason, null);
  });

  test("read-only, the fix token's absence is no problem and no warning about writes", () => {
    const parsed: ReturnType<typeof parseConfig> = config({
      XCP_NG_POOL_ID: PROD_POOL,
    });

    assert.strictEqual(parsed.config.allowWrites, false);
    assert.strictEqual(parsed.config.writesOffReason, null);
  });

  test("an entry of the agent's targets that names nothing it changes keeps it read-only", () => {
    const parsed: ReturnType<typeof parseConfig> = config({
      XCP_NG_POOL_ID: PROD_POOL,
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_XO_WRITE_TOKEN: FIX_TOKEN,
      ONEUPTIME_AI_PROTECTED_TARGETS: "xoa",
    });

    assert.strictEqual(parsed.config.allowWrites, false);
    assert.match(
      String(parsed.config.writesOffReason),
      /names nothing the XCP-ng AI agent changes/,
    );
  });

  test("a protected VM is never changed", () => {
    const h: Harness = harness({
      ...FIXES_ON,
      ONEUPTIME_AI_PROTECTED_TARGETS: VM_APP_02,
    });
    const prepared: PrepareResult = prepare(
      h,
      `xo-cli rest post vms/${VM_APP_02}/actions/start`,
      "AiRemediation",
    );

    assert.match(
      String(prepared.refusal),
      /which the XCP-ng AI agent protects/,
    );
  });

  test("write targets keep fixes to the VMs they name", () => {
    const h: Harness = harness({
      ...FIXES_ON,
      ONEUPTIME_AI_WRITE_TARGETS: "vm/*",
    });

    assert.strictEqual(
      prepare(
        h,
        `xo-cli rest post vms/${VM_APP_02}/actions/start`,
        "AiRemediation",
      ).refusal,
      null,
    );
    assert.match(
      String(
        prepare(
          h,
          `xo-cli rest post pbds/${PBD_NFS_PROD_2}/actions/plug`,
          "AiRemediation",
        ).refusal,
      ),
      /outside the targets/,
    );
  });

  test("the tier the policy reads wins over what the job claims", () => {
    const h: Harness = harness(FIXES_ON);
    const prepared: PrepareResult = h.executor.prepare({
      payload: payload(
        `xo-cli rest post vms/${VM_APP_02}/actions/clean_shutdown`,
        {
          tier: ResourceCommandTier.Read,
        },
      ),
      origin: "AiRemediation",
      timeoutInMs: 30_000,
      agentResourceId: TEST_RESOURCE_ID,
    });

    assert.match(String(prepared.refusal), /reads it as RiskyWrite/);
  });
});
