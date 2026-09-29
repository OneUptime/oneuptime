import {
  RecordingLogger,
  TEST_RESOURCE_NAME,
  recordingLogger,
  recordingSleep,
  testConfig,
} from "./Helpers/TestSupport";
import assert from "assert";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import { after, afterEach, before, describe, test } from "node:test";
import AgentStatus from "../AgentStatus";
import { AgentConfig } from "../Config";
import IngestClient from "../IngestClient";
import JobLoop from "../JobLoop";
import { AgentPosture, PostureProbe, buildPosture } from "../Posture";
import { AgentSession } from "../Registration";
import DockerExecutor, {
  DEFAULT_DOCKER_ENGINE_HOST,
  DEFAULT_PODMAN_ENGINE_HOST,
  DOCKER_BINARY,
  DOCKER_CONFIG_DIR_NAME,
  DOCKER_INFO_PROBE_ARGS,
  DOCKER_VERSION_PROBE_ARGS,
  DockerExecutorSettings,
  DockerHostResolution,
  DockerInfoFacts,
  DockerVersionFacts,
  ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES,
  buildDockerEnvironment,
  describeDockerFailure,
  describeDockerHost,
  getDefaultDockerHost,
  getEngineLabel,
  parseContainerIdFromCgroup,
  parseContainerIdFromMountinfo,
  parseDockerInfo,
  parseDockerVersion,
  parseOwnContainerInspect,
  readDockerApiVersion,
  resolveDockerHost,
} from "../Executors/DockerExecutor";
import { EXECUTOR_CLASSES, createExecutor } from "../Executors/ExecutorFactory";
import { GuardPolicy } from "../Executors/PrepareGuard";
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
} from "../Executors/SpawnSandbox";
import FakeBinary, {
  FakeBinaryInvocation,
  makeTempDir,
} from "./Helpers/FakeBinary";
import { killAfterOutput } from "./Helpers/KillAfterOutput";
import FakeOneUptime, {
  RecordedRequest,
  TEST_RESOURCE_ID,
  jobReply,
} from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The docker kit: DockerExecutor for Docker hosts, Podman hosts and Docker
 * Swarm clusters, with the REAL policy (DockerEngineCommandPolicy and
 * DockerSwarmCommandPolicy through the agent's copy of the dispatcher).
 *
 * Two doubles stand in for the docker CLI:
 *
 *   - FakeDocker: an injected spawn whose answers depend on the argv (the
 *     posture probe asks `docker version`, `docker info` and `docker
 *     container inspect`), recording the argv, the environment, the spawn
 *     options and the job directory as the program would have found it;
 *   - FakeBinary: a real process on disk, for what only a real process can
 *     show (the environment it really gets, the kill of a hung CLI, the
 *     output cap).
 *
 * /proc is always a directory the test controls (settings.procRoot): the
 * agent's own container id comes from it, and CI may itself run in one.
 */

const URL: string = "https://oneuptime.example.com";

// The agent's own container id, as /proc names it in these tests.
const OWN_ID: string = "3f2a9c1b7d4e".padEnd(64, "a");

const DOCKER_VERSION_JSON: string = JSON.stringify({
  Client: {
    Platform: { Name: "" },
    Version: "29.1.3",
    ApiVersion: "1.52",
    Os: "linux",
    Arch: "amd64",
    Context: "default",
  },
  Server: {
    Platform: { Name: "Docker Engine - Community" },
    Components: [
      {
        Name: "Engine",
        Version: "29.4.3",
        Details: { ApiVersion: "1.52", MinAPIVersion: "1.44" },
      },
      { Name: "containerd", Version: "v2.1.4", Details: {} },
    ],
    Version: "29.4.3",
    ApiVersion: "1.52",
    MinAPIVersion: "1.44",
    Os: "linux",
    Arch: "amd64",
  },
});

const PODMAN_VERSION_JSON: string = JSON.stringify({
  Client: { Version: "29.1.3", ApiVersion: "1.41" },
  Server: {
    Platform: { Name: "linux/amd64/fedora-40" },
    Components: [
      {
        Name: "Podman Engine",
        Version: "5.2.1",
        Details: { APIVersion: "5.2.1" },
      },
      { Name: "Conmon", Version: "conmon version 2.1.12" },
      { Name: "OCI Runtime (crun)", Version: "crun version 1.15" },
    ],
    Version: "5.2.1",
    ApiVersion: "1.41",
    MinAPIVersion: "1.24",
  },
});

// What `docker version` prints (exit 1) when the engine does not answer.
const CLIENT_ONLY_VERSION_JSON: string = JSON.stringify({
  Client: { Version: "29.1.3", ApiVersion: "1.52" },
  Server: null,
});

function infoJson(
  data: {
    swarmState?: string;
    controlAvailable?: boolean;
    swarmError?: string;
    securityOptions?: Array<string>;
  } = {},
): string {
  return JSON.stringify({
    ID: "b7c1",
    Containers: 3,
    ServerVersion: "29.4.3",
    OperatingSystem: "Ubuntu 24.04 LTS",
    Swarm: {
      NodeID: "",
      LocalNodeState: data.swarmState ?? "inactive",
      ControlAvailable: data.controlAvailable ?? false,
      Error: data.swarmError ?? "",
    },
    SecurityOptions: data.securityOptions ?? [
      "name=seccomp,profile=builtin",
      "name=cgroupns",
    ],
  });
}

function inspectJson(
  name: string,
  labels: Record<string, string> = {},
): string {
  return JSON.stringify([
    {
      Id: OWN_ID,
      Name: `/${name}`,
      Config: { Labels: labels, Env: ["ONEUPTIME_SERVICE_TOKEN=secret-1"] },
    },
  ]);
}

// ---- The fake docker CLI (an injected spawn) ---------------------------------------

interface FakeReply {
  stdout?: string | undefined;
  stderr?: string | undefined;
  exitCode?: number | undefined;
  // Never answer (the sandbox's timeout kills it).
  hang?: boolean | undefined;
  // Emit an "error" event with this code (ENOENT: no such binary).
  errorCode?: string | undefined;
}

type Responder = (args: Array<string>) => FakeReply;

interface DirectoryFacts {
  exists: boolean;
  isDirectory: boolean;
  entries: Array<string>;
  mode: number | null;
}

interface SpawnRecord {
  binary: string;
  args: Array<string>;
  env: Record<string, string>;
  cwd: string;
  options: Record<string, unknown>;
  // As the program would have found them when it started.
  dockerConfig: DirectoryFacts;
  home: DirectoryFacts;
}

function directoryFacts(dir: string | undefined): DirectoryFacts {
  try {
    const stat: fs.Stats = fs.statSync(dir || "/nonexistent-dir");
    return {
      exists: true,
      isDirectory: stat.isDirectory(),
      entries: stat.isDirectory() ? fs.readdirSync(dir!).sort() : [],
      mode: stat.mode & 0o777,
    };
  } catch {
    return { exists: false, isDirectory: false, entries: [], mode: null };
  }
}

class FakeChild extends EventEmitter {
  public stdout: PassThrough = new PassThrough();
  public stderr: PassThrough = new PassThrough();
  public pid: number | undefined = undefined;
  public killed: Array<string> = [];

  public kill(signal: string): boolean {
    this.killed.push(signal);
    setImmediate((): void => {
      this.emit("close", null, signal);
    });
    return true;
  }
}

// A healthy Docker engine that is not in a swarm; anything else prints "ran ...".
function healthyDocker(args: Array<string>): FakeReply {
  if (args[0] === "version") {
    return { stdout: DOCKER_VERSION_JSON };
  }

  if (args[0] === "info") {
    return { stdout: infoJson() };
  }

  if (args[0] === "container" && args[1] === "inspect") {
    return { stdout: inspectJson("my-ai-agent") };
  }

  return { stdout: `ran ${args.join(" ")}\n` };
}

class FakeDocker {
  public readonly calls: Array<SpawnRecord> = [];
  public readonly children: Array<FakeChild> = [];
  public readonly spawnImpl: SpawnFunction;

  public constructor(public responder: Responder = healthyDocker) {
    this.spawnImpl = ((
      binary: string,
      args: Array<string>,
      options: Record<string, unknown>,
    ): FakeChild => {
      const env: Record<string, string> = (options["env"] || {}) as Record<
        string,
        string
      >;

      this.calls.push({
        binary,
        args: args.slice(),
        env: { ...env },
        cwd: String(options["cwd"]),
        options,
        dockerConfig: directoryFacts(env["DOCKER_CONFIG"]),
        home: directoryFacts(env["HOME"]),
      });

      const reply: FakeReply = this.responder(args.slice());
      const child: FakeChild = new FakeChild();
      this.children.push(child);

      setImmediate((): void => {
        if (reply.errorCode) {
          child.emit(
            "error",
            Object.assign(new Error(`spawn ${binary} ${reply.errorCode}`), {
              code: reply.errorCode,
            }),
          );
          return;
        }

        if (reply.hang) {
          return;
        }

        let ended: number = 0;
        const onEnd: () => void = (): void => {
          ended++;

          if (ended === 2) {
            child.emit("close", reply.exitCode ?? 0, null);
          }
        };

        child.stdout.on("end", onEnd);
        child.stderr.on("end", onEnd);
        child.stdout.end(reply.stdout || "");
        child.stderr.end(reply.stderr || "");
      });

      return child;
    }) as unknown as SpawnFunction;
  }

  public argvs(): Array<Array<string>> {
    return this.calls.map((call: SpawnRecord): Array<string> => {
      return call.args;
    });
  }

  public clear(): void {
    this.calls.splice(0);
  }
}

// ---- Building executors and requests ------------------------------------------------

let tmpDir: string;
let emptyProc: string;
let ownProc: string;

before((): void => {
  tmpDir = makeTempDir("agent-docker-executor-");
  emptyProc = makeTempDir("agent-docker-proc-empty-");
  ownProc = makeTempDir("agent-docker-proc-own-");
  fs.mkdirSync(path.join(ownProc, "self"));
  fs.writeFileSync(
    path.join(ownProc, "self", "mountinfo"),
    [
      "613 612 0:52 / / ro,relatime master:1 - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/ABC",
      `622 613 254:1 /var/lib/docker/containers/${OWN_ID}/resolv.conf /etc/resolv.conf rw,relatime - ext4 /dev/vda1 rw`,
      `623 613 254:1 /var/lib/docker/containers/${OWN_ID}/hostname /etc/hostname rw,relatime - ext4 /dev/vda1 rw`,
      `624 613 254:1 /var/lib/docker/containers/${OWN_ID}/hosts /etc/hosts rw,relatime - ext4 /dev/vda1 rw`,
      "625 613 0:5 /docker.sock /var/run/docker.sock ro,nosuid - tmpfs tmpfs rw",
    ].join("\n"),
  );
});

after((): void => {
  for (const dir of [tmpDir, emptyProc, ownProc]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

type Kind = "docker" | "podman" | "swarm";

const KIND_ENV: Record<Kind, Record<string, string>> = {
  docker: {},
  podman: {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "podman",
    PODMAN_HOST_NAME: TEST_RESOURCE_NAME,
  },
  swarm: {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "docker-swarm",
    DOCKER_SWARM_CLUSTER_NAME: TEST_RESOURCE_NAME,
  },
};

const KIND_TYPE: Record<Kind, AiResourceType> = {
  docker: AiResourceType.DockerHost,
  podman: AiResourceType.PodmanHost,
  swarm: AiResourceType.DockerSwarmCluster,
};

interface Built {
  executor: DockerExecutor;
  docker: FakeDocker;
  logger: RecordingLogger;
  config: AgentConfig;
}

function build(
  data: {
    kind?: Kind;
    // Agent configuration (ONEUPTIME_AI_ALLOW_WRITES, ...).
    config?: Record<string, string>;
    // The agent's environment as the executor sees it (DOCKER_HOST, ...).
    env?: NodeJS.ProcessEnv;
    responder?: Responder;
    settings?: DockerExecutorSettings;
    guardPolicy?: GuardPolicy;
    // Spawn for real (a FakeBinary) instead of the injected fake.
    realSpawn?: boolean;
    tmpDir?: string;
  } = {},
): Built {
  const kind: Kind = data.kind || "docker";
  const config: AgentConfig = testConfig(URL, {
    ...KIND_ENV[kind],
    ...(data.config || {}),
  });
  const docker: FakeDocker = new FakeDocker(data.responder);
  const logger: RecordingLogger = recordingLogger();
  const options: ExecutorOptions = {
    config,
    env: data.env || {},
    tmpDir: data.tmpDir || tmpDir,
    logger,
    spawnImpl: data.realSpawn ? undefined : docker.spawnImpl,
    guardPolicy: data.guardPolicy,
  };

  return {
    executor: new DockerExecutor(options, {
      procRoot: emptyProc,
      ...(data.settings || {}),
    }),
    docker,
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
    kind?: Kind;
    origin?: string;
    timeoutInMs?: number;
    payload?: Record<string, unknown>;
    agentResourceId?: string;
  } = {},
): ResourceCommandRequest {
  const resourceType: AiResourceType = KIND_TYPE[data.kind || "docker"];
  const policy: ResourceCommandPolicyResult =
    ResourceCommandPolicy.evaluateCommand({ resourceType, command });

  return {
    payload: {
      resourceType,
      resourceId: TEST_RESOURCE_ID,
      resourceIdentifier: TEST_RESOURCE_NAME,
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

// ---- prepare(): PrepareGuard first ----------------------------------------------------

describe("prepare: PrepareGuard runs first, with the real policy", () => {
  test("a read is prepared with the policy's display command and tier, and nothing runs yet", () => {
    const built: Built = build();
    const prepared: PreparedCommand = expectPrepared(
      built.executor.prepare(request("docker ps -a")),
    );

    assert.strictEqual(prepared.displayCommand, "docker ps -a");
    assert.strictEqual(prepared.tier, ResourceCommandTier.Read);
    assert.deepStrictEqual(built.docker.calls, []);
  });

  test("a command for another Docker host is refused, naming the identity to check", () => {
    const built: Built = build();

    expectRefused(
      built.executor.prepare(
        request("docker ps", { payload: { resourceIdentifier: "db-host-7" } }),
      ),
      /^Refused by the Docker AI agent: this command is for Docker host "db-host-7", but this agent serves "web-host-1"\. Check DOCKER_HOST_NAME/,
    );
    assert.deepStrictEqual(built.docker.calls, []);
  });

  test("a command for another resource id is refused", () => {
    expectRefused(
      build().executor.prepare(
        request("docker ps", { agentResourceId: "another-resource-id" }),
      ),
      /is registered for "another-resource-id"/,
    );
  });

  test("a command for another kind of resource is refused", () => {
    expectRefused(
      build({ kind: "podman" }).executor.prepare(request("docker ps")),
      /^Refused by the Podman AI agent: this command is for a "DockerHost" resource, and this agent serves a Podman host\./,
    );
  });

  test("a program other than docker never runs", () => {
    expectRefused(
      build().executor.prepare(
        request("docker ps", {
          payload: { program: "sh", args: ["-c", "id"] },
        }),
      ),
      /"sh" is not a program the Docker AI agent runs \(it runs docker\)/,
    );
  });

  test("a command from a runbook never runs", () => {
    expectRefused(
      build().executor.prepare(request("docker ps", { origin: "Runbook" })),
      /this job came from "Runbook"/,
    );
  });

  test("a Denied command never runs, with the policy's reason", () => {
    const built: Built = build({ config: WRITES });

    expectRefused(
      built.executor.prepare(
        request("docker exec web-1 sh", { origin: "AiRemediation" }),
      ),
      /^Refused by the Docker AI agent: docker exec is never allowed/,
    );
    assert.deepStrictEqual(built.docker.calls, []);
  });

  test("docker's global flags are refused: the CLI is never pointed at another engine", () => {
    for (const command of [
      "docker -H tcp://10.0.0.9:2375 ps",
      "docker --context other ps",
      "docker --config /tmp/evil ps",
    ]) {
      expectRefused(build().executor.prepare(request(command)), /global flags/);
    }
  });

  test("an investigation never runs a change", () => {
    expectRefused(
      build({ config: WRITES }).executor.prepare(
        request("docker restart web-1", { origin: "AiInvestigation" }),
      ),
      /an investigation may only run read-only commands, and "docker restart web-1" is SafeWrite/,
    );
  });

  test("a change on a read-only agent says which switch to flip", () => {
    expectRefused(
      build().executor.prepare(request("docker restart web-1")),
      /"docker restart web-1" changes the Docker host, and this agent is read-only \(ONEUPTIME_AI_ALLOW_WRITES is not set\)\. To let OneUptime AI apply fixes, set ONEUPTIME_AI_ALLOW_WRITES=true/,
    );
  });

  test("a job that claims a lower tier than the agent's policy reads is refused", () => {
    expectRefused(
      build({ config: WRITES }).executor.prepare(
        request("docker stop web-1", { payload: { tier: "SafeWrite" } }),
      ),
      /sent "docker stop web-1" as SafeWrite, but this agent's policy reads it as RiskyWrite/,
    );
  });

  test("args that differ from the policy's reading are refused", () => {
    expectRefused(
      build().executor.prepare(
        request("docker ps", {
          payload: { args: ["ps", "--format", "{{.Names}}"] },
        }),
      ),
      /format/,
    );
  });

  test("a refusal carries nothing but the reason: no exit code, so the server reads it as never ran", () => {
    const prepared: PrepareResult = build().executor.prepare(
      request("docker restart web-1"),
    );

    assert.deepStrictEqual(Object.keys(prepared), ["refusal"]);
  });

  test("a change every check allows is prepared as the policy tiers it", () => {
    const prepared: PreparedCommand = expectPrepared(
      build({ config: WRITES }).executor.prepare(
        request("docker restart -t 5 web-1"),
      ),
    );

    assert.strictEqual(prepared.displayCommand, "docker restart -t 5 web-1");
    assert.strictEqual(prepared.tier, ResourceCommandTier.SafeWrite);
  });
});

// ---- prepare(): what the agent protects ----------------------------------------------------

describe("prepare: what the agent never changes", () => {
  test("the collectors and OneUptime's other docker-family agents", () => {
    const built: Built = build({ config: WRITES });

    for (const name of ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES) {
      expectRefused(
        built.executor.prepare(request(`docker restart ${name}`)),
        new RegExp(
          `would change ${name}, which the Docker AI agent protects \\(${name}\\)`,
        ),
      );
    }
    assert.deepStrictEqual(built.docker.calls, []);
  });

  test("the same names on a Podman host", () => {
    expectRefused(
      build({ kind: "podman", config: WRITES }).executor.prepare(
        request("docker stop oneuptime-podman-agent", { kind: "podman" }),
      ),
      /which the Podman AI agent protects/,
    );
  });

  test("before it has looked its own container up, it runs no changes (reads still run)", () => {
    const built: Built = build({
      config: WRITES,
      settings: { procRoot: ownProc },
    });

    expectRefused(
      built.executor.prepare(request("docker restart web-1")),
      /"docker restart web-1" changes the Docker host, and the agent has not yet been able to look up its own container \(3f2a9c1b7d4e\) on the Docker engine at unix:\/\/\/var\/run\/docker\.sock\. It never changes itself/,
    );
    expectPrepared(built.executor.prepare(request("docker ps")));
    assert.strictEqual(built.executor.isOwnContainerKnown(), false);
  });

  test("its own container, by name, by id, and by any id prefix docker would resolve", async () => {
    const built: Built = build({
      config: WRITES,
      settings: { procRoot: ownProc },
    });

    await built.executor.probePosture();
    assert.strictEqual(built.executor.isOwnContainerKnown(), true);

    for (const target of ["my-ai-agent", OWN_ID, OWN_ID.slice(0, 12), "3f2a"]) {
      expectRefused(
        built.executor.prepare(request(`docker restart ${target}`)),
        /which the Docker AI agent protects/,
      );
    }

    expectPrepared(built.executor.prepare(request("docker restart web-1")));
  });

  test("a container the engine does not know is not the agent's: changes run", async () => {
    const built: Built = build({
      config: WRITES,
      settings: { procRoot: ownProc },
      responder: (args: Array<string>): FakeReply => {
        return args[0] === "container"
          ? {
              stderr: `Error: No such container: ${OWN_ID}\n`,
              exitCode: 1,
            }
          : healthyDocker(args);
      },
    });

    await built.executor.probePosture();

    assert.strictEqual(built.executor.isOwnContainerKnown(), true);
    expectPrepared(built.executor.prepare(request("docker restart web-1")));
    // The id is still protected: a prefix of it names nothing else.
    expectRefused(
      built.executor.prepare(request(`docker restart ${OWN_ID.slice(0, 12)}`)),
      /protects/,
    );
  });

  test("an engine error while looking itself up keeps changes refused; the next probe tries again, and only until it knows", async () => {
    let inspectAnswers: boolean = false;
    const built: Built = build({
      config: WRITES,
      settings: { procRoot: ownProc },
      responder: (args: Array<string>): FakeReply => {
        if (args[0] === "container" && !inspectAnswers) {
          return {
            stderr:
              'error during connect: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.52/containers/json": context deadline exceeded\n',
            exitCode: 1,
          };
        }
        return healthyDocker(args);
      },
    });

    await built.executor.probePosture();
    expectRefused(
      built.executor.prepare(request("docker restart web-1")),
      /has not yet been able to look up its own container/,
    );

    inspectAnswers = true;
    await built.executor.probePosture();
    expectPrepared(built.executor.prepare(request("docker restart web-1")));

    await built.executor.probePosture();
    const inspects: Array<Array<string>> = built.docker
      .argvs()
      .filter((argv: Array<string>): boolean => {
        return argv[0] === "container";
      });
    assert.deepStrictEqual(inspects, [
      ["container", "inspect", OWN_ID],
      ["container", "inspect", OWN_ID],
    ]);
  });

  test("ONEUPTIME_AI_PROTECTED_TARGETS protects more", () => {
    expectRefused(
      build({
        config: { ...WRITES, ONEUPTIME_AI_PROTECTED_TARGETS: "db-*" },
      }).executor.prepare(request("docker restart db-1")),
      /would change db-1, which the Docker AI agent protects \(db-\*\)/,
    );
  });

  test("ONEUPTIME_AI_WRITE_TARGETS limits where changes land", () => {
    const built: Built = build({
      config: { ...WRITES, ONEUPTIME_AI_WRITE_TARGETS: "web-*" },
    });

    expectRefused(
      built.executor.prepare(request("docker restart api-1")),
      /would change api-1, which is outside the targets the Docker AI agent may change \(ONEUPTIME_AI_WRITE_TARGETS=web-\*\)/,
    );
    expectPrepared(built.executor.prepare(request("docker restart web-1")));
  });

  test("swarm: deployed as a stack, its own service and its stack's OneUptime services are protected", async () => {
    const built: Built = build({
      kind: "swarm",
      config: WRITES,
      settings: { procRoot: ownProc },
      responder: (args: Array<string>): FakeReply => {
        if (args[0] === "info") {
          return {
            stdout: infoJson({ swarmState: "active", controlAvailable: true }),
          };
        }
        if (args[0] === "container") {
          return {
            stdout: inspectJson("ops_oneuptime-docker-swarm-ai-agent.1.x7", {
              "com.docker.swarm.service.name":
                "ops_oneuptime-docker-swarm-ai-agent",
              "com.docker.stack.namespace": "ops",
            }),
          };
        }
        return healthyDocker(args);
      },
    });

    const probe: ResourcePostureProbe = await built.executor.probePosture();
    assert.ok(
      probe.protectedTargets.includes("ops_oneuptime-docker-swarm-agent"),
    );

    for (const service of [
      "ops_oneuptime-docker-swarm-ai-agent",
      "ops_oneuptime-docker-swarm-agent",
      "ops_oneuptime-docker-swarm-inventory",
    ]) {
      expectRefused(
        built.executor.prepare(
          request(`docker service update --force ${service}`, {
            kind: "swarm",
          }),
        ),
        /which the Docker Swarm AI agent protects/,
      );
    }

    expectPrepared(
      built.executor.prepare(
        request("docker service update --force api", { kind: "swarm" }),
      ),
    );
  });

  test("swarm: an engine-level change is not a swarm fix", () => {
    expectRefused(
      build({ kind: "swarm", config: WRITES }).executor.prepare(
        request("docker restart web-1", { kind: "swarm" }),
      ),
      /^Refused by the Docker Swarm AI agent: docker restart is never allowed for a Docker Swarm cluster/,
    );
  });
});

// ---- prepare(): the engine address ---------------------------------------------------------

describe("prepare: the engine address", () => {
  test("an engine address it cannot use is refused before anything runs, without its credentials", () => {
    const built: Built = build({
      env: { DOCKER_HOST: "ssh://admin:hunter2@build-host" },
    });
    const refusal: string = expectRefused(
      built.executor.prepare(request("docker ps")),
      /^Refused by the Docker AI agent: DOCKER_HOST="ssh:\/\/build-host" is not an engine address this agent can use/,
    );

    assert.ok(!refusal.includes("hunter2"));
    assert.match(
      refusal,
      /leave it unset to use unix:\/\/\/var\/run\/docker\.sock\.$/,
    );
    assert.deepStrictEqual(built.docker.calls, []);
  });

  test("the Podman agent's default in the same message", () => {
    expectRefused(
      build({ kind: "podman", env: { DOCKER_HOST: "fd://" } }).executor.prepare(
        request("docker ps", { kind: "podman" }),
      ),
      /reaches the Podman engine .* leave it unset to use unix:\/\/\/run\/podman\/podman\.sock\./,
    );
  });
});

// ---- run(): argv and environment -------------------------------------------------------------

describe("run: the argv and the closed environment", () => {
  test("the argv is the payload's args exactly — the image's docker, no global flag added", async () => {
    const built: Built = build({ settings: { procRoot: emptyProc } });
    const job: ResourceCommandRequest = request("docker logs --tail 200 web-1");
    const before: string = JSON.stringify(job.payload);

    await expectPrepared(built.executor.prepare(job)).run();

    assert.strictEqual(built.docker.calls.length, 1);
    assert.strictEqual(built.docker.calls[0]!.binary, DOCKER_BINARY);
    assert.strictEqual(DOCKER_BINARY, "/usr/bin/docker");
    assert.deepStrictEqual(built.docker.calls[0]!.args, [
      "logs",
      "--tail",
      "200",
      "web-1",
    ]);
    assert.strictEqual(
      JSON.stringify(job.payload),
      before,
      "payload untouched",
    );
  });

  test("no shell and no stdin", async () => {
    const built: Built = build();
    await runCommand(built, "docker ps");

    const options: Record<string, unknown> = built.docker.calls[0]!.options;
    assert.strictEqual(options["shell"], false);
    assert.deepStrictEqual(options["stdio"], ["ignore", "pipe", "pipe"]);
  });

  test("the environment is closed: exactly the documented variables, whatever the agent's holds", async () => {
    const built: Built = build({
      env: {
        PATH: "/opt/evil/bin",
        HOME: "/root",
        ONEUPTIME_SERVICE_TOKEN: "ingestion-key-1",
        ONEUPTIME_API_KEY: "api-key-1",
        HTTPS_PROXY: "http://proxy.internal:3128",
        DOCKER_CONTEXT: "someone-elses",
        DOCKER_CONFIG: "/root/.docker",
        DOCKER_CERT_PATH: "/certs",
        DOCKER_TLS_VERIFY: "1",
        DOCKER_CLI_PLUGIN_EXTRA_DIRS: "/plugins",
        BUILDKIT_HOST: "tcp://buildkit:1234",
      },
    });

    await runCommand(built, "docker ps");

    const call: SpawnRecord = built.docker.calls[0]!;
    assert.deepStrictEqual(call.env, {
      PATH: DEFAULT_SPAWN_PATH,
      HOME: call.env["HOME"],
      DOCKER_CONFIG: call.env["DOCKER_CONFIG"],
      DOCKER_HOST: DEFAULT_DOCKER_ENGINE_HOST,
      DOCKER_CLI_HINTS: "false",
      NO_COLOR: "1",
    });
    assert.notStrictEqual(call.env["HOME"], "/root");
    assert.notStrictEqual(call.env["DOCKER_CONFIG"], "/root/.docker");
  });

  test("DOCKER_CONFIG is an empty private directory of the job; HOME is its private home and the working directory", async () => {
    const built: Built = build();
    await runCommand(built, "docker ps");

    const call: SpawnRecord = built.docker.calls[0]!;
    const dockerConfig: string = call.env["DOCKER_CONFIG"]!;
    const home: string = call.env["HOME"]!;

    assert.deepStrictEqual(call.dockerConfig, {
      exists: true,
      isDirectory: true,
      entries: [],
      mode: 0o700,
    });
    assert.deepStrictEqual(call.home, {
      exists: true,
      isDirectory: true,
      entries: [],
      mode: 0o700,
    });
    assert.strictEqual(path.basename(dockerConfig), DOCKER_CONFIG_DIR_NAME);
    assert.strictEqual(path.basename(home), JOB_HOME_DIR_NAME);
    assert.strictEqual(path.dirname(dockerConfig), path.dirname(home));
    assert.strictEqual(
      path.dirname(path.dirname(home)),
      path.join(tmpDir, JOB_DIR_PARENT_NAME),
    );
    assert.strictEqual(call.cwd, home);
    // Removed when the command ended.
    assert.strictEqual(fs.existsSync(path.dirname(home)), false);
  });

  test("every command gets a fresh job directory", async () => {
    const built: Built = build();
    await runCommand(built, "docker ps");
    await runCommand(built, "docker ps");

    assert.notStrictEqual(
      built.docker.calls[0]!.env["DOCKER_CONFIG"],
      built.docker.calls[1]!.env["DOCKER_CONFIG"],
    );
  });

  test("each type's engine socket by default", async () => {
    const expected: Record<Kind, string> = {
      docker: DEFAULT_DOCKER_ENGINE_HOST,
      podman: DEFAULT_PODMAN_ENGINE_HOST,
      swarm: DEFAULT_DOCKER_ENGINE_HOST,
    };

    for (const kind of ["docker", "podman", "swarm"] as Array<Kind>) {
      const built: Built = build({ kind });
      await runCommand(built, "docker version", { kind });

      assert.strictEqual(
        built.docker.calls[0]!.env["DOCKER_HOST"],
        expected[kind],
        kind,
      );
    }

    assert.strictEqual(
      DEFAULT_DOCKER_ENGINE_HOST,
      "unix:///var/run/docker.sock",
    );
    assert.strictEqual(
      DEFAULT_PODMAN_ENGINE_HOST,
      "unix:///run/podman/podman.sock",
    );
  });

  test("DOCKER_HOST from the agent's environment wins; DOCKER_API_VERSION passes through only when set", async () => {
    const pinned: Built = build({
      env: {
        DOCKER_HOST: " tcp://10.0.0.5:2375 ",
        DOCKER_API_VERSION: "1.41",
      },
    });
    await runCommand(pinned, "docker ps");

    assert.strictEqual(
      pinned.docker.calls[0]!.env["DOCKER_HOST"],
      "tcp://10.0.0.5:2375",
    );
    assert.strictEqual(
      pinned.docker.calls[0]!.env["DOCKER_API_VERSION"],
      "1.41",
    );

    const negotiating: Built = build({ env: { DOCKER_API_VERSION: "  " } });
    await runCommand(negotiating, "docker ps");

    assert.strictEqual(
      "DOCKER_API_VERSION" in negotiating.docker.calls[0]!.env,
      false,
    );
  });

  test("a successful command: its output and exit code 0", async () => {
    const result: ExecResult = await runCommand(build(), "docker ps -a");

    assert.deepStrictEqual(result, {
      success: true,
      output: "[stdout]\nran ps -a\n",
      exitCode: 0,
    });
  });

  test("a change runs too, once every check allows it", async () => {
    const built: Built = build({ config: WRITES });
    const result: ExecResult = await runCommand(built, "docker restart web-1");

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(built.docker.argvs(), [["restart", "web-1"]]);
  });

  test("Podman: the same CLI and argv, against Podman's socket", async () => {
    const built: Built = build({ kind: "podman", config: WRITES });
    await runCommand(built, "docker restart web-1", { kind: "podman" });

    assert.deepStrictEqual(built.docker.calls[0]!.args, ["restart", "web-1"]);
    assert.strictEqual(
      built.docker.calls[0]!.env["DOCKER_HOST"],
      DEFAULT_PODMAN_ENGINE_HOST,
    );
  });

  test("swarm: a service fix on the manager", async () => {
    const built: Built = build({ kind: "swarm", config: WRITES });
    await runCommand(built, "docker service scale api=3", { kind: "swarm" });

    assert.deepStrictEqual(built.docker.argvs(), [
      ["service", "scale", "api=3"],
    ]);
  });
});

// ---- run(): a real process -----------------------------------------------------------------

describe("run: with a real process", () => {
  let binary: FakeBinary;

  before((): void => {
    binary = new FakeBinary("docker");
  });

  after((): void => {
    binary.cleanup();
  });

  afterEach((): void => {
    binary.clearInvocations();
    binary.setBehaviour({});
  });

  function real(
    data: { config?: Record<string, string>; env?: NodeJS.ProcessEnv } = {},
  ): Built {
    return build({
      ...data,
      realSpawn: true,
      settings: { dockerBinary: binary.binary },
    });
  }

  function onlyInvocation(): FakeBinaryInvocation {
    const invocations: Array<FakeBinaryInvocation> = binary.getInvocations();
    assert.strictEqual(invocations.length, 1, "docker ran exactly once");
    return invocations[0]!;
  }

  test("the program gets exactly the closed environment and the argv", async () => {
    const previous: string | undefined = process.env["ONEUPTIME_API_KEY"];
    process.env["ONEUPTIME_API_KEY"] = "must-never-reach-docker";

    try {
      await runCommand(
        real({
          env: {
            ...process.env,
            DOCKER_CONTEXT: "someone-elses",
            DOCKER_API_VERSION: "1.47",
          },
        }),
        "docker logs --since 30m web-1",
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
      "logs",
      "--since",
      "30m",
      "web-1",
    ]);
    assert.deepStrictEqual(Object.keys(invocation.env).sort(), [
      "DOCKER_API_VERSION",
      "DOCKER_CLI_HINTS",
      "DOCKER_CONFIG",
      "DOCKER_HOST",
      "HOME",
      "NO_COLOR",
      "PATH",
    ]);
    assert.strictEqual(invocation.env["PATH"], DEFAULT_SPAWN_PATH);
    assert.strictEqual(invocation.env["DOCKER_API_VERSION"], "1.47");
    assert.strictEqual(invocation.homeExists, true);
    assert.strictEqual(invocation.cwdMode, 0o700);
    assert.strictEqual(invocation.parentMode, 0o700);
    // The job directory holds exactly the empty DOCKER_CONFIG and HOME.
    assert.deepStrictEqual(invocation.parentEntries, [
      DOCKER_CONFIG_DIR_NAME,
      JOB_HOME_DIR_NAME,
    ]);
  });

  test("docker inspect's environment values never leave the agent", async () => {
    binary.setBehaviour({
      stdout: JSON.stringify(
        [
          {
            Id: "abc",
            Config: {
              Env: [
                "DB_PASSWORD=hunter2",
                "APP_CONFIG=postgres://app:pw@db/app",
                "PATH=/usr/bin",
              ],
            },
          },
        ],
        null,
        2,
      ),
    });

    const result: ExecResult = await runCommand(
      real(),
      "docker container inspect web-1",
    );

    assert.strictEqual(result.success, true);
    assert.match(result.output, /"DB_PASSWORD=\[redacted\]"/);
    assert.match(result.output, /"APP_CONFIG=\[redacted\]"/);
    assert.ok(!result.output.includes("hunter2"));
    assert.ok(!result.output.includes("app:pw"));
  });

  test("stdout is capped, and says so", async () => {
    binary.setBehaviour({ stdoutBytes: MAX_OUTPUT_BYTES * 2 });

    const result: ExecResult = await runCommand(real(), "docker ps -a");

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

  test("NUL characters are replaced", async () => {
    binary.setBehaviour({ stdout: "web-1\u0000log line\n" });

    const result: ExecResult = await runCommand(
      real(),
      "docker logs --tail 5 web-1",
    );

    assert.strictEqual(
      result.output,
      `[stdout]\nweb-1${NUL_REPLACEMENT}log line\n`,
    );
  });

  test("a failing command: the exit code and docker's own reason, nothing added", async () => {
    binary.setBehaviour({
      stderr: "Error response from daemon: No such container: web-9\n",
      exitCode: 1,
    });

    const result: ExecResult = await runCommand(
      real(),
      "docker logs --tail 5 web-9",
    );

    assert.deepStrictEqual(result, {
      success: false,
      output:
        "[stderr]\nError response from daemon: No such container: web-9\n",
      exitCode: 1,
      errorMessage:
        "Exit code 1: Error response from daemon: No such container: web-9",
    });
  });

  test("a hung engine: the CLI is killed at the time budget, without an exit code", async () => {
    binary.setBehaviour({ sleepMs: 20_000 });
    const started: number = Date.now();

    const result: ExecResult = await runCommand(real(), "docker ps", {
      timeoutInMs: 300,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(
      result.errorMessage,
      "Killed (timeout 300ms): docker produced no output at all, so the Docker engine at unix:///var/run/docker.sock never answered: check that the daemon is running and not hung.",
    );
    assert.ok(Date.now() - started < 5_000, "it did not wait for the CLI");
  });

  test("output and then a hang: just the kill (the output says the rest)", async () => {
    binary.setBehaviour({
      stdout: "partial\n",
      sleepMs: 20_000,
      announcePrinted: true,
    });

    /*
     * The budget runs out once the fake CLI (a Node process) has printed,
     * however slow its start on a loaded machine: this test is about what
     * comes after the output.
     */
    const result: ExecResult = await killAfterOutput({
      timeoutInMs: 2_500,
      run: (): Promise<ExecResult> => {
        return runCommand(real(), "docker ps", { timeoutInMs: 2_500 });
      },
      printed: (signal: AbortSignal): Promise<void> => {
        return binary.waitUntilPrinted(signal);
      },
    });

    assert.strictEqual(result.errorMessage, "Killed (timeout 2500ms)");
    assert.strictEqual(result.output, "[stdout]\npartial\n");
  });

  test("a tcp engine that never answers says to check the network", async () => {
    binary.setBehaviour({ sleepMs: 20_000 });

    const result: ExecResult = await runCommand(
      real({ env: { DOCKER_HOST: "tcp://10.0.0.5:2375" } }),
      "docker ps",
      { timeoutInMs: 300 },
    );

    assert.match(
      result.errorMessage!,
      /the Docker engine at tcp:\/\/10\.0\.0\.5:2375 never answered: check that it is up and that the network lets the agent reach it\.$/,
    );
  });

  test("a missing docker binary says which image carries it", async () => {
    const built: Built = build({
      realSpawn: true,
      settings: { dockerBinary: path.join(binary.dir, "no-such-docker") },
    });

    const result: ExecResult = await runCommand(built, "docker ps");

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage: `docker is not installed in this container (${path.join(
        binary.dir,
        "no-such-docker",
      )} was not found). Use the oneuptime/resource-ai-agent image, which includes it.`,
    });
  });
});

// ---- run(): failures an operator can fix ----------------------------------------------------------

describe("run: what the operator should change", () => {
  function failing(stderr: string): Responder {
    return (): FakeReply => {
      return { stderr, exitCode: 1 };
    };
  }

  test("permission denied on the socket: run the agent as root, like the collector", async () => {
    const result: ExecResult = await runCommand(
      build({
        responder: failing(
          'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.52/containers/json": dial unix /var/run/docker.sock: connect: permission denied\n',
        ),
      }),
      "docker ps",
    );

    assert.strictEqual(result.exitCode, 1);
    assert.match(
      result.errorMessage!,
      /^Exit code 1: permission denied while trying to connect .*\. The AI agent may not open the Docker engine socket \(unix:\/\/\/var\/run\/docker\.sock\): run the AI agent container as root \(user: "0:0" in docker-compose\.yml, --user 0:0 with docker run\), as the collector does/,
    );
  });

  test("no socket: mount it (Docker)", async () => {
    const result: ExecResult = await runCommand(
      build({
        responder: failing(
          "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n",
        ),
      }),
      "docker ps",
    );

    assert.match(
      result.errorMessage!,
      /The AI agent cannot reach the Docker engine at unix:\/\/\/var\/run\/docker\.sock: mount the socket into the AI agent container \(-v \/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro, as the collector does\) and check that the Docker daemon is running\.$/,
    );
  });

  test("no socket: mount it and enable podman.socket (Podman)", async () => {
    const result: ExecResult = await runCommand(
      build({
        kind: "podman",
        responder: failing(
          "Cannot connect to the Docker daemon at unix:///run/podman/podman.sock. Is the docker daemon running?\n",
        ),
      }),
      "docker ps",
      { kind: "podman" },
    );

    assert.match(
      result.errorMessage!,
      /-v \/run\/podman\/podman\.sock:\/run\/podman\/podman\.sock:ro, as the collector does\) and check that the Podman API socket is enabled \(sudo systemctl enable --now podman\.socket\)\.$/,
    );
  });

  test("a tcp engine that refuses: check that it listens and the network", async () => {
    const result: ExecResult = await runCommand(
      build({
        env: { DOCKER_HOST: "tcp://10.0.0.5:2375" },
        responder: failing(
          "Cannot connect to the Docker daemon at tcp://10.0.0.5:2375. Is the docker daemon running?\n",
        ),
      }),
      "docker ps",
    );

    assert.match(
      result.errorMessage!,
      /The AI agent cannot reach the Docker engine at tcp:\/\/10\.0\.0\.5:2375: check that the engine listens there and that the network lets the agent reach it/,
    );
  });

  test("an API version pin the engine does not speak: what to set it to", async () => {
    const tooNew: ExecResult = await runCommand(
      build({
        kind: "podman",
        env: { DOCKER_API_VERSION: "1.47" },
        responder: failing(
          "Error response from daemon: client version 1.47 is too new. Maximum supported API version is 1.41\n",
        ),
      }),
      "docker ps",
      { kind: "podman" },
    );

    assert.match(
      tooNew.errorMessage!,
      /The Podman engine speaks Docker API 1\.41 at most, and DOCKER_API_VERSION=1\.47 on the AI agent asks for 1\.47: set DOCKER_API_VERSION=1\.41 on the AI agent, or leave it empty so the docker CLI negotiates the version itself\.$/,
    );

    const tooOld: ExecResult = await runCommand(
      build({
        env: { DOCKER_API_VERSION: "1.24" },
        responder: failing(
          "Error response from daemon: client version 1.24 is too old. Minimum supported API version is 1.44, please upgrade your client to a newer version\n",
        ),
      }),
      "docker ps",
    );

    assert.match(
      tooOld.errorMessage!,
      /needs Docker API 1\.44 or newer, and DOCKER_API_VERSION=1\.24 on the AI agent asks for 1\.24: set DOCKER_API_VERSION=1\.44/,
    );
  });

  test("a swarm command on a worker: move the agent to a manager", async () => {
    const result: ExecResult = await runCommand(
      build({
        kind: "swarm",
        responder: failing(
          "Error response from daemon: This node is not a swarm manager. Worker nodes can't be used to view or modify cluster state. Please run this command on a manager node or promote the current node to a manager.\n",
        ),
      }),
      "docker node ls",
      { kind: "swarm" },
    );

    assert.match(
      result.errorMessage!,
      /run the Docker Swarm AI agent on a manager node, next to the collector\.$/,
    );
  });

  test("a spawn that throws is a failed result, never an exception", async () => {
    const built: Built = build();
    const throwing: SpawnFunction = ((): never => {
      throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    }) as unknown as SpawnFunction;
    const executor: DockerExecutor = new DockerExecutor(
      {
        config: built.config,
        env: {},
        tmpDir,
        logger: built.logger,
        spawnImpl: throwing,
      },
      { procRoot: emptyProc },
    );

    const result: ExecResult = await expectPrepared(
      executor.prepare(request("docker ps")),
    ).run();

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage: "Could not start docker: spawn EACCES",
    });
  });

  test("a job directory it cannot make is a failed result, and nothing runs", async () => {
    const notADirectory: string = path.join(tmpDir, "a-file");
    fs.writeFileSync(notADirectory, "x");
    const built: Built = build({ tmpDir: notADirectory });

    const result: ExecResult = await runCommand(built, "docker ps");

    assert.strictEqual(result.success, false);
    assert.match(
      result.errorMessage!,
      /^Could not prepare a private directory for docker: /,
    );
    assert.deepStrictEqual(built.docker.calls, []);
  });

  test("describeDockerFailure only speaks up for the engine's own complaints", () => {
    const base: {
      dockerHost: string;
      resourceType: AiResourceType;
      apiVersion: string | null;
    } = {
      dockerHost: DEFAULT_DOCKER_ENGINE_HOST,
      resourceType: AiResourceType.DockerHost,
      apiVersion: null,
    };

    for (const stderr of [
      "Error response from daemon: No such container: web-9",
      "Error: No such object: web-9",
      "Error response from daemon: Cannot restart container web-1: tried to kill container, but did not receive an exit event",
      "",
    ]) {
      assert.strictEqual(
        describeDockerFailure({ ...base, stderr }),
        null,
        stderr,
      );
    }

    // Without a pin, the numbers come from the engine's own message.
    assert.match(
      describeDockerFailure({
        ...base,
        stderr:
          "client version 1.52 is too new. Maximum supported API version is 1.43",
      })!,
      /^The Docker engine speaks Docker API 1\.43 at most, and the docker CLI asked for 1\.52: set DOCKER_API_VERSION=1\.43 on the AI agent\.$/,
    );
    assert.match(
      describeDockerFailure({
        ...base,
        stderr:
          "client version 1.24 is too old. Minimum supported API version is 1.44",
      })!,
      /^The Docker engine needs Docker API 1\.44 or newer, and the docker CLI asked for 1\.24: set DOCKER_API_VERSION=1\.44 on the AI agent\.$/,
    );
    assert.match(
      describeDockerFailure({
        ...base,
        stderr: "Error response from daemon: This node is not part of a swarm",
      })!,
      /not part of a swarm/,
    );
  });
});

// ---- probePosture() ------------------------------------------------------------------------

describe("probePosture", () => {
  test("a Docker engine: its version, reachable, the details and what it protects", async () => {
    const built: Built = build();
    const probe: ResourcePostureProbe = await built.executor.probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: "29.4.3",
      reachable: true,
      reachError: null,
      details: {
        dockerHost: DEFAULT_DOCKER_ENGINE_HOST,
        engine: "docker",
        apiVersion: "1.52",
        swarmRole: "inactive",
        rootless: false,
      },
      protectedTargets: [...ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES],
    });
  });

  test("it runs docker version and docker info, in the same closed environment, and nothing else when it runs outside a container", async () => {
    const built: Built = build({
      env: { ONEUPTIME_SERVICE_TOKEN: "k", DOCKER_API_VERSION: "1.44" },
    });
    await built.executor.probePosture();

    assert.deepStrictEqual(built.docker.argvs().sort(), [
      [...DOCKER_INFO_PROBE_ARGS],
      [...DOCKER_VERSION_PROBE_ARGS],
    ]);

    for (const call of built.docker.calls) {
      assert.strictEqual(call.binary, DOCKER_BINARY);
      assert.deepStrictEqual(Object.keys(call.env).sort(), [
        "DOCKER_API_VERSION",
        "DOCKER_CLI_HINTS",
        "DOCKER_CONFIG",
        "DOCKER_HOST",
        "HOME",
        "NO_COLOR",
        "PATH",
      ]);
      assert.deepStrictEqual(call.dockerConfig.entries, []);
    }
  });

  test("Podman behind the socket: Podman's version, rootless, and the Podman socket", async () => {
    const built: Built = build({
      kind: "podman",
      responder: (args: Array<string>): FakeReply => {
        if (args[0] === "version") {
          return { stdout: PODMAN_VERSION_JSON };
        }
        if (args[0] === "info") {
          return {
            stdout: infoJson({
              securityOptions: [
                "name=seccomp,profile=default",
                "name=rootless",
              ],
            }),
          };
        }
        return healthyDocker(args);
      },
    });

    const probe: ResourcePostureProbe = await built.executor.probePosture();

    assert.strictEqual(probe.toolVersion, "5.2.1");
    assert.strictEqual(probe.reachable, true);
    assert.deepStrictEqual(probe.details, {
      dockerHost: DEFAULT_PODMAN_ENGINE_HOST,
      engine: "podman",
      apiVersion: "1.41",
      swarmRole: "inactive",
      rootless: true,
    });
    assert.deepStrictEqual(built.logger.records, []);
  });

  test("an agent whose socket is the other engine says so once in its log", async () => {
    const built: Built = build({
      responder: (args: Array<string>): FakeReply => {
        return args[0] === "version"
          ? { stdout: PODMAN_VERSION_JSON }
          : healthyDocker(args);
      },
    });

    await built.executor.probePosture();
    await built.executor.probePosture();

    const warnings: Array<string> = built.logger.records
      .filter((record: { level: string }): boolean => {
        return record.level === "warn";
      })
      .map((record: { message: string }): string => {
        return record.message;
      });
    assert.deepStrictEqual(warnings, [
      "The engine at unix:///var/run/docker.sock is Podman, but this agent serves a Docker host. Check ONEUPTIME_AI_AGENT_RESOURCE_TYPE and DOCKER_HOST.",
    ]);
  });

  const SWARM_CASES: Array<{
    name: string;
    info: Parameters<typeof infoJson>[0];
    role: string;
    reachError: RegExp | null;
  }> = [
    {
      name: "a manager",
      info: { swarmState: "active", controlAvailable: true },
      role: "manager",
      reachError: null,
    },
    {
      name: "a worker",
      info: { swarmState: "active", controlAvailable: false },
      role: "worker",
      reachError:
        /^This Docker engine is a swarm worker, and swarm commands \(docker node ls, docker service \.\.\.\) only work on a manager\. Run the Docker Swarm AI agent on a manager node, next to the collector\.$/,
    },
    {
      name: "not in a swarm",
      info: { swarmState: "inactive" },
      role: "inactive",
      reachError: /^This Docker engine is not part of a swarm\./,
    },
    {
      name: "a locked manager",
      info: { swarmState: "locked", controlAvailable: false },
      role: "inactive",
      reachError: /^The swarm is locked on this manager .* docker swarm unlock/,
    },
    {
      name: "a node in error",
      info: {
        swarmState: "error",
        swarmError:
          "manager stopped: Authorization: Bearer abcdef0123456789abcdef",
      },
      role: "inactive",
      reachError:
        /^This engine's swarm membership is "error": manager stopped: Authorization: \[redacted\][^.]*\. The Docker Swarm AI agent needs a healthy manager node\.$/,
    },
  ];

  for (const swarmCase of SWARM_CASES) {
    test(`swarm on ${swarmCase.name}`, async () => {
      const probe: ResourcePostureProbe = await build({
        kind: "swarm",
        responder: (args: Array<string>): FakeReply => {
          return args[0] === "info"
            ? { stdout: infoJson(swarmCase.info) }
            : healthyDocker(args);
        },
      }).executor.probePosture();

      assert.strictEqual(probe.details!["swarmRole"], swarmCase.role);
      assert.strictEqual(probe.toolVersion, "29.4.3");

      if (swarmCase.reachError === null) {
        assert.strictEqual(probe.reachable, true);
        assert.strictEqual(probe.reachError, null);
      } else {
        assert.strictEqual(probe.reachable, false);
        assert.match(String(probe.reachError), swarmCase.reachError);
        // What the engine said is redacted before it becomes the reason.
        assert.ok(!String(probe.reachError).includes("abcdef0123456789"));
      }
    });
  }

  test("a Docker host on a swarm worker is reachable: the role is only reported", async () => {
    const probe: ResourcePostureProbe = await build({
      responder: (args: Array<string>): FakeReply => {
        return args[0] === "info"
          ? { stdout: infoJson({ swarmState: "active" }) }
          : healthyDocker(args);
      },
    }).executor.probePosture();

    assert.strictEqual(probe.reachable, true);
    assert.strictEqual(probe.details!["swarmRole"], "worker");
  });

  test("an engine that does not answer: unreachable, with the reason and what to change", async () => {
    const probe: ResourcePostureProbe = await build({
      responder: (): FakeReply => {
        return {
          stdout: CLIENT_ONLY_VERSION_JSON,
          stderr:
            "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n",
          exitCode: 1,
        };
      },
    }).executor.probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: null,
      reachable: false,
      reachError:
        "The agent cannot reach the Docker engine at unix:///var/run/docker.sock (docker version: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?). The AI agent cannot reach the Docker engine at unix:///var/run/docker.sock: mount the socket into the AI agent container (-v /var/run/docker.sock:/var/run/docker.sock:ro, as the collector does) and check that the Docker daemon is running.",
      details: { dockerHost: DEFAULT_DOCKER_ENGINE_HOST },
      protectedTargets: [...ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES],
    });
  });

  test("what docker said is redacted before it becomes the posture's reason", async () => {
    const probe: ResourcePostureProbe = await build({
      responder: (): FakeReply => {
        return {
          stderr:
            "unexpected answer, Authorization: Bearer abcdef0123456789abcdef\n",
          exitCode: 1,
        };
      },
    }).executor.probePosture();

    assert.match(String(probe.reachError), /Authorization: \[redacted\]/);
    assert.ok(!String(probe.reachError).includes("abcdef0123456789"));
  });

  test("the docker binary is missing", async () => {
    const probe: ResourcePostureProbe = await build({
      responder: (): FakeReply => {
        return { errorCode: "ENOENT" };
      },
    }).executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(
      probe.reachError,
      "docker is not installed in this container (/usr/bin/docker was not found). Use the oneuptime/resource-ai-agent image, which includes it.",
    );
  });

  test("an engine that never answers is killed within the probe's own budget", async () => {
    const built: Built = build({
      settings: { probeTimeoutMs: 100 },
      responder: (): FakeReply => {
        return { hang: true };
      },
    });

    const probe: ResourcePostureProbe = await built.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(
      probe.reachError,
      "docker version did not answer within 0.1s: the Docker engine at unix:///var/run/docker.sock never answered: check that the daemon is running and not hung.",
    );
    for (const child of built.docker.children) {
      assert.deepStrictEqual(child.killed, ["SIGKILL"]);
    }
  });

  test("an answer that is not the engine's version", async () => {
    const garbage: ResourcePostureProbe = await build({
      responder: (args: Array<string>): FakeReply => {
        return args[0] === "version"
          ? { stdout: "hello" }
          : healthyDocker(args);
      },
    }).executor.probePosture();

    assert.strictEqual(garbage.reachable, false);
    assert.match(
      String(garbage.reachError),
      /^docker version answered, but not with the engine's version \(its output is not JSON\)\. Check that unix:\/\/\/var\/run\/docker\.sock is a Docker engine\.$/,
    );

    const clientOnly: ResourcePostureProbe = await build({
      responder: (args: Array<string>): FakeReply => {
        return args[0] === "version"
          ? { stdout: CLIENT_ONLY_VERSION_JSON }
          : healthyDocker(args);
      },
    }).executor.probePosture();

    assert.match(String(clientOnly.reachError), /it printed no Server section/);
  });

  test("docker info failing on a Docker host: still reachable, without a swarm role", async () => {
    const probe: ResourcePostureProbe = await build({
      responder: (args: Array<string>): FakeReply => {
        return args[0] === "info"
          ? { stderr: "Error: something odd\n", exitCode: 1 }
          : healthyDocker(args);
      },
    }).executor.probePosture();

    assert.strictEqual(probe.reachable, true);
    assert.deepStrictEqual(probe.details, {
      dockerHost: DEFAULT_DOCKER_ENGINE_HOST,
      engine: "docker",
      apiVersion: "1.52",
    });
  });

  test("docker info failing on a swarm agent: it cannot tell it is on a manager, so unreachable", async () => {
    const probe: ResourcePostureProbe = await build({
      kind: "swarm",
      responder: (args: Array<string>): FakeReply => {
        return args[0] === "info"
          ? { stderr: "Error: something odd\n", exitCode: 1 }
          : healthyDocker(args);
      },
    }).executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /^The agent could not read this engine's swarm state, so it cannot tell whether it runs on a manager: The agent cannot reach the Docker engine at unix:\/\/\/var\/run\/docker\.sock \(docker info: Error: something odd\)\.$/,
    );
  });

  test("an engine address it cannot use: unreachable, and nothing runs", async () => {
    const built: Built = build({
      env: { DOCKER_HOST: "tcp://admin:pw@10.0.0.5:2376/path" },
    });
    const probe: ResourcePostureProbe = await built.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /^DOCKER_HOST="tcp:\/\/10\.0\.0\.5:2376\/path" is not an engine address this agent can use/,
    );
    assert.deepStrictEqual(probe.details, {
      dockerHost: "tcp://10.0.0.5:2376/path",
    });
    assert.deepStrictEqual(built.docker.calls, []);
  });

  test("a probe never throws", async () => {
    const built: Built = build();
    const executor: DockerExecutor = new DockerExecutor(
      {
        config: built.config,
        env: {},
        tmpDir,
        logger: built.logger,
        spawnImpl: ((): never => {
          throw new Error("spawn exploded");
        }) as unknown as SpawnFunction,
      },
      { procRoot: emptyProc },
    );

    const probe: ResourcePostureProbe = await executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(
      probe.reachError,
      "Could not start docker: spawn exploded",
    );
    assert.strictEqual(probe.toolVersion, null);
  });

  test("its own container: the id from /proc, the name from the engine, looked up once", async () => {
    const built: Built = build({ settings: { procRoot: ownProc } });

    const first: ResourcePostureProbe = await built.executor.probePosture();
    const second: ResourcePostureProbe = await built.executor.probePosture();

    assert.deepStrictEqual(first.protectedTargets, [
      OWN_ID,
      "my-ai-agent",
      ...ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES,
    ]);
    assert.deepStrictEqual(second.protectedTargets, first.protectedTargets);
    assert.strictEqual(
      built.docker.argvs().filter((argv: Array<string>): boolean => {
        return argv[0] === "container";
      }).length,
      1,
    );
    assert.strictEqual(built.executor.getOwnContainerId(), OWN_ID);
  });

  test("ONEUPTIME_AI_PROTECTED_TARGETS is reported with the rest", async () => {
    const probe: ResourcePostureProbe = await build({
      config: { ONEUPTIME_AI_PROTECTED_TARGETS: "db-*, traefik" },
    }).executor.probePosture();

    assert.deepStrictEqual(probe.protectedTargets, [
      ...ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES,
      "db-*",
      "traefik",
    ]);
  });
});

// ---- The whole agent path: server, job loop, this executor --------------------------------

describe("end to end: OneUptime, the job loop and this executor", () => {
  let server: FakeOneUptime;
  let status: AgentStatus;
  let session: AgentSession | null = null;
  let loop: JobLoop | null = null;

  before(async (): Promise<void> => {
    server = new FakeOneUptime();
    await server.start();
  });

  after(async (): Promise<void> => {
    await server.stop();
  });

  afterEach(async (): Promise<void> => {
    if (loop) {
      await loop.stop(5_000);
      loop = null;
    }
    if (session) {
      await session.stop();
      session = null;
    }
    server.reset();
  });

  async function start(built: Built): Promise<void> {
    status = new AgentStatus();
    const probe: PostureProbe = new PostureProbe({ executor: built.executor });
    const client: IngestClient = new IngestClient({
      oneuptimeUrl: server.url,
      apiKey: "k",
    });

    session = new AgentSession({
      client,
      config: built.config,
      status,
      getPosture: async (): Promise<AgentPosture> => {
        return buildPosture({
          config: built.config,
          resourceType: built.config.resourceType!,
          resourceIdentifier: built.config.resourceIdentifier!,
          probe: await probe.get(),
        });
      },
      sleep: recordingSleep().sleep,
    });
    await session.ensureRegistered();

    loop = new JobLoop({
      client,
      session,
      executor: built.executor,
      resourceType: built.config.resourceType!,
      status,
      pollIntervalMs: 60_000,
      sleep: recordingSleep().sleep,
    });
  }

  function results(): Array<Record<string, unknown>> {
    return server
      .requestsTo("/job/:id/result")
      .map((recorded: RecordedRequest): Record<string, unknown> => {
        // Everything but the agent's credentials (the job loop's own tests check those).
        const rest: Record<string, unknown> = { ...recorded.body };
        delete rest["agentId"];
        delete rest["agentKey"];
        return rest;
      });
  }

  test("registration carries what the probe saw: the engine, its version, what the agent protects", async () => {
    const built: Built = build({ settings: { procRoot: ownProc } });
    await start(built);

    const posture: Record<string, unknown> = server.requestsTo("/register")[0]!
      .body["posture"] as Record<string, unknown>;

    assert.strictEqual(posture["reachable"], true);
    assert.strictEqual(posture["toolVersion"], "29.4.3");
    assert.deepStrictEqual(posture["details"], {
      dockerHost: DEFAULT_DOCKER_ENGINE_HOST,
      engine: "docker",
      apiVersion: "1.52",
      swarmRole: "inactive",
      rootless: false,
    });
    assert.deepStrictEqual(posture["protectedTargets"], [
      OWN_ID,
      "my-ai-agent",
      ...ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES,
    ]);
    assert.strictEqual(posture["allowWrites"], false);
  });

  test("a fix OneUptime approved runs, and its output goes back", async () => {
    const built: Built = build({ config: WRITES });
    await start(built);
    const job: ResourceCommandRequest = request("docker restart web-1");
    server.script(
      "/claim-next-job",
      jobReply({ origin: "AiRemediation", payload: job.payload }),
    );
    built.docker.clear();

    assert.strictEqual(await loop!.tick(), true);

    assert.deepStrictEqual(built.docker.argvs(), [["restart", "web-1"]]);
    assert.deepStrictEqual(results(), [
      { success: true, output: "[stdout]\nran restart web-1\n", exitCode: 0 },
    ]);
  });

  test("a change inside an investigation is refused on the agent, reported without an exit code", async () => {
    const built: Built = build({ config: WRITES });
    await start(built);
    const job: ResourceCommandRequest = request("docker restart web-1");
    server.script(
      "/claim-next-job",
      jobReply({ origin: "AiInvestigation", payload: job.payload }),
    );
    built.docker.clear();

    await loop!.tick();

    assert.deepStrictEqual(built.docker.calls, []);
    const [result] = results();
    assert.strictEqual(result!["success"], false);
    assert.strictEqual("exitCode" in result!, false);
    assert.match(
      String(result!["errorMessage"]),
      /^Refused by the Docker AI agent: an investigation may only run read-only commands/,
    );
  });
});

describe("pure helpers", () => {
  test("the container id from /proc/self/mountinfo: Docker, rootful and rootless Podman", () => {
    const podmanId: string = "c0ffee".padEnd(64, "1");

    assert.strictEqual(
      parseContainerIdFromMountinfo(
        fs.readFileSync(path.join(ownProc, "self", "mountinfo"), "utf8"),
      ),
      OWN_ID,
    );
    assert.strictEqual(
      parseContainerIdFromMountinfo(
        `1203 1190 0:44 /containers/storage/overlay-containers/${podmanId}/userdata/hostname /etc/hostname rw,nosuid,nodev - tmpfs tmpfs rw`,
      ),
      podmanId,
    );
    assert.strictEqual(
      parseContainerIdFromMountinfo(
        `88 70 0:30 /home/ops/.local/share/containers/storage/overlay-containers/${podmanId}/userdata/hosts /etc/hosts rw - btrfs /dev/sda2 rw`,
      ),
      podmanId,
    );
  });

  test("mountinfo: only the engine's own bind mounts count", () => {
    assert.strictEqual(
      parseContainerIdFromMountinfo(
        `700 613 254:1 /var/lib/docker/containers/${OWN_ID}/logs /var/lib/docker/containers ro - ext4 /dev/vda1 rw`,
      ),
      null,
    );
    assert.strictEqual(
      parseContainerIdFromMountinfo(
        "623 613 254:1 /etc/hostname /etc/hostname rw - ext4 /dev/vda1 rw",
      ),
      null,
    );
    assert.strictEqual(parseContainerIdFromMountinfo(""), null);
  });

  test("the container id from /proc/self/cgroup", () => {
    assert.strictEqual(
      parseContainerIdFromCgroup(
        `12:memory:/docker/${OWN_ID}\n11:cpu,cpuacct:/docker/${OWN_ID}\n`,
      ),
      OWN_ID,
    );
    assert.strictEqual(
      parseContainerIdFromCgroup(`0::/system.slice/docker-${OWN_ID}.scope\n`),
      OWN_ID,
    );
    assert.strictEqual(
      parseContainerIdFromCgroup(
        `0::/machine.slice/libpod-${OWN_ID}.scope/container\n`,
      ),
      OWN_ID,
    );
    assert.strictEqual(parseContainerIdFromCgroup("0::/\n"), null);
    assert.strictEqual(
      parseContainerIdFromCgroup("0::/user.slice/user-1000.slice\n"),
      null,
    );
  });

  test("with no mountinfo answer, the cgroup names the container", () => {
    const procRoot: string = makeTempDir("agent-docker-proc-cgroup-");

    try {
      fs.mkdirSync(path.join(procRoot, "self"));
      fs.writeFileSync(
        path.join(procRoot, "self", "mountinfo"),
        "1 0 0:1 / / rw - overlay overlay rw\n",
      );
      fs.writeFileSync(
        path.join(procRoot, "self", "cgroup"),
        `0::/system.slice/docker-${OWN_ID}.scope\n`,
      );

      assert.strictEqual(
        build({ settings: { procRoot } }).executor.getOwnContainerId(),
        OWN_ID,
      );
      assert.strictEqual(build().executor.getOwnContainerId(), null);
    } finally {
      fs.rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test("parseDockerVersion: Docker, Podman, no engine, not JSON", () => {
    assert.deepStrictEqual(parseDockerVersion(DOCKER_VERSION_JSON), {
      hasServer: true,
      serverVersion: "29.4.3",
      apiVersion: "1.52",
      engine: "docker",
    } as DockerVersionFacts);
    assert.deepStrictEqual(parseDockerVersion(PODMAN_VERSION_JSON), {
      hasServer: true,
      serverVersion: "5.2.1",
      apiVersion: "1.41",
      engine: "podman",
    } as DockerVersionFacts);
    assert.strictEqual(
      parseDockerVersion(
        JSON.stringify({
          Server: { Platform: { Name: "Podman Engine" }, Version: "4.9.3" },
        }),
      )!.engine,
      "podman",
    );
    assert.strictEqual(
      parseDockerVersion(CLIENT_ONLY_VERSION_JSON)!.hasServer,
      false,
    );
    assert.strictEqual(parseDockerVersion("not json"), null);
    assert.strictEqual(parseDockerVersion("[]"), null);
  });

  test("parseDockerInfo: swarm roles, rootless, server errors", () => {
    const manager: DockerInfoFacts = parseDockerInfo(
      infoJson({ swarmState: "active", controlAvailable: true }),
    )!;
    assert.strictEqual(manager.swarmRole, "manager");
    assert.strictEqual(manager.rootless, false);

    assert.strictEqual(
      parseDockerInfo(infoJson({ swarmState: "active" }))!.swarmRole,
      "worker",
    );
    assert.strictEqual(
      parseDockerInfo(
        infoJson({ swarmState: "pending", controlAvailable: true }),
      )!.swarmRole,
      "inactive",
    );
    assert.strictEqual(
      parseDockerInfo(
        infoJson({
          securityOptions: ["name=seccomp,profile=builtin,name=rootless"],
        }),
      )!.rootless,
      true,
    );

    const bare: DockerInfoFacts = parseDockerInfo(
      JSON.stringify({ ServerErrors: ["Cannot connect", 5] }),
    )!;
    assert.deepStrictEqual(bare, {
      swarmState: "",
      swarmRole: "inactive",
      swarmError: null,
      rootless: null,
      serverErrors: ["Cannot connect"],
    });
    assert.strictEqual(parseDockerInfo("{"), null);
  });

  test("parseOwnContainerInspect", () => {
    assert.deepStrictEqual(
      parseOwnContainerInspect(
        inspectJson("oneuptime-docker-ai-agent", {
          "com.docker.swarm.service.name": "ops_ai",
          "com.docker.stack.namespace": "ops",
        }),
      ),
      {
        name: "oneuptime-docker-ai-agent",
        swarmServiceName: "ops_ai",
        stackNamespace: "ops",
      },
    );
    assert.deepStrictEqual(parseOwnContainerInspect(JSON.stringify([{}])), {
      name: null,
      swarmServiceName: null,
      stackNamespace: null,
    });
    assert.strictEqual(parseOwnContainerInspect("[]"), null);
    assert.strictEqual(parseOwnContainerInspect("nope"), null);
  });

  test("resolveDockerHost: a socket or plain tcp, else a problem", () => {
    const resolve: (
      value: string | undefined,
      type?: AiResourceType,
    ) => DockerHostResolution = (
      value: string | undefined,
      type: AiResourceType = AiResourceType.DockerHost,
    ): DockerHostResolution => {
      return resolveDockerHost(
        value === undefined ? {} : { DOCKER_HOST: value },
        type,
      );
    };

    assert.deepStrictEqual(resolve(undefined), {
      dockerHost: DEFAULT_DOCKER_ENGINE_HOST,
      fromEnvironment: false,
      problem: null,
    });
    assert.strictEqual(
      resolve("  ", AiResourceType.PodmanHost).dockerHost,
      DEFAULT_PODMAN_ENGINE_HOST,
    );
    assert.strictEqual(
      resolve(undefined, AiResourceType.DockerSwarmCluster).dockerHost,
      DEFAULT_DOCKER_ENGINE_HOST,
    );

    for (const good of [
      "unix:///var/run/docker.sock",
      "unix:///run/user/1000/podman/podman.sock",
      "tcp://10.0.0.5:2375",
      "tcp://docker.internal",
      "tcp://[fd00::5]:2375",
    ]) {
      const resolved: DockerHostResolution = resolve(good);
      assert.strictEqual(resolved.problem, null, good);
      assert.strictEqual(resolved.dockerHost, good);
      assert.strictEqual(resolved.fromEnvironment, true);
    }

    for (const bad of [
      "ssh://ops@build-host",
      "unix://relative.sock",
      "unix:///",
      "unix:///var/run/docker sock",
      "tcp://user:pw@10.0.0.5:2375",
      "tcp://10.0.0.5:2375/v1.41",
      "tcp://10.0.0.5:2375?x=1",
      "tcp://",
      "http://10.0.0.5:2375",
      "npipe:////./pipe/docker_engine",
      "fd://",
      "/var/run/docker.sock",
    ]) {
      assert.match(
        String(resolve(bad).problem),
        /^DOCKER_HOST=".*" is not an engine address this agent can use/,
        bad,
      );
    }
  });

  test("describeDockerHost never shows credentials", () => {
    assert.strictEqual(
      describeDockerHost("tcp://admin:hunter2@10.0.0.5:2375"),
      "tcp://10.0.0.5:2375",
    );
    assert.strictEqual(describeDockerHost("ssh://ops@host"), "ssh://host");
    assert.strictEqual(
      describeDockerHost(" unix:///var/run/docker.sock "),
      "unix:///var/run/docker.sock",
    );
  });

  test("buildDockerEnvironment is exactly the documented set", () => {
    assert.deepStrictEqual(
      buildDockerEnvironment({
        dockerHost: "unix:///var/run/docker.sock",
        apiVersion: null,
        homeDir: "/tmp/j/home",
        dockerConfigDir: "/tmp/j/docker-config",
      }),
      {
        PATH: DEFAULT_SPAWN_PATH,
        HOME: "/tmp/j/home",
        DOCKER_CONFIG: "/tmp/j/docker-config",
        DOCKER_HOST: "unix:///var/run/docker.sock",
        DOCKER_CLI_HINTS: "false",
        NO_COLOR: "1",
      },
    );
    assert.strictEqual(
      buildDockerEnvironment({
        dockerHost: "tcp://h:2375",
        apiVersion: "1.41",
        homeDir: "/h",
        dockerConfigDir: "/c",
      })["DOCKER_API_VERSION"],
      "1.41",
    );
    assert.strictEqual(
      readDockerApiVersion({ DOCKER_API_VERSION: " 1.44 " }),
      "1.44",
    );
    assert.strictEqual(readDockerApiVersion({ DOCKER_API_VERSION: "" }), null);
    assert.strictEqual(readDockerApiVersion({}), null);
  });

  test("engine labels and default sockets per type", () => {
    assert.strictEqual(getEngineLabel(AiResourceType.DockerHost), "Docker");
    assert.strictEqual(getEngineLabel(AiResourceType.PodmanHost), "Podman");
    assert.strictEqual(
      getEngineLabel(AiResourceType.DockerSwarmCluster),
      "Docker",
    );
    assert.strictEqual(getDefaultDockerHost(null), DEFAULT_DOCKER_ENGINE_HOST);
    assert.strictEqual(
      getDefaultDockerHost(AiResourceType.PodmanHost),
      DEFAULT_PODMAN_ENGINE_HOST,
    );
  });

  test("the protected names match the collectors' own compose files and install scripts", () => {
    const repoAgents: string = path.resolve(__dirname, "..", "..", "..", "..");
    const sources: Record<string, Array<string>> = {
      DockerAgent: ["docker-compose.yml", "install.sh"],
      PodmanAgent: ["docker-compose.yml", "install.sh"],
      DockerSwarmAgent: ["docker-compose.yml"],
    };
    const named: Set<string> = new Set<string>();

    for (const [agent, files] of Object.entries(sources)) {
      for (const file of files) {
        const text: string = fs.readFileSync(
          path.join(repoAgents, agent, file),
          "utf8",
        );

        for (const match of text.matchAll(
          /(?:container_name:\s*|--name\s+)(oneuptime-[a-z-]+)/g,
        )) {
          named.add(match[1]!);
        }
      }
    }

    assert.deepStrictEqual(
      [...named].sort(),
      [...ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES].sort(),
    );
  });
});

describe("job directories and the factory", () => {
  test("the start-up sweep removes what a previous run left behind, and says so once", async () => {
    const built: Built = build();
    const leftover: string = path.join(tmpDir, JOB_DIR_PARENT_NAME, "job-old");
    fs.mkdirSync(path.join(leftover, DOCKER_CONFIG_DIR_NAME), {
      recursive: true,
    });

    await built.executor.sweepOrphanedJobDirs();
    await built.executor.sweepOrphanedJobDirs();

    assert.strictEqual(fs.existsSync(leftover), false);
    assert.deepStrictEqual(built.logger.records, [
      {
        level: "info",
        message: "Removed job directories a previous run left behind",
      },
    ]);
  });

  test("shutdown removes everything, and never throws", async () => {
    const built: Built = build();
    fs.mkdirSync(path.join(tmpDir, JOB_DIR_PARENT_NAME, "job-running"), {
      recursive: true,
    });

    await built.executor.removeAllJobDirs();

    assert.deepStrictEqual(
      fs.readdirSync(path.join(tmpDir, JOB_DIR_PARENT_NAME)),
      [],
    );
  });

  test("Docker hosts, Podman hosts and Docker Swarm clusters get this executor", () => {
    for (const kind of ["docker", "podman", "swarm"] as Array<Kind>) {
      assert.strictEqual(EXECUTOR_CLASSES[KIND_TYPE[kind]], DockerExecutor);

      const executor: ResourceExecutor = createExecutor({
        config: testConfig(URL, KIND_ENV[kind]),
        env: {},
        tmpDir,
        logger: recordingLogger(),
      });
      assert.ok(executor instanceof DockerExecutor, kind);
    }
  });

  test("the constructor runs nothing and reads nothing it does not need", () => {
    const built: Built = build({ settings: { procRoot: ownProc } });

    assert.deepStrictEqual(built.docker.calls, []);
    assert.strictEqual(built.executor.getDockerBinary(), DOCKER_BINARY);
    assert.strictEqual(
      built.executor.getDockerHost().dockerHost,
      DEFAULT_DOCKER_ENGINE_HOST,
    );
  });
});
