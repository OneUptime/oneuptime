import React, { FunctionComponent, ReactElement } from "react";
import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import { PROXMOX_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/ProxmoxMetricDescriptions";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../ResourcePart/ResourcePartDetailsCard";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import { ResourceAttentionItem } from "../../ResourcePart/ResourceAttention";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import {
  PROXMOX_STORAGE_FULL_PERCENT,
  PROXMOX_STORAGE_NEAR_FULL_PERCENT,
  getProxmoxAttentionItems,
  getProxmoxStoragePercent,
  isProxmoxIssueAbout,
} from "../../../Pages/Proxmox/Utils/ProxmoxHealth";
import {
  PROXMOX_STORAGE_ALERT_TEMPLATE_IDS,
  getProxmoxStorageContentWords,
  getProxmoxStorageTypeLabel,
  toProxmoxDate,
  toProxmoxNumber,
} from "../../../Pages/Proxmox/Utils/ProxmoxPartFacts";
import {
  formatBytes,
  formatPercent,
} from "../../../Pages/Proxmox/Utils/ProxmoxResourceUtils";
import { ProxmoxPartRoutes } from "./ProxmoxPartRoutes";

/*
 * A Proxmox storage's Overview: whether it needs attention, how full it is
 * and when it will be full at its recent growth, what is open on it,
 * whether anyone will hear when it fills or goes away, and its details.
 */

export interface ComponentProps {
  clusterId: ObjectID;
  clusterName: string;
  externalId: string;
  row: ProxmoxResource | null;
  routes: ProxmoxPartRoutes;
  /*
   * Days until the storage is full at its growth over the forecast window;
   * null when it is not growing or nothing says; 0 when it is full now.
   */
  daysToFull: number | null;
  forecastWindowHours: number;
  refreshToken?: number | undefined;
}

const ProxmoxStorageOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const row: ProxmoxResource | null = props.row;

  if (!row) {
    return (
      <p
        className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
        data-testid="proxmox-storage-not-reported"
      >
        {tx(
          "Storage details not reported yet. Make sure the Proxmox agent is sending metrics.",
        )}
      </p>
    );
  }

  const attentionItems: Array<ResourceAttentionItem> = getProxmoxAttentionItems(
    {
      rows: [row],
      routeFor: props.routes.getPartRoute,
    },
  ).map((item: ResourceAttentionItem): ResourceAttentionItem => {
    // The storage's own row needs no link to the page it is on.
    return { ...item, route: undefined };
  });

  const used: number | null = toProxmoxNumber(row.latestDiskBytes);
  const total: number | null = toProxmoxNumber(row.maxDiskBytes);
  const percent: number | null = getProxmoxStoragePercent(row);
  const free: number | null =
    used !== null && total !== null ? Math.max(total - used, 0) : null;

  const days: number | null = props.daysToFull;
  const hasForecast: boolean =
    days !== null && Number.isFinite(days) && days <= 365;

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Name",
      value: row.name || props.externalId,
      copyText: row.name || undefined,
    },
  ];
  if (row.parentNodeName) {
    detailRows.push({
      key: "node",
      label: "Node",
      value: (
        <Link
          to={props.routes.getPartRoute("Node", `node/${row.parentNodeName}`)}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          {row.parentNodeName}
        </Link>
      ),
    });
  }
  if (row.storageType) {
    detailRows.push({
      key: "type",
      label: "Type",
      value: tx(getProxmoxStorageTypeLabel(row.storageType)),
    });
  }
  const content: Array<string> = getProxmoxStorageContentWords(
    row.storageContent,
  );
  if (content.length > 0) {
    detailRows.push({
      key: "content",
      label: "Content",
      value: content.map(tx).join(", "),
    });
  }
  if (row.isShared !== null && row.isShared !== undefined) {
    detailRows.push({
      key: "shared",
      label: "Shared",
      value: row.isShared ? tx("Shared") : tx("Local"),
      description: PROXMOX_METRIC_DESCRIPTIONS.storageShared,
    });
  }
  detailRows.push({
    key: "id",
    label: "Proxmox ID",
    value: props.externalId,
    mono: true,
    copyText: props.externalId,
  });
  const lastReport: Date | null = toProxmoxDate(row.lastSeenAt);
  if (lastReport) {
    detailRows.push({
      key: "last-report",
      label: "Last report",
      value: OneUptimeDate.getDateAsLocalFormattedString(lastReport),
    });
  }

  return (
    <div data-testid="proxmox-storage-overview">
      <NeedsAttentionCard
        testId="proxmox-storage-attention"
        items={attentionItems}
        description="What about this storage is broken or needs a look."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="proxmox-storage-tiles"
      >
        <GoldenMetricTile
          title={tx("Used")}
          icon={IconProp.Database}
          iconColor="amber"
          value={formatPercent(percent)}
          sublabel={
            used !== null && total !== null
              ? translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatBytes(used),
                  total: formatBytes(total),
                })
              : undefined
          }
          percent={percent}
          thresholds={{
            warn: PROXMOX_STORAGE_NEAR_FULL_PERCENT,
            danger: PROXMOX_STORAGE_FULL_PERCENT,
          }}
          description={PROXMOX_METRIC_DESCRIPTIONS.storageUsedPercent}
        />
        <GoldenMetricTile
          title={tx("Free")}
          icon={IconProp.SquareStack}
          iconColor="emerald"
          value={formatBytes(free)}
          sublabel={
            free !== null && total !== null
              ? translator.translateTemplate("of {{total}}", {
                  total: formatBytes(total),
                })
              : undefined
          }
          description={PROXMOX_METRIC_DESCRIPTIONS.storageFree}
        />
        {hasForecast ? (
          <GoldenMetricTile
            title={tx("Growth Forecast")}
            icon={IconProp.ArrowTrendingUp}
            iconColor="violet"
            value={
              days === 0
                ? tx("Full now")
                : translator.translatePlural(
                    { one: "~{{count}} day", other: "~{{count}} days" },
                    Math.max(1, Math.round(days as number)),
                  )
            }
            sublabel={
              days === 0
                ? undefined
                : translator.translatePlural(
                    {
                      one: "until full, at the last {{count}} hour's growth",
                      other: "until full, at the last {{count}} hours' growth",
                    },
                    props.forecastWindowHours,
                  )
            }
            description={PROXMOX_METRIC_DESCRIPTIONS.storageGrowthForecast}
          />
        ) : (
          <></>
        )}
      </div>

      <ResourcePartOpenEventsCard
        testId="proxmox-storage-open"
        title="Open on this storage"
        description="Unresolved incidents and alerts about this storage, incidents first."
        resourceRelation="proxmoxClusters"
        resourceId={props.clusterId}
        isAbout={(record: OpenIssueRecord): boolean => {
          return isProxmoxIssueAbout(record, row);
        }}
        getIncidentRoute={props.routes.getIncidentRoute}
        getAlertRoute={props.routes.getAlertRoute}
        incidentsRoute={props.routes.incidentsRoute}
        alertsRoute={props.routes.alertsRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartAlertsCard
        testId="proxmox-storage-alerts"
        title="Storage alerts"
        description="The cluster's alerts that watch every storage, this one included: each is one monitor that fires for any storage that crosses it."
        resourceType={MonitorRecommendationResourceType.Proxmox}
        templateIds={PROXMOX_STORAGE_ALERT_TEMPLATE_IDS}
        resourceId={props.clusterId}
        resourceIdentifier={props.clusterName}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="proxmox-storage-details"
        description="What Proxmox VE reports about this storage."
        rows={detailRows}
      />
    </div>
  );
};

export default ProxmoxStorageOverview;
