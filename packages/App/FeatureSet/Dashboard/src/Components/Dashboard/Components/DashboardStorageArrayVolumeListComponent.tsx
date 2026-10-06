import React, { FunctionComponent, ReactElement } from "react";
import DashboardStorageArrayVolumeListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardStorageArrayVolumeListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import DashboardModelResourceListBase from "../../Infrastructure/DashboardModelResourceListBase";
import IconProp from "Common/Types/Icon/IconProp";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
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
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";
import {
  StorageArrayWidgetState,
  VOLUME_LATENCY_COLORS,
  formatIops,
  formatLatencyUsec,
  formatStorageBytes,
  getTotalIops,
  getVolumeLatencyState,
} from "./StorageArrayWidgetData";

/*
 * `name` is the datapoint label every per-volume series carries
 * (purefa_volume_performance_*, purefa_volume_space_*) and is stored verbatim
 * as StorageArrayResource.externalId, so a dashboard variable bound to `name`
 * narrows this list too. This map must stay byte-identical to
 * STORAGE_ARRAY_VOLUME_ATTRIBUTE_TO_COLUMN in
 * Common/Server/Utils/Dashboard/PublicDashboardResourceListPolicy.ts — on
 * public dashboards the server copy is the one that is applied.
 */
const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  name: "externalId",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardStorageArrayVolumeListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Volume", widthPct: "26%" },
  { label: "Used / Provisioned", widthPct: "22%" },
  { label: "Latency (R / W)", widthPct: "20%" },
  { label: "IOPS", widthPct: "12%" },
  { label: "Array", widthPct: "20%" },
];

/*
 * Volumes are colored by the slower of their read and write latency — the
 * figure a volume's users feel — banded at the latency alert templates'
 * threshold (StorageArrayWidgetData).
 */
const VOLUME_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Under 1 ms", color: VOLUME_LATENCY_COLORS.fast },
  { label: "1–5 ms", color: VOLUME_LATENCY_COLORS.slow },
  { label: "Over 5 ms", color: VOLUME_LATENCY_COLORS.high },
  { label: "No data", color: VOLUME_LATENCY_COLORS.noData },
];

/*
 * Server select (PublicDashboardResourceListPolicy.selectForComponent,
 * StorageArrayVolumeList case) plus lastSeenAt. On public dashboards the
 * server select is authoritative and this one is ignored, so keep the two in
 * step — never add a column here without adding it there.
 */
const BASE_SELECT: Select<StorageArrayResource> = {
  _id: true,
  name: true,
  externalId: true,
  kind: true,
  groupName: true,
  capacityBytes: true,
  usedBytes: true,
  readLatencyUsec: true,
  writeLatencyUsec: true,
  readIops: true,
  writeIops: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
  storageArrayId: true,
  storageArray: {
    name: true,
  },
};

/*
 * Volume rows and tiles deep-link to the volume detail page. The detail-route
 * param is the inventory externalId — the volume's name, which carries a
 * "/" inside a volume group and "::" inside a pod — percent-encoded as a
 * single path segment. Rows without an externalId fall back to the array's
 * Volumes list.
 */
function getVolumeRoute(r: StorageArrayResource): Route | undefined {
  const arrayId: string = (r.storageArrayId?.toString() as string) || "";
  if (!arrayId) {
    return undefined;
  }
  const externalId: string = (r.externalId as string) || "";
  if (!externalId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.STORAGE_ARRAY_VIEW_VOLUMES] as Route,
      { modelId: new ObjectID(arrayId) },
    );
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL] as Route,
    {
      modelId: new ObjectID(arrayId),
      subModelId: encodeURIComponent(externalId),
    },
  );
}

function getVolumeDisplayName(r: StorageArrayResource): string {
  return (r.name as string) || (r.externalId as string) || "Unnamed";
}

function formatUsedOfProvisioned(r: StorageArrayResource): string {
  return translateTemplate("{{used}} of {{provisioned}}", {
    used: formatStorageBytes(r.usedBytes),
    provisioned: formatStorageBytes(r.capacityBytes),
  });
}

function formatReadWriteLatency(r: StorageArrayResource): string {
  return `${formatLatencyUsec(r.readLatencyUsec)} / ${formatLatencyUsec(
    r.writeLatencyUsec,
  )}`;
}

function renderVolumeRow(r: StorageArrayResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = getVolumeDisplayName(r);
  const arrayName: string = (r.storageArray?.name as string) || "—";
  const latency: StorageArrayWidgetState = getVolumeLatencyState(
    r.readLatencyUsec,
    r.writeLatencyUsec,
  );
  const route: Route | undefined = getVolumeRoute(r);

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
      <td
        className="px-3 py-2 text-xs text-gray-700 truncate"
        title={(r.groupName as string) || undefined}
      >
        {detailLink}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {formatUsedOfProvisioned(r)}
      </td>
      <td className="px-3 py-2 text-xs" style={{ color: latency.textColor }}>
        {formatReadWriteLatency(r)}
      </td>
      <td
        className="px-3 py-2 text-xs text-gray-500"
        title={translateTemplate("Read {{read}} · Write {{write}}", {
          read: formatIops(r.readIops),
          write: formatIops(r.writeIops),
        })}
      >
        {formatIops(getTotalIops(r.readIops, r.writeIops))}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">{arrayName}</td>
    </tr>
  );
}

function buildVolumeTile(r: StorageArrayResource): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = getVolumeDisplayName(r);
  const latency: StorageArrayWidgetState = getVolumeLatencyState(
    r.readLatencyUsec,
    r.writeLatencyUsec,
  );

  return {
    id: id || name,
    status: latency.text,
    color: latency.color,
    route: getVolumeRoute(r),
    tooltip: {
      title: name,
      details: [
        { label: "Array", value: (r.storageArray?.name as string) || "—" },
        { label: "Group", value: (r.groupName as string) || "—" },
        { label: "Used / Provisioned", value: formatUsedOfProvisioned(r) },
        {
          label: "Read Latency",
          value: formatLatencyUsec(r.readLatencyUsec),
        },
        {
          label: "Write Latency",
          value: formatLatencyUsec(r.writeLatencyUsec),
        },
        { label: "Read IOPS", value: formatIops(r.readIops) },
        { label: "Write IOPS", value: formatIops(r.writeIops) },
      ],
    },
  };
}

const DashboardStorageArrayVolumeListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardStorageArrayVolumeListComponent["arguments"] =
    props.component.arguments;

  const query: Query<StorageArrayResource> = {
    kind: "Volume",
  } as Query<StorageArrayResource>;

  if (args.storageArrayIds && args.storageArrayIds.length > 0) {
    (query as Record<string, unknown>)["storageArrayId"] = new Includes(
      args.storageArrayIds,
    );
  }

  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  return (
    <DashboardModelResourceListBase<StorageArrayResource>
      modelType={StorageArrayResource}
      componentId={props.componentId}
      publicResourceType="storage-array-resource"
      title={args.title}
      pluralLabel="volumes"
      emptyMessage="No storage array volumes found"
      emptyIcon={IconProp.Database}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      sort={{ name: SortOrder.Ascending }}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={ATTRIBUTE_TO_COLUMN}
      renderRow={renderVolumeRow}
      viewMode={viewMode}
      renderHoneycombTile={buildVolumeTile}
      honeycombLegend={VOLUME_LEGEND}
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

export default React.memo(
  DashboardStorageArrayVolumeListComponentElement,
  arePropsEqual,
);
