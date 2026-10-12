# Custom Probes

A custom probe is a small agent you run inside your own network. It checks the monitors you add it to, such as internal websites, APIs and servers behind your firewall, and sends the results to OneUptime. It only connects out, over HTTPS, so nothing in your network has to accept connections from the internet.

:::cards
- [How it works](#how-it-works): What the probe does, and how OneUptime knows it is running.
- [Install a probe](#install-a-probe): Create it in OneUptime, run it with Docker, Docker Compose or Kubernetes, and add it to monitors.
- [Environment variables](#environment-variables): Every setting the probe reads, with its default.
- [Diagnosing a Disconnected Probe](#diagnosing-a-disconnected-probe): Find where the probe's requests to OneUptime stop.
:::

## How it works

```mermaid title="What a custom probe does"
sequenceDiagram
    participant P as Custom probe
    participant O as OneUptime
    P->>O: I am running<br/>(every minute)
    P->>O: Which of my monitors<br/>are due?
    O-->>P: The monitors to check
    Note over P: Checks each one<br/>on your network
    P->>O: Send the results
    Note over O: Updates status, opens<br/>incidents or alerts
```

- **The probe connects out.** Every request goes from the probe to `ONEUPTIME_URL` over HTTPS. Nothing has to reach the probe from outside your network.
- **It checks only its own monitors.** The probe asks OneUptime for the monitors it is added to, checks each one when it is due, and sends back the result. OneUptime decides from the results whether a monitor's status changes.
- **OneUptime watches that it runs.** Every request from the probe counts as a sign of life, and the probe sends one at least every minute. After about three minutes without one, the probe shows **Disconnected**, and its owners are told. A probe with no owners tells the project's owners.

## Before you begin

- **The Growth plan, on OneUptime Cloud.** Creating a probe needs it. A self-hosted installation has no plan limits.
- **Permission to create probes.** Project owners, admins and members have it, and so does anyone whose role lets them create probes.
- **A machine in the network you want to monitor.** It needs Docker, Docker Compose or Kubernetes, a route to the services the probe will check, and outbound HTTPS to `ONEUPTIME_URL`.

## Install a probe

:::steps
### Create the probe

Open **Monitors → Settings → Probes** and click **Create Probe**. Give it a **Name** and a **Description**: both are required. **More fields** holds the **Probe Logo**, **Enable monitoring automatically on new monitors**, which picks this probe for every new monitor you create, and **Labels**.

### Copy its ID and key

The probe needs its ID and key to connect. To copy them, open the probe's menu in the **Custom Probes** table and pick **Show ID and Key**. Everyone who can see the table can copy a probe's ID; its key is shown only to project owners and admins, who see **Show ID and Key** where the others see **Show ID**.

Project owners and admins can also click the probe: the **Set up your Custom Probe** card on its page shows the Docker command with its ID and key already filled in.

### Run the probe

Run it on the machine you picked, with the probe's ID and key. If you host OneUptime yourself, set `ONEUPTIME_URL` to your installation's URL instead of `https://oneuptime.com`.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

Then start it with `docker compose up -d`.
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

Then apply it with `kubectl apply -f oneuptime-probe.yaml`.
:::

Host networking (`--network host`, `network_mode: host`) lets the probe use the host's own network, IPv6 included. See [Monitoring IPv6 destinations](#monitoring-ipv6-destinations) before you run it without host networking.

### Check that it connects

Within a minute or two, the probe's **Status** in the **Custom Probes** table reads **Connected**. If it still reads **Disconnected**, the probe's log says why: see [Diagnosing a Disconnected Probe](#diagnosing-a-disconnected-probe).

### Check a monitor from the probe

A probe checks only the monitors it is added to. A new monitor picks its probes on the **Probes & Interval** step of **Create Monitor**. For a monitor that already exists, open it and go to **Configuration → Probes & Interval**. The page has three cards:

- **Monitoring Interval**: how often each of the monitor's probes checks it. Pick an interval and it is saved at once. Synthetic, Custom Code and SSL Certificate monitors are offered every 5 minutes or longer; one already on a shorter interval, or on a schedule set through the API, keeps it and shows it in the list.
- **Probes**: click **Add Probe** and pick your custom probe. To stop a probe checking this monitor, turn it off with **Edit** in the row's menu, or delete the row.
- **Probe Agreement**: how many of the monitor's probes must see the same result before its status changes, typed into the sentence "Change this monitor's status when ... probes agree". Leave the box empty for all of them. Only probes that are turned on and connected take part, so a number higher than that also means all of them. The number is saved when you leave the box or press **Enter**.

Monitors that probes do not check (Manual, Incoming Request, Incoming Email, Server, Network Device and the telemetry monitors) have no Probes & Interval page.
:::

> [!TIP]
> A probe that should check private addresses, such as `http://10.0.0.5/health`, needs `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`. Probes refuse private addresses until you allow them: see [Private Network Access](/docs/self-hosted/private-network-access).

## Connecting through a proxy

If the probe has to go through a proxy to reach OneUptime or the sites it checks, give it the proxy's address:

| Variable | What it does |
| --- | --- |
| `HTTPS_PROXY_URL` | The proxy for HTTPS addresses, which includes OneUptime itself and most sites. |
| `HTTP_PROXY_URL` | The proxy for plain HTTP addresses. |
| `NO_PROXY` | Hosts the probe reaches directly, separated by commas. |

Write a proxy's address as `http://proxy.example.com:8080`, or `http://username:password@proxy.example.com:8080` when it asks for a user name and password. Most proxies serve both kinds of address, so set both variables to the same URL.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```
:::

What goes through the proxy:

- **The probe's own requests to OneUptime.**
- **The HTTP checks of monitors**: Website, API, External Status Page, Custom Code, SSL Certificate, Synthetic and Domain monitors. SSL Certificate and Synthetic monitors use `HTTPS_PROXY_URL`, or `HTTP_PROXY_URL` when only that one is set.
- **Not the other checks.** Ping, Port, DNS, SNMP and the other checks that are not HTTP connect directly.

A `NO_PROXY` entry is a host name (`api.internal`), a domain with a leading dot or `*.` for every name under it (`.internal.example.com`), either of them with a `:port`, or `*` for everything. IP ranges are not read: list each address. The lowercase names `http_proxy`, `https_proxy` and `no_proxy`, and `HTTP_PROXY` and `HTTPS_PROXY`, work too.

## Monitoring IPv6 destinations

A probe can monitor an IPv6 destination only if the probe's own network has IPv6:

- **Docker with `--network host`, or Compose with `network_mode: host`** (the setups above): the probe shares the host's network, so it has IPv6 exactly when the host does.
- **A Docker bridge network** (what you get without host networking): no IPv6, unless IPv6 is turned on for that network (see below).
- **Kubernetes**: pods have IPv6 only on a dual-stack or IPv6-only cluster.

To check, ping a public IPv6 address from inside the probe:

:::tabs
@tab Docker
```bash
docker exec oneuptime-probe ping -6 -c 1 2001:4860:4860::8888
```
@tab Kubernetes
```bash
kubectl exec deploy/oneuptime-probe -- ping -6 -c 1 2001:4860:4860::8888
```
:::

`1 received` means the probe can reach IPv6 destinations. If the probe has no usable IPv6, `ping` fails at once and the error says why:

| Error | What it means |
| --- | --- |
| `Network is unreachable` | The probe's network has no IPv6 route: a Docker bridge network without IPv6, an IPv4-only Kubernetes cluster, or a host with no IPv6 connectivity. |
| `Cannot assign requested address` | IPv6 is turned off in the probe's network namespace. Check `net.ipv6.conf.all.disable_ipv6` and `net.ipv6.conf.lo.disable_ipv6`: `cat /proc/sys/net/ipv6/conf/all/disable_ipv6` inside the probe prints `1` when it is off. With host networking these are the host's settings. |
| `Address family not supported by protocol` | The kernel was booted with `ipv6.disable=1`, so the machine has no IPv6 at all. Remove it from the kernel command line and reboot, or run the probe on another machine. |

In each case nothing was sent to the destination, so the probe cannot tell whether it is up. The check still fails, but a Ping monitor's failure reason names the probe instead of saying the destination did not reply:

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

The network path captured with the failure says `Traceroute could not run: this probe cannot send IPv6 traffic (...)`. Fix the probe's network, or move the monitor to a probe that has IPv6.

### IPv6 without host networking

If you cannot use host networking, attach the probe to a Docker network with IPv6 turned on. The host itself still needs IPv6.

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 and later picks an IPv6 subnet for the network and masquerades the probe's outbound IPv6 behind the host's address. Older versions need an explicit IPv6 subnet (for example `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`) and `"ip6tables": true` with `"experimental": true` in `/etc/docker/daemon.json`. With Docker Compose, remove `network_mode: host` and set `enable_ipv6: true` on the probe's network.

## NetBIOS name lookups in discovery scans

A [network discovery scan](/docs/monitor/network-device-monitor) with **Look up Windows names (NetBIOS)** turned on sends NetBIOS name queries (NBSTAT) from the probe, to every host that has no SNMP system name. For scans that use it, allow this traffic:

- **Which hosts are queried:** discovered hosts that have neither an SNMP system name nor a reverse-DNS (PTR) name, and only at private addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) or carrier-grade NAT addresses (`100.64.0.0/10`). Public addresses are never queried, and a host whose reverse-DNS lookup from the probe returned a name is never sent a query. A host whose lookup failed, timed out, or was skipped when the lookup time budget ran out can still be queried, even if it has a PTR record.
- **Outbound:** UDP from one ephemeral (random, high-numbered) source port on the probe to UDP port 137 on those hosts. The proxy settings above do not apply to it.
- **Inbound:** the replies, from UDP port 137 on each host back to that ephemeral port. A stateful firewall allows them automatically. Without them, the hosts keep being named by their IP address.

The lookup needs no extra container capability and works from Kubernetes pod networking. It queries at most 2,000 hosts per scan (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` raises that to 4,000), sends each unanswered host one more query, paces queries at about 100 per second, and stops at a time limit sized to that work - about 54 seconds for a full 2,000-host lookup, and never more than two minutes. Global probes never send NetBIOS queries, whatever the scan says, so run scans that need NetBIOS names from a custom probe. The option is on for new scans. NBSTAT queries to many hosts can trip intrusion detection rules, so turn it off on scans of networks where that matters, or tell your security team first.

## Environment variables

The probe reads its settings from its environment when it starts: change one, then restart the probe. A number the probe cannot read, or one outside the range a variable allows, is ignored and the default is used; the packet capture limits are kept within their range instead.

### Required

| Variable | What it is |
| --- | --- |
| `PROBE_KEY` | The probe's key, from **Show ID and Key**. The probe stops at startup without it. |
| `PROBE_ID` | The probe's ID, from **Show ID and Key**. The probe stops at startup without it. |
| `ONEUPTIME_URL` | Where OneUptime is: `https://oneuptime.com`, or your own installation's URL. The probe stops at startup without it. |

### Checking monitors

| Variable | Default | What it does |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | How many batches of monitors the probe checks at once. |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | How many monitors are in a batch. |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | Retries after the first attempt of a failed monitor check, used when a step does not set its own retry count, so up to 4 attempts. `0` turns retries off. |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | Deadline for checking one monitor, after which the check is abandoned and retried next cycle. The default grows when the synthetic script timeout is raised, so a script is never cut short. |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Timeout for synthetic monitor scripts, in milliseconds. |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | Set to `true` to run Chromium, in synthetic monitors, inside its own sandbox. Turn it on only when the probe's container runs with a seccomp profile that allows the sandbox, such as Playwright's: without one, Chromium cannot start. While it is off, the probe logs a warning at startup. |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Timeout for custom code monitor scripts, in milliseconds. |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | Set to `true` to let Website, API, External Status Page and Custom Code monitors on this probe reach private addresses. See [Private Network Access](/docs/self-hosted/private-network-access). |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | How many network devices the probe polls at once. Raise it for a probe that polls many devices. |

The limits a synthetic monitor runs within (how many run at once, their memory and their disk) are on the [Synthetic Monitor](/docs/monitor/synthetic-monitor) page.

### Talking to OneUptime

| Variable | Default | What it does |
| --- | --- | --- |
| `HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY` | none | The proxy settings: see [Connecting through a proxy](#connecting-through-a-proxy). |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | Deadline for each request the probe sends to OneUptime. |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | Log a warning for requests to OneUptime slower than this. |

### Network discovery

| Variable | Default | What it does |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90 minutes) | Deadline for one network discovery sweep, after which it is abandoned and the scan is reported failed. |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | How often a running discovery sweep uploads the hosts it has found so far, so a long scan shows progress and its devices can be imported before it finishes. Minimum `5000`. |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | Fixed number of addresses a discovery sweep probes at once. Leave unset (or `0`) to size it from the scan's target, which is what you want unless the probe container is unusually small or unusually large. |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | Time limit, in milliseconds, for looking up reverse DNS (PTR) names for the hosts a sweep found. See below. |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | How many hosts one scan's NetBIOS lookup may ask. See below. |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | Maximum independent discovery scans running on this probe at once, from 1 to 16. See below. |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`: leave it unset (or `0`) to size the limit from the number of hosts: 60 seconds for up to about 860 hosts, growing to at most 10 minutes. You can set it from 1000 to 1200000. Hosts the lookups do not reach in time get no reverse DNS name (they are listed by IP address unless SNMP or NetBIOS names them), and the scan's status message says how many were missed. A lookup that times out or fails is retried once while the limit lasts, asking each of the probe's nameservers in turn. Raise it for a large network behind a slow DNS server.

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`: for scans with NetBIOS names turned on, the lookup asks every host with no SNMP system name, hosts with no reverse-DNS name first. Leave it unset (or `0`) to keep the built-in cap of 2,000; you can set it from 1 to 4000. Hosts over the cap are not asked, and the scan's status message says how many. Raising it lengthens the lookup as well (the time limit is sized from it: about 104 seconds at 4,000 hosts) and puts more NBSTAT datagrams on the network, which intrusion detection rules watch for.

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS`: the probe checks for another pending scan every minute while capacity is available, so a long scan does not block all other scans. When all slots are occupied, additional scans remain pending until a slot is free. Each scan has its own host concurrency, so resource usage grows with both settings; lower either limit for small containers. Set this to 1 to run scans sequentially.

Upgrade the OneUptime server before upgrading custom probes to use concurrent discovery. The server must support excluding scans that the probe is still running, so editing a running scan safely queues its new configuration. When connecting an updated probe to an older server, set `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1` until the server is upgraded.

### Packet capture

| Variable | Default | What it does |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | off | Set to `true` to let people with the permission start packet captures on this probe from the dashboard. Captures also need host networking and the `NET_RAW` capability. See [Packet Capture](/docs/probe/packet-capture). |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | The longest packet capture this probe runs, from 5 to 1800. |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | The largest packet capture file this probe makes, from 1 to 25. |

### What the probe listens on

A probe makes outbound connections only, unless you turn on a listener, or keep one that is on by default:

| Listener | Setting | Default | Read more |
| --- | --- | --- | --- |
| Incoming requests and heartbeats | `PROBE_INGRESS_PORT` | Off | [Incoming Request Ingress](/docs/probe/incoming-request-ingress) |
| SNMP traps | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | On, UDP 162 | [Network Device Monitor](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | Off, UDP 5140 | [Network Vendor Guides](/docs/monitor/network-vendor-guides) |
| NetFlow, IPFIX and sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | On, UDP 2055, 4739 and 6343 | [Network Traffic](/docs/monitor/network-traffic) |
| Health checks | `PORT` | On, TCP 3874 | `/status/live` and `/status/ready` |

Inside a container, a port is reachable from other machines only with host networking or when you publish it.

The syslog receiver forwards at most `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` messages a minute, `600` by default, drops the rest, and logs how many it dropped.

`PROBE_NAME` and `PROBE_DESCRIPTION` are read only by probes that register themselves with `REGISTER_PROBE_KEY`, such as the probes a self-hosted installation runs for every project. A custom probe takes its name and description from the dashboard.

## Troubleshooting

### Diagnosing a Disconnected Probe

A probe is flagged `Disconnected` when its requests to OneUptime stop succeeding. The probe's log says where each failed request got stuck, so you rarely have to guess.

:::steps
#### Read the environment block printed at startup

Every probe prints one JSON block at boot with the OneUptime URL it is using, its request deadline, its proxy settings, the DNS resolvers it inherited, the Node/OS version, and whether TLS verification has been disabled. Include this block whenever you report a problem.

#### Find the failure report

Every failed request to OneUptime logs a block containing `stalledAt` and `whatThisMeans`. `stalledAt` is the phase the request never got past:

| `stalledAt` | What it means |
| --- | --- |
| `SocketAssignment` | Nothing left the machine. The socket pool was saturated, or a configured proxy never completed its CONNECT tunnel. |
| `TcpConnect` | The machine sent SYN and got nothing back — a firewall or security appliance is dropping packets, or the host is unreachable. |
| `TlsHandshake` | TCP connected, TLS never finished. Usually a TLS-inspecting middlebox. |
| `RequestSend` | Connected, but the request was never fully written — the far end stopped reading. |
| `WaitingForServerResponse` | The request was delivered and the server sent nothing back. **The probe's network is fine** — check the OneUptime server, its load balancer and its reverse proxy. |
| `ResponseBody` | The server started answering and stalled part-way through. |
| `Unknown` | The probe could not tell where the request stopped. The connectivity self-test below is the next thing to read. |

The same block also reports `deadlineOverrunInMs`. If a 45000ms deadline took much longer than 45000ms of wall clock, the probe process itself was blocked — check `probeProcess.eventLoopMaxDriftInMs` in the block before investigating the network.

#### Read the connectivity self-test

After three consecutive failures the probe tests the same server one layer at a time — DNS, then TCP, then TLS, then a real HTTP round trip — and logs each stage with its timing. The first stage that fails is your answer. When a proxy is configured, the probe tests the hop to the proxy, because that is the only hop it actually makes. The test runs at most once every five minutes.

#### Watch for slow requests before they become failures

Requests that succeed but take longer than `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` are logged with their elapsed time. A probe that starts logging 20-second requests is on its way to crossing the 45-second deadline.
:::

On the OneUptime server side, a probe request that is answered slowly — or that the probe gave up on before a response was sent — is logged there too, with the probe's id. Those two logs together tell you which side of the connection is at fault.

### Other problems

:::details The probe stops right after it starts
Its log names what is missing: `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set`, or `PROBE_ID or REGISTER_PROBE_KEY should be set`. When all three are set but the ID and key do not match a probe, the probe tries 10 times, 30 seconds apart, then stops with `Unable to register probe after 10 attempts`. Copy the ID and key again with **Show ID and Key**.
:::

:::details The probe was working until someone reset its key
**Reset Probe Key**, on the probe's page, makes a new key and the old one stops working at once. Copy the new key with **Show ID and Key**, set it as `PROBE_KEY` and restart the probe.
:::

:::details A monitor says it cannot reach a private address
Probes refuse private addresses until you allow them. Set `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` on the probe and restart it: see [Private Network Access](/docs/self-hosted/private-network-access).
:::

If you're still having trouble, create an issue on [GitHub](https://github.com/oneuptime/oneuptime) or [contact support](https://oneuptime.com/support).

## Next steps

:::cards
- [Creating a Monitor](/docs/monitor/create-monitor): Pick what to check, and which probes check it.
- [Incoming Request Ingress](/docs/probe/incoming-request-ingress): Let services without internet access send heartbeats through the probe.
- [Packet Capture](/docs/probe/packet-capture): Capture the traffic the probe sees, from the dashboard.
- [Private Network Access](/docs/self-hosted/private-network-access): Let a probe check private addresses.
:::
