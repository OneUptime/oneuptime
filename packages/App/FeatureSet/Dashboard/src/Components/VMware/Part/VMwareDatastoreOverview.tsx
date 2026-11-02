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
import {
  VMWARE_DATASTORE_CRITICAL_PERCENT,
  VMWARE_DATASTORE_WARNING_PERCENT,
  getVMwareAttentionItems,
  getVMwareAttentionKey,
  getVMwareDatastorePercent,
  isVMwareIssueAbout,
  toVMwareDate,
  toVMwareNumber,
} from "../../../Pages/VMware/Utils/VMwareHealth";
import { VMWARE_DATASTORE_ALERT_TEMPLATE_IDS } from "../../../Pages/VMware/Utils/VMwarePartFacts";
import {
  formatBytes,
  formatPercent,
} from "../../../Pages/VMware/Utils/VMwareResourceUtils";
import { VMwarePartRoutes } from "./VMwarePartRoutes";

/*
 * A datastore's Overview: whether it needs attention, how full it is and
 * when it will be full at its recent growth, what is open on it, whether
 * anyone will hear when it fills, and its details. A datastore that runs
 * out of space suspends every VM that writes to it, so its fill is the
 * first thing the page says.
 */

// How the datastore's own row reads in its Needs attention card.
const THIS_DATASTORE: string = translationKey("This datastore");

export interface ComponentProps {
  vcenterId: ObjectID;
  vcenterName: string;
  externalId: string;
  row: VMwareResource | null;
  routes: VMwarePartRoutes;
  /*
   * Days until the datastore is full at its growth over the forecast
   * window; null when it is not growing or nothing says; 0 when full now.
   */
  daysToFull: number | null;
  forecastWindowHours: number;
  now: Date;
  refreshToken?: number | undefined;
}

const VMwareDatastoreOverview: FunctionComponent<ComponentProps> = (
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
        data-testid="vmware-datastore-not-reported"
      >
        {tx(
          "Datastore details not reported yet. Make sure the VMware agent is sending metrics.",
        )}
      </p>
    );
  }

  const attentionItems: Array<ResourceAttentionItem> = getVMwareAttentionItems({
    rows: [row],
    now: props.now,
    routeFor: props.routes.getPartRoute,
    listRouteFor: props.routes.getListRoute,
  });

  const used: number | null = toVMwareNumber(row.latestDiskBytes);
  const total: number | null = toVMwareNumber(row.maxDiskBytes);
  const percent: number | null = getVMwareDatastorePercent(row);
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
  if (row.datacenterName) {
    detailRows.push({
      key: "datacenter",
      label: "Datacenter",
      value: row.datacenterName,
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
    <div data-testid="vmware-datastore-overview">
      <NeedsAttentionCard
        testId="vmware-datastore-attention"
        items={attentionItems}
        current={{
          key: getVMwareAttentionKey(
            VMwareResourceKind.Datastore,
            props.externalId,
          ),
          label: THIS_DATASTORE,
        }}
        description="What about this datastore is broken or needs a look."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="vmware-datastore-tiles"
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
            warn: VMWARE_DATASTORE_WARNING_PERCENT,
            danger: VMWARE_DATASTORE_CRITICAL_PERCENT,
          }}
          description={VMWARE_METRIC_DESCRIPTIONS.datastoreUsedPercent}
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
          description={VMWARE_METRIC_DESCRIPTIONS.datastoreFree}
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
            description={VMWARE_METRIC_DESCRIPTIONS.datastoreGrowthForecast}
          />
        ) : (
          <></>
        )}
      </div>

      <ResourcePartOpenEventsCard
        testId="vmware-datastore-open"
        title="Open on this datastore"
        description="Unresolved incidents and alerts about this datastore, incidents first."
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
        testId="vmware-datastore-alerts"
        title="Datastore alerts"
        description="The vCenter's alerts that watch every datastore, this one included: each is one monitor that fires for any datastore that crosses it."
        resourceType={MonitorRecommendationResourceType.VMware}
        templateIds={VMWARE_DATASTORE_ALERT_TEMPLATE_IDS}
        resourceId={props.vcenterId}
        resourceIdentifier={props.vcenterName}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="vmware-datastore-details"
        description="What vCenter reports about this datastore."
        rows={detailRows}
      />
    </div>
  );
};

export default VMwareDatastoreOverview;
