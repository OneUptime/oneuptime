import MonitorType from "./MonitorType";

export interface MonitorTemplateTargetField {
  path: ReadonlyArray<string>;
  label: string;
  requiredOnMonitor: boolean;
}

const field: (
  path: string,
  label: string,
  requiredOnMonitor?: boolean,
) => MonitorTemplateTargetField = (
  path: string,
  label: string,
  requiredOnMonitor: boolean = false,
): MonitorTemplateTargetField => {
  return { path: path.split("."), label, requiredOnMonitor };
};

const destinationFields: ReadonlyArray<MonitorTemplateTargetField> = [
  field("monitorDestination", "Monitor destination", true),
];

const connectionFields: (
  config: string,
) => ReadonlyArray<MonitorTemplateTargetField> = (
  config: string,
): ReadonlyArray<MonitorTemplateTargetField> => {
  return [
    field(`${config}.host`, "Database host", true),
    field(`${config}.port`, "Database port", true),
    field(`${config}.databaseName`, "Database name", true),
    field(`${config}.username`, "Database username"),
    field(`${config}.password`, "Database password"),
  ];
};

const containerFields: (
  config: string,
) => ReadonlyArray<MonitorTemplateTargetField> = (
  config: string,
): ReadonlyArray<MonitorTemplateTargetField> => {
  return [
    field(`${config}.hostIdentifier`, "Host", true),
    field(`${config}.containerFilters.containerName`, "Container name"),
    field(`${config}.containerFilters.containerImage`, "Container image"),
    field(`${config}.containerFilters.hostName`, "Host name"),
  ];
};

/*
 * A template describes shared checks while its target fields can be supplied
 * by each monitor. Keep this policy shared by the form, validation and sync:
 * blank targets preserve the monitor's value; supplied targets replace it.
 * Ordinary check options (timeouts, queries, criteria, etc.) always sync.
 * Network Device discovery has its own binding policy and is handled separately.
 */
const targetFields: Partial<
  Record<MonitorType, ReadonlyArray<MonitorTemplateTargetField>>
> = {
  [MonitorType.Website]: destinationFields,
  [MonitorType.API]: destinationFields,
  [MonitorType.SSLCertificate]: destinationFields,
  [MonitorType.Ping]: destinationFields,
  [MonitorType.IP]: destinationFields,
  [MonitorType.Port]: [
    ...destinationFields,
    field("monitorDestinationPort", "Port", true),
  ],
  [MonitorType.DNS]: [field("dnsMonitor.queryName", "DNS query name", true)],
  [MonitorType.DNSSEC]: [
    field("dnssecMonitor.domainName", "Domain name", true),
  ],
  [MonitorType.Domain]: [
    field("domainMonitor.domainName", "Domain name", true),
  ],
  [MonitorType.ExternalStatusPage]: [
    field("externalStatusPageMonitor.statusPageUrl", "Status page URL", true),
    field("externalStatusPageMonitor.componentGroupName", "Component group"),
    field("externalStatusPageMonitor.componentName", "Component"),
  ],
  [MonitorType.SQLQuery]: connectionFields("sqlMonitor"),
  [MonitorType.Database]: connectionFields("databaseMonitor"),
  [MonitorType.Kubernetes]: [
    field("kubernetesMonitor.clusterIdentifier", "Cluster", true),
    field("kubernetesMonitor.resourceFilters.namespace", "Namespace"),
    field("kubernetesMonitor.resourceFilters.workloadType", "Workload type"),
    field("kubernetesMonitor.resourceFilters.workloadName", "Workload name"),
    field("kubernetesMonitor.resourceFilters.nodeName", "Node name"),
    field("kubernetesMonitor.resourceFilters.podName", "Pod name"),
  ],
  [MonitorType.Docker]: containerFields("dockerMonitor"),
  [MonitorType.Podman]: containerFields("podmanMonitor"),
  [MonitorType.Host]: [field("hostMonitor.hostIdentifier", "Host", true)],
  [MonitorType.Proxmox]: [
    field("proxmoxMonitor.clusterIdentifier", "Cluster", true),
    field("proxmoxMonitor.resourceFilters.scope", "Resource scope"),
    field("proxmoxMonitor.resourceFilters.pveId", "Resource ID"),
    field("proxmoxMonitor.resourceFilters.nodeName", "Node name"),
    field("proxmoxMonitor.resourceFilters.guestId", "Guest ID"),
  ],
  [MonitorType.DockerSwarm]: [
    field("dockerSwarmMonitor.clusterIdentifier", "Cluster", true),
    field("dockerSwarmMonitor.resourceFilters.containerName", "Container name"),
    field(
      "dockerSwarmMonitor.resourceFilters.containerImage",
      "Container image",
    ),
    field("dockerSwarmMonitor.resourceFilters.nodeName", "Node name"),
    field("dockerSwarmMonitor.resourceFilters.serviceName", "Service name"),
  ],
  [MonitorType.Ceph]: [
    field("cephMonitor.clusterIdentifier", "Cluster", true),
    field("cephMonitor.resourceFilters.osdId", "OSD ID"),
    field("cephMonitor.resourceFilters.poolId", "Pool ID"),
  ],
  [MonitorType.IoTDevice]: [
    field("iotMonitor.fleetIdentifier", "Fleet", true),
    field("iotMonitor.resourceFilters.scope", "Resource scope"),
    field("iotMonitor.resourceFilters.deviceId", "Device ID"),
    field("iotMonitor.resourceFilters.deviceType", "Device type"),
  ],
};

export default class MonitorTemplateTargetPolicy {
  public static getTargetFields(
    monitorType: MonitorType,
  ): ReadonlyArray<MonitorTemplateTargetField> {
    return targetFields[monitorType] || [];
  }

  public static supportsMonitorType(
    monitorType: MonitorType | undefined,
  ): boolean {
    return Boolean(monitorType && targetFields[monitorType]?.length);
  }

  public static isBlankTargetValue(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0)
    );
  }

  /** Start a new template without target defaults that would overwrite monitors. */
  public static clearTargets(data: unknown, monitorType: MonitorType): void {
    for (const target of this.getTargetFields(monitorType)) {
      const parent: unknown = this.getValue(data, target.path.slice(0, -1));
      if (parent && typeof parent === "object") {
        delete (parent as Record<string, unknown>)[
          target.path[target.path.length - 1]!
        ];
      }
    }
  }

  public static getValue(data: unknown, path: ReadonlyArray<string>): unknown {
    let value: unknown = data;
    for (const key of path) {
      if (!value || typeof value !== "object") {
        return undefined;
      }
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  }
}
