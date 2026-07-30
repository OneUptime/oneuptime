import { DEVICE_SUMMARY_TILES, DeviceSummaryTile } from "./DeviceSummaryTiles";
import { getDeviceFreshCutoff } from "./DeviceFacets";
import {
  FacetOperatorMap,
  FacetSelectionMap,
  isFacetTileSelectionApplied,
} from "../ResourceOwners/FacetTileSelection";
import ObjectID from "Common/Types/ObjectID";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

interface SummaryCounts {
  devicesUp: number;
  devicesDown: number;
  devicesPending: number;
  interfacesDown: number;
}

export interface ComponentProps {
  /*
   * The table's live facet selections and operators. A tile is "pressed" exactly
   * when the bar is showing what it describes, so the strip and the chips can
   * never disagree about which rows are on screen.
   */
  facetSelections: FacetSelectionMap;
  facetOperators: FacetOperatorMap;
  /*
   * Fired with the tile the user activated. The page owns the chips, so it is the
   * page that applies (or toggles off) the selection the tile carries.
   */
  onTileClick?: ((tile: DeviceSummaryTile) => void) | undefined;
}

const DeviceSummaryCards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [counts, setCounts] = useState<SummaryCounts | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  const fetchCounts: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      /*
       * Same freshness window the topology API uses to decide up vs down, and the
       * same one the Status chip builds its query from — so the rows a tile opens
       * are the rows it counted.
       */
      const freshCutoff: Date = getDeviceFreshCutoff();

      const [
        devicesUp,
        devicesDown,
        devicesPending,
        devicesWithDownInterfaces,
      ]: [number, number, number, ListResult<NetworkDevice>] =
        await Promise.all([
          ModelAPI.count<NetworkDevice>({
            modelType: NetworkDevice,
            query: {
              projectId: projectId,
              isArchived: false,
              lastSeenAt: new GreaterThanOrEqual(freshCutoff),
            },
          }),
          ModelAPI.count<NetworkDevice>({
            modelType: NetworkDevice,
            query: {
              projectId: projectId,
              isArchived: false,
              lastSeenAt: new LessThan(freshCutoff),
            },
          }),
          ModelAPI.count<NetworkDevice>({
            modelType: NetworkDevice,
            query: {
              projectId: projectId,
              isArchived: false,
              lastSeenAt: new IsNull(),
            },
          }),
          ModelAPI.getList<NetworkDevice>({
            modelType: NetworkDevice,
            query: {
              projectId: projectId,
              isArchived: false,
              interfacesDown: new GreaterThan(0),
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              interfacesDown: true,
            },
            sort: {},
          }),
        ]);

      const interfacesDown: number = devicesWithDownInterfaces.data.reduce(
        (total: number, device: NetworkDevice) => {
          return total + ((device.interfacesDown as number) || 0);
        },
        0,
      );

      setCounts({
        devicesUp,
        devicesDown,
        devicesPending,
        interfacesDown,
      });
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
  }, []);

  if (hasError) {
    return <></>;
  }

  return (
    <div
      data-testid="network-device-summary-cards"
      className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile) => {
        const count: number = counts?.[tile.countField] || 0;
        const isSelected: boolean = isFacetTileSelectionApplied(
          tile.selection,
          props.facetSelections,
          props.facetOperators,
        );

        return (
          <InfoCard
            key={tile.key}
            title={tile.label}
            /*
             * The tiles stay inert until the counts land: clicking a skeleton
             * would filter the list to a number nobody has read yet.
             */
            onClick={
              props.onTileClick && !isLoading
                ? () => {
                    props.onTileClick?.(tile);
                  }
                : undefined
            }
            isSelected={isSelected}
            /*
             * Says what the tile contributes, not that the list equals it: chips
             * layer, so two tiles can be lit at once and the rows are then the
             * intersection — a number neither tile shows.
             */
            ariaLabel={
              isSelected
                ? `${tile.label}: ${count}. Filtering the list below — activate to remove this filter.`
                : `${tile.label}: ${count}. Activate to filter the list below by this.`
            }
            value={
              isLoading ? (
                <div className="mt-1 space-y-2">
                  <div className="h-8 w-14 animate-pulse rounded bg-gray-100"></div>
                  <div className="h-4 w-24 animate-pulse rounded bg-gray-100"></div>
                </div>
              ) : (
                <div className="mt-1">
                  <div
                    data-testid={`network-device-stat-${tile.key}`}
                    className={`text-3xl font-semibold ${
                      count > 0
                        ? tile.attentionClassName
                        : tile.allClearClassName
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

export default DeviceSummaryCards;
