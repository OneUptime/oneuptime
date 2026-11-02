import React, { FunctionComponent, ReactElement } from "react";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
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
import VMwareHostsCard from "../VMwareHostsCard";
import {
  VMWARE_HOST_SATURATION_PERCENT,
  VMwareClusterHeadroom,
  getVMwareAttentionItems,
  getVMwareAttentionKey,
  getVMwareClusterHeadroom,
  hasFreshVMwareReadings,
  isVMwareIssueAbout,
  toVMwareDate,
  toVMwareNumber,
} from "../../../Pages/VMware/Utils/VMwareHealth";
import {
  VMWARE_CLUSTER_ALERT_TEMPLATE_IDS,
  VMwareClusterUsage,
  getVMwareClusterUsage,
} from "../../../Pages/VMware/Utils/VMwarePartFacts";
import {
  formatBytes,
  formatMhz,
  formatPercent,
} from "../../../Pages/VMware/Utils/VMwareResourceUtils";
import { VMwarePartRoutes } from "./VMwarePartRoutes";

/*
 * A cluster's Overview: what in it needs attention (the cluster, its hosts
 * and the VMs on them), how many of its hosts DRS and HA can use, how much
 * of its capacity its hosts use, whether it could lose its largest host,
 * its hosts at a glance, what is open in it, whether anyone will hear when
 * it is in trouble, and its details.
 */

// How the cluster's own row reads in its Needs attention card.
const THIS_CLUSTER: string = translationKey("This cluster");

const SATURATION_THRESHOLDS: { warn: number; danger: number } = {
  warn: VMWARE_HOST_SATURATION_PERCENT,
  danger: Number.POSITIVE_INFINITY,
};

export interface ComponentProps {
  vcenterId: ObjectID;
  vcenterName: string;
  externalId: string;
  row: VMwareResource | null;
  // The cluster's hosts and the VMs in it that may need attention.
  hosts: Array<VMwareResource>;
  attentionVirtualMachines: Array<VMwareResource>;
  // The vCenter's datacenters: a host's state reads its datacenter's counts.
  datacenters: Array<VMwareResource>;
  routes: VMwarePartRoutes;
  onShowHosts: () => void;
  now: Date;
  refreshToken?: number | undefined;
}

const VMwareClusterOverview: FunctionComponent<ComponentProps> = (
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
        data-testid="vmware-cluster-not-reported"
      >
        {tx(
          "Cluster details not reported yet. Make sure the VMware agent is sending metrics.",
        )}
      </p>
    );
  }

  const attentionItems: Array<ResourceAttentionItem> = getVMwareAttentionItems(
    {
      rows: [row, ...props.hosts, ...props.attentionVirtualMachines],
      contextRows: props.datacenters,
      now: props.now,
      routeFor: props.routes.getPartRoute,
      listRouteFor: props.routes.getListRoute,
    },
  );

  const fresh: boolean = hasFreshVMwareReadings(row, props.now);
  const total: number | null = fresh ? toVMwareNumber(row.hostCount) : null;
  const effective: number | null = fresh
    ? toVMwareNumber(row.effectiveHostCount)
    : null;
  const usage: VMwareClusterUsage = getVMwareClusterUsage({
    cluster: row,
    hosts: props.hosts,
    datacenters: props.datacenters,
    now: props.now,
  });
  const headroom: VMwareClusterHeadroom | null = getVMwareClusterHeadroom({
    cluster: row,
    hosts: props.hosts,
    datacenters: props.datacenters,
    now: props.now,
  });

  const headroomPercent: number | null =
    headroom && headroom.remainingMemoryBytes > 0
      ? (headroom.usedMemoryBytes / headroom.remainingMemoryBytes) * 100
      : null;

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Name",
      value: row.clusterName || row.name || props.externalId,
      copyText: row.clusterName || row.name || undefined,
    },
  ];
  if (row.datacenterName) {
    detailRows.push({
      key: "datacenter",
      label: "Datacenter",
      value: row.datacenterName,
    });
  }
  const cpuEffective: number | null = toVMwareNumber(row.cpuEffectiveMhz);
  const cpuTotal: number | null = toVMwareNumber(row.cpuCapacityMhz);
  if (cpuEffective !== null || cpuTotal !== null) {
    detailRows.push({
      key: "cpu",
      label: "CPU (Effective / Total)",
      value: `${formatMhz(cpuEffective)} / ${formatMhz(cpuTotal)}`,
      description: VMWARE_METRIC_DESCRIPTIONS.clusterCpu,
    });
  }
  const memoryEffective: number | null = toVMwareNumber(
    row.memoryEffectiveBytes,
  );
  const memoryTotal: number | null = toVMwareNumber(row.maxMemoryBytes);
  if (memoryEffective !== null || memoryTotal !== null) {
    detailRows.push({
      key: "memory",
      label: "Memory (Effective / Total)",
      value: `${formatBytes(memoryEffective)} / ${formatBytes(memoryTotal)}`,
      description: VMWARE_METRIC_DESCRIPTIONS.clusterMemory,
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
    <div data-testid="vmware-cluster-overview">
      <NeedsAttentionCard
        testId="vmware-cluster-attention"
        items={attentionItems}
        current={{
          key: getVMwareAttentionKey(
            VMwareResourceKind.Cluster,
            props.externalId,
          ),
          label: THIS_CLUSTER,
        }}
        description="What in this cluster is broken or needs a look: the cluster, its hosts and the VMs on them."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="vmware-cluster-tiles"
      >
        <GoldenMetricTile
          title={tx("Effective hosts")}
          icon={IconProp.ServerStack}
          iconColor="emerald"
          value={
            total !== null && effective !== null
              ? `${translator.formatNumber(effective)}/${translator.formatNumber(total)}`
              : "—"
          }
          sublabel={
            total !== null && effective !== null && effective < total
              ? translator.translatePlural(
                  {
                    one: "{{count}} host not effective",
                    other: "{{count}} hosts not effective",
                  },
                  total - effective,
                )
              : undefined
          }
          percent={
            total !== null && effective !== null && total > 0
              ? (effective / total) * 100
              : null
          }
          thresholds={{ warn: 100, danger: 0 }}
          higherIsBetter={true}
          description={VMWARE_METRIC_DESCRIPTIONS.clusterHosts}
        />
        <GoldenMetricTile
          title={tx("CPU")}
          icon={IconProp.CPUChip}
          iconColor="blue"
          value={formatPercent(usage.cpuPercent)}
          sublabel={
            usage.cpuUsedMhz !== null && usage.cpuEffectiveMhz !== null
              ? translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatMhz(usage.cpuUsedMhz),
                  total: formatMhz(usage.cpuEffectiveMhz),
                })
              : undefined
          }
          percent={usage.cpuPercent}
          thresholds={SATURATION_THRESHOLDS}
          description={VMWARE_METRIC_DESCRIPTIONS.clusterCpuInUse}
        />
        <GoldenMetricTile
          title={tx("Memory")}
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatPercent(usage.memoryPercent)}
          sublabel={
            usage.memoryUsedBytes !== null &&
            usage.memoryEffectiveBytes !== null
              ? translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatBytes(usage.memoryUsedBytes),
                  total: formatBytes(usage.memoryEffectiveBytes),
                })
              : undefined
          }
          percent={usage.memoryPercent}
          thresholds={SATURATION_THRESHOLDS}
          description={VMWARE_METRIC_DESCRIPTIONS.clusterMemoryInUse}
        />
        <GoldenMetricTile
          title={tx("Host failure")}
          icon={IconProp.ShieldCheck}
          iconColor="slate"
          value={
            headroom
              ? headroom.canLoseAHost
                ? tx("Covered")
                : tx("Not covered")
              : "—"
          }
          sublabel={
            headroom
              ? headroom.canLoseAHost
                ? translator.translateTemplate(
                    "{{spare}} of memory to spare without the largest host",
                    {
                      spare: formatBytes(
                        headroom.remainingMemoryBytes -
                          headroom.usedMemoryBytes,
                      ),
                    },
                  )
                : translator.translateTemplate(
                    "{{short}} of memory short without the largest host",
                    {
                      short: formatBytes(
                        headroom.usedMemoryBytes -
                          headroom.remainingMemoryBytes,
                      ),
                    },
                  )
              : undefined
          }
          percent={headroomPercent}
          /*
           * Amber once its hosts use more than the others would have: a
           * look, as Needs attention says, never red.
           */
          thresholds={{ warn: 100, danger: Number.POSITIVE_INFINITY }}
          description={VMWARE_METRIC_DESCRIPTIONS.clusterHostFailure}
        />
      </div>

      <VMwareHostsCard
        testId="vmware-cluster-hosts-card"
        hosts={props.hosts}
        datacenters={props.datacenters}
        getHostRoute={(externalId: string) => {
          return props.routes.getPartRoute(VMwareResourceKind.Host, externalId);
        }}
        onShowAll={props.onShowHosts}
        showCluster={false}
        description="This cluster's hosts: each one's state and load at vCenter's latest report, the ones that need attention first."
        now={props.now}
      />

      <ResourcePartOpenEventsCard
        testId="vmware-cluster-open"
        title="Open in this cluster"
        description="Unresolved incidents and alerts about this cluster, its hosts and its VMs, incidents first."
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

      <ResourcePartAlertsCard
        testId="vmware-cluster-alerts"
        title="Cluster alerts"
        description="The vCenter's alerts that watch every cluster, this one included: each is one monitor that fires for any cluster that crosses it."
        resourceType={MonitorRecommendationResourceType.VMware}
        templateIds={VMWARE_CLUSTER_ALERT_TEMPLATE_IDS}
        resourceId={props.vcenterId}
        resourceIdentifier={props.vcenterName}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="vmware-cluster-details"
        description="What vCenter reports about this cluster."
        rows={detailRows}
      />
    </div>
  );
};

export default VMwareClusterOverview;
