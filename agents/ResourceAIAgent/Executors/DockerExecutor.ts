import fs from "fs";
import path from "path";
import PrepareGuard, {
  GuardResult,
  GuardedCommand,
  mergeTargets,
  refusalPrefix,
} from "./PrepareGuard";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  ResourceCommandRequest,
  ResourceExecutor,
  ResourcePostureProbe,
} from "./ResourceExecutor";
import SpawnSandbox, {
  DEFAULT_SPAWN_PATH,
  SandboxCapture,
  SandboxJobDirectory,
  describeMissingBinary,
  lastStderrLine,
  redactOutput,
} from "./SpawnSandbox";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  isAiResourceType,
} from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The executor for Docker hosts, Podman hosts and Docker Swarm clusters:
 * the docker CLI (the image's /usr/bin/docker) against the engine socket.
 * Podman is driven through its Docker-compatible API with the same CLI and
 * the same engine policy; a swarm through a manager node's engine with the
 * swarm policy. See ResourceExecutor for the contract every executor keeps.
 *
 * prepare() runs PrepareGuard first (the byte-identical policy re-check,
 * investigation implies Read, the write switch and write scope, the
 * resource's identity) with THIS executor's protected targets — the agent's
 * own container (its id from /proc, its name and swarm service from the
 * engine), the collector containers beside it and the other OneUptime
 * docker-family agents — then checks the engine address, and refuses any
 * change while it has not yet been able to look its own container up.
 *
 * The docker CLI then runs through SpawnSandbox:
 *
 *   - argv = the payload's args exactly as the policy normalized them. No
 *     global flag is ever added (and the policy refuses any the command
 *     carries): -H, --context and --config are exactly what would point the
 *     CLI at another engine or another credential store.
 *   - a CLOSED environment: PATH; HOME = the command's private, empty home;
 *     DOCKER_CONFIG = an empty private directory in the job directory, so no
 *     config.json, context, credential helper or CLI plugin of anyone's can
 *     change where the CLI points or what it runs; DOCKER_HOST from the
 *     agent's environment (the engine socket for the resource type by
 *     default); DOCKER_API_VERSION only when the operator set one;
 *     DOCKER_CLI_HINTS=false and NO_COLOR=1 so the output is plain. Nothing
 *     else of the agent's environment — not its ingestion key, not its proxy
 *     settings, not a DOCKER_CONTEXT or DOCKER_CERT_PATH — reaches the CLI.
 *   - output capped and redacted (docker inspect "Env" values, tokens, ...)
 *     before it leaves the agent; a timeout kills the CLI.
 *
 * Every failure is {success: false, errorMessage}; the engine's usual
 * complaints (no socket, permission denied, an API version pin the engine
 * does not speak, a swarm worker) come with what the operator should change.
 */

// The docker CLI in the agent image (Alpine's docker-cli package).
export const DOCKER_BINARY: string = "/usr/bin/docker";

// The program the policy tiers and the output belongs to.
export const DOCKER_PROGRAM: string = "docker";

// The agent's settings for reaching the engine (read from its environment).
export const DOCKER_HOST_ENV: string = "DOCKER_HOST";
export const DOCKER_API_VERSION_ENV: string = "DOCKER_API_VERSION";

// Where each engine's socket is when DOCKER_HOST is not set.
export const DEFAULT_DOCKER_ENGINE_HOST: string = "unix:///var/run/docker.sock";
export const DEFAULT_PODMAN_ENGINE_HOST: string =
  "unix:///run/podman/podman.sock";

// Inside each job directory: the empty, private DOCKER_CONFIG.
export const DOCKER_CONFIG_DIR_NAME: string = "docker-config";

/*
 * The posture probe's own commands (never AI-composed, never through the
 * policy): `docker version` and `docker info`, in parallel, then — once — the
 * agent's own container. Short budgets: the whole probe must fit well inside
 * the posture's 15-second limit (Posture.DEFAULT_PROBE_TIMEOUT_MS).
 */
export const PROBE_TIMEOUT_MS: number = 6_000;
export const OWN_CONTAINER_PROBE_TIMEOUT_MS: number = 4_000;
export const DOCKER_VERSION_PROBE_ARGS: ReadonlyArray<string> = [
  "version",
  "--format",
  "json",
];
export const DOCKER_INFO_PROBE_ARGS: ReadonlyArray<string> = [
  "info",
  "--format",
  "json",
];

/*
 * The containers of OneUptime's docker-family agents — the collectors and
 * their AI agents, as their docker-compose.yml files and install.sh scripts
 * name them. OneUptime AI never changes them, on whichever of these engines
 * they run (a swarm manager can run the Docker host collector too).
 */
export const ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES: ReadonlyArray<string> = [
  // agents/DockerAgent
  "oneuptime-docker-agent",
  "oneuptime-docker-ai-agent",
  // agents/PodmanAgent
  "oneuptime-podman-agent",
  "oneuptime-podman-ai-agent",
  // agents/DockerSwarmAgent: the collector, its inventory sidecar, the AI agent
  "oneuptime-docker-swarm-agent",
  "oneuptime-docker-swarm-inventory",
  "oneuptime-docker-swarm-ai-agent",
];

// Labels on the agent's own container that name what it belongs to.
const SWARM_SERVICE_NAME_LABEL: string = "com.docker.swarm.service.name";
const STACK_NAMESPACE_LABEL: string = "com.docker.stack.namespace";

// A full container id, as docker and podman write it.
const CONTAINER_ID_PATTERN: RegExp = /^[0-9a-f]{64}$/;

/*
 * /proc/self/mountinfo: the files the engine bind-mounts into every
 * container (/etc/hostname, /etc/hosts, /etc/resolv.conf) come from that
 * container's own directory: .../docker/containers/<id>/hostname,
 * .../storage/overlay-containers/<id>/userdata/hostname (podman).
 */
const MOUNTINFO_CONTAINER_ID_PATTERN: RegExp =
  /(?:^|\/)(?:overlay-)?containers\/([0-9a-f]{64})(?:\/|$)/;
const ENGINE_MANAGED_MOUNT_POINTS: ReadonlyArray<string> = [
  "/etc/hostname",
  "/etc/hosts",
  "/etc/resolv.conf",
];

/*
 * /proc/self/cgroup (cgroup v1, or v2 without a private cgroup namespace):
 * /docker/<id>, /system.slice/docker-<id>.scope, /machine.slice/libpod-<id>.scope.
 */
const CGROUP_CONTAINER_ID_PATTERN: RegExp =
  /(?:^|[/-])([0-9a-f]{64})(?=$|[/.])/g;

// Blanks or a NUL: never part of an engine address.
const BLANK_OR_NUL_PATTERN: RegExp = /[\s\0]/;

/*
 * The engine's usual complaints on stderr, which describeDockerFailure
 * turns into what the operator should change.
 */
const PERMISSION_DENIED_PATTERN: RegExp = /permission denied/i;
const SOCKET_ACCESS_PATTERN: RegExp = /socket|dial unix/i;
const API_VERSION_TOO_NEW_PATTERN: RegExp =
  /client version ([0-9]+\.[0-9]+) is too new\.? maximum supported api version is ([0-9]+\.[0-9]+)/i;
const API_VERSION_TOO_OLD_PATTERN: RegExp =
  /client version ([0-9]+\.[0-9]+) is too old\.? minimum supported api version is ([0-9]+\.[0-9]+)/i;
const NOT_A_SWARM_MANAGER_PATTERN: RegExp = /this node is not a swarm manager/i;
const NOT_IN_A_SWARM_PATTERN: RegExp = /this node is not part of a swarm/i;
const ENGINE_UNREACHABLE_PATTERNS: ReadonlyArray<RegExp> = [
  /cannot connect to the docker daemon/i,
  /dial unix [^:]*: connect: (?:no such file or directory|connection refused)/i,
  /error during connect/i,
];
// `docker container inspect` of an id this engine does not have.
const NO_SUCH_CONTAINER_PATTERN: RegExp = /no such (?:container|object)/i;

// The engine behind the socket.
export type DockerEngineKind = "docker" | "podman";

// The node's part in a swarm, as the posture reports it (details.swarmRole).
export type DockerSwarmRole = "manager" | "worker" | "inactive";

// Tests only: what the image and the container provide in production.
export interface DockerExecutorSettings {
  // The docker CLI to start; the image's /usr/bin/docker by default.
  dockerBinary?: string | undefined;
  // Where /proc is read from (the agent's own container id); "/proc" by default.
  procRoot?: string | undefined;
  // The budget of each posture probe command.
  probeTimeoutMs?: number | undefined;
  ownContainerProbeTimeoutMs?: number | undefined;
}

// ---- The engine address -----------------------------------------------------

export interface DockerHostResolution {
  // The engine address the CLI gets as DOCKER_HOST.
  dockerHost: string;
  // DOCKER_HOST came from the agent's environment (not the type's default).
  fromEnvironment: boolean;
  // Why the configured DOCKER_HOST cannot be used, or null.
  problem: string | null;
}

// "Docker" or "Podman": the engine a resource type expects, in sentences.
export function getEngineLabel(resourceType: AiResourceType | null): string {
  return resourceType === AiResourceType.PodmanHost ? "Podman" : "Docker";
}

// The engine socket a resource type uses when DOCKER_HOST is not set.
export function getDefaultDockerHost(
  resourceType: AiResourceType | null,
): string {
  return resourceType === AiResourceType.PodmanHost
    ? DEFAULT_PODMAN_ENGINE_HOST
    : DEFAULT_DOCKER_ENGINE_HOST;
}

/*
 * An engine address as it may be shown (logs, refusals, the posture): any
 * user:password@ part removed.
 */
export function describeDockerHost(value: string): string {
  return value.trim().replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}

// unix:// followed by an absolute path, without blanks.
function isUnixSocketAddress(value: string): boolean {
  if (!value.startsWith("unix://")) {
    return false;
  }

  const socketPath: string = value.slice("unix://".length);

  return (
    socketPath.startsWith("/") &&
    socketPath.length > 1 &&
    !BLANK_OR_NUL_PATTERN.test(socketPath)
  );
}

// tcp://HOST[:PORT], nothing else: no credentials, no path, no query.
function isTcpAddress(value: string): boolean {
  if (!value.startsWith("tcp://") || BLANK_OR_NUL_PATTERN.test(value)) {
    return false;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return (
    parsed.protocol === "tcp:" &&
    parsed.hostname.length > 0 &&
    parsed.username === "" &&
    parsed.password === "" &&
    (parsed.pathname === "" || parsed.pathname === "/") &&
    parsed.search === "" &&
    parsed.hash === ""
  );
}

/*
 * The engine address: DOCKER_HOST from the agent's environment, else the
 * type's socket. Only a unix socket or plain tcp://HOST:PORT: an ssh:// host
 * would need keys the agent must not have, and TLS client certificates are
 * never handed to the CLI (its environment is closed).
 */
export function resolveDockerHost(
  env: NodeJS.ProcessEnv,
  resourceType: AiResourceType | null,
): DockerHostResolution {
  const configured: string = (env[DOCKER_HOST_ENV] || "").trim();
  const fallback: string = getDefaultDockerHost(resourceType);

  if (!configured) {
    return { dockerHost: fallback, fromEnvironment: false, problem: null };
  }

  if (isUnixSocketAddress(configured) || isTcpAddress(configured)) {
    return { dockerHost: configured, fromEnvironment: true, problem: null };
  }

  return {
    dockerHost: configured,
    fromEnvironment: true,
    problem: `${DOCKER_HOST_ENV}="${describeDockerHost(
      configured,
    )}" is not an engine address this agent can use: it reaches the ${getEngineLabel(
      resourceType,
    )} engine through its socket (unix:///path/to/socket) or plain tcp://HOST:PORT (no ssh://, no TLS client certificates). Set ${DOCKER_HOST_ENV} on the AI agent to one of those, or leave it unset to use ${fallback}.`,
  };
}

// The DOCKER_API_VERSION the operator pinned, or null (the CLI negotiates).
export function readDockerApiVersion(env: NodeJS.ProcessEnv): string | null {
  const value: string = (env[DOCKER_API_VERSION_ENV] || "").trim();
  return value ? value : null;
}

/*
 * The docker CLI's COMPLETE environment for one command. Built from nothing
 * but these values: whatever else the agent's environment holds never
 * reaches the CLI.
 */
export function buildDockerEnvironment(data: {
  dockerHost: string;
  apiVersion: string | null;
  homeDir: string;
  dockerConfigDir: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: DEFAULT_SPAWN_PATH,
    HOME: data.homeDir,
    DOCKER_CONFIG: data.dockerConfigDir,
    DOCKER_HOST: data.dockerHost,
    DOCKER_CLI_HINTS: "false",
    NO_COLOR: "1",
  };

  if (data.apiVersion) {
    env[DOCKER_API_VERSION_ENV] = data.apiVersion;
  }

  return env;
}

// ---- The agent's own container ------------------------------------------------

/*
 * The agent's own container id from /proc/self/mountinfo: the source of the
 * /etc/hostname (or /etc/hosts, /etc/resolv.conf) bind mount the engine made
 * from the container's own directory. Null outside a container, or when
 * nothing names one.
 */
export function parseContainerIdFromMountinfo(text: string): string | null {
  for (const mountPoint of ENGINE_MANAGED_MOUNT_POINTS) {
    for (const line of (text || "").split("\n")) {
      // id parent major:minor root mount-point options ...
      const fields: Array<string> = line.trim().split(/\s+/);

      if (fields.length < 5 || fields[4] !== mountPoint) {
        continue;
      }

      const match: RegExpExecArray | null = MOUNTINFO_CONTAINER_ID_PATTERN.exec(
        fields[3] || "",
      );

      if (match && match[1]) {
        return match[1];
      }
    }
  }

  return null;
}

/*
 * The agent's own container id from /proc/self/cgroup, when the container
 * shares the host's cgroup namespace (cgroup v1, or v2 with
 * cgroupns=host). Null otherwise ("0::/").
 */
export function parseContainerIdFromCgroup(text: string): string | null {
  let found: string | null = null;

  for (const line of (text || "").split("\n")) {
    // hierarchy-id:controllers:path
    const cgroupPath: string = line.split(":").slice(2).join(":").trim();

    if (!cgroupPath) {
      continue;
    }

    CGROUP_CONTAINER_ID_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null =
      CGROUP_CONTAINER_ID_PATTERN.exec(cgroupPath);

    while (match) {
      if (match[1]) {
        // The innermost (last) id names the container itself.
        found = match[1];
      }
      match = CGROUP_CONTAINER_ID_PATTERN.exec(cgroupPath);
    }

    if (found) {
      return found;
    }
  }

  return null;
}

// What `docker container inspect` says about the agent's own container.
export interface OwnContainerFacts {
  name: string | null;
  // The swarm service it is a task of, when deployed as one.
  swarmServiceName: string | null;
  // The stack it was deployed with, when deployed with docker stack deploy.
  stackNamespace: string | null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// The first object of `docker container inspect ID`'s JSON array, read.
export function parseOwnContainerInspect(
  text: string,
): OwnContainerFacts | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse((text || "").trim());
  } catch {
    return null;
  }

  const container: Record<string, unknown> | null = asRecord(
    Array.isArray(parsed) ? parsed[0] : parsed,
  );

  if (!container) {
    return null;
  }

  const name: string | null = readString(container["Name"]);
  const config: Record<string, unknown> | null = asRecord(container["Config"]);
  const labels: Record<string, unknown> | null = config
    ? asRecord(config["Labels"])
    : null;

  return {
    // docker prints a container's name as "/name".
    name: name ? name.replace(/^\/+/, "") || null : null,
    swarmServiceName: labels
      ? readString(labels[SWARM_SERVICE_NAME_LABEL])
      : null,
    stackNamespace: labels ? readString(labels[STACK_NAMESPACE_LABEL]) : null,
  };
}

// ---- What the engine says about itself ------------------------------------------

export interface DockerVersionFacts {
  // The engine answered (the CLI printed a Server section).
  hasServer: boolean;
  // The engine's own version: Docker Engine's, or Podman's.
  serverVersion: string | null;
  apiVersion: string | null;
  engine: DockerEngineKind;
}

const PODMAN_PATTERN: RegExp = /podman/i;

/*
 * `docker version --format json`: {"Client": {...}, "Server": {...} | null}.
 * Podman's Docker-compatible API names itself in the server's Components
 * ("Podman Engine") and Platform. Null when the text is not that JSON.
 */
export function parseDockerVersion(text: string): DockerVersionFacts | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse((text || "").trim());
  } catch {
    return null;
  }

  const root: Record<string, unknown> | null = asRecord(parsed);

  if (!root) {
    return null;
  }

  const server: Record<string, unknown> | null = asRecord(root["Server"]);

  if (!server) {
    return {
      hasServer: false,
      serverVersion: null,
      apiVersion: null,
      engine: "docker",
    };
  }

  const components: Array<Record<string, unknown>> = Array.isArray(
    server["Components"],
  )
    ? (server["Components"] as Array<unknown>)
        .map((entry: unknown): Record<string, unknown> | null => {
          return asRecord(entry);
        })
        .filter(
          (
            entry: Record<string, unknown> | null,
          ): entry is Record<string, unknown> => {
            return entry !== null;
          },
        )
    : [];
  const platform: Record<string, unknown> | null = asRecord(server["Platform"]);
  const podmanComponent: Record<string, unknown> | undefined = components.find(
    (component: Record<string, unknown>): boolean => {
      return PODMAN_PATTERN.test(readString(component["Name"]) || "");
    },
  );
  const isPodman: boolean =
    podmanComponent !== undefined ||
    PODMAN_PATTERN.test((platform && readString(platform["Name"])) || "");

  return {
    hasServer: true,
    serverVersion:
      (podmanComponent && readString(podmanComponent["Version"])) ||
      readString(server["Version"]),
    apiVersion: readString(server["ApiVersion"]),
    engine: isPodman ? "podman" : "docker",
  };
}

export interface DockerInfoFacts {
  // Swarm.LocalNodeState, lowercased ("inactive", "active", "locked", ...).
  swarmState: string;
  swarmRole: DockerSwarmRole;
  swarmError: string | null;
  // "name=rootless" in SecurityOptions; null when the engine did not say.
  rootless: boolean | null;
  // What the CLI could not get from the engine (it prints them in the JSON).
  serverErrors: Array<string>;
}

/*
 * `docker info --format json`. A manager is an active swarm member with the
 * control plane available; an active member without it is a worker;
 * anything else (not in a swarm, locked, pending, error) is inactive. Null
 * when the text is not that JSON.
 */
export function parseDockerInfo(text: string): DockerInfoFacts | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse((text || "").trim());
  } catch {
    return null;
  }

  const root: Record<string, unknown> | null = asRecord(parsed);

  if (!root) {
    return null;
  }

  const swarm: Record<string, unknown> | null = asRecord(root["Swarm"]);
  const swarmState: string = (
    (swarm && readString(swarm["LocalNodeState"])) ||
    ""
  ).toLowerCase();
  const controlAvailable: boolean = Boolean(
    swarm && swarm["ControlAvailable"] === true,
  );

  let swarmRole: DockerSwarmRole = "inactive";

  if (swarmState === "active") {
    swarmRole = controlAvailable ? "manager" : "worker";
  }

  const securityOptions: unknown = root["SecurityOptions"];
  let rootless: boolean | null = null;

  if (Array.isArray(securityOptions)) {
    rootless = securityOptions.some((option: unknown): boolean => {
      return (
        typeof option === "string" &&
        option.split(",").includes("name=rootless")
      );
    });
  }

  return {
    swarmState,
    swarmRole,
    swarmError: swarm ? readString(swarm["Error"]) : null,
    rootless,
    serverErrors: Array.isArray(root["ServerErrors"])
      ? (root["ServerErrors"] as Array<unknown>).filter(
          (entry: unknown): entry is string => {
            return typeof entry === "string" && entry.trim().length > 0;
          },
        )
      : [],
  };
}

// ---- What an engine failure means for the operator --------------------------------

// The CLI started, ran to the end on its own, and exited 0.
function isCleanExit(captured: SandboxCapture): boolean {
  return (
    captured.setupError === null &&
    captured.spawnError === null &&
    !captured.timedOut &&
    captured.signal === null &&
    captured.exitCode === 0
  );
}

// Who asked for the API version the engine refused: the pin, or the CLI.
function describeApiVersionAsked(pinned: string | null, asked: string): string {
  return pinned
    ? `${DOCKER_API_VERSION_ENV}=${pinned} on the AI agent asks for ${asked}`
    : `the docker CLI asked for ${asked}`;
}

// The socket path of a unix:// engine address, or null.
function socketPathOf(dockerHost: string): string | null {
  return dockerHost.startsWith("unix://")
    ? dockerHost.slice("unix://".length)
    : null;
}

/*
 * What the operator should change, for the engine's usual complaints on
 * stderr; null for everything else (a missing container, a bad name —
 * those are the command's business, and the output already says so). The
 * answer is built from fixed words and the configured address only, never
 * from the raw stderr, which has not been redacted yet.
 */
export function describeDockerFailure(data: {
  stderr: string;
  dockerHost: string;
  resourceType: AiResourceType | null;
  apiVersion: string | null;
}): string | null {
  const stderr: string = data.stderr || "";
  const engine: string = getEngineLabel(data.resourceType);
  const shownHost: string = describeDockerHost(data.dockerHost);
  const socketPath: string | null = socketPathOf(data.dockerHost);

  if (
    PERMISSION_DENIED_PATTERN.test(stderr) &&
    SOCKET_ACCESS_PATTERN.test(stderr)
  ) {
    return `The AI agent may not open the ${engine} engine socket (${shownHost}): run the AI agent container as root (user: "0:0" in docker-compose.yml, --user 0:0 with docker run), as the collector does — the socket is root-owned.`;
  }

  const tooNew: RegExpExecArray | null =
    API_VERSION_TOO_NEW_PATTERN.exec(stderr);

  if (tooNew) {
    return `The ${engine} engine speaks Docker API ${tooNew[2]} at most, and ${describeApiVersionAsked(
      data.apiVersion,
      tooNew[1] || "",
    )}: set ${DOCKER_API_VERSION_ENV}=${tooNew[2]} on the AI agent${
      data.apiVersion
        ? ", or leave it empty so the docker CLI negotiates the version itself"
        : ""
    }.`;
  }

  const tooOld: RegExpExecArray | null =
    API_VERSION_TOO_OLD_PATTERN.exec(stderr);

  if (tooOld) {
    return `The ${engine} engine needs Docker API ${tooOld[2]} or newer, and ${describeApiVersionAsked(
      data.apiVersion,
      tooOld[1] || "",
    )}: set ${DOCKER_API_VERSION_ENV}=${tooOld[2]} on the AI agent${
      data.apiVersion
        ? ", or leave it empty so the docker CLI negotiates the version itself"
        : ""
    }.`;
  }

  if (NOT_A_SWARM_MANAGER_PATTERN.test(stderr)) {
    return "This engine is a swarm worker, and swarm commands only work on a manager: run the Docker Swarm AI agent on a manager node, next to the collector.";
  }

  if (NOT_IN_A_SWARM_PATTERN.test(stderr)) {
    return "This engine is not part of a swarm: run the Docker Swarm AI agent on a manager node of the swarm it serves.";
  }

  if (
    ENGINE_UNREACHABLE_PATTERNS.some((pattern: RegExp): boolean => {
      return pattern.test(stderr);
    })
  ) {
    if (socketPath) {
      const enable: string =
        data.resourceType === AiResourceType.PodmanHost
          ? "that the Podman API socket is enabled (sudo systemctl enable --now podman.socket)"
          : "that the Docker daemon is running";

      return `The AI agent cannot reach the ${engine} engine at ${shownHost}: mount the socket into the AI agent container (-v ${socketPath}:${socketPath}:ro, as the collector does) and check ${enable}.`;
    }

    return `The AI agent cannot reach the ${engine} engine at ${shownHost}: check that the engine listens there and that the network lets the agent reach it (or mount the engine socket and leave ${DOCKER_HOST_ENV} unset).`;
  }

  return null;
}

// ---- The executor ------------------------------------------------------------

type OwnContainerLookup = "pending" | "found" | "absent";

export default class DockerExecutor implements ResourceExecutor {
  protected readonly sandbox: SpawnSandbox;
  private readonly dockerBinary: string;
  private readonly procRoot: string;
  private readonly probeTimeoutMs: number;
  private readonly ownContainerProbeTimeoutMs: number;

  // undefined until /proc has been read; null when no container id was found.
  private ownContainerId: string | null | undefined = undefined;
  private ownContainerLookup: OwnContainerLookup = "pending";
  private ownContainer: OwnContainerFacts = {
    name: null,
    swarmServiceName: null,
    stackNamespace: null,
  };
  private warnedEngineMismatch: boolean = false;

  public constructor(
    private readonly options: ExecutorOptions,
    settings: DockerExecutorSettings = {},
  ) {
    this.sandbox = new SpawnSandbox({
      tmpDir: options.tmpDir,
      spawnImpl: options.spawnImpl,
      logger: options.logger,
    });
    this.dockerBinary = settings.dockerBinary || DOCKER_BINARY;
    this.procRoot = settings.procRoot || "/proc";
    this.probeTimeoutMs = settings.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    this.ownContainerProbeTimeoutMs =
      settings.ownContainerProbeTimeoutMs ?? OWN_CONTAINER_PROBE_TIMEOUT_MS;
  }

  public getDockerBinary(): string {
    return this.dockerBinary;
  }

  // The engine address this agent's commands go to (validated or not).
  public getDockerHost(): DockerHostResolution {
    return resolveDockerHost(this.options.env, this.getResourceType());
  }

  /*
   * The agent's own container id, read once from /proc (mountinfo first,
   * then cgroup). Null outside a container, or when neither names it.
   */
  public getOwnContainerId(): string | null {
    if (this.ownContainerId !== undefined) {
      return this.ownContainerId;
    }

    let found: string | null = parseContainerIdFromMountinfo(
      this.readProcFile("self/mountinfo"),
    );

    if (!found) {
      found = parseContainerIdFromCgroup(this.readProcFile("self/cgroup"));
    }

    this.ownContainerId =
      found && CONTAINER_ID_PATTERN.test(found) ? found : null;

    if (this.ownContainerId) {
      this.options.logger.debug("Found the agent's own container", {
        containerId: this.ownContainerId.slice(0, 12),
      });
    }

    return this.ownContainerId;
  }

  /*
   * Whether the agent knows enough about its own container to recognise it
   * in a command: it runs outside a container, or the engine told it the
   * container's name (or that the container is not on this engine).
   */
  public isOwnContainerKnown(): boolean {
    return (
      this.getOwnContainerId() === null || this.ownContainerLookup !== "pending"
    );
  }

  /*
   * What OneUptime AI never changes through this agent: its own container
   * (id, name, swarm service), OneUptime's docker-family agent containers
   * (and, in a stack, their services), and ONEUPTIME_AI_PROTECTED_TARGETS.
   * prepare() enforces exactly this list; probePosture() reports it.
   */
  public getProtectedTargets(): Array<string> {
    const own: Array<string> = [];
    const ownId: string | null = this.getOwnContainerId();

    if (ownId) {
      own.push(ownId);
    }

    if (this.ownContainer.name) {
      own.push(this.ownContainer.name);
    }

    if (this.ownContainer.swarmServiceName) {
      own.push(this.ownContainer.swarmServiceName);
    }

    // docker stack deploy names each service <stack>_<service>.
    const stackNames: Array<string> = this.ownContainer.stackNamespace
      ? ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES.map((name: string): string => {
          return `${this.ownContainer.stackNamespace}_${name}`;
        })
      : [];

    return mergeTargets(
      own,
      [...ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES],
      stackNames,
      this.options.config.protectedTargets,
    );
  }

  public prepare(request: ResourceCommandRequest): PrepareResult {
    const guarded: GuardResult = PrepareGuard.check({
      config: this.options.config,
      request,
      protectedTargets: this.getProtectedTargets(),
      policy: this.options.guardPolicy,
    });

    if (guarded.refusal !== null) {
      return { refusal: guarded.refusal };
    }

    const refused: string = refusalPrefix(guarded.resourceType);
    const host: DockerHostResolution = this.getDockerHost();

    if (host.problem) {
      return { refusal: `${refused}: ${host.problem}` };
    }

    if (
      guarded.tier !== ResourceCommandTier.Read &&
      !this.isOwnContainerKnown()
    ) {
      return {
        refusal: `${refused}: "${guarded.displayCommand}" changes the ${
          AI_RESOURCE_TYPE_INFO[guarded.resourceType].displayName
        }, and the agent has not yet been able to look up its own container (${(
          this.getOwnContainerId() || ""
        ).slice(0, 12)}) on the ${getEngineLabel(
          guarded.resourceType,
        )} engine at ${describeDockerHost(
          host.dockerHost,
        )}. It never changes itself, so it runs no changes until it has; this clears on its own once the engine answers the agent's next check.`,
      };
    }

    const dockerHost: string = host.dockerHost;

    return {
      refusal: null,
      displayCommand: guarded.displayCommand,
      tier: guarded.tier,
      run: (): Promise<ExecResult> => {
        return this.run(guarded, dockerHost);
      },
    };
  }

  public async probePosture(): Promise<ResourcePostureProbe> {
    try {
      return await this.probe();
    } catch (err: unknown) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: `Checking the ${getEngineLabel(
          this.getResourceType(),
        )} engine failed: ${err instanceof Error ? err.message : String(err)}`,
        details: {},
        protectedTargets: this.getProtectedTargetsSafely(),
      };
    }
  }

  public sweepOrphanedJobDirs(): Promise<void> {
    try {
      const removed: number = this.sandbox.sweepOrphanedJobDirs();

      if (removed > 0) {
        this.options.logger.info(
          "Removed job directories a previous run left behind",
          { removed },
        );
      }
    } catch {
      // Best effort: the next start-up sweeps again.
    }

    return Promise.resolve();
  }

  public removeAllJobDirs(): Promise<void> {
    try {
      this.sandbox.removeAllJobDirs();
    } catch {
      // Best effort.
    }

    return Promise.resolve();
  }

  // Read a file under /proc (tests point procRoot elsewhere); "" when unreadable.
  protected readProcFile(relativePath: string): string {
    try {
      return fs.readFileSync(path.join(this.procRoot, relativePath), "utf8");
    } catch {
      return "";
    }
  }

  private getResourceType(): AiResourceType | null {
    const type: AiResourceType | null = this.options.config.resourceType;
    return type && isAiResourceType(type) ? type : null;
  }

  private getProtectedTargetsSafely(): Array<string> {
    try {
      return this.getProtectedTargets();
    } catch {
      return mergeTargets([...ONEUPTIME_DOCKER_AGENT_CONTAINER_NAMES]);
    }
  }

  /*
   * Run one guarded command. Never throws: whatever goes wrong comes back as
   * {success: false, errorMessage}, with what to change when the engine's
   * complaint is a known one.
   */
  private async run(
    guarded: GuardedCommand,
    dockerHost: string,
  ): Promise<ExecResult> {
    try {
      const apiVersion: string | null = readDockerApiVersion(this.options.env);
      const captured: SandboxCapture = await this.capture({
        args: guarded.args,
        dockerHost,
        apiVersion,
        timeoutInMs: guarded.timeoutInMs,
      });
      const result: ExecResult = SpawnSandbox.toExecResult(captured, {
        resourceType: guarded.resourceType,
        program: DOCKER_PROGRAM,
        binary: this.dockerBinary,
        timeoutInMs: guarded.timeoutInMs,
        maxOutputBytes: this.sandbox.getMaxOutputBytes(),
        silenceHint: this.describeSilence(guarded.resourceType, dockerHost),
      });

      if (
        result.success ||
        captured.setupError !== null ||
        captured.spawnError !== null
      ) {
        return result;
      }

      const hint: string | null = describeDockerFailure({
        stderr: captured.stderr,
        dockerHost,
        resourceType: guarded.resourceType,
        apiVersion,
      });

      if (!hint) {
        return result;
      }

      return {
        ...result,
        errorMessage: `${result.errorMessage || "The docker command failed"}. ${hint}`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        errorMessage: `The docker command could not be run: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  // What silence until the kill means (describeKill's hint).
  private describeSilence(
    resourceType: AiResourceType | null,
    dockerHost: string,
  ): string {
    const shown: string = describeDockerHost(dockerHost);

    return socketPathOf(dockerHost)
      ? `the ${getEngineLabel(resourceType)} engine at ${shown} never answered: check that the daemon is running and not hung`
      : `the ${getEngineLabel(resourceType)} engine at ${shown} never answered: check that it is up and that the network lets the agent reach it`;
  }

  // Spawn the docker CLI in the sandbox with the closed environment.
  private capture(data: {
    args: Array<string>;
    dockerHost: string;
    apiVersion: string | null;
    timeoutInMs: number;
  }): Promise<SandboxCapture> {
    return this.sandbox.capture({
      binary: this.dockerBinary,
      args: data.args.slice(),
      timeoutInMs: data.timeoutInMs,
      prepareJobDir: (jobDir: SandboxJobDirectory): void => {
        jobDir.makePrivateDir(DOCKER_CONFIG_DIR_NAME);
      },
      buildEnv: (jobDir: SandboxJobDirectory): Record<string, string> => {
        return buildDockerEnvironment({
          dockerHost: data.dockerHost,
          apiVersion: data.apiVersion,
          homeDir: jobDir.homeDir,
          dockerConfigDir: path.join(jobDir.path, DOCKER_CONFIG_DIR_NAME),
        });
      },
    });
  }

  /*
   * Why a probe command did not answer, for reachError: the known engine
   * complaint's advice, else what the CLI said (redacted), else the kill.
   */
  private describeProbeFailure(data: {
    command: string;
    captured: SandboxCapture;
    dockerHost: string;
    apiVersion: string | null;
  }): string {
    const resourceType: AiResourceType | null = this.getResourceType();
    const engine: string = getEngineLabel(resourceType);
    const shown: string = describeDockerHost(data.dockerHost);
    const captured: SandboxCapture = data.captured;

    if (captured.setupError !== null) {
      return `Could not prepare a private directory for docker: ${captured.setupError}`;
    }

    if (captured.spawnError !== null) {
      return captured.spawnError.code === "ENOENT"
        ? describeMissingBinary({
            program: DOCKER_PROGRAM,
            binary: this.dockerBinary,
          })
        : `Could not start docker: ${captured.spawnError.message}`;
    }

    if (captured.timedOut || captured.signal === "SIGKILL") {
      return `${data.command} did not answer within ${
        Math.round(this.probeTimeoutMs / 100) / 10
      }s: ${this.describeSilence(resourceType, data.dockerHost)}.`;
    }

    if (captured.signal !== null) {
      return `${data.command} was terminated by ${captured.signal}.`;
    }

    const said: string = lastStderrLine(
      redactOutput({
        resourceType: resourceType || AiResourceType.DockerHost,
        program: DOCKER_PROGRAM,
        text: captured.stderr,
      }),
    );
    const hint: string | null = describeDockerFailure({
      stderr: captured.stderr,
      dockerHost: data.dockerHost,
      resourceType,
      apiVersion: data.apiVersion,
    });

    return `The agent cannot reach the ${engine} engine at ${shown}${
      said ? ` (${data.command}: ${said})` : ` (${data.command} failed)`
    }.${hint ? ` ${hint}` : ""}`;
  }

  private async probe(): Promise<ResourcePostureProbe> {
    const resourceType: AiResourceType | null = this.getResourceType();
    const host: DockerHostResolution = this.getDockerHost();
    const details: Record<string, string | number | boolean | null> = {
      dockerHost: describeDockerHost(host.dockerHost),
    };

    if (host.problem) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: host.problem,
        details,
        protectedTargets: this.getProtectedTargets(),
      };
    }

    const apiVersion: string | null = readDockerApiVersion(this.options.env);

    const [versionCapture, infoCapture] = await Promise.all([
      this.capture({
        args: [...DOCKER_VERSION_PROBE_ARGS],
        dockerHost: host.dockerHost,
        apiVersion,
        timeoutInMs: this.probeTimeoutMs,
      }),
      this.capture({
        args: [...DOCKER_INFO_PROBE_ARGS],
        dockerHost: host.dockerHost,
        apiVersion,
        timeoutInMs: this.probeTimeoutMs,
      }),
    ]);

    if (!isCleanExit(versionCapture)) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: this.describeProbeFailure({
          command: "docker version",
          captured: versionCapture,
          dockerHost: host.dockerHost,
          apiVersion,
        }),
        details,
        protectedTargets: this.getProtectedTargets(),
      };
    }

    const version: DockerVersionFacts | null = parseDockerVersion(
      versionCapture.stdout,
    );

    if (!version || !version.hasServer) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: `docker version answered, but not with the engine's version (${
          version ? "it printed no Server section" : "its output is not JSON"
        }). Check that ${describeDockerHost(
          host.dockerHost,
        )} is a ${getEngineLabel(resourceType)} engine.`,
        details,
        protectedTargets: this.getProtectedTargets(),
      };
    }

    details["engine"] = version.engine;

    if (version.apiVersion) {
      details["apiVersion"] = version.apiVersion;
    }

    this.warnOnEngineMismatch(resourceType, version.engine);

    const info: DockerInfoFacts | null = isCleanExit(infoCapture)
      ? parseDockerInfo(infoCapture.stdout)
      : null;
    let reachError: string | null = null;

    if (info) {
      details["swarmRole"] = info.swarmRole;

      if (info.rootless !== null) {
        details["rootless"] = info.rootless;
      }
    }

    if (resourceType === AiResourceType.DockerSwarmCluster) {
      reachError = info
        ? this.describeSwarmProblem(info)
        : `The agent could not read this engine's swarm state, so it cannot tell whether it runs on a manager: ${
            isCleanExit(infoCapture)
              ? "docker info did not print JSON."
              : this.describeProbeFailure({
                  command: "docker info",
                  captured: infoCapture,
                  dockerHost: host.dockerHost,
                  apiVersion,
                })
          }`;
    }

    await this.lookUpOwnContainer({ dockerHost: host.dockerHost, apiVersion });

    return {
      toolVersion: version.serverVersion,
      reachable: reachError === null,
      reachError,
      details,
      protectedTargets: this.getProtectedTargets(),
    };
  }

  // Why a Docker Swarm agent cannot work from this engine, or null (a manager).
  private describeSwarmProblem(info: DockerInfoFacts): string | null {
    if (info.swarmRole === "manager") {
      return null;
    }

    if (info.swarmRole === "worker") {
      return "This Docker engine is a swarm worker, and swarm commands (docker node ls, docker service ...) only work on a manager. Run the Docker Swarm AI agent on a manager node, next to the collector.";
    }

    if (info.swarmState === "locked") {
      return "The swarm is locked on this manager (autolock is on): unlock it with docker swarm unlock, and the Docker Swarm AI agent can reach it again.";
    }

    if (info.swarmState === "pending" || info.swarmState === "error") {
      const said: string = info.swarmError
        ? `: ${redactOutput({
            resourceType: AiResourceType.DockerSwarmCluster,
            program: DOCKER_PROGRAM,
            text: info.swarmError,
          })}`
        : "";

      return `This engine's swarm membership is "${info.swarmState}"${said}. The Docker Swarm AI agent needs a healthy manager node.`;
    }

    return "This Docker engine is not part of a swarm. Run the Docker Swarm AI agent on a manager node of the swarm it serves.";
  }

  /*
   * Ask the engine about the agent's own container once: its name (and
   * swarm service and stack) join the protected targets. "No such
   * container" means the agent does not run on this engine, so there is
   * nothing of its own to protect there. Any other failure is tried again at
   * the next probe; until then, prepare() refuses changes.
   */
  private async lookUpOwnContainer(data: {
    dockerHost: string;
    apiVersion: string | null;
  }): Promise<void> {
    const ownId: string | null = this.getOwnContainerId();

    if (!ownId || this.ownContainerLookup !== "pending") {
      return;
    }

    const captured: SandboxCapture = await this.capture({
      args: ["container", "inspect", ownId],
      dockerHost: data.dockerHost,
      apiVersion: data.apiVersion,
      timeoutInMs: this.ownContainerProbeTimeoutMs,
    });

    if (isCleanExit(captured)) {
      const facts: OwnContainerFacts | null = parseOwnContainerInspect(
        captured.stdout,
      );

      if (facts) {
        this.ownContainer = facts;
        this.ownContainerLookup = "found";
        this.options.logger.debug("Looked up the agent's own container", {
          name: facts.name,
          swarmService: facts.swarmServiceName,
        });
      }

      return;
    }

    if (NO_SUCH_CONTAINER_PATTERN.test(captured.stderr)) {
      this.ownContainerLookup = "absent";
      this.options.logger.debug(
        "The agent's own container is not on this engine",
        { containerId: ownId.slice(0, 12) },
      );
    }
  }

  // Say once when the socket's engine is not the one the resource type expects.
  private warnOnEngineMismatch(
    resourceType: AiResourceType | null,
    engine: DockerEngineKind,
  ): void {
    const expected: DockerEngineKind =
      resourceType === AiResourceType.PodmanHost ? "podman" : "docker";

    if (engine === expected || this.warnedEngineMismatch) {
      return;
    }

    this.warnedEngineMismatch = true;
    this.options.logger.warn(
      `The engine at ${describeDockerHost(
        this.getDockerHost().dockerHost,
      )} is ${engine === "podman" ? "Podman" : "Docker"}, but this agent serves a ${
        resourceType
          ? AI_RESOURCE_TYPE_INFO[resourceType].displayName
          : "container host"
      }. Check ONEUPTIME_AI_AGENT_RESOURCE_TYPE and ${DOCKER_HOST_ENV}.`,
    );
  }
}
