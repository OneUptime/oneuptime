import DockerEngineCommandPolicy, {
  DOCKER_ENGINE_PROFILE,
  DOCKER_ENGINE_WRITE_COMMANDS,
  DOCKER_KILL_SIGNALS,
  normalizeDockerKillSignal,
} from "../../../../Utils/AiRemediation/Resource/DockerEngineCommandPolicy";
import {
  DOCKER_ENGINE_READ_COMMANDS,
  DOCKER_ENGINE_WRITE_PATHS,
} from "../../../../Utils/AiRemediation/Resource/DockerCliGrammar";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the docker-engine command policy (Docker and Podman
 * hosts), through the dispatcher every caller uses and on its own.
 *
 * - Read: the engine's inspection commands, bounded (logs need --tail N up
 *   to 2000 or --since, stats needs --no-stream, events need --since and
 *   --until), with --format limited to json/table.
 * - SafeWrite: restart / start / unpause of exactly one container.
 * - RiskyWrite: stop, kill (named signals), pause, update of limits and the
 *   restart policy, and a SafeWrite verb naming several containers.
 * - Denied: everything else, every flag before the command (docker's global
 *   flags), every flag the command does not model, and every value that is
 *   not what docker would read it as — so nothing can hide in a flag.
 * - Targets are the container names as written; reads have none.
 */

const DOCKER_TYPES: Array<AiResourceType> = [
  AiResourceType.DockerHost,
  AiResourceType.PodmanHost,
];

function evaluate(
  command: string,
  resourceType: AiResourceType = AiResourceType.DockerHost,
): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({ resourceType, command });
}

function evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateArgv({
    resourceType: AiResourceType.DockerHost,
    argv,
  });
}

// [command, verb]
const READS: Array<[string, string]> = [
  ["docker ps", "ps"],
  ["docker ps -a", "ps"],
  ["docker ps -aq", "ps"],
  ["docker ps --all --quiet --no-trunc --size", "ps"],
  ["docker ps -n 5", "ps"],
  ["docker ps -n5", "ps"],
  ["docker ps -n=5", "ps"],
  ["docker ps --last=5", "ps"],
  ["docker ps -l", "ps"],
  ["docker ps -a=false", "ps"],
  ["docker ps --filter status=exited --filter name=web", "ps"],
  ["docker ps -f status=exited", "ps"],
  ["docker ps -af status=exited", "ps"],
  ["docker ps -qf=name=web", "ps"],
  ["docker ps --format json", "ps"],
  ["docker ps --format=table", "ps"],
  ["docker ps --filter 'label=com.example.team=a b'", "ps"],
  ["docker container ls -a", "container ls"],
  ["docker container list", "container ls"],
  ["docker container ps --filter health=unhealthy", "container ls"],
  ["docker inspect --type container web", "inspect"],
  ["docker inspect --type=image nginx:1.27", "inspect"],
  ["docker inspect --type network bridge", "inspect"],
  ["docker inspect --type volume data", "inspect"],
  ["docker inspect -s --type container web api", "inspect"],
  ["docker inspect --type container --format json web", "inspect"],
  ["docker inspect --type container -f json web", "inspect"],
  ["docker inspect web --type container", "inspect"],
  ["docker container inspect web", "container inspect"],
  ["docker container inspect -s web", "container inspect"],
  ["docker container inspect --format=json web db", "container inspect"],
  ["docker container inspect 3f2a9c1b7d4e", "container inspect"],
  ["docker image inspect nginx:1.27", "image inspect"],
  [
    "docker image inspect registry.example.com:5000/team/app@sha256:0123abcd",
    "image inspect",
  ],
  ["docker network inspect bridge", "network inspect"],
  ["docker network inspect -v bridge", "network inspect"],
  ["docker volume inspect data", "volume inspect"],
  ["docker logs --tail 100 web", "logs"],
  ["docker logs -n 100 web", "logs"],
  ["docker logs -n100 web", "logs"],
  ["docker logs --tail=2000 web", "logs"],
  ["docker logs --tail 0 web", "logs"],
  ["docker logs --since 30m web", "logs"],
  ["docker logs --since 1h30m --until 5m web", "logs"],
  ["docker logs --since 24h web", "logs"],
  ["docker logs --since 23h59m web", "logs"],
  [
    "docker logs --tail 500 --since 2026-09-29T10:00:00Z --until 2026-09-29T11:00:00+02:00 web",
    "logs",
  ],
  ["docker logs --tail 500 --since 2026-09-29 web", "logs"],
  ["docker logs --tail 500 --since 1758000000 web", "logs"],
  ["docker logs --tail 500 --since 1758000000.5 web", "logs"],
  ["docker logs --tail 100 --since 100000h web", "logs"],
  ["docker logs -t --details --tail 50 web", "logs"],
  ["docker logs -tn 50 web", "logs"],
  ["docker logs -tn50 web", "logs"],
  ["docker logs web --tail 50", "logs"],
  ["docker logs --tail 50 -- web", "logs"],
  ["docker container logs --tail 50 web", "container logs"],
  ["docker stats --no-stream", "stats"],
  ["docker stats --no-stream web api", "stats"],
  ["docker stats -a --no-stream --no-trunc --format json", "stats"],
  ["docker stats --no-stream=true web", "stats"],
  ["docker stats --no-stream=1 web", "stats"],
  ["docker container stats --no-stream", "container stats"],
  ["docker top web", "top"],
  ["docker container top web", "container top"],
  ["docker events --since 30m --until 0s", "events"],
  [
    "docker events --since 1h --until 30m --filter type=container --format json",
    "events",
  ],
  ["docker system events --since 10m --until 0s", "system events"],
  ["docker info", "info"],
  ["docker info --format json", "info"],
  ["docker system info", "system info"],
  ["docker system info -f json", "system info"],
  ["docker version", "version"],
  ["docker version -f json", "version"],
  ["docker system df", "system df"],
  ["docker system df -v", "system df"],
  ["docker system df -v --format table", "system df"],
  ["docker system df --format json", "system df"],
  ["docker system df -v=false --format json", "system df"],
  ["docker images", "images"],
  ["docker images -a", "images"],
  ["docker images nginx", "images"],
  ["docker images --filter dangling=true -q", "images"],
  ["docker image ls", "image ls"],
  ["docker image list --digests --no-trunc", "image ls"],
  ["docker network ls", "network ls"],
  ["docker network list --no-trunc -q", "network ls"],
  ["docker network ls --filter driver=bridge --format json", "network ls"],
  ["docker volume ls", "volume ls"],
  ["docker volume ls -f dangling=true", "volume ls"],
  ["docker volume list -q --format table", "volume ls"],
  ["docker port web", "port"],
  ["docker port web 80/tcp", "port"],
  ["docker port web 53/udp", "port"],
  ["docker container port web 8080", "container port"],
  ["docker diff web", "diff"],
  ["docker container diff web", "container diff"],
];

// [command, verb, targets]
const SAFE_WRITES: Array<[string, string, Array<string>]> = [
  ["docker restart web", "restart", ["web"]],
  ["docker restart -t 10 web", "restart", ["web"]],
  ["docker restart --time 10 web", "restart", ["web"]],
  ["docker restart --timeout=10 web", "restart", ["web"]],
  ["docker restart -t=0 web", "restart", ["web"]],
  ["docker restart web -t5", "restart", ["web"]],
  ["docker restart -- web", "restart", ["web"]],
  ["docker restart 3f2a9c1b7d4e", "restart", ["3f2a9c1b7d4e"]],
  ["docker restart my_app.web-1", "restart", ["my_app.web-1"]],
  ["docker container restart web", "container restart", ["web"]],
  ["docker start web", "start", ["web"]],
  ["docker container start web", "container start", ["web"]],
  ["docker unpause web", "unpause", ["web"]],
  ["docker container unpause web", "container unpause", ["web"]],
];

// [command, verb, targets]
const RISKY_WRITES: Array<[string, string, Array<string>]> = [
  ["docker restart web api", "restart", ["web", "api"]],
  ["docker restart web web", "restart", ["web"]],
  ["docker restart -t 5 web api db", "restart", ["web", "api", "db"]],
  ["docker container restart web api", "container restart", ["web", "api"]],
  ["docker start web api", "start", ["web", "api"]],
  ["docker unpause web api", "unpause", ["web", "api"]],
  ["docker stop web", "stop", ["web"]],
  ["docker stop -t 30 web", "stop", ["web"]],
  ["docker stop --time=30 web api", "stop", ["web", "api"]],
  ["docker container stop web", "container stop", ["web"]],
  ["docker kill web", "kill", ["web"]],
  ["docker kill -s TERM web", "kill", ["web"]],
  ["docker kill --signal=SIGHUP web", "kill", ["web"]],
  ["docker kill -s usr1 web", "kill", ["web"]],
  ["docker kill -s sigint web", "kill", ["web"]],
  ["docker kill -sQUIT web", "kill", ["web"]],
  ["docker container kill -s USR2 web api", "container kill", ["web", "api"]],
  ["docker pause web", "pause", ["web"]],
  ["docker container pause web", "container pause", ["web"]],
  ["docker update --memory 512m web", "update", ["web"]],
  ["docker update -m 1g --memory-swap 2g web", "update", ["web"]],
  ["docker update --memory-swap -1 web", "update", ["web"]],
  ["docker update --memory-swap=-1 web", "update", ["web"]],
  ["docker update --memory-reservation 256MiB web", "update", ["web"]],
  ["docker update --cpus 1.5 web", "update", ["web"]],
  ["docker update -c 512 web", "update", ["web"]],
  ["docker update --cpu-shares=1024 web", "update", ["web"]],
  ["docker update --restart unless-stopped web", "update", ["web"]],
  ["docker update --restart on-failure:3 web", "update", ["web"]],
  ["docker update --restart=no web", "update", ["web"]],
  ["docker update --pids-limit 200 web", "update", ["web"]],
  ["docker update --pids-limit -1 web", "update", ["web"]],
  ["docker update web --cpus 2", "update", ["web"]],
  [
    "docker container update --cpus 2 web api",
    "container update",
    ["web", "api"],
  ],
];

// [command, a phrase the reason must contain]
const DENIED: Array<[string, string]> = [
  // Families that never run.
  ["docker exec web sh", "runs a program inside a container"],
  ["docker exec -it web sh", "runs a program inside a container"],
  ["docker container exec web ls", "runs a program inside a container"],
  ["docker run nginx", "creates and starts a new container"],
  ["docker run --privileged -v /:/host alpine", "creates and starts"],
  ["docker container run alpine", "creates and starts"],
  ["docker create nginx", "creates a new container"],
  ["docker cp web:/etc/passwd /tmp/x", "copies files"],
  ["docker attach web", "attaches to a container"],
  ["docker rm web", "deletes containers"],
  ["docker rm -f web", "deletes containers"],
  ["docker container rm web", "deletes containers"],
  ["docker container remove web", "deletes containers"],
  ["docker rmi nginx", "deletes images"],
  ["docker image rm nginx", "deletes images"],
  ["docker image remove nginx", "deletes images"],
  ["docker container prune -f", "deletes every stopped container"],
  ["docker image prune -a", "deletes images in bulk"],
  ["docker network prune", "deletes every unused network"],
  ["docker volume prune", "deletes volumes"],
  ["docker system prune -af", "in bulk"],
  ["docker build .", "builds images"],
  ["docker image build .", "builds images"],
  ["docker buildx build .", "builds images"],
  ["docker builder prune", "build cache"],
  ["docker push registry/app:1", "uploads images"],
  ["docker pull nginx", "downloads images"],
  ["docker image pull nginx", "downloads images"],
  ["docker login -u admin registry", "registry credentials"],
  ["docker logout", "registry credentials"],
  ["docker save nginx", "copies images out"],
  ["docker load", "loads images"],
  ["docker export web", "filesystem out"],
  ["docker import x.tar", "creates an image"],
  ["docker commit web img", "new image"],
  ["docker rename web web2", "renames a container"],
  ["docker wait web", "blocks until"],
  ["docker history nginx", "build arguments"],
  ["docker image history nginx", "build arguments"],
  ["docker tag a b", "retags"],
  ["docker search nginx", "queries a registry"],
  ["docker plugin ls", "plugins"],
  ["docker secret ls", "swarm secrets"],
  ["docker config ls", "swarm configs"],
  ["docker swarm init", "swarm membership"],
  ["docker context use other", "switches the engine"],
  ["docker trust inspect nginx", "trust data"],
  ["docker manifest inspect nginx", "manifests"],
  ["docker compose up -d", "not shipped with the agent"],
  ["docker compose ps", "not shipped with the agent"],
  ["docker checkpoint create web cp1", "checkpoints"],
  ["docker network create net1", "container networking"],
  ["docker network rm net1", "container networking"],
  ["docker network connect net1 web", "container networking"],
  ["docker network disconnect net1 web", "container networking"],
  ["docker volume create v1", "volumes"],
  ["docker volume rm v1", "deletes volumes"],
  ["docker system dial-stdio", "raw connection"],
  // Swarm commands belong to the swarm profile.
  ["docker service ls", "swarm command"],
  ["docker service update --force web", "swarm command"],
  ["docker node ls", "swarm command"],
  ["docker node update --availability drain n1", "swarm command"],
  ["docker stack ls", "swarm command"],
  ["docker service", "swarm command"],
  // Not a command at all.
  ["docker foo", "not a docker command"],
  ["docker PS", "docker commands are lowercase"],
  ["docker Restart web", "docker commands are lowercase"],
  ["docker container foo", "not a docker command"],
  ["docker", 'after "docker"'],
  ["docker container", "needs a subcommand"],
  ["docker image", "needs a subcommand"],
  // Global flags, before the command.
  ["docker -H tcp://evil:2375 ps", "global flags"],
  ["docker --host=unix:///var/run/other.sock ps", "global flags"],
  ["docker -c other ps", "global flags"],
  ["docker --context other ps", "global flags"],
  ["docker --config /tmp/x ps", "global flags"],
  ["docker --tls ps", "global flags"],
  ["docker --tlsverify --tlscacert x ps", "global flags"],
  ["docker -D ps", "global flags"],
  ["docker --debug ps", "global flags"],
  ["docker -l debug ps", "global flags"],
  ["docker --log-level debug ps", "global flags"],
  ["docker -v", "global flags"],
  ["docker --version", "global flags"],
  ["docker -- ps", "global flags"],
  ["docker --help", "global flags"],
  // A flag between a group and its subcommand.
  ["docker container -a ls", "comes before the docker container subcommand"],
  ["docker container --help", "comes before the docker container subcommand"],
  // ... and a global flag after the command is just a flag it lacks.
  ["docker ps -H tcp://evil:2375", "global flags"],
  ["docker ps --context other", "global flags"],
  ["docker restart --host=tcp://evil web", "global flags"],
  ["docker logs --tlsverify --tail 5 web", "global flags"],
  // ps
  ["docker ps web", "takes no container names"],
  ["docker ps --format '{{.Names}}'", "Go templates are not allowed"],
  ["docker ps --format 'table {{.Names}}'", "Go templates are not allowed"],
  ["docker ps --format '{{json .}}'", "Go templates are not allowed"],
  ["docker ps --filter", "needs a value"],
  ["docker ps --filter -q", "--filter takes KEY=VALUE"],
  ["docker ps --filter status", "--filter takes KEY=VALUE"],
  ["docker ps -n all", "-n/--last takes a number"],
  ["docker ps -n -1", "-n/--last takes a number"],
  ["docker ps -a -a", "more than once"],
  ["docker ps -aa", "more than once"],
  ["docker ps --all --all=false", "more than once"],
  ["docker ps --all true", 'got "true"'],
  ["docker ps -x", "not one OneUptime AI may use"],
  ["docker ps --no_trunc", "not one OneUptime AI may use"],
  ["docker ps --all=yes", "is a switch"],
  ["docker ps -a=", "not one OneUptime AI may use"],
  ["docker ps ---all", "not valid flag syntax"],
  ["docker ps --=x", "not valid flag syntax"],
  ["docker ps --help", "not one OneUptime AI may use"],
  // inspect
  ["docker inspect web", "needs --type"],
  ["docker inspect --type secret s1", "needs --type"],
  ["docker inspect --type config c1", "needs --type"],
  ["docker inspect --type node n1", "needs --type"],
  ["docker inspect --type Container web", "needs --type"],
  [
    "docker inspect --type container --format '{{json .Config.Env}}' web",
    "Go templates",
  ],
  ["docker inspect --type container -f '{{.Config.Env}}' web", "Go templates"],
  ["docker inspect --type container --format table web", "Go templates"],
  ["docker inspect --type container", "at least one container"],
  ["docker container inspect", "at least one container"],
  [
    "docker container inspect -f '{{range .Config.Env}}{{.}} {{end}}' web",
    "Go templates",
  ],
  ["docker container inspect '{{.Config.Env}}'", "not a container name"],
  ["docker image inspect --platform linux/amd64 nginx", "not one OneUptime AI"],
  ["docker image inspect ' nginx'", "not a image name"],
  ["docker volume inspect -s data", "not one OneUptime AI"],
  // logs
  ["docker logs web", "needs --tail N"],
  ["docker logs -f web", "streams the log"],
  ["docker logs --follow --tail 10 web", "streams the log"],
  ["docker logs --tail 10 -f web", "streams the log"],
  ["docker logs -tf --tail 10 web", "streams the log"],
  ["docker logs --follow=false --tail 10 web", "streams the log"],
  ["docker logs --tail 2001 web", "from 0 to 2000"],
  ["docker logs --tail all web", "from 0 to 2000"],
  ["docker logs --tail -1 web", "from 0 to 2000"],
  ["docker logs --tail +5 web", "from 0 to 2000"],
  ["docker logs --tail 99999999999 web", "from 0 to 2000"],
  ["docker logs --tail '' web", "from 0 to 2000"],
  ["docker logs --since '' web", "--since takes a duration"],
  ["docker logs --since=0 web", "--since takes a duration"],
  ["docker logs --since -f web", "--since takes a duration"],
  ["docker logs --since yesterday web", "--since takes a duration"],
  ["docker logs --since -10m web", "--since takes a duration"],
  ["docker logs --tail 10 --until soon web", "--until takes a duration"],
  ["docker logs --until 5m web", "needs --tail N"],
  // --since alone must bound the slice: a duration of at most 24h
  ["docker logs --since 2001-01-01 web", "is an absolute time"],
  ["docker logs --since 2026-09-29T10:00:00Z web", "is an absolute time"],
  ["docker logs --since 1758000000 web", "is an absolute time"],
  ["docker logs --since 100000h web", "further back than 24h"],
  ["docker logs --since 24h1s web", "further back than 24h"],
  ["docker logs --since 1441m web", "further back than 24h"],
  ["docker logs --tail 10 web api", "exactly one container"],
  ["docker logs --tail 10", "exactly one container"],
  ["docker logs --tail 10 --tail 20 web", "more than once"],
  ["docker logs -n 10 --tail 20 web", "more than once"],
  ["docker logs --tail 10 wеb", "not a container name"],
  // stats
  ["docker stats", "needs --no-stream"],
  ["docker stats web", "needs --no-stream"],
  ["docker stats --no-stream=false", "needs --no-stream"],
  ["docker stats --no-stream --no-stream=false", "more than once"],
  ["docker stats --no-stream --format '{{.Name}}'", "Go templates"],
  ["docker stats --no-stream '--format=table {{.Name}}'", "Go templates"],
  ["docker stats --no-stream=maybe", "is a switch"],
  // top
  ["docker top web aux", "no ps options"],
  ["docker top web -eo pid,args", "no ps options"],
  ["docker top", "exactly one container"],
  ["docker top -x web", "not one OneUptime AI"],
  // events
  ["docker events", "needs both --since and --until"],
  ["docker events --since 10m", "needs both --since and --until"],
  ["docker events --until 0s", "needs both --since and --until"],
  ["docker events --since 10m --until 0s web", "takes no names"],
  [
    "docker events --since 10m --until 0s --format '{{json .}}'",
    "Go templates",
  ],
  ["docker events --since=0 --until 0s", "take a duration"],
  ["docker events --since 10m --until never", "take a duration"],
  // an absolute --until can lie in the future: docker events would stream
  [
    "docker events --since 30m --until 2099-12-31",
    "--until must be a duration",
  ],
  [
    "docker events --since 30m --until 9999999999",
    "--until must be a duration",
  ],
  [
    "docker events --since 30m --until 2026-09-29T11:00:00Z",
    "--until must be a duration",
  ],
  [
    "docker system events --since 1m --until 2099-12-31",
    "--until must be a duration",
  ],
  // info, version, df
  ["docker info --format '{{.ServerVersion}}'", "Go templates"],
  ["docker info extra", "takes no arguments"],
  ["docker version --format '{{.Server.Version}}'", "Go templates"],
  ["docker system df -v --format '{{.Size}}'", "Go templates"],
  // -v with json prints every build-cache record's RUN command line
  ["docker system df -v --format json", "build-cache record's Description"],
  [
    "docker system df --verbose --format=json",
    "build-cache record's Description",
  ],
  ["docker system df --format json -v", "build-cache record's Description"],
  ["docker system df extra", "takes no arguments"],
  // images, networks, volumes
  ["docker images a b", "at most one"],
  ["docker images --tree", "not one OneUptime AI"],
  ["docker network ls extra", "takes no arguments"],
  ["docker volume ls --cluster", "not one OneUptime AI"],
  // port, diff
  ["docker port web http", "is not a PORT"],
  ["docker port web 80 81", "one PORT"],
  ["docker port", "one PORT"],
  ["docker diff", "exactly one container"],
  ["docker diff a b", "exactly one container"],
  // writes with bad shapes
  ["docker restart", "needs the container"],
  ["docker restart -s KILL web", "clean stop"],
  ["docker restart --signal=SIGKILL web", "clean stop"],
  ["docker restart -t abc web", "-t/--timeout takes"],
  ["docker restart -t 601 web", "-t/--timeout takes"],
  ["docker restart -t -1 web", "-t/--timeout takes"],
  ["docker restart -tweb", "-t/--timeout takes"],
  ["docker restart --time 5 --timeout 6 web", "more than once"],
  ["docker restart -t", "needs a value"],
  ["docker restart ''", "not a container name"],
  ["docker restart /web", "not a container name"],
  ["docker restart 'web;rm'", "not a container name"],
  ["docker restart '-web'", "not one OneUptime AI"],
  ["docker restart -- -web", "not a container name"],
  ["docker restart web --privileged", "not one OneUptime AI"],
  ["docker start -a web", "never attaches"],
  ["docker start -ai web", "never attaches"],
  ["docker start --interactive web", "never attaches"],
  ["docker start --checkpoint cp1 web", "checkpoint"],
  ["docker start", "needs the container"],
  ["docker unpause --all", "not one OneUptime AI"],
  ["docker stop -s SIGKILL web", "clean stop"],
  ["docker stop", "needs the container"],
  ["docker kill -s STOP web", "-s/--signal must be one of"],
  ["docker kill -s 9 web", "-s/--signal must be one of"],
  ["docker kill -s SIGSIGTERM web", "-s/--signal must be one of"],
  ["docker kill -s '' web", "-s/--signal must be one of"],
  ["docker kill -s TERM -s KILL web", "more than once"],
  ["docker kill", "needs the container"],
  ["docker pause", "needs the container"],
  ["docker update web", "needs at least one of"],
  ["docker update --memory lots web", "--memory takes"],
  ["docker update --memory -1 web", "--memory takes"],
  ["docker update --cpus two web", "--cpus takes"],
  ["docker update --cpu-shares 999999 web", "--cpu-shares takes"],
  ["docker update --restart sometimes web", "--restart takes"],
  ["docker update --restart on-failure:x web", "--restart takes"],
  ["docker update --pids-limit -2 web", "--pids-limit takes"],
  ["docker update --blkio-weight 100 web", "not one OneUptime AI"],
  ["docker update --cpuset-cpus 0-1 web", "not one OneUptime AI"],
  ["docker update --cpu-quota 50000 web", "not one OneUptime AI"],
  ["docker update --kernel-memory 1g web", "not one OneUptime AI"],
  ["docker update --privileged web", "not one OneUptime AI"],
  ["docker update --memory 1g", "needs the container"],
  ["docker update -m 1g -m 2g web", "more than once"],
  ["docker update -m 1g --memory 2g web", "more than once"],
];

function describeTargets(targets: Array<string>): string {
  return JSON.stringify(targets);
}

describe("docker-engine: the tool policy object", () => {
  test("is named and covers docker only", () => {
    expect(DockerEngineCommandPolicy.name).toBe("docker-engine");
    expect([...DockerEngineCommandPolicy.programs]).toEqual(["docker"]);
    expect(DOCKER_ENGINE_PROFILE.name).toBe("docker-engine");
  });

  test.each(
    DOCKER_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )("%s routes to it", (type: AiResourceType) => {
    expect(ResourceCommandPolicy.getToolPolicy(type)).toBe(
      DockerEngineCommandPolicy,
    );
  });

  test("its write table covers exactly the engine's write paths", () => {
    expect([...DOCKER_ENGINE_WRITE_COMMANDS.keys()].sort()).toEqual(
      [...DOCKER_ENGINE_WRITE_PATHS].sort(),
    );
  });

  test("every read command in the table has an example below", () => {
    const covered: Set<string> = new Set<string>(
      READS.map((row: [string, string]): string => {
        return row[1];
      }),
    );

    for (const spec of DOCKER_ENGINE_READ_COMMANDS.values()) {
      expect(covered.has(spec.verb)).toBe(true);
    }
  });

  test("every write command in the table has an example below", () => {
    const covered: Set<string> = new Set<string>(
      [...SAFE_WRITES, ...RISKY_WRITES].map(
        (row: [string, string, Array<string>]): string => {
          return row[1];
        },
      ),
    );

    for (const spec of DOCKER_ENGINE_WRITE_COMMANDS.values()) {
      expect(covered.has(spec.verb)).toBe(true);
    }
  });
});

describe("docker-engine: reads", () => {
  test.each(READS)("%p is Read (%s)", (command: string, verb: string) => {
    for (const type of DOCKER_TYPES) {
      const result: ResourceCommandPolicyResult = evaluate(command, type);

      expect(result.reason).not.toContain("never allowed");
      expect(result.tier).toBe(ResourceCommandTier.Read);
      expect(result.verb).toBe(verb);
      expect(result.targets).toEqual([]);
      expect(result.requiresHuman).toBeUndefined();
      expect(result.program).toBe("docker");
      expect(
        ResourceCommandPolicy.isReadOnly({ resourceType: type, command }),
      ).toBe(true);
    }
  });

  test.each(
    DOCKER_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )("%s: every Test connection command is Read", (type: AiResourceType) => {
    for (const command of AI_RESOURCE_TYPE_INFO[type].testCommands) {
      expect(evaluate(command, type).tier).toBe(ResourceCommandTier.Read);
    }
  });
});

describe("docker-engine: SafeWrite — exactly one container", () => {
  test.each(SAFE_WRITES)(
    "%p is SafeWrite (%s) on %p",
    (command: string, verb: string, targets: Array<string>) => {
      for (const type of DOCKER_TYPES) {
        const result: ResourceCommandPolicyResult = evaluate(command, type);

        expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
        expect(result.verb).toBe(verb);
        expect(result.targets).toEqual(targets);
        expect(result.requiresHuman).toBeUndefined();
      }
    },
  );
});

describe("docker-engine: RiskyWrite", () => {
  test.each(RISKY_WRITES)(
    "%p is RiskyWrite (%s) on %p",
    (command: string, verb: string, targets: Array<string>) => {
      for (const type of DOCKER_TYPES) {
        const result: ResourceCommandPolicyResult = evaluate(command, type);

        expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
        expect(result.verb).toBe(verb);
        expect(describeTargets(result.targets)).toBe(describeTargets(targets));
        expect(result.requiresHuman).toBeUndefined();
      }
    },
  );

  test("a SafeWrite verb naming several containers says why it is risky", () => {
    expect(evaluate("docker restart web api").reason).toContain(
      "exactly one container",
    );
    expect(evaluate("docker start web api").reason).toContain(
      "exactly one container",
    );
  });

  test("kill names the signal it sends", () => {
    expect(evaluate("docker kill web").reason).toContain("SIGKILL");
    expect(evaluate("docker kill -s sigterm web").reason).toContain("SIGTERM");
    expect(evaluate("docker kill -s HUP web").reason).not.toContain(
      "without a clean shutdown",
    );
  });

  test("update names what it changes", () => {
    const reason: string = evaluate(
      "docker update --cpus 2 -m 1g --restart always web",
    ).reason;

    expect(reason).toContain("--memory");
    expect(reason).toContain("--cpus");
    expect(reason).toContain("--restart");
  });
});

describe("docker-engine: Denied", () => {
  test.each(DENIED)("%p is Denied (%s)", (command: string, phrase: string) => {
    for (const type of DOCKER_TYPES) {
      const result: ResourceCommandPolicyResult = evaluate(command, type);

      expect(result.tier).toBe(ResourceCommandTier.Denied);
      expect(result.reason).toContain(phrase);
      expect(result.targets).toEqual([]);
      expect(result.requiresHuman).toBeUndefined();
      expect(
        ResourceCommandPolicy.isReadOnly({ resourceType: type, command }),
      ).toBe(false);
    }
  });

  test("a refused command tells the model what IS allowed", () => {
    for (const command of [
      "docker exec web sh",
      "docker foo",
      "docker service ls",
      "docker -H tcp://x ps",
      "docker container",
    ]) {
      const reason: string = evaluate(command).reason;

      expect(reason).toContain("Allowed for a Docker or Podman host");
      expect(reason).toContain("docker logs --tail 200 NAME");
      expect(reason).toContain("docker restart|start|unpause NAME");
    }
  });

  test("a refused flag names the flags the command allows", () => {
    const reason: string = evaluate("docker logs --bogus web").reason;

    expect(reason).toContain("--bogus");
    expect(reason).toContain("-n/--tail VALUE");
    expect(reason).toContain("--since VALUE");
    expect(reason).not.toContain("--follow");
  });

  test("a refused flag with no allowed alternatives says so", () => {
    expect(evaluate("docker top -x web").reason).toContain("allows: none");
  });

  test("the verb of a Denied command is kept for the audit trail when known", () => {
    expect(evaluate("docker logs -f web").verb).toBe("logs");
    expect(evaluate("docker exec web sh").verb).toBe("");
  });

  test("a flag in a short cluster is named with the word it hides in", () => {
    expect(evaluate("docker logs -tf --tail 5 web").reason).toContain(
      '-f (in "-tf")',
    );
  });
});

describe("docker-engine: smuggling attempts", () => {
  test.each([
    // A value flag swallowing the next word, as docker does.
    [["docker", "logs", "--since", "--follow", "web"]],
    [["docker", "ps", "--filter", "--format={{.Names}}"]],
    [["docker", "kill", "-s", "-9", "web"]],
    [["docker", "update", "--memory", "--privileged", "web"]],
    // A switch never swallows: its "value" becomes a positional.
    [["docker", "ps", "--all", "false"]],
    [["docker", "restart", "-t", "5", "web", "--", "--privileged"]],
    // Unicode look-alikes are never flags nor names.
    [["docker", "logs", "—tail", "10", "web"]],
    [["docker", "restart", "–t", "5", "web"]],
    [["docker", "restart", "－t", "web"]],
    [["docker", "ps", "-а"]],
    [["docker", "rеstart", "web"]],
    [["docker", "restart", "web​"]],
    [["docker", "restart", "web "]],
    [["docker", "ps​"]],
    // Empty words.
    [["docker", ""]],
    [["docker", "", "ps"]],
    [["docker", "ps", ""]],
    [["docker", "logs", "--tail", "", "web"]],
    [["docker", "restart", ""]],
    // Very long words.
    [["docker", "restart", "a".repeat(256)]],
    [["docker", "logs", "--tail", "1".repeat(50), "web"]],
    [["docker", "logs", "--since", "1h".repeat(40), "web"]],
    // Quotes survive tokenizing as part of the word.
    [["docker", "restart", "'web'"]],
    [["docker", "restart", '"web"']],
    // Case.
    [["docker", "LOGS", "--tail", "5", "web"]],
    [["docker", "logs", "--TAIL", "5", "web"]],
    [["docker", "logs", "-N", "5", "web"]],
  ])("%p is Denied", (argv: Array<string>) => {
    const result: ResourceCommandPolicyResult = evaluateArgv(argv);

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.targets).toEqual([]);
  });

  test("flags after positionals are read exactly as docker reads them", () => {
    expect(evaluate("docker restart web -t 5").tier).toBe(
      ResourceCommandTier.SafeWrite,
    );
    expect(evaluate("docker restart web -t 5 api").targets).toEqual([
      "web",
      "api",
    ]);
    expect(evaluate("docker logs web -f --tail 5").tier).toBe(
      ResourceCommandTier.Denied,
    );
  });

  test('"--" ends the flags: a flag after it is a (bad) container name', () => {
    const result: ResourceCommandPolicyResult = evaluate(
      "docker restart -- web --privileged",
    );

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toContain('"--privileged" is not a container name');
  });

  test("a cluster whose value letter takes the rest of the word", () => {
    // -n takes "5a" as its value: not a number, so denied, not "-n 5 -a".
    expect(evaluate("docker ps -n5a").reason).toContain("-n/--last");
    // -a then -n with the next word.
    expect(evaluate("docker ps -an 5").tier).toBe(ResourceCommandTier.Read);
    // -n at the end of a cluster with nothing after it.
    expect(evaluate("docker ps -an").reason).toContain("needs a value");
  });

  test('a switch never takes the next word: "--no-stream false" still streams nothing', () => {
    const result: ResourceCommandPolicyResult = evaluateArgv([
      "docker",
      "stats",
      "--no-stream",
      "false",
    ]);

    // docker reads "false" as a container name, and --no-stream stays on.
    expect(result.tier).toBe(ResourceCommandTier.Read);
    expect(result.args).toEqual(["stats", "--no-stream", "false"]);
  });

  test("docker top stops reading flags at the container", () => {
    expect(evaluate("docker top web --privileged").reason).toContain(
      "no ps options",
    );
  });

  test("the dispatcher refuses shell syntax before the policy sees it", () => {
    for (const command of [
      "docker ps | grep web",
      "docker restart web; docker rm web",
      "docker logs --tail 5 web > /tmp/x",
      "docker restart $(docker ps -q)",
      "docker restart `docker ps -q`",
      "docker ps && docker rm web",
    ]) {
      const result: ResourceCommandPolicyResult = evaluate(command);

      expect(result.tier).toBe(ResourceCommandTier.Denied);
      expect(result.reason).toContain("pipes and redirects are not supported");
    }
  });

  test("sudo and a program path are refused before the policy sees them", () => {
    expect(evaluate("sudo docker ps").tier).toBe(ResourceCommandTier.Denied);
    expect(evaluate("/usr/bin/docker ps").reason).toContain("without a path");
    expect(evaluate("podman ps", AiResourceType.PodmanHost).reason).toContain(
      "is not a program the Podman AI agent runs",
    );
  });
});

describe("docker-engine: evaluateArgv is total and fail-closed", () => {
  test.each([
    [null],
    [undefined],
    ["docker ps"],
    [42],
    [{}],
    [[]],
    [["docker", 7]],
    [["docker", null, "ps"]],
    [["kubectl", "get", "pods"]],
    [["docker "]],
    [["Docker", "ps"]],
    [
      Array.from({ length: 200 }, (): string => {
        return "ps";
      }),
    ],
    [
      [
        "docker",
        "restart",
        ...Array.from({ length: 70 }, (): string => {
          return "web";
        }),
      ],
    ],
  ])("%p is Denied without throwing", (argv: unknown) => {
    let result: ResourceCommandPolicyResult | undefined;

    expect(() => {
      result = DockerEngineCommandPolicy.evaluateArgv(argv as Array<string>);
    }).not.toThrow();
    expect(result && result.tier).toBe(ResourceCommandTier.Denied);
    expect(result && result.targets).toEqual([]);
  });

  test("it never changes the argv it is given", () => {
    const argv: Array<string> = ["docker", "restart", "-t", "5", "web"];

    DockerEngineCommandPolicy.evaluateArgv(argv);
    expect(argv).toEqual(["docker", "restart", "-t", "5", "web"]);
  });

  test("the program must be docker", () => {
    expect(
      DockerEngineCommandPolicy.evaluateArgv(["podman", "ps"]).reason,
    ).toContain('start the command with "docker"');
  });
});

describe("docker-engine: the result's shape", () => {
  test("args are the words after the program, exactly as written", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      "docker container list -aq --filter 'name=web'",
    );

    expect(result.args).toEqual([
      "container",
      "list",
      "-aq",
      "--filter",
      "name=web",
    ]);
    expect(result.verb).toBe("container ls");
  });

  test.each([
    ["docker restart web", "docker restart web"],
    ["docker restart  'web'", "docker restart web"],
    [
      "docker ps --filter 'label=com.example.team=a b'",
      "docker ps --filter 'label=com.example.team=a b'",
    ],
    ["docker ps --format '{{.Names}}'", "docker ps --format '{{.Names}}'"],
    ['docker logs --tail 10 "my app"', "docker logs --tail 10 'my app'"],
    ["docker restart ''", "docker restart ''"],
  ])("%p is displayed as %p", (command: string, display: string) => {
    const result: ResourceCommandPolicyResult = evaluate(command);

    expect(result.displayCommand).toBe(display);
    // The display round-trips through the tokenizer.
    expect(tokenizeResourceCommand(result.displayCommand).argv).toEqual(
      tokenizeResourceCommand(command).argv,
    );
  });

  test("reads have no targets; writes name their containers once each", () => {
    expect(evaluate("docker logs --tail 5 web").targets).toEqual([]);
    expect(evaluate("docker stats --no-stream web api").targets).toEqual([]);
    expect(evaluate("docker stop web api web").targets).toEqual(["web", "api"]);
  });

  test("the kill-signal normalizer reads names as the engine does", () => {
    expect(normalizeDockerKillSignal("SIGTERM")).toBe("TERM");
    expect(normalizeDockerKillSignal("term")).toBe("TERM");
    expect(normalizeDockerKillSignal("SigHup")).toBe("HUP");
    expect(normalizeDockerKillSignal("9")).toBeNull();
    expect(normalizeDockerKillSignal("SIGSTOP")).toBeNull();
    expect(normalizeDockerKillSignal(7 as unknown as string)).toBeNull();
    expect(DOCKER_KILL_SIGNALS).toContain("KILL");
  });
});

describe("docker-engine: the auto-execution ladder through the dispatcher", () => {
  function verdictFor(data: {
    command: string;
    allowlistPatterns?: Array<string>;
    bypassApproval?: boolean;
    resourceType?: AiResourceType;
  }): ResourceAutoExecutionVerdict {
    return ResourceCommandPolicy.evaluateForAutoExecution({
      resourceType: data.resourceType ?? AiResourceType.DockerHost,
      command: data.command,
      allowlistPatterns: data.allowlistPatterns ?? [],
      bypassApproval: data.bypassApproval ?? false,
    });
  }

  test("a read is AutoApproved (it changes nothing)", () => {
    expect(verdictFor({ command: "docker ps -a" }).verdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
  });

  test.each(
    DOCKER_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )(
    "%s: a restart of one container is AutoApproved",
    (type: AiResourceType) => {
      const verdict: ResourceAutoExecutionVerdict = verdictFor({
        command: "docker restart web",
        resourceType: type,
      });

      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.AutoApproved,
      );
      expect(verdict.tier).toBe(ResourceCommandTier.SafeWrite);
    },
  );

  test("a restart of several containers needs approval", () => {
    expect(verdictFor({ command: "docker restart web api" }).verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
  });

  test("a stop needs approval, unless bypassed or allowlisted", () => {
    expect(verdictFor({ command: "docker stop web" }).verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(
      verdictFor({ command: "docker stop web", bypassApproval: true }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    expect(
      verdictFor({
        command: "docker stop web",
        allowlistPatterns: ["docker stop web"],
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    expect(
      verdictFor({
        command: "docker stop web",
        allowlistPatterns: ["docker stop *"],
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    expect(
      verdictFor({
        command: "docker stop web",
        allowlistPatterns: ["docker stop api"],
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
  });

  test("a Denied command stays Denied whatever the settings", () => {
    const verdict: ResourceAutoExecutionVerdict = verdictFor({
      command: "docker exec web sh",
      allowlistPatterns: ["docker exec * sh"],
      bypassApproval: true,
    });

    expect(verdict.verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
    expect(verdict.reason).toContain("cannot run even with human approval");
  });

  test("no docker-engine write asks for a human by itself", () => {
    for (const [command] of [...SAFE_WRITES, ...RISKY_WRITES]) {
      expect(verdictFor({ command, bypassApproval: true }).verdict).toBe(
        AiRemediationCommandPolicyVerdict.AutoApproved,
      );
    }
  });
});

describe("docker-engine: allowlist entries", () => {
  function problem(pattern: unknown): string | null {
    return ResourceCommandPolicy.describeAllowlistPatternProblem({
      resourceType: AiResourceType.DockerHost,
      pattern,
    });
  }

  function isBroad(pattern: string): boolean {
    return ResourceCommandPolicy.isBroadAllowlistPattern({
      resourceType: AiResourceType.DockerHost,
      pattern,
    });
  }

  test.each([
    ["docker stop *"],
    ["docker stop web"],
    ["docker restart *"],
    ["docker kill -s TERM *"],
    ["docker update --memory * web"],
    ["docker update --memory 1g *"],
    ["docker pause *"],
    ["docker container stop *"],
  ])("%p is a valid entry", (pattern: string) => {
    expect(problem(pattern)).toBeNull();
  });

  test.each([
    ["docker ps -a", "read-only command"],
    ["docker logs --tail 10 *", "read-only command"],
    ["docker exec * sh", "can never match"],
    ["docker kill -s * web", "can never match"],
    ["docker service update --force *", "can never match"],
    ["docker * web", "where the command goes"],
    ["docker stop", "fewer than two words"],
    ["podman stop *", "does not start with a program"],
    ["docker stop * | xargs", "cannot be read as one command"],
    ["docker -H tcp://x stop *", "can never match"],
  ])("%p is refused (%s)", (pattern: string, phrase: string) => {
    expect(problem(pattern)).toContain(phrase);
  });

  test("an entry with a * for the container is broad; one naming it is not", () => {
    expect(isBroad("docker stop *")).toBe(true);
    expect(isBroad("docker update --memory 1g *")).toBe(true);
    expect(isBroad("docker update --memory * web")).toBe(false);
    expect(isBroad("docker stop web")).toBe(false);
    expect(isBroad("docker ps *")).toBe(false);
  });

  test("matching is word by word", () => {
    const matches: (command: string, patterns: Array<string>) => boolean = (
      command: string,
      patterns: Array<string>,
    ): boolean => {
      return ResourceCommandPolicy.matchesAllowlist({
        resourceType: AiResourceType.DockerHost,
        command,
        patterns,
      });
    };

    expect(matches("docker kill -s TERM web", ["docker kill -s TERM *"])).toBe(
      true,
    );
    expect(matches("docker kill -s TERM web", ["docker kill *"])).toBe(false);
    expect(matches("docker stop -t 5 web", ["docker stop *"])).toBe(false);
    expect(matches("docker stop web api", ["docker stop *"])).toBe(false);
    // An entry that can never pre-approve anything is skipped.
    expect(matches("docker exec web sh", ["docker exec * sh"])).toBe(false);
  });
});

describe("docker-engine: the agent's write scope", () => {
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
      resourceType: AiResourceType.DockerHost,
    });
  }

  test("a read is never refused, even by a read-only agent", () => {
    expect(refusal("docker ps", { allowWrites: false })).toBeNull();
  });

  test("a read-only agent refuses every write", () => {
    expect(refusal("docker restart web", { allowWrites: false })).toContain(
      "ONEUPTIME_AI_ALLOW_WRITES=true",
    );
  });

  test("the agent's own container is protected, by name or id prefix", () => {
    const protectedTargets: Array<string> = [
      "oneuptime-ai-agent",
      "3f2a9c1b7d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8",
    ];

    expect(
      refusal("docker restart oneuptime-ai-agent", { protectedTargets }),
    ).toContain("protects");
    expect(refusal("docker stop 3f2a", { protectedTargets })).toContain(
      "protects",
    );
    expect(
      refusal("docker restart web oneuptime-ai-agent", { protectedTargets }),
    ).toContain("protects");
    expect(refusal("docker restart web", { protectedTargets })).toBeNull();
  });

  test("ONEUPTIME_AI_WRITE_TARGETS bounds every target", () => {
    expect(
      refusal("docker restart web-1", { writeTargets: ["web-*"] }),
    ).toBeNull();
    expect(
      refusal("docker stop web-1 db", { writeTargets: ["web-*"] }),
    ).toContain("ONEUPTIME_AI_WRITE_TARGETS");
  });

  test("a Denied command is refused", () => {
    expect(refusal("docker exec web sh")).toContain("denied");
  });
});

describe("docker-engine: command guides", () => {
  test("the read guide lists the bounded reads as markdown bullets", () => {
    const guide: string = DockerEngineCommandPolicy.readCommandGuide;

    for (const line of guide.split("\n")) {
      expect(line.startsWith("- ")).toBe(true);
    }

    for (const phrase of [
      "docker ps",
      "docker container inspect NAME",
      "--tail",
      "2000",
      "--since",
      "--no-stream",
      "docker events --since 30m --until 0s",
      "docker info",
      "--format json",
    ]) {
      expect(guide).toContain(phrase);
    }
  });

  test("every command the read guide suggests is actually Read", () => {
    for (const command of [
      "docker ps -a",
      "docker container inspect NAME",
      "docker inspect --type container NAME",
      "docker logs --tail 200 NAME",
      "docker logs --since 30m NAME",
      "docker stats --no-stream",
      "docker top NAME",
      "docker port NAME",
      "docker diff NAME",
      "docker events --since 30m --until 0s",
      "docker info",
      "docker version",
      "docker system df -v",
      "docker images",
      "docker image inspect IMAGE",
      "docker network ls",
      "docker network inspect NAME",
      "docker volume ls",
      "docker volume inspect NAME",
    ]) {
      expect(evaluate(command).tier).toBe(ResourceCommandTier.Read);
    }
  });

  test("every change the write guide suggests has the tier it claims", () => {
    for (const command of [
      "docker restart NAME",
      "docker restart -t 10 NAME",
      "docker start NAME",
      "docker unpause NAME",
    ]) {
      expect(evaluate(command).tier).toBe(ResourceCommandTier.SafeWrite);
    }

    for (const command of [
      "docker stop NAME",
      "docker stop -t 10 NAME",
      "docker kill -s TERM NAME",
      "docker pause NAME",
      "docker update --memory 1g NAME",
      "docker update --cpus 1.5 NAME",
      "docker update --restart on-failure:3 NAME",
    ]) {
      expect(evaluate(command).tier).toBe(ResourceCommandTier.RiskyWrite);
    }
  });

  test("the write guide names the tiers and the never-list", () => {
    const guide: string = DockerEngineCommandPolicy.writeCommandGuide;

    expect(guide).toContain("Safe");
    expect(guide).toContain("Risky");
    expect(guide).toContain("Never");
    expect(guide).toContain("exec");

    for (const line of guide.split("\n")) {
      expect(line.startsWith("- ")).toBe(true);
    }
  });

  test("the dispatcher serves these guides for Docker and Podman hosts", () => {
    for (const type of DOCKER_TYPES) {
      expect(ResourceCommandPolicy.getReadCommandGuide(type)).toBe(
        DockerEngineCommandPolicy.readCommandGuide,
      );
      expect(ResourceCommandPolicy.getWriteCommandGuide(type)).toBe(
        DockerEngineCommandPolicy.writeCommandGuide,
      );
    }
  });
});
