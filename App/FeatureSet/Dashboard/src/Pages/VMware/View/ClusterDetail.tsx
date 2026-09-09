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
  displayNameForResource,
  identityAttributesForResource,
} from "../Utils/VMwareResourceUtils";
import OneUptimeDate from "Common/Types/Date";
import ValueFormatter from "Common/Utils/ValueFormatter";

const VMwareVCenterClusterDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../vmware/:modelId/clusters/:subModelId — subModelId
   * is the percent-encoded inventory externalId
   * ("cluster/<dc>/<cluster>"), not a DB id.
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
          kind: VMwareResourceKind.Cluster,
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
  const clusterName: string = row
    ? displayNameForResource(row)
    : externalId.substring(externalId.lastIndexOf("/") + 1);

  /*
   * Cluster-level series (vcenter.cluster.*) live on the cluster's own
   * resource; the per-host series (vcenter.host.*) of its members carry
   * the same resource.vcenter.cluster.name, so the SAME filter — with
   * a host metric name — yields one line per member host.
   */
  const idAttributes: Record<string, string> = row
    ? identityAttributesForResource(vcenterName, row)
    : {
        "resource.vmware.vcenter.name": vcenterName,
        "resource.vcenter.cluster.name": clusterName,
      };

  const hostCountQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_hosts",
      title: "Hosts (effective vs. not effective)",
      description: `vcenter.cluster.host.count for ${clusterName}, split by the effective attribute — a host in maintenance mode or disconnected counts as not effective.`,
      legend: "Hosts",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.host.count",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const vmCountQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_vms",
      title: "Virtual Machines by Power State",
      description: `vcenter.cluster.vm.count for ${clusterName}, split by power_state.`,
      legend: "VMs",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.vm.count",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const memberHostCpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_host_cpu",
      title: "Member Host CPU Utilization",
      description: `vcenter.host.cpu.utilization for every ESXi host in ${clusterName} — one line per host, already a percentage.`,
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.host.cpu.utilization",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const memberHostMemoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_host_memory",
      title: "Member Host Memory Utilization",
      description: `vcenter.host.memory.utilization for every ESXi host in ${clusterName} — one line per host.`,
      legend: "Memory",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.host.memory.utilization",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const effectiveCpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_cpu_effective",
      title: "Effective CPU",
      description: `vcenter.cluster.cpu.effective for ${clusterName} — CPU capacity DRS/HA can actually schedule (excludes hosts in maintenance).`,
      legend: "Effective CPU",
      legendUnit: "MHz",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.cpu.effective",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatMhz,
  };

  const effectiveMemoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_memory_effective",
      title: "Effective Memory",
      description: `vcenter.cluster.memory.effective for ${clusterName} — memory capacity DRS/HA can actually schedule.`,
      legend: "Effective Memory",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.memory.effective",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatBytes,
  };

  /*
   * vSAN series only exist on clusters with vSAN enabled — the charts
   * stay empty elsewhere, which is the honest state.
   */
  const vsanLatencyQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_vsan_latency",
      title: "vSAN Latency (avg)",
      description: `vcenter.cluster.vsan.latency.avg for ${clusterName}, per operation type. Empty unless vSAN is enabled on this cluster.`,
      legend: "Latency",
      legendUnit: "µs",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.vsan.latency.avg",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const vsanThroughputQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_vsan_throughput",
      title: "vSAN Throughput",
      description: `vcenter.cluster.vsan.throughput for ${clusterName}, per operation type.`,
      legend: "Throughput",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.vsan.throughput",
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

  const vsanCongestionQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_vsan_congestions",
      title: "vSAN Congestions",
      description: `vcenter.cluster.vsan.congestions for ${clusterName} — anything above zero means vSAN is throttling I/O.`,
      legend: "Congestions",
      legendUnit: "/s",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.vsan.congestions",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const toNumber: (value: number | null | undefined) => number | null = (
    value: number | null | undefined,
  ): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    const n: number = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  // Build overview summary fields from the inventory row.
  const summaryFields: Array<SummaryField> = [
    { title: "Cluster Name", value: clusterName },
    { title: "vCenter", value: vcenterName },
  ];

  if (row) {
    if (row.datacenterName) {
      summaryFields.push({ title: "Datacenter", value: row.datacenterName });
    }

    const hostCount: number | null = toNumber(row.hostCount);
    const effectiveHostCount: number | null = toNumber(row.effectiveHostCount);
    if (hostCount !== null) {
      const notEffective: number =
        effectiveHostCount !== null
          ? Math.max(hostCount - effectiveHostCount, 0)
          : 0;
      summaryFields.push({
        title: "Hosts",
        value:
          notEffective > 0 ? (
            <StatusBadge
              text={`${effectiveHostCount} of ${hostCount} effective — ${notEffective} in maintenance mode or unresponsive`}
              type={StatusBadgeType.Danger}
            />
          ) : effectiveHostCount !== null ? (
            `${effectiveHostCount} of ${hostCount} effective`
          ) : (
            String(hostCount)
          ),
      });
    }

    const vmCount: number | null = toNumber(row.vmCount);
    const poweredOnVmCount: number | null = toNumber(row.poweredOnVmCount);
    if (vmCount !== null) {
      summaryFields.push({
        title: "Virtual Machines",
        value:
          poweredOnVmCount !== null
            ? `${poweredOnVmCount} powered on of ${vmCount}`
            : String(vmCount),
      });
    }

    const templateCount: number | null = toNumber(row.vmTemplateCount);
    if (templateCount !== null) {
      summaryFields.push({
        title: "VM Templates",
        value: String(templateCount),
      });
    }

    const cpuEffective: number | null = toNumber(row.cpuEffectiveMhz);
    const cpuLimit: number | null = toNumber(row.cpuCapacityMhz);
    if (cpuEffective !== null || cpuLimit !== null) {
      summaryFields.push({
        title: "CPU (Effective / Total)",
        value: `${formatMhz(cpuEffective)} / ${formatMhz(cpuLimit)}`,
      });
    }

    const memoryEffective: number | null = toNumber(row.memoryEffectiveBytes);
    const memoryLimit: number | null = toNumber(row.maxMemoryBytes);
    if (memoryEffective !== null || memoryLimit !== null) {
      summaryFields.push({
        title: "Memory (Effective / Total)",
        value: `${formatBytes(memoryEffective)} / ${formatBytes(memoryLimit)}`,
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

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <ResourceOverviewTab
          summaryFields={row ? summaryFields : []}
          labels={{}}
          annotations={{}}
          isLoading={isLoadingRow}
          emptyMessage="Cluster details not reported yet. Make sure the VMware agent is sending metrics."
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Cluster Metrics: ${clusterName}`}
          description="Host and VM counts, member-host CPU and memory, effective capacity and vSAN health for this cluster over the selected time range."
        >
          <ResourceMetricsTab
            queryConfigs={[
              hostCountQuery,
              vmCountQuery,
              memberHostCpuQuery,
              memberHostMemoryQuery,
              effectiveCpuQuery,
              effectiveMemoryQuery,
              vsanLatencyQuery,
              vsanThroughputQuery,
              vsanCongestionQuery,
            ]}
          />
        </Card>
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default VMwareVCenterClusterDetail;
