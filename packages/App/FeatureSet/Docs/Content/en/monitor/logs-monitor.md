# Logs Monitor

Logs monitoring allows you to monitor your application logs and trigger alerts based on log patterns, counts, and severity levels. OneUptime evaluates logs from your telemetry services and checks them against your configured criteria.

## Overview

Logs monitors search and count logs matching specific filters over a time window. This enables you to:

- Alert on error log spikes
- Monitor specific log patterns or messages
- Track log volume by severity level
- Filter logs by service, attributes, and content
- Detect application issues from log patterns

## Creating a Logs Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Logs** as the monitor type
4. Choose the logs to count: the text they include, the time window and the severity levels
5. To narrow them to telemetry services, infrastructure entities or attributes, open **More fields** below these filters
6. Configure the criteria as needed

## Configuration Options

### Telemetry Services

Select one or more services to monitor logs from, under **More fields**. Leave it empty to monitor logs from every service. Services must be sending logs to OneUptime via OpenTelemetry.

### Log Filters

| Filter          | Description                                               | Required |
| --------------- | --------------------------------------------------------- | -------- |
| Severity Levels | Filter by log severity (ERROR, WARN, INFO, DEBUG, etc.)   | No       |
| Body            | Text search within the log message body                   | No       |
| Attributes      | Key-value pairs to filter on custom log attributes        | No       |
| Time Window     | How far back to search for logs (in seconds, default: 60) | No       |

### Severity Levels

Filter logs by one or more severity levels:

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## Monitoring Criteria

### Available Filter Types

| Filter Type | Description                                                 |
| ----------- | ----------------------------------------------------------- |
| Log Count   | The number of logs matching your filters in the time window |

### Filter Conditions

- **Greater Than** — Log count exceeds a threshold
- **Less Than** — Log count is below a threshold
- **Greater Than or Equal To** — Log count is at or above a threshold
- **Less Than or Equal To** — Log count is at or below a threshold
- **Equal To** — Log count matches exactly

### Example Criteria

#### Alert if more than 100 error logs in 60 seconds

- **Severity Levels**: ERROR
- **Time Window**: 60 seconds
- **Filter Type**: Log Count
- **Filter Condition**: Greater Than
- **Value**: 100

#### Alert if any fatal logs appear

- **Severity Levels**: FATAL
- **Time Window**: 60 seconds
- **Filter Type**: Log Count
- **Filter Condition**: Greater Than
- **Value**: 0

#### Monitor logs containing a specific error message

- **Body**: `database connection timeout`
- **Time Window**: 300 seconds
- **Filter Type**: Log Count
- **Filter Condition**: Greater Than
- **Value**: 5

## Per-group alerting (Group By)

**Group by Attributes** splits a Logs monitor's count into one count per distinct combination of attribute values - one per IPsec tunnel, per VPN user, per firewall interface - and evaluates the criteria on each group separately. It is the log counterpart of a metrics monitor's [Group By](/docs/monitor/metrics-monitor#per-series-alerting-group-by).

### One alert per group

Without Group By, a monitor that watches for terminated IPsec tunnels is a single count for the whole monitor and raises **one alert for the whole monitor**. While that alert is open, a second tunnel going down produces nothing new - the monitor is already alerting.

With Group By set to the tunnel name, tunnel `HQ-Branch1` terminating opens its own alert, and tunnel `Branch2` terminating ten minutes later opens a **second, separate alert** alongside it.

### Independent resolution

Each group's alert or incident resolves on its own. Once a group stops meeting the criteria - `HQ-Branch1` logs no more terminations within the time window - its alert resolves, while `Branch2`'s stays open until `Branch2` stops too. One group recovering never closes another group's alert.

A Logs monitor sees events, not state: a group's alert resolves once that group has logged nothing that meets the criteria for a whole time window, whether or not the tunnel is back.

### Example: one alert per Sophos IPsec tunnel

This assumes the firewall's syslog lines are parsed into attributes with a [Key=Value Parser](/docs/telemetry/log-pipelines#keyvalue-parser), without a target prefix, so the tunnel name is the attribute `con_name`:

```text
log_component="IPSec" con_name="HQ-Branch1" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."
```

1. Create a **Logs** monitor.
2. Set **Monitor Logs that include this text** to `terminated` and **Monitor Logs for (time)** to **Last 5 minutes**.
3. Under **More fields**, add the attribute filter `log_component` = `IPSec`.
4. In **Group by Attributes**, add `con_name`.
5. Add a criteria with the filter **Log Count** **Greater Than** `0` that creates an alert or incident titled `IPsec tunnel {{con_name}} terminated`.

Each tunnel that logs a termination now gets its own alert - `IPsec tunnel HQ-Branch1 terminated`, `IPsec tunnel Branch2 terminated` - and each resolves on its own.

### Group values in titles and descriptions

Every group-by attribute's value is a [template variable](/docs/monitor/incident-alert-templating) in the alert or incident title, description, and remediation notes, the same way a metric series' labels are: grouping by `con_name` gives you `{{con_name}}`. A key with dots reads as a path, so `sophos.con_name` is `{{sophos.con_name}}`. When the title does not already name the group, the group is appended to it (`IPsec tunnel terminated - Con Name: HQ-Branch1`), and `{{seriesResourceSuffix}}` and `{{seriesResourceSummary}}` work as they do on metric monitors.

### How groups are counted

- Up to 10 attributes. Each distinct combination of their values is one group.
- A log that does not carry a group-by attribute is counted under an **empty value** for it, so logs missing the attribute form a group of their own whose alert names no value for it. If every alert arrives without a group value, check the attribute key - a log pipeline with a target prefix stores `con_name` as `sophos.con_name`.
- Group values longer than 256 characters are cut to 256.
- At most **100 groups** are evaluated per check: the 100 with the most logs. When more match, the rest are skipped for that check and a warning is logged - narrow the monitor's filters to cover them.

### Criteria evaluation differs

- **Every criteria is evaluated**, as on a grouped metrics monitor, so different groups can meet different criteria at once. A group that meets two criteria still gets one alert, from the first, so order the criteria most severe first.
- **A group only exists when it logged something in the time window.** **Equal To 0** and **Less Than** criteria therefore only fire for groups that logged at least once; to alert when logs stop arriving altogether, use a monitor without Group By.
- **Anomaly detection** (**Anomalously High**, **Anomalously Low**, **Anomalous**) is not evaluated per group - its baseline covers the whole monitor - so those filters never match on a grouped monitor.
- The monitor's status follows the first criteria any group meets. When no group meets any criteria, the monitor returns to its default status.

## Setup Requirements

Logs monitoring requires your applications to send logs to OneUptime via OpenTelemetry. See the [OpenTelemetry](/docs/telemetry/open-telemetry) documentation for setup instructions.
