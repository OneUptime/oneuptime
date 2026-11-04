import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Data Observability side menu. What most people need sits at the top -
 * the Overview, every table, what changed in their schemas, and the
 * databases being watched - with the docs under Help and the tables gone
 * from their databases under Advanced.
 */
const DataObservabilitySideMenu: FunctionComponent = (): ReactElement => {
  const routeOf: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route);
  };

  return (
    <SideMenu>
      <SideMenuSection title="Data Observability">
        <SideMenuItem
          link={{
            title: "Overview",
            to: routeOf(PageMap.DATA_OBSERVABILITY_OVERVIEW),
          }}
          icon={IconProp.Home}
        />
        <SideMenuItem
          link={{
            title: "Data Products",
            to: routeOf(PageMap.DATA_OBSERVABILITY_DATA_PRODUCTS),
          }}
          icon={IconProp.Layers}
        />
        <SideMenuItem
          link={{
            title: "Tables",
            to: routeOf(PageMap.DATA_OBSERVABILITY_TABLES),
          }}
          icon={IconProp.TableCells}
        />
        <SideMenuItem
          link={{
            title: "Checks",
            to: routeOf(PageMap.DATA_OBSERVABILITY_CHECKS),
          }}
          icon={IconProp.CheckCircle}
        />
        <SideMenuItem
          link={{
            title: "Reconciliations",
            to: routeOf(PageMap.DATA_OBSERVABILITY_RECONCILIATIONS),
          }}
          icon={IconProp.Scale}
        />
        <SideMenuItem
          link={{
            title: "Pipelines",
            to: routeOf(PageMap.DATA_OBSERVABILITY_PIPELINES),
          }}
          icon={IconProp.Workflow}
        />
        <SideMenuItem
          link={{
            title: "BI Dashboards",
            to: routeOf(PageMap.DATA_OBSERVABILITY_BI_DASHBOARDS),
          }}
          icon={IconProp.ChartBar}
        />
        <SideMenuItem
          link={{
            title: "Warehouse Spend",
            to: routeOf(PageMap.DATA_OBSERVABILITY_SPEND),
          }}
          icon={IconProp.Billing}
        />
        <SideMenuItem
          link={{
            title: "Schema Changes",
            to: routeOf(PageMap.DATA_OBSERVABILITY_SCHEMA_CHANGES),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Databases",
            to: routeOf(PageMap.DATA_OBSERVABILITY_STORES),
          }}
          icon={IconProp.Database}
        />
      </SideMenuSection>

      <SideMenuSection title="Help">
        <SideMenuItem
          link={{
            title: "Documentation",
            to: routeOf(PageMap.DATA_OBSERVABILITY_DOCUMENTATION),
          }}
          icon={IconProp.Book}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Unused Tables",
            to: routeOf(PageMap.DATA_OBSERVABILITY_TABLES_UNUSED),
          }}
          icon={IconProp.Moon}
        />
        <SideMenuItem
          link={{
            title: "Dropped Tables",
            to: routeOf(PageMap.DATA_OBSERVABILITY_TABLES_DROPPED),
          }}
          icon={IconProp.Archive}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: routeOf(PageMap.DATA_OBSERVABILITY_SETTINGS),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Owner Rules",
            to: routeOf(PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULES),
          }}
          icon={IconProp.Team}
        />
        <SideMenuItem
          link={{
            title: "Label Rules",
            to: routeOf(PageMap.DATA_OBSERVABILITY_SETTINGS_LABEL_RULES),
          }}
          icon={IconProp.Label}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DataObservabilitySideMenu;
