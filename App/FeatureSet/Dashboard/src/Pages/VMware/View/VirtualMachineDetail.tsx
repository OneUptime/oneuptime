import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import Card from "Common/UI/Components/Card/Card";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourceOverviewTab, {
  SummaryField,
} from "../../../Components/Infrastructure/ResourceOverviewTab";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  VMwareResourceKind,
  externalIdFromRouteParam,
  fetchVMwareInventoryRow,
  formatBytes,
  formatMhz,
  formatPercent,
  displayNameForResource,
  identityAttributesForResource,
  powerStateLabelForVM,
} from "../Utils/VMwareResourceUtils";
import OneUptimeDate from "Common/Types/Date";
import ValueFormatter from "Common/Utils/ValueFormatter";

const MIB: number = 1024 * 1024;
const KIB: number = 1024;

const VMwareVCenterVirtualMachineDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../vmware/:modelId/virtual-machines/:subModelId —
   * subModelId is the percent-encoded inventory externalId
   * ("vm/<instance-uuid>"), not a DB id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [vcenter, setVCenter] = useState<VMwareVCenter | null>(null);
  const [row, setRow] = useState<VMwareResourceModel | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
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

    try {
      const inventoryRow: VMwareResourceModel | null =
        await fetchVMwareInventoryRow({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.VirtualMachine,
          externalId: externalId,
        });
      setRow(inventoryRow);
    } catch {
      // Graceful degradation — overview tab shows its empty state.
    }
    setIsLoadingRow(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
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
  const vmName: string = row
    ? displayNameForResource(row)
    : externalId.substring(externalId.lastIndexOf("/") + 1);
  const isTemplate: boolean = row?.isTemplate === true;

  /*
   * Charts filter on the VM's RESOURCE identity: resource.vcenter.vm.id
   * (the instance UUID — stable across renames and vMotion) or, for a
   * template, resource.vcenter.vm_template.id. Before the inventory row
   * lands, fall back to the id parsed from the externalId ("vm/<uuid>").
   */
  const idAttributes: Record<string, string> = row
    ? identityAttributesForResource(vcenterName, row)
    : {
        "resource.vmware.vcenter.name": vcenterName,
        "resource.vcenter.vm.id": externalId.replace(/^vm\//, ""),
      };

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "vm_cpu",
      title: "CPU Utilization",
      description: `vcenter.vm.cpu.utilization for ${vmName} — already a percentage of the VM's configured vCPUs. Reported only while the VM is powered on.`,
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.vm.cpu.utilization",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const cpuReadinessQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "vm_cpu_readiness",
      title: "CPU Ready",
      description: `vcenter.vm.cpu.readiness for ${vmName} — percentage of time the VM was ready to run but waited for a physical CPU. Sustained values above ~10% mean the host is CPU-contended.`,
      legend: "CPU Ready",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.vm.cpu.readiness",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const memoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "vm_memory",
      title: "Memory Usage",
      description: `vcenter.vm.memory.usage for ${vmName} (reported in MiB, shown in bytes).`,
      legend: "Memory",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.vm.memory.usage",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    transformValue: (value: number): number => {
      return value * MIB;
    },
    yAxisValueFormatter: formatBytes,
  };

  const balloonedQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "vm_memory_ballooned",
      title: "Memory Ballooned",
      description: `vcenter.vm.memory.ballooned for ${vmName} — memory the balloon driver reclaimed from the guest. Anything above zero means the host is under memory pressure.`,
      legend: "Ballooned",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.vm.memory.ballooned",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    transformValue: (value: number): number => {
      return value * MIB;
    },
    yAxisValueFormatter: formatBytes,
  };

  const swappedQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "vm_memory_swapped",
      title: "Memory Swapped",
      description: `vcenter.vm.memory.swapped for ${vmName} — guest memory the hypervisor swapped to disk. Any swapping is a serious performance problem.`,
      legend: "Swapped",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.vm.memory.swapped",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    transformValue: (value: number): number => {
      return value * MIB;
    },
    yAxisValueFormatter: formatBytes,
  };

  const diskUsageQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "vm_disk_usage",
      title: "Disk Usage",
      description: `vcenter.vm.disk.usage{disk_state=used} for ${vmName} — space consumed on its datastores.`,
      legend: "Used",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.vm.disk.usage",
        attributes: { ...idAttributes, disk_state: "used" },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatBytes,
  };

  const diskUtilizationQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "vm_disk_utilization",
      title: "Disk Utilization",
      description: `vcenter.vm.disk.utilization for ${vmName} — already a percentage.`,
      legend: "Disk",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.vm.disk.utilization",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  /*
   * vm.network.throughput is reported in By/s and vm.disk.throughput in
   * KiBy/s — both are gauges already (no counter-delta math), split per
   * `direction` and per vNIC / virtual disk `object` by the group-by.
   */
  const networkQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "vm_network",
      title: "Network Throughput",
      description: `vcenter.vm.network.throughput per direction and vNIC for ${vmName}.`,
      legend: "Network",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.vm.network.throughput",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: (value: number): string => {
      return ValueFormatter.formatValue(value, "By/s");
    },
  };

  const diskThroughputQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "vm_disk_throughput",
      title: "Disk Throughput",
      description: `vcenter.vm.disk.throughput per direction and virtual disk for ${vmName}.`,
      legend: "Disk I/O",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.vm.disk.throughput",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    transformValue: (value: number): number => {
      return value * KIB;
    },
    yAxisValueFormatter: (value: number): string => {
      return ValueFormatter.formatValue(value, "By/s");
    },
  };

  const diskLatencyQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "vm_disk_latency",
      title: "Disk Latency (max)",
      description: `vcenter.vm.disk.latency.max per virtual disk for ${vmName}.`,
      legend: "Latency",
      legendUnit: "ms",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.vm.disk.latency.max",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  // Build overview summary fields from the inventory row.
  const summaryFields: Array<SummaryField> = [
    { title: "VM Name", value: vmName },
    { title: "vCenter", value: vcenterName },
  ];

  if (row) {
    const powerState: string = powerStateLabelForVM(row);
    if (powerState) {
      summaryFields.push({
        title: isTemplate ? "Type" : "Power State",
        value: (
          <StatusBadge
            text={powerState}
            type={
              isTemplate
                ? StatusBadgeType.Neutral
                : row.isPoweredOn
                  ? StatusBadgeType.Success
                  : StatusBadgeType.Warning
            }
          />
        ),
      });
    }

    if (row.vmInstanceUuid) {
      summaryFields.push({
        title: "Instance UUID",
        value: row.vmInstanceUuid,
      });
    }
    if (row.hostName) {
      summaryFields.push({ title: "Host", value: row.hostName });
    }
    if (row.clusterName) {
      summaryFields.push({ title: "Cluster", value: row.clusterName });
    }
    if (row.datacenterName) {
      summaryFields.push({ title: "Datacenter", value: row.datacenterName });
    }
    if (row.virtualAppName) {
      summaryFields.push({ title: "vApp", value: row.virtualAppName });
    } else if (row.resourcePoolName) {
      summaryFields.push({
        title: "Resource Pool",
        value: row.resourcePoolPath
          ? `${row.resourcePoolName} (${row.resourcePoolPath})`
          : row.resourcePoolName,
      });
    }

    if (!isTemplate) {
      if (row.latestCpuPercent !== null && row.latestCpuPercent !== undefined) {
        const usage: string =
          row.latestCpuMhz !== null && row.latestCpuMhz !== undefined
            ? ` (${formatMhz(Number(row.latestCpuMhz))})`
            : "";
        summaryFields.push({
          title: "CPU",
          value: `${formatPercent(Number(row.latestCpuPercent))}${usage}`,
        });
      } else if (row.isPoweredOn === false) {
        summaryFields.push({
          title: "CPU",
          value: "N/A — CPU metrics are only reported while powered on",
        });
      }

      if (
        row.cpuReadinessPercent !== null &&
        row.cpuReadinessPercent !== undefined
      ) {
        const readiness: number = Number(row.cpuReadinessPercent);
        summaryFields.push({
          title: "CPU Ready",
          value:
            readiness > 10 ? (
              <StatusBadge
                text={`${formatPercent(readiness)} — CPU contention`}
                type={StatusBadgeType.Warning}
              />
            ) : (
              formatPercent(readiness)
            ),
        });
      }
    }

    if (row.latestMemoryBytes !== null && row.latestMemoryBytes !== undefined) {
      const pct: string =
        row.latestMemoryPercent !== null &&
        row.latestMemoryPercent !== undefined
          ? ` (${formatPercent(Number(row.latestMemoryPercent))})`
          : "";
      summaryFields.push({
        title: "Memory (Used / Configured)",
        value: `${formatBytes(Number(row.latestMemoryBytes))} / ${formatBytes(
          row.maxMemoryBytes !== null && row.maxMemoryBytes !== undefined
            ? Number(row.maxMemoryBytes)
            : null,
        )}${pct}`,
      });
    }

    const ballooned: number =
      row.memoryBalloonedBytes !== null &&
      row.memoryBalloonedBytes !== undefined
        ? Number(row.memoryBalloonedBytes)
        : 0;
    if (ballooned > 0) {
      summaryFields.push({
        title: "Memory Ballooned",
        value: (
          <StatusBadge
            text={formatBytes(ballooned)}
            type={StatusBadgeType.Warning}
          />
        ),
      });
    }
    const swapped: number =
      row.memorySwappedBytes !== null && row.memorySwappedBytes !== undefined
        ? Number(row.memorySwappedBytes)
        : 0;
    if (swapped > 0) {
      summaryFields.push({
        title: "Memory Swapped",
        value: (
          <StatusBadge
            text={formatBytes(swapped)}
            type={StatusBadgeType.Danger}
          />
        ),
      });
    }

    if (row.latestDiskBytes !== null && row.latestDiskBytes !== undefined) {
      const pct: string =
        row.latestDiskPercent !== null && row.latestDiskPercent !== undefined
          ? ` (${formatPercent(Number(row.latestDiskPercent))})`
          : "";
      summaryFields.push({
        title: "Disk (Used / Provisioned)",
        value: `${formatBytes(Number(row.latestDiskBytes))} / ${formatBytes(
          row.maxDiskBytes !== null && row.maxDiskBytes !== undefined
            ? Number(row.maxDiskBytes)
            : null,
        )}${pct}`,
      });
    }

    summaryFields.push({ title: "External ID", value: externalId });

    if (row.metricsUpdatedAt) {
      summaryFields.push({
        title: "Metrics Updated",
        value: OneUptimeDate.fromNow(new Date(row.metricsUpdatedAt as Date)),
      });
    }

    if (row.lastSeenAt) {
      summaryFields.push({
        title: "Last Seen",
        value: OneUptimeDate.fromNow(new Date(row.lastSeenAt as Date)),
      });
    }
  }

  /*
   * A VM template never runs: the receiver emits only
   * vcenter.vm.disk.usage for it, so every other chart would be empty.
   */
  const metricQueries: Array<MetricQueryConfigData> = isTemplate
    ? [diskUsageQuery]
    : [
        cpuQuery,
        cpuReadinessQuery,
        memoryQuery,
        balloonedQuery,
        swappedQuery,
        diskUsageQuery,
        diskUtilizationQuery,
        networkQuery,
        diskThroughputQuery,
        diskLatencyQuery,
      ];

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <ResourceOverviewTab
          summaryFields={row ? summaryFields : []}
          labels={{}}
          annotations={{}}
          isLoading={isLoadingRow}
          emptyMessage="Virtual machine details not reported yet. Make sure the VMware agent is sending metrics."
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`${isTemplate ? "Template" : "VM"} Metrics: ${vmName}`}
          description={
            isTemplate
              ? "Disk usage for this VM template over the selected time range. Templates never run, so no CPU, memory or I/O metrics exist for them."
              : "CPU, CPU ready, memory (incl. ballooning / swapping), disk and network for this virtual machine over the selected time range. CPU and I/O series exist only while the VM is powered on."
          }
        >
          <ResourceMetricsTab queryConfigs={metricQueries} />
        </Card>
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default VMwareVCenterVirtualMachineDetail;
