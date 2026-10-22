import Incident from "Common/Models/DatabaseModels/Incident";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  FacetOperatorMap,
  FacetSelectionMap,
} from "../ResourceOwners/FacetTileSelection";
import {
  PostmortemStatusTile,
  getPostmortemStatusTileCountClassName,
  getPostmortemStatusTilesGridClassName,
  isPostmortemStatusTileApplied,
} from "./PostmortemStatusTiles";

export interface ComponentProps {
  projectId: ObjectID;
  tiles: Array<PostmortemStatusTile>;
  /*
   * The table's live facet selections and operators. A tile is "pressed"
   * exactly when the bar is showing what it counts, so the strip and the
   * chips can never disagree about which rows are on screen.
   */
  facetSelections: FacetSelectionMap;
  facetOperators: FacetOperatorMap;
  // Fired with the tile the reader activated: the page moves the chip.
  onTileClick?: ((tile: PostmortemStatusTile) => void) | undefined;
  /*
   * Changing this recounts: the counts go stale whenever the table's rows
   * do - a status moved from the list, the Refresh button.
   */
  refreshToken?: string | undefined;
}

type PostmortemStatusCounts = Record<string, number>;

/**
 * A row of counts above the Postmortems list: how many incidents' postmortems
 * are in each of the project's statuses - Not Started, Draft, Completed, Not
 * Needed and the project's own. Clicking a tile filters the list to exactly
 * those incidents, and clicking it again clears that.
 */
const PostmortemStatusSummaryCards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [counts, setCounts] = useState<PostmortemStatusCounts | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  /*
   * Recounts can overlap - a refresh landing while the previous count is
   * still in flight. Only the newest request may write.
   */
  const latestRequestIdRef: React.MutableRefObject<number> = useRef<number>(0);

  const tileKey: string = props.tiles
    .map((tile: PostmortemStatusTile): string => {
      return tile.statusId;
    })
    .join(",");

  const fetchCounts: PromiseVoidFunction = async (): Promise<void> => {
    latestRequestIdRef.current = latestRequestIdRef.current + 1;
    const requestId: number = latestRequestIdRef.current;

    try {
      /*
       * One COUNT per tile, all in parallel, each on the incidents of the
       * project in that status - what the tile's click shows.
       */
      const values: Array<number> = await Promise.all(
        props.tiles.map((tile: PostmortemStatusTile): Promise<number> => {
          return ModelAPI.count<Incident>({
            modelType: Incident,
            query: {
              projectId: props.projectId,
              postmortemStatusId: new ObjectID(tile.statusId),
            },
          });
        }),
      );

      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      const nextCounts: PostmortemStatusCounts = {};

      props.tiles.forEach((tile: PostmortemStatusTile, index: number) => {
        nextCounts[tile.statusId] = values[index] || 0;
      });

      setCounts(nextCounts);
      setHasError(false);
    } catch {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      /*
       * The strip is supplementary: hide it rather than break the page, or
       * leave numbers on screen that are known to be stale.
       */
      setHasError(true);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (props.tiles.length === 0) {
      return;
    }

    fetchCounts().catch(() => {
      // handled in fetchCounts.
    });
  }, [props.projectId.toString(), tileKey, props.refreshToken]);

  if (hasError || props.tiles.length === 0) {
    return <></>;
  }

  /*
   * A project with no incident has nothing to count: zeros above the empty
   * list would only say so four times. The strip shows once there is one.
   */
  if (
    counts &&
    Object.values(counts).every((count: number): boolean => {
      return count === 0;
    })
  ) {
    return <></>;
  }

  return (
    <div
      data-testid="postmortem-status-summary-cards"
      role="group"
      aria-label={translator.translateText("Postmortem status summary")}
      className={`mb-5 ${getPostmortemStatusTilesGridClassName(props.tiles.length)}`}
    >
      {props.tiles.map((tile: PostmortemStatusTile) => {
        const count: number = counts?.[tile.statusId] || 0;
        const isSelected: boolean = isPostmortemStatusTileApplied(
          tile,
          props.facetSelections,
          props.facetOperators,
        );

        return (
          <InfoCard
            key={tile.statusId}
            title={tile.name}
            /*
             * The tiles stay inert until the counts land: clicking a
             * skeleton would filter the list to a number nobody has read.
             */
            onClick={
              props.onTileClick && !isLoading
                ? () => {
                    props.onTileClick?.(tile);
                  }
                : undefined
            }
            isSelected={isSelected}
            ariaLabel={
              isSelected
                ? translator.translateTemplate(
                    "{{status}}: {{count}}. Filtering the postmortems below - activate to remove this filter.",
                    { status: tile.name, count: count },
                  )
                : translator.translateTemplate(
                    "{{status}}: {{count}}. Activate to show only these postmortems below.",
                    { status: tile.name, count: count },
                  )
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
                    data-testid={`postmortem-status-count-${tile.statusId}`}
                    className={`text-2xl font-semibold tabular-nums ${getPostmortemStatusTileCountClassName(
                      tile,
                      count,
                    )}`}
                  >
                    {translator.formatNumber(count)}
                  </div>
                  <div className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-gray-500">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: tile.color }}
                    ></span>
                    {/*
                     * The status's own description: the four a project
                     * starts with are read in the reader's language, a
                     * project's own as written.
                     */}
                    <span>{translator.translateText(tile.description)}</span>
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

export default PostmortemStatusSummaryCards;
