import { recordingLogger, testConfig } from "./Helpers/TestSupport";
import assert from "assert";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import { after, afterEach, before, describe, test } from "node:test";
import { AgentConfig } from "../Config";
import { createExecutor } from "../Executors/ExecutorFactory";
import CephExecutor, {
  CEPH_BINARY,
  CEPH_HEALTH_PROBE_ARGS,
  CEPH_PROBE_CONNECT_TIMEOUT_SECONDS,
  CEPH_PROBE_TIMEOUT_MS,
  CEPH_READ_CAPS,
  CEPH_VERSIONS_PROBE_ARGS,
  CephFailureKind,
  CephSettings,
  DEFAULT_CEPH_CLIENT_ID,
  DEFAULT_CEPH_CONF,
  MAX_CEPH_CONNECT_TIMEOUT_SECONDS,
  buildCephArgv,
  buildCephEnvironment,
  classifyCephFailure,
  describeCephFailure,
  describeCephPathProblem,
  describeCephVersionKey,
  describeCephVersions,
  dropKeyringSearchNoise,
  findForbiddenCephOption,
  getCephConnectTimeoutSeconds,
  getCephFileProblem,
  getCephSilenceHint,
  getDefaultCephKeyring,
  parseCephHealth,
  parseCephVersions,
  resolveCephSettings,
} from "../Executors/CephExecutor";
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
import FakeCeph, {
  FakeCephInvocation,
  HEALTH_OK_JSON,
  HEALTH_WARN_JSON,
  MIXED_VERSIONS_JSON,
  STDERR_ACCESS_DENIED,
  STDERR_AUTH_REJECTED,
  STDERR_CONF_INVALID,
  STDERR_CONF_MISSING,
  STDERR_DEFAULT_KEYRING_SEARCH,
  STDERR_KEYRING_INVALID,
  STDERR_KEYRING_MISSING,
  STDERR_KEYRING_UNREADABLE,
  STDERR_MGR_ACCESS_DENIED,
  STDERR_MON_UNREACHABLE,
  STDERR_MON_UNRESOLVABLE,
  STDERR_NO_MONITORS,
  STDERR_NO_ORCHESTRATOR,
  STDERR_OSD_NOT_FOUND,
  STDERR_PG_NO_PRIMARY,
  STDERR_UNKNOWN_COMMAND,
  STATUS_PLAIN,
  VERSIONS_JSON,
} from "./Helpers/FakeCeph";
import { makeTempDir } from "./Helpers/FakeBinary";
import { killAfterOutput } from "./Helpers/KillAfterOutput";
import { fakePolicy } from "./Helpers/FakeExecutor";
import { TEST_RESOURCE_ID } from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_POSTURE_STRING_LENGTH,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * CephExecutor against a FAKE ceph (Helpers/FakeCeph): a script started in
 * place of /usr/bin/ceph that answers each ceph command as scripted and
 * records its argv, its complete environment and its directories. The
 * scripted answers are what ceph 19.2.3 printed against a real cluster.
 * Commands are tiered by the REAL policy (the agent's copy of
 * CephCommandPolicy) unless a case needs a command it would never allow.
 */

const URL: string = "https://oneuptime.example.com";
const CLUSTER_NAME: string = "ceph-prod";
const KEY: string = "AQAwjrtqK5MvFxAA37KrFISvJt/1Kqk3QP9GSA==";

// One fake for the whole file (a const, so tests built in loops may use it).
const ceph: FakeCeph = new FakeCeph();
let tmpDir: string;
let confPath: string;
let keyringPath: string;

before((): void => {
  tmpDir = makeTempDir("agent-ceph-");
  confPath = path.join(tmpDir, "ceph.conf");
  keyringPath = path.join(tmpDir, "ceph.client.oneuptime-ai.keyring");
  fs.writeFileSync(
    confPath,
    "[global]\n\tfsid = e8fbdea0-d86b-4173-b675-a3eb7337179d\n\tmon_host = [v2:10.0.0.11:3300/0,v1:10.0.0.11:6789/0]\n",
    { mode: 0o644 },
  );
  fs.writeFileSync(keyringPath, `[client.oneuptime-ai]\n\tkey = ${KEY}\n`, {
    mode: 0o600,
  });
});

after((): void => {
  ceph.cleanup();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach((): void => {
  ceph.reset();
});

// The agent's environment, plus things ceph must never get.
function agentEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: "/opt/agent/bin:/usr/bin:/bin",
    HOME: "/home/node",
    ONEUPTIME_URL: URL,
    ONEUPTIME_TELEMETRY_INGESTION_KEY: "ingestion-key-must-not-leak",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "ceph",
    CEPH_CLUSTER_NAME: CLUSTER_NAME,
    CEPH_MGR_ENDPOINTS: "[mgr1:9283,mgr2:9283]",
    CEPH_CONF: confPath,
    CEPH_KEYRING: keyringPath,
    HTTPS_PROXY: "http://proxy.example.com:3128",
    // ceph prepends CEPH_ARGS to every command line: it must never reach it.
    CEPH_ARGS: "--id admin --keyring /etc/ceph/ceph.client.admin.keyring",
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

function cephConfig(overrides: Record<string, string> = {}): AgentConfig {
  return testConfig(URL, {
    DOCKER_HOST_NAME: "",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "ceph",
    CEPH_CLUSTER_NAME: CLUSTER_NAME,
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

function executor(setup: ExecutorSetup = {}): CephExecutor {
  return new CephExecutor({
    config: cephConfig(setup.config || {}),
    env: agentEnv(setup.env || {}),
    tmpDir: setup.tmpDir || tmpDir,
    logger: setup.logger || recordingLogger(),
    spawnImpl: setup.spawnImpl || ceph.spawnImpl(),
    guardPolicy: setup.guardPolicy,
  });
}

// A payload the server would send for this ceph argv (tiered by the real policy).
function payload(
  argv: Array<string>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const result: ResourceCommandPolicyResult =
    ResourceCommandPolicy.evaluateArgv({
      resourceType: AiResourceType.CephCluster,
      argv,
    });

  return {
    resourceType: "CephCluster",
    resourceId: TEST_RESOURCE_ID,
    resourceIdentifier: CLUSTER_NAME,
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
  assert.match(refusal, /^Refused by the Ceph AI agent: /);
  assert.match(refusal, pattern);
  return refusal;
}

function expectPrepared(prepared: PrepareResult): PreparedCommand {
  assert.strictEqual(prepared.refusal, null, String(prepared.refusal));
  return prepared as PreparedCommand;
}

async function runCommand(
  exec: CephExecutor,
  req: ResourceCommandRequest,
): Promise<ExecResult> {
  return expectPrepared(exec.prepare(req)).run();
}

function onlyInvocation(): FakeCephInvocation {
  const invocations: Array<FakeCephInvocation> = ceph.getInvocations();
  assert.strictEqual(invocations.length, 1, "ceph ran exactly once");
  return invocations[0]!;
}

// The connection options the agent writes in front of every command.
function connection(
  connectTimeoutSeconds: number,
  keyring: string = keyringPath,
  clientId: string = DEFAULT_CEPH_CLIENT_ID,
): Array<string> {
  return [
    "--conf",
    confPath,
    "--keyring",
    keyring,
    "--id",
    clientId,
    "--connect-timeout",
    String(connectTimeoutSeconds),
  ];
}

// The posture details every probe reports, reachable or not.
function connectionDetails(): Record<string, string> {
  return { clientId: "oneuptime-ai", confPath, keyringPath };
}

function settingsFor(
  overrides: Record<string, string | undefined> = {},
): CephSettings {
  return resolveCephSettings(agentEnv(overrides));
}

// The settings with the compose file's defaults (no variable set).
function defaultSettings(): CephSettings {
  return resolveCephSettings({});
}

// Whether this process can read any file whatever its mode (root can).
function readsEverything(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

describe("the settings ceph runs with", () => {
  test("the compose file's defaults: /etc/ceph/ceph.conf and client.oneuptime-ai's keyring", () => {
    const settings: CephSettings = defaultSettings();

    assert.deepStrictEqual(settings, {
      confPath: DEFAULT_CEPH_CONF,
      keyringPath: "/etc/ceph/ceph.client.oneuptime-ai.keyring",
      clientId: DEFAULT_CEPH_CLIENT_ID,
      confVariable: null,
      keyringVariable: null,
      problems: [],
      warnings: [],
    });
    assert.strictEqual(DEFAULT_CEPH_CONF, "/etc/ceph/ceph.conf");
    assert.strictEqual(DEFAULT_CEPH_CLIENT_ID, "oneuptime-ai");
  });

  test("another client: the default keyring follows its name", () => {
    const settings: CephSettings = resolveCephSettings({
      CEPH_CLIENT_ID: "  ai-fixes  ",
    });

    assert.strictEqual(settings.clientId, "ai-fixes");
    assert.strictEqual(
      settings.keyringPath,
      "/etc/ceph/ceph.client.ai-fixes.keyring",
    );
    assert.strictEqual(
      getDefaultCephKeyring("ai-fixes"),
      "/etc/ceph/ceph.client.ai-fixes.keyring",
    );
  });

  test("CEPH_CONF and CEPH_KEYRING win when set, and are named in messages", () => {
    const settings: CephSettings = settingsFor();

    assert.strictEqual(settings.confPath, confPath);
    assert.strictEqual(settings.keyringPath, keyringPath);
    assert.strictEqual(settings.confVariable, "CEPH_CONF");
    assert.strictEqual(settings.keyringVariable, "CEPH_KEYRING");
    assert.deepStrictEqual(settings.problems, []);
  });

  test('a "client." prefix is dropped (ceph --id adds it), with a warning the executor logs once', () => {
    const settings: CephSettings = settingsFor({
      CEPH_CLIENT_ID: "client.oneuptime-ai",
    });

    assert.strictEqual(settings.clientId, "oneuptime-ai");
    assert.deepStrictEqual(settings.problems, []);
    assert.deepStrictEqual(settings.warnings, [
      'CEPH_CLIENT_ID="client.oneuptime-ai" starts with "client.", which ceph --id adds itself; the agent uses "oneuptime-ai". Set CEPH_CLIENT_ID=oneuptime-ai.',
    ]);

    const logger: ReturnType<typeof recordingLogger> = recordingLogger();
    executor({ logger, env: { CEPH_CLIENT_ID: "client.oneuptime-ai" } });

    assert.deepStrictEqual(logger.records, [
      { level: "warn", message: settings.warnings[0]! },
    ]);
  });

  test("a client name ceph would misread is a problem, never passed on", () => {
    for (const value of [
      "-admin",
      "admin oneuptime",
      "ai=x",
      "client.",
      "a/b",
      `x${"y".repeat(128)}`,
    ]) {
      const settings: CephSettings = settingsFor({ CEPH_CLIENT_ID: value });

      assert.strictEqual(settings.problems.length, 1, value);
      assert.match(
        settings.problems[0]!,
        /^CEPH_CLIENT_ID=".*" is not a Ceph client name\. Set it to the name of the client you created for the agent, without "client\."/,
      );
    }
  });

  test("a path must be one plain absolute file: ceph reads commas as a list and expands $ variables", () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [
        { CEPH_CONF: "ceph.conf" },
        /^CEPH_CONF="ceph\.conf" is not an absolute path\./,
      ],
      [
        { CEPH_KEYRING: "./keyring" },
        /^CEPH_KEYRING="\.\/keyring" is not an absolute path\./,
      ],
      [
        {
          CEPH_KEYRING:
            "/etc/ceph/a.keyring,/etc/ceph/ceph.client.admin.keyring",
        },
        /^CEPH_KEYRING=".*" must name one file by a plain path \(no commas, no \$ variables/,
      ],
      [
        { CEPH_CONF: "/etc/ceph/$cluster.conf" },
        /^CEPH_CONF=".*" must name one file by a plain path/,
      ],
      [
        { CEPH_CONF: "/etc/ceph/ceph\u0001.conf" },
        /must name one file by a plain path/,
      ],
    ];

    for (const [env, pattern] of cases) {
      const settings: CephSettings = settingsFor(env);
      assert.strictEqual(settings.problems.length, 1, JSON.stringify(env));
      assert.match(settings.problems[0]!, pattern);
    }

    assert.strictEqual(
      describeCephPathProblem({ value: "/etc/ceph/ceph.conf", variable: "X" }),
      null,
    );
  });

  test("blank variables fall back to the defaults", () => {
    const settings: CephSettings = resolveCephSettings({
      CEPH_CONF: "  ",
      CEPH_KEYRING: "",
      CEPH_CLIENT_ID: " ",
    });

    assert.strictEqual(settings.confPath, DEFAULT_CEPH_CONF);
    assert.strictEqual(settings.clientId, DEFAULT_CEPH_CLIENT_ID);
    assert.strictEqual(settings.confVariable, null);
    assert.strictEqual(settings.keyringVariable, null);
  });
});

describe("ceph.conf and the keyring on disk", () => {
  test("readable files are fine", () => {
    const settings: CephSettings = settingsFor();

    assert.strictEqual(getCephFileProblem({ settings, file: "conf" }), null);
    assert.strictEqual(getCephFileProblem({ settings, file: "keyring" }), null);
  });

  test("missing with the defaults: what to put in the ceph/ folder, within the posture's bound", () => {
    const settings: CephSettings = {
      ...defaultSettings(),
      confPath: path.join(tmpDir, "no-such", "ceph.conf"),
      keyringPath: path.join(
        tmpDir,
        "no-such",
        "ceph.client.oneuptime-ai.keyring",
      ),
    };
    const conf: string = String(getCephFileProblem({ settings, file: "conf" }));
    const keyring: string = String(
      getCephFileProblem({ settings, file: "keyring" }),
    );

    assert.match(
      conf,
      /^The ceph\.conf at .*ceph\.conf is not in the agent's container\. Put the cluster's ceph\.conf \(ceph config generate-minimal-conf\) in the ceph\/ folder next to docker-compose\.yml\.$/,
    );
    assert.match(
      keyring,
      /^The keyring .*ceph\.client\.oneuptime-ai\.keyring is not in the agent's container\. Create it \(ceph auth get-or-create client\.oneuptime-ai mon 'allow r' mgr 'allow r' osd 'allow r'\) and put it in the ceph\/ folder next to docker-compose\.yml\.$/,
    );

    // With the real default paths, the messages fit a posture's reachError.
    const real: CephSettings = defaultSettings();
    for (const message of [
      conf.replace(settings.confPath, real.confPath),
      keyring.replace(settings.keyringPath, real.keyringPath),
    ]) {
      assert.ok(
        message.length <= MAX_POSTURE_STRING_LENGTH,
        `${message.length}: ${message}`,
      );
    }
  });

  test("missing where a variable points: says to put it there", () => {
    const settings: CephSettings = settingsFor({
      CEPH_CONF: path.join(tmpDir, "nope.conf"),
      CEPH_KEYRING: path.join(tmpDir, "nope.keyring"),
    });

    assert.match(
      String(getCephFileProblem({ settings, file: "conf" })),
      /is not in the agent's container\. .* where CEPH_CONF points\.$/,
    );
    assert.match(
      String(getCephFileProblem({ settings, file: "keyring" })),
      /is not in the agent's container\. .* and put it where CEPH_KEYRING points\.$/,
    );
  });

  test("a directory where the file should be (Docker's empty mount of a missing file)", () => {
    const dir: string = path.join(tmpDir, "a-directory.keyring");
    fs.mkdirSync(dir, { recursive: true });

    assert.match(
      String(
        getCephFileProblem({
          settings: settingsFor({ CEPH_KEYRING: dir }),
          file: "keyring",
        }),
      ),
      /^The keyring .*a-directory\.keyring is not a file \(Docker mounts an empty directory when the file is missing on the host\)\. Put the keyring there and restart the agent\.$/,
    );
  });

  test("unreadable by the agent: which mode to give it (a keyring is a secret, ceph.conf is not)", (t: {
    skip: (reason: string) => void;
  }) => {
    if (readsEverything()) {
      t.skip("root reads every file");
      return;
    }

    const conf: string = path.join(tmpDir, "unreadable.conf");
    const keyring: string = path.join(tmpDir, "unreadable.keyring");
    fs.writeFileSync(conf, "[global]\n", { mode: 0o000 });
    fs.writeFileSync(keyring, "[client.x]\n", { mode: 0o000 });

    const settings: CephSettings = settingsFor({
      CEPH_CONF: conf,
      CEPH_KEYRING: keyring,
    });

    assert.match(
      String(getCephFileProblem({ settings, file: "conf" })),
      /is not readable by the agent \(UID 1000\)\. It holds no secret: chmod 644 it\.$/,
    );
    assert.match(
      String(getCephFileProblem({ settings, file: "keyring" })),
      /is not readable by the agent \(UID 1000\)\. On the host: chown 1000:1000 and chmod 600 the keyring file\.$/,
    );
  });

  test("in a directory the agent cannot enter", (t: {
    skip: (reason: string) => void;
  }) => {
    if (readsEverything()) {
      t.skip("root enters every directory");
      return;
    }

    const closed: string = path.join(tmpDir, "closed");
    fs.mkdirSync(closed, { recursive: true });
    fs.writeFileSync(path.join(closed, "ceph.conf"), "[global]\n");
    fs.chmodSync(closed, 0o000);

    try {
      assert.match(
        String(
          getCephFileProblem({
            settings: settingsFor({
              CEPH_CONF: path.join(closed, "ceph.conf"),
            }),
            file: "conf",
          }),
        ),
        /is in a directory the agent \(UID 1000\) cannot enter: make the mounted directory readable \(chmod 755\)\.$/,
      );
    } finally {
      fs.chmodSync(closed, 0o700);
    }
  });
});

describe("ceph's argv and environment", () => {
  test("the connection options first, in this order, then the payload's words exactly", () => {
    assert.deepStrictEqual(
      buildCephArgv({
        settings: settingsFor(),
        connectTimeoutSeconds: 10,
        args: ["osd", "tree", "--format", "json"],
      }),
      [
        "--conf",
        confPath,
        "--keyring",
        keyringPath,
        "--id",
        "oneuptime-ai",
        "--connect-timeout",
        "10",
        "osd",
        "tree",
        "--format",
        "json",
      ],
    );
  });

  test("-s passes through as-is, and no output format is added", () => {
    const argv: Array<string> = buildCephArgv({
      settings: defaultSettings(),
      connectTimeoutSeconds: 3,
      args: ["-s"],
    });

    assert.deepStrictEqual(argv.slice(8), ["-s"]);
    assert.ok(!argv.includes("--format"));
    assert.strictEqual(argv[7], "3");
  });

  test("the connect timeout is a whole number of seconds: half the budget, 1 to 10", () => {
    const cases: Array<[number, number]> = [
      [120_000, 10],
      [30_000, 10],
      [20_000, 10],
      [10_000, 5],
      [5_000, 2],
      [3_999, 1],
      [2_000, 1],
      [300, 1],
      [0, 1],
      [-5, 1],
      [Number.NaN, 1],
      [Number.POSITIVE_INFINITY, 1],
    ];

    for (const [timeoutInMs, seconds] of cases) {
      assert.strictEqual(
        getCephConnectTimeoutSeconds(timeoutInMs),
        seconds,
        String(timeoutInMs),
      );
    }

    assert.strictEqual(MAX_CEPH_CONNECT_TIMEOUT_SECONDS, 10);
    assert.deepStrictEqual(
      buildCephArgv({
        settings: defaultSettings(),
        connectTimeoutSeconds: 2.7,
        args: [],
      })[7],
      "2",
    );
  });

  test("the environment is PATH and the private HOME, nothing else", () => {
    assert.deepStrictEqual(buildCephEnvironment({ homeDir: "/tmp/job/home" }), {
      PATH: DEFAULT_SPAWN_PATH,
      HOME: "/tmp/job/home",
    });
  });
});

describe("options only the agent may pass", () => {
  test("the words the policy accepts pass", () => {
    for (const args of [
      ["health", "detail"],
      ["-s"],
      ["osd", "tree", "--format", "json"],
      ["osd", "tree", "--format=json-pretty"],
      ["df", "-f", "plain"],
      [
        "orch",
        "ps",
        "--daemon_type",
        "mgr",
        "--service-name",
        "mgr",
        "--refresh",
      ],
      ["orch", "ps", "--daemon-type", "osd", "--service_name", "osd.all"],
    ]) {
      assert.strictEqual(findForbiddenCephOption(args), null, args.join(" "));
    }
  });

  test("anything that picks the cluster, the client, a key, a file or a config override is caught", () => {
    const cases: Array<[Array<string>, string]> = [
      [["health", "--id", "admin"], "--id"],
      [["health", "--id=admin"], "--id=admin"],
      [
        ["--keyring", "/etc/ceph/ceph.client.admin.keyring", "health"],
        "--keyring",
      ],
      [["health", "--keyr", "/x"], "--keyr"],
      [["health", "-k", "/x"], "-k"],
      [["health", "-n", "client.admin"], "-n"],
      [["health", "--name=client.admin"], "--name=client.admin"],
      [["health", "--user", "admin"], "--user"],
      [["-c", "/tmp/evil.conf", "health"], "-c"],
      [["health", "--conf=/tmp/evil.conf"], "--conf=/tmp/evil.conf"],
      [["health", "--cluster", "backup"], "--cluster"],
      [["health", "-m", "10.9.9.9"], "-m"],
      [["health", "--mon-host=10.9.9.9"], "--mon-host=10.9.9.9"],
      [["health", "--mon_host", "10.9.9.9"], "--mon_host"],
      [["health", "--connect-timeout", "0"], "--connect-timeout"],
      [["health", "--admin-daemon", "/var/run/ceph/x.asok"], "--admin-daemon"],
      [["health", "--log-file=/tmp/x"], "--log-file=/tmp/x"],
      [["osd", "dump", "-o", "/tmp/x"], "-o"],
      [["health", "--format=xml"], "--format=xml"],
      [["health", "-fjson"], "-fjson"],
      [["health", "--"], "--"],
      [["health", "-"], "-"],
      [["-sw"], "-sw"],
    ];

    for (const [args, word] of cases) {
      assert.strictEqual(findForbiddenCephOption(args), word, args.join(" "));
    }
  });
});

describe("the keyring search noise", () => {
  test("lines about ceph's default keyring search are dropped when they do not name the agent's keyring", () => {
    const noise: string = STDERR_DEFAULT_KEYRING_SEARCH("oneuptime-ai-fix");
    const stderr: string = `${noise}Error EACCES: access denied\n`;

    assert.strictEqual(
      dropKeyringSearchNoise(stderr, "/srv/ceph/fix.keyring"),
      "Error EACCES: access denied\n",
    );
    assert.strictEqual(
      dropKeyringSearchNoise(noise, "/srv/ceph/fix.keyring"),
      "",
    );
  });

  test("lines naming the agent's own keyring are kept: they are the reason it failed", () => {
    const stderr: string = STDERR_KEYRING_MISSING("/srv/ceph/fix.keyring");

    assert.strictEqual(
      dropKeyringSearchNoise(stderr, "/srv/ceph/fix.keyring"),
      stderr,
    );

    const defaultSearch: string = STDERR_DEFAULT_KEYRING_SEARCH("oneuptime-ai");
    assert.strictEqual(
      dropKeyringSearchNoise(
        defaultSearch,
        "/etc/ceph/ceph.client.oneuptime-ai.keyring",
      ),
      defaultSearch,
    );
  });

  test("everything else is left exactly as it was", () => {
    for (const stderr of [
      "",
      "warning: slow\n",
      STDERR_AUTH_REJECTED,
      "auth: unable to find a keyring on the moon\n",
    ]) {
      assert.strictEqual(dropKeyringSearchNoise(stderr, keyringPath), stderr);
    }
  });
});

describe("classifying ceph's failures", () => {
  const KEYRING: string = "/etc/ceph/ceph.client.oneuptime-ai.keyring";
  const cases: Array<[string, string, CephFailureKind | null]> = [
    ["ceph.conf missing", STDERR_CONF_MISSING, "conf_unreadable"],
    ["ceph.conf garbage", STDERR_CONF_INVALID, "conf_invalid"],
    ["keyring missing", STDERR_KEYRING_MISSING(KEYRING), "keyring_missing"],
    [
      "keyring unreadable",
      STDERR_KEYRING_UNREADABLE(KEYRING),
      "keyring_unreadable",
    ],
    ["keyring malformed", STDERR_KEYRING_INVALID(KEYRING), "keyring_invalid"],
    ["no mon_host", STDERR_NO_MONITORS, "no_monitors"],
    ["mon_host unresolvable", STDERR_MON_UNRESOLVABLE, "mon_unresolvable"],
    ["a key the monitors reject", STDERR_AUTH_REJECTED, "auth_rejected"],
    ["monitors that never answer", STDERR_MON_UNREACHABLE, "mon_unreachable"],
    [
      "the library's own connect timeout",
      "[errno 110] RADOS timed out (error connecting to the cluster)\n",
      "mon_unreachable",
    ],
    [
      "a connection failure nobody names",
      "[errno 5] RADOS I/O error (error connecting to the cluster)\n",
      "connect_failed",
    ],
    ["a mon cap missing", STDERR_ACCESS_DENIED, "access_denied"],
    ["a mgr cap missing", STDERR_MGR_ACCESS_DENIED, "access_denied"],
    ["EPERM", "Error EPERM: not permitted\n", "access_denied"],
    ["no orchestrator", STDERR_NO_ORCHESTRATOR, "no_orchestrator"],
    [
      "orchestrator not available",
      "Error EOPNOTSUPP: orchestrator not available\n",
      "no_orchestrator",
    ],
    [
      "a mgr module off",
      "Error ENOENT: Module not found: 'balancer'\n",
      "mgr_module",
    ],
    [
      "a module not supporting it",
      "Error ENOTSUP: Module 'x' is not enabled\n",
      "mgr_module",
    ],
    ["an unknown OSD", STDERR_OSD_NOT_FOUND, "not_found"],
    ["a pg without its primary", STDERR_PG_NO_PRIMARY, "busy"],
    ["EBUSY", "Error EBUSY: in progress\n", "busy"],
    ["an unknown command", STDERR_UNKNOWN_COMMAND, "unknown_command"],
    [
      "bad arguments",
      "Error EINVAL: osd weight must be between 0 and 1\n",
      "invalid_argument",
    ],
    [
      "a mgr module without its commands",
      "no valid command found; 10 closest matches:\npg stat\n",
      "unknown_command",
    ],
    ["another errno", "Error EIO: something\n", null],
    [
      "something else",
      "Traceback (most recent call last):\nKeyError: 'x'\n",
      null,
    ],
    ["nothing", "", null],
    ["only whitespace", "  \n", null],
  ];

  for (const [name, stderr, kind] of cases) {
    test(`${name} -> ${kind}`, () => {
      assert.strictEqual(classifyCephFailure(stderr, KEYRING), kind);
    });
  }

  test("a keyring warning alone decides nothing: the LAST line does", () => {
    const stderr: string = `${STDERR_DEFAULT_KEYRING_SEARCH(
      "oneuptime-ai",
    )}Error EACCES: access denied\n`;

    assert.strictEqual(classifyCephFailure(stderr, KEYRING), "access_denied");
  });

  test("keyring messages about ANOTHER file do not blame the agent's keyring", () => {
    const stderr: string = `${STDERR_DEFAULT_KEYRING_SEARCH("ghost").replace(
      /\n$/,
      "",
    )}\n${STDERR_AUTH_REJECTED}`;

    assert.strictEqual(
      classifyCephFailure(stderr, "/srv/ceph/ai.keyring"),
      "auth_rejected",
    );
  });

  test("every kind has advice, naming what to change", () => {
    const settings: CephSettings = defaultSettings();
    const kinds: Array<CephFailureKind> = [
      "conf_unreadable",
      "conf_invalid",
      "keyring_missing",
      "keyring_unreadable",
      "keyring_invalid",
      "no_monitors",
      "mon_unresolvable",
      "auth_rejected",
      "mon_unreachable",
      "connect_failed",
      "access_denied",
      "no_orchestrator",
      "mgr_module",
      "not_found",
      "busy",
      "unknown_command",
      "invalid_argument",
    ];

    for (const kind of kinds) {
      const advice: string = describeCephFailure({
        kind,
        settings,
        tier: null,
      });

      assert.ok(advice.length > 20, kind);
      assert.match(advice, /[.]$/, kind);
    }

    // The connection failures a probe reports fit the posture's bound.
    for (const kind of kinds.slice(0, 11)) {
      const advice: string = describeCephFailure({
        kind,
        settings,
        tier: null,
      });
      assert.ok(
        advice.length <= MAX_POSTURE_STRING_LENGTH,
        `${kind}: ${advice}`,
      );
    }
  });

  test("missing caps: the read caps for a read, the fixes caps for a change", () => {
    const settings: CephSettings = defaultSettings();

    assert.strictEqual(
      describeCephFailure({
        kind: "access_denied",
        settings,
        tier: ResourceCommandTier.Read,
      }),
      `client.oneuptime-ai may not read this: give it the read caps with ceph auth caps client.oneuptime-ai ${CEPH_READ_CAPS}.`,
    );

    for (const tier of [
      ResourceCommandTier.SafeWrite,
      ResourceCommandTier.RiskyWrite,
    ]) {
      assert.match(
        describeCephFailure({ kind: "access_denied", settings, tier }),
        /^client\.oneuptime-ai's caps do not allow this change: give it the fixes caps from the Ceph agent's README/,
      );
    }
  });

  test("the silence hint names the monitors and the mgr", () => {
    assert.match(
      getCephSilenceHint(defaultSettings()),
      /monitors in \/etc\/ceph\/ceph\.conf \(mon_host\) .*\(TCP 3300 and 6789\).* waits for a mgr that is not running/,
    );
  });
});

describe("parsing ceph versions and ceph health", () => {
  test("a cluster on one release", () => {
    assert.deepStrictEqual(parseCephVersions(VERSIONS_JSON), [
      { label: "19.2.3 squid (stable)", count: 17 },
    ]);
    assert.strictEqual(
      describeCephVersions(parseCephVersions(VERSIONS_JSON)!),
      "ceph 19.2.3 squid (stable)",
    );
  });

  test("an upgrade under way: every release, most daemons first", () => {
    const versions: Array<{ label: string; count: number }> =
      parseCephVersions(MIXED_VERSIONS_JSON)!;

    assert.deepStrictEqual(versions, [
      { label: "18.2.4 reef (stable)", count: 8 },
      { label: "19.2.3 squid (stable)", count: 7 },
    ]);
    assert.strictEqual(
      describeCephVersions(versions),
      "ceph 18.2.4 reef (stable) (8 daemons), 19.2.3 squid (stable) (7 daemons)",
    );
    assert.strictEqual(
      describeCephVersions([
        { label: "19.2.3 squid (stable)", count: 1 },
        { label: "18.2.4 reef (stable)", count: 1 },
      ]),
      "ceph 19.2.3 squid (stable) (1 daemon), 18.2.4 reef (stable) (1 daemon)",
    );
  });

  test("no overall map: the daemon types added up", () => {
    assert.deepStrictEqual(
      parseCephVersions(
        JSON.stringify({
          mon: { "ceph version 17.2.7 (abcdef1234567) quincy (stable)": 3 },
          osd: { "ceph version 17.2.7 (abcdef1234567) quincy (stable)": 5 },
        }),
      ),
      [{ label: "17.2.7 quincy (stable)", count: 8 }],
    );
  });

  test("version keys ceph did not write the usual way are kept, bounded", () => {
    assert.strictEqual(
      describeCephVersionKey("ceph version 19.2.3 (c92aebb2) squid (stable)"),
      "19.2.3 squid (stable)",
    );
    assert.strictEqual(
      describeCephVersionKey("ceph version 19.2.3-dev"),
      "19.2.3-dev",
    );
    assert.strictEqual(describeCephVersionKey("  unknown  "), "unknown");
    assert.strictEqual(describeCephVersionKey("x".repeat(500)).length, 96);
  });

  test("anything else is not a version list", () => {
    for (const text of [
      "",
      "not json",
      "[]",
      "null",
      '{"overall":{}}',
      '{"overall":{"ceph version 19.2.3":"many"}}',
      '{"overall":{"ceph version 19.2.3":-1}}',
    ]) {
      assert.strictEqual(parseCephVersions(text), null, text);
    }

    assert.strictEqual(describeCephVersions([]), null);
  });

  test("health: the status and the raised checks' codes", () => {
    assert.deepStrictEqual(parseCephHealth(HEALTH_WARN_JSON), {
      status: "HEALTH_WARN",
      checks: ["OSD_DOWN", "PG_DEGRADED"],
    });
    assert.deepStrictEqual(parseCephHealth(HEALTH_OK_JSON), {
      status: "HEALTH_OK",
      checks: [],
    });
    assert.deepStrictEqual(
      parseCephHealth(
        '{"status":"HEALTH_ERR","checks":{"MON_DOWN":{},"bad code":{},"__proto__":{}}}',
      ),
      { status: "HEALTH_ERR", checks: ["MON_DOWN"] },
    );
  });

  test("health output that is not ceph's", () => {
    for (const text of [
      "",
      "HEALTH_OK",
      '{"status":"fine"}',
      '{"status":42}',
      "{}",
      "[1]",
    ]) {
      assert.strictEqual(parseCephHealth(text), null, text);
    }
  });
});

describe("prepare: the shared guard runs first", () => {
  test("a read from an investigation, every check passed: ready to run", () => {
    const prepared: PreparedCommand = expectPrepared(
      executor().prepare(request(["ceph", "health", "detail"])),
    );

    assert.strictEqual(prepared.displayCommand, "ceph health detail");
    assert.strictEqual(prepared.tier, ResourceCommandTier.Read);
    // prepare() itself never runs anything.
    assert.strictEqual(ceph.requestedBinaries.length, 0);
  });

  const refusals: Array<[string, ResourceCommandRequest, RegExp]> = [
    [
      "a command for another cluster",
      request(["ceph", "health"], {}, { resourceIdentifier: "ceph-backup" }),
      /this command is for Ceph cluster "ceph-backup", but this agent serves "ceph-prod"\. Check CEPH_CLUSTER_NAME/,
    ],
    [
      "a command for another kind of resource",
      request(["ceph", "health"], {}, { resourceType: "ProxmoxCluster" }),
      /this command is for a "ProxmoxCluster" resource, and this agent serves a Ceph cluster/,
    ],
    [
      "a command for another resource id",
      request(["ceph", "health"], {}, { resourceId: "someone-else" }),
      /this command is for resource id "someone-else"/,
    ],
    [
      "a program other than ceph",
      request(["ceph", "health"], {}, { program: "sh", args: ["-c", "id"] }),
      /"sh" is not a program the Ceph AI agent runs \(it runs ceph\)/,
    ],
    [
      "a job that is not from OneUptime AI",
      request(["ceph", "health"], { origin: "Runbook" }),
      /this job came from "Runbook"/,
    ],
    [
      "a job without a tier",
      request(["ceph", "health"], {}, { tier: undefined }),
      /the job does not say which tier/,
    ],
    [
      "cephx keys (auth)",
      request(["ceph", "auth", "ls"]),
      /"ceph auth ls" is not allowed: ceph auth prints and changes cephx keys/,
    ],
    [
      "another identity on the argv",
      request(["ceph", "health", "--id", "admin"]),
      /"--id" is not accepted: the agent connects with its own configuration, keyring and identity/,
    ],
    [
      "another keyring on the argv",
      request([
        "ceph",
        "--keyring",
        "/etc/ceph/ceph.client.admin.keyring",
        "health",
      ]),
      /"--keyring" is not accepted/,
    ],
    [
      "a daemon's admin socket",
      request(["ceph", "--admin-daemon", "/var/run/ceph/x.asok", "status"]),
      /"--admin-daemon" is not accepted/,
    ],
    [
      "a pool deletion",
      request(["ceph", "osd", "pool", "delete", "rbd"]),
      /Refused by the Ceph AI agent: /,
    ],
    [
      "a fix during an investigation",
      request(["ceph", "osd", "in", "3"]),
      /an investigation may only run read-only commands, and "ceph osd in 3" is SafeWrite/,
    ],
    [
      "a fix the server sent as a lower tier than it is",
      remediation(["ceph", "osd", "out", "3"], {}, { tier: "SafeWrite" }),
      /OneUptime sent "ceph osd out 3" as SafeWrite, but this agent's policy reads it as RiskyWrite/,
    ],
  ];

  for (const [name, req, pattern] of refusals) {
    test(`refused: ${name} — and nothing is started`, async () => {
      const exec: CephExecutor = executor({ config: WRITES_ON });
      expectRefused(exec.prepare(req), pattern);
      assert.strictEqual(ceph.requestedBinaries.length, 0);
    });
  }

  test("refused: a fix on a read-only agent, naming the switch to turn on", () => {
    const refusal: string = expectRefused(
      executor().prepare(remediation(["ceph", "osd", "in", "3"])),
      /"ceph osd in 3" changes the Ceph cluster, and this agent is read-only/,
    );

    assert.match(
      refusal,
      /\(ONEUPTIME_AI_ALLOW_WRITES is not set\)\. To let OneUptime AI apply fixes, set ONEUPTIME_AI_ALLOW_WRITES=true on the agent and restart it\.$/,
    );
  });

  test("refused: a fix outside ONEUPTIME_AI_WRITE_TARGETS", () => {
    expectRefused(
      executor({
        config: { ...WRITES_ON, ONEUPTIME_AI_WRITE_TARGETS: "osd.1,osd.2" },
      }).prepare(remediation(["ceph", "osd", "in", "3"])),
      /"ceph osd in 3" would change osd\.3, which is outside the targets the Ceph AI agent may change \(ONEUPTIME_AI_WRITE_TARGETS=osd\.1,osd\.2\)/,
    );
  });

  test("refused: a cluster-wide fix when ONEUPTIME_AI_WRITE_TARGETS lists only OSDs", () => {
    expectRefused(
      executor({
        config: { ...WRITES_ON, ONEUPTIME_AI_WRITE_TARGETS: "osd.*" },
      }).prepare(remediation(["ceph", "osd", "unset", "noout"])),
      /would change cluster, which is outside the targets/,
    );
  });

  test("allowed: a fix inside ONEUPTIME_AI_WRITE_TARGETS on a writable agent", () => {
    const prepared: PreparedCommand = expectPrepared(
      executor({
        config: { ...WRITES_ON, ONEUPTIME_AI_WRITE_TARGETS: "osd.*" },
      }).prepare(remediation(["ceph", "osd", "in", "osd.3"])),
    );

    assert.strictEqual(prepared.tier, ResourceCommandTier.SafeWrite);
    assert.strictEqual(prepared.displayCommand, "ceph osd in osd.3");
  });

  test("refused: a fix on an OSD in ONEUPTIME_AI_PROTECTED_TARGETS, however the command names it", () => {
    for (const osd of ["3", "osd.3"]) {
      expectRefused(
        executor({
          config: { ...WRITES_ON, ONEUPTIME_AI_PROTECTED_TARGETS: "osd.3" },
        }).prepare(remediation(["ceph", "osd", "out", osd])),
        /would change osd\.3, which the Ceph AI agent protects \(osd\.3\)/,
      );
    }
  });

  test("reads of a protected OSD are fine: protection is about changes", () => {
    expectPrepared(
      executor({
        config: { ONEUPTIME_AI_PROTECTED_TARGETS: "osd.3" },
      }).prepare(request(["ceph", "osd", "find", "3"])),
    );
  });
});

describe("prepare: ceph's own checks", () => {
  test("an option that picks the cluster, client, keyring or a file never runs, even if a policy let it through", () => {
    const cases: Array<[Array<string>, string]> = [
      [["ceph", "health", "--id", "admin"], "--id"],
      [
        ["ceph", "auth", "ls", "--keyring=/etc/ceph/ceph.client.admin.keyring"],
        "--keyring=/etc/ceph/ceph.client.admin.keyring",
      ],
      [["ceph", "health", "-c", "/tmp/evil.conf"], "-c"],
      [["ceph", "health", "--mon-host=10.9.9.9"], "--mon-host=10.9.9.9"],
      [["ceph", "health", "--keyr", "/x"], "--keyr"],
    ];

    for (const [argv, word] of cases) {
      const guardPolicy: ReturnType<typeof fakePolicy> = fakePolicy({
        [argv.join(" ")]: ResourceCommandTier.Read,
      });

      const refusal: string = expectRefused(
        executor({ guardPolicy }).prepare(request(argv)),
        /is an option to ceph itself, and the agent alone chooses the cluster, client, keyring and files ceph uses \(it passes --conf, --keyring, --id and --connect-timeout\)/,
      );

      assert.ok(refusal.includes(`"${word}"`), refusal);
      // The guard really ran first.
      assert.strictEqual(guardPolicy.calls.length, 1);
    }

    assert.strictEqual(ceph.requestedBinaries.length, 0);
  });

  test("an agent that cannot connect as configured refuses even reads, saying what to fix", () => {
    const cases: Array<[Record<string, string | undefined>, RegExp]> = [
      [
        { CEPH_CONF: path.join(tmpDir, "missing.conf") },
        /The ceph\.conf at .*missing\.conf is not in the agent's container/,
      ],
      [
        { CEPH_KEYRING: path.join(tmpDir, "missing.keyring") },
        /The keyring .*missing\.keyring is not in the agent's container\. Create it \(ceph auth get-or-create client\.oneuptime-ai/,
      ],
      [
        { CEPH_CLIENT_ID: "a b" },
        /CEPH_CLIENT_ID="a b" is not a Ceph client name/,
      ],
      [
        { CEPH_CONF: "ceph.conf" },
        /CEPH_CONF="ceph\.conf" is not an absolute path/,
      ],
    ];

    for (const [env, pattern] of cases) {
      const refusal: string = expectRefused(
        executor({ env }).prepare(request(["ceph", "health"])),
        pattern,
      );
      assert.match(
        refusal,
        /: it cannot connect to the Ceph cluster as configured\. /,
      );
    }

    assert.strictEqual(ceph.requestedBinaries.length, 0);
  });

  test("the guard still answers first: a command for another cluster is refused as such, even when misconfigured", () => {
    expectRefused(
      executor({ env: { CEPH_KEYRING: "/nope/keyring" } }).prepare(
        request(["ceph", "health"], {}, { resourceIdentifier: "ceph-backup" }),
      ),
      /this command is for Ceph cluster "ceph-backup"/,
    );
  });

  test("nothing is protected on the executor's own account: ONEUPTIME_AI_PROTECTED_TARGETS is the operator's list", () => {
    assert.deepStrictEqual(executor().getProtectedTargets(), []);
  });

  test("an executor handed another resource type's command refuses it: it starts ceph only", () => {
    const exec: CephExecutor = new CephExecutor({
      config: testConfig(URL, {}),
      env: agentEnv(),
      tmpDir,
      logger: recordingLogger(),
      spawnImpl: ceph.spawnImpl(),
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
      'Refused by the Docker AI agent: this executor runs ceph for a Ceph cluster only, not "docker" for a DockerHost.',
    );
    assert.strictEqual(ceph.requestedBinaries.length, 0);
  });
});

describe("run: how ceph is started", () => {
  test("/usr/bin/ceph with the agent's connection options, then the argv exactly as sent — never a shell", async () => {
    ceph.setScript({ "osd tree": { stdout: "ID  CLASS  WEIGHT\n" } });

    const result: ExecResult = await runCommand(
      executor(),
      request(["ceph", "osd", "tree", "--format", "json-pretty"]),
    );

    assert.strictEqual(result.success, true, String(result.errorMessage));
    assert.deepStrictEqual(ceph.requestedBinaries, [CEPH_BINARY]);
    assert.strictEqual(CEPH_BINARY, "/usr/bin/ceph");
    assert.deepStrictEqual(onlyInvocation().argv, [
      ...connection(10),
      "osd",
      "tree",
      "--format",
      "json-pretty",
    ]);
    assert.deepStrictEqual(onlyInvocation().command, [
      "osd",
      "tree",
      "--format",
      "json-pretty",
    ]);
    assert.strictEqual(ceph.spawnOptions[0]!.shell, false);
    assert.deepStrictEqual(ceph.spawnOptions[0]!.stdio, [
      "ignore",
      "pipe",
      "pipe",
    ]);
  });

  test("ceph -s passes through as-is, and the payload's format is never changed", async () => {
    ceph.setScript({ "-s": { stdout: "  cluster:\n    health: HEALTH_OK\n" } });

    await runCommand(executor(), request(["ceph", "-s"]));
    assert.deepStrictEqual(onlyInvocation().command, ["-s"]);

    ceph.reset();
    await runCommand(executor(), request(["ceph", "health", "detail"]));
    assert.deepStrictEqual(onlyInvocation().command, ["health", "detail"]);
    assert.ok(!onlyInvocation().argv.includes("--format"));
  });

  test("orch ps's named arguments pass through", async () => {
    await runCommand(
      executor(),
      request(["ceph", "orch", "ps", "--daemon_type", "mgr", "--refresh"]),
    );

    assert.deepStrictEqual(onlyInvocation().command, [
      "orch",
      "ps",
      "--daemon_type",
      "mgr",
      "--refresh",
    ]);
  });

  test("the connect timeout follows the command's budget", async () => {
    await runCommand(
      executor(),
      request(["ceph", "health"], { timeoutInMs: 6_000 }),
    );
    assert.deepStrictEqual(onlyInvocation().argv.slice(0, 8), connection(3));

    ceph.reset();
    await runCommand(
      executor(),
      request(["ceph", "health"], { timeoutInMs: 120_000 }),
    );
    assert.deepStrictEqual(onlyInvocation().argv.slice(0, 8), connection(10));
  });

  test("the client and keyring come from CEPH_CLIENT_ID and CEPH_KEYRING", async () => {
    const fixKeyring: string = path.join(tmpDir, "ceph.client.ai-fix.keyring");
    fs.writeFileSync(fixKeyring, `[client.ai-fix]\n\tkey = ${KEY}\n`);

    await runCommand(
      executor({
        env: { CEPH_CLIENT_ID: "client.ai-fix", CEPH_KEYRING: fixKeyring },
      }),
      request(["ceph", "health"]),
    );

    assert.deepStrictEqual(
      onlyInvocation().argv.slice(0, 8),
      connection(10, fixKeyring, "ai-fix"),
    );
  });

  test("the environment is closed: PATH and HOME only — never CEPH_ARGS, CEPH_CONF or the agent's key", async () => {
    const previous: Record<string, string | undefined> = {
      ONEUPTIME_API_KEY: process.env["ONEUPTIME_API_KEY"],
      CEPH_ARGS: process.env["CEPH_ARGS"],
    };
    process.env["ONEUPTIME_API_KEY"] = "process-key-must-not-leak";
    process.env["CEPH_ARGS"] = "--id admin";

    try {
      await runCommand(executor(), request(["ceph", "health"]));
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }

    const env: Record<string, string> = onlyInvocation().env;

    assert.deepStrictEqual(Object.keys(env).sort(), ["HOME", "PATH"]);
    assert.strictEqual(env["PATH"], DEFAULT_SPAWN_PATH);
    assert.doesNotMatch(
      JSON.stringify(env),
      /must-not-leak|admin|proxy|ceph\.conf/,
    );
  });

  test("HOME is the command's private, empty directory, removed afterwards", async () => {
    await runCommand(executor(), request(["ceph", "health"]));

    const invocation: FakeCephInvocation = onlyInvocation();

    // HOME is the working directory (macOS reports /var as /private/var).
    assert.ok(
      invocation.cwd.endsWith(invocation.env["HOME"]!),
      `${invocation.cwd} vs ${invocation.env["HOME"]}`,
    );
    assert.strictEqual(path.basename(invocation.cwd), JOB_HOME_DIR_NAME);
    assert.strictEqual(invocation.homeExists, true);
    assert.deepStrictEqual(invocation.homeEntries, []);
    assert.strictEqual(invocation.cwdMode, 0o700);
    assert.strictEqual(invocation.parentMode, 0o700);
    assert.deepStrictEqual(invocation.parentEntries, [JOB_HOME_DIR_NAME]);
    assert.strictEqual(
      path.basename(path.dirname(path.dirname(invocation.cwd))),
      JOB_DIR_PARENT_NAME,
    );
    assert.strictEqual(fs.existsSync(path.dirname(invocation.cwd)), false);
  });

  test("a fix runs the same way, with its tier", async () => {
    ceph.setScript({ "osd in 3": { stderr: "marked in osd.3. \n" } });

    const prepared: PreparedCommand = expectPrepared(
      executor({ config: WRITES_ON }).prepare(
        remediation(["ceph", "osd", "in", "3"]),
      ),
    );
    const result: ExecResult = await prepared.run();

    assert.strictEqual(prepared.tier, ResourceCommandTier.SafeWrite);
    assert.deepStrictEqual(result, {
      success: true,
      exitCode: 0,
      output: "[stderr]\nmarked in osd.3. \n",
    });
    assert.deepStrictEqual(onlyInvocation().argv, [
      ...connection(10),
      "osd",
      "in",
      "3",
    ]);
  });

  test("a fix that always asks a human still runs once it was approved", async () => {
    ceph.setScript({ "osd pool set": { stderr: "set pool 1 size to 3\n" } });

    const prepared: PreparedCommand = expectPrepared(
      executor({ config: WRITES_ON }).prepare(
        remediation(["ceph", "osd", "pool", "set", "rbd", "size", "3"]),
      ),
    );

    assert.strictEqual(prepared.tier, ResourceCommandTier.RiskyWrite);
    assert.strictEqual((await prepared.run()).success, true);
  });
});

describe("run: the output", () => {
  test("stdout and stderr, formatted like every resource command", async () => {
    ceph.setScript({
      "health detail": {
        stdout:
          "HEALTH_WARN 1 osds down\n[WRN] OSD_DOWN: 1 osds down\n    osd.3 is down\n",
        stderr: "warning: slow\n",
      },
    });

    const result: ExecResult = await runCommand(
      executor(),
      request(["ceph", "health", "detail"]),
    );

    assert.deepStrictEqual(result, {
      success: true,
      exitCode: 0,
      output:
        "[stdout]\nHEALTH_WARN 1 osds down\n[WRN] OSD_DOWN: 1 osds down\n    osd.3 is down\n\n[stderr]\nwarning: slow\n",
    });
  });

  test('ceph -s keeps its usage section (the generic rules would read "data:" as a Secret)', async () => {
    ceph.setScript({ "-s": { stdout: STATUS_PLAIN } });

    const result: ExecResult = await runCommand(
      executor(),
      request(["ceph", "-s"]),
    );

    assert.strictEqual(result.output, `[stdout]\n${STATUS_PLAIN}`);
  });

  test("ceph's default keyring search lines are dropped when the keyring lives elsewhere", async () => {
    ceph.setScript({
      health: {
        stdout: "HEALTH_OK\n",
        stderr: `${STDERR_DEFAULT_KEYRING_SEARCH("oneuptime-ai")}real warning\n`,
      },
    });

    const result: ExecResult = await runCommand(
      executor(),
      request(["ceph", "health"]),
    );

    assert.strictEqual(
      result.output,
      "[stdout]\nHEALTH_OK\n\n[stderr]\nreal warning\n",
    );
  });

  test("capped at the agent's output budget, and says so", async () => {
    ceph.setScript({ "osd dump": { stdoutBytes: MAX_OUTPUT_BYTES * 2 } });

    const result: ExecResult = await runCommand(
      executor(),
      request(["ceph", "osd", "dump"]),
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

  test("cephx keys ceph prints are masked before the output leaves the agent", async () => {
    ceph.setScript({
      "mon dump": {
        stdout: [
          "[client.oneuptime-ai]",
          `\tkey = ${KEY}`,
          `{"entity":"client.admin","key":"AQBpbnN0YW5jZWtleWluc3RhbmNla2V5aW5zdGE=="}`,
          "password=hunter2",
        ].join("\n"),
        stderr: `key: ${KEY}\n`,
      },
    });

    const result: ExecResult = await runCommand(
      executor(),
      request(["ceph", "mon", "dump"]),
    );

    assert.strictEqual(result.success, true);
    assert.match(result.output, /\[client\.oneuptime-ai\]/);
    assert.doesNotMatch(
      result.output,
      /AQAwjrtqK5MvFxAA37KrFISvJt|AQBpbnN0YW5jZWtleW|hunter2/,
    );
    assert.match(result.output, /key = \[redacted/);
    assert.match(result.output, /"key":"\[redacted/);
  });

  test("NUL characters are replaced (a database text column cannot hold them)", async () => {
    ceph.setScript({ "mon stat": { stdout: "e1\u0000mon\n" } });

    const result: ExecResult = await runCommand(
      executor(),
      request(["ceph", "mon", "stat"]),
    );

    assert.strictEqual(result.output, `[stdout]\ne1${NUL_REPLACEMENT}mon\n`);
  });
});

describe("run: failures say what to change", () => {
  const failures: Array<[string, string, number, RegExp]> = [
    [
      "the monitors never answered",
      STDERR_MON_UNREACHABLE,
      1,
      /^Exit code 1: timed out\. The agent cannot reach the monitors in .*ceph\.conf \(mon_host\): check the addresses and that this machine reaches them on TCP 3300 and 6789\.$/,
    ],
    [
      "a key the monitors reject",
      STDERR_AUTH_REJECTED,
      13,
      /^Exit code 13: \[errno 13\] RADOS permission denied \(error connecting to the cluster\)\. The monitors rejected client\.oneuptime-ai's key: check that CEPH_CLIENT_ID names the client .* holds/,
    ],
    [
      "a ceph.conf ceph cannot read",
      STDERR_CONF_MISSING,
      1,
      /could not read .*ceph\.conf \(CEPH_CONF\): mount the cluster's ceph\.conf there, readable by UID 1000\.$/,
    ],
    [
      "a ceph.conf that is not one",
      STDERR_CONF_INVALID,
      1,
      /is not a valid ceph\.conf: replace it with the output of ceph config generate-minimal-conf\.$/,
    ],
    [
      "no monitors in ceph.conf",
      STDERR_NO_MONITORS,
      1,
      /names no monitors: add mon_host/,
    ],
    [
      "monitor names the container cannot resolve",
      STDERR_MON_UNRESOLVABLE,
      1,
      /cannot resolve the monitors in .* \(mon_host\): use IP addresses/,
    ],
    [
      "a read the client's caps do not allow",
      STDERR_ACCESS_DENIED,
      13,
      /^Exit code 13: Error EACCES: access denied\. client\.oneuptime-ai may not read this: give it the read caps with ceph auth caps client\.oneuptime-ai mon 'allow r' mgr 'allow r' osd 'allow r'\.$/,
    ],
    [
      "no mgr caps",
      STDERR_MGR_ACCESS_DENIED,
      13,
      /client\.oneuptime-ai may not read this/,
    ],
    [
      "no orchestrator",
      STDERR_NO_ORCHESTRATOR,
      2,
      /^Exit code 2: Error ENOENT: No orchestrator configured \(try `ceph orch set backend`\)\. This cluster has no orchestrator backend \(cephadm\)/,
    ],
    [
      "an OSD that does not exist",
      STDERR_OSD_NOT_FOUND,
      2,
      /^Exit code 2: Error ENOENT: osd\.99 does not exist\. The object it names does not exist: look up the exact name with ceph osd tree/,
    ],
    [
      "a command the cluster does not offer",
      STDERR_UNKNOWN_COMMAND,
      22,
      /^Exit code 22: Error EINVAL: invalid command\. The cluster does not offer this command: the commands of mgr modules .* exist only while a mgr is active/,
    ],
  ];

  for (const [name, stderr, exitCode, hint] of failures) {
    test(`${name}: ceph's reason, then what to do`, async () => {
      ceph.setScript({ "*": { stderr, exitCode } });

      const result: ExecResult = await runCommand(
        executor(),
        request(["ceph", "osd", "find", "99"]),
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, exitCode);
      assert.match(String(result.errorMessage), hint);
      assert.match(result.output, /^\[stderr\]\n/);
    });
  }

  test("a keyring that went missing between prepare and run: the keyring is named", async () => {
    ceph.setScript({
      "*": { stderr: STDERR_KEYRING_MISSING(keyringPath), exitCode: 1 },
    });

    const result: ExecResult = await runCommand(
      executor(),
      request(["ceph", "health"]),
    );

    assert.strictEqual(result.exitCode, 1);
    assert.ok(
      String(result.errorMessage).startsWith(
        "Exit code 1: [errno 2] RADOS object not found (error connecting to the cluster). ceph found no key for client.oneuptime-ai in ",
      ),
      String(result.errorMessage),
    );
    // The lines naming the agent's own keyring stay in the output.
    assert.match(result.output, /to find a keyring on /);
    assert.match(result.output, /no keyring found at .*, disabling cephx/);
  });

  test("a keyring the agent cannot read, and one that is not a keyring", async () => {
    ceph.setScript({
      "*": { stderr: STDERR_KEYRING_UNREADABLE(keyringPath), exitCode: 13 },
    });
    assert.match(
      String(
        (await runCommand(executor(), request(["ceph", "health"])))
          .errorMessage,
      ),
      /The agent \(UID 1000\) cannot read .*: on the host, chown 1000:1000 and chmod 600 the keyring file\.$/,
    );

    ceph.reset();
    ceph.setScript({
      "*": { stderr: STDERR_KEYRING_INVALID(keyringPath), exitCode: 1 },
    });
    assert.match(
      String(
        (await runCommand(executor(), request(["ceph", "health"])))
          .errorMessage,
      ),
      /is not a valid keyring: export it again with ceph auth get client\.oneuptime-ai -o <that file>\.$/,
    );
  });

  test("a fix the client's caps do not allow: the fixes caps from the README", async () => {
    ceph.setScript({ "*": { stderr: STDERR_ACCESS_DENIED, exitCode: 13 } });

    const result: ExecResult = await runCommand(
      executor({ config: WRITES_ON }),
      remediation(["ceph", "osd", "set", "noout"]),
    );

    assert.strictEqual(result.exitCode, 13);
    assert.match(
      String(result.errorMessage),
      /^Exit code 13: Error EACCES: access denied\. client\.oneuptime-ai's caps do not allow this change: give it the fixes caps from the Ceph agent's README/,
    );
  });

  test("a PG without its primary: try again once the cluster has settled", async () => {
    ceph.setScript({ "*": { stderr: STDERR_PG_NO_PRIMARY, exitCode: 11 } });

    const result: ExecResult = await runCommand(
      executor({ config: WRITES_ON }),
      remediation(["ceph", "pg", "repair", "1.0"]),
    );

    assert.match(
      String(result.errorMessage),
      /^Exit code 11: Error EAGAIN: pg 1\.0 has no primary osd\. The cluster cannot do it right now/,
    );
  });

  test("a failure nobody has advice for: ceph's own reason only", async () => {
    ceph.setScript({
      "*": { stderr: "Traceback\nKeyError: 'pgmap'\n", exitCode: 1 },
    });

    const result: ExecResult = await runCommand(
      executor(),
      request(["ceph", "df"]),
    );

    assert.strictEqual(result.errorMessage, "Exit code 1: KeyError: 'pgmap'");
  });

  test("a secret in ceph's last line is masked in the message too", async () => {
    ceph.setScript({
      "*": { stderr: "Error EIO: token=abcdef0123456789abcdef\n", exitCode: 5 },
    });

    const result: ExecResult = await runCommand(
      executor(),
      request(["ceph", "df"]),
    );

    assert.doesNotMatch(String(result.errorMessage), /abcdef0123456789/);
    assert.strictEqual(
      result.errorMessage,
      `Exit code 5: ${redactOutput({
        resourceType: AiResourceType.CephCluster,
        program: "ceph",
        text: "Error EIO: token=abcdef0123456789abcdef",
      })}`,
    );
  });
});

describe("run: time limits", () => {
  test("a ceph that never answers is killed, and the message says why that usually happens", async () => {
    ceph.setScript({ "*": { sleepMs: 10_000 } });

    const result: ExecResult = await runCommand(
      executor(),
      request(["ceph", "pg", "stat"], { timeoutInMs: 300 }),
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(
      result.errorMessage,
      `Killed (timeout 300ms): ceph produced no output at all, so the Ceph cluster never answered: the monitors in ${confPath} (mon_host) may be unreachable from this agent (TCP 3300 and 6789), or the command waits for a mgr that is not running (pg, df, osd df, crash, orch and balancer commands need an active mgr: check ceph mgr stat).`,
    );
  });

  test("a fix that is killed may already have been applied: check before retrying", async () => {
    ceph.setScript({
      "*": {
        stderr: "marked out osd.3.",
        sleepMs: 10_000,
        announcePrinted: true,
      },
    });

    // The budget runs out once ceph has printed, however slow its start.
    const result: ExecResult = await killAfterOutput({
      timeoutInMs: 2_000,
      run: (): Promise<ExecResult> => {
        return runCommand(
          executor({ config: WRITES_ON }),
          remediation(["ceph", "osd", "out", "3"], { timeoutInMs: 2_000 }),
        );
      },
      printed: (signal: AbortSignal): Promise<void> => {
        return ceph.waitUntilPrinted(signal);
      },
    });

    assert.strictEqual(result.success, false);
    assert.match(result.output, /marked out osd\.3\./);
    assert.strictEqual(
      result.errorMessage,
      "Killed (timeout 2000ms). The change may already have reached the monitors, which apply it on their own: check ceph status and ceph health detail before running it again.",
    );
  });

  test("a read killed after some output: the kill alone", async () => {
    ceph.setScript({
      "*": { stdout: "partial", sleepMs: 10_000, announcePrinted: true },
    });

    const result: ExecResult = await killAfterOutput({
      timeoutInMs: 2_000,
      run: (): Promise<ExecResult> => {
        return runCommand(
          executor(),
          request(["ceph", "osd", "tree"], { timeoutInMs: 2_000 }),
        );
      },
      printed: (signal: AbortSignal): Promise<void> => {
        return ceph.waitUntilPrinted(signal);
      },
    });

    assert.strictEqual(result.errorMessage, "Killed (timeout 2000ms)");
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

function errorEventSpawn(message: string): SpawnFunction {
  return ((): FakeChild => {
    const child: FakeChild = new FakeChild();
    setImmediate((): void => {
      child.emit(
        "error",
        Object.assign(new Error(message), { code: "EACCES" }),
      );
    });
    return child;
  }) as unknown as SpawnFunction;
}

describe("run never throws", () => {
  test("ceph missing from the container: use the agent image", async () => {
    const result: ExecResult = await runCommand(
      executor({
        spawnImpl: ceph.spawnImpl(path.join(tmpDir, "no-such-ceph")),
      }),
      request(["ceph", "health"]),
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage:
        "ceph is not installed in this container (/usr/bin/ceph was not found). Use the oneuptime/resource-ai-agent image, which includes it.",
    });
  });

  test("a spawn that throws is reported, not thrown", async () => {
    const spawnImpl: SpawnFunction = ((): never => {
      throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    }) as unknown as SpawnFunction;

    const result: ExecResult = await runCommand(
      executor({ spawnImpl }),
      request(["ceph", "health"]),
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage: "Could not start ceph: spawn EACCES",
    });
  });

  test("an error event from the child is reported, not thrown", async () => {
    const result: ExecResult = await runCommand(
      executor({ spawnImpl: errorEventSpawn("spawn /usr/bin/ceph EACCES") }),
      request(["ceph", "health"]),
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage: "Could not start ceph: spawn /usr/bin/ceph EACCES",
    });
  });

  test("no private directory could be made: reported, nothing started", async () => {
    const notADirectory: string = path.join(tmpDir, "a-file");
    fs.writeFileSync(notADirectory, "x");

    const result: ExecResult = await runCommand(
      executor({ tmpDir: notADirectory }),
      request(["ceph", "health"]),
    );

    assert.strictEqual(result.success, false);
    assert.match(
      String(result.errorMessage),
      /^Could not prepare a private directory for ceph: /,
    );
    assert.strictEqual(ceph.requestedBinaries.length, 0);
  });

  test("anything unexpected inside run becomes a failed result", async () => {
    const exec: CephExecutor = executor();
    const prepared: PreparedCommand = expectPrepared(
      exec.prepare(request(["ceph", "health"])),
    );
    (exec as unknown as { sandbox: { capture: () => never } }).sandbox.capture =
      (): never => {
        throw new Error("boom");
      };

    assert.deepStrictEqual(await prepared.run(), {
      success: false,
      output: "",
      errorMessage: "ceph could not be run: boom",
    });
  });
});

describe("posture: ceph versions and ceph health", () => {
  const PROBE_SCRIPT: Record<string, { stdout: string }> = {
    "versions --format json": { stdout: VERSIONS_JSON },
    "health --format json": { stdout: HEALTH_WARN_JSON },
  };

  test("a reachable cluster: its release, its health, how the agent connects", async () => {
    ceph.setScript(PROBE_SCRIPT);

    const probe: ResourcePostureProbe = await executor().probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: "ceph 19.2.3 squid (stable)",
      reachable: true,
      reachError: null,
      details: {
        clientId: "oneuptime-ai",
        confPath,
        keyringPath,
        health: "HEALTH_WARN",
        healthChecks: "OSD_DOWN, PG_DEGRADED",
        mixedVersions: false,
      },
      protectedTargets: [],
    });

    // Both probes ran, as JSON, connecting within the probe's own limit.
    const commands: Array<string> = ceph
      .getInvocations()
      .map((invocation: FakeCephInvocation): string => {
        assert.deepStrictEqual(
          invocation.argv.slice(0, 8),
          connection(CEPH_PROBE_CONNECT_TIMEOUT_SECONDS),
        );
        assert.deepStrictEqual(Object.keys(invocation.env).sort(), [
          "HOME",
          "PATH",
        ]);
        return invocation.command.join(" ");
      })
      .sort();

    assert.deepStrictEqual(commands, [
      CEPH_HEALTH_PROBE_ARGS.join(" "),
      CEPH_VERSIONS_PROBE_ARGS.join(" "),
    ]);
  });

  test("an upgrade under way and a healthy cluster", async () => {
    ceph.setScript({
      "versions --format json": { stdout: MIXED_VERSIONS_JSON },
      "health --format json": { stdout: HEALTH_OK_JSON },
    });

    const probe: ResourcePostureProbe = await executor().probePosture();

    assert.strictEqual(probe.reachable, true);
    assert.strictEqual(
      probe.toolVersion,
      "ceph 18.2.4 reef (stable) (8 daemons), 19.2.3 squid (stable) (7 daemons)",
    );
    assert.strictEqual(probe.details!["health"], "HEALTH_OK");
    assert.strictEqual(probe.details!["healthChecks"], null);
    assert.strictEqual(probe.details!["mixedVersions"], true);
  });

  test("output that is not the expected JSON: reachable (ceph answered), facts unknown", async () => {
    ceph.setScript({ "*": { stdout: "something else\n" } });

    const probe: ResourcePostureProbe = await executor().probePosture();

    assert.strictEqual(probe.reachable, true);
    assert.strictEqual(probe.toolVersion, null);
    assert.strictEqual(probe.details!["health"], null);
    assert.strictEqual(probe.details!["mixedVersions"], null);
  });

  test("the keyring search noise does not stop a probe", async () => {
    ceph.setScript({
      "versions --format json": {
        stdout: VERSIONS_JSON,
        stderr: STDERR_DEFAULT_KEYRING_SEARCH("oneuptime-ai"),
      },
      "health --format json": { stdout: HEALTH_OK_JSON },
    });

    assert.strictEqual((await executor().probePosture()).reachable, true);
  });

  const unreachable: Array<[string, string, number, RegExp]> = [
    [
      "a key the monitors reject",
      STDERR_AUTH_REJECTED,
      13,
      /^The monitors rejected client\.oneuptime-ai's key/,
    ],
    [
      "monitors that never answer",
      STDERR_MON_UNREACHABLE,
      1,
      /^The agent cannot reach the monitors in .* \(mon_host\)/,
    ],
    [
      "no read caps",
      STDERR_ACCESS_DENIED,
      13,
      /^client\.oneuptime-ai may not read this: give it the read caps with ceph auth caps client\.oneuptime-ai mon 'allow r' mgr 'allow r' osd 'allow r'\.$/,
    ],
    [
      "something else, with a secret in it",
      "Error EIO: token=abcdef0123456789abcdef\n",
      5,
      /^ceph versions failed \(exit code 5\): Error EIO: token=\[redacted/,
    ],
  ];

  for (const [name, stderr, exitCode, reachError] of unreachable) {
    test(`unreachable: ${name}`, async () => {
      ceph.setScript({ "*": { stderr, exitCode } });

      const probe: ResourcePostureProbe = await executor().probePosture();

      assert.strictEqual(probe.reachable, false);
      assert.strictEqual(probe.toolVersion, null);
      assert.match(String(probe.reachError), reachError);
      assert.doesNotMatch(String(probe.reachError), /abcdef0123456789/);
      assert.deepStrictEqual(probe.details, connectionDetails());
      assert.deepStrictEqual(probe.protectedTargets, []);
    });
  }

  test("unreachable: versions answered but health did not", async () => {
    ceph.setScript({
      "versions --format json": { stdout: VERSIONS_JSON },
      "health --format json": {
        stderr: STDERR_MGR_ACCESS_DENIED,
        exitCode: 13,
      },
    });

    const probe: ResourcePostureProbe = await executor().probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(String(probe.reachError), /may not read this/);
  });

  test("unreachable: ceph never answers within the probe's time", async () => {
    ceph.setScript({ "*": { sleepMs: 10_000 } });
    const exec: CephExecutor = executor();
    exec.probeTimeoutMs = 300;

    const probe: ResourcePostureProbe = await exec.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(
      probe.reachError,
      `The Ceph cluster did not answer ceph versions within 300ms: check mon_host in ${confPath} and the network to the monitors (TCP 3300 and 6789).`,
    );
  });

  test("the probe's own budget sits inside the agent's posture timeout", () => {
    assert.ok(CEPH_PROBE_TIMEOUT_MS < 15_000);
    assert.ok(
      CEPH_PROBE_CONNECT_TIMEOUT_SECONDS * 1000 < CEPH_PROBE_TIMEOUT_MS,
    );
    assert.strictEqual(executor().probeTimeoutMs, CEPH_PROBE_TIMEOUT_MS);
  });

  test("misconfigured: says what to fix, and starts nothing", async () => {
    const probe: ResourcePostureProbe = await executor({
      env: { CEPH_KEYRING: path.join(tmpDir, "missing.keyring") },
    }).probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /^The keyring .*missing\.keyring is not in the agent's container/,
    );
    assert.strictEqual(ceph.requestedBinaries.length, 0);
  });

  test("ceph missing, or a spawn that throws: unreachable, never a rejection", async () => {
    const missing: ResourcePostureProbe = await executor({
      spawnImpl: ceph.spawnImpl(path.join(tmpDir, "no-such-ceph")),
    }).probePosture();

    assert.strictEqual(missing.reachable, false);
    assert.match(
      String(missing.reachError),
      /^ceph is not installed in this container \(\/usr\/bin\/ceph was not found\)/,
    );

    const throwing: ResourcePostureProbe = await executor({
      spawnImpl: ((): never => {
        throw new Error("spawn EMFILE");
      }) as unknown as SpawnFunction,
    }).probePosture();

    assert.strictEqual(throwing.reachable, false);
    assert.strictEqual(
      throwing.reachError,
      "Could not start ceph: spawn EMFILE",
    );
  });

  test("an error event from the child: unreachable with its reason", async () => {
    const probe: ResourcePostureProbe = await executor({
      spawnImpl: errorEventSpawn("spawn /usr/bin/ceph EACCES"),
    }).probePosture();

    assert.strictEqual(
      probe.reachError,
      "Could not start ceph: spawn /usr/bin/ceph EACCES",
    );
  });

  test("no private directory: unreachable with the reason", async () => {
    const notADirectory: string = path.join(tmpDir, "another-file");
    fs.writeFileSync(notADirectory, "x");

    const probe: ResourcePostureProbe = await executor({
      tmpDir: notADirectory,
    }).probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /^Could not prepare a private directory for ceph: /,
    );
  });

  test("anything unexpected is an unreachable cluster with the reason", async () => {
    const exec: CephExecutor = executor();
    (exec as unknown as { sandbox: { capture: () => never } }).sandbox.capture =
      (): never => {
        throw new Error("boom");
      };

    const probe: ResourcePostureProbe = await exec.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(
      probe.reachError,
      "Checking the Ceph cluster failed: boom",
    );
  });
});

describe("job directories", () => {
  test("the start-up sweep removes what a previous run left behind, and logs it once", async () => {
    const sweepDir: string = makeTempDir("agent-ceph-sweep-");
    const logger: ReturnType<typeof recordingLogger> = recordingLogger();
    const exec: CephExecutor = executor({ tmpDir: sweepDir, logger });
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
  test("a ceph agent gets the ceph executor, not a placeholder", () => {
    const exec: ResourceExecutor = createExecutor({
      config: cephConfig(),
      env: agentEnv(),
      tmpDir,
      logger: recordingLogger(),
    });

    assert.ok(exec instanceof CephExecutor);
  });

  test("an environment without ceph.conf or a keyring builds an executor that refuses with the reason", async () => {
    const exec: ResourceExecutor = createExecutor({
      config: cephConfig(),
      env: {
        CEPH_CONF: path.join(tmpDir, "absent", "ceph.conf"),
        CEPH_KEYRING: path.join(tmpDir, "absent", "keyring"),
      },
      tmpDir,
      logger: recordingLogger(),
    });

    expectRefused(
      exec.prepare(request(["ceph", "health"])),
      /it cannot connect to the Ceph cluster as configured\. The ceph\.conf at /,
    );
    assert.strictEqual((await exec.probePosture()).reachable, false);
  });
});
