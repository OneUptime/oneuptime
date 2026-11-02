import React, { FunctionComponent, ReactElement } from "react";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/VMwareMetricDescriptions";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../../ResourcePart/ResourceAttention";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../ResourcePart/ResourcePartDetailsCard";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import {
  VMWARE_CPU_READY_WARNING_PERCENT,
  VMWARE_HOST_SATURATION_PERCENT,
  getVMwareAttentionItems,
  getVMwareAttentionKey,
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

/*
 * A virtual machine's Overview: whether it needs attention, how busy it is
 * and whether its host makes it wait (CPU ready, memory taken back or
 * swapped), what is open on it, whether anyone will hear when it is in
 * trouble, and its details. A template never runs: it shows its disk alone.
 */

// How the VM's own row reads in its Needs attention card.
const THIS_VM: string = translationKey("This VM");

// A tile's bar turns amber where the VM's alerts and Needs attention do.
const SATURATION_THRESHOLDS: { warn: number; danger: number } = {
  warn: VMWARE_HOST_SATURATION_PERCENT,
  danger: Number.POSITIVE_INFINITY,
};
const CPU_READY_THRESHOLDS: { warn: number; danger: number } = {
  warn: VMWARE_CPU_READY_WARNING_PERCENT,
  danger: Number.POSITIVE_INFINITY,
};

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

  /*
   * A disconnected VM's trouble is its host's: Needs attention lists the
   * host vCenter cannot reach, one step from its page.
   */
  const attentionItems: Array<ResourceAttentionItem> = getVMwareAttentionItems(
    {
      rows: isDisconnected ? [row, ...hosts] : [row],
      contextRows: [
        ...(isDisconnected ? [] : hosts),
        ...(props.datacenters || []),
      ],
      now: props.now,
      routeFor: props.routes.getPartRoute,
      listRouteFor: props.routes.getListRoute,
    },
  );

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
        items={attentionItems}
        current={{
          key: getVMwareAttentionKey(
            VMwareResourceKind.VirtualMachine,
            props.externalId,
          ),
          label: THIS_VM,
        }}
        description="What about this virtual machine is broken or needs a look."
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
              title={tx("CPU")}
              icon={IconProp.CPUChip}
              iconColor="blue"
              value={formatPercent(cpuPercent)}
              sublabel={cpuMhz !== null ? formatMhz(cpuMhz) : undefined}
              percent={cpuPercent}
              thresholds={SATURATION_THRESHOLDS}
              description={VMWARE_METRIC_DESCRIPTIONS.vmCpu}
            />
            <GoldenMetricTile
              title={tx("CPU Ready")}
              icon={IconProp.Clock}
              iconColor="sky"
              value={formatPercent(cpuReady)}
              sublabel={
                cpuReady !== null && cpuReady > VMWARE_CPU_READY_WARNING_PERCENT
                  ? tx("waits for a free CPU")
                  : undefined
              }
              percent={cpuReady}
              thresholds={CPU_READY_THRESHOLDS}
              description={VMWARE_METRIC_DESCRIPTIONS.vmCpuReady}
            />
            <GoldenMetricTile
              title={tx("Memory")}
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
              thresholds={SATURATION_THRESHOLDS}
              description={VMWARE_METRIC_DESCRIPTIONS.vmMemory}
            />
          </>
        )}
        <GoldenMetricTile
          title={tx("Disk")}
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
          thresholds={SATURATION_THRESHOLDS}
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
