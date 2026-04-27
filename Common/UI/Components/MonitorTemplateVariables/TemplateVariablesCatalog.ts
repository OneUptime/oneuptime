import MonitorType from "../../../Types/Monitor/MonitorType";

export interface TemplateVariable {
  /** The placeholder users type, e.g. "monitorName" → renders as {{monitorName}}. */
  key: string;
  /** One-line explanation of what the variable resolves to at render time. */
  description: string;
  /** Example rendered value, shown in the "Example" column so users can picture the output. */
  example?: string | undefined;
}

export interface TemplateVariableGroup {
  title: string;
  description?: string | undefined;
  variables: Array<TemplateVariable>;
}

/**
 * Single source of truth for the variables available to incident/alert
 * template strings (`{{…}}`), mirroring what
 * `MonitorTemplateUtil.buildTemplateStorageMap` exposes on the server.
 *
 * Grouped by monitor type so the template-variables modal can render a
 * categorized, skimmable list that matches the actual monitor the user
 * is editing — users don't see SSL fields while configuring a Metric
 * monitor, and vice versa.
 *
 * Keep in sync with `Common/Server/Utils/Monitor/MonitorTemplateUtil.ts`.
 */
export default class TemplateVariablesCatalog {
  public static getVariables(input: {
    monitorType: MonitorType;
    /**
     * Attribute keys the user has configured on the metric query
     * (e.g. ["host.name", "region"]). For metric/kubernetes/docker
     * monitors, these become per-series template variables — one
     * incident fires per unique value combination, and each incident
     * can reference the label values via `{{host.name}}` etc.
     */
    seriesAttributeKeys?: Array<string> | undefined;
  }): Array<TemplateVariableGroup> {
    const groups: Array<TemplateVariableGroup> = [];

    groups.push(TemplateVariablesCatalog.monitorIdentityGroup());

    const perTypeGroup: TemplateVariableGroup | null =
      TemplateVariablesCatalog.perTypeGroup(input.monitorType);
    if (perTypeGroup) {
      groups.push(perTypeGroup);
    }

    if (
      input.monitorType === MonitorType.Metrics ||
      input.monitorType === MonitorType.Kubernetes ||
      input.monitorType === MonitorType.Docker
    ) {
      groups.push(
        TemplateVariablesCatalog.seriesLabelsGroup(input.seriesAttributeKeys),
      );
    }

    return groups;
  }

  private static monitorIdentityGroup(): TemplateVariableGroup {
    return {
      title: "Monitor",
      description:
        "Identity of the monitor that triggered the incident or alert.",
      variables: [
        {
          key: "monitorName",
          description: "Human-readable name of the monitor.",
          example: "Production API",
        },
        {
          key: "monitorId",
          description: "UUID of the monitor.",
          example: "a0f78958-da0a-4775-9fd9-c9fc63d3456f",
        },
      ],
    };
  }

  private static seriesLabelsGroup(
    attributeKeys: Array<string> | undefined,
  ): TemplateVariableGroup {
    const keys: Array<string> = attributeKeys || [];

    if (keys.length === 0) {
      return {
        title: "Series Labels (per-host / per-container)",
        description:
          "When you configure 'Group By' attributes on the metric query, this monitor fires one incident per unique group (e.g. one per host). Each group's label values become template variables here. Add attributes under 'Group By' to see variables.",
        variables: [],
      };
    }

    return {
      title: "Series Labels (per-host / per-container)",
      description:
        "One incident fires per unique combination of these values. Reference the triggering series' values in titles, descriptions, and remediation notes.",
      variables: keys.map((key: string): TemplateVariable => {
        return {
          key,
          description: `Value of \`${key}\` for the series that breached the threshold.`,
          example:
            key === "host.name"
              ? "prod-db-01"
              : key === "resource.k8s.container.name"
                ? "mariadb"
                : undefined,
        };
      }),
    };
  }

  private static perTypeGroup(
    monitorType: MonitorType,
  ): TemplateVariableGroup | null {
    switch (monitorType) {
      case MonitorType.API:
      case MonitorType.Website:
        return {
          title: "Response",
          description:
            "Details of the HTTP response from the monitored endpoint.",
          variables: [
            {
              key: "isOnline",
              description: "True if the endpoint responded successfully.",
              example: "true",
            },
            {
              key: "responseStatusCode",
              description: "HTTP status code returned.",
              example: "503",
            },
            {
              key: "responseTimeInMs",
              description: "Round-trip response time in milliseconds.",
              example: "812",
            },
            {
              key: "responseBody",
              description:
                "Parsed response body. Use dot paths like `{{responseBody.data.status}}` for JSON responses.",
              example: '{"status":"degraded"}',
            },
            {
              key: "responseHeaders",
              description:
                "Response headers. Use `{{responseHeaders.content-type}}` for a specific header.",
            },
          ],
        };

      case MonitorType.IncomingRequest:
        return {
          title: "Incoming Request",
          variables: [
            {
              key: "requestMethod",
              description: "HTTP method of the incoming request.",
              example: "POST",
            },
            {
              key: "requestBody",
              description:
                "Parsed request body. Use dot paths like `{{requestBody.event.type}}`.",
            },
            {
              key: "requestHeaders",
              description: "Request headers.",
            },
            {
              key: "incomingRequestReceivedAt",
              description: "Timestamp the request was received.",
            },
          ],
        };

      case MonitorType.Ping:
      case MonitorType.IP:
      case MonitorType.Port:
        return {
          title: "Connectivity",
          variables: [
            {
              key: "isOnline",
              description: "True if the target responded.",
              example: "false",
            },
            {
              key: "responseTimeInMs",
              description: "Response time in milliseconds.",
              example: "42",
            },
            {
              key: "isTimeout",
              description: "True if the check timed out.",
            },
            {
              key: "failureCause",
              description: "Reason the check failed, if any.",
              example: "Connection refused",
            },
          ],
        };

      case MonitorType.SSLCertificate:
        return {
          title: "SSL Certificate",
          variables: [
            {
              key: "commonName",
              description: "Common name (CN) of the certificate.",
              example: "*.example.com",
            },
            { key: "organization", description: "Issuing organization." },
            { key: "organizationalUnit", description: "Organizational unit." },
            { key: "locality", description: "Locality (city)." },
            { key: "state", description: "State / region." },
            { key: "country", description: "Country code." },
            {
              key: "expiresAt",
              description: "Certificate expiration date.",
              example: "2026-07-14T00:00:00.000Z",
            },
            { key: "createdAt", description: "Issue date." },
            {
              key: "isSelfSigned",
              description: "True if the certificate is self-signed.",
            },
            { key: "serialNumber", description: "Serial number." },
            { key: "fingerprint", description: "SHA-1 fingerprint." },
            { key: "fingerprint256", description: "SHA-256 fingerprint." },
            {
              key: "isOnline",
              description: "True if the SSL endpoint responded.",
            },
            {
              key: "failureCause",
              description: "Reason the SSL check failed, if any.",
            },
          ],
        };

      case MonitorType.Server:
        return {
          title: "Server Metrics",
          description: "Basic host metrics reported by the OneUptime agent.",
          variables: [
            {
              key: "hostname",
              description: "Host name reported by the agent.",
              example: "web-03.prod",
            },
            {
              key: "cpuUsagePercent",
              description: "Current CPU usage, 0-100.",
              example: "87",
            },
            { key: "cpuCores", description: "Number of CPU cores." },
            {
              key: "memoryUsagePercent",
              description: "Current memory usage, 0-100.",
              example: "74",
            },
            {
              key: "memoryFreePercent",
              description: "Free memory percentage.",
            },
            {
              key: "memoryTotalBytes",
              description: "Total memory on the host.",
            },
            {
              key: "diskMetrics",
              description:
                "Array of disks with {diskPath, usagePercent, freePercent, totalBytes}. Iterate with Handlebars or index: `{{diskMetrics.0.usagePercent}}`.",
            },
            {
              key: "processes",
              description:
                "Array of {pid, name, command} for tracked processes.",
            },
            { key: "requestReceivedAt", description: "Heartbeat timestamp." },
            {
              key: "failureCause",
              description: "Failure reason if the heartbeat failed.",
            },
          ],
        };

      case MonitorType.CustomJavaScriptCode:
        return {
          title: "Custom Code",
          variables: [
            {
              key: "result",
              description:
                "Return value of your script. Dot-accessible if it's an object: `{{result.status}}`.",
            },
            {
              key: "executionTimeInMs",
              description: "Script runtime in milliseconds.",
            },
            {
              key: "scriptError",
              description: "Runtime error message, if any.",
            },
            {
              key: "logMessages",
              description: "Array of `console.log` output from the script.",
            },
            {
              key: "failureCause",
              description: "High-level failure reason.",
            },
          ],
        };

      case MonitorType.SyntheticMonitor:
        return {
          title: "Synthetic Monitor",
          description:
            "One entry per browser × screen-size run. Use `{{syntheticResponses.0.scriptError}}` or a `{{#each syntheticResponses}}` loop.",
          variables: [
            {
              key: "syntheticResponses",
              description:
                "Array of {result, scriptError, executionTimeInMs, logMessages, screenshots, browserType, screenSizeType} — one per run.",
            },
            {
              key: "failureCause",
              description: "Overall failure reason if all runs failed.",
            },
          ],
        };

      case MonitorType.SNMP:
        return {
          title: "SNMP",
          variables: [
            {
              key: "isOnline",
              description: "True if the SNMP agent responded.",
            },
            {
              key: "responseTimeInMs",
              description: "Response time in milliseconds.",
            },
            {
              key: "isTimeout",
              description: "True if the SNMP request timed out.",
            },
            {
              key: "failureCause",
              description: "Failure reason.",
            },
            {
              key: "oidResponses",
              description:
                "Array of {oid, name, value, type}. Each named OID is also exposed directly — e.g. a `.sysUpTime` OID resolves as `{{sysUpTime}}`.",
            },
          ],
        };

      case MonitorType.DNS:
        return {
          title: "DNS",
          variables: [
            { key: "isOnline", description: "True if the DNS query resolved." },
            { key: "responseTimeInMs", description: "Query time." },
            { key: "isTimeout", description: "True if the query timed out." },
            { key: "isDnssecValid", description: "DNSSEC validation result." },
            { key: "failureCause", description: "Failure reason." },
            {
              key: "records",
              description: "Array of {type, value, ttl}.",
            },
            {
              key: "recordValues",
              description: "Flat array of record values for quick display.",
            },
          ],
        };

      case MonitorType.Domain:
        return {
          title: "Domain",
          variables: [
            { key: "isOnline", description: "True if WHOIS lookup succeeded." },
            { key: "domainName", description: "Domain queried." },
            { key: "registrar", description: "Registrar name." },
            { key: "createdDate", description: "Domain registration date." },
            { key: "updatedDate", description: "Last WHOIS update." },
            { key: "expiresDate", description: "Expiration date." },
            { key: "nameServers", description: "Array of nameservers." },
            { key: "domainStatus", description: "EPP status codes." },
            { key: "dnssec", description: "DNSSEC status." },
            { key: "responseTimeInMs", description: "Lookup time." },
            { key: "failureCause", description: "Failure reason." },
          ],
        };

      case MonitorType.ExternalStatusPage:
        return {
          title: "External Status Page",
          variables: [
            {
              key: "overallStatus",
              description: "Overall status reported by the status page.",
              example: "major_outage",
            },
            {
              key: "activeIncidentCount",
              description: "Number of active incidents on the status page.",
            },
            {
              key: "componentStatuses",
              description: "Array of {name, status, description}.",
            },
            {
              key: "isOnline",
              description: "True if the status page responded.",
            },
            { key: "responseTimeInMs", description: "Fetch time." },
            { key: "failureCause", description: "Failure reason." },
          ],
        };

      case MonitorType.Metrics:
      case MonitorType.Kubernetes:
      case MonitorType.Docker:
        return {
          title: "Metric",
          variables: [
            {
              key: "metricName",
              description:
                "The OTel metric name the monitor is watching (e.g. container.cpu.time).",
              example: "container.cpu.time",
            },
          ],
        };

      default:
        return null;
    }
  }
}
