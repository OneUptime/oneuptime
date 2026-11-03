import React, { FunctionComponent, ReactElement } from "react";
import CephResource from "Common/Models/DatabaseModels/CephResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import GoldenMetricTile, {
  GoldenMetricTileTone,
} from "../../Infrastructure/GoldenMetricTile";
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
  CephPoolPgStates,
  CephPoolReadings,
  getCephAttentionItems,
  getCephAttentionKey,
  getCephPoolReadings,
  isCephIssueAbout,
  toCephDate,
} from "../../../Pages/Ceph/Utils/CephHealth";
import {
  CEPH_POOL_ALERT_TEMPLATE_IDS,
  CephPoolPgSummary,
  THIS_POOL_LABEL,
  getCephPoolPgSummary,
  getCephPoolUsedTone,
  toCephTileTone,
} from "../../../Pages/Ceph/Utils/CephPartFacts";
import {
  GrowthProjection,
  formatBytes,
} from "../../../Pages/Ceph/Utils/CephResourceUtils";
import { CephPartRoutes } from "./CephPartRoutes";

/*
 * A pool's Overview: whether it needs attention and why (CephHealth, as the
 * cluster's Needs attention says it), how full it is against the Pool Near
 * Full alert's line, its placement groups, what is open on it, whether the
 * cluster's pool alerts watch it, and what Ceph reports about it.
 */

// Below this much history a growth projection says it rests on little.
export const CEPH_GROWTH_CONFIDENT_SPAN_MS: number = 2 * 60 * 60 * 1000;

export interface ComponentProps {
  clusterId: ObjectID;
  clusterName: string;
  externalId: string;
  row: CephResource | null;
  newestSeenAt: Date | null;
  // Its placement groups by state; null when they could not be read.
  pgStates: CephPoolPgStates | null;
  // When it fills at the last day's growth; null while unknown.
  growth: GrowthProjection | null;
  routes: CephPartRoutes;
  now: Date;
  refreshToken?: number | undefined;
}

function formatShare(percent: number | null): string {
  return percent === null ? "—" : `${percent.toFixed(1)}%`;
}

/*
 * When the pool fills at the last day's growth, in the reader's words; null
 * when it is not growing or there is too little history to say.
 */
export function getCephPoolGrowthText(
  growth: GrowthProjection | null,
  translator: Translator,
): string | null {
  if (!growth || growth.daysToTarget === null) {
    return null;
  }
  if (growth.daysToTarget === 0) {
    return (
      translator.translateText("At capacity: no writable space left") ||
      "At capacity: no writable space left"
    );
  }
  if (!Number.isFinite(growth.daysToTarget)) {
    return null;
  }
  const projection: string =
    growth.daysToTarget > 365
      ? translator.translateText("Full in more than a year at this growth") ||
        "Full in more than a year at this growth"
      : translator.translatePlural(
          {
            one: "Full in about {{count}} day at this growth",
            other: "Full in about {{count}} days at this growth",
          },
          Math.max(1, Math.round(growth.daysToTarget)),
        );
  if (growth.sampleSpanMs < CEPH_GROWTH_CONFIDENT_SPAN_MS) {
    return translator.translateTemplate(
      "{{projection}} (under 2 hours of history)",
      { projection: projection },
    );
  }
  return projection;
}

const CephPoolOverview: FunctionComponent<ComponentProps> = (
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
        data-testid="ceph-pool-not-reported"
      >
        {translator.translateTemplate(
          "Pool {{poolId}} is not in the inventory yet. It appears here a few minutes after the Ceph agent starts sending metrics.",
          { poolId: props.externalId },
        )}
      </p>
    );
  }

  const attentionItems: Array<ResourceAttentionItem> = getCephAttentionItems({
    rows: [row],
    pgStatesByPool: props.pgStates
      ? new Map([[props.externalId, props.pgStates]])
      : null,
    routeFor: props.routes.getPartRoute,
    now: props.now,
    newestSeenAt: props.newestSeenAt,
  });

  const readings: CephPoolReadings = getCephPoolReadings(row, props.now);
  const pgSummary: CephPoolPgSummary | null = getCephPoolPgSummary(
    props.pgStates,
  );
  const inactive: number =
    props.pgStates &&
    props.pgStates.total !== null &&
    props.pgStates.active !== null
      ? Math.max(0, Math.round(props.pgStates.total - props.pgStates.active))
      : 0;
  const pgTone: GoldenMetricTileTone | undefined = pgSummary
    ? inactive > 0
      ? "danger"
      : pgSummary.clean < pgSummary.total
        ? "warning"
        : "positive"
    : undefined;
  const growthText: string | null = getCephPoolGrowthText(
    props.growth,
    translator,
  );

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Pool",
      value: row.name || props.externalId,
      copyText: row.name || undefined,
    },
    {
      key: "pool-id",
      label: "Pool ID",
      value: props.externalId,
      mono: true,
      copyText: props.externalId,
    },
  ];

  if (readings.storedBytes !== null) {
    detailRows.push({
      key: "stored",
      label: "Stored",
      value: formatBytes(readings.storedBytes),
      description: CEPH_METRIC_DESCRIPTIONS.poolStored,
    });
  }

  if (readings.maxAvailBytes !== null) {
    detailRows.push({
      key: "max-available",
      label: "Max Available",
      value: formatBytes(readings.maxAvailBytes),
      description: CEPH_METRIC_DESCRIPTIONS.poolMaxAvail,
    });
  }

  if (growthText) {
    detailRows.push({
      key: "growth",
      label: "Time to Full",
      value: growthText,
      description: CEPH_METRIC_DESCRIPTIONS.poolGrowth,
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
    <div data-testid="ceph-pool-overview">
      <NeedsAttentionCard
        testId="ceph-pool-attention"
        items={attentionItems}
        current={{
          key: getCephAttentionKey("Pool", props.externalId),
          label: THIS_POOL_LABEL,
        }}
        description="What about this pool is broken or needs a look."
      />

      {readings.usedPercent !== null || pgSummary ? (
        <div
          className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3"
          data-testid="ceph-pool-tiles"
        >
          <GoldenMetricTile
            title={tx("Used")}
            icon={IconProp.Database}
            iconColor="blue"
            value={formatShare(readings.usedPercent)}
            sublabel={
              readings.storedBytes !== null && readings.maxAvailBytes !== null
                ? translator.translateTemplate("{{used}} of {{total}}", {
                    used: formatBytes(readings.storedBytes),
                    total: formatBytes(
                      readings.storedBytes + readings.maxAvailBytes,
                    ),
                  })
                : undefined
            }
            percent={readings.usedPercent}
            tone={
              readings.usedPercent === null
                ? undefined
                : toCephTileTone(getCephPoolUsedTone(readings.usedPercent))
            }
            description={CEPH_METRIC_DESCRIPTIONS.poolUsedTile}
          />
          <GoldenMetricTile
            title={tx("Placement Groups")}
            icon={IconProp.SquareStack}
            iconColor="violet"
            value={pgSummary ? translator.formatNumber(pgSummary.total) : "—"}
            sublabel={
              pgSummary
                ? pgSummary.clean >= pgSummary.total
                  ? tx("All active + clean")
                  : translator.translatePlural(
                      {
                        one: "{{count}} not active + clean",
                        other: "{{count}} not active + clean",
                      },
                      pgSummary.total - pgSummary.clean,
                    )
                : undefined
            }
            percent={
              pgSummary ? (pgSummary.clean / pgSummary.total) * 100 : null
            }
            tone={pgTone}
            description={CEPH_METRIC_DESCRIPTIONS.poolPgsTile}
          />
          <GoldenMetricTile
            title={tx("Objects")}
            icon={IconProp.Cube}
            iconColor="sky"
            value={
              readings.objects === null
                ? "—"
                : translator.formatNumber(Math.round(readings.objects))
            }
            sublabel={tx("RADOS objects")}
            description={CEPH_METRIC_DESCRIPTIONS.poolObjects}
          />
        </div>
      ) : (
        <></>
      )}

      <ResourcePartOpenEventsCard
        testId="ceph-pool-open"
        title="Open on this pool"
        description="Unresolved incidents and alerts about this pool, incidents first."
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
        testId="ceph-pool-alerts"
        title="Pool alerts"
        description="The cluster's alerts that watch its pools, this one included: each is one monitor that fires for any pool that crosses it."
        resourceType={MonitorRecommendationResourceType.Ceph}
        templateIds={CEPH_POOL_ALERT_TEMPLATE_IDS}
        resourceId={props.clusterId}
        resourceIdentifier={props.clusterName}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="ceph-pool-details"
        description="What Ceph reports about this pool."
        rows={detailRows}
      />
    </div>
  );
};

export default CephPoolOverview;
