import React, { FunctionComponent, ReactElement } from "react";
import CephResource from "Common/Models/DatabaseModels/CephResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import { CEPH_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/CephMetricDescriptions";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../ResourcePart/ResourcePartDetailsCard";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import { ResourceAttentionItem } from "../../ResourcePart/ResourceAttention";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import {
  CephOsdReadings,
  formatCephLatency,
  getCephAttentionItems,
  getCephAttentionKey,
  getCephOsdReadings,
  isCephIssueAbout,
  toCephDate,
} from "../../../Pages/Ceph/Utils/CephHealth";
import {
  CEPH_OSD_ALERT_TEMPLATE_IDS,
  THIS_OSD_LABEL,
  getCephOsdLatencyTone,
  getCephOsdUsedTone,
  toCephTileTone,
} from "../../../Pages/Ceph/Utils/CephPartFacts";
import {
  formatBytes,
  getOsdPlacementText,
} from "../../../Pages/Ceph/Utils/CephResourceUtils";
import { CephPartRoutes } from "./CephPartRoutes";

/*
 * An OSD's Overview: whether it needs attention and why (CephHealth, as the
 * cluster's Needs attention says it), how full it is and how fast it writes
 * against its alerts' lines, what is open on it, whether the cluster's OSD
 * alerts watch it, and what Ceph reports about it.
 */

export interface ComponentProps {
  clusterId: ObjectID;
  clusterName: string;
  externalId: string;
  row: CephResource | null;
  newestSeenAt: Date | null;
  routes: CephPartRoutes;
  now: Date;
  refreshToken?: number | undefined;
}

function formatShare(percent: number | null): string {
  return percent === null ? "—" : `${percent.toFixed(1)}%`;
}

const CephOsdOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const row: CephResource | null = props.row;

  if (!row) {
    return (
      <p
        className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
        data-testid="ceph-osd-not-reported"
      >
        {translator.translateTemplate(
          "OSD {{osdName}} is not in the inventory yet. It appears here a few minutes after the Ceph agent starts sending metrics.",
          { osdName: props.externalId },
        )}
      </p>
    );
  }

  const attentionItems: Array<ResourceAttentionItem> = getCephAttentionItems({
    rows: [row],
    routeFor: props.routes.getPartRoute,
    now: props.now,
    newestSeenAt: props.newestSeenAt,
  });

  // A down OSD's readings are its last ones, not what it does now.
  const readings: CephOsdReadings | null =
    row.isUp === true ? getCephOsdReadings(row, props.now) : null;

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "OSD",
      value: props.externalId,
      mono: true,
      copyText: props.externalId,
    },
  ];

  if (row.hostname) {
    detailRows.push({
      key: "host",
      label: "Host",
      value: row.hostname,
      copyText: row.hostname,
    });
  }

  if (row.isIn === true || row.isIn === false) {
    detailRows.push({
      key: "placement",
      label: "Placement",
      value: tx(getOsdPlacementText(row.isIn)),
      description: CEPH_METRIC_DESCRIPTIONS.osdPlacement,
    });
  }

  if (row.deviceClass) {
    detailRows.push({
      key: "device-class",
      label: "Device Class",
      value: row.deviceClass,
    });
  }

  if (row.daemonVersion) {
    detailRows.push({
      key: "version",
      label: "Version",
      value: row.daemonVersion,
      mono: true,
      copyText: row.daemonVersion,
    });
  }

  const lastReport: Date | null = toCephDate(row.lastSeenAt);
  if (lastReport) {
    detailRows.push({
      key: "last-report",
      label: "Last report",
      value: OneUptimeDate.getDateAsLocalFormattedString(lastReport),
    });
  }

  return (
    <div data-testid="ceph-osd-overview">
      <NeedsAttentionCard
        testId="ceph-osd-attention"
        items={attentionItems}
        current={{
          key: getCephAttentionKey("Osd", props.externalId),
          label: THIS_OSD_LABEL,
        }}
        description="What about this OSD is broken or needs a look."
      />

      {/*
       * What it holds and how fast it writes now: a down OSD sends no
       * reading that says so.
       */}
      {readings ? (
        <div
          className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3"
          data-testid="ceph-osd-tiles"
        >
          <GoldenMetricTile
            title={tx("Used")}
            icon={IconProp.Disc}
            iconColor="blue"
            value={formatShare(readings.usedPercent)}
            sublabel={
              readings.usedBytes !== null && readings.totalBytes !== null
                ? translator.translateTemplate(
                    "{{used}} of {{total}}",
                    {
                      used: formatBytes(readings.usedBytes),
                      total: formatBytes(readings.totalBytes),
                    },
                    // Each size reads as written in a Persian sentence.
                    { setsValuesApart: true },
                  )
                : undefined
            }
            percent={readings.usedPercent}
            tone={
              readings.usedPercent === null
                ? undefined
                : toCephTileTone(getCephOsdUsedTone(readings.usedPercent))
            }
            description={CEPH_METRIC_DESCRIPTIONS.osdUsedTile}
          />
          <GoldenMetricTile
            title={tx("Apply Latency")}
            icon={IconProp.Clock}
            iconColor="amber"
            value={
              readings.applyLatencyMs === null
                ? "—"
                : formatCephLatency(readings.applyLatencyMs)
            }
            sublabel={
              readings.commitLatencyMs === null
                ? undefined
                : translator.translateTemplate(
                    "Commit latency {{latency}}",
                    { latency: formatCephLatency(readings.commitLatencyMs) },
                    { setsValuesApart: true },
                  )
            }
            tone={
              readings.applyLatencyMs === null
                ? undefined
                : toCephTileTone(getCephOsdLatencyTone(readings.applyLatencyMs))
            }
            description={CEPH_METRIC_DESCRIPTIONS.osdLatencyTile}
          />
          <GoldenMetricTile
            title={tx("Placement Groups")}
            icon={IconProp.SquareStack}
            iconColor="violet"
            value={
              readings.pgCount === null
                ? "—"
                : translator.formatNumber(Math.round(readings.pgCount))
            }
            sublabel={tx("held on this OSD")}
            description={CEPH_METRIC_DESCRIPTIONS.osdPlacementGroups}
          />
        </div>
      ) : (
        <></>
      )}

      <ResourcePartOpenEventsCard
        testId="ceph-osd-open"
        title="Open on this OSD"
        description="Unresolved incidents and alerts about this OSD, incidents first."
        resourceRelation="cephClusters"
        resourceId={props.clusterId}
        isAbout={(record: OpenIssueRecord): boolean => {
          return isCephIssueAbout(record, row);
        }}
        getIncidentRoute={props.routes.getIncidentRoute}
        getAlertRoute={props.routes.getAlertRoute}
        incidentsRoute={props.routes.incidentsRoute}
        alertsRoute={props.routes.alertsRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartAlertsCard
        testId="ceph-osd-alerts"
        title="OSD alerts"
        description="The cluster's alerts that watch its OSDs, this one included: each is one monitor that fires for any OSD that crosses it, or on the check Ceph raises about them."
        resourceType={MonitorRecommendationResourceType.Ceph}
        templateIds={CEPH_OSD_ALERT_TEMPLATE_IDS}
        resourceId={props.clusterId}
        resourceIdentifier={props.clusterName}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="ceph-osd-details"
        description="What Ceph reports about this OSD."
        rows={detailRows}
      />
    </div>
  );
};

export default CephOsdOverview;
