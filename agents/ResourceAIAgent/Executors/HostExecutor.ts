import fs from "fs";
import path from "path";
import PrepareGuard, {
  DEFAULT_GUARD_POLICY,
  GuardResult,
  GuardedCommand,
  mergeTargets,
  refusalPrefix,
} from "./PrepareGuard";
import {
  ExecResult,
  ExecutorOptions,
  GuardPolicy,
  PrepareResult,
  ResourceCommandRequest,
  ResourceExecutor,
  ResourcePostureProbe,
} from "./ResourceExecutor";
import SpawnSandbox, {
  DEFAULT_SPAWN_PATH,
  SandboxCapture,
  describeMissingBinary,
  lastStderrLine,
  redactOutput,
} from "./SpawnSandbox";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The executor for hosts: the host's own programs (systemctl, journalctl,
 * df, ps, ss, ...), run in the host's namespaces through nsenter. See
 * ResourceExecutor for the contract every executor keeps.
 *
 * The agent runs in a privileged container that shares the host's pid
 * namespace (`privileged: true`, `pid: host`, as root — see
 * agents/HostAIAgent/docker-compose.yml), so pid 1 is the host's init. Every
 * command runs as
 *
 *   /usr/bin/nsenter --target 1 --mount --uts --ipc --net --pid -- PROGRAM ARGS
 *
 * which enters init's mount, UTS, IPC, network and pid namespaces (never
 * its user namespace) and executes PROGRAM from the HOST's filesystem: the
 * host's own systemctl talks to the host's systemd, df sees the host's
 * mounts, ps the host's processes. That is root on the host, so the command
 * policy is the whole limit, and this executor adds these checks of its own
 * on top of PrepareGuard (the byte-identical policy re-check, investigation
 * implies Read, the write switch and write scope, the identity):
 *
 *   - PrepareGuard runs with THIS executor's protected targets: every
 *     OneUptime unit on the host (oneuptime-*, which includes this agent's
 *     own oneuptime-host-ai-agent.service), the OpenTelemetry collector's
 *     unit, the container engine the agent runs in (docker.service,
 *     docker.socket and containerd.service under Docker: restarting it
 *     would kill the agent in the middle of the command) and the agent's
 *     own process and its ancestors (pid:N — the pids are the host's, as
 *     the agent shares the host's pid namespace), plus
 *     ONEUPTIME_AI_PROTECTED_TARGETS;
 *   - a process a write names (kill's pid:N) is refused when a unit it
 *     runs in (/proc/N/cgroup) is protected: killing dockerd stops
 *     docker.service as surely as systemctl stop would;
 *   - the program is a bare name (the policy's list, never a path), looked
 *     up on a fixed standard PATH inside the host's mount namespace;
 *   - nothing runs unless pid 1 really is the HOST's init: the agent runs
 *     as root, can open /proc/1/ns/mnt, and — inside a container — pid 1
 *     lives in another mount namespace than the agent. Without `pid: host`
 *     pid 1 is the container's own tini, and "the host's" ps, df and
 *     systemctl would silently be the container's; that is refused, not
 *     run.
 *
 * nsenter runs through SpawnSandbox: no shell, no stdin, a CLOSED
 * environment (a standard PATH, the C.UTF-8 locale, `cat` as every pager,
 * no colours, TERM=dumb, HOME=/nonexistent — nothing of the agent's own:
 * not its ingestion key, not its proxy settings), stdout capped, the stderr
 * tail kept, the output redacted with the program's own hooks (ps and top
 * command lines, ...), and the whole process group SIGKILLed when the time
 * budget runs out (nsenter forks the program into the pid namespace).
 * systemctl and journalctl also get --no-pager, before their own
 * arguments.
 *
 * The posture probe runs `uname -sr`, `systemctl --version` and `hostname`
 * the same way: toolVersion "Linux <release> / systemd <version>",
 * reachable when nsenter works. A Host without HOST_NAME registers under
 * the host's own hostname (resolveResourceIdentifier) — the kernel's
 * hostname, which is what the OpenTelemetry collector's resourcedetection
 * processor reports as host.name (system detector, hostname_sources: [os]).
 * The two must match, or the agent serves a Host the collector never
 * created.
 */

// nsenter in the agent image (Alpine's util-linux-misc package).
export const NSENTER_BINARY: string = "/usr/bin/nsenter";
export const NSENTER_PROGRAM: string = "nsenter";

/*
 * Every namespace of pid 1 but its user namespace, then "--": nothing after
 * it is ever read as an nsenter option, whatever the program's arguments.
 */
export const NSENTER_NAMESPACE_ARGS: ReadonlyArray<string> = [
  "--target",
  "1",
  "--mount",
  "--uts",
  "--ipc",
  "--net",
  "--pid",
  "--",
];

// The program's PATH, searched in the HOST's mount namespace.
export const HOST_PROGRAM_PATH: string = DEFAULT_SPAWN_PATH;

// No home: nothing reads a dotfile or writes a cache on the host.
export const HOST_PROGRAM_HOME: string = "/nonexistent";

// The identity variable a Host's collector and agent share.
export const HOST_NAME_ENV: string = "HOST_NAME";

// systemd's own pager switch, added when the command does not carry it.
export const NO_PAGER_FLAG: string = "--no-pager";
export const PAGER_PROGRAMS: ReadonlyArray<string> = [
  "systemctl",
  "journalctl",
];

// The programs that only exist where systemd does.
export const SYSTEMD_PROGRAMS: ReadonlyArray<string> = [
  "systemctl",
  "journalctl",
  "hostnamectl",
  "timedatectl",
];

/*
 * The budget of each posture probe command. The probe runs at most three
 * rounds (uname, then systemctl --version and hostname in parallel, then
 * uname -n when hostname is missing), well inside the posture's 15-second
 * limit (Posture.DEFAULT_PROBE_TIMEOUT_MS).
 */
export const PROBE_TIMEOUT_MS: number = 4_000;

// This agent's own unit, as agents/HostAIAgent/systemd names it.
export const HOST_AI_AGENT_UNIT: string = "oneuptime-host-ai-agent.service";

/*
 * Units OneUptime AI never changes on a host: every OneUptime agent
 * (oneuptime-host-ai-agent.service, oneuptime-infrastructure-agent.service,
 * the collectors' compose units, ...) and the OpenTelemetry collector that
 * reports this host (the otelcol-contrib package's unit).
 */
export const ONEUPTIME_HOST_PROTECTED_TARGETS: ReadonlyArray<string> = [
  "oneuptime-*",
  "otelcol-contrib.service",
  "otelcol.service",
];

/*
 * Under Docker, restarting or stopping the engine stops this agent's
 * container in the middle of the command. (Podman runs each container under
 * its own conmon, independent of podman.service.)
 */
export const DOCKER_RUNTIME_UNITS: ReadonlyArray<string> = [
  "docker.service",
  "docker.socket",
  "containerd.service",
];

// The files each engine creates at the root of every container.
export const DOCKER_CONTAINER_MARKER: string = "/.dockerenv";
export const PODMAN_CONTAINER_MARKER: string = "/run/.containerenv";

/*
 * What pid 1 is called inside a container of this image (or another
 * container) — never the host's init.
 */
export const CONTAINER_INIT_NAMES: ReadonlyArray<string> = [
  "tini",
  "docker-init",
  "catatonit",
  "dumb-init",
  "s6-svscan",
  "node",
  // Node names its main thread so; it is pid 1's comm when node runs as pid 1.
  "node-MainThread",
  "sh",
  "bash",
];

// Names that every host could have; registering by one merges hosts.
const SHARED_HOST_NAMES: ReadonlyArray<string> = [
  "localhost",
  "localhost.localdomain",
];

// The kernel's hostname when none was ever set.
const UNSET_KERNEL_HOSTNAME: string = "(none)";

// How far up the agent's own process tree its protected pids reach.
const MAX_ANCESTORS: number = 16;

// A program the policy names: a bare word, never a path.
const HOST_PROGRAM_NAME_PATTERN: RegExp = /^[a-z][a-z0-9-]*$/;

// A name the kernel reports as the hostname: printable, no blanks.
const HOSTNAME_PATTERN: RegExp = /^[\x21-\x7e]+$/;

// The longest excerpt of a tool's own words carried in a message.
const SAID_MAX_CHARS: number = 160;

// ... and in the posture's reachError, which holds 256 characters in all.
const PROBE_SAID_MAX_CHARS: number = 80;

// systemctl verbs that change something (the policy's write verbs).
const SYSTEMCTL_WRITE_VERBS: ReadonlyArray<string> = [
  "restart",
  "start",
  "stop",
  "reload",
  "try-restart",
  "reload-or-restart",
  "reset-failed",
];

// systemctl verbs whose exit code IS the answer.
const SYSTEMCTL_QUESTION_VERBS: ReadonlyArray<string> = [
  "is-active",
  "is-failed",
  "is-enabled",
  "is-system-running",
];

// nsenter's own complaints (always its first stderr line).
/*
 * util-linux: "nsenter: failed to execute systemctl: No such file or
 * directory"; busybox: "nsenter: can't execute 'systemctl': No such file or
 * directory".
 */
const NSENTER_EXEC_FAILED_PATTERN: RegExp =
  /^nsenter: (?:failed to execute|can't execute) '?([^'\s:]+)'?: (.+)$/i;
const NSENTER_NO_SUCH_FILE_PATTERN: RegExp = /no such file or directory/i;
const NSENTER_DENIED_PATTERN: RegExp =
  /permission denied|operation not permitted/i;

// The host's usual complaints, which describeHostCommandFailure explains.
const SYSTEMD_UNREACHABLE_PATTERN: RegExp =
  /system has not been booted with systemd|failed to connect to (?:the )?(?:system scope )?bus/i;
const SYSTEMD_ACCESS_DENIED_PATTERN: RegExp =
  /access denied|interactive authentication required/i;
const UNIT_NOT_FOUND_PATTERN: RegExp =
  /unit \S+ (?:could not be found|not found|not loaded)/i;
const JOB_FAILED_PATTERN: RegExp = /job for \S+ failed/i;
const NO_JOURNAL_PATTERN: RegExp = /no journal files were found/i;
const NO_SUCH_PROCESS_PATTERN: RegExp = /no such process/i;
const NOT_PERMITTED_PATTERN: RegExp = /operation not permitted/i;
const PERMISSION_DENIED_PATTERN: RegExp = /permission denied/i;

// The container engine the agent runs in, as its marker files tell.
export type HostContainerRuntime = "docker" | "podman" | null;

// What the agent can see of pid 1 and itself (readHostAccessFacts).
export interface HostAccessFacts {
  // The agent's uid; undefined where the platform has none.
  uid: number | undefined;
  // readlink /proc/1/ns/mnt ("mnt:[4026531841]"), or null.
  hostMountNamespace: string | null;
  // Why /proc/1/ns/mnt could not be read (EACCES, ENOENT, ...), or null.
  hostMountNamespaceError: string | null;
  // readlink /proc/self/ns/mnt, or null.
  ownMountNamespace: string | null;
  containerRuntime: HostContainerRuntime;
  // /proc/1/comm, or null.
  initName: string | null;
}

// Tests only: what the image and the container provide in production.
export interface HostExecutorSettings {
  // The nsenter to start; the image's /usr/bin/nsenter by default.
  nsenterBinary?: string | undefined;
  // Where /proc is read from; "/proc" by default.
  procRoot?: string | undefined;
  // The engines' marker files (DOCKER_CONTAINER_MARKER, PODMAN_CONTAINER_MARKER).
  dockerMarkerFile?: string | undefined;
  podmanMarkerFile?: string | undefined;
  // The agent's uid (process.getuid by default).
  getuid?: (() => number | undefined) | undefined;
  // The agent's own pid (process.pid by default).
  selfPid?: number | undefined;
  // The budget of each posture probe command.
  probeTimeoutMs?: number | undefined;
}

// ---- Building the command ---------------------------------------------------

/*
 * The complete environment of every program the agent starts on the host
 * (nsenter passes it on unchanged). Nothing of the agent's own.
 */
export function buildHostEnvironment(): Record<string, string> {
  return {
    PATH: HOST_PROGRAM_PATH,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    SYSTEMD_PAGER: "cat",
    PAGER: "cat",
    SYSTEMD_COLORS: "0",
    SYSTEMD_LESS: "",
    TERM: "dumb",
    HOME: HOST_PROGRAM_HOME,
  };
}

// --no-pager among the flags (before any "--" that ends them).
export function hasNoPagerFlag(args: ReadonlyArray<string>): boolean {
  for (const arg of args) {
    if (arg === "--") {
      return false;
    }

    if (arg === NO_PAGER_FLAG) {
      return true;
    }
  }

  return false;
}

/*
 * The program's arguments as they are run: the policy's, with --no-pager
 * put FIRST for systemctl and journalctl when absent — before every
 * positional and before any "--", so it can never become a unit name or a
 * match (`systemctl restart -- nginx` must not restart a unit called
 * "--no-pager").
 */
export function buildHostProgramArgs(
  program: string,
  args: ReadonlyArray<string>,
): Array<string> {
  if (PAGER_PROGRAMS.includes(program) && !hasNoPagerFlag(args)) {
    return [NO_PAGER_FLAG, ...args];
  }

  return [...args];
}

// nsenter's whole argv: the namespaces, "--", then the program and its args.
export function buildNsenterArgs(
  program: string,
  args: ReadonlyArray<string>,
): Array<string> {
  return [
    ...NSENTER_NAMESPACE_ARGS,
    program,
    ...buildHostProgramArgs(program, args),
  ];
}

// ---- Reading the host -------------------------------------------------------

function capSaid(text: string, maxChars: number = SAID_MAX_CHARS): string {
  const trimmed: string = text.trim();

  return trimmed.length > maxChars
    ? `${trimmed.slice(0, maxChars)}...`
    : trimmed;
}

// "50ms", "4s", "2.5s".
function formatDuration(ms: number): string {
  return ms < 1_000 ? `${ms}ms` : `${Math.round(ms / 100) / 10}s`;
}

function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) {
      return line.trim();
    }
  }

  return "";
}

function capitalize(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

// "a." + "b" -> "a. b"; "a" + "b" -> "a. b".
function appendSentence(first: string, second: string): string {
  const base: string = first.trim().replace(/[.\s]+$/, "");
  return `${base}. ${second}`;
}

/*
 * Why commands cannot run on the HOST from here, or null when they can.
 * The phrases complete "Refused by the Host AI agent: ..." and, capitalized,
 * are the posture's reachError (at most 256 characters).
 */
export function describeHostAccessProblem(
  facts: HostAccessFacts,
): string | null {
  if (facts.uid !== undefined && facts.uid !== 0) {
    return `this agent runs as uid ${facts.uid}, and only root can enter the host's namespaces: run its container as root (user: "0:0") with privileged: true and pid: host.`;
  }

  const code: string | null = facts.hostMountNamespaceError;

  if (code === "ENOENT" || code === "ENOTDIR") {
    return `this agent cannot see /proc/1/ns/mnt (${code}): the Host AI agent only works on Linux, in a container started with pid: host and privileged: true.`;
  }

  if (code === "EACCES" || code === "EPERM") {
    return `this agent may not open pid 1's namespaces (/proc/1/ns/mnt: ${code}): run its container with privileged: true, as root, on a rootful Docker or Podman engine.`;
  }

  if (code !== null || !facts.hostMountNamespace) {
    return `this agent could not read /proc/1/ns/mnt (${
      code || "no answer"
    }), so it cannot tell whether pid 1 is the host's init: run its container with privileged: true and pid: host.`;
  }

  if (!facts.ownMountNamespace) {
    return "this agent could not read its own mount namespace (/proc/self/ns/mnt), so it cannot tell whether pid 1 is the host's init.";
  }

  const sharesInitMountNamespace: boolean =
    facts.hostMountNamespace === facts.ownMountNamespace;
  const initLooksLikeAContainer: boolean =
    facts.initName !== null && CONTAINER_INIT_NAMES.includes(facts.initName);

  if (
    sharesInitMountNamespace &&
    (facts.containerRuntime !== null || initLooksLikeAContainer)
  ) {
    return `pid 1 is this container's own init${
      facts.initName ? ` (${facts.initName})` : ""
    }, not the host's: the container was started without pid: host, so commands would run inside it. Set pid: host and recreate it.`;
  }

  return null;
}

// The parent pid from /proc/<pid>/stat ("pid (comm) state ppid ..."), or null.
export function parseProcStatParentPid(stat: string): number | null {
  // comm may hold spaces and parentheses: the fields resume after the LAST ")".
  const close: number = stat.lastIndexOf(")");

  if (close < 0) {
    return null;
  }

  const fields: Array<string> = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const ppid: number = Number(fields[1]);

  return Number.isInteger(ppid) && ppid >= 0 ? ppid : null;
}

// A write's process target, as the policy names it.
const PID_TARGET_PATTERN: RegExp = /^pid:([0-9]+)$/;

// A systemd unit name in a cgroup path step.
const CGROUP_UNIT_STEP_PATTERN: RegExp =
  /^[A-Za-z0-9:_.@\\-]+\.(?:service|scope|socket|slice|mount|swap|target|timer|path|automount)$/;

/*
 * The systemd units a process lives in, from /proc/<pid>/cgroup: every step
 * of its cgroup path that names a unit — "0::/system.slice/docker.service"
 * is docker.service (and system.slice); cgroup v1 lines and the "../.."
 * steps of a private cgroup namespace read the same way. Empty when the
 * text names none.
 */
export function parseProcCgroupUnits(text: string): Array<string> {
  const units: Array<string> = [];

  for (const line of (text || "").split("\n")) {
    // hierarchy-id:controllers:path
    const cgroupPath: string = line.split(":").slice(2).join(":").trim();

    for (const step of cgroupPath.split("/")) {
      if (CGROUP_UNIT_STEP_PATTERN.test(step) && !units.includes(step)) {
        units.push(step);
      }
    }
  }

  return units;
}

// The systemd version from `systemctl --version`, or null.
export interface SystemdVersion {
  // "255"
  major: string;
  // "255.4-1ubuntu8.4" (the parenthesised build), or null.
  build: string | null;
}

export function parseSystemdVersion(stdout: string): SystemdVersion | null {
  const match: RegExpMatchArray | null = firstLine(stdout).match(
    /^systemd\s+(\d+[\w.~-]*)(?:\s+\(([^)]+)\))?/,
  );

  if (!match || !match[1]) {
    return null;
  }

  return { major: match[1], build: match[2] ? match[2].trim() : null };
}

// PRETTY_NAME from os-release ("Ubuntu 24.04.1 LTS"), or null.
export function parseOsReleasePrettyName(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match: RegExpMatchArray | null = line.match(
      /^\s*PRETTY_NAME\s*=\s*(.*)$/,
    );

    if (!match) {
      continue;
    }

    const value: string = (match[1] || "")
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2")
      .trim();

    return value || null;
  }

  return null;
}

/*
 * The hostname `hostname` (or `uname -n`) printed: its first line, if it is
 * one printable word and not the kernel's "(none)".
 */
export function parseHostnameOutput(stdout: string): string | null {
  const name: string = firstLine(stdout);

  if (!name || name === UNSET_KERNEL_HOSTNAME || !HOSTNAME_PATTERN.test(name)) {
    return null;
  }

  return name;
}

// "Linux 6.8.0-45-generic / systemd 255", "Linux 6.8.0 / no systemd".
export function formatHostToolVersion(data: {
  kernel: string;
  systemd: SystemdVersion | null;
  // systemctl is known NOT to be installed (not merely unanswered).
  systemdMissing: boolean;
}): string {
  if (data.systemd) {
    return `${data.kernel} / systemd ${data.systemd.major}`;
  }

  return data.systemdMissing ? `${data.kernel} / no systemd` : data.kernel;
}

// ---- Explaining failures ----------------------------------------------------

/*
 * nsenter failed before the program ran: it could not enter a namespace,
 * or could not execute the program. Its complaint is the first stderr
 * line ("nsenter: ..."), the program printed nothing, and the exit code is
 * nsenter's own (1, or 126/127 for an exec failure). Null when the program
 * itself ran. The phrase has no final period: a command's result adds
 * "; the command never ran.", the posture's reachError a period.
 */
export function describeNsenterFailure(data: {
  program: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  // How much of nsenter's own words to quote (the posture needs it short).
  saidMaxChars?: number | undefined;
}): string | null {
  const said: string = firstLine(data.stderr);
  const quote: (text: string) => string = (text: string): string => {
    return capSaid(text, data.saidMaxChars ?? SAID_MAX_CHARS);
  };

  if (
    !said.toLowerCase().startsWith(`${NSENTER_PROGRAM}: `) ||
    data.stdout.trim() !== "" ||
    data.exitCode === null ||
    ![1, 126, 127].includes(data.exitCode)
  ) {
    return null;
  }

  const execFailure: RegExpMatchArray | null = said.match(
    NSENTER_EXEC_FAILED_PATTERN,
  );

  if (execFailure) {
    if (NSENTER_NO_SUCH_FILE_PATTERN.test(execFailure[2] || "")) {
      return `${data.program} is not installed on this host (nsenter found no ${data.program} on the host's PATH, ${HOST_PROGRAM_PATH})${
        SYSTEMD_PROGRAMS.includes(data.program)
          ? ", so this host does not seem to run systemd"
          : ""
      }`;
    }

    return `${data.program} could not be started on the host (${quote(
      execFailure[2] || said,
    )})`;
  }

  if (NSENTER_DENIED_PATTERN.test(said)) {
    return `nsenter could not enter the host's namespaces (${quote(
      said,
    )}): run the agent's container with privileged: true, pid: host and user "0:0", on a rootful Docker or Podman engine`;
  }

  if (NSENTER_NO_SUCH_FILE_PATTERN.test(said)) {
    return `nsenter could not find the host's namespaces (${quote(
      said,
    )}): the agent's container needs pid: host on a Linux host`;
  }

  return `nsenter failed before ${data.program} ran (${quote(said)})`;
}

/*
 * What the host's own complaint means, for a command that ran and failed
 * (or answered with its exit code). Null when there is nothing to add.
 */
export function describeHostCommandFailure(data: {
  program: string;
  // The policy's verb ("restart", "status", "is-active", ...).
  verb: string;
  exitCode: number | null;
  stderr: string;
  // The objects a write touches ("nginx.service", "pid:1234").
  targets?: ReadonlyArray<string> | undefined;
}): string | null {
  const stderr: string = data.stderr || "";
  const target: string =
    data.targets && data.targets[0] ? data.targets[0] : "UNIT";

  if (data.program === "systemctl") {
    if (SYSTEMD_UNREACHABLE_PATTERN.test(stderr)) {
      return "systemctl cannot reach systemd on this host: its pid 1 is not systemd, or systemd's bus is not available, so units cannot be read or managed here.";
    }

    if (SYSTEMD_ACCESS_DENIED_PATTERN.test(stderr)) {
      return 'systemd refused the request: the agent must enter the host\'s namespaces as root (user: "0:0", privileged: true).';
    }

    if (UNIT_NOT_FOUND_PATTERN.test(stderr)) {
      return "No unit of that name is loaded on this host: find its exact name with systemctl list-units --all 'NAME*'.";
    }

    if (JOB_FAILED_PATTERN.test(stderr)) {
      return `The unit failed to ${data.verb === "reload" ? "reload" : "start"}: read why with systemctl status ${target} -n 50 and journalctl -u ${target} -n 200.`;
    }

    if (
      SYSTEMCTL_QUESTION_VERBS.includes(data.verb) &&
      data.exitCode !== null &&
      data.exitCode > 0
    ) {
      return `systemctl ${data.verb} answers with its exit code: non-zero means "no", and the output says the state. It is an answer, not an error.`;
    }

    if (data.verb === "status" && data.exitCode === 3) {
      return "systemctl status exits 3 when a unit is not active: the output is its status, not an error.";
    }

    if (data.verb === "status" && data.exitCode === 4) {
      return "No unit of that name is loaded on this host: find its exact name with systemctl list-units --all 'NAME*'.";
    }
  }

  if (data.program === "journalctl" && NO_JOURNAL_PATTERN.test(stderr)) {
    return "This host keeps no systemd journal (journald stores nothing here), so journalctl has nothing to read.";
  }

  if (data.program === "kill") {
    if (NO_SUCH_PROCESS_PATTERN.test(stderr)) {
      return `The process is already gone (or the pid is wrong): check with ps -p ${target.replace(/^pid:/, "")}.`;
    }

    if (NOT_PERMITTED_PATTERN.test(stderr)) {
      return "The kernel refused to signal that process.";
    }
  }

  if (data.program === "df" && data.exitCode === 1) {
    return "df exits 1 when it cannot read one of the filesystems (a stale or hung mount); the lines it printed are still valid.";
  }

  if (PERMISSION_DENIED_PATTERN.test(stderr)) {
    return `${data.program} was denied access on the host: the agent must run privileged, as root, with pid: host.`;
  }

  return null;
}

/*
 * What silence until the kill means for this command (describeKill's hint).
 * A systemctl change is special: killing systemctl does not cancel the job
 * it gave systemd.
 */
export function describeHostSilence(data: {
  program: string;
  verb: string;
  targets?: ReadonlyArray<string> | undefined;
}): string {
  if (data.program === "systemctl") {
    if (SYSTEMCTL_WRITE_VERBS.includes(data.verb)) {
      const unit: string =
        data.targets && data.targets[0] ? data.targets[0] : "UNIT";

      return `systemctl was still waiting for systemd to finish the job, and systemd carries on with it: check systemctl status ${unit} to see how it ended`;
    }

    return "systemd did not answer: the service manager may be busy or hung (systemctl list-jobs shows what it is doing)";
  }

  if (data.program === "journalctl") {
    return "journalctl was still reading the journal: narrow it with -u UNIT, a smaller -n or a later --since";
  }

  if (data.program === "df") {
    return "df blocks on a filesystem that does not answer (a hung NFS or CIFS mount): df -l reads local filesystems only";
  }

  return `the host did not answer in time: it may be overloaded, or ${data.program} is blocked`;
}

function isCleanExit(captured: SandboxCapture): boolean {
  return (
    captured.setupError === null &&
    captured.spawnError === null &&
    !captured.timedOut &&
    captured.signal === null &&
    captured.exitCode === 0
  );
}

// The program was not found on the host (nsenter's exec failure, exit 127).
function isMissingOnHost(captured: SandboxCapture): boolean {
  return (
    captured.exitCode === 127 &&
    NSENTER_EXEC_FAILED_PATTERN.test(firstLine(captured.stderr)) &&
    NSENTER_NO_SUCH_FILE_PATTERN.test(firstLine(captured.stderr))
  );
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---- The executor -------------------------------------------------------------

export default class HostExecutor implements ResourceExecutor {
  protected readonly sandbox: SpawnSandbox;
  private readonly nsenterBinary: string;
  private readonly procRoot: string;
  private readonly dockerMarkerFile: string;
  private readonly podmanMarkerFile: string;
  private readonly readUid: () => number | undefined;
  private readonly selfPid: number;
  private readonly probeTimeoutMs: number;
  // The hostname the last identity-mismatch note was logged for.
  private notedHostnameMismatch: string | null = null;

  public constructor(
    private readonly options: ExecutorOptions,
    settings: HostExecutorSettings = {},
  ) {
    this.sandbox = new SpawnSandbox({
      tmpDir: options.tmpDir,
      spawnImpl: options.spawnImpl,
      logger: options.logger,
    });
    this.nsenterBinary = settings.nsenterBinary || NSENTER_BINARY;
    this.procRoot = settings.procRoot || "/proc";
    this.dockerMarkerFile =
      settings.dockerMarkerFile || DOCKER_CONTAINER_MARKER;
    this.podmanMarkerFile =
      settings.podmanMarkerFile || PODMAN_CONTAINER_MARKER;
    this.readUid =
      settings.getuid ||
      ((): number | undefined => {
        return typeof process.getuid === "function"
          ? process.getuid()
          : undefined;
      });
    this.selfPid = settings.selfPid ?? process.pid;
    this.probeTimeoutMs = settings.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  }

  public getNsenterBinary(): string {
    return this.nsenterBinary;
  }

  // The engine the agent's container runs in, or null outside one.
  public getContainerRuntime(): HostContainerRuntime {
    if (this.fileExists(this.dockerMarkerFile)) {
      return "docker";
    }

    if (this.fileExists(this.podmanMarkerFile)) {
      return "podman";
    }

    return null;
  }

  // What the agent can see of pid 1 and of itself, read now.
  public readHostAccessFacts(): HostAccessFacts {
    let uid: number | undefined;

    try {
      uid = this.readUid();
    } catch {
      uid = undefined;
    }

    const host: { target: string | null; code: string | null } =
      this.readProcLink("1/ns/mnt");
    const own: { target: string | null; code: string | null } =
      this.readProcLink("self/ns/mnt");
    const initName: string = this.readProcFile("1/comm").trim();

    return {
      uid,
      hostMountNamespace: host.target,
      hostMountNamespaceError: host.code,
      ownMountNamespace: own.target,
      containerRuntime: this.getContainerRuntime(),
      initName: initName || null,
    };
  }

  // Why nothing can run on the host from here, or null. Never throws.
  public getHostAccessProblem(): string | null {
    try {
      return describeHostAccessProblem(this.readHostAccessFacts());
    } catch (err: unknown) {
      return `this agent could not check that pid 1 is the host's init (${errorMessageOf(
        err,
      )}).`;
    }
  }

  /*
   * The agent's own pid and every ancestor below pid 1 (tini, the
   * container's shim, ...): killing any of them kills the agent.
   */
  public getOwnProcessIds(): Array<number> {
    const pids: Array<number> = [];
    let pid: number = this.selfPid;

    while (
      Number.isInteger(pid) &&
      pid > 1 &&
      !pids.includes(pid) &&
      pids.length < MAX_ANCESTORS
    ) {
      pids.push(pid);

      const parent: number | null = parseProcStatParentPid(
        this.readProcFile(`${pid}/stat`),
      );

      if (parent === null) {
        break;
      }

      pid = parent;
    }

    return pids;
  }

  /*
   * What OneUptime AI never changes through this agent: OneUptime's units,
   * the collector's, the engine the agent runs in, the agent's own process
   * tree, and ONEUPTIME_AI_PROTECTED_TARGETS. prepare() enforces exactly
   * this list; probePosture() reports it.
   */
  public getProtectedTargets(): Array<string> {
    return mergeTargets(
      [...ONEUPTIME_HOST_PROTECTED_TARGETS],
      this.getContainerRuntime() === "docker" ? [...DOCKER_RUNTIME_UNITS] : [],
      this.getOwnProcessIds().map((pid: number): string => {
        return `pid:${pid}`;
      }),
      this.options.config.protectedTargets,
    );
  }

  public prepare(request: ResourceCommandRequest): PrepareResult {
    const guarded: GuardResult = PrepareGuard.check({
      config: this.options.config,
      request,
      protectedTargets: this.getProtectedTargetsSafely(),
      policy: this.options.guardPolicy,
    });

    if (guarded.refusal !== null) {
      return { refusal: guarded.refusal };
    }

    const refused: string = refusalPrefix(guarded.resourceType);

    if (!HOST_PROGRAM_NAME_PATTERN.test(guarded.program)) {
      return {
        refusal: `${refused}: "${guarded.program}" is not a plain program name, so it does not run.`,
      };
    }

    const problem: string | null = this.getHostAccessProblem();

    if (problem) {
      return { refusal: `${refused}: ${problem}` };
    }

    if (guarded.tier !== ResourceCommandTier.Read) {
      const processRefusal: string | null =
        this.getProtectedProcessRefusal(guarded);

      if (processRefusal) {
        return { refusal: `${refused}: ${processRefusal}` };
      }
    }

    return {
      refusal: null,
      displayCommand: guarded.displayCommand,
      tier: guarded.tier,
      run: (): Promise<ExecResult> => {
        return this.run(guarded);
      },
    };
  }

  /*
   * A write to a process (kill's pid:N) changes the unit that process runs
   * in as surely as a systemctl command would: `kill -KILL <dockerd's pid>`
   * stops docker.service. So each pid a write names is looked up in the
   * host's /proc (the agent shares the host's pid namespace) and refused
   * when a unit it lives in is protected — the collector, OneUptime's units,
   * the engine the agent runs in, ONEUPTIME_AI_PROTECTED_TARGETS. A pid
   * whose cgroup cannot be read (no such process) is refused too: the agent
   * does not change what it cannot identify. Null when every pid may be
   * changed.
   */
  private getProtectedProcessRefusal(guarded: GuardedCommand): string | null {
    const policy: GuardPolicy =
      this.options.guardPolicy || DEFAULT_GUARD_POLICY;
    const protectedTargets: Array<string> = mergeTargets(
      this.options.config.protectedTargets,
      this.getProtectedTargetsSafely(),
    );
    const targets: Array<string> = Array.isArray(guarded.policy.targets)
      ? guarded.policy.targets
      : [];

    for (const target of targets) {
      const match: RegExpExecArray | null = PID_TARGET_PATTERN.exec(
        typeof target === "string" ? target : "",
      );

      if (!match) {
        continue;
      }

      const pid: string = match[1] || "";
      const cgroup: string = this.readProcFile(`${pid}/cgroup`);

      if (!cgroup.trim()) {
        return `"${guarded.displayCommand}" would change process ${pid}, and the agent could not read which unit it runs in (/proc/${pid}/cgroup): there is no such process on the host, or it cannot be seen from here. It never changes a process it cannot identify.`;
      }

      for (const unit of parseProcCgroupUnits(cgroup)) {
        let refusal: string | null;

        try {
          refusal = policy.getWriteScopeRefusal({
            result: { ...guarded.policy, targets: [unit] },
            allowWrites: true,
            writeTargets: [],
            protectedTargets,
            resourceType: guarded.resourceType,
          });
        } catch {
          refusal = `the write scope could not be checked for ${unit}, so it does not run.`;
        }

        if (refusal) {
          return `process ${pid} runs in ${unit}. ${refusal}`;
        }
      }
    }

    return null;
  }

  public async probePosture(): Promise<ResourcePostureProbe> {
    try {
      return await this.probe();
    } catch (err: unknown) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: `Checking the host failed: ${errorMessageOf(err)}`,
        details: {},
        protectedTargets: this.getProtectedTargetsSafely(),
      };
    }
  }

  /*
   * The Host's identity when neither HOST_NAME nor
   * ONEUPTIME_AI_AGENT_RESOURCE_NAME names it: HOST_NAME if the executor's
   * environment has it, else the host's own kernel hostname — what the
   * OpenTelemetry collector reports as host.name. Null (logged) when it
   * cannot be read. Never throws.
   */
  public async resolveResourceIdentifier(): Promise<string | null> {
    try {
      const configured: string = (this.options.env[HOST_NAME_ENV] || "").trim();

      if (configured) {
        return configured;
      }

      const problem: string | null = this.getHostAccessProblem();

      if (problem) {
        this.options.logger.warn(
          `Could not read the host's hostname: ${problem}`,
        );
        return null;
      }

      const read: { hostname: string | null; problem: string | null } =
        await this.readHostname();

      if (!read.hostname) {
        this.options.logger.warn(
          `Could not read the host's hostname: ${
            read.problem || "it printed no usable name"
          }`,
        );
        return null;
      }

      if (SHARED_HOST_NAMES.includes(read.hostname.toLowerCase())) {
        this.options.logger.warn(
          `This host's hostname is "${read.hostname}", a name every unconfigured host shares: hosts with the same name report into the same OneUptime Host. Set a unique hostname (or ${HOST_NAME_ENV} on this agent and host.name on the collector).`,
        );
      }

      return read.hostname;
    } catch (err: unknown) {
      this.options.logger.warn("Could not read the host's hostname", {
        error: errorMessageOf(err),
      });
      return null;
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

  // ---- Seams (tests point them at a directory they control) -----------------

  // readlink under /proc: the target, or why it could not be read.
  protected readProcLink(relativePath: string): {
    target: string | null;
    code: string | null;
  } {
    try {
      return {
        target: fs.readlinkSync(path.join(this.procRoot, relativePath)),
        code: null,
      };
    } catch (err: unknown) {
      const code: unknown =
        err && typeof err === "object"
          ? (err as Record<string, unknown>)["code"]
          : undefined;

      return {
        target: null,
        code: typeof code === "string" && code ? code : "EUNKNOWN",
      };
    }
  }

  // A file under /proc; "" when unreadable.
  protected readProcFile(relativePath: string): string {
    try {
      return fs.readFileSync(path.join(this.procRoot, relativePath), "utf8");
    } catch {
      return "";
    }
  }

  protected fileExists(filePath: string): boolean {
    try {
      fs.accessSync(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  // ---- Running ----------------------------------------------------------------

  private getProtectedTargetsSafely(): Array<string> {
    try {
      return this.getProtectedTargets();
    } catch {
      return mergeTargets(
        [...ONEUPTIME_HOST_PROTECTED_TARGETS],
        this.options.config.protectedTargets,
      );
    }
  }

  // Spawn nsenter in the sandbox with the closed environment.
  private captureOnHost(data: {
    program: string;
    args: ReadonlyArray<string>;
    timeoutInMs: number;
  }): Promise<SandboxCapture> {
    return this.sandbox.capture({
      binary: this.nsenterBinary,
      args: buildNsenterArgs(data.program, data.args),
      timeoutInMs: data.timeoutInMs,
      buildEnv: (): Record<string, string> => {
        return buildHostEnvironment();
      },
    });
  }

  /*
   * Run one guarded command. Never throws: whatever goes wrong comes back as
   * {success: false, errorMessage}, with what to change when the complaint
   * is a known one.
   */
  private async run(guarded: GuardedCommand): Promise<ExecResult> {
    try {
      const captured: SandboxCapture = await this.captureOnHost({
        program: guarded.program,
        args: guarded.args,
        timeoutInMs: guarded.timeoutInMs,
      });

      return this.toExecResult(captured, guarded);
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        errorMessage: `"${guarded.displayCommand}" could not be run: ${errorMessageOf(
          err,
        )}`,
      };
    }
  }

  private toExecResult(
    captured: SandboxCapture,
    guarded: GuardedCommand,
  ): ExecResult {
    if (captured.setupError !== null) {
      return {
        success: false,
        output: "",
        errorMessage: `Could not prepare a private directory for "${guarded.displayCommand}": ${captured.setupError}. The agent needs a writable /tmp (its docker-compose.yml mounts a tmpfs there).`,
      };
    }

    if (captured.spawnError !== null) {
      return {
        success: false,
        output: "",
        errorMessage:
          captured.spawnError.code === "ENOENT"
            ? describeMissingBinary({
                program: NSENTER_PROGRAM,
                binary: this.nsenterBinary,
              })
            : `Could not start nsenter: ${captured.spawnError.message}`,
      };
    }

    const verb: string = guarded.policy.verb || "";
    const targets: Array<string> = Array.isArray(guarded.policy.targets)
      ? guarded.policy.targets
      : [];
    const isWrite: boolean = guarded.tier !== ResourceCommandTier.Read;

    const result: ExecResult = SpawnSandbox.toExecResult(captured, {
      resourceType: guarded.resourceType,
      // The program's own redaction hooks (ps, top, ...), not nsenter's.
      program: guarded.program,
      binary: this.nsenterBinary,
      timeoutInMs: guarded.timeoutInMs,
      maxOutputBytes: this.sandbox.getMaxOutputBytes(),
      silenceHint: describeHostSilence({
        program: guarded.program,
        verb,
        targets,
      }),
    });

    if (result.success) {
      return result;
    }

    if (captured.timedOut || captured.signal === "SIGKILL") {
      if (guarded.program === "systemctl" && isWrite) {
        // Whatever it printed, the job it gave systemd is still running.
        return {
          ...result,
          errorMessage: `Killed (timeout ${guarded.timeoutInMs}ms): ${describeHostSilence(
            { program: guarded.program, verb, targets },
          )}.`,
        };
      }

      return result;
    }

    if (captured.signal !== null) {
      return result;
    }

    const neverRan: string | null = describeNsenterFailure({
      program: guarded.program,
      exitCode: captured.exitCode,
      stdout: captured.stdout,
      stderr: captured.stderr,
    });

    if (neverRan) {
      // No exit code: the program never ran, which is how OneUptime reads it.
      return {
        success: false,
        output: result.output,
        errorMessage: `${neverRan}; the command never ran.`,
      };
    }

    const hint: string | null = describeHostCommandFailure({
      program: guarded.program,
      verb,
      exitCode: captured.exitCode,
      stderr: captured.stderr,
      targets,
    });

    if (!hint) {
      return result;
    }

    return {
      ...result,
      errorMessage: appendSentence(
        result.errorMessage || `${guarded.program} failed`,
        hint,
      ),
    };
  }

  // ---- The posture ------------------------------------------------------------

  /*
   * Why a probe command did not answer, for reachError: nsenter's own
   * complaint explained, else what the program said (redacted), else the
   * kill.
   */
  private describeProbeFailure(data: {
    program: string;
    command: string;
    captured: SandboxCapture;
  }): string {
    const captured: SandboxCapture = data.captured;

    if (captured.setupError !== null) {
      return `Could not prepare a private directory under /tmp for ${data.command}: ${captured.setupError}`;
    }

    if (captured.spawnError !== null) {
      return captured.spawnError.code === "ENOENT"
        ? describeMissingBinary({
            program: NSENTER_PROGRAM,
            binary: this.nsenterBinary,
          })
        : `Could not start nsenter: ${captured.spawnError.message}`;
    }

    if (captured.timedOut || captured.signal === "SIGKILL") {
      return `The host did not answer ${data.command} within ${formatDuration(
        this.probeTimeoutMs,
      )}: it may be overloaded.`;
    }

    if (captured.signal !== null) {
      return `${data.command} was terminated by ${captured.signal}.`;
    }

    const neverRan: string | null = describeNsenterFailure({
      program: data.program,
      exitCode: captured.exitCode,
      stdout: captured.stdout,
      stderr: captured.stderr,
      saidMaxChars: PROBE_SAID_MAX_CHARS,
    });

    if (neverRan) {
      return `${neverRan}.`;
    }

    const said: string = lastStderrLine(
      redactOutput({
        resourceType: AiResourceType.Host,
        program: data.program,
        text: captured.stderr,
      }),
    );

    return `${data.command} failed on the host (exit code ${
      captured.exitCode ?? "?"
    }${said ? `: ${capSaid(said, PROBE_SAID_MAX_CHARS)}` : ""}).`;
  }

  /*
   * The kernel's hostname, as the collector's os.Hostname() reads it:
   * `hostname`, or `uname -n` where the hostname program is not installed
   * (both print the UTS namespace's nodename).
   */
  private async readHostname(): Promise<{
    hostname: string | null;
    problem: string | null;
  }> {
    const captured: SandboxCapture = await this.captureOnHost({
      program: "hostname",
      args: [],
      timeoutInMs: this.probeTimeoutMs,
    });
    const parsed: string | null = isCleanExit(captured)
      ? parseHostnameOutput(captured.stdout)
      : null;

    if (parsed) {
      return { hostname: parsed, problem: null };
    }

    const nsenterFailed: boolean =
      captured.setupError !== null ||
      captured.spawnError !== null ||
      captured.timedOut ||
      captured.signal !== null ||
      (describeNsenterFailure({
        program: "hostname",
        exitCode: captured.exitCode,
        stdout: captured.stdout,
        stderr: captured.stderr,
      }) !== null &&
        !isMissingOnHost(captured));

    if (nsenterFailed) {
      return {
        hostname: null,
        problem: this.describeProbeFailure({
          program: "hostname",
          command: "hostname",
          captured,
        }),
      };
    }

    const fallback: SandboxCapture = await this.captureOnHost({
      program: "uname",
      args: ["-n"],
      timeoutInMs: this.probeTimeoutMs,
    });
    const fromUname: string | null = isCleanExit(fallback)
      ? parseHostnameOutput(fallback.stdout)
      : null;

    if (fromUname) {
      return { hostname: fromUname, problem: null };
    }

    return {
      hostname: null,
      problem: isCleanExit(fallback)
        ? `the host has no usable hostname (uname -n printed "${capSaid(
            firstLine(fallback.stdout),
          )}")`
        : this.describeProbeFailure({
            program: "uname",
            command: "uname -n",
            captured: fallback,
          }),
    };
  }

  // PRETTY_NAME of the host's os-release, read through pid 1's root.
  private readHostOsName(): string | null {
    for (const file of ["1/root/etc/os-release", "1/root/usr/lib/os-release"]) {
      const name: string | null = parseOsReleasePrettyName(
        this.readProcFile(file),
      );

      if (name) {
        return name;
      }
    }

    return null;
  }

  /*
   * HOST_NAME need not be the hostname (the collector may report another
   * host.name), but when they differ the operator should know which one the
   * agent serves. Said once per hostname.
   */
  private noteIdentityMismatch(hostname: string | null): boolean | null {
    const identifier: string | null = this.options.config.resourceIdentifier;

    if (!hostname || !identifier) {
      return null;
    }

    if (identifier.trim().toLowerCase() === hostname.toLowerCase()) {
      return true;
    }

    if (this.notedHostnameMismatch !== hostname) {
      this.notedHostnameMismatch = hostname;
      this.options.logger.info(
        `This agent serves the Host "${identifier.trim()}" (${
          this.options.config.identitySource || HOST_NAME_ENV
        }), and this host's hostname is "${hostname}". That is right only if the OpenTelemetry collector reports host.name "${identifier.trim()}" too; otherwise set ${HOST_NAME_ENV} to the host.name the collector reports.`,
      );
    }

    return false;
  }

  private async probe(): Promise<ResourcePostureProbe> {
    const protectedTargets: Array<string> = this.getProtectedTargets();
    const details: Record<string, string | number | boolean | null> = {};
    const runtime: HostContainerRuntime = this.getContainerRuntime();

    if (runtime) {
      details["containerRuntime"] = runtime;
    }

    const problem: string | null = this.getHostAccessProblem();

    if (problem) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: capitalize(problem),
        details,
        protectedTargets,
      };
    }

    const kernelCapture: SandboxCapture = await this.captureOnHost({
      program: "uname",
      args: ["-sr"],
      timeoutInMs: this.probeTimeoutMs,
    });

    if (!isCleanExit(kernelCapture)) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: this.describeProbeFailure({
          program: "uname",
          command: "uname -sr",
          captured: kernelCapture,
        }),
        details,
        protectedTargets,
      };
    }

    const kernel: string = firstLine(kernelCapture.stdout) || "Linux";
    details["kernel"] = kernel;

    const [systemdCapture, hostname] = await Promise.all([
      this.captureOnHost({
        program: "systemctl",
        args: ["--version"],
        timeoutInMs: this.probeTimeoutMs,
      }),
      this.readHostname(),
    ]);

    const systemd: SystemdVersion | null = isCleanExit(systemdCapture)
      ? parseSystemdVersion(systemdCapture.stdout)
      : null;
    const systemdMissing: boolean = isMissingOnHost(systemdCapture);

    details["systemd"] = systemd ? true : systemdMissing ? false : null;

    if (systemd) {
      details["systemdVersion"] = systemd.build || systemd.major;
    }

    if (hostname.hostname) {
      details["hostname"] = hostname.hostname;

      const matches: boolean | null = this.noteIdentityMismatch(
        hostname.hostname,
      );

      if (matches !== null) {
        details["hostnameMatchesIdentity"] = matches;
      }
    }

    const osName: string | null = this.readHostOsName();

    if (osName) {
      details["os"] = osName;
    }

    return {
      toolVersion: formatHostToolVersion({ kernel, systemd, systemdMissing }),
      reachable: true,
      reachError: null,
      details,
      protectedTargets,
    };
  }
}
