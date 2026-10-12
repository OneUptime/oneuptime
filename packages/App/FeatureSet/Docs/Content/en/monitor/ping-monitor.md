# Ping Monitor

A Ping monitor checks that a host answers ping (ICMP echo requests), and measures the round-trip time, packet loss and jitter. Use it for servers, routers, firewalls and other devices you can reach by host name or IP address.

:::cards
- [Create the monitor](#create-a-ping-monitor): Six steps in the dashboard.
- [Configuration options](#configuration-options): The host, the timeout and retries.
- [Monitoring criteria](#monitoring-criteria): Reachability, latency, packet loss and jitter.
- [Troubleshooting](#troubleshooting): When the host is up but the monitor says offline.
:::

## How it works

On each check, a probe sends five echo requests to the host. If at least one reply comes back, the host is online, and the probe records the average round-trip time as the response time, along with the packet loss, the jitter and the fastest and slowest replies. If no reply comes back, the probe tries again, up to the number of retries you allow. OneUptime then runs the result through the monitor's criteria.

```mermaid title="One check of a host"
flowchart TB
    send["Send 5 echo requests"] --> reply{"Any reply?"}
    reply -->|"Yes"| measure["Record round-trip time,<br/>packet loss and jitter"]
    reply -->|"No, retries left"| send
    reply -->|"No, out of retries"| trace["Trace the network path"]
    measure --> criteria["Check the criteria"]
    trace --> criteria
```

When a check fails, the probe also traces the route to the host and looks up its name, and attaches what it found to the result as **Network Path at Time of Failure**, so you can see where the route broke.

> [!NOTE]
> Some hosting providers block ICMP on the machines a probe runs on. A probe that cannot send pings at all checks TCP port `80` on the host instead, so the monitor still says whether the host is reachable. Packet loss and jitter are not measured then.

A probe that has lost its own network connection reports no result, so it cannot mark your host offline.

## Before you begin

- **A role that can create monitors**: Project Owner, Project Admin, Project Member, Monitor Admin or Monitor Member, or a custom role with the Create Monitor permission.
- **A probe that can reach the host**, with ICMP allowed on the way. Your project's default probes are picked for every new monitor. If a firewall sits in front of the host, allow ICMP echo requests from [OneUptime Cloud's probe IP addresses](/docs/configuration/ip-addresses). A host on a private network needs a [custom probe](/docs/probe/custom-probe) inside that network.

## Create a ping monitor

:::steps
### Start a new monitor

Go to **Monitors** and click **Create Monitor**. Under **Monitor Type**, pick **Ping**.

### Name it

Enter a **Name**, such as `Core router`, then click **Next**.

### Enter the host

In **Hostname or IP Address**, enter the host name or the IPv4 or IPv6 address to ping, such as `example.com` or `192.168.1.1`. Enter the host only, without `http://` or a port.

### Test it

Click **Test Monitor**, pick a probe under **Select Probe** and click **Run Test**. **Monitor Test Result** shows the round-trip times and the packet loss the probe saw.

### Review the criteria

**Monitor Criteria** starts with the [default criteria](#default-criteria): offline when the host does not answer, online when it does. Change them if you need to, then click **Next**.

### Pick probes and create

Keep or change the **Probes** and the **Monitoring Interval** (it starts at **Every 5 Minutes**), then click **Create Monitor**. The monitor's page opens.
:::

## Configuration options

| Field | Default | What to enter |
| --- | --- | --- |
| **Hostname or IP Address** | None | The host to ping, such as `example.com`, `192.168.1.1` or `2001:db8::1`. A host name is resolved on every check, so the monitor follows DNS changes. |
| **Request Timeout (seconds)** (under **More fields**) | `60` | How long to wait for a reply on each attempt. The maximum is 60 seconds. |
| **Retries on Failure** (under **More fields**) | Probe default, usually `3` | How many times to retry a failed attempt. The maximum is 3. |

**Retries on Failure** counts retries _after_ the first attempt, so `0` runs the check once and `2` runs it up to three times. Left blank, it uses the probe's default: 3, unless the probe's `PROBE_MONITOR_RETRY_LIMIT` says otherwise. Every failure is retried, timeouts included, with a one-second pause between attempts. A successful check whose replies took longer than 10 seconds is checked again too.

To watch a fixed IP address and never a host name, you can use an [IP monitor](/docs/monitor/ip-monitor) instead. It runs the same check.

## Monitoring Criteria

Criteria decide when the host counts as online, degraded or offline, and whether that declares an incident or creates an alert. Each criteria checks one or more filters:

| Filter | Conditions | What it checks |
| --- | --- | --- |
| **Is Online** | **True**, **False** | Whether at least one echo request got a reply. |
| **Response Time (in ms)** | **Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** | The average round-trip time of the replies. |
| **Packet Loss (in %)** | **Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** | The share of the five echo requests that got no reply. |
| **Jitter (in ms)** | **Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** | The standard deviation of the round-trip times across the packets sent in one check. |
| **Is Request Timeout** | **True**, **False** | Whether the ping timed out on every attempt. |

With two or more filters, **Match Condition** decides whether **All** of them or **Any** one must match. A criteria's **Actions** decide what it does: change the monitor status, create an alert, declare an incident, or any of these.

### Default Criteria

A new ping monitor starts with two criteria:

- **Offline** — the host answers none of the echo requests, or cannot be reached at all, after every retry. The monitor is marked **Offline** and an incident called "_monitor name_ is offline" is created. The incident resolves itself when the host answers again.
- **Online** — the host answers. The monitor is marked **Operational**.

Criteria are checked from top to bottom, and the first one that matches decides what happens. When none matches, the monitor shows its default status: **Operational**, unless you pick another under **More fields**, below the criteria.

### Evaluating over a period of time

**Evaluate this criteria over a period of time** is a checkbox under a filter, offered for **Is Online**, **Response Time (in ms)**, **Packet Loss (in %)** and **Jitter (in ms)**. Turn it on to judge a window of past checks instead of the latest one: pick an aggregate under **Evaluate** and a window, from 2 to 60 minutes, under **For the last (in minutes)**.

| Aggregate | Matches when |
| --- | --- |
| **Average**, **Sum**, **Maximum Value**, **Minimum Value** | That figure, over the window, meets the condition. Numeric filters only. |
| **All Values** | Every check in the window meets the condition. |
| **Any Value** | At least one check in the window meets the condition. |

**All Values** only matches once the window is genuinely covered by data. A monitor that has just been created, or one whose checks stopped being recorded, does not have enough history to say anything about the last N minutes, so the criteria waits rather than matching on the one reading it does have. **Any Value** is the setting for "tell me the moment a single check breaches" and still fires immediately.

**If No Data** decides what happens while the window cannot back the criteria:

| Option | What happens | Use it for |
| --- | --- | --- |
| **Ignore** (default) | The criteria does not match. | Ordinary threshold alerting. |
| **Trigger** | The missing data counts as the problem. | Checks where silence is itself a failure. |
| **Treat As Zero** | The window is compared as a single zero. | Counters where no events genuinely means zero. |

### Example criteria

| Goal | Filter | Condition | Value |
| --- | --- | --- | --- |
| Offline when the host is unreachable | **Is Online** | **False** | — |
| Alert when latency is high | **Response Time (in ms)** | **Greater Than** | `200` |
| Mark the host degraded on a lossy link | **Packet Loss (in %)** | **Greater Than** | `20` |
| Alert on an unstable connection | **Jitter (in ms)** | **Greater Than** | `30` |

To alert only when latency stays high, turn on **Evaluate this criteria over a period of time** for the response time filter and pick **All Values** over **5** minutes.

## Troubleshooting

:::details The host is up, but the monitor says offline
The host, or a firewall in front of it, does not answer ICMP echo requests from the probe. Many servers and cloud networks drop ping by default. Allow ICMP echo requests from the probes, or watch a service on the host with a [Port monitor](/docs/monitor/port-monitor) instead. **Network Path at Time of Failure**, on the failed check, shows how far the route got.
:::

:::details The check fails with "This probe could not resolve" the host
The probe's DNS server does not know the host name. Check the name, or enter the IP address instead. A name that only resolves inside your network needs a [custom probe](/docs/probe/custom-probe) there.
:::

:::details Packet loss and jitter are empty
The probe that ran the check cannot send pings, so it checked TCP port `80` instead, which measures neither. Run the monitor on a probe that is allowed to send ICMP.
:::

## Next steps

:::cards
- [IP Monitor](/docs/monitor/ip-monitor): Watch a fixed IPv4 or IPv6 address.
- [Port Monitor](/docs/monitor/port-monitor): Check a service on the host, not just the host.
- [Custom Probes](/docs/probe/custom-probe): Ping hosts on your own network.
- [Incidents](/docs/incidents/index): What happens after the monitor declares one.
:::
