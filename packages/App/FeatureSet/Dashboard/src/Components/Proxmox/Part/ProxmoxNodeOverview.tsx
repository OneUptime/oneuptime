import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Link from "Common/UI/Components/Link/Link";
import OneUptimeDate from "Common/Types/Date";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import { PROXMOX_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/ProxmoxMetricDescriptions";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../ResourcePart/ResourcePartDetailsCard";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import { ResourceAttentionItem } from "../../ResourcePart/ResourceAttention";
import {
  getProxmoxAttentionItems,
  isProxmoxIssueAbout,
} from "../../../Pages/Proxmox/Utils/ProxmoxHealth";
import {
  PROXMOX_NODE_ALERT_TEMPLATE_IDS,
  ProxmoxBusyGuest,
  ProxmoxGuestSummary,
  getProxmoxBusiestGuests,
  getProxmoxDiskPercent,
  getProxmoxMemoryPercent,
  getProxmoxNodeName,
  summarizeProxmoxGuests,
  toProxmoxDate,
  toProxmoxNumber,
} from "../../../Pages/Proxmox/Utils/ProxmoxPartFacts";
import {
  METRIC_STALE_MS,
  formatBytes,
  formatPercent,
  formatUptime,
} from "../../../Pages/Proxmox/Utils/ProxmoxResourceUtils";
import ProxmoxBusiestGuestsCard, {
  PROXMOX_BUSIEST_GUESTS_SHOWN,
} from "./ProxmoxBusiestGuestsCard";
import { ProxmoxPartRoutes } from "./ProxmoxPartRoutes";

/*
 * A Proxmox node's Overview: what on it needs attention (the node, its
 * guests and its storage, by the cluster's own rules), how busy it is, what
 * is open on it, which guests keep it busy, whether anyone will hear when
 * it is in trouble, and its details. The ESXi host page's story, for a
 * Proxmox VE node.
 *
 * The tiles are the node's latest report, as a detail page always shows it:
 * the last value the agent sent, however old (the lists hide old numbers;
 * a part's own page says when it last reported, in its hero).
 */

// How the node's own row reads in its Needs attention card.
const THIS_NODE: string = translationKey("This node");

export interface ComponentProps {
  clusterId: ObjectID;
  clusterName: string;
  externalId: string;
  row: ProxmoxResource | null;
  // The guests and storage the node reports.
  nodeRows: Array<ProxmoxResource>;
  routes: ProxmoxPartRoutes;
  onShowGuests: () => void;
  refreshToken?: number | undefined;
  // Drawn last: the Remove Node card, when the node can be removed.
  footer?: ReactNode | undefined;
}

const ProxmoxNodeOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const row: ProxmoxResource | null = props.row;
  const nodeName: string = getProxmoxNodeName(row, props.externalId);
  const guests: Array<ProxmoxResource> = props.nodeRows.filter(
    (candidate: ProxmoxResource): boolean => {
      return candidate.kind === "Guest";
    },
  );
  const guestSummary: ProxmoxGuestSummary = summarizeProxmoxGuests(guests);

  const attentionItems: Array<ResourceAttentionItem> = getProxmoxAttentionItems(
    {
      rows: [...(row ? [row] : []), ...props.nodeRows],
      routeFor: props.routes.getPartRoute,
    },
  );

  const busiest: Array<ProxmoxBusyGuest> = getProxmoxBusiestGuests({
    rows: guests,
    now: OneUptimeDate.getCurrentDate(),
    staleMs: METRIC_STALE_MS,
    limit: PROXMOX_BUSIEST_GUESTS_SHOWN,
  });

  const cpu: number | null = toProxmoxNumber(row?.latestCpuPercent);
  const cores: number | null = toProxmoxNumber(row?.cpuCount);
  const memoryPercent: number | null = row
    ? getProxmoxMemoryPercent(row)
    : null;
  const memoryUsed: number | null = toProxmoxNumber(row?.latestMemoryBytes);
  const memoryTotal: number | null = toProxmoxNumber(row?.maxMemoryBytes);
  const diskPercent: number | null = row ? getProxmoxDiskPercent(row) : null;
  const diskUsed: number | null = toProxmoxNumber(row?.latestDiskBytes);
  const diskTotal: number | null = toProxmoxNumber(row?.maxDiskBytes);

  const nodeIssueRow: Pick<
    ProxmoxResource,
    "kind" | "externalId" | "vmid" | "name"
  > =
    row ||
    ({
      kind: "Node",
      externalId: props.externalId,
      name: nodeName,
    } as ProxmoxResource);

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Node name",
      value: nodeName,
      copyText: nodeName,
    },
    {
      key: "cluster",
      label: "Cluster",
      value: (
        <Link
          to={props.routes.clusterRoute}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          {props.clusterName}
        </Link>
      ),
    },
  ];

  const uptime: string =
    row && row.isUp !== false ? formatUptime(row.uptimeSeconds) : "";
  if (uptime) {
    detailRows.push({
      key: "uptime",
      label: "Uptime",
      value: uptime,
      description: PROXMOX_METRIC_DESCRIPTIONS.nodeUptime,
    });
  }
  if (cores !== null && cores > 0) {
    detailRows.push({
      key: "cores",
      label: "CPU cores",
      value: translator.formatNumber(cores),
    });
  }
  if (memoryTotal !== null && memoryTotal > 0) {
    detailRows.push({
      key: "memory",
      label: "Memory",
      value: formatBytes(memoryTotal),
    });
  }
  if (row?.haState) {
    detailRows.push({
      key: "ha",
      label: "HA state",
      value: row.haState,
      description: PROXMOX_METRIC_DESCRIPTIONS.nodeHaState,
    });
  }
  detailRows.push({
    key: "id",
    label: "Proxmox ID",
    value: props.externalId,
    mono: true,
    copyText: props.externalId,
  });
  const lastReport: Date | null = toProxmoxDate(row?.lastSeenAt);
  if (lastReport) {
    detailRows.push({
      key: "last-report",
      label: "Last report",
      value: OneUptimeDate.getDateAsLocalFormattedString(lastReport),
    });
  }

  if (!row) {
    return (
      <div className="space-y-6">
        <p
          className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
          data-testid="proxmox-node-not-reported"
        >
          {tx(
            "Node details not reported yet. Make sure the Proxmox agent is sending metrics.",
          )}
        </p>
        {props.footer}
      </div>
    );
  }

  return (
    <div data-testid="proxmox-node-overview">
      <NeedsAttentionCard
        testId="proxmox-node-attention"
        items={attentionItems}
        current={{ key: `Node:${props.externalId}`, label: THIS_NODE }}
        description="What on this node, its guests and its storage is broken or needs a look, the most urgent first."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="proxmox-node-tiles"
      >
        <GoldenMetricTile
          title={tx("CPU")}
          icon={IconProp.CPUChip}
          iconColor="blue"
          value={formatPercent(cpu)}
          sublabel={
            cpu !== null && cores !== null && cores > 0
              ? translator.translatePlural(
                  { one: "of {{count}} core", other: "of {{count}} cores" },
                  cores,
                )
              : undefined
          }
          percent={cpu}
          thresholds={{ warn: 80, danger: 90 }}
          description={PROXMOX_METRIC_DESCRIPTIONS.nodeCpu}
        />
        <GoldenMetricTile
          title={tx("Memory")}
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatPercent(memoryPercent)}
          sublabel={
            memoryUsed !== null && memoryTotal !== null
              ? translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatBytes(memoryUsed),
                  total: formatBytes(memoryTotal),
                })
              : undefined
          }
          percent={memoryPercent}
          thresholds={{ warn: 80, danger: 95 }}
          description={PROXMOX_METRIC_DESCRIPTIONS.nodeMemory}
        />
        <GoldenMetricTile
          title={tx("Root Disk")}
          icon={IconProp.Database}
          iconColor="amber"
          value={formatPercent(diskPercent)}
          sublabel={
            diskUsed !== null && diskTotal !== null
              ? translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatBytes(diskUsed),
                  total: formatBytes(diskTotal),
                })
              : undefined
          }
          percent={diskPercent}
          thresholds={{ warn: 80, danger: 90 }}
          description={PROXMOX_METRIC_DESCRIPTIONS.nodeRootDisk}
        />
        <GoldenMetricTile
          title={tx("Guests")}
          icon={IconProp.Cube}
          iconColor="sky"
          value={
            guestSummary.total > 0
              ? `${guestSummary.running}/${guestSummary.total}`
              : "—"
          }
          sublabel={
            guestSummary.templates > 0
              ? translator.translatePlural(
                  {
                    one: "running · {{count}} template",
                    other: "running · {{count}} templates",
                  },
                  guestSummary.templates,
                )
              : tx("running")
          }
          description={PROXMOX_METRIC_DESCRIPTIONS.nodeGuests}
        />
      </div>

      <ResourcePartOpenEventsCard
        testId="proxmox-node-open"
        title="Open on this node"
        description="Unresolved incidents and alerts about this node, incidents first."
        resourceRelation="proxmoxClusters"
        resourceId={props.clusterId}
        isAbout={(record: OpenIssueRecord): boolean => {
          return isProxmoxIssueAbout(record, nodeIssueRow);
        }}
        getIncidentRoute={props.routes.getIncidentRoute}
        getAlertRoute={props.routes.getAlertRoute}
        incidentsRoute={props.routes.incidentsRoute}
        alertsRoute={props.routes.alertsRoute}
        refreshToken={props.refreshToken}
      />

      <ProxmoxBusiestGuestsCard
        guests={busiest}
        summary={guestSummary}
        getGuestRoute={(externalId: string) => {
          return props.routes.getPartRoute("Guest", externalId);
        }}
        onShowAll={props.onShowGuests}
      />

      <ResourcePartAlertsCard
        testId="proxmox-node-alerts"
        title="Node alerts"
        description="The cluster's alerts that watch every node, this one included: each is one monitor that fires for any node that crosses it."
        resourceType={MonitorRecommendationResourceType.Proxmox}
        templateIds={PROXMOX_NODE_ALERT_TEMPLATE_IDS}
        resourceId={props.clusterId}
        resourceIdentifier={props.clusterName}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="proxmox-node-details"
        description="What Proxmox VE reports about this node."
        rows={detailRows}
      />

      {props.footer}
    </div>
  );
};

export default ProxmoxNodeOverview;
