import {
  RecordingLogger,
  TEST_RESOURCE_NAME,
  recordingLogger,
  testConfig,
} from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { after, afterEach, before, describe, test } from "node:test";
import { AgentConfig } from "../Config";
import { EXECUTOR_CLASSES, createExecutor } from "../Executors/ExecutorFactory";
import HostExecutor, {
  CONTAINER_INIT_NAMES,
  DOCKER_CONTAINER_MARKER,
  DOCKER_RUNTIME_UNITS,
  HOST_AI_AGENT_UNIT,
  HOST_PROGRAM_HOME,
  HOST_PROGRAM_PATH,
  HostAccessFacts,
  HostExecutorSettings,
  NSENTER_BINARY,
  NSENTER_NAMESPACE_ARGS,
  ONEUPTIME_HOST_PROTECTED_TARGETS,
  PODMAN_CONTAINER_MARKER,
  PROBE_TIMEOUT_MS,
  buildHostEnvironment,
  buildHostProgramArgs,
  buildNsenterArgs,
  describeHostAccessProblem,
  describeHostCommandFailure,
  describeHostSilence,
  describeNsenterFailure,
  formatHostToolVersion,
  hasNoPagerFlag,
  parseHostnameOutput,
  parseOsReleasePrettyName,
  parseProcStatParentPid,
  parseSystemdVersion,
} from "../Executors/HostExecutor";
import { GuardPolicy } from "../Executors/PrepareGuard";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  PreparedCommand,
  ResourceCommandRequest,
  ResourceExecutor,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import {
  DEFAULT_SPAWN_PATH,
  JOB_DIR_PARENT_NAME,
  JOB_HOME_DIR_NAME,
  MAX_OUTPUT_BYTES,
  NUL_REPLACEMENT,
} from "../Executors/SpawnSandbox";
import FakeBinary, {
  FakeBinaryInvocation,
  makeTempDir,
} from "./Helpers/FakeBinary";
import { fakePolicy } from "./Helpers/FakeExecutor";
import FakeNsenter, {
  AGENT_PID,
  CONTAINER_NAMESPACE,
  FakeHostReply,
  HOST_NAMESPACE,
  HostProcLayout,
  HostResponder,
  SYSTEMD_VERSION_OUTPUT,
  execFailure,
  healthyHost,
  makeHostProc,
} from "./Helpers/FakeNsenter";
import { TEST_RESOURCE_ID } from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_POSTURE_STRING_LENGTH,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The host kit: HostExecutor runs the host's own programs through nsenter,
 * with the REAL host policy (HostCommandPolicy through the agent's copy of
 * the dispatcher).
 *
 * Two doubles stand in for /usr/bin/nsenter:
 *
 *   - FakeNsenter (an injected spawn) answers by the host argv (what
 *     follows nsenter's "--") and records the argv, the environment and the
 *     spawn options exactly as the sandbox passed them;
 *   - FakeBinary, a real process on disk, for what only a real process can
 *     show: the environment it really gets, the output cap, the kill of a
 *     hung program.
 *
 * /proc is always a directory the test controls (settings.procRoot), and
 * the uid, the agent's own pid and the container marker files are injected,
 * so whether pid 1 is the host's init is decided by each test — on macOS,
 * on a Linux laptop or in CI alike.
 */

const URL: string = "https://oneuptime.example.com";
const HOST: string = TEST_RESOURCE_NAME;

const tempDirs: Array<string> = [];
let tmpDir: string;
let markersDir: string;
let dockerMarker: string;
let podmanMarker: string;
let absentMarker: string;
let healthyProc: string;

before((): void => {
  tmpDir = makeTempDir("agent-host-executor-");
  markersDir = makeTempDir("agent-host-markers-");
  dockerMarker = path.join(markersDir, "dockerenv");
  podmanMarker = path.join(markersDir, "containerenv");
  absentMarker = path.join(markersDir, "absent");
  fs.writeFileSync(dockerMarker, "");
  fs.writeFileSync(podmanMarker, 'engine="podman-5.2.1"\n');
  healthyProc = makeHostProc();
  tempDirs.push(tmpDir, markersDir, healthyProc);
});

after((): void => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function proc(layout: HostProcLayout): string {
  const dir: string = makeHostProc(layout);
  tempDirs.push(dir);
  return dir;
}

// ---- Building executors and requests ------------------------------------------

interface Built {
  executor: HostExecutor;
  nsenter: FakeNsenter;
  logger: RecordingLogger;
  config: AgentConfig;
}

interface BuildData {
  // Agent configuration (ONEUPTIME_AI_ALLOW_WRITES, HOST_NAME, ...).
  config?: Record<string, string>;
  // The agent's environment as the executor sees it.
  env?: NodeJS.ProcessEnv;
  responder?: HostResponder;
  settings?: HostExecutorSettings;
  // The /proc layout (a healthy host by default).
  proc?: HostProcLayout;
  // Which engine's marker file exists (none by default).
  runtime?: "docker" | "podman" | null;
  guardPolicy?: GuardPolicy;
  // Spawn for real (settings.nsenterBinary names a FakeBinary).
  realSpawn?: boolean;
  tmpDir?: string;
}

function build(data: BuildData = {}): Built {
  const config: AgentConfig = testConfig(URL, {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
    DOCKER_HOST_NAME: "",
    HOST_NAME: HOST,
    ...(data.config || {}),
  });
  const nsenter: FakeNsenter = new FakeNsenter(data.responder);
  const logger: RecordingLogger = recordingLogger();
  const options: ExecutorOptions = {
    config,
    env: data.env || {},
    tmpDir: data.tmpDir || tmpDir,
    logger,
    spawnImpl: data.realSpawn ? undefined : nsenter.spawnImpl,
    guardPolicy: data.guardPolicy,
  };

  return {
    executor: new HostExecutor(options, {
      procRoot: data.proc ? proc(data.proc) : healthyProc,
      dockerMarkerFile: data.runtime === "docker" ? dockerMarker : absentMarker,
      podmanMarkerFile: data.runtime === "podman" ? podmanMarker : absentMarker,
      getuid: (): number => {
        return 0;
      },
      selfPid: AGENT_PID,
      probeTimeoutMs: 1_000,
      ...(data.settings || {}),
    }),
    nsenter,
    logger,
    config,
  };
}

const WRITES: Record<string, string> = { ONEUPTIME_AI_ALLOW_WRITES: "true" };

/*
 * A job as the server would enqueue it: the command read by the same
 * policy, its normalized args and tier.
 */
function request(
  command: string,
  data: {
    origin?: string;
    timeoutInMs?: number;
    payload?: Record<string, unknown>;
    agentResourceId?: string;
  } = {},
): ResourceCommandRequest {
  const policy: ResourceCommandPolicyResult =
    ResourceCommandPolicy.evaluateCommand({
      resourceType: AiResourceType.Host,
      command,
    });

  return {
    payload: {
      resourceType: AiResourceType.Host,
      resourceId: TEST_RESOURCE_ID,
      resourceIdentifier: HOST,
      program: policy.program || command.split(" ")[0],
      args: policy.args,
      displayCommand: policy.displayCommand,
      tier:
        policy.tier === ResourceCommandTier.Denied
          ? ResourceCommandTier.RiskyWrite
          : policy.tier,
      ...(data.payload || {}),
    },
    origin:
      data.origin ||
      (policy.tier === ResourceCommandTier.Read
        ? "AiInvestigation"
        : "AiRemediation"),
    timeoutInMs: data.timeoutInMs ?? 30_000,
    agentResourceId: data.agentResourceId ?? TEST_RESOURCE_ID,
  };
}

function expectRefused(prepared: PrepareResult, pattern: RegExp): string {
  assert.notStrictEqual(prepared.refusal, null, "the command was refused");
  const refusal: string = String(prepared.refusal);
  assert.match(refusal, pattern);
  return refusal;
}

function expectPrepared(prepared: PrepareResult): PreparedCommand {
  assert.strictEqual(prepared.refusal, null, String(prepared.refusal));
  return prepared as PreparedCommand;
}

async function runCommand(
  built: Built,
  command: string,
  data: Parameters<typeof request>[1] = {},
): Promise<ExecResult> {
  return expectPrepared(built.executor.prepare(request(command, data))).run();
}

// Replies by host command; anything else is healthy.
function replies(table: Record<string, FakeHostReply>): HostResponder {
  const healthy: HostResponder = healthyHost(HOST);

  return (hostArgv: Array<string>): FakeHostReply => {
    return table[hostArgv.join(" ")] ?? healthy(hostArgv);
  };
}

// Every command answers the same.
function always(reply: FakeHostReply): HostResponder {
  return (): FakeHostReply => {
    return reply;
  };
}

const DEFAULT_PROTECTED: Array<string> = [
  "oneuptime-*",
  "otelcol-contrib.service",
  "otelcol.service",
  "pid:4242",
  "pid:4200",
  "pid:4100",
];

// ---- The command as it runs ------------------------------------------------------

describe("the argv and the environment", () => {
  test("nsenter enters every namespace of pid 1 but its user namespace, then --", () => {
    assert.deepStrictEqual(
      [...NSENTER_NAMESPACE_ARGS],
      ["--target", "1", "--mount", "--uts", "--ipc", "--net", "--pid", "--"],
    );
    assert.strictEqual(NSENTER_BINARY, "/usr/bin/nsenter");
  });

  test("the environment is exactly the closed one", () => {
    assert.deepStrictEqual(buildHostEnvironment(), {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      SYSTEMD_PAGER: "cat",
      PAGER: "cat",
      SYSTEMD_COLORS: "0",
      SYSTEMD_LESS: "",
      TERM: "dumb",
      HOME: "/nonexistent",
    });
    assert.strictEqual(HOST_PROGRAM_PATH, DEFAULT_SPAWN_PATH);
    assert.strictEqual(HOST_PROGRAM_HOME, "/nonexistent");
    // A fresh object each time: no command can change the next one's.
    assert.notStrictEqual(buildHostEnvironment(), buildHostEnvironment());
  });

  test("--no-pager is found among the flags, never after --", () => {
    assert.strictEqual(hasNoPagerFlag(["status", "--no-pager"]), true);
    assert.strictEqual(hasNoPagerFlag(["--no-pager", "status"]), true);
    assert.strictEqual(hasNoPagerFlag(["status", "nginx"]), false);
    assert.strictEqual(hasNoPagerFlag(["restart", "--", "--no-pager"]), false);
    assert.strictEqual(hasNoPagerFlag([]), false);
    assert.strictEqual(hasNoPagerFlag(["--no-pagerx"]), false);
  });

  test("systemctl and journalctl get --no-pager first when they lack it; nothing else changes", () => {
    assert.deepStrictEqual(
      buildHostProgramArgs("systemctl", ["status", "nginx"]),
      ["--no-pager", "status", "nginx"],
    );
    assert.deepStrictEqual(
      buildHostProgramArgs("journalctl", ["-u", "nginx", "-n", "200"]),
      ["--no-pager", "-u", "nginx", "-n", "200"],
    );
    assert.deepStrictEqual(
      buildHostProgramArgs("systemctl", [
        "list-units",
        "--failed",
        "--no-pager",
      ]),
      ["list-units", "--failed", "--no-pager"],
    );
    // Before "--": after it, "--no-pager" would be a unit name.
    assert.deepStrictEqual(
      buildHostProgramArgs("systemctl", ["restart", "--", "nginx"]),
      ["--no-pager", "restart", "--", "nginx"],
    );
    assert.deepStrictEqual(buildHostProgramArgs("ps", ["aux"]), ["aux"]);
    assert.deepStrictEqual(buildHostProgramArgs("uptime", []), []);
    assert.deepStrictEqual(buildHostProgramArgs("hostnamectl", []), []);

    const args: Array<string> = ["status"];
    buildHostProgramArgs("systemctl", args);
    assert.deepStrictEqual(args, ["status"], "the input is not changed");
  });

  test("the whole nsenter argv", () => {
    assert.deepStrictEqual(buildNsenterArgs("systemctl", ["status", "nginx"]), [
      "--target",
      "1",
      "--mount",
      "--uts",
      "--ipc",
      "--net",
      "--pid",
      "--",
      "systemctl",
      "--no-pager",
      "status",
      "nginx",
    ]);
    assert.deepStrictEqual(buildNsenterArgs("df", ["-h"]), [
      ...NSENTER_NAMESPACE_ARGS,
      "df",
      "-h",
    ]);
  });
});

// ---- Is pid 1 the host's init? -----------------------------------------------

describe("describeHostAccessProblem", () => {
  const OK: HostAccessFacts = {
    uid: 0,
    hostMountNamespace: HOST_NAMESPACE,
    hostMountNamespaceError: null,
    ownMountNamespace: CONTAINER_NAMESPACE,
    containerRuntime: "docker",
    initName: "systemd",
  };

  test("root, pid 1 readable and in another mount namespace: the host", () => {
    assert.strictEqual(describeHostAccessProblem(OK), null);
    assert.strictEqual(
      describeHostAccessProblem({ ...OK, uid: undefined }),
      null,
      "a platform without uids is judged by /proc alone",
    );
  });

  test("not root: says to run the container as root", () => {
    assert.strictEqual(
      describeHostAccessProblem({ ...OK, uid: 1000 }),
      'this agent runs as uid 1000, and only root can enter the host\'s namespaces: run its container as root (user: "0:0") with privileged: true and pid: host.',
    );
  });

  test("no /proc/1/ns: only Linux", () => {
    for (const code of ["ENOENT", "ENOTDIR"]) {
      assert.match(
        String(
          describeHostAccessProblem({
            ...OK,
            hostMountNamespace: null,
            hostMountNamespaceError: code,
          }),
        ),
        new RegExp(
          `^this agent cannot see /proc/1/ns/mnt \\(${code}\\): the Host AI agent only works on Linux`,
        ),
      );
    }
  });

  test("pid 1's namespaces not readable: privileged, as root, on a rootful engine", () => {
    for (const code of ["EACCES", "EPERM"]) {
      assert.strictEqual(
        describeHostAccessProblem({
          ...OK,
          hostMountNamespace: null,
          hostMountNamespaceError: code,
        }),
        `this agent may not open pid 1's namespaces (/proc/1/ns/mnt: ${code}): run its container with privileged: true, as root, on a rootful Docker or Podman engine.`,
      );
    }
  });

  test("any other failure to read either namespace fails closed", () => {
    assert.match(
      String(
        describeHostAccessProblem({
          ...OK,
          hostMountNamespace: null,
          hostMountNamespaceError: "EIO",
        }),
      ),
      /^this agent could not read \/proc\/1\/ns\/mnt \(EIO\)/,
    );
    assert.match(
      String(
        describeHostAccessProblem({
          ...OK,
          hostMountNamespace: null,
          hostMountNamespaceError: null,
        }),
      ),
      /could not read \/proc\/1\/ns\/mnt \(no answer\)/,
    );
    assert.match(
      String(describeHostAccessProblem({ ...OK, ownMountNamespace: null })),
      /could not read its own mount namespace/,
    );
  });

  test("pid 1 shares the container's mount namespace: pid: host is missing", () => {
    const problem: string | null = describeHostAccessProblem({
      ...OK,
      ownMountNamespace: HOST_NAMESPACE,
      initName: "tini",
    });

    assert.strictEqual(
      problem,
      "pid 1 is this container's own init (tini), not the host's: the container was started without pid: host, so commands would run inside it. Set pid: host and recreate it.",
    );

    // Known by the engine's marker file alone, whatever pid 1 is called...
    assert.match(
      String(
        describeHostAccessProblem({
          ...OK,
          ownMountNamespace: HOST_NAMESPACE,
          initName: "my-init",
          containerRuntime: "podman",
        }),
      ),
      /without pid: host/,
    );

    // ... or by a container init's name alone, without a marker file.
    for (const initName of CONTAINER_INIT_NAMES) {
      assert.match(
        String(
          describeHostAccessProblem({
            ...OK,
            ownMountNamespace: HOST_NAMESPACE,
            initName,
            containerRuntime: null,
          }),
        ),
        /without pid: host/,
        initName,
      );
    }
  });

  test("outside any container, sharing pid 1's mount namespace is the host itself", () => {
    assert.strictEqual(
      describeHostAccessProblem({
        ...OK,
        ownMountNamespace: HOST_NAMESPACE,
        containerRuntime: null,
        initName: "systemd",
      }),
      null,
    );
  });

  test("every problem fits the posture's reachError", () => {
    const cases: Array<HostAccessFacts> = [
      { ...OK, uid: 4294967294 },
      { ...OK, hostMountNamespace: null, hostMountNamespaceError: "ENOENT" },
      { ...OK, hostMountNamespace: null, hostMountNamespaceError: "EACCES" },
      { ...OK, hostMountNamespace: null, hostMountNamespaceError: "EUNKNOWN" },
      { ...OK, ownMountNamespace: null },
      {
        ...OK,
        ownMountNamespace: HOST_NAMESPACE,
        initName: "docker-init",
      },
    ];

    for (const facts of cases) {
      const problem: string = String(describeHostAccessProblem(facts));
      assert.ok(
        problem.length <= MAX_POSTURE_STRING_LENGTH,
        `${problem.length}: ${problem}`,
      );
    }
  });
});

describe("reading /proc", () => {
  test("the parent pid of /proc/<pid>/stat, whatever the command name holds", () => {
    assert.strictEqual(
      parseProcStatParentPid("4242 (node) S 4200 4242 4242 0 -1"),
      4200,
    );
    assert.strictEqual(
      parseProcStatParentPid("77 (my (weird) prog) R 1 77 77 0"),
      1,
    );
    assert.strictEqual(parseProcStatParentPid("5 (a b) S 0 0 0"), 0);
    assert.strictEqual(parseProcStatParentPid(""), null);
    assert.strictEqual(parseProcStatParentPid("garbage"), null);
    assert.strictEqual(parseProcStatParentPid("5 (x) S notanumber"), null);
  });

  test("the executor reads the facts from the /proc it is given", () => {
    const built: Built = build({ runtime: "docker" });

    assert.deepStrictEqual(built.executor.readHostAccessFacts(), {
      uid: 0,
      hostMountNamespace: HOST_NAMESPACE,
      hostMountNamespaceError: null,
      ownMountNamespace: CONTAINER_NAMESPACE,
      containerRuntime: "docker",
      initName: "systemd",
    });
    assert.strictEqual(built.executor.getHostAccessProblem(), null);
  });

  test("a /proc without pid 1's namespace link reads as ENOENT", () => {
    const built: Built = build({ proc: { hostMountNamespace: null } });

    assert.strictEqual(
      built.executor.readHostAccessFacts().hostMountNamespaceError,
      "ENOENT",
    );
    assert.match(
      String(built.executor.getHostAccessProblem()),
      /cannot see \/proc\/1\/ns\/mnt \(ENOENT\)/,
    );
  });

  test("a failing uid reader is read as no uid, never a throw", () => {
    const built: Built = build({
      settings: {
        getuid: (): number => {
          throw new Error("no uid here");
        },
      },
    });

    assert.strictEqual(built.executor.readHostAccessFacts().uid, undefined);
    assert.strictEqual(built.executor.getHostAccessProblem(), null);
  });

  test("the container engine comes from its marker file", () => {
    assert.strictEqual(build().executor.getContainerRuntime(), null);
    assert.strictEqual(
      build({ runtime: "docker" }).executor.getContainerRuntime(),
      "docker",
    );
    assert.strictEqual(
      build({ runtime: "podman" }).executor.getContainerRuntime(),
      "podman",
    );
    assert.strictEqual(DOCKER_CONTAINER_MARKER, "/.dockerenv");
    assert.strictEqual(PODMAN_CONTAINER_MARKER, "/run/.containerenv");
  });

  test("the agent's own pid and its ancestors below pid 1", () => {
    assert.deepStrictEqual(
      build().executor.getOwnProcessIds(),
      [4242, 4200, 4100],
    );

    // A loop in a (corrupt) process tree ends.
    assert.deepStrictEqual(
      build({
        proc: { parents: { 4242: 4200, 4200: 4242 } },
      }).executor.getOwnProcessIds(),
      [4242, 4200],
    );

    // Without /proc/<pid>/stat, just the agent itself.
    assert.deepStrictEqual(
      build({ proc: { parents: {} } }).executor.getOwnProcessIds(),
      [4242],
    );

    // A very deep tree is cut.
    const deep: Record<number, number> = {};
    for (let pid: number = 5000; pid < 5100; pid++) {
      deep[pid] = pid + 1;
    }
    assert.strictEqual(
      build({
        proc: { parents: deep },
        settings: { selfPid: 5000 },
      }).executor.getOwnProcessIds().length,
      16,
    );
  });
});

// ---- What the agent protects ------------------------------------------------------

describe("protected targets", () => {
  test("OneUptime's units, the collector's, and the agent's own process tree", () => {
    assert.deepStrictEqual(
      build().executor.getProtectedTargets(),
      DEFAULT_PROTECTED,
    );
    assert.ok(
      ONEUPTIME_HOST_PROTECTED_TARGETS.includes("oneuptime-*"),
      `${HOST_AI_AGENT_UNIT} is covered`,
    );
  });

  test("under Docker, the engine the agent runs in", () => {
    assert.deepStrictEqual(
      build({ runtime: "docker" }).executor.getProtectedTargets(),
      [
        "oneuptime-*",
        "otelcol-contrib.service",
        "otelcol.service",
        ...DOCKER_RUNTIME_UNITS,
        "pid:4242",
        "pid:4200",
        "pid:4100",
      ],
    );
    // Podman's containers do not live under podman.service.
    assert.deepStrictEqual(
      build({ runtime: "podman" }).executor.getProtectedTargets(),
      DEFAULT_PROTECTED,
    );
  });

  test("plus ONEUPTIME_AI_PROTECTED_TARGETS", () => {
    assert.deepStrictEqual(
      build({
        config: {
          ONEUPTIME_AI_PROTECTED_TARGETS: "postgresql*, otelcol.service",
        },
      }).executor.getProtectedTargets(),
      [...DEFAULT_PROTECTED, "postgresql*"],
    );
  });
});

// ---- prepare(): PrepareGuard first --------------------------------------------------

describe("prepare: PrepareGuard runs first, with the real policy", () => {
  test("a read is prepared with the policy's display command and tier, and nothing runs yet", () => {
    const built: Built = build();
    const prepared: PreparedCommand = expectPrepared(
      built.executor.prepare(request("systemctl status nginx -n 50")),
    );

    assert.strictEqual(prepared.displayCommand, "systemctl status nginx -n 50");
    assert.strictEqual(prepared.tier, ResourceCommandTier.Read);
    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("a command for another host is refused", () => {
    const built: Built = build();

    expectRefused(
      built.executor.prepare(
        request("uptime", { payload: { resourceIdentifier: "db-host-2" } }),
      ),
      /^Refused by the Host AI agent: this command is for Host "db-host-2", but this agent serves "web-host-1"\. Check HOST_NAME/,
    );
    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("the identity is compared without regard to case", () => {
    expectPrepared(
      build().executor.prepare(
        request("uptime", { payload: { resourceIdentifier: "WEB-HOST-1" } }),
      ),
    );
  });

  test("a command for another resource id is refused", () => {
    expectRefused(
      build().executor.prepare(
        request("uptime", {
          agentResourceId: "0b7a9c1e-0000-4000-8000-000000000000",
        }),
      ),
      /this command is for resource id ".*", but this agent is registered for "0b7a9c1e/,
    );
  });

  test("a command for another kind of resource is refused", () => {
    expectRefused(
      build().executor.prepare(
        request("uptime", { payload: { resourceType: "DockerHost" } }),
      ),
      /this command is for a "DockerHost" resource, and this agent serves a Host/,
    );
  });

  test("a program the host kind does not run is refused", () => {
    expectRefused(
      build().executor.prepare(
        request("uptime", {
          payload: {
            program: "bash",
            args: ["-c", "id"],
            displayCommand: "bash -c id",
          },
        }),
      ),
      /"bash" is not a program the Host AI agent runs \(it runs systemctl, journalctl/,
    );
  });

  test("a path instead of a program name is refused", () => {
    expectRefused(
      build().executor.prepare(
        request("uptime", {
          payload: { program: "/usr/bin/uptime", args: [] },
        }),
      ),
      /"\/usr\/bin\/uptime" is not a program the Host AI agent runs/,
    );
  });

  test("a job that is not from OneUptime AI is refused", () => {
    expectRefused(
      build().executor.prepare(request("uptime", { origin: "Runbook" })),
      /this job came from "Runbook"/,
    );
  });

  test("a Denied command never runs, and says why", () => {
    const built: Built = build({ config: WRITES });

    expectRefused(
      built.executor.prepare(request("systemctl daemon-reload")),
      /^Refused by the Host AI agent: systemctl daemon-reload is never allowed: it reloads the service manager itself/,
    );
    expectRefused(
      built.executor.prepare(request("systemctl reboot")),
      /systemctl reboot is never allowed/,
    );
    expectRefused(
      built.executor.prepare(request("cat /etc/shadow")),
      /^Refused by the Host AI agent: .*cat takes no flags and reads only/,
    );
    expectRefused(
      built.executor.prepare(request("kill -9 1")),
      /^Refused by the Host AI agent:/,
    );
    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("a payload whose arguments the policy denies is refused", () => {
    expectRefused(
      build().executor.prepare(
        request("systemctl status nginx", {
          payload: { args: ["status", "nginx", "-n", "50000"] },
        }),
      ),
      /^Refused by the Host AI agent: -n must be a whole number from/,
    );
  });

  test("a policy that reads the arguments differently from the payload: refused", () => {
    const guardPolicy: GuardPolicy = fakePolicy({
      "uptime -p": { tier: ResourceCommandTier.Read, args: ["-s"] },
    });

    expectRefused(
      build({ guardPolicy }).executor.prepare(
        request("uptime -p", {
          payload: { args: ["-p"], displayCommand: "uptime -p", tier: "Read" },
        }),
      ),
      /its command policy reads "uptime -s" differently from OneUptime/,
    );
  });

  test("a write sent as a read is refused (the agent's tier is higher)", () => {
    expectRefused(
      build({ config: WRITES }).executor.prepare(
        request("systemctl restart nginx", {
          payload: { tier: "Read" },
          origin: "AiRemediation",
        }),
      ),
      /OneUptime sent "systemctl restart nginx" as Read, but this agent's policy reads it as SafeWrite/,
    );
  });

  test("an investigation may only read", () => {
    expectRefused(
      build({ config: WRITES }).executor.prepare(
        request("systemctl restart nginx", { origin: "AiInvestigation" }),
      ),
      /an investigation may only run read-only commands, and "systemctl restart nginx" is SafeWrite/,
    );
  });

  test("a write on a read-only agent is refused, naming the switch", () => {
    const built: Built = build();

    expectRefused(
      built.executor.prepare(request("systemctl restart nginx")),
      /^Refused by the Host AI agent: "systemctl restart nginx" changes the Host, and this agent is read-only \(ONEUPTIME_AI_ALLOW_WRITES is not set\)\. To let OneUptime AI apply fixes, set ONEUPTIME_AI_ALLOW_WRITES=true/,
    );
    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("with writes allowed, a fix to an ordinary unit is prepared", () => {
    const prepared: PreparedCommand = expectPrepared(
      build({ config: WRITES }).executor.prepare(
        request("systemctl restart nginx"),
      ),
    );

    assert.strictEqual(prepared.tier, ResourceCommandTier.SafeWrite);
    assert.strictEqual(prepared.displayCommand, "systemctl restart nginx");
  });

  test("the agent's own unit, every OneUptime unit and the collector are protected", () => {
    const built: Built = build({ config: WRITES });

    for (const [command, target, protectedBy] of [
      [
        "systemctl restart oneuptime-host-ai-agent",
        "oneuptime-host-ai-agent.service",
        "oneuptime-*",
      ],
      [
        "systemctl stop oneuptime-infrastructure-agent",
        "oneuptime-infrastructure-agent.service",
        "oneuptime-*",
      ],
      [
        "systemctl restart otelcol-contrib",
        "otelcol-contrib.service",
        "otelcol-contrib.service",
      ],
    ] as Array<[string, string, string]>) {
      expectRefused(
        built.executor.prepare(request(command)),
        new RegExp(
          `would change ${target.replace(/\./g, "\\.")}, which the Host AI agent protects \\(${protectedBy
            .replace(/\./g, "\\.")
            .replace(/\*/g, "\\*")}\\)`,
        ),
      );
    }

    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("under Docker, the engine the agent runs in is protected", () => {
    const built: Built = build({ config: WRITES, runtime: "docker" });

    expectRefused(
      built.executor.prepare(request("systemctl restart docker")),
      /would change docker\.service, which the Host AI agent protects \(docker\.service\)/,
    );
    expectRefused(
      built.executor.prepare(request("systemctl stop containerd")),
      /would change containerd\.service/,
    );

    /*
     * Not protected when the agent does not run under Docker (the policy
     * still asks a human for it).
     */
    expectPrepared(
      build({ config: WRITES }).executor.prepare(
        request("systemctl restart docker"),
      ),
    );
  });

  test("the agent's own process and its ancestors are protected; other processes are not", () => {
    const built: Built = build({ config: WRITES });

    for (const pid of [4242, 4200, 4100]) {
      expectRefused(
        built.executor.prepare(request(`kill -9 ${pid}`)),
        new RegExp(
          `would change pid:${pid}, which the Host AI agent protects \\(pid:${pid}\\)`,
        ),
      );
    }

    const prepared: PreparedCommand = expectPrepared(
      built.executor.prepare(request("kill -TERM 31337")),
    );
    assert.strictEqual(prepared.tier, ResourceCommandTier.RiskyWrite);
  });

  test("ONEUPTIME_AI_PROTECTED_TARGETS is enforced", () => {
    expectRefused(
      build({
        config: { ...WRITES, ONEUPTIME_AI_PROTECTED_TARGETS: "postgresql*" },
      }).executor.prepare(request("systemctl restart postgresql")),
      /would change postgresql\.service, which the Host AI agent protects \(postgresql\*\)/,
    );
  });

  test("ONEUPTIME_AI_WRITE_TARGETS limits what writes may touch", () => {
    const built: Built = build({
      config: { ...WRITES, ONEUPTIME_AI_WRITE_TARGETS: "nginx*,app-*.service" },
    });

    expectPrepared(built.executor.prepare(request("systemctl restart nginx")));
    expectPrepared(
      built.executor.prepare(request("systemctl restart app-worker")),
    );
    expectRefused(
      built.executor.prepare(request("systemctl restart redis")),
      /would change redis\.service, which is outside the targets the Host AI agent may change \(ONEUPTIME_AI_WRITE_TARGETS=nginx\*,app-\*\.service\)/,
    );
    // A change that names no target cannot be scoped.
    expectRefused(
      built.executor.prepare(request("systemctl reset-failed")),
      /does not name the objects it changes/,
    );
  });

  test("a read never needs the write switch, even of a protected unit", () => {
    expectPrepared(
      build().executor.prepare(
        request("systemctl status oneuptime-host-ai-agent"),
      ),
    );
  });

  test("with a fake policy, the executor's own checks still hold", () => {
    const guardPolicy: GuardPolicy = fakePolicy({
      uptime: ResourceCommandTier.Read,
    });
    const built: Built = build({
      guardPolicy,
      settings: {
        getuid: (): number => {
          return 1000;
        },
      },
    });

    expectRefused(
      built.executor.prepare(request("uptime")),
      /^Refused by the Host AI agent: this agent runs as uid 1000/,
    );
  });
});

describe("prepare: nothing runs unless pid 1 is the host's init", () => {
  test("not root: refused, and nothing is spawned", () => {
    const built: Built = build({
      settings: {
        getuid: (): number => {
          return 1000;
        },
      },
    });

    expectRefused(
      built.executor.prepare(request("uptime")),
      /^Refused by the Host AI agent: this agent runs as uid 1000, and only root can enter the host's namespaces/,
    );
    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("without pid: host (pid 1 is the container's tini): refused, never run inside the container", () => {
    const built: Built = build({
      runtime: "docker",
      proc: { ownMountNamespace: HOST_NAMESPACE, initName: "tini" },
    });

    expectRefused(
      built.executor.prepare(request("ps aux")),
      /^Refused by the Host AI agent: pid 1 is this container's own init \(tini\), not the host's: the container was started without pid: host/,
    );
    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("pid 1's namespaces not readable: refused with what to change", () => {
    class DeniedProc extends HostExecutor {
      protected override readProcLink(relativePath: string): {
        target: string | null;
        code: string | null;
      } {
        return relativePath.startsWith("1/")
          ? { target: null, code: "EACCES" }
          : super.readProcLink(relativePath);
      }
    }

    const built: Built = build();
    const executor: HostExecutor = new DeniedProc(
      {
        config: built.config,
        env: {},
        tmpDir,
        logger: built.logger,
        spawnImpl: built.nsenter.spawnImpl,
      },
      {
        procRoot: healthyProc,
        dockerMarkerFile: absentMarker,
        podmanMarkerFile: absentMarker,
        getuid: (): number => {
          return 0;
        },
        selfPid: AGENT_PID,
      },
    );

    expectRefused(
      executor.prepare(request("uptime")),
      /^Refused by the Host AI agent: this agent may not open pid 1's namespaces \(\/proc\/1\/ns\/mnt: EACCES\): run its container with privileged: true, as root/,
    );
    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("no /proc/1/ns at all (not Linux): refused", () => {
    expectRefused(
      build({ proc: { hostMountNamespace: null } }).executor.prepare(
        request("uptime"),
      ),
      /the Host AI agent only works on Linux/,
    );
  });

  test("PrepareGuard's refusal comes first", () => {
    expectRefused(
      build({
        settings: {
          getuid: (): number => {
            return 1000;
          },
        },
      }).executor.prepare(
        request("uptime", { payload: { resourceIdentifier: "db-host-2" } }),
      ),
      /this command is for Host "db-host-2"/,
    );
  });
});

// ---- run(): the command -------------------------------------------------------------

describe("run: what nsenter is started with", () => {
  test("nsenter, pid 1's namespaces, the program and its arguments, with --no-pager for systemctl", async () => {
    const built: Built = build();
    const result: ExecResult = await runCommand(
      built,
      "systemctl status nginx -n 50",
    );

    assert.deepStrictEqual(result, {
      success: true,
      exitCode: 0,
      output: "[stdout]\nran systemctl --no-pager status nginx -n 50\n",
    });
    assert.strictEqual(built.nsenter.calls.length, 1);

    const call: FakeNsenter["calls"][number] = built.nsenter.calls[0]!;
    assert.strictEqual(call.binary, NSENTER_BINARY);
    assert.deepStrictEqual(call.args, [
      "--target",
      "1",
      "--mount",
      "--uts",
      "--ipc",
      "--net",
      "--pid",
      "--",
      "systemctl",
      "--no-pager",
      "status",
      "nginx",
      "-n",
      "50",
    ]);
  });

  test("each program's argv", async () => {
    const cases: Array<[string, Array<string>, Record<string, string>?]> = [
      ["uptime", ["uptime"]],
      [
        "systemctl list-units --failed --no-pager",
        ["systemctl", "list-units", "--failed", "--no-pager"],
      ],
      [
        "journalctl -u nginx -n 200",
        ["journalctl", "--no-pager", "-u", "nginx", "-n", "200"],
      ],
      ["ps aux", ["ps", "aux"]],
      ["df -h", ["df", "-h"]],
      ["cat /proc/loadavg", ["cat", "/proc/loadavg"]],
      ["top -b -n 1", ["top", "-b", "-n", "1"]],
      ["hostnamectl", ["hostnamectl"]],
      [
        "systemctl restart -- nginx",
        ["systemctl", "--no-pager", "restart", "--", "nginx"],
        WRITES,
      ],
      ["kill -9 31337", ["kill", "-9", "31337"], WRITES],
      [
        "journalctl --vacuum-size=500M",
        ["journalctl", "--no-pager", "--vacuum-size=500M"],
        WRITES,
      ],
    ];

    for (const [command, hostArgv, config] of cases) {
      const built: Built = build(config ? { config } : {});
      const result: ExecResult = await runCommand(built, command);

      assert.strictEqual(result.success, true, command);
      assert.deepStrictEqual(built.nsenter.hostArgvs(), [hostArgv], command);
      assert.deepStrictEqual(
        built.nsenter.calls[0]!.args.slice(0, NSENTER_NAMESPACE_ARGS.length),
        [...NSENTER_NAMESPACE_ARGS],
        command,
      );
    }
  });

  test("the environment is closed: nothing of the agent's own reaches the program", async () => {
    const built: Built = build({
      env: {
        ...process.env,
        ONEUPTIME_TELEMETRY_INGESTION_KEY: "secret-key",
        HTTPS_PROXY: "http://proxy:3128",
        PATH: "/somewhere/else",
        LD_PRELOAD: "/tmp/evil.so",
      },
    });

    await runCommand(built, "uptime");

    assert.deepStrictEqual(built.nsenter.calls[0]!.env, buildHostEnvironment());
  });

  test("no shell, no stdin, a private working directory", async () => {
    const built: Built = build();
    await runCommand(built, "uptime");

    const options: Record<string, unknown> = built.nsenter.calls[0]!.options;
    assert.strictEqual(options["shell"], false);
    assert.deepStrictEqual(options["stdio"], ["ignore", "pipe", "pipe"]);
    assert.ok(
      built.nsenter.calls[0]!.cwd.startsWith(
        path.join(tmpDir, JOB_DIR_PARENT_NAME),
      ),
    );
    assert.strictEqual(
      path.basename(built.nsenter.calls[0]!.cwd),
      JOB_HOME_DIR_NAME,
    );
    // The job directory is gone once the command finished.
    assert.strictEqual(fs.existsSync(built.nsenter.calls[0]!.cwd), false);
  });

  test("the prepared command runs with the payload's arguments, never the display text", async () => {
    const built: Built = build();
    const prepared: PreparedCommand = expectPrepared(
      built.executor.prepare(
        request("ps aux", { payload: { displayCommand: "ps aux; rm -rf /" } }),
      ),
    );

    assert.strictEqual(prepared.displayCommand, "ps aux");
    await prepared.run();
    assert.deepStrictEqual(built.nsenter.hostArgvs(), [["ps", "aux"]]);
  });
});

describe("run: the output", () => {
  test("credentials on command lines never leave the agent (ps's own redaction)", async () => {
    const built: Built = build({
      responder: always({
        stdout:
          "USER PID COMMAND\nroot 812 /usr/sbin/mysqld --password=hunter2 --user=mysql\napp 77 node server.js DB_PASSWORD=topsecret\n",
      }),
    });

    const result: ExecResult = await runCommand(built, "ps aux");

    assert.strictEqual(result.success, true);
    assert.ok(!result.output.includes("hunter2"), result.output);
    assert.ok(!result.output.includes("topsecret"), result.output);
    assert.match(result.output, /--password=\[redacted\]/);
  });

  test("secrets in journal lines are masked", async () => {
    const built: Built = build({
      responder: always({
        stdout:
          "Sep 29 web nginx[1]: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def\nSep 29 web app[2]: connecting postgres://app:pa55word@db:5432/x\n",
      }),
    });

    const result: ExecResult = await runCommand(
      built,
      "journalctl -u nginx -n 20",
    );

    assert.ok(!result.output.includes("eyJhbGciOiJIUzI1NiJ9"), result.output);
    assert.ok(!result.output.includes("pa55word"), result.output);
  });

  test("stderr is kept beside stdout", async () => {
    const result: ExecResult = await runCommand(
      build({
        responder: always({
          stdout: "Filesystem Size\n",
          stderr: "df: /mnt/nfs: Stale file handle\n",
          exitCode: 1,
        }),
      }),
      "df -h",
    );

    assert.strictEqual(
      result.output,
      "[stdout]\nFilesystem Size\n\n[stderr]\ndf: /mnt/nfs: Stale file handle\n",
    );
  });

  test("NUL characters are replaced", async () => {
    const result: ExecResult = await runCommand(
      build({ responder: always({ stdout: "a\u0000b\n" }) }),
      "uptime",
    );

    assert.strictEqual(result.output, `[stdout]\na${NUL_REPLACEMENT}b\n`);
  });
});

describe("run: failures and what to change", () => {
  test("a program that is not installed on the host: never ran (no exit code)", async () => {
    const result: ExecResult = await runCommand(
      build({ responder: always(execFailure("systemctl")) }),
      "systemctl list-units --failed",
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(
      result.errorMessage,
      "systemctl is not installed on this host (nsenter found no systemctl on the host's PATH, /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin), so this host does not seem to run systemd; the command never ran.",
    );
    assert.match(result.output, /nsenter: failed to execute systemctl/);
  });

  test("a missing non-systemd program says only that", async () => {
    const result: ExecResult = await runCommand(
      build({ responder: always(execFailure("ss")) }),
      "ss -tlnp",
    );

    assert.strictEqual(
      result.errorMessage,
      "ss is not installed on this host (nsenter found no ss on the host's PATH, /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin); the command never ran.",
    );
  });

  test("nsenter may not enter the namespaces: privileged, pid: host, root", async () => {
    for (const stderr of [
      "nsenter: cannot open /proc/1/ns/ipc: Permission denied\n",
      "nsenter: reassociate to namespace 'ns/mnt' failed: Operation not permitted\n",
    ]) {
      const result: ExecResult = await runCommand(
        build({ responder: always({ stderr, exitCode: 1 }) }),
        "uptime",
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, undefined, stderr);
      assert.match(
        String(result.errorMessage),
        /^nsenter could not enter the host's namespaces \(nsenter: .*\): run the agent's container with privileged: true, pid: host and user "0:0", on a rootful Docker or Podman engine; the command never ran\.$/,
      );
    }
  });

  test("the host program's own failures keep their exit code", async () => {
    const result: ExecResult = await runCommand(
      build({
        responder: always({
          stderr: "free: bad option\n",
          exitCode: 2,
        }),
      }),
      "free -h",
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "[stderr]\nfree: bad option\n",
      exitCode: 2,
      errorMessage: "Exit code 2: free: bad option",
    });
  });

  test("systemctl is-active answers with its exit code: explained, not an error", async () => {
    const result: ExecResult = await runCommand(
      build({ responder: always({ stdout: "inactive\n", exitCode: 3 }) }),
      "systemctl is-active nginx",
    );

    assert.strictEqual(result.exitCode, 3);
    assert.strictEqual(
      result.errorMessage,
      'Exit code 3. systemctl is-active answers with its exit code: non-zero means "no", and the output says the state. It is an answer, not an error.',
    );
  });

  test("systemctl status of an inactive unit exits 3", async () => {
    const result: ExecResult = await runCommand(
      build({
        responder: always({
          stdout:
            "○ nginx.service - A high performance web server\n     Active: inactive (dead)\n",
          exitCode: 3,
        }),
      }),
      "systemctl status nginx",
    );

    assert.match(
      String(result.errorMessage),
      /^Exit code 3\. systemctl status exits 3 when a unit is not active/,
    );
  });

  test("a unit that does not exist", async () => {
    const result: ExecResult = await runCommand(
      build({
        responder: always({
          stderr: "Unit ngnix.service could not be found.\n",
          exitCode: 4,
        }),
      }),
      "systemctl status ngnix",
    );

    assert.strictEqual(
      result.errorMessage,
      "Exit code 4: Unit ngnix.service could not be found. No unit of that name is loaded on this host: find its exact name with systemctl list-units --all 'NAME*'.",
    );
  });

  test("a restart whose unit fails: where to read why", async () => {
    const result: ExecResult = await runCommand(
      build({
        config: WRITES,
        responder: always({
          stderr:
            'Job for nginx.service failed because the control process exited with error code.\nSee "systemctl status nginx.service" and "journalctl -xeu nginx.service" for details.\n',
          exitCode: 1,
        }),
      }),
      "systemctl restart nginx",
    );

    assert.match(
      String(result.errorMessage),
      /The unit failed to start: read why with systemctl status nginx\.service -n 50 and journalctl -u nginx\.service -n 200\.$/,
    );
  });

  test("a host without systemd as init", async () => {
    const result: ExecResult = await runCommand(
      build({
        responder: always({
          stderr:
            "System has not been booted with systemd as init system (PID 1). Can't operate.\nFailed to connect to bus: Host is down\n",
          exitCode: 1,
        }),
      }),
      "systemctl list-units --failed",
    );

    assert.match(
      String(result.errorMessage),
      /systemctl cannot reach systemd on this host/,
    );
  });

  test("kill of a process that is gone", async () => {
    const result: ExecResult = await runCommand(
      build({
        config: WRITES,
        responder: always({
          stderr: "kill: (31337): No such process\n",
          exitCode: 1,
        }),
      }),
      "kill 31337",
    );

    assert.match(
      String(result.errorMessage),
      /The process is already gone \(or the pid is wrong\): check with ps -p 31337\.$/,
    );
  });

  test("nsenter is not in the container: which image carries it", async () => {
    const result: ExecResult = await runCommand(
      build({ responder: always({ errorCode: "ENOENT" }) }),
      "uptime",
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage:
        "nsenter is not installed in this container (/usr/bin/nsenter was not found). Use the oneuptime/resource-ai-agent image, which includes it.",
    });
  });

  test("nsenter cannot be started", async () => {
    const result: ExecResult = await runCommand(
      build({ responder: always({ errorCode: "EACCES" }) }),
      "uptime",
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage: "Could not start nsenter: spawn /usr/bin/nsenter EACCES",
    });
  });

  test("spawn throwing is a failure, never a throw", async () => {
    const result: ExecResult = await runCommand(
      build({ responder: always({ throwCode: "EAGAIN" }) }),
      "uptime",
    );

    assert.strictEqual(result.success, false);
    assert.match(
      String(result.errorMessage),
      /^Could not start nsenter: .*EAGAIN/,
    );
  });

  test("no private directory: the command never starts, and says why", async () => {
    const notADir: string = path.join(markersDir, "dockerenv");
    const built: Built = build({ tmpDir: notADir });
    const result: ExecResult = await runCommand(built, "uptime");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.match(
      String(result.errorMessage),
      /^Could not prepare a private directory for "uptime": .*\. The agent needs a writable \/tmp/,
    );
    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("a program killed by a signal", async () => {
    const result: ExecResult = await runCommand(
      build({ responder: always({ signal: "SIGSEGV" }) }),
      "uptime",
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage: "uptime was terminated by SIGSEGV",
    });
  });
});

describe("run: the time budget", () => {
  test("a silent program is killed, with what silence means for it", async () => {
    const cases: Array<[string, string, Record<string, string>?]> = [
      [
        "uptime",
        "Killed (timeout 50ms): uptime produced no output at all, so the host did not answer in time: it may be overloaded, or uptime is blocked.",
      ],
      [
        "df -h",
        "Killed (timeout 50ms): df produced no output at all, so df blocks on a filesystem that does not answer (a hung NFS or CIFS mount): df -l reads local filesystems only.",
      ],
      [
        "journalctl -u nginx -n 200",
        "Killed (timeout 50ms): journalctl produced no output at all, so journalctl was still reading the journal: narrow it with -u UNIT, a smaller -n or a later --since.",
      ],
      [
        "systemctl list-units",
        "Killed (timeout 50ms): systemctl produced no output at all, so systemd did not answer: the service manager may be busy or hung (systemctl list-jobs shows what it is doing).",
      ],
      [
        "systemctl restart nginx",
        "Killed (timeout 50ms): systemctl was still waiting for systemd to finish the job, and systemd carries on with it: check systemctl status nginx.service to see how it ended.",
        WRITES,
      ],
    ];

    for (const [command, message, config] of cases) {
      const built: Built = build({
        responder: always({ hang: true }),
        ...(config ? { config } : {}),
      });
      const result: ExecResult = await runCommand(built, command, {
        timeoutInMs: 50,
      });

      assert.strictEqual(result.success, false, command);
      assert.strictEqual(result.exitCode, undefined, command);
      assert.strictEqual(result.errorMessage, message, command);
      assert.deepStrictEqual(built.nsenter.children[0]!.killed, ["SIGKILL"]);
    }
  });

  test("a systemctl change that printed something before the kill still says systemd carries on", async () => {
    const result: ExecResult = await runCommand(
      build({
        config: WRITES,
        responder: always({ stderr: "Warning: something\n", hang: true }),
      }),
      "systemctl restart nginx",
      { timeoutInMs: 50 },
    );

    assert.strictEqual(
      result.errorMessage,
      "Killed (timeout 50ms): systemctl was still waiting for systemd to finish the job, and systemd carries on with it: check systemctl status nginx.service to see how it ended.",
    );
    assert.match(result.output, /Warning: something/);
  });

  test("a read that printed something before the kill: just the kill", async () => {
    const result: ExecResult = await runCommand(
      build({ responder: always({ stdout: "partial\n", hang: true }) }),
      "journalctl -u nginx -n 200",
      { timeoutInMs: 50 },
    );

    assert.strictEqual(result.errorMessage, "Killed (timeout 50ms)");
    assert.strictEqual(result.output, "[stdout]\npartial\n");
  });
});

// ---- Explaining failures (pure) -------------------------------------------------------

describe("describeNsenterFailure", () => {
  test("only nsenter's own complaint counts, and only when the program printed nothing", () => {
    assert.strictEqual(
      describeNsenterFailure({
        program: "systemctl",
        exitCode: 1,
        stdout: "",
        stderr: "Failed to connect to bus\n",
      }),
      null,
    );
    assert.strictEqual(
      describeNsenterFailure({
        program: "journalctl",
        exitCode: 1,
        stdout: "some journal line\n",
        stderr:
          "nsenter: failed to execute journalctl: No such file or directory\n",
      }),
      null,
    );
    assert.strictEqual(
      describeNsenterFailure({
        program: "journalctl",
        exitCode: 3,
        stdout: "",
        stderr:
          "nsenter: failed to execute journalctl: No such file or directory\n",
      }),
      null,
      "an exit code nsenter does not use",
    );
    assert.strictEqual(
      describeNsenterFailure({
        program: "uptime",
        exitCode: null,
        stdout: "",
        stderr: "nsenter: x\n",
      }),
      null,
    );
  });

  test("busybox's wording of an exec failure reads the same", () => {
    assert.match(
      String(
        describeNsenterFailure({
          program: "systemctl",
          exitCode: 127,
          stdout: "",
          stderr:
            "nsenter: can't execute 'systemctl': No such file or directory\n",
        }),
      ),
      /^systemctl is not installed on this host .*, so this host does not seem to run systemd$/,
    );
  });

  test("exec failures and namespace failures", () => {
    assert.match(
      String(
        describeNsenterFailure({
          program: "top",
          exitCode: 126,
          stdout: "",
          stderr: "nsenter: failed to execute top: Permission denied\n",
        }),
      ),
      /^top could not be started on the host \(Permission denied\)$/,
    );
    assert.match(
      String(
        describeNsenterFailure({
          program: "uptime",
          exitCode: 1,
          stdout: "",
          stderr:
            "nsenter: cannot open /proc/1/ns/mnt: No such file or directory\n",
        }),
      ),
      /^nsenter could not find the host's namespaces/,
    );
    assert.match(
      String(
        describeNsenterFailure({
          program: "uptime",
          exitCode: 1,
          stdout: "",
          stderr: "nsenter: something new\n",
        }),
      ),
      /^nsenter failed before uptime ran \(nsenter: something new\)$/,
    );
  });

  test("a very long complaint is shortened", () => {
    const message: string = String(
      describeNsenterFailure({
        program: "uptime",
        exitCode: 1,
        stdout: "",
        stderr: `nsenter: ${"x".repeat(1000)}\n`,
      }),
    );

    assert.ok(message.length < 300, `${message.length}`);
  });
});

describe("describeHostCommandFailure and describeHostSilence", () => {
  test("hints for the host's usual answers", () => {
    assert.match(
      String(
        describeHostCommandFailure({
          program: "systemctl",
          verb: "restart",
          exitCode: 1,
          stderr: "Failed to restart nginx.service: Access denied\n",
          targets: ["nginx.service"],
        }),
      ),
      /^systemd refused the request/,
    );
    assert.match(
      String(
        describeHostCommandFailure({
          program: "systemctl",
          verb: "restart",
          exitCode: 5,
          stderr:
            "Failed to restart foo.service: Unit foo.service not found.\n",
        }),
      ),
      /^No unit of that name is loaded/,
    );
    assert.match(
      String(
        describeHostCommandFailure({
          program: "systemctl",
          verb: "reload",
          exitCode: 1,
          stderr: "Job for nginx.service failed.\n",
        }),
      ),
      /^The unit failed to reload: read why with systemctl status UNIT/,
    );
    assert.match(
      String(
        describeHostCommandFailure({
          program: "systemctl",
          verb: "status",
          exitCode: 4,
          stderr: "",
        }),
      ),
      /^No unit of that name is loaded/,
    );
    assert.match(
      String(
        describeHostCommandFailure({
          program: "journalctl",
          verb: "logs",
          exitCode: 1,
          stderr: "No journal files were found.\n",
        }),
      ),
      /keeps no systemd journal/,
    );
    assert.match(
      String(
        describeHostCommandFailure({
          program: "kill",
          verb: "kill",
          exitCode: 1,
          stderr: "kill: (2): Operation not permitted\n",
          targets: ["pid:2"],
        }),
      ),
      /refused to signal/,
    );
    assert.match(
      String(
        describeHostCommandFailure({
          program: "df",
          verb: "df",
          exitCode: 1,
          stderr: "",
        }),
      ),
      /df exits 1 when it cannot read one of the filesystems/,
    );
    assert.match(
      String(
        describeHostCommandFailure({
          program: "dmesg",
          verb: "dmesg",
          exitCode: 1,
          stderr: "dmesg: read kernel buffer failed: Permission denied\n",
        }),
      ),
      /^dmesg was denied access on the host/,
    );
  });

  test("nothing to add for an ordinary failure", () => {
    assert.strictEqual(
      describeHostCommandFailure({
        program: "free",
        verb: "free",
        exitCode: 2,
        stderr: "free: bad option\n",
      }),
      null,
    );
    assert.strictEqual(
      describeHostCommandFailure({
        program: "systemctl",
        verb: "list-units",
        exitCode: 1,
        stderr: "",
      }),
      null,
    );
  });

  test("silence hints name the unit a change was waiting for", () => {
    assert.match(
      describeHostSilence({
        program: "systemctl",
        verb: "stop",
        targets: ["redis.service"],
      }),
      /check systemctl status redis\.service/,
    );
    assert.match(
      describeHostSilence({ program: "systemctl", verb: "reset-failed" }),
      /check systemctl status UNIT/,
    );
    assert.match(
      describeHostSilence({ program: "ss", verb: "ss" }),
      /or ss is blocked$/,
    );
  });
});

// ---- Parsing (pure) -----------------------------------------------------------------------

describe("parsing what the host prints", () => {
  test("systemctl --version", () => {
    assert.deepStrictEqual(parseSystemdVersion(SYSTEMD_VERSION_OUTPUT), {
      major: "255",
      build: "255.4-1ubuntu8.4",
    });
    assert.deepStrictEqual(
      parseSystemdVersion("systemd 256 (256.11-1.fc41)\n+PAM"),
      {
        major: "256",
        build: "256.11-1.fc41",
      },
    );
    assert.deepStrictEqual(parseSystemdVersion("systemd 219\n+PAM"), {
      major: "219",
      build: null,
    });
    assert.strictEqual(parseSystemdVersion(""), null);
    assert.strictEqual(parseSystemdVersion("upstart 1.13"), null);
  });

  test("os-release", () => {
    assert.strictEqual(
      parseOsReleasePrettyName(
        'NAME="Debian"\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n',
      ),
      "Debian GNU/Linux 12 (bookworm)",
    );
    assert.strictEqual(
      parseOsReleasePrettyName("PRETTY_NAME='Alpine Linux v3.20'"),
      "Alpine Linux v3.20",
    );
    assert.strictEqual(parseOsReleasePrettyName("PRETTY_NAME=Arch"), "Arch");
    assert.strictEqual(parseOsReleasePrettyName('PRETTY_NAME=""'), null);
    assert.strictEqual(parseOsReleasePrettyName("NAME=x"), null);
  });

  test("hostname", () => {
    assert.strictEqual(parseHostnameOutput("web-host-1\n"), "web-host-1");
    assert.strictEqual(
      parseHostnameOutput("\n  db.example.com  \n"),
      "db.example.com",
    );
    assert.strictEqual(parseHostnameOutput(""), null);
    assert.strictEqual(parseHostnameOutput("(none)\n"), null);
    assert.strictEqual(parseHostnameOutput("two words\n"), null);
    assert.strictEqual(parseHostnameOutput("héte\n"), null);
  });

  test("the tool version", () => {
    assert.strictEqual(
      formatHostToolVersion({
        kernel: "Linux 6.8.0-45-generic",
        systemd: { major: "255", build: "255.4" },
        systemdMissing: false,
      }),
      "Linux 6.8.0-45-generic / systemd 255",
    );
    assert.strictEqual(
      formatHostToolVersion({
        kernel: "Linux 6.1.0",
        systemd: null,
        systemdMissing: true,
      }),
      "Linux 6.1.0 / no systemd",
    );
    assert.strictEqual(
      formatHostToolVersion({
        kernel: "Linux 6.1.0",
        systemd: null,
        systemdMissing: false,
      }),
      "Linux 6.1.0",
    );
  });
});

// ---- The posture --------------------------------------------------------------------------

describe("probePosture", () => {
  test("a healthy host: kernel and systemd versions, its hostname and OS, and what it protects", async () => {
    const built: Built = build({ runtime: "docker" });
    const probe: ResourcePostureProbe = await built.executor.probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: "Linux 6.8.0-45-generic / systemd 255",
      reachable: true,
      reachError: null,
      details: {
        containerRuntime: "docker",
        kernel: "Linux 6.8.0-45-generic",
        systemd: true,
        systemdVersion: "255.4-1ubuntu8.4",
        hostname: HOST,
        hostnameMatchesIdentity: true,
        os: "Ubuntu 24.04.1 LTS",
      },
      protectedTargets: [
        "oneuptime-*",
        "otelcol-contrib.service",
        "otelcol.service",
        "docker.service",
        "docker.socket",
        "containerd.service",
        "pid:4242",
        "pid:4200",
        "pid:4100",
      ],
    });

    assert.deepStrictEqual(
      built.nsenter
        .hostArgvs()
        .map((argv: Array<string>): string => {
          return argv.join(" ");
        })
        .sort(),
      ["hostname", "systemctl --no-pager --version", "uname -sr"],
    );

    for (const call of built.nsenter.calls) {
      assert.strictEqual(call.binary, NSENTER_BINARY);
      assert.deepStrictEqual(
        call.args.slice(0, NSENTER_NAMESPACE_ARGS.length),
        [...NSENTER_NAMESPACE_ARGS],
      );
      assert.deepStrictEqual(call.env, buildHostEnvironment());
    }

    // uname runs first: nothing else starts until nsenter is known to work.
    assert.deepStrictEqual(built.nsenter.calls[0]!.hostArgv, ["uname", "-sr"]);
  });

  test("a host without systemd is still reachable", async () => {
    const probe: ResourcePostureProbe = await build({
      responder: replies({
        "systemctl --no-pager --version": execFailure("systemctl"),
      }),
      proc: { osRelease: 'PRETTY_NAME="Alpine Linux v3.20"\n' },
    }).executor.probePosture();

    assert.strictEqual(probe.reachable, true);
    assert.strictEqual(
      probe.toolVersion,
      "Linux 6.8.0-45-generic / no systemd",
    );
    assert.strictEqual(probe.details!["systemd"], false);
    assert.strictEqual(probe.details!["systemdVersion"], undefined);
    assert.strictEqual(probe.details!["os"], "Alpine Linux v3.20");
  });

  test("systemctl that does not answer: systemd unknown, the kernel alone", async () => {
    const probe: ResourcePostureProbe = await build({
      responder: replies({
        "systemctl --no-pager --version": { hang: true },
      }),
      settings: { probeTimeoutMs: 50 },
    }).executor.probePosture();

    assert.strictEqual(probe.reachable, true);
    assert.strictEqual(probe.toolVersion, "Linux 6.8.0-45-generic");
    assert.strictEqual(probe.details!["systemd"], null);
  });

  test("a host without the hostname program: uname -n instead", async () => {
    const built: Built = build({
      responder: replies({ hostname: execFailure("hostname") }),
    });
    const probe: ResourcePostureProbe = await built.executor.probePosture();

    assert.strictEqual(probe.details!["hostname"], HOST);
    assert.ok(
      built.nsenter.hostArgvs().some((argv: Array<string>): boolean => {
        return argv.join(" ") === "uname -n";
      }),
    );
  });

  test("HOST_NAME that is not the hostname: said once, and reported", async () => {
    const built: Built = build({
      responder: healthyHost("ip-10-0-0-7"),
    });

    const first: ResourcePostureProbe = await built.executor.probePosture();
    await built.executor.probePosture();

    assert.strictEqual(first.details!["hostname"], "ip-10-0-0-7");
    assert.strictEqual(first.details!["hostnameMatchesIdentity"], false);
    const notes: Array<string> = built.logger.records
      .filter((record: { level: string; message: string }): boolean => {
        return record.level === "info";
      })
      .map((record: { level: string; message: string }): string => {
        return record.message;
      });
    assert.deepStrictEqual(notes, [
      'This agent serves the Host "web-host-1" (HOST_NAME), and this host\'s hostname is "ip-10-0-0-7". That is right only if the OpenTelemetry collector reports host.name "web-host-1" too; otherwise set HOST_NAME to the host.name the collector reports.',
    ]);
  });

  test("the hostname is compared without regard to case", async () => {
    const probe: ResourcePostureProbe = await build({
      responder: healthyHost("WEB-HOST-1"),
    }).executor.probePosture();

    assert.strictEqual(probe.details!["hostnameMatchesIdentity"], true);
  });

  test("not root: unreachable with what to change, and nothing spawned", async () => {
    const built: Built = build({
      settings: {
        getuid: (): number => {
          return 1000;
        },
      },
    });
    const probe: ResourcePostureProbe = await built.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(probe.toolVersion, null);
    assert.strictEqual(
      probe.reachError,
      'This agent runs as uid 1000, and only root can enter the host\'s namespaces: run its container as root (user: "0:0") with privileged: true and pid: host.',
    );
    assert.deepStrictEqual(probe.protectedTargets, DEFAULT_PROTECTED);
    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("without pid: host: unreachable, never probing the container itself", async () => {
    const built: Built = build({
      runtime: "docker",
      proc: { ownMountNamespace: HOST_NAMESPACE, initName: "tini" },
    });
    const probe: ResourcePostureProbe = await built.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /^Pid 1 is this container's own init \(tini\), not the host's: the container was started without pid: host/,
    );
    assert.deepStrictEqual(probe.details, { containerRuntime: "docker" });
    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("nsenter missing from the container", async () => {
    const probe: ResourcePostureProbe = await build({
      responder: always({ errorCode: "ENOENT" }),
    }).executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(
      probe.reachError,
      "nsenter is not installed in this container (/usr/bin/nsenter was not found). Use the oneuptime/resource-ai-agent image, which includes it.",
    );
  });

  test("nsenter may not enter the namespaces", async () => {
    const built: Built = build({
      responder: always({
        stderr:
          "nsenter: reassociate to namespace 'ns/ipc' failed: Operation not permitted\n",
        exitCode: 1,
      }),
    });
    const probe: ResourcePostureProbe = await built.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /^nsenter could not enter the host's namespaces \(nsenter: reassociate to namespace 'ns\/ipc' failed: Operation not permitted\): run the agent's container with privileged: true, pid: host and user "0:0", on a rootful Docker or Podman engine\.$/,
    );
    // Nothing else is tried once nsenter fails.
    assert.strictEqual(built.nsenter.calls.length, 1);
  });

  test("a host that does not answer uname", async () => {
    const probe: ResourcePostureProbe = await build({
      responder: always({ hang: true }),
      settings: { probeTimeoutMs: 50 },
    }).executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(
      probe.reachError,
      "The host did not answer uname -sr within 50ms: it may be overloaded.",
    );
  });

  test("uname failing on the host says what it said", async () => {
    const probe: ResourcePostureProbe = await build({
      responder: replies({
        "uname -sr": { stderr: "uname: something broke\n", exitCode: 1 },
      }),
    }).executor.probePosture();

    assert.strictEqual(
      probe.reachError,
      "uname -sr failed on the host (exit code 1: uname: something broke).",
    );
  });

  test("probePosture never throws", async () => {
    class Broken extends HostExecutor {
      public override getOwnProcessIds(): Array<number> {
        throw new Error("proc exploded");
      }
    }

    const built: Built = build();
    const executor: Broken = new Broken(
      {
        config: built.config,
        env: {},
        tmpDir,
        logger: built.logger,
        spawnImpl: built.nsenter.spawnImpl,
      },
      {
        procRoot: healthyProc,
        dockerMarkerFile: absentMarker,
        podmanMarkerFile: absentMarker,
        getuid: (): number => {
          return 0;
        },
      },
    );

    const probe: ResourcePostureProbe = await executor.probePosture();
    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(
      probe.reachError,
      "Checking the host failed: proc exploded",
    );
    assert.deepStrictEqual(probe.protectedTargets, [
      "oneuptime-*",
      "otelcol-contrib.service",
      "otelcol.service",
    ]);

    // prepare() falls back to the fixed list too, and still runs PrepareGuard.
    expectRefused(
      executor.prepare(
        request("systemctl restart oneuptime-host-ai-agent", {
          origin: "AiRemediation",
        }),
      ),
      /read-only/,
    );
  });

  test("every unreachable reason fits the posture", async () => {
    const responders: Array<HostResponder> = [
      always({ errorCode: "ENOENT" }),
      always({ errorCode: "EACCES" }),
      always({
        stderr: `nsenter: cannot open /proc/1/ns/ipc: ${"Permission denied ".repeat(40)}\n`,
        exitCode: 1,
      }),
      always({ stderr: `uname: ${"x".repeat(2000)}\n`, exitCode: 1 }),
      always(execFailure("uname")),
    ];

    for (const responder of responders) {
      const probe: ResourcePostureProbe = await build({
        responder,
      }).executor.probePosture();

      assert.strictEqual(probe.reachable, false);
      assert.ok(
        String(probe.reachError).length <= MAX_POSTURE_STRING_LENGTH,
        `${String(probe.reachError).length}: ${probe.reachError}`,
      );
    }
  });

  test("the probe's budget fits the posture's", () => {
    // uname, then systemctl and hostname together, then uname -n.
    assert.ok(PROBE_TIMEOUT_MS * 3 < 15_000);
  });
});

// ---- The identity -------------------------------------------------------------------------

describe("resolveResourceIdentifier", () => {
  test("HOST_NAME in the environment wins, and nothing runs", async () => {
    const built: Built = build({ env: { HOST_NAME: "  web-host-9  " } });

    assert.strictEqual(
      await built.executor.resolveResourceIdentifier(),
      "web-host-9",
    );
    assert.deepStrictEqual(built.nsenter.calls, []);
  });

  test("otherwise the host's own hostname, read in its UTS namespace", async () => {
    const built: Built = build({
      config: { HOST_NAME: "" },
      responder: healthyHost("node-17.example.com"),
    });

    assert.strictEqual(
      await built.executor.resolveResourceIdentifier(),
      "node-17.example.com",
    );
    assert.deepStrictEqual(built.nsenter.hostArgvs(), [["hostname"]]);
    assert.deepStrictEqual(built.nsenter.calls[0]!.args, [
      ...NSENTER_NAMESPACE_ARGS,
      "hostname",
    ]);
  });

  test("uname -n where the hostname program is missing", async () => {
    const built: Built = build({
      config: { HOST_NAME: "" },
      responder: (argv: Array<string>): FakeHostReply => {
        return argv[0] === "hostname"
          ? execFailure("hostname")
          : { stdout: "minimal-host\n" };
      },
    });

    assert.strictEqual(
      await built.executor.resolveResourceIdentifier(),
      "minimal-host",
    );
    assert.deepStrictEqual(built.nsenter.hostArgvs(), [
      ["hostname"],
      ["uname", "-n"],
    ]);
  });

  test("a host whose hostname was never set has no name", async () => {
    const built: Built = build({
      config: { HOST_NAME: "" },
      responder: always({ stdout: "(none)\n" }),
    });

    assert.strictEqual(await built.executor.resolveResourceIdentifier(), null);
    assert.match(
      built.logger.records[built.logger.records.length - 1]!.message,
      /^Could not read the host's hostname: the host has no usable hostname \(uname -n printed "\(none\)"\)/,
    );
  });

  test("not reaching the host: null, with the reason logged, and nothing spawned", async () => {
    const built: Built = build({
      config: { HOST_NAME: "" },
      settings: {
        getuid: (): number => {
          return 1000;
        },
      },
    });

    assert.strictEqual(await built.executor.resolveResourceIdentifier(), null);
    assert.deepStrictEqual(built.nsenter.calls, []);
    assert.deepStrictEqual(built.logger.records, [
      {
        level: "warn",
        message:
          "Could not read the host's hostname: this agent runs as uid 1000, and only root can enter the host's namespaces: run its container as root (user: \"0:0\") with privileged: true and pid: host.",
      },
    ]);
  });

  test("nsenter failing: null, without trying uname", async () => {
    const built: Built = build({
      config: { HOST_NAME: "" },
      responder: always({
        stderr: "nsenter: cannot open /proc/1/ns/uts: Permission denied\n",
        exitCode: 1,
      }),
    });

    assert.strictEqual(await built.executor.resolveResourceIdentifier(), null);
    assert.deepStrictEqual(built.nsenter.hostArgvs(), [["hostname"]]);
    assert.match(
      built.logger.records[0]!.message,
      /^Could not read the host's hostname: nsenter could not enter the host's namespaces/,
    );
  });

  test("a name every host could have is used, with a warning", async () => {
    const built: Built = build({
      config: { HOST_NAME: "" },
      responder: healthyHost("localhost"),
    });

    assert.strictEqual(
      await built.executor.resolveResourceIdentifier(),
      "localhost",
    );
    assert.match(
      built.logger.records[0]!.message,
      /^This host's hostname is "localhost", a name every unconfigured host shares/,
    );
  });

  test("never throws", async () => {
    const built: Built = build({
      config: { HOST_NAME: "" },
      responder: always({ throwCode: "EMFILE" }),
    });

    assert.strictEqual(await built.executor.resolveResourceIdentifier(), null);
  });
});

// ---- Real processes -----------------------------------------------------------------------

describe("run with a real process standing in for nsenter", () => {
  let binary: FakeBinary;

  before((): void => {
    binary = new FakeBinary("nsenter");
  });

  after((): void => {
    binary.cleanup();
  });

  afterEach((): void => {
    binary.clearInvocations();
    binary.setBehaviour({});
  });

  function real(data: BuildData = {}): Built {
    return build({
      ...data,
      realSpawn: true,
      settings: { nsenterBinary: binary.binary, ...(data.settings || {}) },
    });
  }

  function onlyInvocation(): FakeBinaryInvocation {
    const invocations: Array<FakeBinaryInvocation> = binary.getInvocations();
    assert.strictEqual(invocations.length, 1, "nsenter ran exactly once");
    return invocations[0]!;
  }

  test("the program gets exactly the closed environment and the argv", async () => {
    const previous: string | undefined = process.env["ONEUPTIME_API_KEY"];
    process.env["ONEUPTIME_API_KEY"] = "must-never-reach-the-host";

    try {
      await runCommand(
        real({
          env: {
            ...process.env,
            HOST_NAME: HOST,
            HTTPS_PROXY: "http://proxy:3128",
          },
        }),
        "journalctl -u nginx -n 200",
      );
    } finally {
      if (previous === undefined) {
        delete process.env["ONEUPTIME_API_KEY"];
      } else {
        process.env["ONEUPTIME_API_KEY"] = previous;
      }
    }

    const invocation: FakeBinaryInvocation = onlyInvocation();
    assert.deepStrictEqual(invocation.argv, [
      "--target",
      "1",
      "--mount",
      "--uts",
      "--ipc",
      "--net",
      "--pid",
      "--",
      "journalctl",
      "--no-pager",
      "-u",
      "nginx",
      "-n",
      "200",
    ]);
    assert.deepStrictEqual(invocation.env, buildHostEnvironment());
    assert.strictEqual(invocation.homeExists, false);
    assert.strictEqual(invocation.cwdMode, 0o700);
    assert.strictEqual(invocation.parentMode, 0o700);
  });

  test("stdout is capped, and says so", async () => {
    binary.setBehaviour({ stdoutBytes: MAX_OUTPUT_BYTES * 2 });

    const result: ExecResult = await runCommand(real(), "ps aux");

    assert.strictEqual(result.success, true);
    assert.match(
      result.output,
      /\.\.\. \[output truncated: stdout cut at \d+ bytes\]$/,
    );
    assert.ok(
      Buffer.byteLength(result.output, "utf8") < MAX_OUTPUT_BYTES + 200,
      `${Buffer.byteLength(result.output, "utf8")} bytes`,
    );
  });

  test("a failing program: its exit code and its reason", async () => {
    binary.setBehaviour({ stderr: "free: bad option\n", exitCode: 2 });

    const result: ExecResult = await runCommand(real(), "free -h");

    assert.deepStrictEqual(result, {
      success: false,
      output: "[stderr]\nfree: bad option\n",
      exitCode: 2,
      errorMessage: "Exit code 2: free: bad option",
    });
  });

  test("nsenter's exec failure (exit 127): never ran", async () => {
    binary.setBehaviour({
      stderr: "nsenter: failed to execute lsblk: No such file or directory\n",
      exitCode: 127,
    });

    const result: ExecResult = await runCommand(real(), "lsblk");

    assert.strictEqual(result.exitCode, undefined);
    assert.match(
      String(result.errorMessage),
      /^lsblk is not installed on this host/,
    );
  });

  test("a hung program is killed at the time budget, whatever it forked", async () => {
    binary.setBehaviour({ orphanSleepMs: 20_000, sleepMs: 20_000 });
    const started: number = Date.now();

    const result: ExecResult = await runCommand(real(), "uptime", {
      timeoutInMs: 300,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(
      result.errorMessage,
      "Killed (timeout 300ms): uptime produced no output at all, so the host did not answer in time: it may be overloaded, or uptime is blocked.",
    );
    assert.ok(Date.now() - started < 5_000, "it did not wait for the program");
  });

  test("the posture probe through a real process", async () => {
    binary.setBehaviour({ stdout: "box-7\n" });

    // Real processes: a budget a loaded machine cannot miss.
    const probe: ResourcePostureProbe = await real({
      settings: { probeTimeoutMs: 30_000 },
    }).executor.probePosture();

    // The same stand-in answers every probe command with the same line.
    assert.strictEqual(probe.reachable, true);
    assert.strictEqual(probe.toolVersion, "box-7");
    assert.strictEqual(probe.details!["kernel"], "box-7");
    assert.strictEqual(probe.details!["systemd"], null);
    assert.strictEqual(probe.details!["hostname"], "box-7");
    assert.strictEqual(probe.details!["hostnameMatchesIdentity"], false);
    assert.deepStrictEqual(
      binary
        .getInvocations()
        .map((invocation: FakeBinaryInvocation): string => {
          return invocation.argv.slice(NSENTER_NAMESPACE_ARGS.length).join(" ");
        })
        .sort(),
      ["hostname", "systemctl --no-pager --version", "uname -sr"],
    );
    for (const invocation of binary.getInvocations()) {
      assert.deepStrictEqual(invocation.env, buildHostEnvironment());
    }
  });

  test("a missing nsenter says which image carries it", async () => {
    const result: ExecResult = await runCommand(
      real({
        settings: { nsenterBinary: path.join(binary.dir, "no-such-nsenter") },
      }),
      "uptime",
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage: `nsenter is not installed in this container (${path.join(
        binary.dir,
        "no-such-nsenter",
      )} was not found). Use the oneuptime/resource-ai-agent image, which includes it.`,
    });
  });
});

// ---- The factory and the job directories --------------------------------------------------

describe("the factory and the job directories", () => {
  test("a Host agent gets a HostExecutor", () => {
    assert.strictEqual(EXECUTOR_CLASSES[AiResourceType.Host], HostExecutor);

    const config: AgentConfig = testConfig(URL, {
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
      DOCKER_HOST_NAME: "",
      HOST_NAME: HOST,
    });
    const executor: ResourceExecutor = createExecutor({
      config,
      env: {},
      tmpDir,
      logger: recordingLogger(),
    });

    assert.ok(executor instanceof HostExecutor);
    assert.strictEqual(
      (executor as HostExecutor).getNsenterBinary(),
      NSENTER_BINARY,
    );
    assert.strictEqual(typeof executor.resolveResourceIdentifier, "function");
  });

  test("the start-up sweep removes what a previous run left behind, and logs it", async () => {
    const dir: string = makeTempDir("agent-host-sweep-");
    tempDirs.push(dir);
    const built: Built = build({ tmpDir: dir });
    const leftover: string = path.join(dir, JOB_DIR_PARENT_NAME, "job-old");
    fs.mkdirSync(path.join(leftover, JOB_HOME_DIR_NAME), { recursive: true });

    await built.executor.sweepOrphanedJobDirs();

    assert.strictEqual(fs.existsSync(leftover), false);
    assert.deepStrictEqual(built.logger.records, [
      {
        level: "info",
        message: "Removed job directories a previous run left behind",
      },
    ]);

    await built.executor.removeAllJobDirs();
    assert.deepStrictEqual(
      fs.readdirSync(path.join(dir, JOB_DIR_PARENT_NAME)),
      [],
    );
  });

  test("sweeping never throws, even without a job directory parent", async () => {
    const built: Built = build({ tmpDir: path.join(markersDir, "dockerenv") });

    await built.executor.sweepOrphanedJobDirs();
    await built.executor.removeAllJobDirs();
  });
});
