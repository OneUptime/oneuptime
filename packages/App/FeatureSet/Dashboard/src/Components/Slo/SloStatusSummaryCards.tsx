import {
  getSloStatusSummaryTileColor,
  getSloStatusSummaryTileQuery,
  isSloStatusSummaryTileApplied,
  SLO_STATUS_SUMMARY_TILES,
  SloStatusSummaryTile,
  SloStatusSummaryTileKey,
} from "./SloStatusSummaryTiles";
import {
  FacetOperatorMap,
  FacetSelectionMap,
} from "../ResourceOwners/FacetTileSelection";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  projectId: ObjectID;
  /*
   * The table's live facet selections and operators. A tile is "pressed"
   * exactly when the bar is showing what it describes, so the strip and the
   * chips can never disagree about which rows are on screen.
   */
  facetSelections: FacetSelectionMap;
  facetOperators: FacetOperatorMap;
  /*
   * Fired with the tile the user activated. The page owns the chips, so it is
   * the page that applies (or toggles off) the selection the tile carries.
   */
  onTileClick?: ((tile: SloStatusSummaryTile) => void) | undefined;
  /*
   * Changing this recounts. The counts go stale whenever the table's rows do -
   * a bulk archive, the Refresh button - so the page bumps it as its table
   * refetches.
   */
  refreshToken?: string | undefined;
}

type SloStatusSummaryCounts = Partial<Record<SloStatusSummaryTileKey, number>>;

/**
 * A row of counts above the SLO list: how many live SLOs are Healthy, At Risk,
 * Budget Exhausted, Misconfigured, Paused and Disabled. Clicking a tile filters
 * the list to exactly the SLOs it counted, and clicking it again clears that.
 *
 * Archived SLOs are never counted, matching the list below them.
 */
const SloStatusSummaryCards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [counts, setCounts] = useState<SloStatusSummaryCounts | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  /*
   * Recounts can overlap - a refresh landing while the previous count is still
   * in flight. Only the newest request may write, or a slow earlier response
   * would overwrite fresher numbers with older ones.
   */
  const latestRequestIdRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchCounts: PromiseVoidFunction = async (): Promise<void> => {
    latestRequestIdRef.current = latestRequestIdRef.current + 1;
    const requestId: number = latestRequestIdRef.current;

    try {
      /*
       * One COUNT per tile, all in parallel, each built from the same
       * definition that decides which rows the tile's click shows. A list of
       * SLOs summed here would silently truncate at the page-size cap.
       */
      const values: Array<number> = await Promise.all(
        SLO_STATUS_SUMMARY_TILES.map(
          (tile: SloStatusSummaryTile): Promise<number> => {
            return ModelAPI.count<ServiceLevelObjective>({
              modelType: ServiceLevelObjective,
              query: {
                ...getSloStatusSummaryTileQuery(tile),
                projectId: props.projectId,
              },
            });
          },
        ),
      );

      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      const nextCounts: SloStatusSummaryCounts = {};

      SLO_STATUS_SUMMARY_TILES.forEach(
        (tile: SloStatusSummaryTile, index: number): void => {
          nextCounts[tile.key] = values[index] || 0;
        },
      );

      setCounts(nextCounts);
      setHasError(false);
    } catch {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      /*
       * The strip is supplementary - hide it instead of breaking the page, and
       * rather than leave numbers on screen that are known to be stale.
       */
      setHasError(true);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchCounts().catch(() => {
      // handled in fetchCounts.
    });
    /*
     * Keyed on the string VALUE of the project id, not the ObjectID instance:
     * a caller that rebuilds the id every render must not re-fire six counts.
     */
  }, [props.projectId.toString(), props.refreshToken]);

  if (hasError) {
    return <></>;
  }

  return (
    <div
      data-testid="slo-status-summary-cards"
      role="group"
      aria-label="SLO status summary"
      className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
    >
      {SLO_STATUS_SUMMARY_TILES.map((tile: SloStatusSummaryTile) => {
        const count: number = counts?.[tile.key] || 0;
        const isSelected: boolean = isSloStatusSummaryTileApplied(
          tile,
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
             * Says what the tile contributes, not that the list equals it: the
             * Owner and Labels chips still layer on top.
             */
            ariaLabel={
              isSelected
                ? `${tile.label}: ${count}. Filtering the SLO list below - activate to remove this filter.`
                : `${tile.label}: ${count}. Activate to filter the SLO list below to these SLOs.`
            }
            value={
              isLoading ? (
                <div className="mt-1 space-y-2">
                  <div className="h-7 w-10 animate-pulse rounded bg-gray-100"></div>
                  <div className="h-3 w-24 animate-pulse rounded bg-gray-100"></div>
                </div>
              ) : (
                <div className="mt-1">
                  <div
                    data-testid={`slo-status-count-${tile.key}`}
                    className={`text-2xl font-semibold tabular-nums ${
                      count > 0 ? tile.attentionClassName : "text-gray-400"
                    }`}
                  >
                    {count}
                  </div>
                  <div className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-gray-500">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          getSloStatusSummaryTileColor(tile).toString(),
                      }}
                    ></span>
                    <span>{tile.caption}</span>
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

export default SloStatusSummaryCards;
