import {
  DEVICE_SUMMARY_TILES,
  DeviceSummaryFilterKey,
  DeviceSummaryTile,
  getDeviceFreshCutoff,
} from "./DeviceSummaryFilter";
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
  // The tile currently drilled into, or null when the list is unfiltered.
  selectedFilterKey?: DeviceSummaryFilterKey | null | undefined;
  /*
   * Clicking the selected tile again passes null — the tiles are toggles, so
   * the same click that drilled in gets the user back out.
   */
  onFilterKeyChange?:
    | ((filterKey: DeviceSummaryFilterKey | null) => void)
    | undefined;
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
       * Same freshness window the topology API uses to decide up vs down, and
       * the same one DeviceSummaryFilter builds the drill-down queries from —
       * so the rows a tile opens are the rows it counted.
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

  const selectedFilterKey: DeviceSummaryFilterKey | null =
    props.selectedFilterKey || null;

  type OnTileClickFunction = (tile: DeviceSummaryTile) => void;

  const onTileClick: OnTileClickFunction = (tile: DeviceSummaryTile): void => {
    if (!props.onFilterKeyChange) {
      return;
    }

    props.onFilterKeyChange(
      selectedFilterKey === tile.filterKey ? null : tile.filterKey,
    );
  };

  return (
    <div
      data-testid="network-device-summary-cards"
      className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile) => {
        const count: number = counts?.[tile.countField] || 0;
        const isSelected: boolean = selectedFilterKey === tile.filterKey;

        return (
          <InfoCard
            key={tile.key}
            title={tile.label}
            /*
             * The tiles stay inert until the counts land: clicking a skeleton
             * would filter the list to a number nobody has read yet.
             */
            onClick={
              props.onFilterKeyChange && !isLoading
                ? () => {
                    onTileClick(tile);
                  }
                : undefined
            }
            isSelected={isSelected}
            ariaLabel={
              isSelected
                ? `${tile.label}: ${count}. Showing these in the list below — activate to clear the filter.`
                : `${tile.label}: ${count}. Activate to show these in the list below.`
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
