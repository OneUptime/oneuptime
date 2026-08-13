import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import {
  InventoryCategoryBreakdown,
  InventoryCategoryBreakdownRow,
} from "./InventoryTypeCatalog";
import { buildInventoryScopeQueryString } from "./InventoryScope";
import EntityType from "Common/Types/Telemetry/EntityType";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "What is actually in here?" — the category breakdown on the Inventory
 * Overview.
 *
 * The list page answers "which item", this answers "what shape is my
 * estate", which is the question you have before you know what to search
 * for. Every row is a drill-down into the list scoped to that type, so the
 * breakdown is navigation rather than decoration.
 *
 * Empty categories are already dropped upstream by buildInventoryBreakdown —
 * a project with no Kubernetes should not be shown five zeroed Kubernetes
 * rows.
 */

export interface ComponentProps {
  breakdown: Array<InventoryCategoryBreakdown>;
  isLoading: boolean;
}

const InventoryBreakdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type RowRouteFunction = (entityType: string) => Route;

  const getRowRoute: RowRouteFunction = (entityType: string): Route => {
    const base: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.INVENTORY_ITEMS] as Route,
    );

    return new Route(
      `${base.toString()}${buildInventoryScopeQueryString({
        entityType: entityType as EntityType,
      })}`,
    );
  };

  if (props.isLoading) {
    return (
      <Card
        title="What's in your estate"
        description="Your inventory grouped by what kind of thing each item is."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index: number): ReactElement => {
            return (
              <div
                key={index}
                className="h-32 animate-pulse rounded-lg bg-gray-100"
              ></div>
            );
          })}
        </div>
      </Card>
    );
  }

  if (props.breakdown.length === 0) {
    return (
      <Card
        title="What's in your estate"
        description="Your inventory grouped by what kind of thing each item is."
      >
        <p className="text-sm text-gray-500">
          Nothing to break down yet. Categories appear here as items are
          discovered or added.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="What's in your estate"
      description="Your inventory grouped by what kind of thing each item is. Pick any row to see just those items."
    >
      <div
        data-testid="inventory-breakdown"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {props.breakdown.map(
          (group: InventoryCategoryBreakdown): ReactElement => {
            return (
              <div
                key={group.label}
                className="rounded-lg border border-gray-200 p-4"
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {group.label}
                  </h3>
                  <span className="text-sm font-medium text-gray-500">
                    {group.total}
                  </span>
                </div>
                <ul className="mt-3 space-y-2">
                  {group.rows.map(
                    (row: InventoryCategoryBreakdownRow): ReactElement => {
                      return (
                        <li key={row.entityType}>
                          <AppLink
                            to={getRowRoute(row.entityType)}
                            className="flex items-center justify-between rounded px-1 py-1 text-sm text-gray-600 hover:bg-gray-50 hover:text-indigo-700"
                          >
                            <span className="flex items-center gap-x-2 truncate">
                              <Icon
                                icon={row.icon}
                                size={SizeProp.Smaller}
                                className="h-4 w-4 text-gray-400"
                              />
                              <span className="truncate">{row.label}</span>
                            </span>
                            <span className="ml-2 font-medium text-gray-900">
                              {row.count}
                            </span>
                          </AppLink>
                        </li>
                      );
                    },
                  )}
                </ul>
              </div>
            );
          },
        )}
      </div>
    </Card>
  );
};

export default InventoryBreakdown;
