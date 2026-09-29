import { recordingLogger, testConfig } from "./Helpers/TestSupport";
import assert from "assert";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import { after, afterEach, before, describe, test } from "node:test";
import { AgentConfig } from "../Config";
import { createExecutor } from "../Executors/ExecutorFactory";
import GovcExecutor, {
  AI_VCENTER_PASSWORD_ENV,
  AI_VCENTER_USERNAME_ENV,
  GOVC_BINARY,
  GOVC_PROBE_TIMEOUT_MS,
  GOVMOMI_HOME_DIR_NAME,
  GovcAbout,
  GovcFailureKind,
  GovcSettings,
  VCenterEndpoint,
  buildGovcEnvironment,
  classifyGovcFailure,
  describeGovcAboutVersion,
  describeGovcFailure,
  findProtectedGovcTarget,
  getCaFileProblem,
  getEndpointProtectedTargets,
  inventoryName,
  normalizeVCenterEndpoint,
  parseGovcAbout,
  resolveGovcSettings,
} from "../Executors/GovcExecutor";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  PreparedCommand,
  ResourceCommandRequest,
  ResourceExecutor,
  ResourcePostureProbe,
  SpawnFunction,
} from "../Executors/ResourceExecutor";
import {
  DEFAULT_SPAWN_PATH,
  JOB_DIR_PARENT_NAME,
  JOB_HOME_DIR_NAME,
  MAX_OUTPUT_BYTES,
  NUL_REPLACEMENT,
  redactOutput,
} from "../Executors/SpawnSandbox";
import FakeGovc, {
  ABOUT_JSON_CAMEL,
  ABOUT_JSON_PASCAL,
  FakeGovcInvocation,
} from "./Helpers/FakeGovc";
import { makeTempDir } from "./Helpers/FakeBinary";
import { killAfterOutput } from "./Helpers/KillAfterOutput";
import { fakePolicy } from "./Helpers/FakeExecutor";
import { TEST_RESOURCE_ID } from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * GovcExecutor against a FAKE govc (Helpers/FakeGovc): a script started in
 * place of /usr/bin/govc that answers each govc command as scripted and
 * records its argv, its complete environment and its directories. Commands
 * are tiered by the REAL policy (the agent's copy of GovcCommandPolicy)
 * unless a case needs a command it would never allow.
 */

const URL: string = "https://oneuptime.example.com";
const VCENTER_NAME: string = "vc-prod";
const READ_ONLY_USER: string = "monitor@vsphere.local";
const READ_ONLY_PASSWORD: string = " Read-0nly pa$$ #1 ";
const AI_USER: string = "oneuptime-ai@vsphere.local";
const AI_PASSWORD: string = "Fix-it-Pa$$word";

// One fake for the whole file (a const, so tests built in loops may use it).
const govc: FakeGovc = new FakeGovc();
let tmpDir: string;

before((): void => {
  tmpDir = makeTempDir("agent-govc-");
});

after((): void => {
  govc.cleanup();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach((): void => {
  govc.reset();
});

// The collector's .env as the agent sees it, plus things govc must never get.
function agentEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: "/opt/agent/bin:/usr/bin:/bin",
    HOME: "/home/node",
    ONEUPTIME_URL: URL,
    ONEUPTIME_TELEMETRY_INGESTION_KEY: "ingestion-key-must-not-leak",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "vmware",
    VMWARE_VCENTER_NAME: VCENTER_NAME,
    VCENTER_ENDPOINT: "https://vcsa.example.com",
    VCENTER_USERNAME: READ_ONLY_USER,
    VCENTER_PASSWORD: READ_ONLY_PASSWORD,
    VCENTER_INSECURE_SKIP_VERIFY: "false",
    VCENTER_COLLECTION_INTERVAL: "2m",
    HTTPS_PROXY: "http://proxy.example.com:3128",
    NO_PROXY: "localhost",
    // A stray govc configuration must never reach govc.
    GOVC_URL: "https://attacker.example.com/sdk",
    GOVC_USERNAME: "attacker",
    GOVC_PASSWORD: "attacker-password",
    GOVC_HOST: "esx-9",
    GOVC_GUEST_LOGIN: "root:guest-password",
    GOVC_INSECURE: "true",
    GOVC_PERSIST_SESSION: "true",
    GOVMOMI_HOME: "/home/node/.govmomi",
  };

  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }

  return env;
}

function vmwareConfig(overrides: Record<string, string> = {}): AgentConfig {
  return testConfig(URL, {
    DOCKER_HOST_NAME: "",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "vmware",
    VMWARE_VCENTER_NAME: VCENTER_NAME,
    ...overrides,
  });
}

interface ExecutorSetup {
  env?: Record<string, string | undefined>;
  config?: Record<string, string>;
  spawnImpl?: SpawnFunction;
  tmpDir?: string;
  logger?: ReturnType<typeof recordingLogger>;
  guardPolicy?: ExecutorOptions["guardPolicy"];
}

function executor(setup: ExecutorSetup = {}): GovcExecutor {
  return new GovcExecutor({
    config: vmwareConfig(setup.config || {}),
    env: agentEnv(setup.env || {}),
    tmpDir: setup.tmpDir || tmpDir,
    logger: setup.logger || recordingLogger(),
    spawnImpl: setup.spawnImpl || govc.spawnImpl(),
    guardPolicy: setup.guardPolicy,
  });
}

// A payload the server would send for this govc argv (tiered by the real policy).
function payload(
  argv: Array<string>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const result: ResourceCommandPolicyResult =
    ResourceCommandPolicy.evaluateArgv({
      resourceType: AiResourceType.VMwareVCenter,
      argv,
    });

  return {
    resourceType: "VMwareVCenter",
    resourceId: TEST_RESOURCE_ID,
    resourceIdentifier: VCENTER_NAME,
    program: argv[0],
    args: argv.slice(1),
    displayCommand: result.displayCommand,
    tier:
      result.tier === ResourceCommandTier.Denied
        ? ResourceCommandTier.Read
        : result.tier,
    ...overrides,
  };
}

function request(
  argv: Array<string>,
  overrides: Partial<ResourceCommandRequest> = {},
  payloadOverrides: Record<string, unknown> = {},
): ResourceCommandRequest {
  return {
    payload: payload(argv, payloadOverrides),
    origin: "AiInvestigation",
    timeoutInMs: 30_000,
    agentResourceId: TEST_RESOURCE_ID,
    ...overrides,
  };
}

function remediation(
  argv: Array<string>,
  overrides: Partial<ResourceCommandRequest> = {},
  payloadOverrides: Record<string, unknown> = {},
): ResourceCommandRequest {
  return request(
    argv,
    { origin: "AiRemediation", ...overrides },
    payloadOverrides,
  );
}

// The agent's settings for fixes: writes on.
const WRITES_ON: Record<string, string> = { ONEUPTIME_AI_ALLOW_WRITES: "true" };

function expectRefused(prepared: PrepareResult, pattern: RegExp): string {
  assert.notStrictEqual(prepared.refusal, null, "refused");
  const refusal: string = String(prepared.refusal);
  assert.match(refusal, /^Refused by the VMware AI agent: /);
  assert.match(refusal, pattern);
  return refusal;
}

function expectPrepared(prepared: PrepareResult): PreparedCommand {
  assert.strictEqual(prepared.refusal, null, String(prepared.refusal));
  return prepared as PreparedCommand;
}

async function runCommand(
  exec: GovcExecutor,
  req: ResourceCommandRequest,
): Promise<ExecResult> {
  return expectPrepared(exec.prepare(req)).run();
}

function onlyInvocation(): FakeGovcInvocation {
  const invocations: Array<FakeGovcInvocation> = govc.getInvocations();
  assert.strictEqual(invocations.length, 1, "govc ran exactly once");
  return invocations[0]!;
}

function settingsFor(
  overrides: Record<string, string | undefined> = {},
): GovcSettings {
  return resolveGovcSettings(agentEnv(overrides));
}

describe("VCENTER_ENDPOINT as govc gets it", () => {
  const cases: Array<[string, string, string]> = [
    [
      "https://vcsa.example.com",
      "https://vcsa.example.com/sdk",
      "vcsa.example.com",
    ],
    [
      "https://vcsa.example.com/",
      "https://vcsa.example.com/sdk",
      "vcsa.example.com",
    ],
    [
      "https://vcsa.example.com/sdk",
      "https://vcsa.example.com/sdk",
      "vcsa.example.com",
    ],
    [
      "https://vcsa.example.com/sdk/",
      "https://vcsa.example.com/sdk",
      "vcsa.example.com",
    ],
    ["vcsa.example.com", "https://vcsa.example.com/sdk", "vcsa.example.com"],
    [
      "  https://VCSA.Example.com  ",
      "https://vcsa.example.com/sdk",
      "vcsa.example.com",
    ],
    [
      "https://vcsa.example.com:8443",
      "https://vcsa.example.com:8443/sdk",
      "vcsa.example.com",
    ],
    [
      "https://vcsa.example.com:443",
      "https://vcsa.example.com/sdk",
      "vcsa.example.com",
    ],
    ["https://10.0.0.5", "https://10.0.0.5/sdk", "10.0.0.5"],
    ["https://[FD00::1]", "https://[fd00::1]/sdk", "fd00::1"],
    ["[fd00::1]:8443", "https://[fd00::1]:8443/sdk", "fd00::1"],
    [
      "https://esxi01.example.com/custom/sdk",
      "https://esxi01.example.com/custom/sdk",
      "esxi01.example.com",
    ],
    [
      "https://vcsa.example.com/sdk?x=1#frag",
      "https://vcsa.example.com/sdk",
      "vcsa.example.com",
    ],
  ];

  for (const [value, url, host] of cases) {
    test(`"${value}" -> ${url}`, () => {
      assert.deepStrictEqual(normalizeVCenterEndpoint(value), {
        url,
        host,
        hadCredentials: false,
        problem: null,
      });
    });
  }

  test("a user name or password in the address is dropped (never passed to govc) and noted", () => {
    const endpoint: VCenterEndpoint = normalizeVCenterEndpoint(
      "https://admin:s3cret@vcsa.example.com",
    );

    assert.deepStrictEqual(endpoint, {
      url: "https://vcsa.example.com/sdk",
      host: "vcsa.example.com",
      hadCredentials: true,
      problem: null,
    });
  });

  test("unset or blank: the variable to set, with an example", () => {
    for (const value of [undefined, null, "", "   "]) {
      const endpoint: VCenterEndpoint = normalizeVCenterEndpoint(value);
      assert.strictEqual(endpoint.url, null);
      assert.strictEqual(endpoint.host, null);
      assert.match(
        String(endpoint.problem),
        /^VCENTER_ENDPOINT is not set\. Set it in the \.env file the AI agent shares with the collector to your vCenter's address, e\.g\. https:\/\/vcsa\.example\.com\.$/,
      );
    }
  });

  test("plain http is refused: the agent never sends its password unencrypted", () => {
    assert.match(
      String(normalizeVCenterEndpoint("http://vcsa.example.com").problem),
      /is a plain http:\/\/ address\. vCenter serves its API over HTTPS only.*use https:\/\//,
    );
  });

  test("another scheme, no host, or no address at all", () => {
    assert.match(
      String(normalizeVCenterEndpoint("ftp://vcsa.example.com").problem),
      /is not an https:\/\/ address/,
    );
    assert.match(
      String(normalizeVCenterEndpoint("https://").problem),
      /is not an address|names no host/,
    );
    assert.match(
      String(normalizeVCenterEndpoint("https://vcsa example.com").problem),
      /"https:\/\/vcsa example\.com" is not an address/,
    );
  });

  test("a value with credentials is never echoed in a problem", () => {
    const problem: string = String(
      normalizeVCenterEndpoint("http://admin:s3cret@vcsa.example.com").problem,
    );

    assert.doesNotMatch(problem, /s3cret|admin/);
    assert.match(
      problem,
      /its value is not shown: it contains a user name or password/,
    );
  });
});

describe("the settings govc runs with", () => {
  test("the collector's read-only user by default, exactly as set (a password keeps its spaces)", () => {
    const settings: GovcSettings = settingsFor();

    assert.deepStrictEqual(settings, {
      url: "https://vcsa.example.com/sdk",
      host: "vcsa.example.com",
      endpointHadCredentials: false,
      username: READ_ONLY_USER,
      password: READ_ONLY_PASSWORD,
      usernameVariable: "VCENTER_USERNAME",
      passwordVariable: "VCENTER_PASSWORD",
      insecureSkipVerify: false,
      caFile: null,
      datacenter: null,
      problems: [],
    });
  });

  test("the AI user wins when it is set: fixes need a role the read-only user does not have", () => {
    const settings: GovcSettings = settingsFor({
      [AI_VCENTER_USERNAME_ENV]: `  ${AI_USER}  `,
      [AI_VCENTER_PASSWORD_ENV]: AI_PASSWORD,
    });

    assert.strictEqual(settings.username, AI_USER);
    assert.strictEqual(settings.password, AI_PASSWORD);
    assert.strictEqual(settings.usernameVariable, AI_VCENTER_USERNAME_ENV);
    assert.strictEqual(settings.passwordVariable, AI_VCENTER_PASSWORD_ENV);
    assert.deepStrictEqual(settings.problems, []);
  });

  test("half an AI pair is a problem, never a silent fallback to the read-only user", () => {
    assert.match(
      settingsFor({ [AI_VCENTER_USERNAME_ENV]: AI_USER }).problems.join(" "),
      /^ONEUPTIME_AI_VCENTER_USERNAME is set but ONEUPTIME_AI_VCENTER_PASSWORD is not\./,
    );
    assert.match(
      settingsFor({ [AI_VCENTER_PASSWORD_ENV]: AI_PASSWORD }).problems.join(
        " ",
      ),
      /^ONEUPTIME_AI_VCENTER_PASSWORD is set but ONEUPTIME_AI_VCENTER_USERNAME is not\./,
    );
  });

  test("missing read-only credentials: each variable named", () => {
    const settings: GovcSettings = settingsFor({
      VCENTER_USERNAME: undefined,
      VCENTER_PASSWORD: "",
    });

    assert.strictEqual(settings.problems.length, 2);
    assert.match(settings.problems[0]!, /^VCENTER_USERNAME is not set\./);
    assert.match(settings.problems[1]!, /^VCENTER_PASSWORD is not set\./);
  });

  test("every problem at once: endpoint and credentials", () => {
    const settings: GovcSettings = resolveGovcSettings({});

    assert.deepStrictEqual(
      settings.problems.map((problem: string): string => {
        return problem.split(" ")[0]!;
      }),
      ["VCENTER_ENDPOINT", "VCENTER_USERNAME", "VCENTER_PASSWORD"],
    );
  });

  test("TLS verification stays on unless VCENTER_INSECURE_SKIP_VERIFY is exactly true", () => {
    const cases: Array<[string | undefined, boolean]> = [
      ["true", true],
      [" TRUE ", true],
      ["false", false],
      ["1", false],
      ["yes", false],
      ["", false],
      [undefined, false],
    ];

    for (const [value, insecure] of cases) {
      assert.strictEqual(
        settingsFor({ VCENTER_INSECURE_SKIP_VERIFY: value }).insecureSkipVerify,
        insecure,
        String(value),
      );
    }
  });

  test("a CA file and a datacenter are passed through when set", () => {
    const settings: GovcSettings = settingsFor({
      VCENTER_CA_FILE: " /etc/oneuptime/vcenter-ca.pem ",
      GOVC_DATACENTER: " DC-East ",
    });

    assert.strictEqual(settings.caFile, "/etc/oneuptime/vcenter-ca.pem");
    assert.strictEqual(settings.datacenter, "DC-East");
    assert.strictEqual(settingsFor({ VCENTER_CA_FILE: "  " }).caFile, null);
  });
});

describe("the CA file", () => {
  test("none configured: nothing to check", () => {
    assert.strictEqual(getCaFileProblem(null), null);
  });

  test("a readable file is fine", () => {
    const file: string = path.join(tmpDir, "ca-ok.pem");
    fs.writeFileSync(file, "-----BEGIN CERTIFICATE-----\n");
    assert.strictEqual(getCaFileProblem(file), null);
  });

  test("not there, a directory, or unreadable: says what to mount or fix", () => {
    assert.match(
      String(getCaFileProblem(path.join(tmpDir, "missing.pem"))),
      /does not exist in the agent's container\. Mount the CA bundle/,
    );
    assert.match(String(getCaFileProblem(tmpDir)), /is not a file/);

    if (process.getuid?.() !== 0) {
      const file: string = path.join(tmpDir, "ca-locked.pem");
      fs.writeFileSync(file, "x", { mode: 0o000 });
      assert.match(
        String(getCaFileProblem(file)),
        /is not readable by the agent/,
      );
    }
  });
});

describe("govc's environment", () => {
  test("exactly the variables govc needs, built from the settings", () => {
    assert.deepStrictEqual(
      buildGovcEnvironment({
        settings: settingsFor(),
        homeDir: "/tmp/job/home",
        govmomiHome: "/tmp/job/govmomi",
      }),
      {
        PATH: DEFAULT_SPAWN_PATH,
        HOME: "/tmp/job/home",
        GOVMOMI_HOME: "/tmp/job/govmomi",
        GOVC_URL: "https://vcsa.example.com/sdk",
        GOVC_USERNAME: READ_ONLY_USER,
        GOVC_PASSWORD: READ_ONLY_PASSWORD,
        GOVC_INSECURE: "false",
        GOVC_PERSIST_SESSION: "false",
      },
    );
  });

  test("TLS: skip verification, or trust a CA file; a default datacenter", () => {
    const env: Record<string, string> = buildGovcEnvironment({
      settings: settingsFor({
        VCENTER_INSECURE_SKIP_VERIFY: "true",
        VCENTER_CA_FILE: "/etc/ca.pem",
        GOVC_DATACENTER: "DC-East",
      }),
      homeDir: "/h",
      govmomiHome: "/g",
    });

    assert.strictEqual(env["GOVC_INSECURE"], "true");
    assert.strictEqual(env["GOVC_TLS_CA_CERTS"], "/etc/ca.pem");
    assert.strictEqual(env["GOVC_DATACENTER"], "DC-East");
  });
});

describe("protected objects", () => {
  test("the vCenter appliance, by the host name in VCENTER_ENDPOINT", () => {
    assert.deepStrictEqual(getEndpointProtectedTargets("vcsa.example.com"), [
      "vcsa.example.com",
      "vcsa",
    ]);
    assert.deepStrictEqual(getEndpointProtectedTargets("vcsa"), ["vcsa"]);
    assert.deepStrictEqual(getEndpointProtectedTargets("10.0.0.5"), []);
    assert.deepStrictEqual(getEndpointProtectedTargets("fd00::1"), []);
    assert.deepStrictEqual(getEndpointProtectedTargets(null), []);
  });

  test("an object's own name is the last segment of its path", () => {
    assert.strictEqual(inventoryName("/DC/vm/infra/vcsa"), "vcsa");
    assert.strictEqual(inventoryName("vcsa"), "vcsa");
    assert.strictEqual(inventoryName("/DC/vm/infra/vcsa/"), "vcsa");
    assert.strictEqual(inventoryName(""), "");
  });

  test("matched by name, whatever path names it, case-insensitively, with * globs", () => {
    const cases: Array<[string, Array<string>, string | null]> = [
      ["vcsa", ["vcsa"], "vcsa"],
      ["/DC/vm/infra/vcsa", ["vcsa"], "vcsa"],
      ["VCSA", ["vcsa"], "vcsa"],
      ["vcsa", ["/DC/vm/infra/vcsa"], "/DC/vm/infra/vcsa"],
      ["/DC/vm/db-01", ["db-*"], "db-*"],
      ["/DC/vm/web-01", ["db-*", "vcsa"], null],
      ["web-01", [], null],
      ["vcsa-backup", ["vcsa"], null],
    ];

    for (const [target, protectedTargets, expected] of cases) {
      const hit: { target: string; protectedTarget: string } | null =
        findProtectedGovcTarget({ targets: [target], protectedTargets });

      assert.strictEqual(
        hit ? hit.protectedTarget : null,
        expected,
        `${target} vs ${protectedTargets.join(",")}`,
      );
    }
  });
});

describe("prepare: the shared guard runs first", () => {
  test("a read from an investigation, every check passed: ready to run", () => {
    const prepared: PreparedCommand = expectPrepared(
      executor().prepare(request(["govc", "vm.info", "web-01"])),
    );

    assert.strictEqual(prepared.displayCommand, "govc vm.info web-01");
    assert.strictEqual(prepared.tier, ResourceCommandTier.Read);
    // prepare() itself never runs anything.
    assert.strictEqual(govc.requestedBinaries.length, 0);
  });

  const refusals: Array<[string, ResourceCommandRequest, RegExp]> = [
    [
      "a command for another vCenter",
      request(["govc", "about"], {}, { resourceIdentifier: "vc-staging" }),
      /this command is for VMware vCenter "vc-staging", but this agent serves "vc-prod"\. Check VMWARE_VCENTER_NAME/,
    ],
    [
      "a command for another kind of resource",
      request(["govc", "about"], {}, { resourceType: "ProxmoxCluster" }),
      /this command is for a "ProxmoxCluster" resource, and this agent serves a VMware vCenter/,
    ],
    [
      "a command for another resource id",
      request(["govc", "about"], {}, { resourceId: "someone-else" }),
      /this command is for resource id "someone-else"/,
    ],
    [
      "a program other than govc",
      request(["govc", "about"], {}, { program: "sh", args: ["-c", "id"] }),
      /"sh" is not a program the VMware AI agent runs \(it runs govc\)/,
    ],
    [
      "a job that is not from OneUptime AI",
      request(["govc", "about"], { origin: "Runbook" }),
      /this job came from "Runbook"/,
    ],
    [
      "a job without a tier",
      request(["govc", "about"], {}, { tier: undefined }),
      /the job does not say which tier/,
    ],
    [
      "govc env (prints the agent's password)",
      request(["govc", "env"]),
      /govc env is refused: it prints the agent's GOVC_\* settings, its vCenter password included/,
    ],
    [
      "vm.info -e (a VM's extraConfig secrets)",
      request(["govc", "vm.info", "-e", "web-01"]),
      /govc vm\.info -e is refused/,
    ],
    [
      "a different endpoint on the argv",
      request(["govc", "about", "-u", "https://attacker.example.com/sdk"]),
      /-u is refused on every govc command/,
    ],
    [
      "guest operations",
      request(["govc", "guest.run", "-vm", "web-01", "id"]),
      /govc guest\.run is refused/,
    ],
    [
      "a fix during an investigation",
      request(["govc", "vm.power", "-on", "web-01"]),
      /an investigation may only run read-only commands, and "govc vm\.power -on web-01" is SafeWrite/,
    ],
    [
      "a fix the server sent as a lower tier than it is",
      remediation(
        ["govc", "vm.power", "-off", "web-01"],
        {},
        { tier: "SafeWrite" },
      ),
      /OneUptime sent "govc vm\.power -off web-01" as SafeWrite, but this agent's policy reads it as RiskyWrite/,
    ],
  ];

  for (const [name, req, pattern] of refusals) {
    test(`refused: ${name} — and nothing is started`, async () => {
      const exec: GovcExecutor = executor({ config: WRITES_ON });
      expectRefused(exec.prepare(req), pattern);
      assert.strictEqual(govc.requestedBinaries.length, 0);
    });
  }

  test("refused: a fix on a read-only agent, naming the switch to turn on", () => {
    const refusal: string = expectRefused(
      executor().prepare(remediation(["govc", "vm.power", "-on", "web-01"])),
      /"govc vm\.power -on web-01" changes the VMware vCenter, and this agent is read-only/,
    );

    assert.match(
      refusal,
      /\(ONEUPTIME_AI_ALLOW_WRITES is not set\)\. To let OneUptime AI apply fixes, set ONEUPTIME_AI_ALLOW_WRITES=true on the agent and restart it\.$/,
    );
  });

  test("refused: a fix outside ONEUPTIME_AI_WRITE_TARGETS", () => {
    expectRefused(
      executor({
        config: { ...WRITES_ON, ONEUPTIME_AI_WRITE_TARGETS: "web-*" },
      }).prepare(remediation(["govc", "vm.power", "-on", "db-01"])),
      /would change db-01, which is outside the targets the VMware AI agent may change \(ONEUPTIME_AI_WRITE_TARGETS=web-\*\)/,
    );
  });

  test("allowed: a fix inside ONEUPTIME_AI_WRITE_TARGETS on a writable agent", () => {
    const prepared: PreparedCommand = expectPrepared(
      executor({
        config: { ...WRITES_ON, ONEUPTIME_AI_WRITE_TARGETS: "web-*" },
      }).prepare(remediation(["govc", "vm.power", "-on", "web-01"])),
    );

    assert.strictEqual(prepared.tier, ResourceCommandTier.SafeWrite);
    assert.strictEqual(prepared.displayCommand, "govc vm.power -on web-01");
  });

  test("refused: a fix on a VM in ONEUPTIME_AI_PROTECTED_TARGETS (the shared rule)", () => {
    expectRefused(
      executor({
        config: { ...WRITES_ON, ONEUPTIME_AI_PROTECTED_TARGETS: "vpn-gw" },
      }).prepare(remediation(["govc", "vm.power", "-r", "vpn-gw"])),
      /would change vpn-gw, which the VMware AI agent protects \(vpn-gw\)/,
    );
  });
});

describe("prepare: govc's own checks", () => {
  test("an agent that cannot reach vCenter as configured refuses even reads, saying what to set", () => {
    const cases: Array<[Record<string, string | undefined>, RegExp]> = [
      [{ VCENTER_ENDPOINT: undefined }, /VCENTER_ENDPOINT is not set/],
      [
        { VCENTER_ENDPOINT: "http://vcsa.example.com" },
        /plain http:\/\/ address/,
      ],
      [{ VCENTER_PASSWORD: "" }, /VCENTER_PASSWORD is not set/],
      [
        { [AI_VCENTER_USERNAME_ENV]: AI_USER },
        /ONEUPTIME_AI_VCENTER_USERNAME is set but ONEUPTIME_AI_VCENTER_PASSWORD is not/,
      ],
      [
        { VCENTER_CA_FILE: path.join(tmpDir, "no-such-ca.pem") },
        /VCENTER_CA_FILE=".*no-such-ca\.pem" does not exist in the agent's container/,
      ],
    ];

    for (const [env, pattern] of cases) {
      const refusal: string = expectRefused(
        executor({ env }).prepare(request(["govc", "about"])),
        pattern,
      );
      assert.match(refusal, /: it cannot reach vCenter as configured\. /);
    }

    assert.strictEqual(govc.requestedBinaries.length, 0);
  });

  test("the guard still answers first: a command for another vCenter is refused as such, even when misconfigured", () => {
    expectRefused(
      executor({ env: { VCENTER_ENDPOINT: undefined } }).prepare(
        request(["govc", "about"], {}, { resourceIdentifier: "vc-staging" }),
      ),
      /this command is for VMware vCenter "vc-staging"/,
    );
  });

  test("the vCenter appliance is protected by its host name, under any inventory path", () => {
    const exec: GovcExecutor = executor({ config: WRITES_ON });

    assert.deepStrictEqual(exec.getProtectedTargets(), [
      "vcsa.example.com",
      "vcsa",
    ]);

    // The bare name: the shared write-scope rule already refuses it.
    expectRefused(
      exec.prepare(remediation(["govc", "vm.power", "-r", "vcsa"])),
      /would change vcsa, which the VMware AI agent protects \(vcsa\)/,
    );

    // A path: only the executor's own check sees it is the same VM.
    const refusal: string = expectRefused(
      exec.prepare(
        remediation(["govc", "vm.power", "-off", "/DC/vm/infra/vcsa"], {}),
      ),
      /"govc vm\.power -off \/DC\/vm\/infra\/vcsa" would change \/DC\/vm\/infra\/vcsa, which the VMware AI agent protects \(vcsa\)/,
    );
    assert.match(refusal, /whatever inventory path names it\.$/);
    assert.strictEqual(govc.requestedBinaries.length, 0);
  });

  test("ONEUPTIME_AI_PROTECTED_TARGETS entries protect a VM under any path, with globs", () => {
    const exec: GovcExecutor = executor({
      config: {
        ...WRITES_ON,
        ONEUPTIME_AI_PROTECTED_TARGETS: "oneuptime-agent-vm,db-*",
      },
    });

    expectRefused(
      exec.prepare(
        remediation([
          "govc",
          "vm.power",
          "-reset",
          "/DC/vm/ops/oneuptime-agent-vm",
        ]),
      ),
      /protects \(oneuptime-agent-vm\)/,
    );
    expectRefused(
      exec.prepare(remediation(["govc", "vm.power", "-on", "/DC/vm/DB-02"])),
      /protects \(db-\*\)/,
    );
    expectPrepared(
      exec.prepare(remediation(["govc", "vm.power", "-on", "/DC/vm/web-02"])),
    );
  });

  test("an ESXi host named after the endpoint is protected from maintenance mode too", () => {
    expectRefused(
      executor({
        config: WRITES_ON,
        env: { VCENTER_ENDPOINT: "https://esxi01.example.com" },
      }).prepare(
        remediation(["govc", "host.maintenance.enter", "/DC/host/esxi01"]),
      ),
      /protects \(esxi01\)/,
    );
  });

  test("an IP endpoint protects nothing by name", () => {
    const exec: GovcExecutor = executor({
      config: WRITES_ON,
      env: { VCENTER_ENDPOINT: "https://10.0.0.5" },
    });

    assert.deepStrictEqual(exec.getProtectedTargets(), []);
    expectPrepared(
      exec.prepare(remediation(["govc", "vm.power", "-r", "vcsa"])),
    );
  });

  test("reads of a protected VM are fine: protection is about changes", () => {
    expectPrepared(
      executor().prepare(request(["govc", "vm.info", "/DC/vm/infra/vcsa"])),
    );
  });

  test("an executor handed another resource type's command refuses it: it starts govc only", () => {
    const exec: GovcExecutor = new GovcExecutor({
      config: testConfig(URL, {}),
      env: agentEnv(),
      tmpDir,
      logger: recordingLogger(),
      spawnImpl: govc.spawnImpl(),
      guardPolicy: fakePolicy({ "docker ps": ResourceCommandTier.Read }),
    });

    const prepared: PrepareResult = exec.prepare({
      payload: {
        resourceType: "DockerHost",
        resourceId: TEST_RESOURCE_ID,
        resourceIdentifier: "web-host-1",
        program: "docker",
        args: ["ps"],
        displayCommand: "docker ps",
        tier: "Read",
      },
      origin: "AiInvestigation",
      timeoutInMs: 30_000,
    });

    // The agent is (mis)configured as a Docker agent, so it speaks as one.
    assert.strictEqual(
      prepared.refusal,
      'Refused by the Docker AI agent: this executor runs govc for a VMware vCenter only, not "docker" for a DockerHost.',
    );
    assert.strictEqual(govc.requestedBinaries.length, 0);
  });

  test("credentials in VCENTER_ENDPOINT are ignored, with a warning once", () => {
    const logger: ReturnType<typeof recordingLogger> = recordingLogger();
    const exec: GovcExecutor = executor({
      logger,
      env: { VCENTER_ENDPOINT: "https://admin:s3cret@vcsa.example.com" },
    });

    assert.strictEqual(exec.getSettings().url, "https://vcsa.example.com/sdk");
    assert.strictEqual(logger.records.length, 1);
    assert.strictEqual(logger.records[0]!.level, "warn");
    assert.match(
      logger.records[0]!.message,
      /^VCENTER_ENDPOINT contains a user name or password\. The VMware AI agent ignores them and logs in with VCENTER_USERNAME \/ VCENTER_PASSWORD/,
    );
    assert.doesNotMatch(logger.records[0]!.message, /s3cret/);
  });
});

describe("run: how govc is started", () => {
  test("/usr/bin/govc with the argv exactly as sent — never a shell, never a credential on it", async () => {
    govc.setScript({ "vm.info": { stdout: "Name: web 01\n" } });
    const args: Array<string> = [
      "vm.info",
      "-r",
      "web 01; rm -rf / $(id) `id` *",
    ];

    const result: ExecResult = await runCommand(
      executor(),
      request(["govc", ...args]),
    );

    assert.strictEqual(result.success, true, String(result.errorMessage));
    assert.deepStrictEqual(govc.requestedBinaries, [GOVC_BINARY]);
    assert.deepStrictEqual(onlyInvocation().argv, args);
    assert.strictEqual(govc.spawnOptions[0]!.shell, false);
    assert.deepStrictEqual(govc.spawnOptions[0]!.stdio, [
      "ignore",
      "pipe",
      "pipe",
    ]);

    for (const arg of onlyInvocation().argv) {
      assert.doesNotMatch(arg, /Read-0nly|monitor@vsphere/);
    }
  });

  test("the environment is closed: govc's own variables only, nothing inherited", async () => {
    const previous: string | undefined = process.env["ONEUPTIME_API_KEY"];
    process.env["ONEUPTIME_API_KEY"] = "process-key-must-not-leak";

    try {
      await runCommand(executor(), request(["govc", "about"]));
    } finally {
      if (previous === undefined) {
        delete process.env["ONEUPTIME_API_KEY"];
      } else {
        process.env["ONEUPTIME_API_KEY"] = previous;
      }
    }

    const env: Record<string, string> = onlyInvocation().env;

    assert.deepStrictEqual(Object.keys(env).sort(), [
      "GOVC_INSECURE",
      "GOVC_PASSWORD",
      "GOVC_PERSIST_SESSION",
      "GOVC_URL",
      "GOVC_USERNAME",
      "GOVMOMI_HOME",
      "HOME",
      "PATH",
    ]);
    assert.strictEqual(env["PATH"], DEFAULT_SPAWN_PATH);
    // VCENTER_ENDPOINT, never the agent's stray GOVC_URL.
    assert.strictEqual(env["GOVC_URL"], "https://vcsa.example.com/sdk");
    assert.strictEqual(env["GOVC_USERNAME"], READ_ONLY_USER);
    assert.strictEqual(env["GOVC_PASSWORD"], READ_ONLY_PASSWORD);
    assert.strictEqual(env["GOVC_INSECURE"], "false");
    assert.strictEqual(env["GOVC_PERSIST_SESSION"], "false");
    assert.doesNotMatch(JSON.stringify(env), /must-not-leak|attacker|proxy/);
  });

  test("HOME and GOVMOMI_HOME are the command's private, empty directories, removed afterwards", async () => {
    const exec: GovcExecutor = executor();
    await runCommand(exec, request(["govc", "about"]));

    const invocation: FakeGovcInvocation = onlyInvocation();

    assert.strictEqual(path.basename(invocation.cwd), JOB_HOME_DIR_NAME);
    assert.strictEqual(invocation.homeExists, true);
    assert.strictEqual(invocation.cwdMode, 0o700);
    assert.strictEqual(invocation.parentMode, 0o700);
    assert.deepStrictEqual(invocation.parentEntries, [
      GOVMOMI_HOME_DIR_NAME,
      JOB_HOME_DIR_NAME,
    ]);
    assert.strictEqual(invocation.govmomiHomeMode, 0o700);
    assert.deepStrictEqual(invocation.govmomiHomeEntries, []);
    assert.strictEqual(
      path.basename(path.dirname(invocation.env["GOVMOMI_HOME"]!)),
      path.basename(path.dirname(invocation.cwd)),
      "GOVMOMI_HOME is in the same job directory as HOME",
    );
    assert.strictEqual(
      path.basename(path.dirname(path.dirname(invocation.cwd))),
      JOB_DIR_PARENT_NAME,
    );
    assert.strictEqual(fs.existsSync(path.dirname(invocation.cwd)), false);
  });

  test("the AI user's credentials, a CA file, skipped verification and a datacenter reach govc", async () => {
    const caFile: string = path.join(tmpDir, "vcenter-ca.pem");
    fs.writeFileSync(caFile, "-----BEGIN CERTIFICATE-----\n");

    await runCommand(
      executor({
        env: {
          [AI_VCENTER_USERNAME_ENV]: AI_USER,
          [AI_VCENTER_PASSWORD_ENV]: AI_PASSWORD,
          VCENTER_CA_FILE: caFile,
          VCENTER_INSECURE_SKIP_VERIFY: "true",
          GOVC_DATACENTER: "DC-East",
        },
      }),
      request(["govc", "about"]),
    );

    const env: Record<string, string> = onlyInvocation().env;

    assert.strictEqual(env["GOVC_USERNAME"], AI_USER);
    assert.strictEqual(env["GOVC_PASSWORD"], AI_PASSWORD);
    assert.strictEqual(env["GOVC_TLS_CA_CERTS"], caFile);
    assert.strictEqual(env["GOVC_INSECURE"], "true");
    assert.strictEqual(env["GOVC_DATACENTER"], "DC-East");
  });

  test("a fix runs the same way, with its tier", async () => {
    govc.setScript({
      "vm.power -on web-01": {
        stdout: "Powering on VirtualMachine:vm-42... OK\n",
      },
    });

    const prepared: PreparedCommand = expectPrepared(
      executor({ config: WRITES_ON }).prepare(
        remediation(["govc", "vm.power", "-on", "web-01"]),
      ),
    );
    const result: ExecResult = await prepared.run();

    assert.strictEqual(prepared.tier, ResourceCommandTier.SafeWrite);
    assert.deepStrictEqual(result, {
      success: true,
      exitCode: 0,
      output: "[stdout]\nPowering on VirtualMachine:vm-42... OK\n",
    });
    assert.deepStrictEqual(onlyInvocation().argv, [
      "vm.power",
      "-on",
      "web-01",
    ]);
  });
});

describe("run: the output", () => {
  test("stdout and stderr, formatted like every resource command", async () => {
    govc.setScript({
      events: {
        stdout: "[2026-09-29] VmPoweredOffEvent web-01\n",
        stderr: "warning: slow\n",
      },
    });

    const result: ExecResult = await runCommand(
      executor(),
      request(["govc", "events", "-n", "10"]),
    );

    assert.deepStrictEqual(result, {
      success: true,
      exitCode: 0,
      output:
        "[stdout]\n[2026-09-29] VmPoweredOffEvent web-01\n\n[stderr]\nwarning: slow\n",
    });
  });

  test("capped at the agent's output budget, and says so", async () => {
    govc.setScript({ ls: { stdoutBytes: MAX_OUTPUT_BYTES * 2 } });

    const result: ExecResult = await runCommand(
      executor(),
      request(["govc", "ls", "/DC/vm"]),
    );

    assert.strictEqual(result.success, true);
    assert.ok(
      Buffer.byteLength(result.output, "utf8") <= MAX_OUTPUT_BYTES + 200,
      `${Buffer.byteLength(result.output, "utf8")} bytes`,
    );
    assert.match(
      result.output,
      /\.\.\. \[output truncated: stdout cut at \d+ bytes\]$/,
    );
  });

  test("secrets govc prints are masked before the output leaves the agent", async () => {
    govc.setScript({
      "vm.info": {
        stdout: [
          "Name:           web-01",
          "  guestinfo.userdata:  I2Nsb3VkLWNvbmZpZwpwYXNzd29yZDogaHVudGVyMg==",
          '{"key":"guestinfo.metadata","value":"c2VjcmV0LW1ldGFkYXRh"}',
          "password=hunter2",
        ].join("\n"),
        stderr: '{"sessionId":"52a1b2c3-d4e5-f607"}\n',
      },
    });

    const result: ExecResult = await runCommand(
      executor(),
      request(["govc", "vm.info", "web-01"]),
    );

    assert.strictEqual(result.success, true);
    assert.match(result.output, /Name: {11}web-01/);
    assert.doesNotMatch(
      result.output,
      /I2Nsb3VkLWNvbmZpZ|c2VjcmV0LW1ldGFkYXRh|hunter2|52a1b2c3/,
    );
    assert.match(result.output, /guestinfo\.userdata: {2}\[redacted\]/);
    assert.match(result.output, /"sessionId":"\[redacted\]"/);
  });

  test("NUL characters are replaced (a database text column cannot hold them)", async () => {
    govc.setScript({ ls: { stdout: "vm\u0000name\n" } });

    const result: ExecResult = await runCommand(
      executor(),
      request(["govc", "ls"]),
    );

    assert.strictEqual(result.output, `[stdout]\nvm${NUL_REPLACEMENT}name\n`);
  });
});

describe("run: failures say what to change", () => {
  const failures: Array<[string, string, RegExp]> = [
    [
      "a rejected login",
      "govc: ServerFaultCode: Cannot complete login due to an incorrect user name or password.\n",
      /vCenter rejected the agent's login: check VCENTER_USERNAME \(the full principal, such as oneuptime@vsphere\.local\) and VCENTER_PASSWORD/,
    ],
    [
      "an untrusted certificate",
      'govc: Post "https://vcsa.example.com/sdk": tls: failed to verify certificate: x509: certificate signed by unknown authority\n',
      /does not trust vCenter's TLS certificate: set VCENTER_CA_FILE .* or VCENTER_INSECURE_SKIP_VERIFY=true/,
    ],
    [
      "a certificate for another name",
      'govc: Post "https://10.0.0.5/sdk": tls: failed to verify certificate: x509: cannot validate certificate for 10.0.0.5 because it doesn\'t contain any IP SANs\n',
      /certificate does not name the host in VCENTER_ENDPOINT/,
    ],
    [
      "an expired certificate",
      'govc: Post "https://vcsa.example.com/sdk": x509: certificate has expired or is not yet valid\n',
      /certificate has expired or is not valid yet/,
    ],
    [
      "an unknown host name",
      'govc: Post "https://vcsa.example.com/sdk": dial tcp: lookup vcsa.example.com on 127.0.0.11:53: no such host\n',
      /cannot resolve vcsa\.example\.com \(VCENTER_ENDPOINT\)/,
    ],
    [
      "nothing listening",
      'govc: Post "https://vcsa.example.com/sdk": dial tcp 10.0.0.5:443: connect: connection refused\n',
      /Nothing accepts connections at https:\/\/vcsa\.example\.com\/sdk/,
    ],
    [
      "a network that drops the connection",
      'govc: Post "https://vcsa.example.com/sdk": dial tcp 10.0.0.5:443: i/o timeout\n',
      /cannot reach vCenter at https:\/\/vcsa\.example\.com\/sdk: check the network and firewall/,
    ],
    [
      "an object the user cannot see",
      "govc: ServerFaultCode: Permission to perform this operation was denied.\n",
      /cannot see this object: grant it the Read-Only role .* "Propagate to children"/,
    ],
    [
      "several datacenters",
      "govc: default datacenter resolves to multiple instances, please specify\n",
      /more than one datacenter: add -dc DATACENTER .* GOVC_DATACENTER/,
    ],
    [
      "an ambiguous name",
      "govc: path 'web-01' resolves to multiple vms\n",
      /matches more than one object: name it by its full inventory path/,
    ],
    [
      "an unknown VM",
      "govc: vm 'web-99' not found\n",
      /No object has that name: find it with govc find/,
    ],
  ];

  for (const [name, stderr, hint] of failures) {
    test(`${name}: govc's reason, then what to do`, async () => {
      govc.setScript({ "*": { stderr, exitCode: 1 } });

      const result: ExecResult = await runCommand(
        executor(),
        request(["govc", "vm.info", "web-01"]),
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, 1);
      /*
       * govc's own line as the output shows it: redacted (a TLS error's
       * "certificate: x509:" reads as a key and its value to the redactor).
       */
      const reason: string = redactOutput({
        resourceType: AiResourceType.VMwareVCenter,
        program: "govc",
        text: stderr,
      }).trim();

      assert.ok(
        String(result.errorMessage).startsWith(`Exit code 1: ${reason}`),
        String(result.errorMessage),
      );
      assert.match(String(result.errorMessage), hint);
      assert.match(result.output, /^\[stderr\]\n/);
    });
  }

  test("a login rejected for the AI user names the AI variables", async () => {
    govc.setScript({
      "*": {
        stderr:
          "govc: ServerFaultCode: Cannot complete login due to an incorrect user name or password.\n",
        exitCode: 1,
      },
    });

    const result: ExecResult = await runCommand(
      executor({
        env: {
          [AI_VCENTER_USERNAME_ENV]: AI_USER,
          [AI_VCENTER_PASSWORD_ENV]: AI_PASSWORD,
        },
      }),
      request(["govc", "about"]),
    );

    assert.match(
      String(result.errorMessage),
      /check ONEUPTIME_AI_VCENTER_USERNAME .* and ONEUPTIME_AI_VCENTER_PASSWORD/,
    );
  });

  test("a fix the vCenter user may not make: which privileges its role needs", async () => {
    govc.setScript({
      "*": {
        stderr:
          "govc: ServerFaultCode: Permission to perform this operation was denied.\n",
        exitCode: 1,
      },
    });

    const result: ExecResult = await runCommand(
      executor({ config: WRITES_ON }),
      remediation(["govc", "vm.power", "-on", "web-01"]),
    );

    assert.match(
      String(result.errorMessage),
      /may not make this change: give the user in ONEUPTIME_AI_VCENTER_USERNAME a role with VirtualMachine\.Interact\.PowerOn, PowerOff and Reset/,
    );
  });

  test("a CA file that does not sign vCenter's certificate is named", async () => {
    const caFile: string = path.join(tmpDir, "other-ca.pem");
    fs.writeFileSync(caFile, "-----BEGIN CERTIFICATE-----\n");
    govc.setScript({
      "*": {
        stderr: "govc: x509: certificate signed by unknown authority\n",
        exitCode: 1,
      },
    });

    const result: ExecResult = await runCommand(
      executor({ env: { VCENTER_CA_FILE: caFile } }),
      request(["govc", "about"]),
    );

    assert.match(
      String(result.errorMessage),
      /The CA file in VCENTER_CA_FILE \(.*other-ca\.pem\) does not include the CA that signed vCenter's TLS certificate/,
    );
  });

  test("VMware Tools and power-state failures of a fix", async () => {
    const exec: GovcExecutor = executor({ config: WRITES_ON });

    govc.setScript({
      "*": {
        stderr:
          "govc: ServerFaultCode: Cannot complete operation because VMware Tools is not running in this virtual machine.\n",
        exitCode: 1,
      },
    });
    assert.match(
      String(
        (
          await runCommand(
            exec,
            remediation(["govc", "vm.power", "-r", "web-01"]),
          )
        ).errorMessage,
      ),
      /need VMware Tools running in the guest/,
    );

    govc.setScript({
      "*": {
        stderr:
          "govc: ServerFaultCode: The attempted operation cannot be performed in the current state (Powered on).\n",
        exitCode: 1,
      },
    });
    assert.match(
      String(
        (
          await runCommand(
            exec,
            remediation(["govc", "vm.power", "-on", "web-01"]),
          )
        ).errorMessage,
      ),
      /not in a state that allows this/,
    );
  });

  test("a failure nobody has advice for: govc's own reason only", async () => {
    govc.setScript({
      "*": { stderr: "govc: something unexpected\n", exitCode: 2 },
    });

    const result: ExecResult = await runCommand(
      executor(),
      request(["govc", "about"]),
    );

    assert.deepStrictEqual(result, {
      success: false,
      exitCode: 2,
      output: "[stderr]\ngovc: something unexpected\n",
      errorMessage: "Exit code 2: govc: something unexpected",
    });
  });

  test("a secret in govc's last line is masked in the message too", async () => {
    govc.setScript({
      "*": { stderr: "govc: bad request password=hunter2\n", exitCode: 1 },
    });

    const result: ExecResult = await runCommand(
      executor(),
      request(["govc", "about"]),
    );

    assert.doesNotMatch(String(result.errorMessage), /hunter2/);
    assert.doesNotMatch(result.output, /hunter2/);
  });

  test("classifyGovcFailure: the first rule that matches, nothing for no stderr", () => {
    const cases: Array<[string, GovcFailureKind | null]> = [
      ["", null],
      ["govc: ServerFaultCode: NotAuthenticated\n", "login"],
      ["govc: InvalidLogin\n", "login"],
      ["dial tcp: lookup vcsa: no such host", "dns"],
      ["dial tcp 1.2.3.4:443: connect: no route to host", "network"],
      [
        "x509: certificate is valid for vcsa.local, not vcsa.example.com",
        "tls_name",
      ],
      ["NoPermission", "permission"],
      ["TaskInProgress", "state"],
      ["govc: host 'esx-9' not found", "not_found"],
      ["govc: bye", null],
    ];

    for (const [stderr, kind] of cases) {
      assert.strictEqual(classifyGovcFailure(stderr), kind, stderr);
    }
  });

  test("describeGovcFailure: every kind has advice", () => {
    const kinds: Array<GovcFailureKind> = [
      "login",
      "tls_name",
      "tls_expired",
      "tls_untrusted",
      "dns",
      "refused",
      "network",
      "permission",
      "datacenter",
      "ambiguous",
      "tools",
      "state",
      "not_found",
    ];

    for (const kind of kinds) {
      const advice: string = describeGovcFailure({
        kind,
        settings: settingsFor(),
        tier: null,
      });

      assert.ok(advice.length > 20, kind);
      assert.ok(advice.length <= 256, `${kind}: ${advice.length} characters`);
      assert.doesNotMatch(advice, /Read-0nly/);
    }
  });
});

describe("run: time limits", () => {
  test("a govc that never answers is killed, and the message says vCenter is probably unreachable", async () => {
    govc.setScript({ "*": { sleepMs: 10_000 } });

    const result: ExecResult = await runCommand(
      executor(),
      request(["govc", "about"], { timeoutInMs: 300 }),
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(
      result.errorMessage,
      "Killed (timeout 300ms): govc produced no output at all, so vCenter at https://vcsa.example.com/sdk is probably unreachable from this agent (check VCENTER_ENDPOINT and the network between them on TCP 443).",
    );
  });

  test("a fix that is killed may still complete in vCenter: check before retrying", async () => {
    govc.setScript({
      "*": {
        stdout: "Powering on VirtualMachine:vm-42...",
        sleepMs: 10_000,
        announcePrinted: true,
      },
    });

    // The budget runs out once govc has printed, however slow its start.
    const result: ExecResult = await killAfterOutput({
      timeoutInMs: 300,
      run: (): Promise<ExecResult> => {
        return runCommand(
          executor({ config: WRITES_ON }),
          remediation(["govc", "vm.power", "-on", "web-01"], {
            timeoutInMs: 300,
          }),
        );
      },
      printed: (signal: AbortSignal): Promise<void> => {
        return govc.waitUntilPrinted(signal);
      },
    });

    assert.strictEqual(result.success, false);
    assert.match(result.output, /Powering on VirtualMachine:vm-42\.\.\./);
    assert.strictEqual(
      result.errorMessage,
      "Killed (timeout 300ms). The change may already have reached vCenter, which carries it out as a task that can still complete: check govc tasks and the object's state before running it again.",
    );
  });
});

/*
 * A fake child process, for failures a real program cannot produce on
 * demand: a synchronous throw from spawn, an error event.
 */
class FakeChild extends EventEmitter {
  public stdout: PassThrough = new PassThrough();
  public stderr: PassThrough = new PassThrough();
  public pid: number | undefined = undefined;

  public kill(signal: string): boolean {
    setImmediate((): void => {
      this.emit("close", null, signal);
    });
    return true;
  }
}

describe("run never throws", () => {
  test("govc missing from the container: use the agent image", async () => {
    const result: ExecResult = await runCommand(
      executor({
        spawnImpl: govc.spawnImpl(path.join(tmpDir, "no-such-govc")),
      }),
      request(["govc", "about"]),
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage:
        "govc is not installed in this container (/usr/bin/govc was not found). Use the oneuptime/resource-ai-agent image, which includes it.",
    });
  });

  test("a spawn that throws is reported, not thrown", async () => {
    const spawnImpl: SpawnFunction = ((): never => {
      throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    }) as unknown as SpawnFunction;

    const result: ExecResult = await runCommand(
      executor({ spawnImpl }),
      request(["govc", "about"]),
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage: "Could not start govc: spawn EACCES",
    });
  });

  test("no private directory could be made: reported, nothing started", async () => {
    const notADirectory: string = path.join(tmpDir, "a-file");
    fs.writeFileSync(notADirectory, "x");

    const result: ExecResult = await runCommand(
      executor({ tmpDir: notADirectory }),
      request(["govc", "about"]),
    );

    assert.strictEqual(result.success, false);
    assert.match(
      String(result.errorMessage),
      /^Could not prepare a private directory for govc: /,
    );
    assert.strictEqual(govc.requestedBinaries.length, 0);
  });

  test("anything unexpected inside run becomes a failed result", async () => {
    const exec: GovcExecutor = executor();
    const prepared: PreparedCommand = expectPrepared(
      exec.prepare(request(["govc", "about"])),
    );
    (exec as unknown as { sandbox: { capture: () => never } }).sandbox.capture =
      (): never => {
        throw new Error("boom");
      };

    assert.deepStrictEqual(await prepared.run(), {
      success: false,
      output: "",
      errorMessage: "govc could not be run: boom",
    });
  });
});

describe("posture: govc about -json", () => {
  test("a reachable vCenter: its product and build, how the agent connects, and what it protects", async () => {
    govc.setScript({ "about -json": { stdout: ABOUT_JSON_CAMEL } });

    const probe: ResourcePostureProbe = await executor().probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: "VMware vCenter Server 8.0.2 build-22385739",
      reachable: true,
      reachError: null,
      details: {
        vcenterHost: "vcsa.example.com",
        credentialSource: "VCENTER_USERNAME",
        tlsVerification: "system-ca",
        datacenter: null,
        vcenterProduct: "VMware vCenter Server",
        vcenterVersion: "8.0.2",
        vcenterBuild: "22385739",
        vcenterApiType: "VirtualCenter",
        vcenterApiVersion: "8.0.2.0",
      },
      protectedTargets: ["vcsa.example.com", "vcsa"],
    });

    // The probe is govc about -json, started like any command.
    const invocation: FakeGovcInvocation = onlyInvocation();
    assert.deepStrictEqual(invocation.argv, ["about", "-json"]);
    assert.strictEqual(
      invocation.env["GOVC_URL"],
      "https://vcsa.example.com/sdk",
    );
    assert.strictEqual(invocation.env["GOVC_PERSIST_SESSION"], "false");
    assert.deepStrictEqual(govc.requestedBinaries, [GOVC_BINARY]);
    // No credential in what the agent reports.
    assert.doesNotMatch(JSON.stringify(probe), /Read-0nly|monitor@vsphere/);
  });

  test("an older govc's PascalCase output, a standalone ESXi host", async () => {
    govc.setScript({ "about -json": { stdout: ABOUT_JSON_PASCAL } });

    const probe: ResourcePostureProbe = await executor({
      env: {
        VCENTER_INSECURE_SKIP_VERIFY: "true",
        GOVC_DATACENTER: "ha-datacenter",
        [AI_VCENTER_USERNAME_ENV]: AI_USER,
        [AI_VCENTER_PASSWORD_ENV]: AI_PASSWORD,
      },
    }).probePosture();

    assert.strictEqual(probe.toolVersion, "VMware ESXi 7.0.3 build-21930508");
    assert.strictEqual(probe.reachable, true);
    assert.strictEqual(probe.details!["vcenterApiType"], "HostAgent");
    assert.strictEqual(probe.details!["tlsVerification"], "skipped");
    assert.strictEqual(probe.details!["datacenter"], "ha-datacenter");
    assert.strictEqual(
      probe.details!["credentialSource"],
      "ONEUPTIME_AI_VCENTER_USERNAME",
    );
  });

  test("a custom CA is reported as such", async () => {
    const caFile: string = path.join(tmpDir, "probe-ca.pem");
    fs.writeFileSync(caFile, "-----BEGIN CERTIFICATE-----\n");
    govc.setScript({ "about -json": { stdout: ABOUT_JSON_CAMEL } });

    const probe: ResourcePostureProbe = await executor({
      env: { VCENTER_CA_FILE: caFile },
    }).probePosture();

    assert.strictEqual(probe.details!["tlsVerification"], "custom-ca");
  });

  test("output that is not the expected JSON: reachable (govc logged in), version unknown", async () => {
    govc.setScript({
      "about -json": { stdout: "Name: VMware vCenter Server\n" },
    });

    const probe: ResourcePostureProbe = await executor().probePosture();

    assert.strictEqual(probe.reachable, true);
    assert.strictEqual(probe.toolVersion, null);
    assert.strictEqual(probe.details!["vcenterVersion"], undefined);
  });

  const unreachable: Array<[string, string, RegExp]> = [
    [
      "a rejected login",
      "govc: ServerFaultCode: Cannot complete login due to an incorrect user name or password.\n",
      /^vCenter rejected the agent's login: check VCENTER_USERNAME .* and VCENTER_PASSWORD/,
    ],
    [
      "an untrusted certificate",
      "govc: x509: certificate signed by unknown authority\n",
      /^The agent does not trust vCenter's TLS certificate/,
    ],
    [
      "an unknown host",
      "govc: dial tcp: lookup vcsa.example.com: no such host\n",
      /^The agent cannot resolve vcsa\.example\.com/,
    ],
    [
      "something else, with a secret in it",
      "govc: unexpected answer token=abcdef0123456789abcdef\n",
      /^govc about failed \(exit code 1\): govc: unexpected answer token=\[redacted\]$/,
    ],
  ];

  for (const [name, stderr, reachError] of unreachable) {
    test(`unreachable: ${name}`, async () => {
      govc.setScript({ "about -json": { stderr, exitCode: 1 } });

      const probe: ResourcePostureProbe = await executor().probePosture();

      assert.strictEqual(probe.reachable, false);
      assert.strictEqual(probe.toolVersion, null);
      assert.match(String(probe.reachError), reachError);
      assert.ok(String(probe.reachError).length <= 256);
      assert.deepStrictEqual(probe.protectedTargets, [
        "vcsa.example.com",
        "vcsa",
      ]);
    });
  }

  test("unreachable: govc never answers within the probe's time", async () => {
    govc.setScript({ "about -json": { sleepMs: 10_000 } });
    const exec: GovcExecutor = executor();
    exec.probeTimeoutMs = 300;

    const probe: ResourcePostureProbe = await exec.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(
      probe.reachError,
      "vCenter did not answer within 300ms: check VCENTER_ENDPOINT (https://vcsa.example.com/sdk) and the network to it (TCP 443).",
    );
  });

  test("the probe's own budget sits inside the agent's posture timeout", () => {
    assert.ok(GOVC_PROBE_TIMEOUT_MS < 15_000);
    assert.strictEqual(executor().probeTimeoutMs, GOVC_PROBE_TIMEOUT_MS);
  });

  test("misconfigured: says what to set, and starts nothing", async () => {
    const probe: ResourcePostureProbe = await executor({
      env: { VCENTER_ENDPOINT: undefined },
    }).probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(String(probe.reachError), /^VCENTER_ENDPOINT is not set\./);
    assert.deepStrictEqual(probe.protectedTargets, []);
    assert.strictEqual(govc.requestedBinaries.length, 0);
  });

  test("govc missing, or a spawn that throws: unreachable, never a rejection", async () => {
    const missing: ResourcePostureProbe = await executor({
      spawnImpl: govc.spawnImpl(path.join(tmpDir, "no-such-govc")),
    }).probePosture();

    assert.strictEqual(missing.reachable, false);
    assert.match(
      String(missing.reachError),
      /^govc is not installed in this container \(\/usr\/bin\/govc was not found\)/,
    );

    const throwing: ResourcePostureProbe = await executor({
      spawnImpl: ((): never => {
        throw new Error("spawn EMFILE");
      }) as unknown as SpawnFunction,
    }).probePosture();

    assert.strictEqual(throwing.reachable, false);
    assert.strictEqual(
      throwing.reachError,
      "Could not start govc: spawn EMFILE",
    );
  });

  test("an error event from the child: unreachable with its reason", async () => {
    const spawnImpl: SpawnFunction = ((): FakeChild => {
      const child: FakeChild = new FakeChild();
      setImmediate((): void => {
        child.emit(
          "error",
          Object.assign(new Error("spawn /usr/bin/govc EACCES"), {
            code: "EACCES",
          }),
        );
      });
      return child;
    }) as unknown as SpawnFunction;

    const probe: ResourcePostureProbe = await executor({
      spawnImpl,
    }).probePosture();

    assert.strictEqual(
      probe.reachError,
      "Could not start govc: spawn /usr/bin/govc EACCES",
    );
  });

  test("anything unexpected is an unreachable vCenter with the reason", async () => {
    const exec: GovcExecutor = executor();
    (exec as unknown as { sandbox: { capture: () => never } }).sandbox.capture =
      (): never => {
        throw new Error("boom");
      };

    const probe: ResourcePostureProbe = await exec.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(probe.reachError, "Checking vCenter failed: boom");
  });
});

describe("parsing govc about -json", () => {
  test("current (lowerCamelCase) and older (PascalCase) govc", () => {
    assert.deepStrictEqual(parseGovcAbout(ABOUT_JSON_CAMEL), {
      fullName: "VMware vCenter Server 8.0.2 build-22385739",
      name: "VMware vCenter Server",
      version: "8.0.2",
      build: "22385739",
      apiType: "VirtualCenter",
      apiVersion: "8.0.2.0",
    });
    assert.strictEqual(parseGovcAbout(ABOUT_JSON_PASCAL)!.apiType, "HostAgent");
  });

  test("an unwrapped about object, and anything else", () => {
    assert.strictEqual(
      parseGovcAbout(JSON.stringify({ Version: "8.0.3", Build: "1" }))!.version,
      "8.0.3",
    );
    assert.strictEqual(parseGovcAbout("not json"), null);
    assert.strictEqual(parseGovcAbout("[]"), null);
    assert.strictEqual(parseGovcAbout("{}"), null);
    assert.strictEqual(parseGovcAbout('{"about": {"version": 8}}'), null);
  });

  test("the reported version: the full name, else name + version + build", () => {
    const base: GovcAbout = {
      fullName: null,
      name: "VMware vCenter Server",
      version: "8.0.2",
      build: "22385739",
      apiType: null,
      apiVersion: null,
    };

    assert.strictEqual(
      describeGovcAboutVersion(base),
      "VMware vCenter Server 8.0.2 build-22385739",
    );
    assert.strictEqual(
      describeGovcAboutVersion({ ...base, name: null, build: null }),
      "8.0.2",
    );
    assert.strictEqual(
      describeGovcAboutVersion({
        ...base,
        name: null,
        version: null,
        build: null,
      }),
      null,
    );
  });

  test("long fields are bounded", () => {
    const about: GovcAbout | null = parseGovcAbout(
      JSON.stringify({ about: { fullName: "x".repeat(1_000) } }),
    );

    assert.strictEqual(about!.fullName!.length, 128);
  });
});

describe("job directories", () => {
  test("the start-up sweep removes what a previous run left behind, and logs it once", async () => {
    const sweepDir: string = makeTempDir("agent-govc-sweep-");
    const logger: ReturnType<typeof recordingLogger> = recordingLogger();
    const exec: GovcExecutor = executor({ tmpDir: sweepDir, logger });
    const leftover: string = path.join(
      sweepDir,
      JOB_DIR_PARENT_NAME,
      "job-old",
    );
    fs.mkdirSync(path.join(leftover, "home"), { recursive: true });

    await exec.sweepOrphanedJobDirs();
    await exec.sweepOrphanedJobDirs();

    assert.strictEqual(fs.existsSync(leftover), false);
    assert.deepStrictEqual(logger.records, [
      {
        level: "info",
        message: "Removed job directories a previous run left behind",
      },
    ]);

    await exec.removeAllJobDirs();
    fs.rmSync(sweepDir, { recursive: true, force: true });
  });
});

describe("the factory", () => {
  test("a vmware agent gets the govc executor, not a placeholder", () => {
    const exec: ResourceExecutor = createExecutor({
      config: vmwareConfig(),
      env: agentEnv(),
      tmpDir,
      logger: recordingLogger(),
    });

    assert.ok(exec instanceof GovcExecutor);
  });

  test("an empty environment builds an executor that refuses with the reason", async () => {
    const exec: ResourceExecutor = createExecutor({
      config: vmwareConfig(),
      env: {},
      tmpDir,
      logger: recordingLogger(),
    });

    expectRefused(
      exec.prepare(request(["govc", "about"])),
      /VCENTER_ENDPOINT is not set/,
    );
    assert.strictEqual((await exec.probePosture()).reachable, false);
  });
});
