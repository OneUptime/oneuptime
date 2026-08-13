import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { buildInventoryScopeQueryString } from "../../Components/Inventory/InventoryScope";
import { INVENTORY_SOURCE_ORDER } from "../../Components/Inventory/InventorySource";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Inventory product's left rail.
 *
 * The "By source" section is the one piece of navigation that was missing
 * most: the three kinds of row behave differently enough (only one of them is
 * really deletable, only one of them has a heartbeat) that "show me just the
 * ones I added by hand" is a routine thing to want, and hunting for it in a
 * filter dropdown every time is not navigation.
 */

type SourceIconFunction = (source: EntitySource) => IconProp;

const getSourceIcon: SourceIconFunction = (source: EntitySource): IconProp => {
  if (source === EntitySource.Discovered) {
    return IconProp.Sparkles;
  }

  if (source === EntitySource.Inventory) {
    return IconProp.Copy;
  }

  return IconProp.User;
};

type SourceTitleFunction = (source: EntitySource) => string;

const getSourceTitle: SourceTitleFunction = (source: EntitySource): string => {
  if (source === EntitySource.Discovered) {
    return "Discovered";
  }

  if (source === EntitySource.Inventory) {
    return "Mirrored";
  }

  return "Added by You";
};

type ScopedItemsRouteFunction = (queryString: string) => Route;

const getScopedItemsRoute: ScopedItemsRouteFunction = (
  queryString: string,
): Route => {
  const base: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.INVENTORY_ITEMS] as Route,
  );

  return new Route(`${base.toString()}${queryString}`);
};

const InventorySideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Inventory",
      items: [
        {
          link: {
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY] as Route,
            ),
          },
          icon: IconProp.ChartBar,
        },
        {
          link: {
            title: "All Items",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_ITEMS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Gone Quiet",
            to: getScopedItemsRoute(
              buildInventoryScopeQueryString({
                source: EntitySource.Discovered,
                staleOnly: true,
              }),
            ),
          },
          icon: IconProp.ExclaimationCircle,
        },
      ],
    },
    {
      title: "By Source",
      defaultCollapsed: true,
      items: INVENTORY_SOURCE_ORDER.map((source: EntitySource) => {
        return {
          link: {
            title: getSourceTitle(source),
            to: getScopedItemsRoute(buildInventoryScopeQueryString({ source })),
          },
          icon: getSourceIcon(source),
        };
      }),
    },
    {
      title: "Help",
      items: [
        {
          link: {
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_DOCUMENTATION] as Route,
            ),
          },
          icon: IconProp.Book,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default InventorySideMenu;
