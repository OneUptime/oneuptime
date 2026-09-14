import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { formatBytes, formatMhz } from "../Utils/VMwareResourceUtils";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ValueFormatter from "Common/Utils/ValueFormatter";

/*
 * Curated MetricView presets sharing one time-range state — explicitly
 * NOT computed recommendations (Pages/Kubernetes/View/Insights.tsx
 * precedent). Unlike Proxmox there is no scope attribute to filter on:
 * the vcenter receiver emits a distinct metric name per object level
 * (vcenter.host.*, vcenter.vm.*, vcenter.datastore.*, vcenter.cluster.*,
 * vcenter.resource_pool.*) and keys identity in resource attributes, so
 * each section simply picks the metric names of its level and groups by
 * attributes to get one line per object. Utilization metrics are already
 * percentages and throughput metrics are gauges — no ×100 and no
 * counter-rate transforms anywhere on this page.
 */

const MIB: number = 1024 * 1024;
const KIB: number = 1024;

interface MetricSpec {
  variable: string;
  title: string;
  description: string;
  legend: string;
  legendUnit: string;
  metricName: string;
  aggregation: AggregationType;
  /* Extra datapoint-attribute equality filters (e.g. disk_state=used). */
  attributes?: Record<string, string> | undefined;
  yAxisFormatter?: (value: number) => string;
  transformValue?: ((value: number) => number) | undefined;
}

function buildQuery(
  spec: MetricSpec,
  vcenterName: string,
): MetricQueryConfigData {
  const attributes: Record<string, string> = {
    "resource.vmware.vcenter.name": vcenterName,
    ...(spec.attributes || {}),
  };
  return {
    metricAliasData: {
      metricVariable: spec.variable,
      title: spec.title,
      description: spec.description,
      legend: spec.legend,
      legendUnit: spec.legendUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: spec.metricName,
        attributes: attributes,
        aggegationType: spec.aggregation,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: spec.yAxisFormatter,
    transformValue: spec.transformValue,
  };
}

function getSectionTitle(icon: IconProp, title: string): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Icon icon={icon} className="h-5 w-5 text-gray-500" />
      <span>{title}</span>
    </div>
  );
}

const mibToBytes: (value: number) => number = (value: number): number => {
  return value * MIB;
};

const kibPerSecToBytesPerSec: (value: number) => number = (
  value: number,
): number => {
  return value * KIB;
};

const formatBytesPerSec: (value: number) => string = (
  value: number,
): string => {
  return ValueFormatter.formatValue(value, "By/s");
};

function getHostQueries(vcenter: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "host_cpu_utilization",
        title: "Host CPU Utilization",
        description:
          "vcenter.host.cpu.utilization, one line per ESXi host — already a percentage.",
        legend: "CPU",
        legendUnit: "%",
        metricName: "vcenter.host.cpu.utilization",
        aggregation: AggregationType.Avg,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "host_memory_utilization",
        title: "Host Memory Utilization",
        description:
          "vcenter.host.memory.utilization, one line per ESXi host — already a percentage.",
        legend: "Memory",
        legendUnit: "%",
        metricName: "vcenter.host.memory.utilization",
        aggregation: AggregationType.Avg,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "host_memory_usage",
        title: "Host Memory Usage",
        description:
          "vcenter.host.memory.usage per ESXi host (reported in MiB, shown in bytes).",
        legend: "Memory",
        legendUnit: "",
        metricName: "vcenter.host.memory.usage",
        aggregation: AggregationType.Avg,
        transformValue: mibToBytes,
        yAxisFormatter: formatBytes,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "host_disk_latency_max",
        title: "Host Disk Latency (max)",
        description:
          "vcenter.host.disk.latency.max per ESXi host and disk. Sustained values above ~20-50 ms indicate storage contention.",
        legend: "Latency",
        legendUnit: "ms",
        metricName: "vcenter.host.disk.latency.max",
        aggregation: AggregationType.Max,
      },
      vcenter,
    ),
  ];
}

function getVirtualMachineQueries(
  vcenter: string,
): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "vm_cpu_utilization",
        title: "VM CPU Utilization",
        description:
          "vcenter.vm.cpu.utilization, one line per powered-on VM — already a percentage of the VM's configured vCPUs.",
        legend: "VM CPU",
        legendUnit: "%",
        metricName: "vcenter.vm.cpu.utilization",
        aggregation: AggregationType.Avg,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "vm_cpu_readiness",
        title: "VM CPU Ready",
        description:
          "vcenter.vm.cpu.readiness per powered-on VM — time spent waiting for a physical CPU. Above ~10% the host is contended.",
        legend: "CPU Ready",
        legendUnit: "%",
        metricName: "vcenter.vm.cpu.readiness",
        aggregation: AggregationType.Avg,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "vm_memory_utilization",
        title: "VM Memory Utilization",
        description:
          "vcenter.vm.memory.utilization per VM — already a percentage of configured memory.",
        legend: "VM Memory",
        legendUnit: "%",
        metricName: "vcenter.vm.memory.utilization",
        aggregation: AggregationType.Avg,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "vm_memory_ballooned",
        title: "VM Memory Ballooned",
        description:
          "vcenter.vm.memory.ballooned per VM (MiB → bytes). Anything above zero means the host is reclaiming guest memory.",
        legend: "Ballooned",
        legendUnit: "",
        metricName: "vcenter.vm.memory.ballooned",
        aggregation: AggregationType.Max,
        transformValue: mibToBytes,
        yAxisFormatter: formatBytes,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "vm_memory_swapped",
        title: "VM Memory Swapped",
        description:
          "vcenter.vm.memory.swapped per VM (MiB → bytes). Any hypervisor swapping is a serious performance problem.",
        legend: "Swapped",
        legendUnit: "",
        metricName: "vcenter.vm.memory.swapped",
        aggregation: AggregationType.Max,
        transformValue: mibToBytes,
        yAxisFormatter: formatBytes,
      },
      vcenter,
    ),
  ];
}

function getDatastoreQueries(vcenter: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "datastore_utilization",
        title: "Datastore Utilization",
        description:
          "vcenter.datastore.disk.utilization, one line per datastore — already a percentage.",
        legend: "Used",
        legendUnit: "%",
        metricName: "vcenter.datastore.disk.utilization",
        aggregation: AggregationType.Avg,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "datastore_used",
        title: "Datastore Used Space",
        description:
          "vcenter.datastore.disk.usage{disk_state=used}, one line per datastore.",
        legend: "Used",
        legendUnit: "",
        metricName: "vcenter.datastore.disk.usage",
        aggregation: AggregationType.Avg,
        attributes: { disk_state: "used" },
        yAxisFormatter: formatBytes,
      },
      vcenter,
    ),
  ];
}

function getNetworkQueries(vcenter: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "host_network_throughput",
        title: "Host Network Throughput",
        description:
          "vcenter.host.network.throughput per ESXi host, direction and NIC (KiB/s → B/s). A gauge from the receiver — no counter-rate math.",
        legend: "Network",
        legendUnit: "",
        metricName: "vcenter.host.network.throughput",
        aggregation: AggregationType.Avg,
        transformValue: kibPerSecToBytesPerSec,
        yAxisFormatter: formatBytesPerSec,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "host_network_packet_errors",
        title: "Host NIC Packet Errors",
        description:
          "vcenter.host.network.packet.error.rate per ESXi host — anything above zero points at a bad NIC, cable or switch port.",
        legend: "Errors",
        legendUnit: "/s",
        metricName: "vcenter.host.network.packet.error.rate",
        aggregation: AggregationType.Max,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "host_network_packet_drops",
        title: "Host NIC Packet Drops",
        description: "vcenter.host.network.packet.drop.rate per ESXi host.",
        legend: "Drops",
        legendUnit: "/s",
        metricName: "vcenter.host.network.packet.drop.rate",
        aggregation: AggregationType.Max,
      },
      vcenter,
    ),
  ];
}

function getClusterQueries(vcenter: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "cluster_host_count",
        title: "Cluster Hosts by Effectiveness",
        description:
          "vcenter.cluster.host.count per cluster, split by the effective attribute — a host in maintenance mode or disconnected is not effective.",
        legend: "Hosts",
        legendUnit: "",
        metricName: "vcenter.cluster.host.count",
        aggregation: AggregationType.Max,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "cluster_vm_count",
        title: "Cluster VMs by Power State",
        description:
          "vcenter.cluster.vm.count per cluster, split by power_state.",
        legend: "VMs",
        legendUnit: "",
        metricName: "vcenter.cluster.vm.count",
        aggregation: AggregationType.Max,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "cluster_cpu_effective",
        title: "Cluster Effective CPU",
        description:
          "vcenter.cluster.cpu.effective per cluster — capacity DRS/HA can actually schedule.",
        legend: "Effective CPU",
        legendUnit: "MHz",
        metricName: "vcenter.cluster.cpu.effective",
        aggregation: AggregationType.Max,
        yAxisFormatter: formatMhz,
      },
      vcenter,
    ),
  ];
}

function getResourcePoolQueries(vcenter: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "resource_pool_cpu",
        title: "Resource Pool CPU Usage",
        description:
          "vcenter.resource_pool.cpu.usage, one line per resource pool.",
        legend: "CPU",
        legendUnit: "MHz",
        metricName: "vcenter.resource_pool.cpu.usage",
        aggregation: AggregationType.Avg,
        yAxisFormatter: formatMhz,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "resource_pool_memory",
        title: "Resource Pool Memory Usage",
        description:
          "vcenter.resource_pool.memory.usage per resource pool and memory type (MiB → bytes).",
        legend: "Memory",
        legendUnit: "",
        metricName: "vcenter.resource_pool.memory.usage",
        aggregation: AggregationType.Avg,
        transformValue: mibToBytes,
        yAxisFormatter: formatBytes,
      },
      vcenter,
    ),
  ];
}

function getVsanQueries(vcenter: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "vsan_latency",
        title: "vSAN Latency (avg)",
        description:
          "vcenter.cluster.vsan.latency.avg per cluster and operation type. Empty unless a cluster has vSAN enabled.",
        legend: "Latency",
        legendUnit: "µs",
        metricName: "vcenter.cluster.vsan.latency.avg",
        aggregation: AggregationType.Avg,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "vsan_throughput",
        title: "vSAN Throughput",
        description:
          "vcenter.cluster.vsan.throughput per cluster and operation type (B/s).",
        legend: "Throughput",
        legendUnit: "",
        metricName: "vcenter.cluster.vsan.throughput",
        aggregation: AggregationType.Avg,
        yAxisFormatter: formatBytesPerSec,
      },
      vcenter,
    ),
    buildQuery(
      {
        variable: "vsan_congestions",
        title: "vSAN Congestions",
        description:
          "vcenter.cluster.vsan.congestions per cluster — anything above zero means vSAN is throttling I/O.",
        legend: "Congestions",
        legendUnit: "/s",
        metricName: "vcenter.cluster.vsan.congestions",
        aggregation: AggregationType.Max,
      },
      vcenter,
    ),
  ];
}

const VMwareVCenterInsights: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [vcenter, setVCenter] = useState<VMwareVCenter | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const [startAndEndDate, setStartAndEndDate] = useState<InBetween<Date>>(
    RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
  );

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
    setStartAndEndDate(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange),
    );
  }, []);

  const fetchVCenter: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: VMwareVCenter | null = await ModelAPI.getItem({
        modelType: VMwareVCenter,
        id: modelId,
        select: {
          name: true,
        },
      });
      setVCenter(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchVCenter().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!vcenter?.name) {
    return <ErrorMessage message="vCenter not found." />;
  }

  const vcenterName: string = vcenter.name;

  return (
    <Fragment>
      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.ServerStack, "Hosts")}
        description="CPU, memory and disk latency across every ESXi host managed by this vCenter."
        queryConfigs={getHostQueries(vcenterName)}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
      />

      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.Cube, "Virtual Machines")}
        description="CPU, CPU ready, memory, ballooning and swapping across all virtual machines. CPU series exist only for powered-on VMs."
        queryConfigs={getVirtualMachineQueries(vcenterName)}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
      />

      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.Database, "Datastores")}
        description="Utilization and used space per datastore."
        queryConfigs={getDatastoreQueries(vcenterName)}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
      />

      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.Signal, "Network")}
        description="ESXi host network throughput, NIC packet errors and drops."
        queryConfigs={getNetworkQueries(vcenterName)}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
      />

      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.SquareStack, "Clusters")}
        description="Host effectiveness, VM power states and effective CPU capacity per vSphere cluster. Empty for a standalone ESXi host."
        queryConfigs={getClusterQueries(vcenterName)}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
      />

      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.Layers, "Resource Pools")}
        description="CPU and memory consumption per resource pool."
        queryConfigs={getResourcePoolQueries(vcenterName)}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
      />

      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.CPUChip, "vSAN")}
        description="vSAN latency, throughput and congestions per cluster. Charts are empty when no cluster in this vCenter runs vSAN."
        queryConfigs={getVsanQueries(vcenterName)}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
      />
    </Fragment>
  );
};

export default VMwareVCenterInsights;
