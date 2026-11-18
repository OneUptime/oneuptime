import SkeletonStatus, { SKELETON_BAR_CLASS_NAME } from "./SkeletonStatus";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a row of stat tiles shows while its figures load: one tile per
 * figure, in an InfoCard's own frame and padding, a name over a value, in
 * the grid the tiles will fill (#9220). A page passes its grid's classes,
 * so a row of five is drawn as five, and on a phone as the grid stacks.
 */

export const STAT_TILES_SKELETON_TEST_ID: string = "stat-tiles-skeleton";

export const DEFAULT_STAT_TILES_SKELETON_COUNT: number = 4;

// The grid most rows of tiles sit in: one on a phone, two, then four.
export const DEFAULT_STAT_TILES_GRID_CLASS_NAME: string =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4";

// An InfoCard's frame, without its hover (a skeleton is not a link).
export const STAT_TILE_SKELETON_FRAME_CLASS_NAME: string =
  "rounded-xl border border-gray-200 bg-white p-5 shadow-sm";

/*
 * A resource overview's golden tile (GoldenMetricTile): a name beside its
 * icon, the figure, a line under it and a meter.
 */
export const GOLDEN_TILE_SKELETON_FRAME_CLASS_NAME: string =
  "h-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm";

export type StatTileSkeletonKind = "info" | "golden";

const NAME_WIDTH_CLASS_NAMES: ReadonlyArray<string> = [
  "w-24",
  "w-20",
  "w-28",
  "w-16",
];

export interface BarsProps {
  count?: number | undefined;
  // The grid's classes, as the loaded tiles' grid has them.
  gridClassName?: string | undefined;
  // An InfoCard's tile (the default) or a resource overview's golden tile.
  kind?: StatTileSkeletonKind | undefined;
}

export interface ComponentProps extends BarsProps {
  className?: string | undefined;
}

export const StatTilesSkeletonBars: FunctionComponent<BarsProps> = (
  props: BarsProps,
): ReactElement => {
  const count: number = Math.max(
    1,
    props.count ?? DEFAULT_STAT_TILES_SKELETON_COUNT,
  );

  return (
    <div className={props.gridClassName || DEFAULT_STAT_TILES_GRID_CLASS_NAME}>
      {Array.from(Array(count).keys()).map((index: number) => {
        const nameWidthClassName: string = NAME_WIDTH_CLASS_NAMES[
          index % NAME_WIDTH_CLASS_NAMES.length
        ] as string;

        if (props.kind === "golden") {
          return (
            <div
              key={index}
              className={GOLDEN_TILE_SKELETON_FRAME_CLASS_NAME}
              data-testid={`${STAT_TILES_SKELETON_TEST_ID}-tile`}
            >
              <div className="mb-3 flex h-7 items-center justify-between">
                <div
                  className={`h-3 ${nameWidthClassName} ${SKELETON_BAR_CLASS_NAME}`}
                />
                <div className={`h-7 w-7 ${SKELETON_BAR_CLASS_NAME}`} />
              </div>
              <div className={`h-6 w-24 ${SKELETON_BAR_CLASS_NAME}`} />
              <div className={`mt-2 h-3 w-32 ${SKELETON_BAR_CLASS_NAME}`} />
              <div className={`mt-3 h-1.5 w-full ${SKELETON_BAR_CLASS_NAME}`} />
            </div>
          );
        }

        return (
          <div
            key={index}
            className={STAT_TILE_SKELETON_FRAME_CLASS_NAME}
            data-testid={`${STAT_TILES_SKELETON_TEST_ID}-tile`}
          >
            {/* The tile's name, on FieldLabel's line, then its figure. */}
            <div className="mb-2 flex h-5 items-center">
              <div
                className={`h-3 ${nameWidthClassName} ${SKELETON_BAR_CLASS_NAME}`}
              />
            </div>
            <div className="flex h-[26px] items-center">
              <div className={`h-5 w-16 ${SKELETON_BAR_CLASS_NAME}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const StatTilesSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SkeletonStatus
      dataTestId={STAT_TILES_SKELETON_TEST_ID}
      className={props.className}
    >
      <StatTilesSkeletonBars {...props} />
    </SkeletonStatus>
  );
};

export default StatTilesSkeleton;
