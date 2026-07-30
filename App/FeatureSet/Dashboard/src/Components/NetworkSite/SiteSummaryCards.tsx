import {
  SITE_SUMMARY_TILES,
  SiteSummaryTile,
  SiteSummaryTileAction,
  getSiteFacetSelectionForTile,
} from "./SiteSummaryTiles";
import {
  FacetOperatorMap,
  FacetSelectionMap,
  FacetTileSelection,
  isFacetTileSelectionApplied,
} from "../ResourceOwners/FacetTileSelection";
import ObjectID from "Common/Types/ObjectID";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Fleet-health strip for the Sites page: how many sites exist, how many are
 * rolling up unhealthy, and how many devices are still unassigned — the number
 * that tells you whether the hierarchy actually covers the fleet.
 *
 * Every tile is a drill-down. Three of them move a chip on the sites table below;
 * Unassigned Devices counts devices, so it hands over to the device list.
 * SiteSummaryTiles owns that mapping.
 */

export interface ComponentProps {
  refreshToggle?: string | undefined;
  /*
   * The table's live facet selections and operators. A tile is "pressed" exactly
   * when the bar is showing what it describes.
   */
  facetSelections: FacetSelectionMap;
  facetOperators: FacetOperatorMap;
  /*
   * Fired with the tile the user activated and the chip it stands for (`null` when
   * it has none on this page). The page decides what that means — moving a chip,
   * clearing them all, or leaving for the device list — because only the page can
   * navigate.
   */
  onTileClick?:
    | ((tile: SiteSummaryTile, selection: FacetTileSelection | null) => void)
    | undefined;
}

interface SummaryCounts {
  totalSites: number;
  unhealthySites: number;
  sitesWithNoData: number;
  devicesWithoutSite: number;
}

type GetMonitorStatusIdFunction = (site: NetworkSite) => string | null;

/*
 * The API hands back `_id` as a raw string on nested relations and a real
 * ObjectID once the model getter has seen it, depending on how the response was
 * hydrated. Both spellings have to produce the same id, or the chip would select
 * "[object Object]" and quietly match nothing.
 */
const getMonitorStatusId: GetMonitorStatusIdFunction = (
  site: NetworkSite,
): string | null => {
  const fromGetter: string | undefined =
    site.currentMonitorStatus?.id?.toString();

  if (fromGetter) {
    return fromGetter;
  }

  const raw: unknown = site.currentMonitorStatus?._id;

  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

const SiteSummaryCards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [counts, setCounts] = useState<SummaryCounts | null>(null);
  /*
   * The non-operational statuses the counted sites are actually rolling up.
   * Derived from the very response the unhealthy count came out of, so the chip
   * the tile sets selects exactly the statuses behind the number on it — rather
   * than every non-operational status the project happens to define.
   */
  const [unhealthyStatusIds, setUnhealthyStatusIds] = useState<Array<string>>(
    [],
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  const fetchCounts: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      const [siteResult, devicesWithoutSite]: [
        ListResult<NetworkSite>,
        number,
      ] = await Promise.all([
        ModelAPI.getList<NetworkSite>({
          modelType: NetworkSite,
          query: {
            projectId: projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            currentMonitorStatus: {
              _id: true,
              isOperationalState: true,
            },
          },
          sort: {},
        }),
        ModelAPI.count<NetworkDevice>({
          modelType: NetworkDevice,
          query: {
            projectId: projectId,
            isArchived: false,
            siteId: new IsNull(),
          },
        }),
      ]);

      let unhealthySites: number = 0;
      let sitesWithNoData: number = 0;
      const unhealthyIds: Set<string> = new Set<string>();

      for (const site of siteResult.data) {
        if (!site.currentMonitorStatus) {
          sitesWithNoData++;
          continue;
        }

        if (!site.currentMonitorStatus.isOperationalState) {
          unhealthySites++;

          const statusId: string | null = getMonitorStatusId(site);

          if (statusId) {
            unhealthyIds.add(statusId);
          }
        }
      }

      setCounts({
        totalSites: siteResult.count,
        unhealthySites: unhealthySites,
        sitesWithNoData: sitesWithNoData,
        devicesWithoutSite: devicesWithoutSite,
      });
      setUnhealthyStatusIds(Array.from(unhealthyIds));
      setHasError(false);
    } catch {
      // The summary row is supplementary — hide it instead of breaking the page.
      setHasError(true);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchCounts().catch(() => {
      // handled in fetchCounts.
    });
  }, [props.refreshToggle]);

  if (hasError) {
    return <></>;
  }

  type IsTileSelectedFunction = (
    tile: SiteSummaryTile,
    selection: FacetTileSelection | null,
  ) => boolean | undefined;

  /*
   * Only the tiles that describe the table below can be "on". The total reads as
   * selected when nothing is filtered — it is the unfiltered list, which is what
   * the table is showing.
   *
   * Unassigned Devices returns undefined rather than false: it navigates away
   * instead of toggling, and `undefined` is what keeps InfoCard from announcing it
   * as a toggle button that is currently off.
   */
  const isTileSelected: IsTileSelectedFunction = (
    tile: SiteSummaryTile,
    selection: FacetTileSelection | null,
  ): boolean | undefined => {
    if (tile.action === SiteSummaryTileAction.ShowUnassignedDevices) {
      return undefined;
    }

    if (!selection) {
      return false;
    }

    return isFacetTileSelectionApplied(
      selection,
      props.facetSelections,
      props.facetOperators,
    );
  };

  type TileAriaLabelFunction = (
    tile: SiteSummaryTile,
    count: number,
    isSelected: boolean | undefined,
  ) => string;

  /*
   * Says what the tile contributes, not that the list equals it: chips layer, so
   * more than one filter can be on at once and the rows are then the intersection —
   * a number no tile shows. The total tile is the exception; it really is the whole
   * list, because it is only "on" when nothing else is.
   */
  const getTileAriaLabel: TileAriaLabelFunction = (
    tile: SiteSummaryTile,
    count: number,
    isSelected: boolean | undefined,
  ): string => {
    if (tile.action === SiteSummaryTileAction.ShowUnassignedDevices) {
      return `${tile.label}: ${count}. Activate to open these on the device list.`;
    }

    if (tile.action === SiteSummaryTileAction.ClearFilters) {
      return isSelected
        ? `${tile.label}: ${count}. The list below is unfiltered.`
        : `${tile.label}: ${count}. Activate to clear the filters on the list below.`;
    }

    if (isSelected) {
      return `${tile.label}: ${count}. Filtering the list below — activate to remove this filter.`;
    }

    return `${tile.label}: ${count}. Activate to filter the list below by this.`;
  };

  return (
    <div
      data-testid="network-site-summary-cards"
      className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {SITE_SUMMARY_TILES.map((tile: SiteSummaryTile) => {
        const count: number = counts?.[tile.countField] || 0;
        const selection: FacetTileSelection | null =
          getSiteFacetSelectionForTile(tile, {
            unhealthyStatusIds: unhealthyStatusIds,
          });
        const isSelected: boolean | undefined = isTileSelected(tile, selection);

        /*
         * Inert until the counts land — clicking a skeleton would filter the list
         * to a number nobody has read yet — and inert for a tile with no chip to
         * move and nowhere to go, which is the Unhealthy tile before its statuses
         * are known. Selecting nothing there would clear the chip and show every
         * site under a lit "Unhealthy" tile.
         */
        const isActivatable: boolean = Boolean(
          props.onTileClick &&
            !isLoading &&
            (selection ||
              tile.action === SiteSummaryTileAction.ShowUnassignedDevices),
        );

        return (
          <InfoCard
            key={tile.key}
            title={tile.label}
            onClick={
              isActivatable
                ? () => {
                    props.onTileClick?.(tile, selection);
                  }
                : undefined
            }
            isSelected={isSelected}
            ariaLabel={getTileAriaLabel(tile, count, isSelected)}
            value={
              isLoading ? (
                <div className="mt-1 space-y-2">
                  <div className="h-8 w-14 animate-pulse rounded bg-gray-100"></div>
                  <div className="h-4 w-24 animate-pulse rounded bg-gray-100"></div>
                </div>
              ) : (
                <div className="mt-1">
                  <div
                    data-testid={`network-site-stat-${tile.key}`}
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
      })}
    </div>
  );
};

export default SiteSummaryCards;
