import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import {
  INVENTORY_SUMMARY_TILES,
  InventorySummaryCounts,
  InventorySummaryTile,
  getInventoryTileCount,
} from "./InventorySummaryTiles";
import { buildInventoryScopeQueryString } from "./InventoryScope";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The number strip at the top of the Inventory Overview.
 *
 * Purely presentational: the Overview does one fetch and folds it, so the
 * tiles and the category breakdown below them are always two views of the
 * same snapshot rather than two requests that can disagree.
 *
 * Every tile navigates rather than toggling — the rows it counted live on the
 * Items page — so none of them passes `isSelected`. An InfoCard given
 * `isSelected` announces itself as a toggle, and a toggle that navigates away
 * is a state the user can never see it in.
 */

export interface ComponentProps {
  counts: InventorySummaryCounts | null;
  isLoading: boolean;
}

const InventorySummaryCards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type NavigateToTileFunction = (tile: InventorySummaryTile) => void;

  const navigateToTile: NavigateToTileFunction = (
    tile: InventorySummaryTile,
  ): void => {
    const base: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.INVENTORY_ITEMS] as Route,
    );

    Navigation.navigate(
      new Route(
        `${base.toString()}${buildInventoryScopeQueryString(tile.scope)}`,
      ),
    );
  };

  return (
    <div
      data-testid="inventory-summary-cards"
      className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5"
    >
      {INVENTORY_SUMMARY_TILES.map(
        (tile: InventorySummaryTile): ReactElement => {
          const count: number = getInventoryTileCount(tile, props.counts);

          return (
            <InfoCard
              key={tile.key}
              title={tile.label}
              /*
               * Inert while the counts are still loading: activating a
               * skeleton would open a list the user has not read a number for
               * yet.
               */
              onClick={
                props.isLoading
                  ? undefined
                  : () => {
                      navigateToTile(tile);
                    }
              }
              ariaLabel={`${tile.label}: ${count}. Activate to open these in the inventory list.`}
              value={
                props.isLoading ? (
                  <div className="mt-1 space-y-2">
                    <div className="h-8 w-14 animate-pulse rounded bg-gray-100"></div>
                    <div className="h-4 w-24 animate-pulse rounded bg-gray-100"></div>
                  </div>
                ) : (
                  <div className="mt-1">
                    <div
                      data-testid={`inventory-stat-${tile.key}`}
                      className={`text-3xl font-semibold ${
                        count > 0 ? tile.attentionClassName : "text-gray-900"
                      }`}
                    >
                      {count}
                    </div>
                    <div className="mt-2 text-sm text-gray-500">
                      {tile.caption}
                    </div>
                  </div>
                )
              }
            />
          );
        },
      )}
    </div>
  );
};

export default InventorySummaryCards;
