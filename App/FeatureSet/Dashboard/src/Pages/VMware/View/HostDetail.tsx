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
import {
  VMwareResourceKind,
  externalIdFromRouteParam,
  fetchVMwareInventoryRow,
  formatBytes,
  formatMhz,
  formatPercent,
  displayNameForResource,
  identityAttributesForResource,
} from "../Utils/VMwareResourceUtils";
import OneUptimeDate from "Common/Types/Date";
import ValueFormatter from "Common/Utils/ValueFormatter";

const MIB: number = 1024 * 1024;
const KIB: number = 1024;

const VMwareVCenterHostDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../vmware/:modelId/hosts/:subModelId — subModelId is
   * the percent-encoded inventory externalId ("host/<dc>/<host>"), not
   * a DB id.
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
          kind: VMwareResourceKind.Host,
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
  const hostName: string = row
    ? displayNameForResource(row)
    : externalId.substring(externalId.lastIndexOf("/") + 1);

  /*
   * Every chart filters on the host's RESOURCE attributes
   * (resource.vcenter.datacenter.name + resource.vcenter.host.name) plus
   * the vCenter identity — the vcenter receiver keys identity in
   * resource attributes, not datapoint labels. Before the inventory row
   * lands, fall back to the host name parsed from the externalId.
   */
  const idAttributes: Record<string, string> = row
    ? identityAttributesForResource(vcenterName, row)
    : {
        "resource.vmware.vcenter.name": vcenterName,
        "resource.vcenter.host.name": hostName,
      };

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "host_cpu",
      title: "CPU Utilization",
      description: `vcenter.host.cpu.utilization for ESXi host ${hostName} — already a percentage, no transform applied.`,
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

  const memoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "host_memory",
      title: "Memory Usage",
      description: `vcenter.host.memory.usage for ESXi host ${hostName} (reported in MiB, shown in bytes).`,
      legend: "Memory",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.host.memory.usage",
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

  /*
   * Throughput metrics from the vcenter receiver are already rates
   * ({KiBy/s}) — plain gauges, no counter-delta math needed. Grouping
   * by attributes splits them per `direction` (received/transmitted or
   * read/write) and per NIC / disk `object`.
   */
  const networkQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "host_network",
      title: "Network Throughput",
      description: `vcenter.host.network.throughput per direction and NIC for ESXi host ${hostName}.`,
      legend: "Network",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.host.network.throughput",
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

  const diskThroughputQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "host_disk_throughput",
      title: "Disk Throughput",
      description: `vcenter.host.disk.throughput per direction and disk for ESXi host ${hostName}.`,
      legend: "Disk",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.host.disk.throughput",
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
      metricVariable: "host_disk_latency",
      title: "Disk Latency (max)",
      description: `vcenter.host.disk.latency.max per disk for ESXi host ${hostName}. Sustained values above ~20-50 ms point at storage contention.`,
      legend: "Latency",
      legendUnit: "ms",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.host.disk.latency.max",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const packetErrorQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "host_packet_errors",
      title: "Network Packet Errors",
      description: `vcenter.host.network.packet.error.rate for ESXi host ${hostName} — anything above zero deserves a look at the physical NIC / switch port.`,
      legend: "Errors",
      legendUnit: "/s",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.host.network.packet.error.rate",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const packetDropQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "host_packet_drops",
      title: "Network Packet Drops",
      description: `vcenter.host.network.packet.drop.rate for ESXi host ${hostName}.`,
      legend: "Drops",
      legendUnit: "/s",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.host.network.packet.drop.rate",
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
    { title: "Host Name", value: hostName },
    { title: "vCenter", value: vcenterName },
  ];

  if (row) {
    if (row.datacenterName) {
      summaryFields.push({ title: "Datacenter", value: row.datacenterName });
    }
    summaryFields.push({
      title: "Cluster",
      value: row.clusterName || "Standalone (not in a cluster)",
    });

    if (row.latestCpuPercent !== null && row.latestCpuPercent !== undefined) {
      const usage: string =
        row.latestCpuMhz !== null && row.latestCpuMhz !== undefined
          ? ` (${formatMhz(Number(row.latestCpuMhz))}${
              row.cpuCapacityMhz !== null && row.cpuCapacityMhz !== undefined
                ? ` of ${formatMhz(Number(row.cpuCapacityMhz))}`
                : ""
            })`
          : "";
      summaryFields.push({
        title: "CPU",
        value: `${formatPercent(Number(row.latestCpuPercent))}${usage}`,
      });
    } else if (
      row.cpuCapacityMhz !== null &&
      row.cpuCapacityMhz !== undefined
    ) {
      summaryFields.push({
        title: "CPU Capacity",
        value: formatMhz(Number(row.cpuCapacityMhz)),
      });
    }

    if (row.latestMemoryBytes !== null && row.latestMemoryBytes !== undefined) {
      const pct: string =
        row.latestMemoryPercent !== null &&
        row.latestMemoryPercent !== undefined
          ? ` (${formatPercent(Number(row.latestMemoryPercent))})`
          : "";
      summaryFields.push({
        title: "Memory (Used / Capacity)",
        value: `${formatBytes(Number(row.latestMemoryBytes))} / ${formatBytes(
          row.maxMemoryBytes !== null && row.maxMemoryBytes !== undefined
            ? Number(row.maxMemoryBytes)
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

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <ResourceOverviewTab
          summaryFields={row ? summaryFields : []}
          labels={{}}
          annotations={{}}
          isLoading={isLoadingRow}
          emptyMessage="Host details not reported yet. Make sure the VMware agent is sending metrics."
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Host Metrics: ${hostName}`}
          description="CPU, memory, network, disk throughput, disk latency and NIC errors for this ESXi host over the selected time range."
        >
          <ResourceMetricsTab
            queryConfigs={[
              cpuQuery,
              memoryQuery,
              networkQuery,
              diskThroughputQuery,
              diskLatencyQuery,
              packetErrorQuery,
              packetDropQuery,
            ]}
          />
        </Card>
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default VMwareVCenterHostDetail;
