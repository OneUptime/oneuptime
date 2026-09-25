## Setting up Custom Probes

You can set up custom probes inside your network to monitor resources in your private network or resources that are behind your firewall.

To begin with you need to create a custom probe in your OneUptime Dashboard under Monitors > Settings > Probes. Once you have created the custom probe on your OneUptime Dashboard. You should have the `PROBE_ID` and `PROBE_KEY`

### Deploy Probe

#### Docker

To run a probe, please make sure you have docker installed. You can run custom probe by:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

If you are self hosting OneUptime, you can change `ONEUPTIME_URL` to your custom self hosted instance.

##### Proxy Configuration

If your probe needs to go through a proxy server to reach OneUptime or monitor external resources, you can configure proxy settings using these environment variables:

```
# For HTTP proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# For HTTPS proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# With proxy authentication
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

You can also run the probe using docker-compose. Create a `docker-compose.yml` file with the following content:

```yaml
version: "3"

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

##### With Proxy Configuration

If you need to use a proxy server, you can add proxy environment variables:

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      # Proxy configuration (optional)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # For proxy with authentication:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

Then run the following command:

```
docker compose up -d
```

If you are self hosting OneUptime, you can change `ONEUPTIME_URL` to your custom self hosted instance.

#### Kubernetes

You can also run the probe using Kubernetes. Create a `oneuptime-probe.yaml` file with the following content:

```yaml
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

##### With Proxy Configuration

If you need to use a proxy server, you can add proxy environment variables:

```yaml
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
            # Proxy configuration (optional)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # For proxy with authentication, use:
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

Then run the following command:

```bash
kubectl apply -f oneuptime-probe.yaml
```

If you are self hosting OneUptime, you can change `ONEUPTIME_URL` to your custom self hosted instance.

### Environment Variables

The probe supports the following environment variables:

#### Required Variables

- `PROBE_KEY` - The probe key from your OneUptime dashboard
- `PROBE_ID` - The probe ID from your OneUptime dashboard
- `ONEUPTIME_URL` - The URL of your OneUptime instance (default: https://oneuptime.com)

#### Optional Variables

- `HTTP_PROXY_URL` - HTTP proxy server URL for HTTP requests
- `HTTPS_PROXY_URL` - HTTP proxy server URL for HTTPS requests
- `NO_PROXY` - Comma-separated hosts or domains that should bypass the proxy
- `PROBE_NAME` - Custom name for the probe
- `PROBE_DESCRIPTION` - Description for the probe
- `PROBE_MONITORING_WORKERS` - Number of monitoring workers (default: 1)
- `PROBE_MONITOR_FETCH_LIMIT` - Number of monitors to fetch at once (default: 10)
- `PROBE_MONITOR_RETRY_LIMIT` - Retries after the first attempt of a failed monitor check, used when a step does not set its own retry count (default: 3, so up to 4 attempts)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Timeout for synthetic monitor scripts in milliseconds (default: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Timeout for custom code monitor scripts in milliseconds (default: 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` - Deadline for each request the probe sends to OneUptime (default: 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` - Log a warning for requests to OneUptime slower than this (default: 10000)
- `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` - Deadline for checking one monitor, after which the check is abandoned and retried next cycle (default: 900000)
- `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` - Deadline for one network discovery sweep, after which it is abandoned and the scan is reported failed (default: 5400000, i.e. 90 minutes)
- `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` - How often a running discovery sweep uploads the hosts it has found so far, so a long scan shows progress and its devices can be imported before it finishes (default: 30000, minimum: 5000)
- `PROBE_DISCOVERY_SCAN_CONCURRENCY` - Fixed number of addresses a discovery sweep probes at once. Leave unset (or 0) to size it from the scan's target, which is what you want unless the probe container is unusually small or unusually large (default: 0)
- `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` - Time limit, in milliseconds, for looking up reverse DNS (PTR) names for the hosts a discovery sweep found. Leave unset (or 0) to size it from the number of hosts: 60 seconds for up to about 860 hosts, growing to at most 10 minutes. Hosts the lookups do not reach in time get no reverse DNS name (they are listed by IP address unless SNMP or NetBIOS names them), and the scan's status message says how many were missed. A lookup that times out or fails is retried once within the same limit, asking each of the probe's nameservers in turn. Raise it for a large network behind a slow DNS server (default: 0, range: 1000–1200000)
- `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` - How many still-unnamed hosts one scan's NetBIOS lookup may ask, for scans with NetBIOS names turned on. Leave unset (or 0) to keep the built-in cap of 2,000. Hosts over the cap are not asked, and the scan's status message says how many. Raising it lengthens the lookup as well (the time limit is sized from it: about 104 seconds at 4,000 hosts) and puts more NBSTAT datagrams on the network, which intrusion detection rules watch for (default: 0, range: 1-4000)
- `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` - Maximum independent discovery scans running on this probe at once (default: 4, range: 1–16). The probe checks for another pending scan every minute while capacity is available, so a long scan does not block all other scans. When all slots are occupied, additional scans remain pending until a slot is free. Each scan has its own host concurrency, so resource usage grows with both settings; lower either limit for small containers. Set this to 1 to run scans sequentially.

Upgrade the OneUptime server before upgrading custom probes to use concurrent discovery. The server must support excluding scans that the probe is still running, so editing a running scan safely queues its new configuration. When connecting an updated probe to an older server, set `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1` until the server is upgraded.

#### Proxy Configuration

The probe supports both HTTP and HTTPS proxy servers. When configured, the probe will route all monitoring traffic through the specified proxy servers. You can also provide a comma-separated `NO_PROXY` list to bypass the proxy for internal hosts or networks.

**Proxy URL Format:**

```
http://[username:password@]proxy.server.com:port
```

**Examples:**

- Basic proxy: `http://proxy.example.com:8080`
- With authentication: `http://username:password@proxy.example.com:8080`

**Supported Features:**

- HTTP and HTTPS proxy support
- Proxy authentication (username/password)
- Automatic fallback between HTTP and HTTPS proxies
- Selective proxy bypass using `NO_PROXY`
- Works with all monitor types (Website, API, SSL, Synthetic, etc.)

**Note:** Both standard environment variables (`HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY`) and lowercase variants (`http_proxy`, `https_proxy`, `no_proxy`) are supported for compatibility.

### NetBIOS Name Lookups in Discovery Scans

A [network discovery scan](/docs/monitor/network-device-monitor) with **Look up NetBIOS names for hosts DNS doesn't name** turned on sends NetBIOS name queries (NBSTAT) from the probe. For scans that use it, allow this traffic:

- **Which hosts are queried:** discovered hosts that have neither an SNMP system name nor a reverse-DNS (PTR) name, and only at private addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) or carrier-grade NAT addresses (`100.64.0.0/10`). Public addresses are never queried, and a host whose reverse-DNS lookup from the probe returned a name is never sent a query. A host whose lookup failed, timed out, or was skipped when the lookup time budget ran out can still be queried, even if it has a PTR record.
- **Outbound:** UDP from one ephemeral (random, high-numbered) source port on the probe to UDP port 137 on those hosts. The proxy settings above do not apply to it.
- **Inbound:** the replies, from UDP port 137 on each host back to that ephemeral port. A stateful firewall allows them automatically. Without them, the hosts keep being named by their IP address.

The lookup needs no extra container capability and works from Kubernetes pod networking. It queries at most 2,000 hosts per scan (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` raises that to 4,000), sends each unanswered host one more query, paces queries at about 100 per second, and stops at a time limit sized to that work - about 54 seconds for a full 2,000-host lookup, and never more than two minutes. Global probes never send NetBIOS queries, whatever the scan says, so run scans that need NetBIOS names from a custom probe. The option is on for new scans. NBSTAT queries to many hosts can trip intrusion detection rules, so turn it off on scans of networks where that matters, or tell your security team first.

### Verify

If the probe is running successfully. It should show as `Connected` on your OneUptime dashboard. If it does not show as connected. You need to check logs of the container. If you're still having trouble. Please create an issue on [GitHub](https://github.com/oneuptime/oneuptime) or [contact support](https://oneuptime.com/support)

### Diagnosing a Disconnected Probe

A probe is flagged `Disconnected` when its requests to OneUptime stop succeeding. The probe's log says where each failed request got stuck, so you rarely have to guess.

**1. Read the environment block printed at startup.** Every probe prints one JSON block at boot with the OneUptime URL it is using, its request deadline, its proxy settings, the DNS resolvers it inherited, the Node/OS version, and whether TLS verification has been disabled. Include this block whenever you report a problem.

**2. Find the failure report.** Every failed request to OneUptime logs a block containing `stalledAt` and `whatThisMeans`. `stalledAt` is the phase the request never got past:

| `stalledAt` | What it means |
| --- | --- |
| `SocketAssignment` | Nothing left the machine. The socket pool was saturated, or a configured proxy never completed its CONNECT tunnel. |
| `TcpConnect` | The machine sent SYN and got nothing back — a firewall or security appliance is dropping packets, or the host is unreachable. |
| `TlsHandshake` | TCP connected, TLS never finished. Usually a TLS-inspecting middlebox. |
| `RequestSend` | Connected, but the request was never fully written — the far end stopped reading. |
| `WaitingForServerResponse` | The request was delivered and the server sent nothing back. **The probe's network is fine** — check the OneUptime server, its load balancer and its reverse proxy. |
| `ResponseBody` | The server started answering and stalled part-way through. |

The same block also reports `deadlineOverrunInMs`. If a 45000ms deadline took much longer than 45000ms of wall clock, the probe process itself was blocked — check `probeProcess.eventLoopMaxDriftInMs` in the block before investigating the network.

**3. Read the connectivity self-test.** After three consecutive failures the probe tests the same server one layer at a time — DNS, then TCP, then TLS, then a real HTTP round trip — and logs each stage with its timing. The first stage that fails is your answer. When a proxy is configured, the probe tests the hop to the proxy, because that is the only hop it actually makes.

**4. Watch for slow requests before they become failures.** Requests that succeed but take longer than `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` are logged with their elapsed time. A probe that starts logging 20-second requests is on its way to crossing the 45-second deadline.

On the OneUptime server side, a probe request that is answered slowly — or that the probe gave up on before a response was sent — is logged there too, with the probe's id. Those two logs together tell you which side of the connection is at fault.
