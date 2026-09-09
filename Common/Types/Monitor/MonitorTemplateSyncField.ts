import BadDataException from "../Exception/BadDataException";
import MonitorType from "./MonitorType";

export interface MonitorTemplateSyncField {
  path: string;
  label: string;
  description?: string;
}

/**
 * The shared catalogue for the template editor and sync service. Only these
 * named fields can be preserved; criteria and step identities always sync.
 * Some options preserve related values together to keep credentials and
 * resource selectors consistent.
 */
export default class MonitorTemplateSyncFieldUtil {
  public static getFields(
    monitorType: MonitorType,
  ): Array<MonitorTemplateSyncField> {
    const fields: Array<MonitorTemplateSyncField> = [];
    const add: (path: string, label: string, description?: string) => void = (
      path: string,
      label: string,
      description?: string,
    ): void => {
      fields.push({ path, label, ...(description ? { description } : {}) });
    };

    if (
      [
        MonitorType.Website,
        MonitorType.API,
        MonitorType.Ping,
        MonitorType.IP,
        MonitorType.Port,
        MonitorType.SSLCertificate,
      ].includes(monitorType)
    ) {
      add("monitorDestination", "Monitor destination");
      add("requestTimeoutInMs", "Request timeout");
      add("retryCount", "Retry count");
    }

    if (monitorType === MonitorType.API) {
      add(
        "requestHeaders",
        "Request headers",
        "Keep the monitor's entire set of request headers.",
      );
      add("requestType", "Request method");
      add("requestBody", "Request body");
    }

    if ([MonitorType.Website, MonitorType.API].includes(monitorType)) {
      add("doNotFollowRedirects", "Redirect behavior");
      add("allowSelfSignedCertificates", "Allow self-signed certificates");
      add(
        "tlsClientAuthentication",
        "Client certificate authentication",
        "Keep the certificate, private key, and key passphrase together.",
      );
    }

    if (monitorType === MonitorType.Port) {
      add("monitorDestinationPort", "Port");
    }

    if (
      [MonitorType.SyntheticMonitor, MonitorType.CustomJavaScriptCode].includes(
        monitorType,
      )
    ) {
      add("customCode", "Check code");
    }

    if (monitorType === MonitorType.SyntheticMonitor) {
      add("browserTypes", "Browsers");
      add("screenSizeTypes", "Screen sizes");
      add("retryCountOnError", "Retry count on error");
    }

    if (monitorType === MonitorType.DNS) {
      add("dnsMonitor.queryName", "DNS query name");
      add("dnsMonitor.recordType", "DNS record type");
      add(
        "dnsMonitor.resolver",
        "DNS resolver",
        "Keep the DNS server and port together.",
      );
      add("dnsMonitor.timeout", "DNS timeout");
      add("dnsMonitor.retries", "DNS retries");
    }

    if (monitorType === MonitorType.Domain) {
      add("domainMonitor.domainName", "Domain name");
      add("domainMonitor.lookupMethod", "Domain lookup method");
      add("domainMonitor.timeout", "Lookup timeout");
      add("domainMonitor.retries", "Lookup retries");
    }

    if (monitorType === MonitorType.DNSSEC) {
      add("dnssecMonitor.domainName", "Domain name");
      add("dnssecMonitor.resolvers", "DNS resolvers");
      add(
        "dnssecMonitor.checkNameserverConsistency",
        "Nameserver consistency check",
      );
      add(
        "dnssecMonitor.signatureExpiryWarningDays",
        "Signature expiry warning",
      );
      add("dnssecMonitor.timeout", "DNSSEC timeout");
      add("dnssecMonitor.retries", "DNSSEC retries");
    }

    if ([MonitorType.SQLQuery, MonitorType.Database].includes(monitorType)) {
      const prefix: string =
        monitorType === MonitorType.SQLQuery ? "sqlMonitor" : "databaseMonitor";
      add(
        `${prefix}.connection`,
        "Database connection",
        "Keep the database engine, host, port, database name, credentials, and TLS settings together.",
      );
      add(`${prefix}.connectionTimeoutInMs`, "Connection timeout");
      add(`${prefix}.statementTimeoutInMs`, "Statement timeout");
      if (monitorType === MonitorType.SQLQuery) {
        add("sqlMonitor.query", "SQL query");
        add("sqlMonitor.maxRows", "Maximum result rows");
      } else {
        add("databaseMonitor.enabledMetricGroups", "Collected metric groups");
      }
    }

    if (monitorType === MonitorType.ExternalStatusPage) {
      add("externalStatusPageMonitor.statusPageUrl", "Status page URL");
      add("externalStatusPageMonitor.provider", "Status page provider");
      add(
        "externalStatusPageMonitor.components",
        "Status page components",
        "Keep the selected component group and component together.",
      );
      add("externalStatusPageMonitor.timeout", "Status page timeout");
      add("externalStatusPageMonitor.retries", "Status page retries");
    }

    const infrastructure: Partial<
      Record<MonitorType, [string, string, string]>
    > = {
      [MonitorType.Kubernetes]: [
        "kubernetesMonitor",
        "clusterIdentifier",
        "Kubernetes cluster",
      ],
      [MonitorType.Docker]: ["dockerMonitor", "hostIdentifier", "Docker host"],
      [MonitorType.Host]: ["hostMonitor", "hostIdentifier", "Host"],
      [MonitorType.Podman]: ["podmanMonitor", "hostIdentifier", "Podman host"],
      [MonitorType.Proxmox]: [
        "proxmoxMonitor",
        "clusterIdentifier",
        "Proxmox cluster",
      ],
      [MonitorType.DockerSwarm]: [
        "dockerSwarmMonitor",
        "clusterIdentifier",
        "Docker Swarm cluster",
      ],
      [MonitorType.Ceph]: ["cephMonitor", "clusterIdentifier", "Ceph cluster"],
      [MonitorType.IoTDevice]: ["iotMonitor", "fleetIdentifier", "IoT fleet"],
    };
    const infrastructureConfig: [string, string, string] | undefined =
      infrastructure[monitorType];
    if (infrastructureConfig) {
      const [prefix, identity, label]: [string, string, string] =
        infrastructureConfig;
      add(`${prefix}.${identity}`, label);
      if (monitorType === MonitorType.Kubernetes) {
        add(`${prefix}.resources`, "Resource scope and filters");
      } else if (
        [MonitorType.Docker, MonitorType.Podman].includes(monitorType)
      ) {
        add(`${prefix}.containerFilters`, "Container filters");
      } else if (monitorType !== MonitorType.Host) {
        add(`${prefix}.resourceFilters`, "Resource filters");
      }
      add(`${prefix}.metricViewConfig`, "Metric queries");
      add(`${prefix}.rollingTime`, "Query time window");
    }

    const telemetry: Partial<Record<MonitorType, [string, string]>> = {
      [MonitorType.Logs]: ["logMonitor", "Log query configuration"],
      [MonitorType.SecurityEvents]: [
        "securityEventsMonitor",
        "Security event query configuration",
      ],
      [MonitorType.Traces]: ["traceMonitor", "Trace query configuration"],
      [MonitorType.Metrics]: ["metricMonitor", "Metric query configuration"],
      [MonitorType.Exceptions]: [
        "exceptionMonitor",
        "Exception query configuration",
      ],
      [MonitorType.Profiles]: ["profileMonitor", "Profile query configuration"],
    };
    const telemetryConfig: [string, string] | undefined =
      telemetry[monitorType];
    if (telemetryConfig) {
      add(...telemetryConfig);
    }

    return fields;
  }

  public static parse(
    value: unknown,
    monitorType?: MonitorType,
  ): Array<string> | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (
      !Array.isArray(value) ||
      value.some((path: unknown): boolean => {
        return typeof path !== "string";
      })
    ) {
      throw new BadDataException(
        "Do not sync fields must be an array of supported field names.",
      );
    }

    const allowedFields: Set<string> = new Set(
      (monitorType === undefined ? Object.values(MonitorType) : [monitorType])
        .flatMap((type: MonitorType): Array<MonitorTemplateSyncField> => {
          return this.getFields(type);
        })
        .map((field: MonitorTemplateSyncField): string => {
          return field.path;
        }),
    );

    for (const path of value) {
      if (!allowedFields.has(path)) {
        throw new BadDataException(`Unsupported do not sync field: ${path}.`);
      }
    }

    return [...new Set(value as Array<string>)];
  }

  public static getPaths(field: string): Array<string> {
    // Validate even when called independently of parse: never traverse arbitrary paths.
    this.parse([field]);
    if (field === "tlsClientAuthentication") {
      return ["tlsClientCertificate", "tlsClientKey", "tlsClientKeyPassphrase"];
    }
    if (field === "dnsMonitor.resolver") {
      return ["dnsMonitor.hostname", "dnsMonitor.port"];
    }
    if (
      ["sqlMonitor.connection", "databaseMonitor.connection"].includes(field)
    ) {
      const prefix: string = field.split(".")[0]!;
      return [
        "databaseType",
        "host",
        "port",
        "databaseName",
        "username",
        "password",
        "useWindowsIntegratedAuthentication",
        "useSsl",
        "rejectUnauthorizedSsl",
      ].map((key: string): string => {
        return `${prefix}.${key}`;
      });
    }
    if (field === "externalStatusPageMonitor.components") {
      return [
        "externalStatusPageMonitor.componentGroupName",
        "externalStatusPageMonitor.componentName",
      ];
    }
    if (field === "kubernetesMonitor.resources") {
      return [
        "kubernetesMonitor.resourceScope",
        "kubernetesMonitor.resourceFilters",
      ];
    }
    return [field];
  }
}
