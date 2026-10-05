# Creating a Monitor

A monitor checks something you run, such as a website, an API, a host or a Kubernetes cluster, and tells you when it stops working. **Create Monitor** asks what to monitor first, then what to check, then how often. Everything but the type, the name and what to check starts with defaults that suit most monitors.

## Monitor Info

Go to **Monitors** and click **Create Monitor**. The first question is the **Monitor Type**: what do you want to monitor?

- The six types most people create come first: **Website**, **API**, **Ping**, **Port**, **SSL Certificate** and **Incoming Request**, for heartbeats from cron jobs and webhooks.
- **More monitor types** lists every other type under its category, such as **Infrastructure** (Kubernetes, Docker, Host) and **Telemetry** (Logs, Metrics, Traces). **Manual**, a monitor whose status you set yourself, is under **Other**.
- Or type in the search box. It knows the words you already use, such as `k8s`, `postgres`, `heartbeat` or `tls`, and **Enter** picks the first match.

The type you pick shrinks to one line. Click **Change** to pick another; press **Escape** while choosing to keep the type you had.

Then fill in the **Name**. It is used in alerts and incident titles. **Description** and **Labels** are optional and wait under **More fields**.

A **Manual** monitor needs nothing more, so **Create Monitor** is on this step.

## Criteria

This step opens on what to check. For a website, that is its URL, with an example in the box; other types ask for a host, a query, a cluster or a log filter. **Test Monitor** runs the check once before you save it.

Below it, **Monitor Criteria** decide when the monitor changes status, declares an incident or creates an alert. A new monitor starts with criteria that suit most monitors, each folded to one line that says what it checks and what it does. A new website monitor, for example, is marked offline and declares an incident when the site does not answer or answers with an error status code. Click a criteria to open and change it. **Add Criteria** adds one, open and ready to fill in.

Nothing on this step is marked as missing until you click **Next**.

## Probes & Interval

Monitors that probes check end with this step: Website, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, Domain, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code and External Status Page. **Probes** are the machines that run the checks, and your project's default probes start selected. The **Monitoring Interval** starts at **Every 5 Minutes**. Click **Create Monitor**.

Every other type is created from the **Criteria** step.

## Starting from a template or a link

A monitor template, and the links that create a monitor elsewhere in OneUptime (on a metric chart, a network device or a detection rule), open **Create Monitor** with the type picked and the rest filled in. Click **Change** to pick a different type. A template's own form uses the same type picker: see [Monitor Templates](/docs/monitor/monitor-templates).
