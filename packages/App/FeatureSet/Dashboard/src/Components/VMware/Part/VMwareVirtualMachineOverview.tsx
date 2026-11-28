import React, { FunctionComponent, ReactElement } from "react";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/VMwareMetricDescriptions";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import { ResourcePartAttention } from "../../ResourcePart/ResourcePartTypes";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../ResourcePart/ResourcePartDetailsCard";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import {
  VMWARE_HOST_SATURATION_PERCENT,
  VMwareSwapActivity,
  formatVMwareReasonRate,
  getVMwareSwapActivity,
  getVMwareThresholdLine,
  hasFreshVMwareReadings,
  isVMwareIssueAbout,
  isVMwareVirtualMachineDisconnected,
  toVMwareDate,
  toVMwareNumber,
} from "../../../Pages/VMware/Utils/VMwareHealth";
import {
  VMWARE_VIRTUAL_MACHINE_ALERT_TEMPLATE_IDS,
  isVMwareRootResourcePool,
} from "../../../Pages/VMware/Utils/VMwarePartFacts";
import {
  formatBytes,
  formatMhz,
  formatPercent,
} from "../../../Pages/VMware/Utils/VMwareResourceUtils";
import { VMwarePartRoutes } from "./VMwarePartRoutes";
import { useVMwareHealthRules } from "../../../Pages/VMware/Utils/VMwareHealthRulesStore";
import {
  VMwareHealthRules,
  isPastVMwareHealthThreshold,
} from "Common/Types/VMware/VMwareHealthRules";

/*
 * A virtual machine's Overview: whether it needs attention, how busy it is
 * and whether its host makes it wait (CPU ready, memory taken back or
 * swapped), what is open on it, whether anyone will hear when it is in
 * trouble, and its details. A template never runs: it shows its disk alone.
 */

/*
 * A tile's bar turns amber where Needs attention does, at the project's
 * rules (VMware > Settings > Health Rules), and never red.
 */
function amberAt(threshold: number | null): { warn: number; danger: number } {
  return {
    warn: getVMwareThresholdLine(threshold),
    danger: Number.POSITIVE_INFINITY,
  };
}

/*
 * Which way a running VM's memory moves between it and the host's swap file
 * now, in the reader's words: out, back in, or nowhere while some is left
 * from earlier. Nothing until two reports could be compared, or while the
 * VM has none swapped and none moves.
 */
export function getSwappingNowText(
  activity: VMwareSwapActivity | null,
  swappedBytes: number | null,
  translator: Translator,
): string | null {
  if (!activity) {
    return null;
  }
  if ((activity.swapOutBytesPerSecond ?? 0) > 0) {
    return translator.translateTemplate("Out to disk at {{rate}}", {
      rate: formatVMwareReasonRate(activity.swapOutBytesPerSecond!),
    });
  }
  if ((activity.swapInBytesPerSecond ?? 0) > 0) {
    return translator.translateTemplate("Back in at {{rate}}", {
      rate: formatVMwareReasonRate(activity.swapInBytesPerSecond!),
    });
  }
  if (activity.isKnownIdle && swappedBytes !== null && swappedBytes > 0) {
    return (
      translator.translateText("None: what is swapped is from earlier") ||
      "None: what is swapped is from earlier"
    );
  }
  return null;
}

export interface ComponentProps {
  vcenterId: ObjectID;
  vcenterName: string;
  externalId: string;
  row: VMwareResource | null;
  /*
   * The ESXi host it runs on and the vCenter's datacenters: on a host
   * vCenter cannot reach, the VM is Disconnected and its numbers no reading.
   */
  hostRow?: VMwareResource | null | undefined;
  datacenters?: Array<VMwareResource> | undefined;
  /*
   * What needs attention on the VM (and, on a host vCenter cannot reach,
   * that host): the page reads it once (getVMwarePartAttention) for this
   * card and for the hero's status.
   */
  attention: ResourcePartAttention;
  routes: VMwarePartRoutes;
  // The page of the ESXi host the VM runs on.
  hostRoute?: Route | undefined;
  now: Date;
  refreshToken?: number | undefined;
}

const VMwareVirtualMachineOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const rules: VMwareHealthRules = useVMwareHealthRules();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const row: VMwareResource | null = props.row;

  if (!row) {
    return (
      <p
        className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
        data-testid="vmware-vm-not-reported"
      >
        {tx(
          "Virtual machine details not reported yet. Make sure the VMware agent is sending metrics.",
        )}
      </p>
    );
  }

  const hosts: Array<VMwareResource> = props.hostRow ? [props.hostRow] : [];
  const isTemplate: boolean = row.isTemplate === true;
  const isDisconnected: boolean = isVMwareVirtualMachineDisconnected({
    vm: row,
    hosts: hosts,
    datacenters: props.datacenters,
    now: props.now,
  });
  const isRunning: boolean =
    !isTemplate &&
    row.isPoweredOn === true &&
    hasFreshVMwareReadings(row, props.now) &&
    !isDisconnected;

  const cpuPercent: number | null = isRunning
    ? toVMwareNumber(row.latestCpuPercent)
    : null;
  const cpuMhz: number | null = isRunning
    ? toVMwareNumber(row.latestCpuMhz)
    : null;
  const cpuReady: number | null = isRunning
    ? toVMwareNumber(row.cpuReadinessPercent)
    : null;
  const memoryBytes: number | null = isRunning
    ? toVMwareNumber(row.latestMemoryBytes)
    : null;
  const memoryPercent: number | null = isRunning
    ? toVMwareNumber(row.latestMemoryPercent)
    : null;
  const configuredMemory: number | null = toVMwareNumber(row.maxMemoryBytes);
  const diskUsed: number | null = toVMwareNumber(row.latestDiskBytes);
  const diskProvisioned: number | null = toVMwareNumber(row.maxDiskBytes);
  const diskPercent: number | null =
    toVMwareNumber(row.latestDiskPercent) ??
    (diskUsed !== null && diskProvisioned !== null && diskProvisioned > 0
      ? (diskUsed / diskProvisioned) * 100
      : null);
  const ballooned: number | null = isRunning
    ? toVMwareNumber(row.memoryBalloonedBytes)
    : null;
  const swapped: number | null = isRunning
    ? toVMwareNumber(row.memorySwappedBytes)
    : null;
  // Whether the host is moving its memory to or from its swap file now.
  const swapActivity: VMwareSwapActivity | null = isRunning
    ? getVMwareSwapActivity(row)
    : null;

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Name",
      value: row.name || props.externalId,
      copyText: row.name || undefined,
    },
  ];
  if (row.vmInstanceUuid) {
    detailRows.push({
      key: "uuid",
      label: "Instance UUID",
      value: row.vmInstanceUuid,
      mono: true,
      copyText: row.vmInstanceUuid,
    });
  }
  if (row.hostName) {
    const hostRoute: Route | undefined = props.hostRoute;
    detailRows.push({
      key: "host",
      label: "Host",
      value: hostRoute ? (
        <Link
          to={hostRoute}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          {row.hostName}
        </Link>
      ) : (
        row.hostName
      ),
    });
  }
  /*
   * The pool or vApp it runs in, as the hero's chip and the lists say it:
   * not its cluster's root pool, which vSphere names "Resources" and never
   * shows (a VM in it is in no pool of anyone's making).
   */
  const isInRootPool: boolean =
    !row.virtualAppName &&
    isVMwareRootResourcePool({
      name: row.resourcePoolName,
      path: row.resourcePoolPath,
    });
  if (row.virtualAppName) {
    detailRows.push({
      key: "vapp",
      label: "vApp",
      value: row.virtualAppName,
    });
  } else if (row.resourcePoolName && !isInRootPool) {
    detailRows.push({
      key: "pool",
      label: "Resource Pool",
      value: row.resourcePoolName,
    });
  }
  if (row.resourcePoolPath && !isInRootPool) {
    detailRows.push({
      key: "path",
      label: "Inventory Path",
      value: row.resourcePoolPath,
      mono: true,
      copyText: row.resourcePoolPath,
    });
  }
  if (ballooned !== null && ballooned > 0) {
    detailRows.push({
      key: "ballooned",
      label: "Memory Ballooned",
      value: formatBytes(ballooned),
      description: VMWARE_METRIC_DESCRIPTIONS.vmMemoryBallooned,
    });
  }
  if (swapped !== null && swapped > 0) {
    detailRows.push({
      key: "swapped",
      label: "Memory Swapped",
      value: formatBytes(swapped),
      description: VMWARE_METRIC_DESCRIPTIONS.vmMemorySwapped,
    });
  }
  /*
   * Swapped memory is not swapping (#11157): say which way it moves now,
   * once two reports could be compared.
   */
  const swappingNow: string | null = getSwappingNowText(
    swapActivity,
    swapped,
    translator,
  );
  if (swappingNow) {
    detailRows.push({
      key: "swapping",
      label: "Swapping Now",
      value: swappingNow,
      description: VMWARE_METRIC_DESCRIPTIONS.vmMemorySwapping,
    });
  }
  detailRows.push({
    key: "id",
    label: "vCenter ID",
    value: props.externalId,
    mono: true,
    copyText: props.externalId,
  });
  const lastReport: Date | null =
    toVMwareDate(row.metricsUpdatedAt) || toVMwareDate(row.lastSeenAt);
  if (lastReport) {
    detailRows.push({
      key: "last-report",
      label: "Last report",
      value: OneUptimeDate.getDateAsLocalFormattedString(lastReport),
    });
  }

  return (
    <div data-testid="vmware-vm-overview">
      <NeedsAttentionCard
        testId="vmware-vm-attention"
        items={props.attention.items}
        current={props.attention.current}
        description={props.attention.description}
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="vmware-vm-tiles"
      >
        {isTemplate ? (
          <></>
        ) : (
          <>
            <GoldenMetricTile
              title="CPU"
              icon={IconProp.CPUChip}
              iconColor="blue"
              value={formatPercent(cpuPercent)}
              sublabel={cpuMhz !== null ? formatMhz(cpuMhz) : undefined}
              percent={cpuPercent}
              thresholds={amberAt(rules.hostCpuWarningPercent)}
              description={VMWARE_METRIC_DESCRIPTIONS.vmCpu}
            />
            <GoldenMetricTile
              title="CPU Ready"
              icon={IconProp.Clock}
              iconColor="sky"
              value={formatPercent(cpuReady)}
              sublabel={
                isPastVMwareHealthThreshold(
                  cpuReady,
                  rules.vmCpuReadyWarningPercent,
                )
                  ? tx("waits for a free CPU")
                  : undefined
              }
              percent={cpuReady}
              thresholds={amberAt(rules.vmCpuReadyWarningPercent)}
              description={VMWARE_METRIC_DESCRIPTIONS.vmCpuReady}
            />
            <GoldenMetricTile
              title="Memory"
              icon={IconProp.SquareStack}
              iconColor="violet"
              value={formatPercent(memoryPercent)}
              sublabel={
                memoryBytes !== null && configuredMemory !== null
                  ? translator.translateTemplate("{{used}} of {{total}}", {
                      used: formatBytes(memoryBytes),
                      total: formatBytes(configuredMemory),
                    })
                  : undefined
              }
              percent={memoryPercent}
              thresholds={amberAt(rules.hostMemoryWarningPercent)}
              description={VMWARE_METRIC_DESCRIPTIONS.vmMemory}
            />
          </>
        )}
        <GoldenMetricTile
          title="Disk"
          icon={IconProp.Database}
          iconColor="amber"
          value={formatPercent(diskPercent)}
          sublabel={
            diskUsed !== null && diskProvisioned !== null
              ? translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatBytes(diskUsed),
                  total: formatBytes(diskProvisioned),
                })
              : undefined
          }
          percent={diskPercent}
          thresholds={amberAt(VMWARE_HOST_SATURATION_PERCENT)}
          description={VMWARE_METRIC_DESCRIPTIONS.vmDisk}
        />
      </div>

      <ResourcePartOpenEventsCard
        testId="vmware-vm-open"
        title="Open on this VM"
        description="Unresolved incidents and alerts about this virtual machine, incidents first."
        resourceRelation="vmwareVCenters"
        resourceId={props.vcenterId}
        isAbout={(record: OpenIssueRecord): boolean => {
          return isVMwareIssueAbout(record, row);
        }}
        getIncidentRoute={props.routes.getIncidentRoute}
        getAlertRoute={props.routes.getAlertRoute}
        incidentsRoute={props.routes.incidentsRoute}
        alertsRoute={props.routes.alertsRoute}
        refreshToken={props.refreshToken}
      />

      {isTemplate ? (
        <></>
      ) : (
        <ResourcePartAlertsCard
          testId="vmware-vm-alerts"
          title="VM alerts"
          description="The vCenter's alerts that watch every virtual machine, this one included: each is one monitor that fires for any VM that crosses it."
          resourceType={MonitorRecommendationResourceType.VMware}
          templateIds={VMWARE_VIRTUAL_MACHINE_ALERT_TEMPLATE_IDS}
          resourceId={props.vcenterId}
          resourceIdentifier={props.vcenterName}
          getRecommendationsRoute={props.routes.getRecommendationsRoute}
          getMonitorRoute={props.routes.getMonitorRoute}
          refreshToken={props.refreshToken}
        />
      )}

      <ResourcePartDetailsCard
        testId="vmware-vm-details"
        description="What vCenter reports about this virtual machine."
        rows={detailRows}
      />
    </div>
  );
};

export default VMwareVirtualMachineOverview;
