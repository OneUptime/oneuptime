import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import IconProp from "Common/Types/Icon/IconProp";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import {
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OpenStackInstanceMetric,
} from "Common/Types/OpenStack/OpenStackInstanceMetrics";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { percentOf } from "Common/Types/OpenStack/OpenStackHealthRules";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { fetchOpenStackRow } from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import { getOpenStackFlavorExternalId } from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../../../Pages/OpenStack/Utils/OpenStackResourceUtils";
import {
  fetchOpenStackHypervisorReports,
  fetchOpenStackInstanceMetricsChoice,
  fetchOpenStackInstanceUsage,
  OpenStackInstanceMetricsChoice,
  OpenStackInstanceUsage,
} from "../../../Pages/OpenStack/Utils/OpenStackUsageReads";
import {
  OPENSTACK_USAGE_GAP_TEXT,
  OpenStackUsageGap,
  getOpenStackInstanceUsageGap,
  isOpenStackInstanceContended,
  isOpenStackInstanceCpuSaturated,
  isOpenStackInstanceDiskSlow,
  isOpenStackUsageChartable,
} from "../../../Pages/OpenStack/Utils/OpenStackUsage";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import ResourceMetricsTab from "../../Infrastructure/ResourceMetricsTab";
import {
  formatOpenStackBytes,
  formatOpenStackChartBytes,
  formatOpenStackPercent,
} from "../OpenStackResourceList";
import {
  addOpenStackRates,
  formatOpenStackRate,
} from "./OpenStackHostThroughput";
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
  gap: OpenStackUsageGap;
}

function hasUsageIn(usage: OpenStackInstanceUsage): boolean {
  return (
    usage.cpuCores !== null ||
    usage.memoryResidentBytes !== null ||
    usage.memoryUsageBytes !== null
  );
}

function useOpenStackInstanceUsageRead(data: {
  part: OpenStackPart;
  row: OpenStackResource;
}): OpenStackRead<UsageRead> {
  const { part, row } = data;
  return useOpenStackRead<UsageRead>(async () => {
    const [usage, hypervisorReports, choice]: [
      OpenStackInstanceUsage,
      boolean,
      OpenStackInstanceMetricsChoice,
    ] = await Promise.all([
      fetchOpenStackInstanceUsage({
        cloudName: part.cloudName,
        instanceId: part.externalId,
      }),
      row.hypervisorName
        ? fetchOpenStackHypervisorReports({
            cloudName: part.cloudName,
            hypervisorName: row.hypervisorName,
          })
        : Promise.resolve(false),
      fetchOpenStackInstanceMetricsChoice(part.openStackCloudId),
    ]);
    return {
      usage,
      gap: getOpenStackInstanceUsageGap({
        hasUsage: hasUsageIn(usage),
        row,
        options: choice.options,
        instanceCount: choice.instanceCount,
        hypervisorHasSource: hypervisorReports,
      }),
    };
  }, [part.externalId, part.cloudName, part.refreshToken]);
}

// A chart's axis and tooltip keep Latin digits, as every chart does.
function formatBytesPerSecond(value: number): string {
  return `${formatOpenStackChartBytes(value)}/s`;
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

  const read: OpenStackRead<UsageRead> = useOpenStackInstanceUsageRead({
    part,
    row,
  });

  // A chart's own frame says when it can't read: this adds nothing but its numbers.
  if (!read.data) {
    return <></>;
  }

  const { usage, gap } = read.data;

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
  const hasDisk: boolean =
    usage.diskReadBytesPerSecond !== null ||
    usage.diskWriteBytesPerSecond !== null;
  const hasNetwork: boolean =
    usage.networkReceiveBytesPerSecond !== null ||
    usage.networkTransmitBytesPerSecond !== null;
  const diskLatency: number | null =
    usage.diskReadLatencyMs === null && usage.diskWriteLatencyMs === null
      ? null
      : Math.max(usage.diskReadLatencyMs || 0, usage.diskWriteLatencyMs || 0);

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
            : formatOpenStackPercent(usage.cpuPercent, {
                language: translator.language,
              })
        }
        sublabel={
          flavor?.vcpuCapacity
            ? translator.translateTemplate(
                "of {{count}} vCPUs from its flavor",
                {
                  count: translator.formatNumber(flavor.vcpuCapacity),
                },
              )
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
            ? translator.translateTemplate(
                "of {{amount}} from its flavor",
                {
                  amount: formatOpenStackBytes(flavorMemory, {
                    language: translator.language,
                  }),
                },
                /*
                 * A sentence, read the page's way, the size set apart: "۴٫۰
                 * GiB" keeps its number first in a Persian one (issue #7191).
                 */
                { setsValuesApart: true },
              )
            : "Not reported"
        }
        percent={percentOf(memory, flavorMemory)}
        description="What the guest says it is using, or without a balloon driver in the guest, what it holds on its hypervisor, which is more than its flavor because the process running it counts too. Its flavor says what it was promised."
      />
      <GoldenMetricTile
        title="CPU waiting"
        icon={IconProp.Clock}
        iconColor="amber"
        value={
          usage.contentionPercent === null
            ? "—"
            : formatOpenStackPercent(usage.contentionPercent, {
                language: translator.language,
              })
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
      <GoldenMetricTile
        title="Disk throughput"
        icon={IconProp.Disc}
        iconColor="amber"
        value={formatOpenStackRate(
          addOpenStackRates(
            usage.diskReadBytesPerSecond,
            usage.diskWriteBytesPerSecond,
          ),
        )}
        sublabel={
          hasDisk
            ? translator.translateTemplate(
                "{{read}} read, {{written}} written",
                {
                  read: formatOpenStackRate(usage.diskReadBytesPerSecond),
                  written: formatOpenStackRate(usage.diskWriteBytesPerSecond),
                },
                { setsValuesApart: true },
              )
            : "Not reported"
        }
        description="What this instance's disks are really reading and writing, over the last quarter of an hour. Its flavor says how much disk it has, and this says how busy that is."
      />
      <GoldenMetricTile
        title="Disk latency"
        icon={IconProp.Clock}
        iconColor="sky"
        value={diskLatency === null ? "—" : formatMilliseconds(diskLatency)}
        sublabel={
          diskLatency === null
            ? "No requests, or this source doesn't say"
            : "for its slowest disk, a request"
        }
        tone={isOpenStackInstanceDiskSlow(diskLatency) ? "warning" : undefined}
        description="How long a read or a write took on this instance's slowest disk, on average, over the last quarter of an hour. A disk nobody is using has no reading rather than a reading of 0."
      />
      <GoldenMetricTile
        title="Network throughput"
        icon={IconProp.Globe}
        iconColor="emerald"
        value={formatOpenStackRate(
          addOpenStackRates(
            usage.networkReceiveBytesPerSecond,
            usage.networkTransmitBytesPerSecond,
          ),
        )}
        sublabel={
          hasNetwork
            ? translator.translateTemplate(
                "{{received}} in, {{transmitted}} out",
                {
                  received: formatOpenStackRate(
                    usage.networkReceiveBytesPerSecond,
                  ),
                  transmitted: formatOpenStackRate(
                    usage.networkTransmitBytesPerSecond,
                  ),
                },
                { setsValuesApart: true },
              )
            : "Not reported"
        }
        description="What this instance's network interfaces are really moving, over the last quarter of an hour."
      />
    </div>
  );
};

/*
 * Its charts, beside what its flavor says it was promised: the Overview's tiles are for now,
 * and these are for how it got there.
 */
export const OpenStackInstanceUsageCharts: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row } = props;

  const read: OpenStackRead<UsageRead> = useOpenStackInstanceUsageRead({
    part,
    row,
  });
  const flavorId: string = getOpenStackFactText(row, "flavorId");
  const flavorRead: OpenStackRead<OpenStackResource | null> =
    useOpenStackRead<OpenStackResource | null>(() => {
      return flavorId
        ? fetchOpenStackRow({
            openStackCloudId: part.openStackCloudId,
            kind: OpenStackResourceKind.Flavor,
            externalId: getOpenStackFlavorExternalId(row.regionName, flavorId),
          })
        : Promise.resolve(null);
    }, [flavorId, row.regionName, part.openStackCloudId.toString()]);

  const gap: OpenStackUsageGap = read.data?.gap || null;
  const flavor: OpenStackResource | null = flavorRead.data;

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
    <div data-testid="openstack-instance-usage-charts">
      {gap ? (
        <OpenStackPartNotice
          testId="openstack-instance-usage-charts-missing"
          tone="neutral"
          text={OPENSTACK_USAGE_GAP_TEXT[gap]}
        />
      ) : (
        <></>
      )}
      {flavor ? (
        <p
          className="mb-4 text-sm text-gray-600"
          data-testid="openstack-instance-usage-flavor"
        >
          {translator.translateTemplate(
            "Its flavor, {{name}}, promises it {{vcpus}} vCPUs, {{memory}} of memory and {{disk}} of disk.",
            {
              name: flavor.name || flavorId,
              vcpus:
                flavor.vcpuCapacity === undefined ||
                flavor.vcpuCapacity === null
                  ? "—"
                  : translator.formatNumber(flavor.vcpuCapacity),
              memory:
                flavor.memoryCapacityBytes === undefined ||
                flavor.memoryCapacityBytes === null
                  ? "—"
                  : formatOpenStackBytes(flavor.memoryCapacityBytes),
              disk:
                flavor.diskCapacityBytes === undefined ||
                flavor.diskCapacityBytes === null
                  ? "—"
                  : formatOpenStackBytes(flavor.diskCapacityBytes),
            },
            // Each value set apart: "۴٫۰ GiB" keeps its number first in a Persian sentence.
            { setsValuesApart: true },
          )}
        </p>
      ) : (
        <></>
      )}
      {isOpenStackUsageChartable(gap) ? (
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
              format: formatOpenStackChartBytes,
            }),
            chart({
              variable: "instance_memory_held",
              title: translationKey("Memory on its hypervisor"),
              description: translationKey(
                "What this instance really holds of its hypervisor's memory.",
              ),
              metricName: OpenStackInstanceMetric.MemoryResident,
              legend: translationKey("Held"),
              format: formatOpenStackChartBytes,
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
              description: translationKey(
                "Bytes per second written, per disk.",
              ),
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
      ) : (
        <></>
      )}
    </div>
  );
};

export default OpenStackInstanceUsageTiles;
