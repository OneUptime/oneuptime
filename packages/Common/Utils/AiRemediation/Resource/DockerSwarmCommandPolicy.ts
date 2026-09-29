/*
 * The docker-swarm command policy: tiers the docker CLI on a swarm manager
 * (nodes, services, tasks, stacks) for Docker Swarm clusters. The CLI's
 * grammar — how the command is found, how flags are parsed, which values
 * are accepted — lives in DockerCliGrammar, shared with the docker-engine
 * policy.
 *
 * Read: node ls / ps / inspect, service ls / ps / inspect, bounded service
 * logs (--tail N up to 2000, or --since; never --follow), stack ls / ps /
 * services — and every read the docker-engine policy allows (docker ps,
 * docker info, docker network ls, ...), since the agent runs on a manager
 * node whose engine is an ordinary Docker engine.
 *
 * SafeWrite — a reversible change to exactly ONE named service:
 * `service update --force SERVICE` (a rolling restart of its tasks with the
 * spec it already has; -d/--detach allowed), `service rollback SERVICE`
 * (back to its previous spec) and `service scale SERVICE=N` with N >= 1.
 *
 * RiskyWrite: scaling to 0 or several services at once; `service update`
 * that changes the image, the replica count, CPU or memory limits and
 * reservations, or the update parallelism, delay and failure action; and
 * `node update --availability active NODE`. `node update --availability
 * drain|pause NODE` is RiskyWrite AND requiresHuman: a drain moves every
 * task off the node, in every stack, whatever the command names — the swarm
 * counterpart of kubectl drain.
 *
 * Denied: service create / rm, stack deploy / rm / config, secrets,
 * configs, node rm / promote / demote / labels / role, swarm, every other
 * `service update` flag (mounts, secrets, configs, capabilities,
 * environment, user, networks, ports, entrypoint, arguments, hostname,
 * credential specs, registry auth, ...), the commands neither docker
 * policy runs (exec, run, rm, prune, ...), and every engine-level change:
 * restarting or stopping one container on this manager is not a Swarm fix
 * (a service's containers are its tasks, spread over the nodes and replaced
 * by the swarm), so the model is pointed at the service commands instead.
 * As in the engine profile, any flag before the command is refused.
 *
 * Targets are service names (a scale's SERVICE, not SERVICE=N) and node
 * names or ids, exactly as written.
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
  DOCKER_ENGINE_WRITE_PATHS,
  DOCKER_FILTER_FLAG,
  DOCKER_FORMAT_FLAG,
  DOCKER_FORMAT_FLAG_WITH_SHORTHAND,
  DOCKER_LOG_FLAGS,
  DOCKER_NO_TRUNC_FLAG,
  DOCKER_QUIET_FLAG,
  DockerCommandSpec,
  DockerFlagKind,
  DockerFlagSpec,
  DockerJudgement,
  DockerParsedArgs,
  DockerProfile,
  deniedJudgement,
  dockerFlagValue,
  dockerNoArgumentReadSpec,
  evaluateDockerArgvSafely,
  findBadDockerFilter,
  findBadDockerFormat,
  findBadDockerName,
  findUnboundedLogProblem,
  isDockerCpuCount,
  isDockerImageReference,
  isDockerMemorySize,
  isDockerSwitchOn,
  isGoDuration,
  mergeDockerCommands,
  parseDockerCount,
  readJudgement,
} from "./DockerCliGrammar";

// The largest replica count a scale or --replicas may name.
export const DOCKER_SWARM_MAX_REPLICAS: number = 999999;

const NO_RESOLVE_FLAG: DockerFlagSpec = {
  name: "no-resolve",
  kind: DockerFlagKind.Bool,
};

const DETACH_FLAG: DockerFlagSpec = {
  name: "detach",
  shorthand: "d",
  kind: DockerFlagKind.Bool,
};

// ---- Reads -------------------------------------------------------------------

/*
 * A read that lists the tasks or objects of the positionals it names:
 * `min`..`max` names of `kind`, the given flags, --format json|table.
 */
const namedReadSpec: (data: {
  verb: string;
  kind: string;
  min: number;
  max: number;
  flags: ReadonlyArray<DockerFlagSpec>;
  formats: ReadonlyArray<string>;
  reason: string;
}) => DockerCommandSpec = (data: {
  verb: string;
  kind: string;
  min: number;
  max: number;
  flags: ReadonlyArray<DockerFlagSpec>;
  formats: ReadonlyArray<string>;
  reason: string;
}): DockerCommandSpec => {
  return {
    verb: data.verb,
    flags: data.flags,
    judge(parsed: DockerParsedArgs): DockerJudgement {
      const count: number = parsed.positionals.length;

      if (count < data.min || count > data.max) {
        const wanted: string =
          data.min === data.max
            ? `exactly ${data.min} ${data.kind}`
            : `at least ${data.min} ${data.kind}`;

        return deniedJudgement(`it takes ${wanted} (got ${count})`);
      }

      const problem: string | null =
        findBadDockerName(parsed.positionals, data.kind) ||
        findBadDockerFilter(parsed) ||
        findBadDockerFormat(parsed, data.formats);

      return problem ? deniedJudgement(problem) : readJudgement(data.reason);
    },
  };
};

const TASK_LIST_FLAGS: ReadonlyArray<DockerFlagSpec> = [
  DOCKER_FILTER_FLAG,
  DOCKER_FORMAT_FLAG,
  NO_RESOLVE_FLAG,
  DOCKER_NO_TRUNC_FLAG,
  DOCKER_QUIET_FLAG,
];

const PRETTY_FLAG: DockerFlagSpec = {
  name: "pretty",
  kind: DockerFlagKind.Bool,
};

const MANY: number = Number.MAX_SAFE_INTEGER;

const SERVICE_LOGS_SPEC: DockerCommandSpec = {
  verb: "service logs",
  flags: [
    ...DOCKER_LOG_FLAGS,
    NO_RESOLVE_FLAG,
    { name: "no-task-ids", kind: DockerFlagKind.Bool },
    DOCKER_NO_TRUNC_FLAG,
    { name: "raw", kind: DockerFlagKind.Bool },
  ],
  judge(parsed: DockerParsedArgs, command: string): DockerJudgement {
    if (parsed.positionals.length !== 1) {
      return deniedJudgement(
        `it reads exactly one service's (or task's) log (got ${parsed.positionals.length} names)`,
      );
    }

    const problem: string | null =
      findBadDockerName(parsed.positionals, "service or task") ||
      findUnboundedLogProblem(parsed, command);

    return problem
      ? deniedJudgement(problem)
      : readJudgement(
          "reads a bounded slice of one service's log across its tasks; it changes nothing",
        );
  },
};

// The swarm's own read commands, by canonical path.
export const DOCKER_SWARM_READ_COMMANDS: ReadonlyMap<
  string,
  DockerCommandSpec
> = new Map<string, DockerCommandSpec>([
  [
    "node ls",
    dockerNoArgumentReadSpec(
      "node ls",
      "lists the swarm's nodes; it changes nothing",
      [DOCKER_FILTER_FLAG, DOCKER_FORMAT_FLAG, DOCKER_QUIET_FLAG],
      ["json", "table"],
    ),
  ],
  [
    "node ps",
    namedReadSpec({
      verb: "node ps",
      kind: "node",
      min: 0,
      max: MANY,
      flags: TASK_LIST_FLAGS,
      formats: ["json", "table"],
      reason: "lists the tasks running on nodes; it changes nothing",
    }),
  ],
  [
    "node inspect",
    namedReadSpec({
      verb: "node inspect",
      kind: "node",
      min: 1,
      max: MANY,
      flags: [DOCKER_FORMAT_FLAG_WITH_SHORTHAND, PRETTY_FLAG],
      formats: ["json"],
      reason: "shows each node's configuration and state; it changes nothing",
    }),
  ],
  [
    "service ls",
    dockerNoArgumentReadSpec(
      "service ls",
      "lists the swarm's services; it changes nothing",
      [DOCKER_FILTER_FLAG, DOCKER_FORMAT_FLAG, DOCKER_QUIET_FLAG],
      ["json", "table"],
    ),
  ],
  [
    "service ps",
    namedReadSpec({
      verb: "service ps",
      kind: "service",
      min: 1,
      max: MANY,
      flags: TASK_LIST_FLAGS,
      formats: ["json", "table"],
      reason: "lists the tasks of services; it changes nothing",
    }),
  ],
  [
    "service inspect",
    namedReadSpec({
      verb: "service inspect",
      kind: "service",
      min: 1,
      max: MANY,
      flags: [DOCKER_FORMAT_FLAG_WITH_SHORTHAND, PRETTY_FLAG],
      formats: ["json"],
      reason:
        "shows each service's spec and state (environment values are redacted); it changes nothing",
    }),
  ],
  ["service logs", SERVICE_LOGS_SPEC],
  [
    "stack ls",
    dockerNoArgumentReadSpec(
      "stack ls",
      "lists the swarm's stacks; it changes nothing",
      [DOCKER_FORMAT_FLAG],
      ["json", "table"],
    ),
  ],
  [
    "stack ps",
    namedReadSpec({
      verb: "stack ps",
      kind: "stack",
      min: 1,
      max: 1,
      flags: TASK_LIST_FLAGS,
      formats: ["json", "table"],
      reason: "lists the tasks of one stack; it changes nothing",
    }),
  ],
  [
    "stack services",
    namedReadSpec({
      verb: "stack services",
      kind: "stack",
      min: 1,
      max: 1,
      flags: [DOCKER_FILTER_FLAG, DOCKER_FORMAT_FLAG, DOCKER_QUIET_FLAG],
      formats: ["json", "table"],
      reason: "lists the services of one stack; it changes nothing",
    }),
  ],
]);

// ---- Writes ------------------------------------------------------------------

/*
 * The `service update` flags that change the service in a way a human
 * should approve, each with the check its value must pass.
 */
const SERVICE_UPDATE_RISKY_FLAGS: ReadonlyArray<{
  name: string;
  isValid: (value: string) => boolean;
  expected: string;
}> = [
  {
    name: "image",
    isValid: isDockerImageReference,
    expected: "an image reference such as nginx:1.27",
  },
  {
    name: "replicas",
    isValid: (value: string): boolean => {
      return parseDockerCount(value, DOCKER_SWARM_MAX_REPLICAS) !== null;
    },
    expected: "a replica count",
  },
  {
    name: "limit-cpu",
    isValid: isDockerCpuCount,
    expected: "a number of CPUs such as 0.5 or 2",
  },
  {
    name: "limit-memory",
    isValid: isDockerMemorySize,
    expected: "a memory size such as 512M or 1G",
  },
  {
    name: "reserve-cpu",
    isValid: isDockerCpuCount,
    expected: "a number of CPUs such as 0.25",
  },
  {
    name: "reserve-memory",
    isValid: isDockerMemorySize,
    expected: "a memory size such as 256M",
  },
  {
    name: "update-parallelism",
    isValid: (value: string): boolean => {
      return parseDockerCount(value, 1000) !== null;
    },
    expected: "a number of tasks updated at once (0 means all)",
  },
  {
    name: "update-delay",
    isValid: isGoDuration,
    expected: "a duration such as 10s or 1m",
  },
  {
    name: "update-failure-action",
    isValid: (value: string): boolean => {
      return value === "pause" || value === "continue" || value === "rollback";
    },
    expected: "pause, continue or rollback",
  },
];

/*
 * `service update` flags that change what the service runs, as whom, or
 * what it can reach — refused by name so the model hears why.
 */
const SERVICE_UPDATE_REFUSAL: string =
  "is never allowed: it changes what the service runs, as whom, or what it can reach (mounts, secrets, configs, capabilities, environment, user, networks, ports, entrypoint, arguments, hostname, credentials, registry auth); leave that change to a human";

const SERVICE_UPDATE_REFUSED_FLAGS: ReadonlyArray<DockerFlagSpec> = [
  { name: "mount-add", kind: DockerFlagKind.Value },
  { name: "mount-rm", kind: DockerFlagKind.Value },
  { name: "secret-add", kind: DockerFlagKind.Value },
  { name: "secret-rm", kind: DockerFlagKind.Value },
  { name: "config-add", kind: DockerFlagKind.Value },
  { name: "config-rm", kind: DockerFlagKind.Value },
  { name: "cap-add", kind: DockerFlagKind.Value },
  { name: "cap-drop", kind: DockerFlagKind.Value },
  { name: "env-add", kind: DockerFlagKind.Value },
  { name: "env-rm", kind: DockerFlagKind.Value },
  { name: "user", shorthand: "u", kind: DockerFlagKind.Value },
  { name: "group-add", kind: DockerFlagKind.Value },
  { name: "group-rm", kind: DockerFlagKind.Value },
  { name: "network-add", kind: DockerFlagKind.Value },
  { name: "network-rm", kind: DockerFlagKind.Value },
  { name: "publish-add", kind: DockerFlagKind.Value },
  { name: "publish-rm", kind: DockerFlagKind.Value },
  { name: "entrypoint", kind: DockerFlagKind.Value },
  { name: "args", kind: DockerFlagKind.Value },
  { name: "hostname", kind: DockerFlagKind.Value },
  { name: "credential-spec", kind: DockerFlagKind.Value },
  { name: "with-registry-auth", kind: DockerFlagKind.Bool },
  { name: "sysctl-add", kind: DockerFlagKind.Value },
  { name: "sysctl-rm", kind: DockerFlagKind.Value },
  { name: "host-add", kind: DockerFlagKind.Value },
  { name: "host-rm", kind: DockerFlagKind.Value },
  { name: "workdir", shorthand: "w", kind: DockerFlagKind.Value },
  { name: "init", kind: DockerFlagKind.Bool },
  { name: "read-only", kind: DockerFlagKind.Bool },
  { name: "isolation", kind: DockerFlagKind.Value },
].map((flag: DockerFlagSpec): DockerFlagSpec => {
  return { ...flag, refusal: SERVICE_UPDATE_REFUSAL };
});

const SERVICE_UPDATE_SPEC: DockerCommandSpec = {
  verb: "service update",
  flags: [
    { name: "force", kind: DockerFlagKind.Bool },
    DETACH_FLAG,
    ...SERVICE_UPDATE_RISKY_FLAGS.map(
      (risky: { name: string }): DockerFlagSpec => {
        return { name: risky.name, kind: DockerFlagKind.Value };
      },
    ),
    ...SERVICE_UPDATE_REFUSED_FLAGS,
  ],
  judge(parsed: DockerParsedArgs): DockerJudgement {
    if (parsed.positionals.length !== 1) {
      return deniedJudgement(
        `it updates exactly one service (got ${parsed.positionals.length} names); write docker service update --force NAME`,
      );
    }

    const nameProblem: string | null = findBadDockerName(
      parsed.positionals,
      "service",
    );

    if (nameProblem) {
      return deniedJudgement(nameProblem);
    }

    const changed: Array<string> = [];

    for (const risky of SERVICE_UPDATE_RISKY_FLAGS) {
      const value: string | undefined = dockerFlagValue(parsed, risky.name);

      if (value === undefined) {
        continue;
      }

      if (!risky.isValid(value)) {
        return deniedJudgement(
          `--${risky.name} takes ${risky.expected}, not "${value}"`,
        );
      }

      changed.push(`--${risky.name}`);
    }

    if (changed.length > 0) {
      return {
        tier: ResourceCommandTier.RiskyWrite,
        reason: `changes a service's ${changed.join(", ")}: a rolling update of every one of its tasks`,
        targets: parsed.positionals,
      };
    }

    if (isDockerSwitchOn(parsed, "force")) {
      return {
        tier: ResourceCommandTier.SafeWrite,
        reason:
          "restarts one service's tasks, one by one, with the spec it already has (a rolling restart)",
        targets: parsed.positionals,
      };
    }

    return deniedJudgement(
      `it changes nothing as written: add --force to restart the service's tasks, or one of ${SERVICE_UPDATE_RISKY_FLAGS.map(
        (risky: { name: string }): string => {
          return `--${risky.name}`;
        },
      ).join(", ")}`,
    );
  },
};

const SERVICE_ROLLBACK_SPEC: DockerCommandSpec = {
  verb: "service rollback",
  flags: [DETACH_FLAG],
  judge(parsed: DockerParsedArgs): DockerJudgement {
    if (parsed.positionals.length !== 1) {
      return deniedJudgement(
        `it rolls back exactly one service (got ${parsed.positionals.length} names)`,
      );
    }

    const problem: string | null = findBadDockerName(
      parsed.positionals,
      "service",
    );

    return problem
      ? deniedJudgement(problem)
      : {
          tier: ResourceCommandTier.SafeWrite,
          reason:
            "rolls one service back to the spec it had before its last update",
          targets: parsed.positionals,
        };
  },
};

// SERVICE=REPLICAS, as `docker service scale` reads each argument.
const SCALE_PAIR_REGEX: RegExp =
  /^([A-Za-z0-9][A-Za-z0-9_.-]{0,254})=([0-9]{1,9})$/;

const SERVICE_SCALE_SPEC: DockerCommandSpec = {
  verb: "service scale",
  flags: [DETACH_FLAG],
  judge(parsed: DockerParsedArgs): DockerJudgement {
    if (parsed.positionals.length === 0) {
      return deniedJudgement("it needs SERVICE=REPLICAS (e.g. web=3)");
    }

    const services: Array<string> = [];
    let scalesToZero: boolean = false;

    for (const pair of parsed.positionals) {
      const match: RegExpExecArray | null = SCALE_PAIR_REGEX.exec(pair);
      const count: number | null = match
        ? parseDockerCount(match[2] || "", DOCKER_SWARM_MAX_REPLICAS)
        : null;

      if (!match || count === null) {
        return deniedJudgement(
          `"${pair}" is not SERVICE=REPLICAS with a replica count up to ${DOCKER_SWARM_MAX_REPLICAS} (e.g. web=3)`,
        );
      }

      services.push(match[1] || "");

      if (count === 0) {
        scalesToZero = true;
      }
    }

    if (scalesToZero) {
      return {
        tier: ResourceCommandTier.RiskyWrite,
        reason:
          "scaling a service to zero replicas stops it: an outage, not a reversible nudge",
        targets: services,
      };
    }

    if (services.length > 1) {
      return {
        tier: ResourceCommandTier.RiskyWrite,
        reason:
          "scales several services at once (a scale is a safe change for exactly one service)",
        targets: services,
      };
    }

    return {
      tier: ResourceCommandTier.SafeWrite,
      reason:
        "scales one service to a non-zero replica count, which a second scale reverses",
      targets: services,
    };
  },
};

const NODE_UPDATE_SPEC: DockerCommandSpec = {
  verb: "node update",
  flags: [
    { name: "availability", kind: DockerFlagKind.Value },
    {
      name: "label-add",
      kind: DockerFlagKind.Value,
      refusal:
        "is never allowed: node labels steer where every service is placed; leave that change to a human",
    },
    {
      name: "label-rm",
      kind: DockerFlagKind.Value,
      refusal:
        "is never allowed: node labels steer where every service is placed; leave that change to a human",
    },
    {
      name: "role",
      kind: DockerFlagKind.Value,
      refusal:
        "is never allowed: promoting or demoting a node changes the swarm's managers (its Raft quorum)",
    },
  ],
  judge(parsed: DockerParsedArgs): DockerJudgement {
    if (parsed.positionals.length !== 1) {
      return deniedJudgement(
        `it updates exactly one node (got ${parsed.positionals.length} names)`,
      );
    }

    const problem: string | null = findBadDockerName(
      parsed.positionals,
      "node",
    );

    if (problem) {
      return deniedJudgement(problem);
    }

    const availability: string | undefined = dockerFlagValue(
      parsed,
      "availability",
    );

    if (availability === "active") {
      return {
        tier: ResourceCommandTier.RiskyWrite,
        reason: "makes a node schedulable again (availability active)",
        targets: parsed.positionals,
      };
    }

    if (availability === "drain" || availability === "pause") {
      return {
        tier: ResourceCommandTier.RiskyWrite,
        reason:
          availability === "drain"
            ? "drains a node: every task on it, in every stack, is moved to other nodes"
            : "pauses a node: the swarm schedules no new task on it",
        targets: parsed.positionals,
        requiresHuman: true,
      };
    }

    return deniedJudgement(
      availability === undefined
        ? "it needs --availability active|pause|drain, the only node change OneUptime AI may make"
        : `--availability takes active, pause or drain, not "${availability}"`,
    );
  },
};

// The swarm's write commands, by canonical path.
export const DOCKER_SWARM_WRITE_COMMANDS: ReadonlyMap<
  string,
  DockerCommandSpec
> = new Map<string, DockerCommandSpec>([
  ["service update", SERVICE_UPDATE_SPEC],
  ["service rollback", SERVICE_ROLLBACK_SPEC],
  ["service scale", SERVICE_SCALE_SPEC],
  ["node update", NODE_UPDATE_SPEC],
]);

const ENGINE_WRITE_REFUSAL: string =
  "changes one container on this manager node, which is not a Swarm fix: a service's containers are its tasks, spread over the nodes and replaced by the swarm. Use docker service update --force SERVICE (a rolling restart), docker service scale SERVICE=N or docker service rollback SERVICE instead";

export const DOCKER_SWARM_PROFILE: DockerProfile = {
  name: "docker-swarm",
  resourceDescription: "a Docker Swarm cluster",
  commands: mergeDockerCommands(
    DOCKER_SWARM_READ_COMMANDS,
    DOCKER_ENGINE_READ_COMMANDS,
    DOCKER_SWARM_WRITE_COMMANDS,
  ),
  refusals: new Map<string, string>(
    DOCKER_ENGINE_WRITE_PATHS.map((path: string): [string, string] => {
      return [path, ENGINE_WRITE_REFUSAL];
    }),
  ),
  allowedSummary:
    "Allowed for a Docker Swarm cluster — reads: docker node ls, docker node ps [NODE], docker node inspect NODE, docker service ls, docker service ps SERVICE, docker service inspect SERVICE, docker service logs --tail 200 SERVICE, docker stack ls, docker stack ps STACK, docker stack services STACK, and this manager's engine reads (docker ps, docker container inspect NAME, docker logs --tail 200 NAME, docker info, docker version, docker network ls, ...); changes: docker service update --force SERVICE, docker service rollback SERVICE, docker service scale SERVICE=N, docker service update --image|--replicas|--limit-cpu|--limit-memory|--reserve-cpu|--reserve-memory|--update-parallelism|--update-delay|--update-failure-action VALUE SERVICE, docker node update --availability active|pause|drain NODE",
};

const DockerSwarmCommandPolicy: ResourceToolPolicy = {
  name: "docker-swarm",
  programs: ["docker"],
  readCommandGuide: [
    "- `docker node ls`, `docker node ps [NODE...]`, `docker node inspect NODE --pretty` — nodes, their state and their tasks",
    "- `docker service ls`, `docker service ps SERVICE` (`--no-trunc` shows full errors; `--filter KEY=VALUE`, `-q`), `docker service inspect SERVICE --pretty` — environment values come back redacted",
    "- `docker service logs --tail 200 SERVICE` — `--tail N` (N up to 2000) or `--since 30m` is required (without `--tail`, `--since` must be a duration of at most 24h); `-t`, `--no-trunc`, `--raw`, `--no-task-ids` are fine; never `-f`/`--follow`",
    "- `docker stack ls`, `docker stack ps STACK`, `docker stack services STACK`",
    "- This manager's engine: `docker ps -a`, `docker container inspect NAME`, `docker logs --tail 200 NAME`, `docker stats --no-stream`, `docker events --since 30m --until 0s`, `docker info`, `docker version`, `docker network ls`, `docker network inspect NAME`, ...",
    "- `--format json` (or `table` for lists) only, never a Go template; one command per call, no pipes, no global flags (`-H`, `--context`, ...)",
  ].join("\n"),
  writeCommandGuide: [
    "- Safe (one service; runs unattended in Automatic mode): `docker service update --force SERVICE` (rolling restart; `-d` ok), `docker service rollback SERVICE`, `docker service scale SERVICE=N` (N of 1 or more)",
    "- Risky (needs approval unless allowlisted or approvals are bypassed): `docker service scale SERVICE=0` or several services, `docker service update` with `--image IMAGE`, `--replicas N`, `--limit-cpu`, `--limit-memory`, `--reserve-cpu`, `--reserve-memory`, `--update-parallelism`, `--update-delay` or `--update-failure-action`, and `docker node update --availability active NODE`",
    "- Always asks a human: `docker node update --availability drain|pause NODE`",
    "- Never: service create/rm, stack deploy/rm, secrets, configs, node rm/promote/demote/labels/role, swarm commands, other service update flags (env, mounts, secrets, networks, ports, user, ...), and container-level changes (docker restart/stop/kill/update of one container is not a Swarm fix)",
  ].join("\n"),
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    return evaluateDockerArgvSafely(DOCKER_SWARM_PROFILE, argv);
  },
};

export default DockerSwarmCommandPolicy;
