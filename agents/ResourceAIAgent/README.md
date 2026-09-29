# OneUptime Resource AI Agent

A small Node.js service that runs next to one piece of your infrastructure and carries out the commands OneUptime AI asks for — to look at it while it investigates an incident or alert, and (only if you allow it) to apply a fix.

One image (`oneuptime/resource-ai-agent`) serves every kind of resource below; `ONEUPTIME_AI_AGENT_RESOURCE_TYPE` says which one this agent serves. It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`, and it shows up on the resource's **AI → AI agent** page in OneUptime. Kubernetes clusters have their own agent (`agents/KubernetesAIAgent`, installed by the Kubernetes agent Helm chart).

The user documentation — install, what each resource may run, how fixes work, credentials and the security model — is [Infrastructure AI Agents](https://oneuptime.com/docs/ai/infrastructure-ai-agents).

## Supported resources

| `ONEUPTIME_AI_AGENT_RESOURCE_TYPE` | Resource | Identity (the collector's variable) | What it runs |
| --- | --- | --- | --- |
| `docker` | Docker host | `DOCKER_HOST_NAME` | `docker`, against the Docker socket |
| `podman` | Podman host | `PODMAN_HOST_NAME` | `docker`, against Podman's Docker-compatible socket |
| `docker-swarm` (or `swarm`) | Docker Swarm cluster | `DOCKER_SWARM_CLUSTER_NAME` | `docker`, on a manager node |
| `proxmox` | Proxmox cluster | `PROXMOX_CLUSTER_NAME` | `pvesh` commands, sent to the Proxmox VE API |
| `vmware` (or `vcenter`) | VMware vCenter | `VMWARE_VCENTER_NAME` | `govc` |
| `ceph` | Ceph cluster | `CEPH_CLUSTER_NAME` | `ceph` |
| `database` (or `db`) | Database server | `DATABASE_SERVER_ID`, else `DATABASE_SYSTEM` + `DATABASE_SERVER_ADDRESS` + `DATABASE_SERVER_PORT` | `db` — a fixed catalog of diagnostics run through the database's own driver, never free SQL |
| `host` | Host | `HOST_NAME` (defaults to the host's own hostname) | the host's own tools (`systemctl`, `journalctl`, `df`, `ps`, `ss`, …) through `nsenter` |

The agent registers with the **same identity the collector reports**, so it serves exactly the resource the collector's telemetry created in OneUptime. If the collector still uses its default name (`docker-host`, `ceph`, …), every host installed with that default reports into the same resource — the agent warns about it at start-up. Give each one a unique name, on the collector and the agent alike.

## Install

The agent runs as one more service in the resource's collector `docker-compose.yml`, reading the collector's `.env`, so it already has `ONEUPTIME_URL`, the ingestion key and the resource's name. Every collector ships it, named `oneuptime-<alias>-ai-agent`:

| Resource | Compose file | Service (and container) |
| --- | --- | --- |
| Docker host | `agents/DockerAgent/docker-compose.yml` (`install.sh` starts it as a second container) | `oneuptime-docker-ai-agent` |
| Podman host | `agents/PodmanAgent/docker-compose.yml` (`install.sh` starts it as a second container) | `oneuptime-podman-ai-agent` |
| Docker Swarm cluster | `agents/DockerSwarmAgent/docker-compose.yml`, on a manager node | `oneuptime-docker-swarm-ai-agent` |
| Proxmox cluster | `agents/ProxmoxAgent/docker-compose.yml` | `oneuptime-proxmox-ai-agent` |
| VMware vCenter | `agents/VMwareAgent/docker-compose.yml` | `oneuptime-vmware-ai-agent` |
| Ceph cluster | `agents/CephAgent/docker-compose.yml` | `oneuptime-ceph-ai-agent` |
| Database server | `agents/DatabaseAgent/docker-compose.yml` | `oneuptime-database-ai-agent` (no fixed container name) |
| Host | `agents/HostAIAgent/docker-compose.yml`, with its own `install.sh` | `oneuptime-host-ai-agent` |

The shape of the service (the collector's compose file carries the complete, per-resource version, with its socket, keyring or connection settings):

```yaml
  oneuptime-docker-ai-agent:
    image: oneuptime/resource-ai-agent:release
    container_name: oneuptime-docker-ai-agent
    user: "0:0"
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - ONEUPTIME_URL=${ONEUPTIME_URL}
      - ONEUPTIME_SERVICE_TOKEN=${ONEUPTIME_SERVICE_TOKEN}
      - ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker
      - DOCKER_HOST_NAME=${DOCKER_HOST_NAME:-docker-host}
      - ONEUPTIME_AI_ALLOW_WRITES=${ONEUPTIME_AI_ALLOW_WRITES:-false}
      - ONEUPTIME_AI_WRITE_TARGETS=${ONEUPTIME_AI_WRITE_TARGETS:-}
      - ONEUPTIME_AI_PROTECTED_TARGETS=${ONEUPTIME_AI_PROTECTED_TARGETS:-}
    restart: unless-stopped
```

Nothing else is needed for OneUptime AI to investigate with it. To let it apply fixes, set `ONEUPTIME_AI_ALLOW_WRITES=true` in the `.env` and run `docker compose up -d`; then choose on the resource's **AI → AI agent** page whether a person approves each fix.

## What it may do

- **Read (default).** Commands that look and change nothing: `docker ps`, `docker logs`, `pvesh get …`, `govc vm.info`, `ceph health`, `db ping`, `systemctl status`, …. Investigations only ever run these.
- **Change things (opt-in).** Only with `ONEUPTIME_AI_ALLOW_WRITES=true`, and then only on the targets `ONEUPTIME_AI_WRITE_TARGETS` allows (all of them when it is empty), never on the agent's own container, the collector beside it, or anything in `ONEUPTIME_AI_PROTECTED_TARGETS`. Whether AI proposes fixes at all, and whether a person must approve them, is set per resource in OneUptime.
- **Never.** A shell, pipes or redirects; `sudo`; anything that reads credentials; running a new container or VM image; deleting data; free-form SQL; anything the command policy does not know.

Every command is sorted by one shared policy (`packages/Common/Utils/AiRemediation/Resource`) into **Read**, **SafeWrite**, **RiskyWrite** or **Denied**, and that policy is enforced three times: by OneUptime's AI tools, when OneUptime queues the command, and here, before anything runs. Before anything runs, the agent checks every command itself, whatever the server sent:

1. It is a resource command from an OneUptime AI investigation or fix, carries no credential, and is for this kind of resource.
2. It is for **this** resource — the identity the agent registered with (and its OneUptime id).
3. Its program is one this resource runs, and the agent's copy of the policy reads it exactly as OneUptime did: not Denied, the same arguments, a tier no lower than OneUptime claimed. An investigation only ever reads.
4. A change is refused unless `ONEUPTIME_AI_ALLOW_WRITES=true`, and then unless every target it touches is allowed and not protected.

Programs then run as an argument list (never through a shell), with an environment built for that one command (nothing of the agent's own: not its API key, not its proxy settings), a private per-command directory under `/tmp` as `HOME`, a time limit (at most 2 minutes), and output capped at 50 KB. Secrets in the output (environment values, keys, tokens, passwords) are masked before the output leaves the agent — and again by OneUptime.

## Security model

- **OneUptime never sends credentials.** The agent uses only what its own environment and mounts give it: the Docker socket, a Proxmox API token, vCenter credentials, a Ceph keyring, a database user, the host's namespaces. A job that carries a credential is refused.
- **Least privilege is the hard limit.** Give the agent a read-only identity (a Proxmox auditor token, a read-only vCenter role, a `client.oneuptime-ai` keyring with `allow r` caps, a database user with monitoring grants) and nothing the policy allows can change anything. For a Docker or Podman socket and a host agent there is no finer-grained identity: the policy, the write switch and the write targets are the limit.
- **Read-only by default**, and a typo never turns writes on: only the exact value `true` does.
- **The agent protects itself.** It never changes its own container, the collector beside it, or `ONEUPTIME_AI_PROTECTED_TARGETS`.
- The container runs as UID 1000 by default with a read-only root filesystem (the Proxmox, VMware, Ceph and database services also drop every capability). The Docker, Podman, Docker Swarm and host kinds run as root because the socket and the host's namespaces require it — and that is root on the host: whoever can use a Docker or Podman socket (`:ro` or not) or enter the host's namespaces can do anything there. For those four the command policy, the write switch and the write targets are the limit.

## How it talks to OneUptime

All calls are HTTPS `POST`s to `<ONEUPTIME_URL>/resource-ai-agent-ingest/*`:

| Call | What for |
| --- | --- |
| `register` | Once at start (and again if OneUptime stops recognising the agent). Uses the collector's ingestion key and names the resource type and identity. Returns the agent's own id and key. |
| `heartbeat` | Every 30 seconds. Keeps the agent "connected" and reports what it may do and whether it can reach the resource. |
| `claim-next-job` | Every 3 seconds. One command at a time. |
| `job/<id>/heartbeat`, `job/<id>/result` | While a command runs, and to report its output. |
| `disconnect` | On shutdown, so the next container can take over at once. |

It needs the same OneUptime version as the image, or newer. With an older server it logs `This OneUptime server does not have the resource AI agent API …` once and checks again every 5 minutes.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `ONEUPTIME_URL` | — (required) | Your OneUptime address, e.g. `https://oneuptime.com`. |
| `ONEUPTIME_API_KEY` / `ONEUPTIME_TELEMETRY_INGESTION_KEY` / `ONEUPTIME_SERVICE_TOKEN` | — (one required) | The project's telemetry ingestion key; the first one set is used (the collectors already set one). |
| `ONEUPTIME_AI_AGENT_RESOURCE_TYPE` | — (required) | `docker`, `podman`, `docker-swarm`, `proxmox`, `vmware`, `ceph`, `database` or `host`. |
| The collector's identity variable | — (required) | See [Supported resources](#supported-resources). |
| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | — | Overrides the identity read from the collector's variable. |
| `ONEUPTIME_AI_ALLOW_WRITES` | off | `true` allows changes. Anything else means read-only. |
| `ONEUPTIME_AI_WRITE_TARGETS` | all | Comma-separated globs (`*` matches any run of characters) of the targets changes may touch: container, service, VM, unit names, … Empty means any target except the protected ones. |
| `ONEUPTIME_AI_PROTECTED_TARGETS` | — | Comma-separated globs of targets OneUptime AI must never change, on top of the agent's own container and its collector. |
| `ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS` | `3000` | How often to ask for work (minimum 1000). |
| `ONEUPTIME_AI_AGENT_HEARTBEAT_INTERVAL_MS` | `30000` | How often to heartbeat (minimum 5000). |
| `PORT` | `3877` | Health server port (the Kubernetes AI agent uses 3876). |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

Each resource type also reads the collector's own connection settings (`DOCKER_HOST`, `PVE_HOST`, `VCENTER_ENDPOINT`, `CEPH_CONF`, `DATABASE_ENDPOINT`, …); see [Resource types](#resource-types) and the collector's README.

A missing required value does not crash the agent: it stays up and healthy, logs what is missing, and does nothing else — so the container never restarts in a loop.

## Resource types

Each type below lists the service that runs it, the settings it reads (all from the `.env` it shares with the collector, unless said otherwise), what it runs, and what it will never touch. `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_WRITE_TARGETS` and `ONEUPTIME_AI_PROTECTED_TARGETS` work the same way for every type (see [Configuration](#configuration)); each compose file passes all three.

### Docker host

- **Service:** `oneuptime-docker-ai-agent` in `agents/DockerAgent/docker-compose.yml`. Root (`user: "0:0"`), because the Docker socket is root-owned; read-only root filesystem, a tmpfs for `/tmp`; `/var/run/docker.sock` mounted `:ro` — which limits nothing, since a read-only bind mount still connects, and whoever can use the socket is root on the host.
- **Settings:** `DOCKER_HOST_NAME` (the identity; the compose file defaults it to `docker-host`, like the collector). `DOCKER_HOST`, the engine, `unix:///var/run/docker.sock` when unset: only `unix:///absolute/path` or a plain `tcp://HOST[:PORT]` is accepted, and anything else (`ssh://`, `npipe://`, `fd://`, a user name or password in it) is refused before anything runs; TLS to a remote engine is not supported. `DOCKER_API_VERSION`, passed to the CLI only when set (the compose file leaves it empty, so the CLI negotiates the version with the engine).
- **Runs** the `docker` CLI (the image's `/usr/bin/docker`) with an empty private `DOCKER_CONFIG` for every command, so no context, credential helper or CLI plugin can change where it points. Reads: containers (`docker ps`, `docker container inspect`, `docker top`, `port`, `diff`), bounded logs (`--tail` up to 2000 or `--since`, never `-f`), `docker stats --no-stream`, bounded `docker events`, images, networks, volumes, `info`, `version`, `system df`; environment values in inspect output are masked.
- **Fixes:** `restart`, `start` and `unpause` of one container (SafeWrite); `stop`, `kill -s SIGNAL`, `pause`, `update` of memory, CPU, restart policy and pids limits, or a SafeWrite verb on several containers (RiskyWrite). Never `exec`, `run`, `create`, `cp`, `rm`, any prune, build, pull, push, compose or a global flag (`-H`, `--context`, `--config`).
- **Targets and protection:** targets are container names or ids. It never changes its own container (by id, any prefix of it, or name), the OneUptime Docker, Podman and Swarm collectors, the Swarm inventory poller and the other OneUptime AI agent containers, or anything in `ONEUPTIME_AI_PROTECTED_TARGETS`. While it knows its own container's id but has not yet read its name from the engine, it refuses every change (reads still run); that clears once the engine answers.

### Podman host

- **Service:** `oneuptime-podman-ai-agent` in `agents/PodmanAgent/docker-compose.yml`. Root, read-only root filesystem, with Podman's socket `/run/podman/podman.sock` mounted `:ro` (enable it with `sudo systemctl enable --now podman.socket`) — root on the host, like the Docker socket.
- **Settings:** `PODMAN_HOST_NAME` (the identity; defaults to `podman-host` in the compose file). `DOCKER_HOST`, `unix:///run/podman/podman.sock` when unset, with the same rules as for Docker. `DOCKER_API_VERSION`, only when set (empty in the compose file: Podman 4 speaks API 1.41, so a pin like the collector's 1.44 would break it).
- **Runs** the same `docker` CLI with the same engine policy, reads, fixes and protection as a Docker host, through Podman's Docker-compatible API; the posture reports whether the engine runs rootless.

### Docker Swarm cluster

- **Service:** `oneuptime-docker-swarm-ai-agent` in `agents/DockerSwarmAgent/docker-compose.yml`, which **must run on a manager node** (one per cluster): node, service and task commands are manager-only. Root, read-only root filesystem, `/var/run/docker.sock` mounted `:ro`; on a manager the socket is the whole swarm. When you deploy the file as a stack, pin it to a manager (`node.role == manager`), like the inventory poller.
- **Settings:** `DOCKER_SWARM_CLUSTER_NAME` (the identity; defaults to `docker-swarm`), and `DOCKER_HOST` / `DOCKER_API_VERSION` as for a Docker host.
- **Runs** the `docker` CLI with the swarm policy. Reads: `docker node ls|ps|inspect`, `docker service ls|ps|inspect|logs` (logs bounded like container logs), `docker stack ls|ps|services`, and the manager engine's own reads. On a worker, a node not in a swarm, a locked swarm or a node in an error state the posture reports the cluster as unreachable, with the reason; on a worker, swarm commands fail with the advice to run the agent on a manager.
- **Fixes:** `docker service update --force`, `docker service rollback` and `docker service scale SERVICE=N` (N ≥ 1) of one service (SafeWrite); a scale to 0 or of several services, `docker service update` with `--image`, `--replicas`, CPU and memory limits or reservations or the update policy, and `docker node update --availability active` (RiskyWrite); `docker node update --availability drain|pause` always needs a person. Never service create/rm, stack deploy/rm, secrets, configs, node rm/promote/demote/labels, other service update flags, or a container-level change.
- **Targets and protection:** targets are service names (`web`, not `web=3`) and node names. It protects what a Docker host agent protects, plus its own swarm service and — when it runs in a stack — the `<stack>_<name>` services of the OneUptime agents, and `ONEUPTIME_AI_PROTECTED_TARGETS`.

### Proxmox cluster

- **Service:** `oneuptime-proxmox-ai-agent` in `agents/ProxmoxAgent/docker-compose.yml`. UID 1000, no capabilities, `no-new-privileges`, read-only root filesystem.
- **Settings:** `PROXMOX_CLUSTER_NAME` (the identity). `PVE_HOST` (any node; not `localhost`, which inside the container is the container) and `PVE_PORT` (8006 unless `PVE_HOST` or `PVE_PORT` names another port). The API token: `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET` when either is set (a token of the agent's own, which fixes need; half a pair is refused), else the collector's `PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET` (its PVEAuditor token: read-only). TLS: `PVE_VERIFY_SSL` set to anything but `false`, `0`, `no` or `off` verifies the certificate (a typo verifies); unset, the certificate is verified exactly when `PVE_CA_FILE` names the cluster's CA (`/etc/pve/pve-root-ca.pem`, mounted into the container). The compose file passes `PVE_VERIFY_SSL=false` unless the `.env` sets it, so there `PVE_CA_FILE` alone does not turn verification on.
- **Runs** no binary: a `pvesh get|ls|create PATH [--name value]...` command is parsed by the policy (the same analysis that tiered it) into exactly one call to the Proxmox VE API — a read is a `GET`, a write a `POST` — at `https://PVE_HOST:PVE_PORT/api2/json`, over its own connection, never through the proxy and never following a redirect. The answer's `data` member is printed (json-pretty by default, `--output-format` to change it) and redacted; a write that starts a task is followed until the task stops, within the command's time limit.
- **Fixes:** start, resume or reboot one guest (SafeWrite); shut down, stop, suspend or reset one guest, and start/restart/reload of a listed node service (RiskyWrite); migrating a guest and touching `corosync` or `pve-cluster` always need a person. Never `pvesh set`, `pvesh delete`, `/access`, consoles, guest-agent exec, snapshots, node reboot or `stopall`.
- **Targets and protection:** targets are the VMID (`101`) and `<node>/<service>` (`pve1/pveproxy`); an allowlist entry spells the path out per guest. It protects no guest of its own accord: if the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`. The token's Proxmox permissions are the hard limit.

### VMware vCenter

- **Service:** `oneuptime-vmware-ai-agent` in `agents/VMwareAgent/docker-compose.yml`. UID 1000, no capabilities, `no-new-privileges`, read-only root filesystem.
- **Settings:** `VMWARE_VCENTER_NAME` (the identity). `VCENTER_ENDPOINT` (https only — `http://` is refused, a bare host gets `https://`, and a user name or password in it is dropped with a warning). The login: `ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD` when set (a user whose role may power VMs on, off and reset them, for fixes; half a pair is refused), else the collector's read-only `VCENTER_USERNAME` / `VCENTER_PASSWORD`. TLS: `VCENTER_INSECURE_SKIP_VERIFY=true` (exactly `true`) skips verification; `VCENTER_CA_FILE` names a CA to verify against (the VMCA root, mounted into the container; the agent refuses to run while the file is missing). `GOVC_DATACENTER`, the datacenter commands use when they name none (vCenters with several datacenters).
- **Runs** `govc` (the image's `/usr/bin/govc`) with a closed environment built per command: `GOVC_URL` (`https://HOST[:PORT]/sdk`), `GOVC_USERNAME` / `GOVC_PASSWORD`, `GOVC_INSECURE`, `GOVC_TLS_CA_CERTS`, `GOVC_DATACENTER`, no persisted session and a private, empty `HOME` / `GOVMOMI_HOME`; nothing else of the agent's environment (not a stray `GOVC_URL`, not its proxy settings). Credentials travel in the environment only, never on the command line. The posture reports vCenter's version from `govc about -json` (the Alpine govc package reports its own version as 0.0.0).
- **Fixes:** `vm.power -on` and `-r` of one VM (SafeWrite); `-s`, `-off`, `-reset`, `-suspend`, several VMs, and `host.maintenance.exit` (RiskyWrite); `vm.migrate` and `host.maintenance.enter` always need a person.
- **Targets and protection:** targets are VM and host names or inventory paths; a protected name also covers every inventory path that ends in it (`vcsa` covers `/DC/vm/infra/vcsa`), and globs match case-insensitively. It never changes the vCenter appliance itself (the VM named after the host in `VCENTER_ENDPOINT`, and its short name), or `ONEUPTIME_AI_PROTECTED_TARGETS`. The vCenter role is the hard limit.

### Ceph cluster

- **Service:** `oneuptime-ceph-ai-agent` in `agents/CephAgent/docker-compose.yml`. UID 1000, no capabilities, `no-new-privileges`, read-only root filesystem, the `ceph/` folder next to the compose file mounted read-only at `/etc/ceph`; Docker's default network (a commented-out `network_mode: host` is there for monitors only the host itself reaches).
- **Settings:** `CEPH_CLUSTER_NAME` (the identity). `CEPH_CLIENT_ID`, the client it connects as, without `client.` (`oneuptime-ai` by default; a leading `client.` is dropped with a warning). `CEPH_CONF` (`/etc/ceph/ceph.conf` by default) and `CEPH_KEYRING` (`/etc/ceph/ceph.client.<CEPH_CLIENT_ID>.keyring` by default): single absolute paths to readable files. The compose file sets only `CEPH_CLIENT_ID`, so the defaults read the mounted `ceph/` folder — put the cluster's minimal `ceph.conf` and that client's keyring there, owned by UID 1000 with mode 600, and never the admin keyring.
- **Runs** the `ceph` CLI (Alpine's `ceph19-common`) as `ceph --conf CEPH_CONF --keyring CEPH_KEYRING --id CEPH_CLIENT_ID --connect-timeout N <args>` (N is half the command's time limit, 1 to 10 seconds), with only `PATH` and a private `HOME` in its environment (never `CEPH_ARGS`). A command may not choose another cluster, client, keyring or file: any option the policy does not know is refused. The posture runs `ceph versions` and `ceph health`.
- **Fixes:** `osd in`, `osd unset FLAG`, `crash archive`, `orch daemon restart`, `pg scrub|deep-scrub` (SafeWrite); `osd out|down`, `osd set FLAG`, `osd reweight`, `pg repair`, `mgr fail`, `orch daemon stop|start`, `orch restart`, `crash archive-all`, `balancer on|off` (RiskyWrite); `osd set pause` and `osd pool set POOL size|min_size` always need a person.
- **Targets and protection:** targets are `osd.N`, pools, PG ids, daemon and service names, `crash/ID` and `cluster` (for cluster-wide flags such as `noout`, so an allowlist of `osd.*` alone refuses `osd unset noout`). It protects nothing of its own accord; `ONEUPTIME_AI_PROTECTED_TARGETS` (e.g. `osd.3`) is the whole list. The keyring's caps are the hard limit: `mon 'allow r' mgr 'allow r' osd 'allow r'` keeps it read-only.

### Database server

- **Service:** `oneuptime-database-ai-agent` in `agents/DatabaseAgent/docker-compose.yml` (no fixed container name: one install per database). UID 1000, no capabilities, `no-new-privileges`, read-only root filesystem, the same way to the database as the collector (`host.docker.internal`, or `network_mode: host` when you set it there too).
- **Settings:** the identity the collector reports: `DATABASE_SERVER_ID`, or `DATABASE_SYSTEM` + `DATABASE_SERVER_ADDRESS` + `DATABASE_SERVER_PORT`. The connection: `DATABASE_ENDPOINT` (or `DATABASE_ENDPOINT_HOST` / `DATABASE_ENDPOINT_PORT` when it is empty) — never the identity address. The login: `ONEUPTIME_AI_DATABASE_USERNAME` / `ONEUPTIME_AI_DATABASE_PASSWORD` when either is set (a login of the agent's own, read exactly as written; fixes need one), else the collector's `DATABASE_USERNAME` / `DATABASE_PASSWORD` (with the collector's `$$` halved back to `$`). TLS: `DATABASE_TLS_INSECURE` (`true`, the default, connects without TLS), `DATABASE_TLS_INSECURE_SKIP_VERIFY`, and `ONEUPTIME_AI_DATABASE_CA_FILE` (a CA bundle to verify the server against, mounted into the container). `ONEUPTIME_AI_DATABASE_NAME`: PostgreSQL's database to connect to (`postgres` by default) or MongoDB's authentication database (`admin` by default).
- **Engines:** PostgreSQL, MySQL (MariaDB, Percona Server), Redis (Valkey, KeyDB, Dragonfly) and MongoDB, through the engine's own Node driver (`pg`, `mysql2`, `ioredis`, `mongodb`). For any other `DATABASE_SYSTEM` (SQL Server, Oracle, Elasticsearch / OpenSearch, Memcached) it runs nothing and says so.
- **Runs** `db` — not a program, but one operation from a fixed catalog (`db sessions`, `db long-queries`, `db locks`, `db blocking`, `db replication`, `db connections`, sizes, `db top-statements`, `db settings`, and engine reports) — in a read-only session with a statement timeout. Free SQL never runs. Credential settings are never listed, and query text comes back with every literal replaced by `?`.
- **Fixes:** `db cancel-query ID` (SafeWrite) and `db terminate-session ID` (RiskyWrite), one session each (target `session:ID`), never the agent's own session. The login's grants are the hard limit (`pg_signal_backend` on PostgreSQL, `CONNECTION_ADMIN` on MySQL 8, `+client|kill` for a Redis ACL user, `killop` on MongoDB).

### Host

- **Service:** `oneuptime-host-ai-agent` in `agents/HostAIAgent/docker-compose.yml`, with its own `install.sh` and systemd unit. It needs all three of `privileged: true`, `pid: host` and root (`user: "0:0"`): `pid: host` so pid 1 is the host's init, `privileged` so the kernel lets it enter that init's namespaces. It uses the host's network (`network_mode: host`, so the health server listens on the host's port 3877; `PORT` moves it), a read-only root filesystem, and `TINI_SUBREAPER=1` (tini is not pid 1 under `pid: host`). That is root on the host.
- **Settings:** `HOST_NAME`, the `host.name` your OpenTelemetry collector reports. Without it the agent uses the host's own hostname (`hostname`, else `uname -n`, read on the host), which is what the collector reports unless you set `host.name` yourself; the two must match. OneUptime creates the Host when none has that name yet.
- **Runs** the host's own tools in its namespaces: every command is `nsenter --target 1 --mount --uts --ipc --net --pid -- PROGRAM ARGS`, with a closed environment (a standard `PATH`, `HOME=/nonexistent`, `cat` as every pager, no colours) and `--no-pager` put first for `systemctl` and `journalctl`. Nothing runs unless the agent is root, can open `/proc/1/ns/mnt`, and pid 1 is in another mount namespace than the agent — without `pid: host` it refuses rather than run the container's own tools. The programs are `systemctl`, `journalctl`, `df`, `free`, `uptime`, `ps`, `ss`, `ip`, `dmesg`, `lsblk`, `cat` (of an allowlisted set of `/proc` files and `/etc/os-release`), `top`, `uname`, `hostnamectl`, `timedatectl` and `kill`.
- **Fixes:** restart/start/reload/try-restart/reload-or-restart/reset-failed of one service, socket, timer or path unit (SafeWrite); `systemctl stop`, several units, and journal vacuums (RiskyWrite); changes to protected units (ssh, `systemd-*`, dbus, networking, docker, …), `.target`/`.mount`/`.automount`/`.swap` units and `kill PID` always need a person.
- **Targets and protection:** targets are full unit names (`nginx` is `nginx.service`), `pid:N` and `journal`. It never changes `oneuptime-*` units (its own `oneuptime-host-ai-agent.service` among them), the OpenTelemetry collector (`otelcol-contrib.service`, `otelcol.service`), under Docker the engine it runs in (`docker.service`, `docker.socket`, `containerd.service`), its own process and its ancestors (`pid:N`), or `ONEUPTIME_AI_PROTECTED_TARGETS`.

## Behind a proxy

Set `HTTPS_PROXY` (and `NO_PROXY` for hosts that must be reached directly) in the agent's environment. The agent's calls to OneUptime use the proxy; the value must start with `http://` or `https://`. If it is not valid, the agent logs `The proxy settings are not valid` and keeps running. The programs the agent runs never use the proxy.

## Troubleshooting

Start with the logs (use your resource's service, `oneuptime-<alias>-ai-agent`):

```
docker compose logs --tail=100 oneuptime-docker-ai-agent
```

Then the agent's own status (registered or not, the resource, last heartbeat, last error, whether it can reach the resource, and whether your OneUptime is too old):

```
docker compose exec oneuptime-docker-ai-agent wget -qO- http://127.0.0.1:3877/status
```

| What you see | What to do |
| --- | --- |
| `ONEUPTIME_AI_AGENT_RESOURCE_TYPE is not set` (or another required setting) | Set it in the `.env` the agent shares with the collector, then `docker compose up -d`. |
| `This OneUptime server does not have the resource AI agent API` | Upgrade OneUptime, or run the image version that matches your server. |
| `OneUptime refused the agent's API key` | Use an unpinned telemetry ingestion key of the project. |
| `Waiting for this <resource>'s previous AI agent to go offline` | Normal for a minute after a restart. If it stays, another agent uses the same identity. |
| `… the collector's default …` warning | Give the resource a unique name on the collector and the agent. |
| `The agent cannot reach this <resource> right now` | Check the socket mount, address, credentials or keyring the error names. |
| A fix is `Refused by the <agent>: … this agent is read-only` | Set `ONEUPTIME_AI_ALLOW_WRITES=true` and restart the agent. |
| A fix is refused as `outside the targets` or `protects` | Adjust `ONEUPTIME_AI_WRITE_TARGETS` / `ONEUPTIME_AI_PROTECTED_TARGETS`, or leave that change to a person. |
| `Killed (timeout …): … produced no output at all` | The agent cannot reach the resource — check the network between them. |

Health endpoints on port `3877`: `/status/live`, `/status/ready` (never waits for OneUptime) and `/status`.

## Development

```
npm install
npm test            # compiles, then runs the node:test suites in Tests/
npm run check-common
```

`Common/` holds byte-identical copies of `packages/Common/Types/ResourceAiAgent/`, `packages/Common/Utils/AiRemediation/Resource/` (every file in both, so a new tool module is picked up automatically), `Types/AutoRemediation/AiRemediationCommandPolicyVerdict.ts` and `Types/Runbook/RunnerJobOrigin.ts`. Never edit them here: change the source and run `npm run sync-common`. `packages/Common/Tests/Utils/AiRemediation/ResourceAiAgentPolicyCopyParity.test.ts` fails when a copy is missing or drifts.

The core (`Agent`, `Config`, `IngestClient`, `Registration`, `Heartbeat`, `JobLoop`, `Health`, `Posture`) knows nothing about any one tool. Each resource type's executor lives in `Executors/` and implements `ResourceExecutor`: `prepare()` runs `PrepareGuard` first and then its own checks, `SpawnSandbox` runs CLIs, and `ExecutorFactory` picks the executor from the resource type — every executor class is built with the same `constructor(options: ExecutorOptions)`.

Shutdown fits inside Docker's default 10-second stop timeout: the command in progress gets about 6 seconds to finish and report, then the agent signs off.
