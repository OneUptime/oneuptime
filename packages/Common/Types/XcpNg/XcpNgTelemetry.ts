/*
 * ------------------------------------------------------------------
 * What an XCP-ng pool's telemetry looks like when it reaches OneUptime
 * ------------------------------------------------------------------
 *
 * The XCP-ng Agent (agents/XcpNgAgent) scrapes Xen Orchestra's OpenMetrics
 * plugin (xo-server-openmetrics, Xen Orchestra 6.9 or later), which serves
 * every pool that Xen Orchestra manages from one endpoint. The agent:
 *
 *   - keeps the `xcp_*` series and drops `xo_*` (Xen Orchestra's own
 *     process, which belongs to no pool);
 *   - turns the eight series Xen Orchestra types `counter` but fills with
 *     XAPI's per-second rates (XCP_NG_RATE_TYPED_AS_COUNTER_SERIES) into
 *     gauges, keeping their names;
 *   - groups the series by their `pool_id` / `pool_name` labels, so each
 *     pool is one OTLP resource carrying XCP_NG_POOL_ID_ATTRIBUTE and
 *     XCP_NG_POOL_NAME_ATTRIBUTE;
 *   - stamps the Xen Orchestra it read them from (XEN_ORCHESTRA_NAME_ATTRIBUTE)
 *     and its own version.
 *
 * A probe reading Xen Orchestra without an agent (#10996) sends exactly this
 * shape, so nothing downstream can tell the two apart.
 *
 * At ingest, XcpNgSeriesNormalizer stamps every datapoint with
 * XCP_NG_SCOPE_ATTRIBUTE / XCP_NG_ID_ATTRIBUTE (one uniform way to filter a
 * host's, a VM's or a storage repository's series) and appends the derived
 * 0/1 health series (XcpNgDerivedSeries) the alert templates read.
 *
 * Every name here is part of a contract with stored data and monitors that
 * people configured: never rename one.
 * ------------------------------------------------------------------
 */

// The pool's XAPI UUID: what OneUptime matches an XCP-ng pool on.
export const XCP_NG_POOL_ID_ATTRIBUTE: string = "xcp_ng.pool.id";

// The pool's name in Xen Orchestra (its XAPI name_label); may be empty.
export const XCP_NG_POOL_NAME_ATTRIBUTE: string = "xcp_ng.pool.name";

// The name the agent's owner gave the Xen Orchestra it reads (XO_NAME).
export const XEN_ORCHESTRA_NAME_ATTRIBUTE: string = "xen_orchestra.name";

// Stamped on every datapoint at ingest: which kind of object it describes.
export const XCP_NG_SCOPE_ATTRIBUTE: string = "xcp_ng.scope";

// Stamped on every datapoint at ingest: that object's UUID.
export const XCP_NG_ID_ATTRIBUTE: string = "xcp_ng.id";

/*
 * The kind of object a series describes, as XCP_NG_SCOPE_ATTRIBUTE carries
 * it. Byte-equal values are what monitor filters compare against.
 */
export enum XcpNgScope {
  Pool = "pool",
  Host = "host",
  VM = "vm",
  StorageRepository = "sr",
  VDI = "vdi",
  Xostor = "xostor",
}

// The labels Xen Orchestra's OpenMetrics plugin puts on its series.
export const XcpNgLabel: {
  PoolId: string;
  PoolName: string;
  Uuid: string;
  Type: string;
  HostId: string;
  HostName: string;
  VmName: string;
  VmUuid: string;
  IsControlDomain: string;
  PowerState: string;
  Enabled: string;
  Tags: string;
  SrUuid: string;
  SrName: string;
  SrType: string;
  ContentType: string;
  VdiUuid: string;
  VdiName: string;
  Device: string;
  Vif: string;
  Interface: string;
  NetworkName: string;
  Sr: string;
  Core: string;
} = {
  PoolId: "pool_id",
  PoolName: "pool_name",
  Uuid: "uuid",
  Type: "type",
  HostId: "host_id",
  HostName: "host_name",
  VmName: "vm_name",
  VmUuid: "vm_uuid",
  IsControlDomain: "is_control_domain",
  PowerState: "power_state",
  Enabled: "enabled",
  Tags: "tags",
  SrUuid: "sr_uuid",
  SrName: "sr_name",
  SrType: "sr_type",
  ContentType: "content_type",
  VdiUuid: "vdi_uuid",
  VdiName: "vdi_name",
  Device: "device",
  Vif: "vif",
  Interface: "interface",
  NetworkName: "network_name",
  Sr: "sr",
  Core: "core",
};

/*
 * The series of Xen Orchestra's OpenMetrics plugin that OneUptime reads by
 * name: the inventory, the pool's counts and the alert templates. The
 * catalog (XcpNgMetricCatalog) describes every series, these and the rest.
 */
export enum XcpNgSeries {
  PoolConnected = "xcp_pool_connected",
  HostStatus = "xcp_host_status",
  HostUptimeSeconds = "xcp_host_uptime_seconds",
  HostCpuAverage = "xcp_host_cpu_average",
  HostLoad = "xcp_host_load",
  HostLoadAverage = "xcp_host_load_average",
  HostMemoryTotalBytes = "xcp_host_memory_total_bytes",
  HostMemoryFreeBytes = "xcp_host_memory_free_bytes",
  HostRunningVcpus = "xcp_host_running_vcpus",
  HostPowerConsumptionWatts = "xcp_host_power_consumption_watts",
  HostNetworkReceiveBytesTotal = "xcp_host_network_receive_bytes_total",
  HostNetworkTransmitBytesTotal = "xcp_host_network_transmit_bytes_total",
  HostNetworkAggregatedReceiveBytes = "xcp_host_network_aggregated_receive_bytes",
  HostNetworkAggregatedTransmitBytes = "xcp_host_network_aggregated_transmit_bytes",
  HostDiskLatencySeconds = "xcp_host_disk_latency_seconds",
  HostDiskIowait = "xcp_host_disk_iowait",
  HostDiskIopsTotal = "xcp_host_disk_iops_total",
  HostDiskThroughputTotalBytes = "xcp_host_disk_throughput_total_bytes",
  VmStatus = "xcp_vm_status",
  VmUptimeSeconds = "xcp_vm_uptime_seconds",
  VmCpuUsage = "xcp_vm_cpu_usage",
  VmCpuCoreUsage = "xcp_vm_cpu_core_usage",
  VmMemoryBytes = "xcp_vm_memory_bytes",
  VmMemoryTargetBytes = "xcp_vm_memory_target_bytes",
  VmMemoryInternalFreeBytes = "xcp_vm_memory_internal_free_bytes",
  VmRunstateFullContention = "xcp_vm_runstate_full_contention",
  VmRunstatePartialContention = "xcp_vm_runstate_partial_contention",
  VmRunstateConcurrencyHazard = "xcp_vm_runstate_concurrency_hazard",
  VmNetworkReceiveBytesTotal = "xcp_vm_network_receive_bytes_total",
  VmNetworkTransmitBytesTotal = "xcp_vm_network_transmit_bytes_total",
  VmNetworkReceiveErrorsTotal = "xcp_vm_network_receive_errors_total",
  VmNetworkTransmitErrorsTotal = "xcp_vm_network_transmit_errors_total",
  VmDiskReadBytesTotal = "xcp_vm_disk_read_bytes_total",
  VmDiskWriteBytesTotal = "xcp_vm_disk_write_bytes_total",
  VmDiskIopsTotal = "xcp_vm_disk_iops_total",
  VmDiskLatencySeconds = "xcp_vm_disk_latency_seconds",
  SrVirtualSizeBytes = "xcp_sr_virtual_size_bytes",
  SrPhysicalSizeBytes = "xcp_sr_physical_size_bytes",
  SrPhysicalUsageBytes = "xcp_sr_physical_usage_bytes",
  VdiVirtualSizeBytes = "xcp_vdi_virtual_size_bytes",
  VdiPhysicalUsageBytes = "xcp_vdi_physical_usage_bytes",
  XostorUp = "xcp_xostor_up",
}

/*
 * The trap. Xen Orchestra types these `counter` (and names them *_total),
 * but each value is XAPI's per-second rate from rrd_updates: bytes per
 * second, or errors per second. Read as counters, every throughput chart
 * is wrong - a rate that goes down reads as a counter reset. The agent
 * turns them into gauges and keeps their names; ingest does the same for
 * any that still arrive as a sum (XcpNgSeriesNormalizer).
 */
export const XCP_NG_RATE_TYPED_AS_COUNTER_SERIES: ReadonlyArray<string> = [
  XcpNgSeries.HostNetworkReceiveBytesTotal,
  XcpNgSeries.HostNetworkTransmitBytesTotal,
  XcpNgSeries.VmNetworkReceiveBytesTotal,
  XcpNgSeries.VmNetworkTransmitBytesTotal,
  XcpNgSeries.VmNetworkReceiveErrorsTotal,
  XcpNgSeries.VmNetworkTransmitErrorsTotal,
  XcpNgSeries.VmDiskReadBytesTotal,
  XcpNgSeries.VmDiskWriteBytesTotal,
];

/*
 * The 0/1 series OneUptime derives at ingest from Xen Orchestra's status
 * series, whose state lives in a label (power_state="Halted" with the value
 * always 1), so a threshold can be set on them the way Proxmox's pve_up is.
 * OneUptime's own names, dotted like every series OneUptime derives, so a
 * future Xen Orchestra series can never collide with one.
 */
export enum XcpNgDerivedSeries {
  // 1 while Xen Orchestra reports the host Running, else 0 (Halted, Unknown).
  HostRunning = "xcp_ng.host.running",
  // 1 while the host is enabled; 0 in maintenance mode or being evacuated.
  HostEnabled = "xcp_ng.host.enabled",
  // 1 while the VM is Running, else 0 (Halted, Paused, Suspended).
  VmRunning = "xcp_ng.vm.running",
  /*
   * 1 while a VM that ran in the last XCP_NG_VM_RAN_RECENTLY_HOURS hours is
   * Halted or Paused; 0 otherwise. Suspended is someone's choice and never
   * counts. A VM nobody saw running in that time never counts either, so a
   * VM switched off on purpose stops alerting after a day.
   */
  VmStoppedAfterRunning = "xcp_ng.vm.stopped_after_running",

  /*
   * #10997: what a probe reads beyond the metrics - Xen Orchestra's REST
   * API, or the pool's XAPI - added by the server from what it read
   * (XcpNgEventRecords), never by the XCP-ng Agent, whose plugin carries
   * none of it.
   */
  // 1 while the pool's HA is on, else 0.
  PoolHaEnabled = "xcp_ng.pool.ha.enabled",
  /*
   * While HA is on: 1 while it can still tolerate the host failures it is
   * set to (XAPI's plan) - or, through Xen Orchestra, a host failure (a
   * host up and enabled beyond the one that fails) - else 0
   * (XcpNgHighAvailability).
   */
  PoolHaCanTolerateHostFailure = "xcp_ng.pool.ha.can_tolerate_host_failure",
  // How many host failures HA is set to tolerate (straight from XAPI only).
  PoolHaHostFailuresToTolerate = "xcp_ng.pool.ha.host_failures_to_tolerate",
  // How many host failures HA's plan still covers (straight from XAPI only).
  PoolHaPlanExistsFor = "xcp_ng.pool.ha.plan_exists_for",
  /*
   * For each VM in a scheduled backup job: 1 while it has had no successful
   * backup within its jobs' interval and grace (XcpNgBackupSchedule), else 0.
   */
  VmBackupOverdue = "xcp_ng.vm.backup_overdue",
  // How many patches a host misses, as Xen Orchestra last listed them.
  HostMissingPatches = "xcp_ng.host.missing_patches",
}

// The OTLP scope the derived series are appended under.
export const XCP_NG_DERIVED_SERIES_SCOPE_NAME: string =
  "oneuptime.xcp-ng.health";

// How long a VM's last Running reading makes its stop worth an alert.
export const XCP_NG_VM_RAN_RECENTLY_HOURS: number = 24;

export enum XcpNgHostPowerState {
  Running = "Running",
  Halted = "Halted",
  Unknown = "Unknown",
}

export enum XcpNgVmPowerState {
  Running = "Running",
  Halted = "Halted",
  Paused = "Paused",
  Suspended = "Suspended",
}

const SCOPE_BY_PREFIX: ReadonlyArray<{ prefix: string; scope: XcpNgScope }> = [
  { prefix: "xcp_pool_", scope: XcpNgScope.Pool },
  { prefix: "xcp_host_", scope: XcpNgScope.Host },
  { prefix: "xcp_vm_", scope: XcpNgScope.VM },
  { prefix: "xcp_sr_", scope: XcpNgScope.StorageRepository },
  { prefix: "xcp_vdi_", scope: XcpNgScope.VDI },
  { prefix: "xcp_xostor_", scope: XcpNgScope.Xostor },
  { prefix: "xcp_ng.pool.", scope: XcpNgScope.Pool },
  { prefix: "xcp_ng.host.", scope: XcpNgScope.Host },
  { prefix: "xcp_ng.vm.", scope: XcpNgScope.VM },
];

export class XcpNgTelemetryUtil {
  /*
   * The kind of object a series of Xen Orchestra's (or one OneUptime
   * derives) describes, from its name alone. Null for a name that is not
   * an XCP-ng series.
   */
  public static getScopeOfSeries(
    metricName: string | null | undefined,
  ): XcpNgScope | null {
    if (!metricName) {
      return null;
    }
    for (const entry of SCOPE_BY_PREFIX) {
      if (metricName.startsWith(entry.prefix)) {
        return entry.scope;
      }
    }
    return null;
  }

  /*
   * The label that carries the UUID of the object a series of this scope
   * describes. A pool's own series name it in their resource, not a label.
   */
  public static getIdLabelOfScope(scope: XcpNgScope): string | null {
    switch (scope) {
      case XcpNgScope.Host:
      case XcpNgScope.VM:
        return XcpNgLabel.Uuid;
      case XcpNgScope.StorageRepository:
      case XcpNgScope.Xostor:
        return XcpNgLabel.SrUuid;
      case XcpNgScope.VDI:
        return XcpNgLabel.VdiUuid;
      case XcpNgScope.Pool:
        return null;
    }
  }

  public static isRateTypedAsCounter(
    metricName: string | null | undefined,
  ): boolean {
    return (
      Boolean(metricName) &&
      XCP_NG_RATE_TYPED_AS_COUNTER_SERIES.includes(metricName as string)
    );
  }

  /*
   * A pool's identity as OneUptime keys it: XAPI UUIDs are lower-case hex,
   * so a value is trimmed and lower-cased before it is compared or stored.
   */
  public static normalizePoolIdentifier(
    value: string | null | undefined,
  ): string {
    return (value || "").trim().toLowerCase();
  }

  /*
   * The name a pool is given when it is first seen. XAPI lets a pool's
   * name_label be empty (a pool made by joining hosts often has none), and
   * Xen Orchestra then reports pool_name as empty, so the pool is named
   * after the start of its UUID until someone names it.
   */
  public static getDefaultPoolName(data: {
    poolName: string | null | undefined;
    poolIdentifier: string;
  }): string {
    const name: string = (data.poolName || "").trim();
    if (name) {
      return name;
    }
    return `Pool ${XcpNgTelemetryUtil.getShortIdentifier(data.poolIdentifier)}`;
  }

  // The first block of a UUID: enough to tell two pools apart on a page.
  public static getShortIdentifier(identifier: string): string {
    const normalized: string =
      XcpNgTelemetryUtil.normalizePoolIdentifier(identifier);
    const firstBlock: string = normalized.split("-")[0] || normalized;
    return firstBlock.slice(0, 8);
  }
}
