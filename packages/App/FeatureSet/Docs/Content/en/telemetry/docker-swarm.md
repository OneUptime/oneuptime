# OneUptime Docker Swarm Agent

## Overview

The OneUptime Docker Swarm Agent monitors a Docker Swarm cluster — nodes, services, tasks, stacks, overlay networks, secrets, configs, volumes — plus per-container metrics and logs. It is three cooperating containers run with Docker Compose on a swarm **manager** node:

1. **Collector** — a pre-configured OpenTelemetry Collector that scrapes `docker_stats` for container metrics, tails container logs, and tails the inventory snapshot file, stamping everything with your cluster identity (`docker.swarm.cluster.name`) before shipping over OTLP.
2. **Inventory poller** — a small `curl` + `jq` sidecar that every 5 minutes walks the Swarm manager API (`/nodes`, `/services`, `/tasks`, `/networks`, `/secrets`, `/configs`, `/volumes`) and derives stacks from the `com.docker.stack.namespace` service label, writing one JSON line per object for the collector to forward.
3. **AI agent** — `oneuptime-docker-swarm-ai-agent`, which runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this cluster: read-only unless you allow fixes (see [AI agent](#ai-agent)). `install.sh --no-ai-agent` leaves it out.

The cluster auto-registers in OneUptime on first telemetry, keyed by the cluster name you configure.

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, **on a swarm manager node** (the inventory poller and the AI agent call manager-only API endpoints).
- A **OneUptime Telemetry Ingestion Key** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_ and copy the value.

### Where to run the agent

Run it on a **manager node**. For full per-node container metrics, run the collector on every node (all sharing the same `DOCKER_SWARM_CLUSTER_NAME`); the inventory poller and the AI agent only need to run on one manager. `install.sh` leaves the AI agent out on a node that is not a manager (and removes one it installed there before), and an AI agent started on a worker anyway never registers for the cluster — it waits until its node is a manager — so it cannot keep the manager's AI agent out. When deploying as a swarm stack rather than via Compose, constrain the inventory poller and the AI agent to managers with `node.role == manager`.

## Quick Start — install script

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DockerSwarmAgent/install.sh -o install.sh
sh install.sh
```

The script prompts for your OneUptime URL, telemetry ingestion key, and cluster name, installs to `/opt/oneuptime-docker-swarm-agent`, and starts all three containers (`--no-ai-agent` leaves the AI agent out).

## Quick Start — Docker Compose

Download `docker-compose.yml`, `otel-collector-config.yaml`, and `inventory-snapshot.sh` from the [`DockerSwarmAgent`](https://github.com/OneUptime/oneuptime/tree/master/agents/DockerSwarmAgent) directory onto a manager node, then create a `.env` file next to them:

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_SERVICE_TOKEN=your-telemetry-ingestion-key
DOCKER_SWARM_CLUSTER_NAME=my-swarm
```

Then start the agent:

```bash
chmod +x inventory-snapshot.sh
docker compose up -d
```

The cluster appears in OneUptime within a few minutes, and the resource list pages (Nodes, Services, Tasks, Stacks, Networks, Secrets, Configs, Volumes) populate after the first inventory snapshot (≤ 5 minutes).

## Upgrading the agent

Run the install script again on the manager node and answer with the same URL, key and cluster name. It downloads the latest files, pulls the images and restarts the agent:

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DockerSwarmAgent/install.sh -o install.sh
sh install.sh
```

With Docker Compose, download the three files again (then re-apply any change you made to `docker-compose.yml`) and run `docker compose pull` and `docker compose up -d` in the agent's folder. The collector version is pinned in the files, so pulling alone does not move the agent forward.

The agent reports the collector version it runs. When that is older than the version this OneUptime release pins, a warning sign appears beside the agent's version on the cluster's **Overview**. Select it to see these commands.

## What gets collected

| Signal                                                                       | Source                               | Powers                                     |
| ---------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| Node / Service / Task / Stack / Network / Secret / Config / Volume inventory | inventory poller → Swarm manager API | the cluster's resource list + detail pages |
| Cluster counts (nodes ready, tasks running, services, stacks, …)             | derived from the same snapshot       | the overview cards + sidebar badges        |
| Container CPU / memory / pids / uptime                                       | `docker_stats` receiver              | the Metrics tab                            |
| Container stdout/stderr logs                                                 | `filelog` receiver                   | the Logs tab                               |

## Environment variables

| Variable                            | Required | Default                 | Notes                                                                                                                                       |
| ----------------------------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                     | yes      | `https://oneuptime.com` | Your OneUptime instance                                                                                                                     |
| `ONEUPTIME_SERVICE_TOKEN`           | yes      | —                       | Telemetry ingestion key                                                                                                                     |
| `DOCKER_SWARM_CLUSTER_NAME`         | yes      | `docker-swarm`          | The cluster join key (matches the cluster's Name in OneUptime)                                                                              |
| `DOCKER_INVENTORY_INTERVAL_SECONDS` | no       | `300`                   | How often the poller refreshes the inventory snapshot                                                                                       |
| `DOCKER_API_VERSION`                | no       | `1.44`                  | Docker Engine API version the collector and the inventory poller speak (see Troubleshooting); the AI agent negotiates it unless you set one |

## How it differs from the Docker Host agent

The Docker Host agent models a single host and stamps `host.name` + `container.runtime=docker`. The Swarm agent deliberately stamps **only** `docker.swarm.cluster.name` so OneUptime attributes the telemetry to the swarm cluster rather than auto-registering each node as a standalone Host or Docker Host.

## Troubleshooting

- **No inventory appears** — confirm the poller runs on a manager (`docker node ls` must succeed there). Check `docker compose logs oneuptime-docker-swarm-inventory` for `failed to emit ...` lines.
- **Cluster never appears** — check the collector logs and that `ONEUPTIME_SERVICE_TOKEN` / `ONEUPTIME_URL` are correct.
- **Status flaps to Disconnected** — the cluster is marked disconnected after 15 minutes without telemetry; ensure the collector container stays running.
- **Collector exits with "client version is too new"** — the daemon's maximum API version is below the default `1.44` (Docker Engine 20.10 stops at `1.41`), so the `docker_stats` receiver fails to start and the container restart-loops. Check the maximum with `docker version --format '{{ .Server.APIVersion }}'`, set `DOCKER_API_VERSION` to that value in `.env`, and run `docker compose up -d` on every node running the agent. Alternatively set `DOCKER_API_VERSION=` (empty) to have the collector negotiate the version with the daemon instead of pinning one.

## AI agent

The swarm's `docker-compose.yml` (and `install.sh`) also runs the **Docker Swarm AI agent**: a third container, `oneuptime-docker-swarm-ai-agent` (image `oneuptime/resource-ai-agent:release`), that runs the read-only `docker` commands OneUptime AI asks for while it investigates an incident or alert on this cluster — `docker node ls`, `docker service ps web --no-trunc`, `docker service logs --tail 200 web` — and, only if you allow it, applies fixes such as a rolling restart of a named service. It reads the same `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` and `DOCKER_SWARM_CLUSTER_NAME` as the collector, so it serves exactly this cluster, and it shows up on the cluster's **AI → AI agent** page in OneUptime.

- **AI investigations are on by default.** Once the agent connects, OneUptime AI investigates incidents and alerts on this cluster with it, and the cluster's **Overview** shows the agent's status. To stop, turn investigation off under **What AI may do** on the AI agent page, or leave the agent out.
- Like the inventory poller it **must run on a manager node**: node, service and task commands are manager-only. On a worker it runs nothing and does not register for the cluster until the node is a manager (its `/status` says why). Run one per cluster.
- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and run `docker compose up -d` (or run `install.sh` with it; the installer writes `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_WRITE_TARGETS` and `ONEUPTIME_AI_PROTECTED_TARGETS` from its environment into `.env`, and a re-run keeps a target list `.env` already has unless you pass that variable, even empty); `ONEUPTIME_AI_WRITE_TARGETS` (service and node name globs, for example `web_*,api_*`) limits what a fix may touch. Then choose on the AI agent page whether each fix needs a person's approval. Draining a node always needs one.
- It runs as root with the Docker socket mounted, because the socket is root-owned — and on a manager, whoever can use the socket controls the whole swarm, `:ro` or not. The agent's command policy is the limit: it never creates or removes services or stacks, never touches secrets or configs, and never changes itself, the collector, the inventory poller or anything in `ONEUPTIME_AI_PROTECTED_TARGETS` (service and node name globs).
- `install.sh --no-ai-agent` leaves it out, or delete the `oneuptime-docker-swarm-ai-agent` service from `docker-compose.yml`.

What it may run, how fixes work and how to troubleshoot it: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-swarm-clusters).
