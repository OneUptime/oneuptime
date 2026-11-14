import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  percentOf,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import { OpenStackVolumeList } from "../../../Components/OpenStack/OpenStackLists";
import {
  formatOpenStackBytes,
  formatOpenStackPercent,
} from "../../../Components/OpenStack/OpenStackResourceList";
import OpenStackBlastRadiusCard from "../../../Components/OpenStack/Part/OpenStackBlastRadiusCard";
import OpenStackStoragePoolCephCard from "../../../Components/OpenStack/Part/OpenStackStoragePoolCephCard";
import OpenStackForecastTile from "../../../Components/OpenStack/Part/OpenStackForecastTile";
import { getOpenStackMetricQuery } from "../../../Components/OpenStack/Part/OpenStackMetricQueries";
import {
  OpenStackPartAlerts,
  OpenStackPartOpenEvents,
} from "../../../Components/OpenStack/Part/OpenStackPartActivity";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../../../Components/ResourcePart/ResourceAttention";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import { getOpenStackAttentionItems } from "../Utils/OpenStackHealth";
import {
  countOpenStackRows,
  fetchOpenStackStoragePoolForecast,
} from "../Utils/OpenStackPartData";
import {
  OPENSTACK_STORAGE_POOL_ALERT_TEMPLATE_IDS,
  OpenStackForecast,
  getOpenStackPartExplanation,
} from "../Utils/OpenStackPartFacts";
import {
  getOpenStackFactNumber,
  getOpenStackFactText,
} from "../Utils/OpenStackResourceUtils";

/*
 * One Cinder pool: how full it is at the storage pool templates' two lines, what is free,
 * and when it fills at its recent growth. Only a probe with a credential Cinder tells knows
 * which pool a volume is on, and then the Volumes tab lists them. Without that this page can't
 * say what is on it and says so, rather than reading as a pool that holds none.
 */
const VOLUMES_UNKNOWN: string = translationKey(
  "Nothing collected says which pool a volume is on, so this page can't say which volumes are here or whose they are. A probe reads it with a credential Cinder treats as an admin, and openstack volume list --long shows it.",
);

const StoragePoolOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();

  const forecast: OpenStackRead<OpenStackForecast> =
    useOpenStackRead<OpenStackForecast>(() => {
      return fetchOpenStackStoragePoolForecast({
        cloudName: part.cloudName,
        pool: row,
      });
    }, [part.externalId, part.refreshToken]);

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [row],
    now,
    routeFor: part.routes.routeFor,
  });

  const explanation: string | null = getOpenStackPartExplanation(row, now);
  const percent: number | null = percentOf(
    row.diskAllocatedBytes,
    row.diskCapacityBytes,
  );
  const free: number | null = getOpenStackFactNumber(row, "freeBytes");

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Pool",
      value: row.name || part.externalId,
      mono: true,
      copyText: row.name || part.externalId,
    },
  ];
  const backend: string = getOpenStackFactText(row, "backend");
  if (backend) {
    detailRows.push({ key: "backend", label: "Backend", value: backend });
  }
  const vendor: string = getOpenStackFactText(row, "vendor");
  if (vendor) {
    detailRows.push({ key: "vendor", label: "Vendor", value: vendor });
  }
  if (row.regionName) {
    detailRows.push({ key: "region", label: "Region", value: row.regionName });
  }

  return (
    <div data-testid="openstack-storage-pool-overview">
      {explanation ? (
        <OpenStackPartNotice
          testId="openstack-storage-pool-explanation"
          tone="warning"
          text={explanation}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-storage-pool-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.StoragePool}/${part.externalId}`,
          label: translationKey("This storage pool"),
        }}
        description="What about this pool is broken or needs a look."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="openstack-storage-pool-tiles"
      >
        <GoldenMetricTile
          title="Used"
          icon={IconProp.Database}
          iconColor="amber"
          value={
            percent === null
              ? "—"
              : formatOpenStackPercent(percent, {
                  language: translator.language,
                })
          }
          sublabel={
            percent === null
              ? "Not reported"
              : translator.translateTemplate(
                  "{{used}} of {{total}}",
                  {
                    used: formatOpenStackBytes(row.diskAllocatedBytes || 0),
                    total: formatOpenStackBytes(row.diskCapacityBytes || 0),
                  },
                  // "۴۸۰ GiB" reads with its number first in a Persian sentence.
                  { setsValuesApart: true },
                )
          }
          percent={percent}
          thresholds={{
            warn: OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
            danger: OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
          }}
          description="How much of this pool is used, as the pool reports it. It turns amber and red at the Storage Pool alerts' two lines."
        />
        <GoldenMetricTile
          title="Free"
          icon={IconProp.SquareStack}
          iconColor="emerald"
          value={free === null ? "—" : formatOpenStackBytes(free)}
          sublabel={
            row.diskCapacityBytes
              ? translator.translateTemplate(
                  "of {{total}}",
                  {
                    total: formatOpenStackBytes(row.diskCapacityBytes),
                  },
                  { setsValuesApart: true },
                )
              : undefined
          }
          description="How much of this pool is free, as the pool reports it."
        />
        <OpenStackForecastTile
          forecast={forecast.data}
          description="When this pool fills up, at its growth over the last day. It says so when there isn't enough history yet to tell."
        />
      </div>

      <OpenStackPartOpenEvents
        testId="openstack-storage-pool-open"
        title="Open on this pool"
        description="Unresolved incidents and alerts about this pool, incidents first."
        part={part}
        row={row}
      />

      <OpenStackStoragePoolCephCard
        openStackCloudId={part.openStackCloudId}
        externalId={part.externalId}
        refreshToken={part.refreshToken}
      />

      <OpenStackBlastRadiusCard
        testId="openstack-storage-pool-blast"
        openStackCloudId={part.openStackCloudId}
        kind={OpenStackResourceKind.StoragePool}
        externalId={part.externalId}
        routes={part.routes}
        description="The volumes on this pool, and the projects they belong to."
        unknownText={VOLUMES_UNKNOWN}
        refreshToken={part.refreshToken}
      />

      <OpenStackPartAlerts
        testId="openstack-storage-pool-alerts"
        title="Storage pool alerts"
        description="The cloud's alerts that watch every pool, this one included: each is one monitor that fires for any pool that crosses it."
        templateIds={OPENSTACK_STORAGE_POOL_ALERT_TEMPLATE_IDS}
        part={part}
      />

      <ResourcePartDetailsCard
        testId="openstack-storage-pool-details"
        description="What Cinder's scheduler reports about this pool."
        rows={detailRows}
      />
    </div>
  );
};

// A pool is named for its host and backend, and two regions can share those.
function getVolumesOfPoolQuery(row: OpenStackResource): {
  facts: JSONObject;
  regionName?: string;
} {
  return {
    facts: { pool: row.name || "" },
    ...(row.regionName ? { regionName: row.regionName } : {}),
  };
}

const OpenStackCloudStoragePoolDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(
    OpenStackResourceKind.StoragePool,
  );
  const row: OpenStackResource | null = part.row;

  // Whether anything says which volumes are here. Nothing is what the agent's exporter says.
  const volumeCount: OpenStackRead<number> = useOpenStackRead<number>(() => {
    return row?.name
      ? countOpenStackRows({
          openStackCloudId: part.openStackCloudId,
          kind: OpenStackResourceKind.Volume,
          query: getVolumesOfPoolQuery(row),
        })
      : Promise.resolve(0);
  }, [row?.name, row?.regionName, part.refreshToken]);

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        return <StoragePoolOverview part={part} row={row} />;
      }}
      tabs={(tabRow: OpenStackResource): Array<Tab> => {
        const attributes: Record<string, string> = { name: tabRow.name || "" };
        return [
          ...(volumeCount.data
            ? [
                {
                  name: "Volumes",
                  children: (
                    <OpenStackVolumeList
                      openStackCloudId={part.openStackCloudId}
                      query={getVolumesOfPoolQuery(tabRow)}
                      tableId="openstack-storage-pool-volumes-table"
                      title="Volumes on this pool"
                      description="The Cinder volumes on this pool, as Cinder says of each."
                      emptyTitle="No volumes on this pool"
                      emptyDescription="Cinder says no volume is on this pool, or this credential can't see the ones that are. Only the Full view credential sees every project's."
                    />
                  ),
                },
              ]
            : []),
          {
            name: "Metrics",
            children: (
              <Card
                title="Capacity over time"
                description="What this pool holds and what it has free, over the selected time range."
              >
                <ResourceMetricsTab
                  queryConfigs={[
                    getOpenStackMetricQuery({
                      part,
                      variable: "pool_free",
                      title: "Free",
                      description: "How much of this pool is free.",
                      metricName: "openstack_cinder_pool_capacity_free_gb",
                      legend: "Free",
                      legendUnit: "GiB",
                      attributes,
                    }),
                    getOpenStackMetricQuery({
                      part,
                      variable: "pool_total",
                      title: "Total",
                      description: "How much this pool holds.",
                      metricName: "openstack_cinder_pool_capacity_total_gb",
                      legend: "Total",
                      legendUnit: "GiB",
                      attributes,
                    }),
                  ]}
                />
              </Card>
            ),
          },
        ];
      }}
    />
  );
};

export default OpenStackCloudStoragePoolDetail;
