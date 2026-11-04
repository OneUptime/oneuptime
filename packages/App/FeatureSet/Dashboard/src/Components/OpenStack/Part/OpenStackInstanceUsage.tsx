import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import IconProp from "Common/Types/Icon/IconProp";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import {
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OpenStackInstanceMetric,
} from "Common/Types/OpenStack/OpenStackInstanceMetrics";
import { percentOf } from "Common/Types/OpenStack/OpenStackHealthRules";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  fetchOpenStackHypervisorUsage,
  fetchOpenStackInstanceMetricsChoice,
  fetchOpenStackInstanceUsage,
  OpenStackHypervisorUsage,
  OpenStackInstanceMetricsChoice,
  OpenStackInstanceUsage,
} from "../../../Pages/OpenStack/Utils/OpenStackUsageReads";
import {
  OPENSTACK_USAGE_GAP_TEXT,
  OpenStackUsageGap,
  getOpenStackInstanceUsageGap,
  isOpenStackInstanceContended,
  isOpenStackInstanceCpuSaturated,
} from "../../../Pages/OpenStack/Utils/OpenStackUsage";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import ResourceMetricsTab from "../../Infrastructure/ResourceMetricsTab";
import { formatOpenStackBytes } from "../OpenStackResourceList";
import { getOpenStackMetricQuery } from "./OpenStackMetricQueries";
import OpenStackPartNotice from "./OpenStackPartNotice";
import { OpenStackPart } from "./UseOpenStackPart";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * What an instance is really doing, beside its flavor's size. A flavor says what it was
 * promised and these say what it uses, so each tile has both, and neither is ever drawn as
 * the other. With no source they say so, and how to add one.
 */

interface UsageRead {
  usage: OpenStackInstanceUsage;
  hypervisor: OpenStackHypervisorUsage | null;
  choice: OpenStackInstanceMetricsChoice;
}

function formatBytesPerSecond(value: number): string {
  return `${formatOpenStackBytes(value)}/s`;
}

function formatPercentValue(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(1)} ms`;
}

const OpenStackInstanceUsageTiles: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
  flavor: OpenStackResource | null;
}> = (props: {
  part: OpenStackPart;
  row: OpenStackResource;
  flavor: OpenStackResource | null;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row, flavor } = props;

  const read: OpenStackRead<UsageRead> = useOpenStackRead<UsageRead>(async () => {
    const [usage, hypervisor, choice]: [
      OpenStackInstanceUsage,
      OpenStackHypervisorUsage | null,
      OpenStackInstanceMetricsChoice,
    ] = await Promise.all([
      fetchOpenStackInstanceUsage({
        cloudName: part.cloudName,
        instanceId: part.externalId,
      }),
      row.hypervisorName
        ? fetchOpenStackHypervisorUsage({
            cloudName: part.cloudName,
            hypervisorName: row.hypervisorName,
          })
        : Promise.resolve(null),
      fetchOpenStackInstanceMetricsChoice(part.openStackCloudId),
    ]);
    return { usage, hypervisor, choice };
  }, [part.externalId, part.cloudName, part.refreshToken]);

  // A chart's own frame says when it can't read: this adds nothing but its numbers.
  if (!read.data) {
    return <></>;
  }

  const { usage, hypervisor, choice } = read.data;
  const hasUsage: boolean =
    usage.cpuCores !== null ||
    usage.memoryResidentBytes !== null ||
    usage.memoryUsageBytes !== null;

  const gap: OpenStackUsageGap = getOpenStackInstanceUsageGap({
    hasUsage,
    row,
    options: choice.options,
    instanceCount: choice.instanceCount,
    hypervisorHasSource: (hypervisor?.sources.length || 0) > 0,
  });

  if (gap) {
    return (
      <OpenStackPartNotice
        testId="openstack-instance-usage-missing"
        tone="neutral"
        text={OPENSTACK_USAGE_GAP_TEXT[gap]}
      />
    );
  }

  const memory: number | null =
    usage.memoryUsageBytes ?? usage.memoryResidentBytes;
  const flavorMemory: number | null = flavor?.memoryCapacityBytes ?? null;

  return (
    <div
      className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      data-testid="openstack-instance-usage"
    >
      <GoldenMetricTile
        title="CPU in use"
        icon={IconProp.CPUChip}
        iconColor="blue"
        value={
          usage.cpuPercent === null
            ? "—"
            : `${Math.round(usage.cpuPercent)}%`
        }
        sublabel={
          flavor?.vcpuCapacity
            ? translator.translateTemplate("of {{count}} vCPUs from its flavor", {
                count: translator.formatNumber(flavor.vcpuCapacity),
              })
            : "of its vCPUs"
        }
        isSublabelAsWritten={Boolean(flavor?.vcpuCapacity)}
        percent={usage.cpuPercent}
        tone={
          isOpenStackInstanceCpuSaturated(usage.cpuPercent)
            ? "warning"
            : "positive"
        }
        description="What this instance's vCPUs are really doing, over the last quarter of an hour. Its flavor says how many it has, and this says how busy they are."
      />
      <GoldenMetricTile
        title="Memory in use"
        icon={IconProp.SquareStack}
        iconColor="violet"
        value={memory === null ? "—" : formatOpenStackBytes(memory)}
        sublabel={
          flavorMemory
            ? translator.translateTemplate("of {{amount}} from its flavor", {
                amount: formatOpenStackBytes(flavorMemory),
              })
            : "Not reported"
        }
        isSublabelAsWritten={Boolean(flavorMemory)}
        percent={percentOf(memory, flavorMemory)}
        description="What the guest says it is using, or without a balloon driver in the guest, what it holds on its hypervisor. Its flavor says what it was promised."
      />
      <GoldenMetricTile
        title="CPU waiting"
        icon={IconProp.Clock}
        iconColor="amber"
        value={
          usage.contentionPercent === null
            ? "—"
            : `${Math.round(usage.contentionPercent)}%`
        }
        sublabel={
          usage.contentionPercent === null
            ? "This source doesn't say"
            : "of its vCPUs' time, for the hypervisor"
        }
        percent={usage.contentionPercent}
        tone={
          isOpenStackInstanceContended(usage.contentionPercent)
            ? "warning"
            : "positive"
        }
        description="How much of the time its vCPUs wanted to run and the hypervisor made them wait. The guest calls this steal. High means a neighbour is the problem, and moving this instance helps where resizing won't."
      />
    </div>
  );
};

export const OpenStackInstanceUsageCharts: FunctionComponent<{
  part: OpenStackPart;
}> = (props: { part: OpenStackPart }): ReactElement => {
  const { part } = props;
  const attributes: Record<string, string> = {
    [OPENSTACK_INSTANCE_ID_ATTRIBUTE]: part.externalId,
  };
  const chart: (data: {
    variable: string;
    title: string;
    description: string;
    metricName: OpenStackInstanceMetric;
    legend: string;
    format: (value: number) => string;
  }) => MetricQueryConfigData = (data: {
    variable: string;
    title: string;
    description: string;
    metricName: OpenStackInstanceMetric;
    legend: string;
    format: (value: number) => string;
  }): MetricQueryConfigData => {
    return getOpenStackMetricQuery({ part, attributes, ...data });
  };

  return (
    <ResourceMetricsTab
      queryConfigs={[
        chart({
          variable: "instance_cpu",
          title: translationKey("CPU in use"),
          description: translationKey(
            "This instance's CPU as a share of its own vCPUs. 100 is every vCPU busy.",
          ),
          metricName: OpenStackInstanceMetric.CpuUtilization,
          legend: translationKey("CPU"),
          format: formatPercentValue,
        }),
        chart({
          variable: "instance_cpu_waiting",
          title: translationKey("CPU waiting"),
          description: translationKey(
            "How much of the time its vCPUs wanted to run and the hypervisor made them wait.",
          ),
          metricName: OpenStackInstanceMetric.CpuContention,
          legend: translationKey("Waiting"),
          format: formatPercentValue,
        }),
        chart({
          variable: "instance_memory",
          title: translationKey("Memory in use"),
          description: translationKey(
            "What the guest says it is using. A guest with no balloon driver has no such reading.",
          ),
          metricName: OpenStackInstanceMetric.MemoryUsage,
          legend: translationKey("In use"),
          format: formatOpenStackBytes,
        }),
        chart({
          variable: "instance_memory_held",
          title: translationKey("Memory on its hypervisor"),
          description: translationKey(
            "What this instance really holds of its hypervisor's memory.",
          ),
          metricName: OpenStackInstanceMetric.MemoryResident,
          legend: translationKey("Held"),
          format: formatOpenStackBytes,
        }),
        chart({
          variable: "instance_disk_read",
          title: translationKey("Disk reads"),
          description: translationKey("Bytes per second read, per disk."),
          metricName: OpenStackInstanceMetric.DiskReadRate,
          legend: translationKey("Read"),
          format: formatBytesPerSecond,
        }),
        chart({
          variable: "instance_disk_write",
          title: translationKey("Disk writes"),
          description: translationKey("Bytes per second written, per disk."),
          metricName: OpenStackInstanceMetric.DiskWriteRate,
          legend: translationKey("Written"),
          format: formatBytesPerSecond,
        }),
        chart({
          variable: "instance_disk_read_latency",
          title: translationKey("Disk read latency"),
          description: translationKey(
            "How long a read took, per disk. A disk with no reads has no reading.",
          ),
          metricName: OpenStackInstanceMetric.DiskReadLatency,
          legend: translationKey("Read latency"),
          format: formatMilliseconds,
        }),
        chart({
          variable: "instance_disk_write_latency",
          title: translationKey("Disk write latency"),
          description: translationKey(
            "How long a write took, per disk. A disk with no writes has no reading.",
          ),
          metricName: OpenStackInstanceMetric.DiskWriteLatency,
          legend: translationKey("Write latency"),
          format: formatMilliseconds,
        }),
        chart({
          variable: "instance_network_receive",
          title: translationKey("Network received"),
          description: translationKey(
            "Bytes per second reaching this instance, per interface.",
          ),
          metricName: OpenStackInstanceMetric.NetworkReceiveRate,
          legend: translationKey("Received"),
          format: formatBytesPerSecond,
        }),
        chart({
          variable: "instance_network_transmit",
          title: translationKey("Network sent"),
          description: translationKey(
            "Bytes per second leaving this instance, per interface.",
          ),
          metricName: OpenStackInstanceMetric.NetworkTransmitRate,
          legend: translationKey("Sent"),
          format: formatBytesPerSecond,
        }),
      ]}
    />
  );
};

export default OpenStackInstanceUsageTiles;
