import React, { FunctionComponent, ReactElement } from "react";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import DashboardCephPoolListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardCephPoolListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import {
  ResourceListColumn,
  ResourceListNameCell,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import DashboardModelResourceListBase from "../../Infrastructure/DashboardModelResourceListBase";
import { formatMemoryValue } from "../../Infrastructure/ResourceMemoryValue";
import IconProp from "Common/Types/Icon/IconProp";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import CephResource from "Common/Models/DatabaseModels/CephResource";
import JSONFunctions from "Common/Types/JSONFunctions";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { AttributeToColumnMap } from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";
import {
  HoneycombLegendItem,
  HoneycombTile,
} from "./DashboardResourceHoneycomb";
import { getValueOrQuietDash } from "Common/UI/Components/Table/TableEmptyValue";
import StorageUsageBar, {
  StorageUsageBarSize,
} from "Common/UI/Components/StorageUsage/StorageUsageBar";
import {
  StorageUsage,
  StorageUsageLevel,
  formatStorageUsedPercent,
} from "Common/Utils/Storage/StorageUsage";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import { getCephPoolStorageUsage } from "../../../Pages/Ceph/Utils/CephPartFacts";
import {
  CEPH_POOL_FULL_PERCENT,
  CEPH_POOL_NEARFULL_PERCENT,
  toCephNumber,
} from "../../../Pages/Ceph/Utils/CephHealth";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * `pool_id` is the datapoint label every per-pool data series carries
 * (the pool NAME only exists on ceph_pool_metadata) and is stored
 * verbatim as CephResource.externalId, so a dashboard variable bound to
 * pool_id narrows this list too.
 */
const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  pool_id: "externalId",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardCephPoolListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Pool", widthPct: "26%", sortKey: "name" },
  { label: "Stored", widthPct: "14%", sortKey: "stored" },
  { label: "Used", widthPct: "28%" },
  { label: "Objects", widthPct: "14%", sortKey: "objects" },
  { label: "Cluster", widthPct: "18%", sortKey: "cluster" },
];

// A pool's tile by how full it is, in the shared bar's colours.
const POOL_USAGE_COLORS: Record<StorageUsageLevel, string> = {
  [StorageUsageLevel.Normal]: "#10b981",
  [StorageUsageLevel.Warning]: "#f59e0b",
  [StorageUsageLevel.Critical]: "#ef4444",
};
const POOL_USAGE_UNKNOWN_COLOR: string = "#d1d5db";

/*
 * What the tiles' colours mean, at Ceph's own lines (#9646): amber past the
 * Pool Near Full alert's 85%, red past 95% - as the Pools list and the
 * cluster's Needs attention colour a pool - in the reader's digits.
 */
export function getCephPoolWidgetLegend(
  translator: Translator,
): Array<HoneycombLegendItem> {
  const percent: (value: number) => string = (value: number): string => {
    return formatReaderFigure(value, {
      decimals: 0,
      isPercent: true,
      language: translator.language,
    });
  };

  return [
    {
      label: translator.translateTemplate("Up to {{percent}} used", {
        percent: percent(CEPH_POOL_NEARFULL_PERCENT),
      }),
      color: POOL_USAGE_COLORS[StorageUsageLevel.Normal],
      isLabelUserContent: true,
    },
    {
      label: translator.translateTemplate("Past {{percent}} used", {
        percent: percent(CEPH_POOL_NEARFULL_PERCENT),
      }),
      color: POOL_USAGE_COLORS[StorageUsageLevel.Warning],
      isLabelUserContent: true,
    },
    {
      label: translator.translateTemplate("Past {{percent}} used", {
        percent: percent(CEPH_POOL_FULL_PERCENT),
      }),
      color: POOL_USAGE_COLORS[StorageUsageLevel.Critical],
      isLabelUserContent: true,
    },
    { label: "Unknown", color: POOL_USAGE_UNKNOWN_COLOR },
  ];
}

const BASE_SELECT: Select<CephResource> = {
  _id: true,
  name: true,
  externalId: true,
  storedBytes: true,
  maxAvailBytes: true,
  objects: true,
  lastSeenAt: true,
  cephClusterId: true,
  cephCluster: {
    name: true,
  },
};

/*
 * Pool rows and tiles deep-link to the pool detail page; the route's
 * SubModelID is the CephResource externalId (the `pool_id` datapoint
 * label) — mirroring Pages/Ceph/View/Pools.tsx. Falls back to the
 * cluster's Pools list when the externalId hasn't been ingested yet.
 */
function getPoolRoute(r: CephResource): Route | undefined {
  const clusterId: string = (r.cephClusterId?.toString() as string) || "";
  if (!clusterId) {
    return undefined;
  }
  const poolId: string = (r.externalId as string) || "";
  if (!poolId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.CEPH_CLUSTER_VIEW_POOLS] as Route,
      { modelId: new ObjectID(clusterId) },
    );
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL] as Route,
    {
      modelId: new ObjectID(clusterId),
      subModelId: new ObjectID(poolId),
    },
  );
}

/*
 * How full a pool is, as the shared storage bar reads it: STORED of STORED +
 * MAX AVAIL, both counted once before replication, so the percent is the
 * Pool Near Full alert's and the Pools list's. Null when the pool reported
 * neither.
 */
export function getCephPoolWidgetUsage(
  r: Pick<CephResource, "storedBytes" | "maxAvailBytes">,
): StorageUsage | null {
  return getCephPoolStorageUsage({
    storedBytes: toCephNumber(r.storedBytes),
    maxAvailBytes: toCephNumber(r.maxAvailBytes),
  });
}

function formatBytes(value: number | undefined): string {
  const numeric: number = Number(value);
  if (value === undefined || value === null || !Number.isFinite(numeric)) {
    return EMPTY_VALUE_MARK;
  }
  return formatMemoryValue(numeric);
}

function formatObjects(value: number | undefined): string {
  const numeric: number = Number(value);
  if (value === undefined || value === null || !Number.isFinite(numeric)) {
    return EMPTY_VALUE_MARK;
  }
  // In the reader's digits, the scale letter kept ("1,2M", "۸۳۰٫۰K").
  if (numeric >= 1_000_000) {
    return `${formatReaderFigure(numeric / 1_000_000, { decimals: 1 })}M`;
  }
  if (numeric >= 1_000) {
    return `${formatReaderFigure(numeric / 1_000, { decimals: 1 })}K`;
  }
  return formatReaderFigure(numeric, { decimals: 0 });
}

function getPoolDisplayName(r: CephResource): string {
  /*
   * `name` comes from ceph_pool_metadata; externalId is the numeric
   * pool_id, shown only until the metadata series has been ingested.
   */
  return (r.name as string) || `pool ${(r.externalId as string) || "?"}`;
}

function renderPoolRow(r: CephResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = getPoolDisplayName(r);
  const clusterName: string | undefined = r.cephCluster?.name as string;
  const route: Route | undefined = getPoolRoute(r);

  let detailLink: ReactElement = <span>{name}</span>;
  if (route) {
    detailLink = (
      <AppLink
        to={route}
        className="hover:underline text-gray-700 group-hover:text-blue-600"
      >
        {name}
      </AppLink>
    );
  }

  return (
    <tr
      key={id}
      className="hover:bg-gray-50/50 transition-colors duration-100 group"
    >
      <ResourceListNameCell
        name={name}
        className="px-3 py-2 text-xs text-gray-700 truncate"
      >
        {detailLink}
      </ResourceListNameCell>
      <td className="px-3 py-2 text-xs text-gray-500">
        {getValueOrQuietDash(formatBytes(r.storedBytes as number | undefined), {
          isSmall: true,
        })}
      </td>
      <td className="px-3 py-2">
        <StorageUsageBar
          usage={getCephPoolWidgetUsage(r)}
          size={StorageUsageBarSize.Inline}
        />
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {getValueOrQuietDash(formatObjects(r.objects as number | undefined), {
          isSmall: true,
        })}
      </td>
      <ResourceListNameCell
        name={clusterName}
        className="px-3 py-2 text-xs text-gray-500 truncate"
      />
    </tr>
  );
}

function buildPoolTile(r: CephResource, translator: Translator): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = getPoolDisplayName(r);
  const usage: StorageUsage | null = getCephPoolWidgetUsage(r);
  const clusterName: string | undefined = r.cephCluster?.name as string;

  return {
    id: id || name,
    // Worded here, in the reader's language and digits; "Unknown" is looked up.
    status: usage
      ? translator.translateTemplate("{{percent}} used", {
          percent: formatStorageUsedPercent(usage, translator.language),
        })
      : "Unknown",
    isStatusUserContent: Boolean(usage),
    color: usage ? POOL_USAGE_COLORS[usage.level] : POOL_USAGE_UNKNOWN_COLOR,
    route: getPoolRoute(r),
    tooltip: {
      title: name,
      details: [
        {
          label: "Stored",
          value: formatBytes(r.storedBytes as number | undefined),
        },
        {
          label: "Objects",
          value: formatObjects(r.objects as number | undefined),
        },
        { label: "Cluster", value: clusterName },
      ],
    },
  };
}

const DashboardCephPoolListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  const args: DashboardCephPoolListComponent["arguments"] =
    props.component.arguments;

  const query: Query<CephResource> = {
    kind: "Pool",
  } as Query<CephResource>;

  if (args.cephClusterIds && args.cephClusterIds.length > 0) {
    (query as Record<string, unknown>)["cephClusterId"] = new Includes(
      args.cephClusterIds,
    );
  }

  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  return (
    <DashboardModelResourceListBase<CephResource>
      modelType={CephResource}
      componentId={props.componentId}
      publicResourceType="ceph-resource"
      title={args.title}
      countLabel={{
        one: "{{count}} pool",
        other: "{{count}} pools",
      }}
      emptyMessage="No Ceph pools found"
      emptyIcon={IconProp.Database}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      componentType={DashboardComponentType.CephPoolList}
      widgetProps={props}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={ATTRIBUTE_TO_COLUMN}
      renderRow={renderPoolRow}
      viewMode={viewMode}
      renderHoneycombTile={(r: CephResource): HoneycombTile => {
        return buildPoolTile(r, translator);
      }}
      honeycombLegend={getCephPoolWidgetLegend(translator)}
    />
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(prev.component.arguments, next.component.arguments)
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(prev.variables, next.variables);
}

export default React.memo(DashboardCephPoolListComponentElement, arePropsEqual);
