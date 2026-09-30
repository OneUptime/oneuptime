import DockerSwarmCommandPolicy, {
  DOCKER_SWARM_PROFILE,
  DOCKER_SWARM_READ_COMMANDS,
  DOCKER_SWARM_WRITE_COMMANDS,
} from "../../../../Utils/AiRemediation/Resource/DockerSwarmCommandPolicy";
import DockerEngineCommandPolicy from "../../../../Utils/AiRemediation/Resource/DockerEngineCommandPolicy";
import {
  DOCKER_ENGINE_READ_COMMANDS,
  DOCKER_ENGINE_WRITE_PATHS,
} from "../../../../Utils/AiRemediation/Resource/DockerCliGrammar";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the docker-swarm command policy (Docker Swarm
 * clusters, the agent running on a manager node).
 *
 * - Read: node / service / stack inspection, bounded service logs, and every
 *   read the docker-engine policy allows on the manager's own engine.
 * - SafeWrite: service update --force, service rollback and a scale of ONE
 *   service to a non-zero count.
 * - RiskyWrite: scale to 0 or of several services, service update of the
 *   image, replicas, limits, reservations and update settings, node update
 *   --availability active; drain and pause also require a human.
 * - Denied: everything else — service create/rm, stacks, secrets, configs,
 *   node rm/promote/demote/labels/role, swarm, any other service update
 *   flag, and every engine-level change (not a Swarm fix).
 * - Targets are service and node names as written.
 */

const SWARM: AiResourceType = AiResourceType.DockerSwarmCluster;

function evaluate(command: string): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({
    resourceType: SWARM,
    command,
  });
}

// [command, verb]
const READS: Array<[string, string]> = [
  ["docker node ls", "node ls"],
  ["docker node list -q", "node ls"],
  ["docker node ls --filter role=manager --format json", "node ls"],
  ["docker node ps", "node ps"],
  ["docker node ps self", "node ps"],
  ["docker node ps node-1 node-2 --no-trunc", "node ps"],
  ["docker node ps --no-resolve -q --filter desired-state=running", "node ps"],
  ["docker node inspect self", "node inspect"],
  ["docker node inspect --pretty node-1", "node inspect"],
  ["docker node inspect -f json node-1 node-2", "node inspect"],
  ["docker service ls", "service ls"],
  ["docker service list --filter mode=replicated -q", "service ls"],
  ["docker service ls --format json", "service ls"],
  ["docker service ps web", "service ps"],
  ["docker service ps --no-trunc web api", "service ps"],
  ["docker service ps -q --filter desired-state=running web", "service ps"],
  ["docker service ps app_web --format table", "service ps"],
  ["docker service inspect web", "service inspect"],
  ["docker service inspect --pretty web", "service inspect"],
  ["docker service inspect --format=json web api", "service inspect"],
  ["docker service logs --tail 100 web", "service logs"],
  [
    "docker service logs -n 50 -t --no-task-ids --raw --no-trunc --no-resolve --details web",
    "service logs",
  ],
  ["docker service logs --since 10m web", "service logs"],
  [
    "docker service logs --tail 200 --since 2026-09-29T10:00:00Z web",
    "service logs",
  ],
  ["docker service logs --tail 10 web.1.x2k9", "service logs"],
  ["docker service logs web --tail=2000", "service logs"],
  ["docker stack ls", "stack ls"],
  ["docker stack list --format json", "stack ls"],
  ["docker stack ps app", "stack ps"],
  ["docker stack ps --no-trunc --filter desired-state=running app", "stack ps"],
  ["docker stack services app", "stack services"],
  ["docker stack services -q app", "stack services"],
  // The manager's own engine.
  ["docker ps", "ps"],
  ["docker ps -a --filter label=com.docker.swarm.service.name=web", "ps"],
  ["docker info", "info"],
  ["docker version", "version"],
  ["docker network ls", "network ls"],
  ["docker network inspect ingress", "network inspect"],
  ["docker container inspect web.1.x2k9", "container inspect"],
  ["docker logs --tail 10 web.1.x2k9", "logs"],
  ["docker stats --no-stream", "stats"],
  ["docker events --since 5m --until 0s", "events"],
];

// [command, verb, targets]
const SAFE_WRITES: Array<[string, string, Array<string>]> = [
  ["docker service update --force web", "service update", ["web"]],
  ["docker service update --force -d web", "service update", ["web"]],
  ["docker service update web --force --detach", "service update", ["web"]],
  [
    "docker service update --force --detach=false web",
    "service update",
    ["web"],
  ],
  ["docker service update --force=true app_web", "service update", ["app_web"]],
  ["docker service rollback web", "service rollback", ["web"]],
  ["docker service rollback -d web", "service rollback", ["web"]],
  ["docker service scale web=3", "service scale", ["web"]],
  ["docker service scale web=1 -d", "service scale", ["web"]],
  ["docker service scale -d app_web=10", "service scale", ["app_web"]],
];

// [command, verb, targets]
const RISKY_WRITES: Array<[string, string, Array<string>]> = [
  ["docker service scale web=0", "service scale", ["web"]],
  ["docker service scale web=2 api=3", "service scale", ["web", "api"]],
  ["docker service scale web=1 web=2", "service scale", ["web"]],
  ["docker service scale web=2 api=0", "service scale", ["web", "api"]],
  ["docker service update --image nginx:1.27 web", "service update", ["web"]],
  [
    "docker service update --force --image nginx:1.27 web",
    "service update",
    ["web"],
  ],
  [
    "docker service update -d --image registry.example.com:5000/app:2 web",
    "service update",
    ["web"],
  ],
  [
    "docker service update --image nginx@sha256:0123abcd web",
    "service update",
    ["web"],
  ],
  ["docker service update --replicas 3 web", "service update", ["web"]],
  ["docker service update --replicas=0 web", "service update", ["web"]],
  [
    "docker service update --limit-cpu 1.5 --limit-memory 1G web",
    "service update",
    ["web"],
  ],
  [
    "docker service update --reserve-cpu 0.25 --reserve-memory 256M web",
    "service update",
    ["web"],
  ],
  [
    "docker service update --update-parallelism 2 --update-delay 10s --update-failure-action rollback web",
    "service update",
    ["web"],
  ],
  ["docker service update web --update-delay=1m30s", "service update", ["web"]],
  [
    "docker node update --availability active node-1",
    "node update",
    ["node-1"],
  ],
];

// [command, targets] — RiskyWrite that no setting may run unattended.
const HUMAN_ONLY_WRITES: Array<[string, Array<string>]> = [
  ["docker node update --availability drain node-1", ["node-1"]],
  ["docker node update --availability=pause node-1", ["node-1"]],
  ["docker node update node-1 --availability drain", ["node-1"]],
  ["docker node update --availability drain 7mvkq3jx1y2z", ["7mvkq3jx1y2z"]],
];

// [command, a phrase the reason must contain]
const DENIED: Array<[string, string]> = [
  ["docker service create --name x nginx", "creates a new service"],
  ["docker service rm web", "deletes a service"],
  ["docker service remove web", "deletes a service"],
  ["docker stack deploy -c stack.yml app", "replaces a whole stack"],
  ["docker stack up -c stack.yml app", "replaces a whole stack"],
  ["docker stack rm app", "deletes a whole stack"],
  ["docker stack down app", "deletes a whole stack"],
  ["docker stack config -c stack.yml", "environment included"],
  ["docker secret ls", "swarm secrets"],
  ["docker secret inspect db_password", "swarm secrets"],
  ["docker config inspect nginx_conf", "swarm configs"],
  ["docker node rm node-1", "removes a node"],
  ["docker node remove node-1", "removes a node"],
  ["docker node promote node-1", "Raft quorum"],
  ["docker node demote node-1", "Raft quorum"],
  ["docker node update --label-add zone=a node-1", "node labels"],
  ["docker node update --label-rm zone node-1", "node labels"],
  ["docker node update --role manager node-1", "Raft quorum"],
  ["docker node update node-1", "needs --availability"],
  [
    "docker node update --availability maintenance node-1",
    "active, pause or drain",
  ],
  ["docker node update --availability drain a b", "exactly one node"],
  ["docker node update --availability drain", "exactly one node"],
  ["docker swarm leave --force", "swarm membership"],
  ["docker swarm join-token worker", "swarm membership"],
  ["docker swarm unlock-key", "swarm membership"],
  // service update: only the modelled flags.
  ["docker service update --env-add X=1 web", "what the service runs"],
  ["docker service update --env-rm X web", "what the service runs"],
  [
    "docker service update --mount-add type=bind,src=/,dst=/host web",
    "what the service runs",
  ],
  [
    "docker service update --secret-add db_password web",
    "what the service runs",
  ],
  [
    "docker service update --config-add nginx_conf web",
    "what the service runs",
  ],
  ["docker service update --cap-add SYS_ADMIN web", "what the service runs"],
  ["docker service update --user root web", "what the service runs"],
  ["docker service update -u root web", "what the service runs"],
  ["docker service update --network-add host web", "what the service runs"],
  ["docker service update --publish-add 80:80 web", "what the service runs"],
  ["docker service update --entrypoint sh web", "what the service runs"],
  ["docker service update --args 'sh -c id' web", "what the service runs"],
  ["docker service update --hostname evil web", "what the service runs"],
  [
    "docker service update --credential-spec file://x web",
    "what the service runs",
  ],
  [
    "docker service update --with-registry-auth --force web",
    "what the service runs",
  ],
  ["docker service update --force --workdir / web", "what the service runs"],
  ["docker service update --rollback web", "not one OneUptime AI may use"],
  ["docker service update --quiet --force web", "not one OneUptime AI may use"],
  ["docker service update --limit-pids 10 web", "not one OneUptime AI may use"],
  ["docker service update --constraint-add node.role==manager web", "not one"],
  ["docker service update --image '' web", "--image takes"],
  ["docker service update --image -q web", "--image takes"],
  ["docker service update --replicas many web", "--replicas takes"],
  ["docker service update --replicas -1 web", "--replicas takes"],
  ["docker service update --limit-memory lots web", "--limit-memory takes"],
  ["docker service update --limit-cpu two web", "--limit-cpu takes"],
  [
    "docker service update --update-failure-action explode web",
    "pause, continue or rollback",
  ],
  ["docker service update --update-delay soon web", "a duration"],
  ["docker service update web", "changes nothing as written"],
  ["docker service update --force=false web", "changes nothing as written"],
  ["docker service update -d web", "changes nothing as written"],
  ["docker service update --force web api", "exactly one service"],
  ["docker service update --force", "exactly one service"],
  ["docker service update --force --force web", "more than once"],
  ["docker service update --force 'web;x'", "not a service name"],
  // scale
  ["docker service scale web", "is not SERVICE=REPLICAS"],
  ["docker service scale", "needs SERVICE=REPLICAS"],
  ["docker service scale web=-1", "is not SERVICE=REPLICAS"],
  ["docker service scale web=three", "is not SERVICE=REPLICAS"],
  ["docker service scale =3", "is not SERVICE=REPLICAS"],
  ["docker service scale 'web =3'", "is not SERVICE=REPLICAS"],
  ["docker service scale web=1000000", "is not SERVICE=REPLICAS"],
  ["docker service scale web=3 --replicas 2", "not one OneUptime AI"],
  // rollback
  ["docker service rollback", "exactly one service"],
  ["docker service rollback web api", "exactly one service"],
  ["docker service rollback -q web", "not one OneUptime AI"],
  // logs
  ["docker service logs web", "needs --tail N"],
  ["docker service logs -f --tail 10 web", "streams the log"],
  ["docker service logs --follow web", "streams the log"],
  ["docker service logs --tail 5000 web", "from 0 to 2000"],
  ["docker service logs --tail 10 web api", "exactly one service"],
  ["docker service logs --tail 10 --until 5m web", "not one OneUptime AI"],
  ["docker service logs --since 2001-01-01 web", "is an absolute time"],
  ["docker service logs --since 100000h web", "further back than 24h"],
  ["docker system df -v --format json", "build-cache record's Description"],
  ["docker events --since 1m --until 2099-12-31", "--until must be a duration"],
  // reads with bad shapes
  ["docker service ps", "at least 1 service"],
  ["docker service inspect", "at least 1 service"],
  ["docker node inspect", "at least 1 node"],
  ["docker stack ps", "exactly 1 stack"],
  ["docker stack ps a b", "exactly 1 stack"],
  ["docker stack services", "exactly 1 stack"],
  ["docker node ls extra", "takes no arguments"],
  ["docker service ls web", "takes no arguments"],
  [
    "docker service inspect --format '{{json .Spec.TaskTemplate.ContainerSpec.Env}}' web",
    "Go templates",
  ],
  ["docker node inspect -f '{{.Status}}' node-1", "Go templates"],
  ["docker service ps --format '{{.Error}}' web", "Go templates"],
  ["docker stack ls --format '{{.Name}}'", "Go templates"],
  // Engine-level changes are not a Swarm fix.
  ["docker restart web.1.x2k9", "not a Swarm fix"],
  ["docker container restart web.1.x2k9", "not a Swarm fix"],
  ["docker start web", "not a Swarm fix"],
  ["docker unpause web", "not a Swarm fix"],
  ["docker stop web", "not a Swarm fix"],
  ["docker kill web", "not a Swarm fix"],
  ["docker pause web", "not a Swarm fix"],
  ["docker update --memory 1g web", "not a Swarm fix"],
  ["docker container update --cpus 1 web", "not a Swarm fix"],
  // Never, in either profile.
  ["docker exec web sh", "runs a program inside a container"],
  ["docker rm web", "deletes containers"],
  ["docker system prune -f", "in bulk"],
  ["docker compose up", "not shipped"],
  // Flags before the command.
  ["docker -H tcp://manager-2:2375 service ls", "global flags"],
  ["docker --context other node ls", "global flags"],
  ["docker service --help", "comes before the docker service subcommand"],
  ["docker service -q ls", "comes before the docker service subcommand"],
  ["docker node", "needs a subcommand"],
  ["docker stack", "needs a subcommand"],
  ["docker service foo", "not a docker command"],
];

describe("docker-swarm: the tool policy object", () => {
  test("is named and covers docker only", () => {
    expect(DockerSwarmCommandPolicy.name).toBe("docker-swarm");
    expect([...DockerSwarmCommandPolicy.programs]).toEqual(["docker"]);
    expect(ResourceCommandPolicy.getToolPolicy(SWARM)).toBe(
      DockerSwarmCommandPolicy,
    );
    expect(DOCKER_SWARM_PROFILE.name).toBe("docker-swarm");
  });

  test("it allows every engine read, and refuses every engine write", () => {
    for (const path of DOCKER_ENGINE_READ_COMMANDS.keys()) {
      expect(DOCKER_SWARM_PROFILE.commands.has(path)).toBe(true);
    }

    for (const path of DOCKER_ENGINE_WRITE_PATHS) {
      expect(DOCKER_SWARM_PROFILE.commands.has(path)).toBe(false);
      expect(DOCKER_SWARM_PROFILE.refusals.get(path)).toContain(
        "not a Swarm fix",
      );
    }
  });

  test("every swarm read and write in the tables has an example below", () => {
    const covered: Set<string> = new Set<string>(
      [...READS, ...SAFE_WRITES, ...RISKY_WRITES].map(
        (row: Array<unknown>): string => {
          return row[1] as string;
        },
      ),
    );

    for (const spec of [
      ...DOCKER_SWARM_READ_COMMANDS.values(),
      ...DOCKER_SWARM_WRITE_COMMANDS.values(),
    ]) {
      expect(covered.has(spec.verb)).toBe(true);
    }
  });

  test("the engine policy refuses what the swarm policy allows, and vice versa", () => {
    expect(
      DockerEngineCommandPolicy.evaluateArgv([
        "docker",
        "service",
        "update",
        "--force",
        "web",
      ]).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(
      DockerSwarmCommandPolicy.evaluateArgv(["docker", "restart", "web"]).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(
      DockerEngineCommandPolicy.evaluateArgv(["docker", "restart", "web"]).tier,
    ).toBe(ResourceCommandTier.SafeWrite);
  });
});

describe("docker-swarm: reads", () => {
  test.each(READS)("%p is Read (%s)", (command: string, verb: string) => {
    const result: ResourceCommandPolicyResult = evaluate(command);

    expect(result.reason).not.toContain("never allowed");
    expect(result.tier).toBe(ResourceCommandTier.Read);
    expect(result.verb).toBe(verb);
    expect(result.targets).toEqual([]);
    expect(result.requiresHuman).toBeUndefined();
  });

  test("every Test connection command is Read", () => {
    for (const command of AI_RESOURCE_TYPE_INFO[SWARM].testCommands) {
      expect(evaluate(command).tier).toBe(ResourceCommandTier.Read);
      expect(
        ResourceCommandPolicy.isReadOnly({ resourceType: SWARM, command }),
      ).toBe(true);
    }
  });
});

describe("docker-swarm: SafeWrite — exactly one service", () => {
  test.each(SAFE_WRITES)(
    "%p is SafeWrite (%s) on %p",
    (command: string, verb: string, targets: Array<string>) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual(targets);
      expect(result.requiresHuman).toBeUndefined();
    },
  );
});

describe("docker-swarm: RiskyWrite", () => {
  test.each(RISKY_WRITES)(
    "%p is RiskyWrite (%s) on %p",
    (command: string, verb: string, targets: Array<string>) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual(targets);
      expect(result.requiresHuman).toBeUndefined();
    },
  );

  test.each(HUMAN_ONLY_WRITES)(
    "%p is RiskyWrite and requires a human",
    (command: string, targets: Array<string>) => {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
      expect(result.requiresHuman).toBe(true);
      expect(result.targets).toEqual(targets);
      expect(result.verb).toBe("node update");
    },
  );

  test("scaling to zero says it is an outage", () => {
    expect(evaluate("docker service scale web=0").reason).toContain("outage");
  });

  test("a risky update names what it changes", () => {
    const reason: string = evaluate(
      "docker service update --image nginx:1.27 --replicas 2 web",
    ).reason;

    expect(reason).toContain("--image");
    expect(reason).toContain("--replicas");
  });

  test("a drain says what it moves", () => {
    expect(
      evaluate("docker node update --availability drain node-1").reason,
    ).toContain("every task on it");
  });
});

describe("docker-swarm: Denied", () => {
  test.each(DENIED)("%p is Denied (%s)", (command: string, phrase: string) => {
    const result: ResourceCommandPolicyResult = evaluate(command);

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toContain(phrase);
    expect(result.targets).toEqual([]);
    expect(result.requiresHuman).toBeUndefined();
  });

  test("an engine write points the model at the service commands", () => {
    const reason: string = evaluate("docker restart web.1.x2k9").reason;

    expect(reason).toContain("never allowed for a Docker Swarm cluster");
    expect(reason).toContain("docker service update --force SERVICE");
    expect(reason).toContain("docker service rollback SERVICE");
  });

  test("a refused command tells the model what IS allowed", () => {
    for (const command of [
      "docker service create nginx",
      "docker secret ls",
      "docker restart web",
      "docker -H tcp://x node ls",
    ]) {
      const reason: string = evaluate(command).reason;

      expect(reason).toContain("Allowed for a Docker Swarm cluster");
      expect(reason).toContain("docker service logs --tail 200 SERVICE");
      expect(reason).toContain("docker node update --availability");
    }
  });

  test("a refused service update flag lists the allowed ones", () => {
    const reason: string = evaluate(
      "docker service update --stop-signal KILL web",
    ).reason;

    expect(reason).toContain("--force");
    expect(reason).toContain("--image VALUE");
    expect(reason).toContain("--update-failure-action VALUE");
    expect(reason).not.toContain("--env-add");
  });

  test("DockerSwarmCommandPolicy.evaluateArgv is total", () => {
    for (const argv of [
      null,
      undefined,
      [],
      ["docker"],
      ["docker", 1],
      ["docker", "service", "scale", "web=1".repeat(500)],
      Array.from({ length: 100 }, (): string => {
        return "docker";
      }),
    ]) {
      const result: ResourceCommandPolicyResult =
        DockerSwarmCommandPolicy.evaluateArgv(argv as Array<string>);

      expect(result.tier).toBe(ResourceCommandTier.Denied);
      expect(result.targets).toEqual([]);
    }
  });
});

describe("docker-swarm: the auto-execution ladder through the dispatcher", () => {
  function verdictFor(data: {
    command: string;
    allowlistPatterns?: Array<string>;
    bypassApproval?: boolean;
  }): ResourceAutoExecutionVerdict {
    return ResourceCommandPolicy.evaluateForAutoExecution({
      resourceType: SWARM,
      command: data.command,
      allowlistPatterns: data.allowlistPatterns ?? [],
      bypassApproval: data.bypassApproval ?? false,
    });
  }

  test("a rolling restart, a rollback and a scale up are AutoApproved", () => {
    for (const command of [
      "docker service update --force web",
      "docker service rollback web",
      "docker service scale web=4",
    ]) {
      expect(verdictFor({ command }).verdict).toBe(
        AiRemediationCommandPolicyVerdict.AutoApproved,
      );
    }
  });

  test("a scale to zero needs approval, unless bypassed or allowlisted", () => {
    expect(verdictFor({ command: "docker service scale web=0" }).verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(
      verdictFor({
        command: "docker service scale web=0",
        bypassApproval: true,
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    expect(
      verdictFor({
        command: "docker service scale web=0",
        allowlistPatterns: ["docker service scale web=0"],
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
  });

  test("an image change is allowlistable by service", () => {
    const allowlistPatterns: Array<string> = [
      "docker service update --image * web",
    ];

    expect(
      verdictFor({
        command: "docker service update --image nginx:1.28 web",
        allowlistPatterns,
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    expect(
      verdictFor({
        command: "docker service update --image nginx:1.28 api",
        allowlistPatterns,
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
  });

  test("a drain always asks a human: bypass and the allowlist do not apply", () => {
    const verdict: ResourceAutoExecutionVerdict = verdictFor({
      command: "docker node update --availability drain node-1",
      allowlistPatterns: ["docker node update --availability drain *"],
      bypassApproval: true,
    });

    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(verdict.requiresHuman).toBe(true);
    expect(verdict.tier).toBe(ResourceCommandTier.RiskyWrite);
  });

  test("an active node update is bypassable", () => {
    expect(
      verdictFor({
        command: "docker node update --availability active node-1",
        bypassApproval: true,
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
  });

  test("an engine write is Denied whatever the settings", () => {
    expect(
      verdictFor({
        command: "docker restart web",
        allowlistPatterns: ["docker restart *"],
        bypassApproval: true,
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.Denied);
  });
});

describe("docker-swarm: allowlist entries", () => {
  function problem(pattern: string): string | null {
    return ResourceCommandPolicy.describeAllowlistPatternProblem({
      resourceType: SWARM,
      pattern,
    });
  }

  function isBroad(pattern: string): boolean {
    return ResourceCommandPolicy.isBroadAllowlistPattern({
      resourceType: SWARM,
      pattern,
    });
  }

  test.each([
    ["docker service update --image * web"],
    ["docker service update --replicas * web"],
    ["docker service scale web=0"],
    ["docker service update --force *"],
    ["docker node update --availability active *"],
    ["docker node update --availability drain *"],
  ])("%p is a valid entry", (pattern: string) => {
    expect(problem(pattern)).toBeNull();
  });

  test.each([
    ["docker service ls -q", "read-only command"],
    ["docker service scale *", "can never match"],
    ["docker restart *", "can never match"],
    ["docker service create *", "can never match"],
    ["docker service update --env-add * web", "can never match"],
    ["docker * update --force web", "where the command goes"],
  ])("%p is refused (%s)", (pattern: string, phrase: string) => {
    expect(problem(pattern)).toContain(phrase);
  });

  test("a * for the service or node is broad; a * for a value is not", () => {
    expect(isBroad("docker service update --image nginx:1.27 *")).toBe(true);
    expect(isBroad("docker service update --force *")).toBe(true);
    expect(isBroad("docker node update --availability active *")).toBe(true);
    expect(isBroad("docker service update --image * web")).toBe(false);
    expect(isBroad("docker service update --replicas * web")).toBe(false);
  });
});

describe("docker-swarm: the agent's write scope", () => {
  function refusal(
    command: string,
    posture: {
      allowWrites?: boolean;
      writeTargets?: Array<string>;
      protectedTargets?: Array<string>;
    } = {},
  ): string | null {
    return ResourceCommandPolicy.getWriteScopeRefusal({
      result: evaluate(command),
      allowWrites: posture.allowWrites ?? true,
      writeTargets: posture.writeTargets ?? [],
      protectedTargets: posture.protectedTargets ?? [],
      resourceType: SWARM,
    });
  }

  test("a scale's target is the service, not SERVICE=N", () => {
    expect(evaluate("docker service scale web=3").targets).toEqual(["web"]);
    expect(
      refusal("docker service scale web=3", { writeTargets: ["web"] }),
    ).toBeNull();
    expect(
      refusal("docker service scale api=3", { writeTargets: ["web*"] }),
    ).toContain("ONEUPTIME_AI_WRITE_TARGETS");
  });

  test("the agent's own service is protected", () => {
    expect(
      refusal("docker service update --force oneuptime_ai-agent", {
        protectedTargets: ["oneuptime_ai-agent"],
      }),
    ).toContain("protects");
  });

  test("a read-only agent refuses a drain", () => {
    expect(
      refusal("docker node update --availability drain node-1", {
        allowWrites: false,
      }),
    ).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
  });
});

describe("docker-swarm: command guides", () => {
  test("are markdown bullets naming the swarm commands", () => {
    const read: string = DockerSwarmCommandPolicy.readCommandGuide;
    const write: string = DockerSwarmCommandPolicy.writeCommandGuide;

    for (const line of [...read.split("\n"), ...write.split("\n")]) {
      expect(line.startsWith("- ")).toBe(true);
    }

    expect(read).toContain("docker service logs --tail 200 SERVICE");
    expect(read).toContain("docker node ls");
    expect(read).toContain("docker stack ps STACK");
    expect(write).toContain("docker service update --force SERVICE");
    expect(write).toContain("Always asks a human");
    expect(write).toContain("not a Swarm fix");
    expect(ResourceCommandPolicy.getReadCommandGuide(SWARM)).toBe(read);
    expect(ResourceCommandPolicy.getWriteCommandGuide(SWARM)).toBe(write);
  });

  test("every command the guides suggest has the tier they claim", () => {
    for (const command of [
      "docker node ls",
      "docker node ps",
      "docker node ps NODE",
      "docker node inspect NODE --pretty",
      "docker service ls",
      "docker service ps SERVICE",
      "docker service ps --no-trunc SERVICE",
      "docker service inspect SERVICE --pretty",
      "docker service logs --tail 200 SERVICE",
      "docker service logs --since 30m SERVICE",
      "docker stack ls",
      "docker stack ps STACK",
      "docker stack services STACK",
      "docker ps -a",
      "docker container inspect NAME",
      "docker logs --tail 200 NAME",
      "docker stats --no-stream",
      "docker events --since 30m --until 0s",
      "docker info",
      "docker version",
      "docker network ls",
      "docker network inspect NAME",
    ]) {
      expect(evaluate(command).tier).toBe(ResourceCommandTier.Read);
    }

    for (const command of [
      "docker service update --force SERVICE",
      "docker service update --force -d SERVICE",
      "docker service rollback SERVICE",
      "docker service scale SERVICE=3",
    ]) {
      expect(evaluate(command).tier).toBe(ResourceCommandTier.SafeWrite);
    }

    for (const command of [
      "docker service scale SERVICE=0",
      "docker service update --image IMAGE SERVICE",
      "docker service update --replicas 3 SERVICE",
      "docker node update --availability active NODE",
      "docker node update --availability drain NODE",
    ]) {
      expect(evaluate(command).tier).toBe(ResourceCommandTier.RiskyWrite);
    }
  });
});
