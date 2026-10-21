import React, { FunctionComponent, ReactElement } from "react";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import Card from "Common/UI/Components/Card/Card";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ValueFormatter from "Common/Utils/ValueFormatter";
import ResourceMetricsTab from "../../Infrastructure/ResourceMetricsTab";
import { formatBytes } from "../../../Pages/VMware/Utils/VMwareResourceUtils";

/*
 * An ESXi host's Metrics tab: every vcenter.host.* series the Overview
 * condenses, one chart each, per network adapter and storage device - with
 * the time picker and "Open in Explorer" of every embedded metric card, for
 * the reader who wants the raw lines.
 *
 * Every chart filters on the host's RESOURCE attributes
 * (resource.vcenter.datacenter.name + resource.vcenter.host.name) plus the
 * vCenter identity: the vcenter receiver keys identity in resource
 * attributes, not datapoint labels.
 */

const MIB: number = 1024 * 1024;
const KIB: number = 1024;

export interface ComponentProps {
  hostName: string;
  // The identity filter (VMwareHostData.getVMwareHostMetricAttributes).
  attributes: Record<string, string>;
}

const VMwareHostMetricsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const hostName: string = props.hostName;
  const idAttributes: Record<string, string> = props.attributes;

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "host_cpu",
      title: "CPU Utilization",
      description: translator.translateTemplate(
        "vcenter.host.cpu.utilization for ESXi host {{hostName}} — already a percentage, no transform applied.",
        { hostName: hostName },
      ),
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
      description: translator.translateTemplate(
        "vcenter.host.memory.usage for ESXi host {{hostName}} (reported in MiB, shown in bytes).",
        { hostName: hostName },
      ),
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
      description: translator.translateTemplate(
        "vcenter.host.network.throughput per direction and NIC for ESXi host {{hostName}}.",
        { hostName: hostName },
      ),
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
      description: translator.translateTemplate(
        "vcenter.host.disk.throughput per direction and disk for ESXi host {{hostName}}.",
        { hostName: hostName },
      ),
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
      description: translator.translateTemplate(
        "vcenter.host.disk.latency.max per disk for ESXi host {{hostName}}. Sustained values above ~20-50 ms point at storage contention.",
        { hostName: hostName },
      ),
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
      description: translator.translateTemplate(
        "vcenter.host.network.packet.error.rate for ESXi host {{hostName}} — anything above zero deserves a look at the physical NIC / switch port.",
        { hostName: hostName },
      ),
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
      description: translator.translateTemplate(
        "vcenter.host.network.packet.drop.rate for ESXi host {{hostName}}.",
        { hostName: hostName },
      ),
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

  return (
    <Card
      title={translator.translateTemplate("Host Metrics: {{hostName}}", {
        hostName: hostName,
      })}
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
  );
};

export default VMwareHostMetricsTab;
