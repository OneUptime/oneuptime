# OneUptime Host AI Agent

Lets OneUptime AI look at a Linux host while it investigates an incident or alert on that host — `systemctl status`, `journalctl -u nginx -n 200`, `df -h`, `free -m`, `ps aux`, `ss -tulpn`, … — and, **only if you allow it**, apply a fix such as restarting a named systemd unit.

It is one container of the `oneuptime/resource-ai-agent` image with `ONEUPTIME_AI_AGENT_RESOURCE_TYPE=host` (see [`agents/ResourceAIAgent`](../ResourceAIAgent/README.md) for how every resource AI agent works). It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`, and it shows up on the host's **AI → AI agent** page in OneUptime.

## Before you start

- A Linux host with Docker (the system engine, not rootless Docker) and the Docker Compose v2 plugin. `systemctl` and `journalctl` need systemd on the host; the other tools work on any distribution.
- The host already reports to OneUptime through an OpenTelemetry collector, so it is listed under **Hosts** (see [Host metrics and logs with the OpenTelemetry Collector](https://oneuptime.com/docs/telemetry/host-otel-collector)). The agent serves that Host; it does not create one.
- The project's telemetry ingestion key (_Project Settings → Telemetry & APM → Ingestion Keys_).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/HostAIAgent/install.sh -o install.sh
sudo bash install.sh
```

It asks for your OneUptime URL, the ingestion key and the host's name (see [HOST_NAME](#host_name-must-match-the-collectors-hostname)), writes `/opt/oneuptime-host-ai-agent/.env` (readable by root only) and `docker-compose.yml`, and starts the container. Every setting can be given in the environment instead of answered:

```bash
sudo ONEUPTIME_URL=https://oneuptime.com ONEUPTIME_TELEMETRY_INGESTION_KEY=... HOST_NAME= bash install.sh
```

Add `--systemd` to run it under the `oneuptime-host-ai-agent` systemd unit (`systemd/oneuptime-host-ai-agent.service`, which runs `docker compose up` in that directory) instead of `docker compose up -d`. Either way it starts again after a reboot. Re-running the installer is the upgrade: it pulls the newest image and recreates the container.

To install by hand, put [`docker-compose.yml`](docker-compose.yml) in a directory next to a `.env` with at least `ONEUPTIME_URL` and `ONEUPTIME_TELEMETRY_INGESTION_KEY`, then run `docker compose up -d`.

## Why it runs privileged, with `pid: host`, as root

The agent does not use the tools inside its own container: every command runs as

```
nsenter --target 1 --mount --uts --ipc --net --pid -- PROGRAM ARGS
```

which enters the namespaces of the host's init (pid 1) — its filesystem, hostname, IPC, network and process tree — and starts the **host's own** `systemctl`, `journalctl`, `df`, `ps`, …. So `systemctl` talks to the host's systemd, `df` sees the host's mounts and `ps` the host's processes. That needs:

| Setting | Why | Without it |
| --- | --- | --- |
| `pid: host` | pid 1 must be the host's init, not the container's own | The agent refuses every command: `pid 1 is this container's own init (tini), not the host's` |
| `privileged: true` | The kernel only lets a privileged process enter another process's namespaces | `this agent may not open pid 1's namespaces (/proc/1/ns/mnt: EACCES)` |
| `user: "0:0"` | Only root can enter them | `this agent runs as uid 1000, and only root can enter the host's namespaces` |

The agent checks all three before running anything, so a misconfigured container runs nothing rather than reporting its own processes as the host's. Rootless Docker and rootless Podman cannot enter the host's namespaces at all.

This is root on the host. What limits the agent is its command policy, not the account: read-only commands unless `ONEUPTIME_AI_ALLOW_WRITES=true`; never a shell, a pipe, `sudo` or a program outside the list below; never the agent itself or what it runs in. The container also uses the host's network (`network_mode: host`), like a native collector; its health server listens on the host's port `3877`.

## `HOST_NAME` must match the collector's `host.name`

The agent registers under a name, and OneUptime gives it the Host with that name — the one your OpenTelemetry collector created from the `host.name` it reports. The two must be the same, or the agent is refused (`OneUptime refused the registration: …`) or serves another Host.

- **Leave `HOST_NAME` empty** (the default) and the agent uses the host's own hostname — the kernel's hostname, read in the host's namespace. The collector's `resourcedetection` processor reports exactly that (`detectors: [system]`, `hostname_sources: [os]`), so the two match out of the box.
- **Set `HOST_NAME`** when the collector reports another name: `host.name` set in `OTEL_RESOURCE_ATTRIBUTES`, a `resource` processor, or `hostname_sources: [dns]` (a fully qualified name). Use exactly the name shown under **Hosts** in OneUptime.

To check: `curl -s http://127.0.0.1:3877/status` shows the name the agent serves, and the host's **AI → AI agent** page shows the agent's `hostname` and whether it matches. The agent also logs a note when `HOST_NAME` and the hostname differ.

## What it may run

Investigations only ever run **read** commands. The same policy tiers every command on OneUptime's side and again on the agent before it runs.

**Read (always allowed):**

- Services: `systemctl status UNIT -n 50`, `systemctl is-active|is-failed|is-enabled UNIT`, `systemctl list-units --failed` (also `--type`, `--state`, `--all`, a pattern), `systemctl list-timers`, `systemctl list-dependencies UNIT`, `systemctl show UNIT -p ActiveState,SubState,Result,NRestarts,…` (only unit-state properties — never `Environment`, never `systemctl cat`)
- Logs: `journalctl -u UNIT -n 200` — every read is bounded by `-n` (at most 2000 lines) or `--since`; also `-p err`, `-k`, `-b`, `--until`, `-g`, `-t`, `-o short-iso|json`; `journalctl --list-boots`, `journalctl --disk-usage`; never `-f`
- Resources: `uptime`, `free -m`, `df -h`, `df -i`, `lsblk -f`, `uname -a`, `hostnamectl`, `timedatectl`, `dmesg -T --level=err,warn`
- Processes: `ps aux --sort=-%cpu`, `ps -eo pid,ppid,user,%cpu,%mem,etime,stat,args --sort=-%mem`, `top -b -n 1`
- Network: `ss -tulpn`, `ss -s`, `ip -br addr`, `ip route`, `ip route get 1.1.1.1`, `ip neigh`
- Kernel counters: `cat` of `/proc/loadavg`, `/proc/meminfo`, `/proc/pressure/*`, `/proc/mdstat`, `/proc/mounts`, `/etc/os-release` and a few more — nothing else

**Fixes (only with `ONEUPTIME_AI_ALLOW_WRITES=true`):**

- **SafeWrite** — `systemctl restart|start|reload|try-restart|reload-or-restart|reset-failed UNIT` of exactly one service, socket, timer or path unit.
- **RiskyWrite** — `systemctl stop UNIT`; the verbs above on several units; `systemctl reset-failed` with no unit; `journalctl --vacuum-size=…|--vacuum-time=…|--vacuum-files=…`.
- **Always a person** (never unattended, whatever the approval mode or allowlist) — any change to ssh, systemd-\*, dbus, polkit, the network stack, getty, docker, containerd, podman, kubelet, the firewall or user managers; start/stop of a `.target`, `.mount`, `.automount` or `.swap` unit; `kill [-TERM|-HUP|-INT|-KILL] PID`.

**Never:** `systemctl enable/disable/mask/edit/cat/daemon-reload/isolate/kill/set-property`, reboot, power-off, suspend or rescue in any form, slices, scopes and devices, `--force`, `--user`, `--host`, `--root`, `journalctl -f`, `dmesg --clear`, `ss -K`, any `ip` change, killing pid 1 or a process group, any other program, any shell.

Targets are compared by their full names: `nginx` is `nginx.service`, a process is `pid:1234`, a journal vacuum is `journal`.

## Allowing fixes

1. In `/opt/oneuptime-host-ai-agent/.env` set `ONEUPTIME_AI_ALLOW_WRITES=true`, and optionally `ONEUPTIME_AI_WRITE_TARGETS` to the units fixes may touch (comma-separated globs such as `nginx.service,app-*`; empty means any unit that is not protected).
2. `cd /opt/oneuptime-host-ai-agent && sudo docker compose up -d`.
3. On the host's **AI → AI agent** page in OneUptime, choose whether each fix needs approval (**Ask for approval**, **Automatic**, **Bypass approval**), and optionally allow specific commands to run without approval. Loosening these needs Project Owner, Project Admin or the Edit Auto Remediation Rule permission.

The agent never changes, whatever the settings: every OneUptime unit (`oneuptime-*`, including its own `oneuptime-host-ai-agent.service`), the OpenTelemetry collector (`otelcol-contrib.service`, `otelcol.service`), the Docker engine it runs in (`docker.service`, `docker.socket`, `containerd.service`), its own process and the processes above it, and anything in `ONEUPTIME_AI_PROTECTED_TARGETS`. The host's **AI → AI agent** page lists them.

## How a command runs

- One program, as an argument list — never through a shell — from the host's standard `PATH`, by name only.
- An environment built for that one command: `PATH`, `LANG`/`LC_ALL=C.UTF-8`, `cat` as the pager (and `--no-pager` for `systemctl` and `journalctl`), no colours, `TERM=dumb`, `HOME=/nonexistent`. Nothing of the agent's own — not its ingestion key, not its proxy settings.
- A time limit (at most 2 minutes). When it runs out, the program and everything it started are killed. A `systemctl restart` killed this way does not cancel the restart: systemd carries on, and the result says to check `systemctl status UNIT`.
- Output is capped at 50 KB, and secrets in it (passwords on `ps` command lines, tokens in log lines, …) are masked before it leaves the host — and again by OneUptime.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `ONEUPTIME_URL` | — (required) | Your OneUptime address, e.g. `https://oneuptime.com`. |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` (or `ONEUPTIME_API_KEY`) | — (required) | The project's telemetry ingestion key. |
| `HOST_NAME` | the hostname | The `host.name` the collector reports for this host. |
| `ONEUPTIME_AI_ALLOW_WRITES` | `false` | `true` allows fixes. Anything else means read-only. |
| `ONEUPTIME_AI_WRITE_TARGETS` | any | Comma-separated globs of the units (or `pid:*`, `journal`) fixes may touch. |
| `ONEUPTIME_AI_PROTECTED_TARGETS` | — | Comma-separated globs OneUptime AI must never change, on top of the built-in ones. |
| `PORT` | `3877` | Health server port (on the host's network). Change the compose healthcheck with it. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

## Podman

The installer uses Docker. With rootful Podman (as root — rootless Podman cannot enter the host's namespaces), run the same container directly:

```bash
sudo podman run -d --name oneuptime-host-ai-agent \
  --privileged --pid=host --network=host --user 0:0 \
  --read-only --tmpfs /tmp --restart unless-stopped \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_KEY \
  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=host \
  -e ONEUPTIME_AI_ALLOW_WRITES=false \
  -e TINI_SUBREAPER=1 \
  docker.io/oneuptime/resource-ai-agent:release
sudo systemctl enable podman-restart.service   # start it again after a reboot
```

Add `-e HOST_NAME=…` when the collector reports another name than the hostname.

## Troubleshooting

```bash
cd /opt/oneuptime-host-ai-agent
sudo docker compose logs --tail=100      # what the agent says
curl -s http://127.0.0.1:3877/status     # registered or not, the Host it serves, the last error
```

| What you see | What to do |
| --- | --- |
| `pid 1 is this container's own init (tini), not the host's` | The container runs without `pid: host`. Use this directory's `docker-compose.yml` and `sudo docker compose up -d --force-recreate`. |
| `this agent runs as uid …` | Run the container as root: `user: "0:0"`. |
| `this agent may not open pid 1's namespaces` / `nsenter could not enter the host's namespaces` | Run it with `privileged: true`, on the system (rootful) Docker or Podman engine. |
| `systemctl is not installed on this host …, so this host does not seem to run systemd` | This host has no systemd: `systemctl` and `journalctl` cannot work here; the other tools still do. |
| `HOST_NAME is not set, and the agent could not read this Host's name itself` | The agent could not reach the host (the log line before it says why), or the host has no hostname. Fix that, or set `HOST_NAME`. |
| `OneUptime refused the registration: …` (no such Host) | No Host of that name in the project: set `HOST_NAME` to the name shown under **Hosts** (the collector's `host.name`). |
| `Waiting for this Host's previous AI agent to go offline` | Normal for a minute after a restart. If it stays, another agent uses the same `HOST_NAME`. |
| A fix is refused: `… this agent is read-only` | Set `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and `sudo docker compose up -d`. |
| A fix is refused: `outside the targets …` / `… which the Host AI agent protects` | Adjust `ONEUPTIME_AI_WRITE_TARGETS` / `ONEUPTIME_AI_PROTECTED_TARGETS`, or leave that change to a person. The built-in protected targets cannot be removed. |
| `Killed (timeout …)` | The host did not answer in time (overloaded, or the program blocked — `df` on a hung network mount, a very large journal). The message says which. |
| Port `3877` already in use | Set `PORT` (and the healthcheck's URL) in `docker-compose.yml`. |

## Uninstall

```bash
sudo systemctl disable --now oneuptime-host-ai-agent 2>/dev/null   # only if installed with --systemd
sudo rm -f /etc/systemd/system/oneuptime-host-ai-agent.service
cd /opt/oneuptime-host-ai-agent && sudo docker compose down
sudo rm -rf /opt/oneuptime-host-ai-agent
```

The host's AI agent page then shows the agent as disconnected; OneUptime AI stops running commands on this host.
