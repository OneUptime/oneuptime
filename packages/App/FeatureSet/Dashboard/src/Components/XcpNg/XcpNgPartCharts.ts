import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData, {
  ChartSeries,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import {
  XcpNgMetricDefinition,
  getXcpNgMetricById,
} from "Common/Types/Monitor/XcpNgMetricCatalog";
import { XCP_NG_VM_CPU_CONTENTION_THRESHOLD } from "Common/Types/Monitor/XcpNgAlertTemplates";
import {
  XCP_NG_SCOPE_ATTRIBUTE,
  XcpNgLabel,
  XcpNgScope,
} from "Common/Types/XcpNg/XcpNgTelemetry";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  XCP_NG_SR_FULL_PERCENT,
  XCP_NG_SR_NEAR_FULL_PERCENT,
} from "../../Pages/XcpNg/Utils/XcpNgHealth";
import {
  XCP_NG_POOL_RESOURCE_ATTRIBUTE,
  formatXcpNgBytesForChart,
  getXcpNgChartUnit,
  getXcpNgObjectAttributes,
  xcpNgRatioToPercent,
} from "../../Pages/XcpNg/Utils/XcpNgResourceUtils";

/*
 * THE CHARTS OF AN XCP-NG HOST'S, VM'S AND STORAGE REPOSITORY'S METRICS TAB.
 *
 * Every chart is a series of Xen Orchestra's OpenMetrics plugin
 * (XcpNgMetricCatalog, whose unit and aggregation each one keeps), read for
 * one object of the pool: the pool's own series (its UUID, the resource
 * attribute xcp_ng.pool.id), of the object's kind (xcp_ng.scope) and the
 * object itself (xcp_ng.id) - or, for what the pool's hosts read from a
 * storage repository, the host disk series that name it (sr_uuid).
 *
 * A host's network is drawn per physical interface, its disks per storage
 * repository; a VM's network per VIF and its disks per device. Xen
 * Orchestra reports throughput, errors and IOPS as per-second rates already
 * (the eight series it types counter are stored as gauges), so each is
 * drawn as it comes: a rate of a rate would be wrong. A ratio from 0 to 1
 * is drawn as a percent.
 *
 * The words are looked up here, where they are written: a page hands these
 * queries to its chart as they are (ChartWordsInReadersLanguageGuard).
 */

export interface XcpNgPartCharts {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
}

export const XCP_NG_HOST_MEMORY_TOTAL_VARIABLE: string = "host_memory_total";
export const XCP_NG_HOST_MEMORY_FREE_VARIABLE: string = "host_memory_free";
export const XCP_NG_SR_SIZE_VARIABLE: string = "sr_size";
export const XCP_NG_SR_USED_VARIABLE: string = "sr_used";

// Where the High Host Memory Usage alert fires.
const HOST_MEMORY_ALERT_PERCENT: number = 95;

interface ChartSpec {
  // An XcpNgMetricCatalog id: its series, unit and aggregation.
  metricId: string;
  variable: string;
  title: string;
  description: string;
  legend: string;
  attributes: Record<string, string>;
  // The label each line is one of: an interface, a device, a host.
  splitBy?: string | undefined;
  // On the chart before it: one chart, two readings.
  isOverlay?: boolean | undefined;
  aggregation?: MetricsAggregationType | undefined;
  criticalThreshold?: number | undefined;
}

// What a grouped series is called: its value, after the legend's word.
function seriesTitleOf(
  item: AggregatedModel,
  key: string,
  legend: string,
): string {
  const attributes: Record<string, unknown> =
    ((item as unknown as Record<string, unknown>)["attributes"] as
      | Record<string, unknown>
      | undefined) || {};
  const raw: unknown = attributes[key];
  const value: string =
    typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  // Facts set apart, no sentence: "Receive · eth0".
  return value ? `${legend} · ${value}` : legend;
}

function buildQuery(
  spec: ChartSpec,
  translator: Translator,
): MetricQueryConfigData | null {
  const metric: XcpNgMetricDefinition | undefined = getXcpNgMetricById(
    spec.metricId,
  );
  if (!metric) {
    return null;
  }

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const legend: string = tx(spec.legend);
  const isBytes: boolean = metric.unit === "bytes";
  const isRatio: boolean = metric.unit === "ratio";

  const query: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: spec.variable,
      title: tx(spec.title),
      description: tx(spec.description),
      legend: legend,
      // A size is written by the page's own formatter, in binary units.
      legendUnit: isBytes ? "" : getXcpNgChartUnit(metric.unit),
    },
    metricQueryData: {
      filterData: {
        metricName: metric.metricName,
        attributes: { ...spec.attributes },
        aggegationType: spec.aggregation || metric.defaultAggregation,
        aggregateBy: {},
      },
      ...(spec.splitBy ? { groupByAttributeKeys: [spec.splitBy] } : {}),
    },
  };

  if (spec.splitBy) {
    const splitBy: string = spec.splitBy;
    query.getSeries = (item: AggregatedModel): ChartSeries => {
      return { title: seriesTitleOf(item, splitBy, legend) };
    };
  }
  if (isBytes) {
    query.yAxisValueFormatter = formatXcpNgBytesForChart;
  }
  if (isRatio) {
    query.transformValue = xcpNgRatioToPercent;
  }
  if (spec.isOverlay) {
    query.overlayWithPreviousQuery = true;
  }
  if (spec.criticalThreshold !== undefined) {
    query.criticalThreshold = spec.criticalThreshold;
  }
  return query;
}

function buildQueries(
  specs: Array<ChartSpec>,
  translator: Translator,
): Array<MetricQueryConfigData> {
  const queries: Array<MetricQueryConfigData> = [];
  for (const spec of specs) {
    const query: MetricQueryConfigData | null = buildQuery(spec, translator);
    if (query) {
      queries.push(query);
    }
  }
  return queries;
}

/*
 * A host: its CPU, its load, its memory (its total with what is free on the
 * same chart, the gap between them what is in use, and that share), its
 * network per physical interface, its disks per storage repository (the
 * I/O it does, how fast, and how long each request waits), and its power
 * draw.
 */
export function getXcpNgHostCharts(data: {
  poolIdentifier: string;
  hostExternalId: string;
  translator: Translator;
}): XcpNgPartCharts {
  const translator: Translator = data.translator;
  const host: Record<string, string> = getXcpNgObjectAttributes({
    poolIdentifier: data.poolIdentifier,
    scope: XcpNgScope.Host,
    externalId: data.hostExternalId,
  });

  const queryConfigs: Array<MetricQueryConfigData> = buildQueries(
    [
      {
        metricId: "xcp-host-cpu-average",
        variable: "host_cpu",
        title: "CPU Usage",
        description: "This host's CPU use, averaged over its CPU threads.",
        legend: "CPU",
        attributes: host,
      },
      {
        metricId: "xcp-host-load",
        variable: "host_load",
        title: "Load",
        description:
          "The vCPUs running or waiting to run on this host, per physical CPU. Above 1, its VMs wait for a CPU.",
        legend: "Load",
        attributes: host,
      },
      {
        metricId: "xcp-host-memory-total-bytes",
        variable: XCP_NG_HOST_MEMORY_TOTAL_VARIABLE,
        title: "Memory Total and Free",
        description:
          "This host's memory, and how much of it is free: the gap between the two lines is what is in use, its VMs' memory included.",
        legend: "Total memory",
        attributes: host,
      },
      {
        metricId: "xcp-host-memory-free-bytes",
        variable: XCP_NG_HOST_MEMORY_FREE_VARIABLE,
        title: "Free memory",
        description: "How much of this host's memory is free.",
        legend: "Free memory",
        attributes: host,
        isOverlay: true,
      },
      {
        metricId: "xcp-host-network-receive-bytes-total",
        variable: "host_network_receive",
        title: "Network Throughput",
        description:
          "Bytes per second this host receives and sends on each physical interface, as Xen Orchestra reports them.",
        legend: "Receive",
        attributes: host,
        splitBy: XcpNgLabel.Interface,
      },
      {
        metricId: "xcp-host-network-transmit-bytes-total",
        variable: "host_network_transmit",
        title: "Network Sent",
        description: "Bytes per second this host sends on each interface.",
        legend: "Transmit",
        attributes: host,
        splitBy: XcpNgLabel.Interface,
        isOverlay: true,
      },
      {
        metricId: "xcp-host-disk-throughput-total-bytes",
        variable: "host_disk_throughput",
        title: "Disk Throughput",
        description:
          "Bytes per second this host reads and writes on each storage repository.",
        legend: "Throughput",
        attributes: host,
        splitBy: XcpNgLabel.SrName,
      },
      {
        metricId: "xcp-host-disk-iops-total",
        variable: "host_disk_iops",
        title: "Disk IOPS",
        description:
          "Read and write operations per second this host does on each storage repository.",
        legend: "IOPS",
        attributes: host,
        splitBy: XcpNgLabel.SrName,
      },
      {
        metricId: "xcp-host-disk-latency-seconds",
        variable: "host_disk_latency",
        title: "Disk Latency",
        description:
          "How long a request of this host to each storage repository takes, on average.",
        legend: "Latency",
        attributes: host,
        splitBy: XcpNgLabel.SrName,
      },
      {
        /*
         * Xen Orchestra reads a host's power from its sensor apart from the
         * pool's series, with no pool_id: the host's UUID alone names it.
         */
        metricId: "xcp-host-power-consumption-watts",
        variable: "host_power",
        title: "Power",
        description:
          "This host's power draw, from its power sensor. A host without one reports none.",
        legend: "Power",
        attributes: { [XcpNgLabel.Uuid]: data.hostExternalId },
      },
    ],
    translator,
  );

  const formulaConfigs: Array<MetricFormulaConfigData> = [
    {
      metricAliasData: {
        metricVariable: "host_memory_used_percent",
        title: translator.translateText("Memory Used (%)"),
        description: translator.translateText(
          "How much of this host's memory is in use, as a share of its total. The High Host Memory Usage alert fires above 95%.",
        ),
        legend: translator.translateText("Used"),
        legendUnit: "%",
      },
      metricFormulaData: {
        metricFormula: `((${XCP_NG_HOST_MEMORY_TOTAL_VARIABLE} - ${XCP_NG_HOST_MEMORY_FREE_VARIABLE}) / ${XCP_NG_HOST_MEMORY_TOTAL_VARIABLE}) * 100`,
      },
      criticalThreshold: HOST_MEMORY_ALERT_PERCENT,
    },
  ];

  return { queryConfigs: queryConfigs, formulaConfigs: formulaConfigs };
}

/*
 * A VM: its CPU and the share of time it waited for one (a VM starved by
 * its neighbours), its memory (what it was given, with what its guest has
 * free when its guest tools say), its network per VIF with its errors, and
 * its disks per device.
 */
export function getXcpNgVmCharts(data: {
  poolIdentifier: string;
  vmExternalId: string;
  translator: Translator;
}): XcpNgPartCharts {
  const vm: Record<string, string> = getXcpNgObjectAttributes({
    poolIdentifier: data.poolIdentifier,
    scope: XcpNgScope.VM,
    externalId: data.vmExternalId,
  });

  const queryConfigs: Array<MetricQueryConfigData> = buildQueries(
    [
      {
        metricId: "xcp-vm-cpu-usage",
        variable: "vm_cpu",
        title: "CPU Usage",
        description: "This VM's CPU use, averaged over its vCPUs.",
        legend: "CPU",
        attributes: vm,
      },
      {
        metricId: "xcp-vm-runstate-full-contention",
        variable: "vm_cpu_contention",
        title: "CPU Contention",
        description:
          "The share of time all of this VM's vCPUs were ready to run but waited for a physical CPU. The VM Starved of CPU alert fires above 10%.",
        legend: "Waiting for a CPU",
        attributes: vm,
        criticalThreshold: XCP_NG_VM_CPU_CONTENTION_THRESHOLD * 100,
      },
      {
        metricId: "xcp-vm-memory-bytes",
        variable: "vm_memory_given",
        title: "Memory Given and Free",
        description:
          "The memory this VM was given and, while its guest tools run, how much of it its guest has free: the gap between the two lines is what it uses.",
        legend: "Given",
        attributes: vm,
      },
      {
        metricId: "xcp-vm-memory-internal-free-bytes",
        variable: "vm_memory_free",
        title: "Free memory",
        description:
          "How much memory this VM's guest has free, as its guest tools report it.",
        legend: "Free memory",
        attributes: vm,
        isOverlay: true,
      },
      {
        metricId: "xcp-vm-network-receive-bytes-total",
        variable: "vm_network_receive",
        title: "Network Throughput",
        description:
          "Bytes per second this VM receives and sends on each of its virtual interfaces (VIFs).",
        legend: "Receive",
        attributes: vm,
        splitBy: XcpNgLabel.Vif,
      },
      {
        metricId: "xcp-vm-network-transmit-bytes-total",
        variable: "vm_network_transmit",
        title: "Network Sent",
        description: "Bytes per second this VM sends on each VIF.",
        legend: "Transmit",
        attributes: vm,
        splitBy: XcpNgLabel.Vif,
        isOverlay: true,
      },
      {
        metricId: "xcp-vm-network-receive-errors-total",
        variable: "vm_network_receive_errors",
        title: "Network Errors",
        description:
          "Receive and transmit errors per second on each of this VM's virtual interfaces.",
        legend: "Receive errors",
        attributes: vm,
        splitBy: XcpNgLabel.Vif,
      },
      {
        metricId: "xcp-vm-network-transmit-errors-total",
        variable: "vm_network_transmit_errors",
        title: "Network Transmit Errors",
        description: "Transmit errors per second on each VIF.",
        legend: "Transmit errors",
        attributes: vm,
        splitBy: XcpNgLabel.Vif,
        isOverlay: true,
      },
      {
        metricId: "xcp-vm-disk-read-bytes-total",
        variable: "vm_disk_read",
        title: "Disk Throughput",
        description:
          "Bytes per second this VM reads and writes on each of its disks.",
        legend: "Read",
        attributes: vm,
        splitBy: XcpNgLabel.Device,
      },
      {
        metricId: "xcp-vm-disk-write-bytes-total",
        variable: "vm_disk_write",
        title: "Disk Write",
        description: "Bytes per second this VM writes on each disk.",
        legend: "Write",
        attributes: vm,
        splitBy: XcpNgLabel.Device,
        isOverlay: true,
      },
      {
        metricId: "xcp-vm-disk-iops-total",
        variable: "vm_disk_iops",
        title: "Disk IOPS",
        description:
          "Read and write operations per second on each of this VM's disks.",
        legend: "IOPS",
        attributes: vm,
        splitBy: XcpNgLabel.Device,
      },
      {
        metricId: "xcp-vm-disk-latency-seconds",
        variable: "vm_disk_latency",
        title: "Disk Latency",
        description:
          "How long a request to each of this VM's disks takes, on average.",
        legend: "Latency",
        attributes: vm,
        splitBy: XcpNgLabel.Device,
      },
    ],
    data.translator,
  );

  return { queryConfigs: queryConfigs, formulaConfigs: [] };
}

/*
 * A storage repository: its size, what is used on it and what is allocated
 * on it (the virtual size of its disks) on one chart, how full it is
 * against the lines its alert and Needs attention read, and what the pool's
 * hosts see of it - how long their requests to it take, and how much they
 * read and write - one line per host.
 */
export function getXcpNgStorageCharts(data: {
  poolIdentifier: string;
  storageRepositoryExternalId: string;
  translator: Translator;
}): XcpNgPartCharts {
  const translator: Translator = data.translator;
  const repository: Record<string, string> = getXcpNgObjectAttributes({
    poolIdentifier: data.poolIdentifier,
    scope: XcpNgScope.StorageRepository,
    externalId: data.storageRepositoryExternalId,
  });
  // The host disk series that name this repository: every host's I/O to it.
  const hostsToIt: Record<string, string> = {
    [XCP_NG_POOL_RESOURCE_ATTRIBUTE]: data.poolIdentifier,
    [XCP_NG_SCOPE_ATTRIBUTE]: XcpNgScope.Host,
    [XcpNgLabel.SrUuid]: data.storageRepositoryExternalId,
  };

  const queryConfigs: Array<MetricQueryConfigData> = buildQueries(
    [
      {
        metricId: "xcp-sr-physical-size-bytes",
        variable: XCP_NG_SR_SIZE_VARIABLE,
        title: "Size, Used and Allocated",
        description:
          "This storage repository's size, the space used on it, and the virtual size of every disk on it added up. Allocated above its size means its disks can fill it as they grow.",
        legend: "Size",
        attributes: repository,
      },
      {
        metricId: "xcp-sr-physical-usage-bytes",
        variable: XCP_NG_SR_USED_VARIABLE,
        title: "Used",
        description: "The space used on this storage repository.",
        legend: "Used",
        attributes: repository,
        isOverlay: true,
      },
      {
        metricId: "xcp-sr-virtual-size-bytes",
        variable: "sr_allocated",
        title: "Allocated",
        description: "The virtual size of every disk on it, added up.",
        legend: "Allocated",
        attributes: repository,
        isOverlay: true,
      },
      {
        metricId: "xcp-host-disk-latency-seconds",
        variable: "sr_host_latency",
        title: "Latency by Host",
        description:
          "How long each host's requests to this storage repository take, on average. A slow repository slows every VM with a disk on it.",
        legend: "Latency",
        attributes: hostsToIt,
        splitBy: XcpNgLabel.HostName,
      },
      {
        metricId: "xcp-host-disk-iops-total",
        variable: "sr_host_iops",
        title: "IOPS by Host",
        description:
          "Read and write operations per second each host does on this storage repository.",
        legend: "IOPS",
        attributes: hostsToIt,
        splitBy: XcpNgLabel.HostName,
      },
      {
        metricId: "xcp-host-disk-throughput-total-bytes",
        variable: "sr_host_throughput",
        title: "Throughput by Host",
        description:
          "Bytes per second each host reads and writes on this storage repository.",
        legend: "Throughput",
        attributes: hostsToIt,
        splitBy: XcpNgLabel.HostName,
      },
    ],
    translator,
  );

  const formulaConfigs: Array<MetricFormulaConfigData> = [
    {
      metricAliasData: {
        metricVariable: "sr_used_percent",
        title: translator.translateText("Used (%)"),
        description: translator.translateText(
          "How much of this storage repository is used, as a share of its size. Its alert fires above 90%; above 95%, VMs with disks on it soon stop writing.",
        ),
        legend: translator.translateText("Used"),
        legendUnit: "%",
      },
      metricFormulaData: {
        metricFormula: `(${XCP_NG_SR_USED_VARIABLE} / ${XCP_NG_SR_SIZE_VARIABLE}) * 100`,
      },
      warningThreshold: XCP_NG_SR_NEAR_FULL_PERCENT,
      criticalThreshold: XCP_NG_SR_FULL_PERCENT,
    },
  ];

  return { queryConfigs: queryConfigs, formulaConfigs: formulaConfigs };
}
