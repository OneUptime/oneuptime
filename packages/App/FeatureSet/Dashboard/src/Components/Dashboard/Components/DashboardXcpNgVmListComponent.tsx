import React, { FunctionComponent, ReactElement } from "react";
import { getValueOrQuietDash } from "Common/UI/Components/Table/TableEmptyValue";
import DashboardXcpNgVmListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardXcpNgVmListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import {
  ResourceListColumn,
  ResourceListNameCell,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import DashboardModelResourceListBase from "../../Infrastructure/DashboardModelResourceListBase";
import IconProp from "Common/Types/Icon/IconProp";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import JSONFunctions from "Common/Types/JSONFunctions";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { HoneycombTile } from "./DashboardResourceHoneycomb";
import {
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { getUnnamedText } from "./DashboardWidgetFallbackWords";
import {
  XCP_NG_VM_ATTRIBUTE_TO_COLUMN,
  XCP_NG_VM_WIDGET_SELECT,
  getXcpNgVmListQuery,
  getXcpNgVmStatusFilterQuery,
} from "Common/Utils/Dashboard/Components/DashboardXcpNgResourceListShared";
import {
  XcpNgWidgetState,
  formatXcpNgPercent,
  getXcpNgPercentTextColor,
  getXcpNgVmLegend,
  getXcpNgVmState,
} from "./XcpNgWidgetData";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardXcpNgVmListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "VM", widthPct: "26%", sortKey: "name" },
  { label: "Status", widthPct: "15%", sortKey: "status" },
  { label: "CPU", widthPct: "12%", sortKey: "cpu" },
  { label: "Memory", widthPct: "12%", sortKey: "memory" },
  { label: "Host", widthPct: "17%", sortKey: "host" },
  { label: "XCP-ng Pool", widthPct: "18%", sortKey: "pool" },
];

/*
 * The server's select for a public dashboard
 * (PublicDashboardResourceListPolicy) is this one, read from the same
 * constant, so the two never drift.
 */
const BASE_SELECT: Select<XcpNgResource> =
  XCP_NG_VM_WIDGET_SELECT as Select<XcpNgResource>;

/*
 * VM rows link straight to the VM's page in its pool. The detail-route
 * param is the VM's XAPI UUID (externalId), percent-encoded as a single
 * path segment. Rows without one fall back to the pool's VMs list.
 */
export function getXcpNgVmRoute(r: XcpNgResource): Route | undefined {
  const poolId: string = (r.xcpNgPoolId?.toString() as string) || "";
  if (!poolId) {
    return undefined;
  }
  const externalId: string = (r.externalId as string) || "";
  if (!externalId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.XCP_NG_POOL_VIEW_VMS] as Route,
      { modelId: new ObjectID(poolId) },
    );
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.XCP_NG_POOL_VIEW_VM_DETAIL] as Route,
    {
      modelId: new ObjectID(poolId),
      subModelId: encodeURIComponent(externalId),
    },
  );
}

function getVmDisplayName(r: XcpNgResource): string {
  return (r.name as string) || (r.externalId as string) || getUnnamedText();
}

function renderVmRow(r: XcpNgResource): ReactElement {
  // Its state and figures in the reader's words (#7091).
  const translator: Translator = getGlobalTranslator();
  const id: string = (r._id as string) || "";
  const name: string = getVmDisplayName(r);
  const state: XcpNgWidgetState = getXcpNgVmState(r, translator);
  const poolName: string | undefined = r.xcpNgPool?.name as string;
  const route: Route | undefined = getXcpNgVmRoute(r);

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

  /*
   * A VM that is not running reports no CPU, and a VM's memory in use needs
   * its guest tools: a dash in those cells is expected rather than a gap.
   */
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
      <td className="px-3 py-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ fontSize: "10px" }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: state.color }}
          ></span>
          <span style={{ color: state.textColor }}>{state.text}</span>
        </span>
      </td>
      <td
        className="px-3 py-2 text-xs"
        style={{ color: getXcpNgPercentTextColor(r.latestCpuPercent) }}
      >
        {getValueOrQuietDash(
          formatXcpNgPercent(r.latestCpuPercent, translator),
          { isSmall: true },
        )}
      </td>
      <td
        className="px-3 py-2 text-xs"
        style={{ color: getXcpNgPercentTextColor(r.latestMemoryPercent) }}
      >
        {getValueOrQuietDash(
          formatXcpNgPercent(r.latestMemoryPercent, translator),
          { isSmall: true },
        )}
      </td>
      <ResourceListNameCell
        name={r.parentHostName as string}
        className="px-3 py-2 text-xs text-gray-500 truncate"
      />
      <ResourceListNameCell
        name={poolName}
        className="px-3 py-2 text-xs text-gray-500 truncate"
      />
    </tr>
  );
}

function buildVmTile(r: XcpNgResource): HoneycombTile {
  const translator: Translator = getGlobalTranslator();
  const id: string = (r._id as string) || "";
  const name: string = getVmDisplayName(r);
  const state: XcpNgWidgetState = getXcpNgVmState(r, translator);

  return {
    id: id || name,
    status: state.text,
    // Worded in the reader's language already: never looked up again.
    isStatusUserContent: true,
    color: state.color,
    route: getXcpNgVmRoute(r),
    tooltip: {
      title: name,
      details: [
        { label: "Host", value: r.parentHostName as string },
        { label: "XCP-ng Pool", value: r.xcpNgPool?.name as string },
        {
          label: "CPU",
          value: formatXcpNgPercent(r.latestCpuPercent, translator),
        },
        {
          label: "Memory",
          value: formatXcpNgPercent(r.latestMemoryPercent, translator),
        },
      ],
    },
  };
}

const DashboardXcpNgVmListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  const args: DashboardXcpNgVmListComponent["arguments"] =
    props.component.arguments;

  /*
   * Pinned to kind "VM" without the control domains; the status filter's
   * values and what each reads are the public dashboard policy's too
   * (DashboardXcpNgResourceListShared).
   */
  const query: Query<XcpNgResource> = {
    ...getXcpNgVmListQuery(),
    ...getXcpNgVmStatusFilterQuery(args.statusFilter),
  } as Query<XcpNgResource>;

  if (args.xcpNgPoolIds && args.xcpNgPoolIds.length > 0) {
    (query as Record<string, unknown>)["xcpNgPoolId"] = new Includes(
      args.xcpNgPoolIds,
    );
  }

  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  return (
    <DashboardModelResourceListBase<XcpNgResource>
      modelType={XcpNgResource}
      componentId={props.componentId}
      publicResourceType="xcp-ng-resource"
      title={args.title}
      countLabel={{
        one: "{{count}} VM",
        other: "{{count}} VMs",
      }}
      emptyMessage="No XCP-ng VMs found"
      emptyIcon={IconProp.Cube}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      componentType={DashboardComponentType.XcpNgVmList}
      widgetProps={props}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={XCP_NG_VM_ATTRIBUTE_TO_COLUMN}
      renderRow={renderVmRow}
      viewMode={viewMode}
      renderHoneycombTile={buildVmTile}
      honeycombLegend={getXcpNgVmLegend(translator)}
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

export default React.memo(DashboardXcpNgVmListComponentElement, arePropsEqual);
