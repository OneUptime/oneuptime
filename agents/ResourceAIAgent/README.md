# OneUptime Resource AI Agent

A small Node.js service that runs next to one piece of your infrastructure and carries out the commands OneUptime AI asks for — to look at it while it investigates an incident or alert, and (only if you allow it) to apply a fix.

One image (`oneuptime/resource-ai-agent`) serves every kind of resource below; `ONEUPTIME_AI_AGENT_RESOURCE_TYPE` says which one this agent serves. It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`, and it shows up on the resource's **AI → AI agent** page in OneUptime. Kubernetes clusters have their own agent (`agents/KubernetesAIAgent`, installed by the Kubernetes agent Helm chart).

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

The agent runs as one more service in the resource's collector `docker-compose.yml` (see `agents/DockerAgent`, `agents/CephAgent`, …), sharing the collector's `.env`, so it already has `ONEUPTIME_URL`, the ingestion key and the resource's name. A minimal service looks like this (the collector's own compose file carries the complete, per-resource version):

```yaml
  ai-agent:
    image: oneuptime/resource-ai-agent:release
    restart: unless-stopped
    env_file: .env
    environment:
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: docker
      ONEUPTIME_AI_ALLOW_WRITES: ${ONEUPTIME_AI_ALLOW_WRITES:-false}
    read_only: true
    tmpfs:
      - /tmp
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
- The container runs as UID 1000 by default with a read-only root filesystem; the Docker, Podman and host kinds run as root because the socket and the host's namespaces require it.

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

**Docker host.** Runs the `docker` CLI against the engine socket (`DOCKER_HOST`, `unix:///var/run/docker.sock` by default), with an empty private `DOCKER_CONFIG` for every command, so no context or credential helper can change where it points. Reads cover containers, images, networks, volumes, logs and stats; fixes are restarting, starting and stopping named containers.

**Podman host.** The same `docker` CLI and policy, against Podman's Docker-compatible socket (`unix:///run/podman/podman.sock` by default).

**Docker Swarm cluster.** The `docker` CLI on a manager node, with the swarm policy: services, tasks and nodes. On a worker node `docker node ls` fails, which the agent reports as the resource being unreachable.

**Proxmox cluster.** No binary: `pvesh` commands are parsed by the policy and sent to the Proxmox VE API (`https://PVE_HOST:8006/api2/json`) with the agent's own API token. The token's Proxmox permissions are the hard limit; an auditor token keeps it read-only.

**VMware vCenter.** Runs `govc` with the agent's own vCenter credentials. The vCenter role is the hard limit.

**Ceph cluster.** Runs the `ceph` CLI with a mounted `ceph.conf` and the keyring of its own client (`client.oneuptime-ai` by default). The keyring's caps are the hard limit.

**Database server.** `db` is not a program: it names a fixed catalog of diagnostics (sessions, locks, long-running queries, replication, sizes, …) run through the database's own driver in a read-only session with a statement timeout. Free SQL never runs. Fixes are cancelling a query or ending a session, never the agent's own.

**Host.** Runs the host's own tools in its namespaces through `nsenter` (the container runs privileged with `pid: host`): `systemctl`, `journalctl`, `df`, `free`, `ps`, `ss`, `ip`, `dmesg`, `cat` of an allowlisted set of `/proc` files, and — as fixes — restarting a named unit or signalling a process. Without `HOST_NAME` the agent uses the host's own hostname, which must match the `host.name` the collector reports.

## Behind a proxy

Set `HTTPS_PROXY` (and `NO_PROXY` for hosts that must be reached directly) in the agent's environment. The agent's calls to OneUptime use the proxy; the value must start with `http://` or `https://`. If it is not valid, the agent logs `The proxy settings are not valid` and keeps running. The programs the agent runs never use the proxy.

## Troubleshooting

Start with the logs (use the name of the AI agent service in your compose file):

```
docker compose logs --tail=100 ai-agent
```

Then the agent's own status (registered or not, the resource, last heartbeat, last error, whether it can reach the resource, and whether your OneUptime is too old):

```
docker compose exec ai-agent wget -qO- http://127.0.0.1:3877/status
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
