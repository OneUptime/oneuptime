import BadDataException from "../Exception/BadDataException";
import MonitorType from "./MonitorType";
import { refusedValue } from "../../Utils/RefusedValue";
import { translationKey } from "../Translator";

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
 *
 * Each field's label and description is a translationKey: the Template sync
 * settings card and its summary line say them in the reader's language (the
 * Dashboard's extractor reads this file as a "keys" root). A field's path is
 * never one: templates store it in doNotSyncFields, and parse() reads it back
 * as written.
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
        MonitorType.NTP,
      ].includes(monitorType)
    ) {
      add("monitorDestination", translationKey("Monitor destination"));
      add("requestTimeoutInMs", translationKey("Request timeout"));
      add("retryCount", translationKey("Retry count"));
    }

    if (monitorType === MonitorType.API) {
      add(
        "requestHeaders",
        translationKey("Request headers"),
        translationKey("Keep the monitor's entire set of request headers."),
      );
      add("requestType", translationKey("Request method"));
      add("requestBody", translationKey("Request body"));
    }

    if ([MonitorType.Website, MonitorType.API].includes(monitorType)) {
      add("doNotFollowRedirects", translationKey("Redirect behavior"));
      add(
        "allowSelfSignedCertificates",
        translationKey("Allow self-signed certificates"),
      );
      add(
        "tlsClientAuthentication",
        translationKey("Client certificate authentication"),
        translationKey(
          "Keep the certificate, private key, and key passphrase together.",
        ),
      );
    }

    if ([MonitorType.Port, MonitorType.NTP].includes(monitorType)) {
      add("monitorDestinationPort", translationKey("Port"));
    }

    if (
      [MonitorType.SyntheticMonitor, MonitorType.CustomJavaScriptCode].includes(
        monitorType,
      )
    ) {
      add("customCode", translationKey("Check code"));
    }

    if (monitorType === MonitorType.SyntheticMonitor) {
      add("browserTypes", translationKey("Browsers"));
      add("screenSizeTypes", translationKey("Screen sizes"));
      add("retryCountOnError", translationKey("Retry count on error"));
    }

    if (monitorType === MonitorType.DNS) {
      add("dnsMonitor.queryName", translationKey("DNS query name"));
      add("dnsMonitor.recordType", translationKey("DNS record type"));
      add(
        "dnsMonitor.resolver",
        translationKey("DNS resolver"),
        translationKey("Keep the DNS server and port together."),
      );
      add("dnsMonitor.timeout", translationKey("DNS timeout"));
      add("dnsMonitor.retries", translationKey("DNS retries"));
    }

    if (monitorType === MonitorType.Domain) {
      add("domainMonitor.domainName", translationKey("Domain name"));
      add("domainMonitor.lookupMethod", translationKey("Domain lookup method"));
      add("domainMonitor.timeout", translationKey("Lookup timeout"));
      add("domainMonitor.retries", translationKey("Lookup retries"));
    }

    if (monitorType === MonitorType.DNSSEC) {
      add("dnssecMonitor.domainName", translationKey("Domain name"));
      add("dnssecMonitor.resolvers", translationKey("DNS resolvers"));
      add(
        "dnssecMonitor.checkNameserverConsistency",
        translationKey("Nameserver consistency check"),
      );
      add(
        "dnssecMonitor.signatureExpiryWarningDays",
        translationKey("Signature expiry warning"),
      );
      add("dnssecMonitor.timeout", translationKey("DNSSEC timeout"));
      add("dnssecMonitor.retries", translationKey("DNSSEC retries"));
    }

    if ([MonitorType.SQLQuery, MonitorType.Database].includes(monitorType)) {
      const prefix: string =
        monitorType === MonitorType.SQLQuery ? "sqlMonitor" : "databaseMonitor";
      add(
        `${prefix}.connection`,
        translationKey("Database connection"),
        translationKey(
          "Keep the database engine, host, port, database name, credentials, and TLS settings together.",
        ),
      );
      add(
        `${prefix}.connectionTimeoutInMs`,
        translationKey("Connection timeout"),
      );
      add(
        `${prefix}.statementTimeoutInMs`,
        translationKey("Statement timeout"),
      );
      if (monitorType === MonitorType.SQLQuery) {
        add("sqlMonitor.query", translationKey("SQL query"));
        add("sqlMonitor.maxRows", translationKey("Maximum result rows"));
      } else {
        add(
          "databaseMonitor.enabledMetricGroups",
          translationKey("Collected metric groups"),
        );
      }
    }

    if (monitorType === MonitorType.ExternalStatusPage) {
      add(
        "externalStatusPageMonitor.statusPageUrl",
        translationKey("Status page URL"),
      );
      add(
        "externalStatusPageMonitor.provider",
        translationKey("Status page provider"),
      );
      add(
        "externalStatusPageMonitor.components",
        translationKey("Status page components"),
        translationKey(
          "Keep the component group and the chosen components together.",
        ),
      );
      add(
        "externalStatusPageMonitor.timeout",
        translationKey("Status page timeout"),
      );
      add(
        "externalStatusPageMonitor.retries",
        translationKey("Status page retries"),
      );
    }

    // The probes each monitor made from a Probe Status template watches.
    if (monitorType === MonitorType.ProbeStatus) {
      add("probeStatusMonitor.probeIds", translationKey("Probes to watch"));
    }

    const infrastructure: Partial<
      Record<MonitorType, [string, string, string]>
    > = {
      [MonitorType.Kubernetes]: [
        "kubernetesMonitor",
        "clusterIdentifier",
        translationKey("Kubernetes cluster"),
      ],
      [MonitorType.Docker]: [
        "dockerMonitor",
        "hostIdentifier",
        translationKey("Docker host"),
      ],
      [MonitorType.Host]: [
        "hostMonitor",
        "hostIdentifier",
        translationKey("Host"),
      ],
      [MonitorType.Podman]: [
        "podmanMonitor",
        "hostIdentifier",
        translationKey("Podman host"),
      ],
      [MonitorType.Proxmox]: [
        "proxmoxMonitor",
        "clusterIdentifier",
        translationKey("Proxmox cluster"),
      ],
      [MonitorType.OpenStack]: [
        "openstackMonitor",
        "cloudIdentifier",
        translationKey("OpenStack cloud"),
      ],
      [MonitorType.DockerSwarm]: [
        "dockerSwarmMonitor",
        "clusterIdentifier",
        translationKey("Docker Swarm cluster"),
      ],
      [MonitorType.Ceph]: [
        "cephMonitor",
        "clusterIdentifier",
        translationKey("Ceph cluster"),
      ],
      [MonitorType.StorageArray]: [
        "storageArrayMonitor",
        "arrayIdentifier",
        translationKey("Storage array"),
      ],
      [MonitorType.IoTDevice]: [
        "iotMonitor",
        "fleetIdentifier",
        translationKey("IoT fleet"),
      ],
    };
    const infrastructureConfig: [string, string, string] | undefined =
      infrastructure[monitorType];
    if (infrastructureConfig) {
      const [prefix, identity, label]: [string, string, string] =
        infrastructureConfig;
      add(
        `${prefix}.${identity}`,
        label,
        monitorType === MonitorType.StorageArray
          ? translationKey("Keep the array and its storage platform together.")
          : undefined,
      );
      if (monitorType === MonitorType.Kubernetes) {
        add(
          `${prefix}.resources`,
          translationKey("Resource scope and filters"),
        );
      } else if (
        [MonitorType.Docker, MonitorType.Podman].includes(monitorType)
      ) {
        add(`${prefix}.containerFilters`, translationKey("Container filters"));
      } else if (monitorType !== MonitorType.Host) {
        add(`${prefix}.resourceFilters`, translationKey("Resource filters"));
      }
      add(`${prefix}.metricViewConfig`, translationKey("Metric queries"));
      add(`${prefix}.rollingTime`, translationKey("Query time window"));
    }

    const telemetry: Partial<Record<MonitorType, [string, string]>> = {
      [MonitorType.Logs]: [
        "logMonitor",
        translationKey("Log query configuration"),
      ],
      [MonitorType.SecurityEvents]: [
        "securityEventsMonitor",
        translationKey("Security event query configuration"),
      ],
      [MonitorType.Traces]: [
        "traceMonitor",
        translationKey("Trace query configuration"),
      ],
      [MonitorType.Llm]: [
        "llmMonitor",
        translationKey("AI / LLM answer configuration"),
      ],
      [MonitorType.Metrics]: [
        "metricMonitor",
        translationKey("Metric query configuration"),
      ],
      [MonitorType.Exceptions]: [
        "exceptionMonitor",
        translationKey("Exception query configuration"),
      ],
      [MonitorType.Profiles]: [
        "profileMonitor",
        translationKey("Profile query configuration"),
      ],
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
        throw new BadDataException(
          `Unsupported do not sync field: ${refusedValue(path)}.`,
        );
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
      /*
       * The chosen components, and the one name a monitor saved before
       * the list had (and an older probe reads), kept together.
       */
      return [
        "externalStatusPageMonitor.componentGroupName",
        "externalStatusPageMonitor.componentNames",
        "externalStatusPageMonitor.componentName",
      ];
    }
    if (field === "kubernetesMonitor.resources") {
      return [
        "kubernetesMonitor.resourceScope",
        "kubernetesMonitor.resourceFilters",
      ];
    }
    if (field === "storageArrayMonitor.arrayIdentifier") {
      /*
       * The platform decides which label a hardware filter reads (FlashArray
       * `component_name`, FlashBlade `name`), so a kept array keeps its own.
       */
      return [
        "storageArrayMonitor.arrayIdentifier",
        "storageArrayMonitor.storageSystem",
      ];
    }
    return [field];
  }
}
