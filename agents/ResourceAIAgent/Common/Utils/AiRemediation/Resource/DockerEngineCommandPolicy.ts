/*
 * The docker-engine command policy: tiers the docker CLI against a Docker
 * or Podman engine (Podman through its Docker-compatible API) for Docker
 * and Podman hosts. The CLI's grammar — how the command is found, how
 * flags are parsed, which values are accepted — lives in DockerCliGrammar,
 * shared with the docker-swarm policy.
 *
 * Read: docker ps (and container ls), inspect with an explicit --type (and
 * container / image / network / volume inspect), bounded logs (--tail N up
 * to 2000, or a --since of at most 24h; never --follow), stats --no-stream,
 * top, bounded events (--since and a relative --until), info, version,
 * system df (-v only as a table), images, network ls, volume ls, port and
 * diff. `--format` is json (or table for lists) — never a Go template.
 *
 * SafeWrite — a reversible change to exactly ONE named container:
 * restart (optionally -t N), start and unpause. The container comes back
 * with the image and configuration it already had.
 *
 * RiskyWrite: stop (-t N), kill (-s TERM|INT|HUP|QUIT|USR1|USR2|KILL, in any
 * case, with or without SIG), pause, update of the memory, CPU, restart
 * policy and pids limits (--memory/-m, --memory-swap, --memory-reservation,
 * --cpus, --cpu-shares/-c, --restart, --pids-limit), and a SafeWrite verb
 * that names more than one container.
 *
 * Denied: everything else — exec, run, create, cp, attach, rm, rmi, every
 * prune, build, push, pull, login, save/load/export/import, commit,
 * plugins, secrets, configs, swarm, service, node and stack (a swarm runs
 * through the docker-swarm policy), contexts, trust, manifests, compose,
 * network and volume changes, any other flag of update (or of any other
 * command), and ANY flag before the command: that is where docker's global
 * flags live (-H/--host, -c/--context, --config, --tls*, -D/--debug,
 * -l/--log-level), and they would point the CLI at another engine.
 *
 * Targets are the container names or ids exactly as written; the
 * dispatcher compares them with the agent's protected targets (its own
 * container) and ONEUPTIME_AI_WRITE_TARGETS.
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set only.
 */

import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
} from "./ResourceCommandPolicyCore";
import {
  DOCKER_ENGINE_READ_COMMANDS,
  DOCKER_SWARM_GROUPS,
  DockerCommandSpec,
  DockerFlagKind,
  DockerFlagSpec,
  DockerJudgement,
  DockerParsedArgs,
  DockerProfile,
  deniedJudgement,
  dockerFlagValue,
  evaluateDockerArgvSafely,
  findBadDockerName,
  isDockerCpuCount,
  isDockerMemorySize,
  mergeDockerCommands,
  parseDockerCount,
} from "./DockerCliGrammar";

// The longest wait, in seconds, -t may give a container before it is killed.
export const DOCKER_MAX_STOP_TIMEOUT_SECONDS: number = 600;

// The signals `docker kill -s` may send, without the SIG prefix.
export const DOCKER_KILL_SIGNALS: ReadonlyArray<string> = [
  "TERM",
  "INT",
  "HUP",
  "QUIT",
  "USR1",
  "USR2",
  "KILL",
];

// -t/--timeout (and its deprecated spelling --time) for restart and stop.
const TIMEOUT_FLAG: DockerFlagSpec = {
  name: "timeout",
  shorthand: "t",
  kind: DockerFlagKind.Value,
  aliases: ["time"],
};

const STOP_SIGNAL_REFUSED_FLAG: DockerFlagSpec = {
  name: "signal",
  shorthand: "s",
  kind: DockerFlagKind.Value,
  refusal:
    "is not allowed here: the container's own stop signal is what a clean stop sends (to send a particular signal, use docker kill -s SIGNAL NAME)",
};

// Why -t/--timeout is unusable, or null.
function findBadTimeout(parsed: DockerParsedArgs): string | null {
  const timeout: string | undefined = dockerFlagValue(parsed, "timeout");

  if (
    timeout !== undefined &&
    parseDockerCount(timeout, DOCKER_MAX_STOP_TIMEOUT_SECONDS) === null
  ) {
    return `-t/--timeout takes a number of seconds from 0 to ${DOCKER_MAX_STOP_TIMEOUT_SECONDS}, not "${timeout}"`;
  }

  return null;
}

/*
 * A write to the containers a command names. `oneTier` is its tier for
 * exactly one container; more than one is always RiskyWrite.
 */
function judgeContainerWrite(data: {
  parsed: DockerParsedArgs;
  flagProblem: string | null;
  oneTier: ResourceCommandTier;
  oneReason: string;
  manyReason: string;
}): DockerJudgement {
  const names: Array<string> = data.parsed.positionals;

  if (data.flagProblem) {
    return deniedJudgement(data.flagProblem);
  }

  if (names.length === 0) {
    return deniedJudgement("it needs the container to change (a name or id)");
  }

  const problem: string | null = findBadDockerName(names, "container");

  if (problem) {
    return deniedJudgement(problem);
  }

  if (names.length === 1) {
    return { tier: data.oneTier, reason: data.oneReason, targets: names };
  }

  return {
    tier: ResourceCommandTier.RiskyWrite,
    reason: data.manyReason,
    targets: names,
  };
}

const restartSpec: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [TIMEOUT_FLAG, STOP_SIGNAL_REFUSED_FLAG],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      return judgeContainerWrite({
        parsed,
        flagProblem: findBadTimeout(parsed),
        oneTier: ResourceCommandTier.SafeWrite,
        oneReason:
          "restarts one container, which comes back with the image and configuration it already had",
        manyReason:
          "restarts several containers at once (a restart is a safe change for exactly one container)",
      });
    },
  };
};

const startSpec: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  const interactive: string =
    "is not allowed: OneUptime AI never attaches to a container's output or input";

  return {
    verb,
    flags: [
      {
        name: "attach",
        shorthand: "a",
        kind: DockerFlagKind.Bool,
        refusal: interactive,
      },
      {
        name: "interactive",
        shorthand: "i",
        kind: DockerFlagKind.Bool,
        refusal: interactive,
      },
      { name: "detach-keys", kind: DockerFlagKind.Value, refusal: interactive },
      {
        name: "checkpoint",
        kind: DockerFlagKind.Value,
        refusal: "is not allowed: it restores a container from a checkpoint",
      },
      {
        name: "checkpoint-dir",
        kind: DockerFlagKind.Value,
        refusal: "is not allowed: it restores a container from a checkpoint",
      },
    ],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      return judgeContainerWrite({
        parsed,
        flagProblem: null,
        oneTier: ResourceCommandTier.SafeWrite,
        oneReason:
          "starts one stopped container with the image and configuration it already had",
        manyReason:
          "starts several containers at once (a start is a safe change for exactly one container)",
      });
    },
  };
};

const unpauseSpec: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      return judgeContainerWrite({
        parsed,
        flagProblem: null,
        oneTier: ResourceCommandTier.SafeWrite,
        oneReason: "resumes one paused container",
        manyReason:
          "resumes several containers at once (an unpause is a safe change for exactly one container)",
      });
    },
  };
};

const stopSpec: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [TIMEOUT_FLAG, STOP_SIGNAL_REFUSED_FLAG],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      return judgeContainerWrite({
        parsed,
        flagProblem: findBadTimeout(parsed),
        oneTier: ResourceCommandTier.RiskyWrite,
        oneReason:
          "stops a container: whatever it serves is down until something starts it again",
        manyReason:
          "stops several containers: whatever they serve is down until something starts them again",
      });
    },
  };
};

// The signal `docker kill -s` names, without SIG, or null when it is not allowed.
export function normalizeDockerKillSignal(value: string): string | null {
  if (typeof value !== "string") {
    return null;
  }

  // As the engine reads it: case-insensitive, one optional SIG prefix.
  const upper: string = value.toUpperCase();
  const bare: string = upper.startsWith("SIG") ? upper.slice(3) : upper;

  return DOCKER_KILL_SIGNALS.includes(bare) ? bare : null;
}

const killSpec: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [{ name: "signal", shorthand: "s", kind: DockerFlagKind.Value }],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      const written: string | undefined = dockerFlagValue(parsed, "signal");
      const signal: string | null =
        written === undefined ? "KILL" : normalizeDockerKillSignal(written);

      return judgeContainerWrite({
        parsed,
        flagProblem:
          signal === null
            ? `-s/--signal must be one of ${DOCKER_KILL_SIGNALS.join(", ")} (with or without SIG), not "${written}"`
            : null,
        oneTier: ResourceCommandTier.RiskyWrite,
        oneReason: `sends SIG${signal} to a container${
          signal === "KILL" ? ", which stops it without a clean shutdown" : ""
        }`,
        manyReason: `sends SIG${signal} to several containers`,
      });
    },
  };
};

const pauseSpec: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: [],
    judge(parsed: DockerParsedArgs): DockerJudgement {
      return judgeContainerWrite({
        parsed,
        flagProblem: null,
        oneTier: ResourceCommandTier.RiskyWrite,
        oneReason:
          "freezes every process in a container until it is unpaused: it stops serving meanwhile",
        manyReason:
          "freezes every process in several containers until they are unpaused",
      });
    },
  };
};

// The --restart policies `docker update` may set.
const RESTART_POLICY_REGEX: RegExp =
  /^(?:no|always|unless-stopped|on-failure(?::[0-9]{1,4})?)$/;

// A count, or -1 for "unlimited" (--memory-swap, --pids-limit).
function isCountOrUnlimited(value: string, max: number): boolean {
  return value === "-1" || parseDockerCount(value, max) !== null;
}

/*
 * The flags `docker update` may use, each with the check its value must
 * pass. Every other update flag (CPU periods and quotas, cpusets, block IO
 * weights, ...) is refused as a flag this policy does not know.
 */
const UPDATE_FLAG_CHECKS: ReadonlyArray<{
  flag: DockerFlagSpec;
  isValid: (value: string) => boolean;
  expected: string;
}> = [
  {
    flag: { name: "memory", shorthand: "m", kind: DockerFlagKind.Value },
    isValid: isDockerMemorySize,
    expected: "a memory size such as 512m or 1g",
  },
  {
    flag: { name: "memory-swap", kind: DockerFlagKind.Value },
    isValid: (value: string): boolean => {
      return value === "-1" || isDockerMemorySize(value);
    },
    expected: "a memory size such as 1g, or -1 for unlimited swap",
  },
  {
    flag: { name: "memory-reservation", kind: DockerFlagKind.Value },
    isValid: isDockerMemorySize,
    expected: "a memory size such as 256m",
  },
  {
    flag: { name: "cpus", kind: DockerFlagKind.Value },
    isValid: isDockerCpuCount,
    expected: "a number of CPUs such as 0.5 or 2",
  },
  {
    flag: { name: "cpu-shares", shorthand: "c", kind: DockerFlagKind.Value },
    isValid: (value: string): boolean => {
      return parseDockerCount(value, 262144) !== null;
    },
    expected: "a relative CPU weight such as 512 or 1024",
  },
  {
    flag: { name: "restart", kind: DockerFlagKind.Value },
    isValid: (value: string): boolean => {
      return RESTART_POLICY_REGEX.test(value);
    },
    expected: "no, on-failure[:N], always or unless-stopped",
  },
  {
    flag: { name: "pids-limit", kind: DockerFlagKind.Value },
    isValid: (value: string): boolean => {
      return isCountOrUnlimited(value, 4194304);
    },
    expected: "a number of processes, or -1 for unlimited",
  },
];

const updateSpec: (verb: string) => DockerCommandSpec = (
  verb: string,
): DockerCommandSpec => {
  return {
    verb,
    flags: UPDATE_FLAG_CHECKS.map(
      (check: { flag: DockerFlagSpec }): DockerFlagSpec => {
        return check.flag;
      },
    ),
    judge(parsed: DockerParsedArgs): DockerJudgement {
      const changed: Array<string> = [];
      let flagProblem: string | null = null;

      for (const check of UPDATE_FLAG_CHECKS) {
        const value: string | undefined = dockerFlagValue(
          parsed,
          check.flag.name,
        );

        if (value === undefined) {
          continue;
        }

        changed.push(`--${check.flag.name}`);

        if (!check.isValid(value) && flagProblem === null) {
          flagProblem = `--${check.flag.name} takes ${check.expected}, not "${value}"`;
        }
      }

      if (changed.length === 0) {
        return deniedJudgement(
          "it needs at least one of --memory/-m, --memory-swap, --memory-reservation, --cpus, --cpu-shares/-c, --restart or --pids-limit",
        );
      }

      return judgeContainerWrite({
        parsed,
        flagProblem,
        oneTier: ResourceCommandTier.RiskyWrite,
        oneReason: `changes a running container's ${changed.join(", ")} (applied live)`,
        manyReason: `changes the ${changed.join(", ")} of several running containers (applied live)`,
      });
    },
  };
};

// The engine's write commands, by canonical path (see DOCKER_ENGINE_WRITE_PATHS).
export const DOCKER_ENGINE_WRITE_COMMANDS: ReadonlyMap<
  string,
  DockerCommandSpec
> = new Map<string, DockerCommandSpec>([
  ["restart", restartSpec("restart")],
  ["container restart", restartSpec("container restart")],
  ["start", startSpec("start")],
  ["container start", startSpec("container start")],
  ["unpause", unpauseSpec("unpause")],
  ["container unpause", unpauseSpec("container unpause")],
  ["stop", stopSpec("stop")],
  ["container stop", stopSpec("container stop")],
  ["kill", killSpec("kill")],
  ["container kill", killSpec("container kill")],
  ["pause", pauseSpec("pause")],
  ["container pause", pauseSpec("container pause")],
  ["update", updateSpec("update")],
  ["container update", updateSpec("container update")],
]);

const SWARM_ONLY_REFUSAL: string =
  "is a swarm command, which only the Docker Swarm AI agent runs (for a Docker Swarm cluster resource)";

export const DOCKER_ENGINE_PROFILE: DockerProfile = {
  name: "docker-engine",
  resourceDescription: "a Docker or Podman host",
  commands: mergeDockerCommands(
    DOCKER_ENGINE_READ_COMMANDS,
    DOCKER_ENGINE_WRITE_COMMANDS,
  ),
  refusals: new Map<string, string>(
    DOCKER_SWARM_GROUPS.map((group: string): [string, string] => {
      return [group, SWARM_ONLY_REFUSAL];
    }),
  ),
  allowedSummary:
    "Allowed for a Docker or Podman host — reads: docker ps, docker container inspect NAME, docker logs --tail 200 NAME, docker stats --no-stream, docker top NAME, docker events --since 30m --until 0s, docker info, docker version, docker system df, docker images, docker network ls, docker network inspect NAME, docker volume ls, docker volume inspect NAME, docker port NAME, docker diff NAME; changes: docker restart|start|unpause NAME, docker stop|pause NAME, docker kill -s SIGNAL NAME, docker update --memory|--memory-swap|--memory-reservation|--cpus|--cpu-shares|--restart|--pids-limit VALUE NAME",
};

const DockerEngineCommandPolicy: ResourceToolPolicy = {
  name: "docker-engine",
  programs: ["docker"],
  readCommandGuide: [
    "- `docker ps -a` — list containers (`-q`, `-n N`, `-l`, `-s`, `--no-trunc`, `--filter KEY=VALUE`, `--format json`)",
    "- `docker container inspect NAME` (or `docker inspect --type container|image|network|volume NAME`) — configuration and state; environment values come back redacted; `--format json` only, never a Go template",
    "- `docker logs --tail 200 NAME` — `--tail N` (N up to 2000) or `--since 30m` is required (without `--tail`, `--since` must be a duration of at most 24h); `--until`, `-t`, `--details` are fine; never `-f`/`--follow`",
    "- `docker stats --no-stream [NAME...]` — `--no-stream` is required; `-a`, `--no-trunc`, `--format json`",
    "- `docker top NAME`, `docker port NAME`, `docker diff NAME` — processes, published ports and changed files of one container",
    "- `docker events --since 30m --until 0s` — both bounds are required, `--until` as a duration (`0s` is now); `--filter KEY=VALUE`",
    "- `docker info`, `docker version`, `docker system df [-v]` (`--format json` without `-v`)",
    "- `docker images`, `docker image inspect IMAGE`, `docker network ls`, `docker network inspect NAME`, `docker volume ls`, `docker volume inspect NAME`",
    "- One command per call: no pipes, no global flags (`-H`, `--context`, ...), no `exec`",
  ].join("\n"),
  writeCommandGuide: [
    "- Safe (one container; runs unattended in Automatic mode): `docker restart NAME` (`-t N` ok), `docker start NAME`, `docker unpause NAME`",
    "- Risky (needs approval unless allowlisted or approvals are bypassed): `docker stop NAME` (`-t N`), `docker kill -s TERM|INT|HUP|QUIT|USR1|USR2|KILL NAME`, `docker pause NAME`, `docker update --memory 1g|--memory-swap|--memory-reservation|--cpus 1.5|--cpu-shares N|--restart no|on-failure[:N]|always|unless-stopped|--pids-limit N NAME`, and restart/start/unpause of several containers",
    "- Never: exec, run, create, cp, rm, rmi, any prune, build, pull, push, login, save/load/export/import, commit, network or volume changes, compose, swarm commands, other update flags",
  ].join("\n"),
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    return evaluateDockerArgvSafely(DOCKER_ENGINE_PROFILE, argv);
  },
};

export default DockerEngineCommandPolicy;
