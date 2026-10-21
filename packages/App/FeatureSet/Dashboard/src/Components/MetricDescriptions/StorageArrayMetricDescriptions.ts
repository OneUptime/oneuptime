/*
 * What each number on the Storage Array pages means, in plain words. Shown
 * in the (i) tooltip beside a tile, card, summary field or column title.
 *
 * Each text describes what the page actually computes, not what the title
 * might suggest:
 *
 *   - Health, the alert and inventory counts, capacity and data reduction
 *     on the list and the overview come from the StorageArray snapshot
 *     columns ingest writes from the array's latest scrape, not from a time
 *     range. Health is OneUptime's verdict from the array's own open alerts
 *     and hardware status (StorageArraySnapshotScan).
 *   - Every per-object value (latency, IOPS, bandwidth, space) is the
 *     latest gauge the array reported — Pure computes them per second and
 *     per operation itself — and shows as a dash once it is older than the
 *     inventory cutoff: 15 minutes, 90 for directories, which the agent
 *     scrapes every 30 minutes (StorageArrayResourceUtils.freshMetricValue).
 *   - The Active Alerts card reads the purefa_alerts_open /
 *     purefb_alerts_open series of the last 10 minutes.
 *
 * The texts never say "bucket" for a FlashBlade S3 bucket: they are read
 * side by side with every other family's
 * (MetricDescriptionsConsistency.test.ts), where that word is reserved for
 * a chart interval and banned. The Buckets page's own titles carry the
 * noun, so its tooltips say "it" and "object store" instead.
 *
 * Change the fetch, change the words.
 */

import { translationKey } from "Common/UI/Utils/TranslateTemplate";

export type StorageArrayMetric =
  // Storage Arrays list (Pages/StorageArray/StorageArrays.tsx) and overview
  | "health"
  | "arrayCapacity"
  | "arrayDataReduction"
  | "arrayInventory"
  | "arrayOpenAlerts"
  // Array overview (Pages/StorageArray/View/Index.tsx)
  | "inventoryCounts"
  | "activeAlerts"
  | "capacityUsed"
  | "dataReduction"
  | "openAlerts"
  | "unhealthyHardware"
  | "unhealthyHardwareList"
  | "volumesTile"
  | "fileSystemsTile"
  | "slowestVolumes"
  | "largestVolumes"
  | "slowestFileSystems"
  | "largestFileSystems"
  // Shared inventory columns and summary fields
  | "provisionedColumn"
  | "physicalColumn"
  | "dataReductionColumn"
  | "readLatencyColumn"
  | "writeLatencyColumn"
  | "readIopsColumn"
  | "writeIopsColumn"
  | "readBandwidthColumn"
  | "writeBandwidthColumn"
  // Volumes (Pages/StorageArray/View/Volumes.tsx, VolumeDetail.tsx)
  | "volumeGroupColumn"
  | "volumeHostsColumn"
  // Hosts (Pages/StorageArray/View/Hosts.tsx, HostDetail.tsx)
  | "hostConnectivityColumn"
  | "hostGroupColumn"
  | "hostVolumesColumn"
  | "hostProvisionedColumn"
  // Replication (Pages/StorageArray/View/Replication.tsx)
  | "podLinkStatusColumn"
  | "podLagColumn"
  | "podAverageLagColumn"
  | "podRemoteColumn"
  | "podMediatorColumn"
  // Hardware (Pages/StorageArray/View/Hardware.tsx)
  | "hardwareStatusColumn"
  | "hardwareTemperatureColumn"
  | "driveStatusColumn"
  | "driveCapacityColumn"
  | "controllerStatusColumn"
  | "controllerModeColumn"
  | "interfaceStatusColumn"
  | "interfaceSpeedColumn"
  | "interfaceTrafficColumn"
  | "interfaceErrorsColumn"
  | "flashBladeHardwareStatusColumn"
  // Directories (Pages/StorageArray/View/Directories.tsx)
  | "directorySpaceColumn"
  // File systems (Pages/StorageArray/View/FileSystems.tsx, FileSystemDetail.tsx)
  | "fileSystemProvisionedColumn"
  | "fileSystemProtocolsColumn"
  // Buckets (Pages/StorageArray/View/Buckets.tsx, BucketDetail.tsx)
  | "bucketAccountColumn"
  | "bucketQuotaColumn"
  | "bucketUsedColumn"
  | "bucketObjectsColumn";

export const STORAGE_ARRAY_METRIC_DESCRIPTIONS: Record<
  StorageArrayMetric,
  string
> = {
  health: translationKey(
    "OneUptime's health verdict from the array's latest data: Critical when the array has an open critical alert or a failed hardware part, Warning when it has an open warning alert or a degraded part, otherwise OK. Unknown means no alert and hardware data has arrived yet.",
  ),
  arrayCapacity: translationKey(
    "Share of the array's usable capacity in use, from its latest data — the figure Pure itself reports, after data reduction. The bar turns amber at 80% and red at 90%, the levels Pure raises capacity alerts at.",
  ),
  arrayDataReduction: translationKey(
    "How much the array shrinks written data with deduplication and compression, from its latest data: 4.0:1 means four bytes written take one byte of flash.",
  ),
  arrayInventory: translationKey(
    "Objects the array reported in its latest data: volumes and hosts on a FlashArray, file systems on a FlashBlade.",
  ),
  arrayOpenAlerts: translationKey(
    "Alerts open on the array itself, from its latest data, with how many of them are critical. Hidden alerts are not counted. Open the array to see what each one says.",
  ),
  inventoryCounts: translationKey(
    "Counts from the array's latest data, not a time range: the volumes, hosts and pods of a FlashArray, or the file systems and object stores of a FlashBlade, plus its hardware components.",
  ),
  activeAlerts: translationKey(
    "The alerts the array itself raised and still reported as open in the last 10 minutes, critical first, with Pure's alert code and the part they concern. They explain why the array's health is not OK.",
  ),
  capacityUsed: translationKey(
    "Share of the array's usable capacity in use, from its latest data rather than the chart time range. The subtitle shows the space used out of the usable capacity. Pure raises its own capacity alerts at 80%, 90% and 100%.",
  ),
  dataReduction: translationKey(
    "Data reduction across the whole array from its latest data: written bytes divided by the bytes they take on flash after deduplication and compression. A falling ratio usually means new data is encrypted or already compressed.",
  ),
  openAlerts: translationKey(
    "Alerts open on the array itself in its latest data, split into critical and warning. Informational alerts are counted in the total; hidden alerts are not counted at all.",
  ),
  unhealthyHardware: translationKey(
    "Hardware components, drives and controllers whose latest reported status is critical, failed, missing, unhealthy, degraded, unknown, unrecognized or not ready, out of all the components the array reports.",
  ),
  unhealthyHardwareList: translationKey(
    "The hardware parts whose latest status needs a person: failed or missing drives, critical or degraded components and controllers that are not ready. Not installed, powered-off and unused parts are not listed.",
  ),
  volumesTile: translationKey(
    "Volumes the FlashArray reported in its latest data, with the number of hosts below. Volumes are the block devices the array serves to hosts over Fibre Channel, iSCSI or NVMe.",
  ),
  fileSystemsTile: translationKey(
    "File systems the FlashBlade reported in its latest data. Each one is shared to clients over NFS or SMB from the FlashBlade's own capacity.",
  ),
  slowestVolumes: translationKey(
    "The five volumes with the highest read or write latency in their latest report, as hosts see it per operation. Volumes that have not reported in the last 15 minutes are left out.",
  ),
  largestVolumes: translationKey(
    "The five volumes using the most physical space on the array after data reduction. A large provisioned size that reduces well can use little flash.",
  ),
  slowestFileSystems: translationKey(
    "The five file systems with the highest read or write latency in their latest report, per operation across NFS and SMB. File systems that have not reported in the last 15 minutes are left out.",
  ),
  largestFileSystems: translationKey(
    "The five file systems using the most physical space on the FlashBlade after data reduction, from their latest report.",
  ),
  provisionedColumn: translationKey(
    "The size hosts or clients see, from the latest report (Pure's total_provisioned space). Thin provisioning means the array only uses flash for what has been written.",
  ),
  physicalColumn: translationKey(
    "Flash this object uses on the array after deduplication and compression (Pure's total_physical space), from its latest report. Shows a dash if it has not reported recently.",
  ),
  dataReductionColumn: translationKey(
    "Data reduction of this object from its latest report: 3.0:1 means three bytes written take one byte of flash after deduplication and compression.",
  ),
  readLatencyColumn: translationKey(
    "Average time a read takes as the array measures it, per operation, from the latest report: microseconds (µs) below a millisecond. Flash reads usually finish well under 1 ms. Shows a dash if it has not reported recently.",
  ),
  writeLatencyColumn: translationKey(
    "Average time a write takes as the array measures it, per operation, from the latest report. Writes include the copy to the array's NVRAM before the host is answered. Shows a dash if it has not reported recently.",
  ),
  readIopsColumn: translationKey(
    "Read operations per second (IOPS) in the latest report, computed by the array itself. Shows a dash if it has not reported recently.",
  ),
  writeIopsColumn: translationKey(
    "Write operations per second (IOPS) in the latest report, computed by the array itself. Shows a dash if it has not reported recently.",
  ),
  readBandwidthColumn: translationKey(
    "Bytes read per second in the latest report, as the array measures it. Shows a dash if it has not reported recently.",
  ),
  writeBandwidthColumn: translationKey(
    "Bytes written per second in the latest report, as the array measures it. Shows a dash if it has not reported recently.",
  ),
  volumeGroupColumn: translationKey(
    "The pod (for ActiveCluster or ActiveDR replication) or volume group the volume belongs to, taken from its name: pod::volume or group/volume.",
  ),
  volumeHostsColumn: translationKey(
    "How many hosts the volume is connected to, directly or through a host group, from the array's latest host connection data.",
  ),
  hostConnectivityColumn: translationKey(
    "Whether the array sees this host on all its paths: Healthy when it is connected to every controller, Critical when it has lost its redundant paths, Unused when no volume is connected. The detail, such as Redundant or Single Controller, is Pure's own.",
  ),
  hostGroupColumn: translationKey(
    "The host group the host belongs to on the array. Volumes connected to a host group are connected to every host in it.",
  ),
  hostVolumesColumn: translationKey(
    "How many volumes are connected to this host, directly or through its host group, from the array's latest host connection data.",
  ),
  hostProvisionedColumn: translationKey(
    "Total size of every volume connected to this host, as the host sees it, from the latest report.",
  ),
  podLinkStatusColumn: translationKey(
    "Status of the pod's replica link to its remote array as Pure reports it, such as Replicating, Baselining, Paused or Unhealthy. With several links, the one with the largest lag is shown.",
  ),
  podLagColumn: translationKey(
    "How far the remote copy of the pod is behind, the largest lag across its replica links in the latest report. Lag that keeps growing means the link cannot keep up and the recovery point is slipping.",
  ),
  podAverageLagColumn: translationKey(
    "Average replication lag of the pod's replica link over Pure's own measurement window, from the latest report.",
  ),
  podRemoteColumn: translationKey(
    "The remote array and pod the replica link copies to or from, as Pure names them.",
  ),
  podMediatorColumn: translationKey(
    "Whether the arrays of a stretched ActiveCluster pod reach their mediator, which decides which array keeps serving the pod if they lose sight of each other. Anything but Online means a failover could take the pod offline.",
  ),
  hardwareStatusColumn: translationKey(
    "The component's latest status as Purity reports it. OK is healthy; Critical, Degraded and Unknown need a person; Not Installed, Device Off and Identifying are expected states.",
  ),
  hardwareTemperatureColumn: translationKey(
    "Latest temperature reading of the component's sensor in degrees Celsius, reported for sensors and the parts that carry one.",
  ),
  driveStatusColumn: translationKey(
    "The drive's latest status: Healthy and Empty are fine; Failed, Missing, Unrecognized and Unhealthy need a person; Recovering and Updating are temporary.",
  ),
  driveCapacityColumn: translationKey(
    "Raw capacity of the drive or NVRAM module as the array reports it, before RAID protection and data reduction.",
  ),
  controllerStatusColumn: translationKey(
    "The controller's latest status: Ready when it is serving or ready to take over. Anything else means the array runs without its usual redundancy.",
  ),
  controllerModeColumn: translationKey(
    "Whether the controller is the primary one serving the array or the secondary one ready to take over, as Purity reports it.",
  ),
  interfaceStatusColumn: translationKey(
    "Whether the network interface is enabled on the array. A disabled port carries no traffic; that is a setting rather than a failure.",
  ),
  interfaceSpeedColumn: translationKey(
    "The link speed the interface negotiated, in bytes per second as Pure reports it, from the latest report.",
  ),
  interfaceTrafficColumn: translationKey(
    "Bytes per second received and transmitted on the interface in the latest report.",
  ),
  interfaceErrorsColumn: translationKey(
    "Errors per second on the interface in the latest report, all error kinds together. Errors that persist usually mean a bad cable, optic or switch port.",
  ),
  flashBladeHardwareStatusColumn: translationKey(
    "The component's latest health as the FlashBlade reports it: Healthy, Unused for an empty position, or Unhealthy when the part needs a person.",
  ),
  directorySpaceColumn: translationKey(
    "Flash the managed directory uses after data reduction. The agent reads directory space every 30 minutes, because it is costly for the array to compute, so this shows a dash only after 90 minutes without data.",
  ),
  fileSystemProvisionedColumn: translationKey(
    "The size the file system was given on the FlashBlade, from its latest report. Clients see this as the size of the share.",
  ),
  fileSystemProtocolsColumn: translationKey(
    "The protocols the file system is shared over, NFS and SMB, as the FlashBlade reports them.",
  ),
  bucketAccountColumn: translationKey(
    "The FlashBlade object store account it belongs to. Accounts hold the users and access keys clients connect with.",
  ),
  bucketQuotaColumn: translationKey(
    "The size limit set on it in the FlashBlade's object store, from the latest report. A dash means no quota is set.",
  ),
  bucketUsedColumn: translationKey(
    "Flash its objects use on the FlashBlade after data reduction (Pure's total_physical space), from the latest report.",
  ),
  bucketObjectsColumn: translationKey(
    "Number of objects stored in it, from the FlashBlade's latest report.",
  ),
};
