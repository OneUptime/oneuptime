import React, { FunctionComponent, ReactElement } from "react";
import DashboardStorageArrayHardwareListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardStorageArrayHardwareListComponent";
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
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import JSONFunctions from "Common/Types/JSONFunctions";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { AttributeToColumnMap } from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";
import {
  STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER,
  STORAGE_ARRAY_HARDWARE_WIDGET_KINDS,
  STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES,
} from "Common/Utils/Dashboard/Components/DashboardStorageArrayResourceListShared";
import {
  HoneycombLegendItem,
  HoneycombTile,
} from "./DashboardResourceHoneycomb";
import {
  HARDWARE_STATUS_COLORS,
  StorageArrayWidgetState,
  getHardwareDetail,
  getHardwareStatusState,
  getHardwareTypeText,
  humanizeArrayValue,
} from "./StorageArrayWidgetData";

/*
 * `component_name` is the datapoint label every FlashArray hardware and
 * drive series carries (purefa_hw_component_status,
 * purefa_drive_capacity_bytes) and is stored verbatim as
 * StorageArrayResource.externalId, so a dashboard variable bound to
 * `component_name` narrows this list too. This map must stay byte-identical
 * to STORAGE_ARRAY_HARDWARE_ATTRIBUTE_TO_COLUMN in
 * Common/Server/Utils/Dashboard/PublicDashboardResourceListPolicy.ts — on
 * public dashboards the server copy is the one that is applied.
 */
const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  component_name: "externalId",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardStorageArrayHardwareListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Component", widthPct: "24%" },
  { label: "Type", widthPct: "20%" },
  { label: "Status", widthPct: "18%" },
  { label: "Detail", widthPct: "20%" },
  { label: "Array", widthPct: "18%" },
];

/*
 * The hardware wall: one cell per component, drive and controller, banded
 * by the same status split the array's own health is derived with
 * (StorageArrayWidgetData.getHardwareStatusState).
 */
const HARDWARE_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Healthy", color: HARDWARE_STATUS_COLORS.healthy },
  { label: "Warning", color: HARDWARE_STATUS_COLORS.warning },
  { label: "Critical", color: HARDWARE_STATUS_COLORS.critical },
  { label: "Other", color: HARDWARE_STATUS_COLORS.other },
  { label: "No status", color: HARDWARE_STATUS_COLORS.noStatus },
];

/*
 * Server select (PublicDashboardResourceListPolicy.selectForComponent,
 * StorageArrayHardwareList case) plus lastSeenAt. On public dashboards the
 * server select is authoritative and this one is ignored, so keep the two in
 * step — never add a column here without adding it there.
 */
const BASE_SELECT: Select<StorageArrayResource> = {
  _id: true,
  name: true,
  externalId: true,
  kind: true,
  status: true,
  statusDetail: true,
  componentType: true,
  model: true,
  capacityBytes: true,
  temperatureCelsius: true,
  lastSeenAt: true,
  storageArrayId: true,
  storageArray: {
    name: true,
  },
};

/*
 * Hardware has no page of its own per component, so rows and tiles open the
 * array's Hardware page, where every component, drive and controller is
 * listed.
 */
function getHardwareRoute(r: StorageArrayResource): Route | undefined {
  const arrayId: string = (r.storageArrayId?.toString() as string) || "";
  if (!arrayId) {
    return undefined;
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.STORAGE_ARRAY_VIEW_HARDWARE] as Route,
    { modelId: new ObjectID(arrayId) },
  );
}

function getComponentDisplayName(r: StorageArrayResource): string {
  return (r.name as string) || (r.externalId as string) || "Unnamed";
}

function renderComponentRow(r: StorageArrayResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = getComponentDisplayName(r);
  const state: StorageArrayWidgetState = getHardwareStatusState(r.status);
  const arrayName: string = (r.storageArray?.name as string) || "—";
  const route: Route | undefined = getHardwareRoute(r);

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
      <td className="px-3 py-2 text-xs text-gray-700 truncate">{detailLink}</td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {getHardwareTypeText(r)}
      </td>
      <td className="px-3 py-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ fontSize: "10px" }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: state.color }}
          ></span>
          <span style={{ color: state.textColor }}>
            {humanizeArrayValue(r.status)}
          </span>
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {getHardwareDetail(r)}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">{arrayName}</td>
    </tr>
  );
}

function buildComponentTile(r: StorageArrayResource): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = getComponentDisplayName(r);
  const state: StorageArrayWidgetState = getHardwareStatusState(r.status);

  return {
    id: id || name,
    status: state.text,
    color: state.color,
    route: getHardwareRoute(r),
    tooltip: {
      title: name,
      details: [
        { label: "Array", value: (r.storageArray?.name as string) || "—" },
        { label: "Type", value: getHardwareTypeText(r) },
        { label: "Reported Status", value: humanizeArrayValue(r.status) },
        { label: "Detail", value: getHardwareDetail(r) },
      ],
    },
  };
}

const DashboardStorageArrayHardwareListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardStorageArrayHardwareListComponent["arguments"] =
    props.component.arguments;

  /*
   * Pinned to the hardware kinds — to one of them when the kind filter names
   * it — exactly as the public-dashboard policy
   * (buildStorageArrayHardwarePolicy) pins it.
   */
  const kindFilter: string | undefined = args.kindFilter;
  const query: Query<StorageArrayResource> = {
    kind:
      kindFilter &&
      STORAGE_ARRAY_HARDWARE_WIDGET_KINDS.includes(
        kindFilter as StorageArrayResourceKind,
      )
        ? kindFilter
        : new Includes([...STORAGE_ARRAY_HARDWARE_WIDGET_KINDS]),
  } as Query<StorageArrayResource>;

  if (args.storageArrayIds && args.storageArrayIds.length > 0) {
    (query as Record<string, unknown>)["storageArrayId"] = new Includes(
      args.storageArrayIds,
    );
  }

  if (args.statusFilter === STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER) {
    (query as Record<string, unknown>)["status"] = new Includes([
      ...STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES,
    ]);
  }

  /*
   * Honeycomb is the default for this widget (the hardware wall) — the
   * component util seeds viewMode: "honeycomb", and an unset value falls
   * back to honeycomb too so template-created widgets get the wall.
   */
  const viewMode: ResourceListViewMode =
    args.viewMode === "list" ? "list" : "honeycomb";

  return (
    <DashboardModelResourceListBase<StorageArrayResource>
      modelType={StorageArrayResource}
      componentId={props.componentId}
      publicResourceType="storage-array-resource"
      title={args.title}
      pluralLabel="components"
      emptyMessage="No storage array hardware found"
      emptyIcon={IconProp.CPUChip}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      sort={{ name: SortOrder.Ascending }}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={ATTRIBUTE_TO_COLUMN}
      renderRow={renderComponentRow}
      viewMode={viewMode}
      renderHoneycombTile={buildComponentTile}
      honeycombLegend={HARDWARE_LEGEND}
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
  DashboardStorageArrayHardwareListComponentElement,
  arePropsEqual,
);
