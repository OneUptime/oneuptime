import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

// One table's pages: what it holds, how it changes and who uses it, its settings, and Delete.
const TableViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const routeOf: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: props.modelId,
    });
  };

  return (
    <SideMenu>
      <SideMenuSection title="Table">
        <SideMenuItem
          link={{
            title: "Overview",
            to: routeOf(PageMap.DATA_OBSERVABILITY_TABLE_VIEW),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Columns",
            to: routeOf(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_COLUMNS),
          }}
          icon={IconProp.ViewColumns}
        />
        <SideMenuItem
          link={{
            title: "Metrics",
            to: routeOf(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_METRICS),
          }}
          icon={IconProp.ChartBar}
        />
        <SideMenuItem
          link={{
            title: "Timeline",
            to: routeOf(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_TIMELINE),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Checks",
            to: routeOf(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS),
          }}
          icon={IconProp.CheckCircle}
        />
        <SideMenuItem
          link={{
            title: "Services",
            to: routeOf(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_SERVICES),
          }}
          icon={IconProp.Code}
        />
      </SideMenuSection>

      <SideMenuSection title="Settings">
        <SideMenuItem
          link={{
            title: "Settings",
            to: routeOf(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_SETTINGS),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Delete Table",
            to: routeOf(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_DELETE),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default TableViewSideMenu;
