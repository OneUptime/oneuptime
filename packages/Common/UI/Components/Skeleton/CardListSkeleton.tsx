import SkeletonStatus, { SKELETON_BAR_CLASS_NAME } from "./SkeletonStatus";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a list of cards shows while it loads: one bordered card per item,
 * with a title and a line or two under it, stacked or in the grid the
 * cards will fill (#9220). For the lists a page draws by hand (resources,
 * insights, integrations); a List draws its own (ListSkeleton).
 */

export const CARD_LIST_SKELETON_TEST_ID: string = "card-list-skeleton";

export const DEFAULT_CARD_LIST_SKELETON_COUNT: number = 3;
export const DEFAULT_CARD_LIST_SKELETON_LINES: number = 2;

// Cards one under another, as most lists draw them.
export const DEFAULT_CARD_LIST_GRID_CLASS_NAME: string = "space-y-3";

const LINE_WIDTH_CLASS_NAMES: ReadonlyArray<string> = [
  "w-5/6",
  "w-2/3",
  "w-3/4",
];

export interface BarsProps {
  count?: number | undefined;
  // The lines under each card's title.
  lines?: number | undefined;
  // The list's classes, as the loaded cards' list has them (a grid, a stack).
  gridClassName?: string | undefined;
}

export interface ComponentProps extends BarsProps {
  className?: string | undefined;
}

export const CardListSkeletonBars: FunctionComponent<BarsProps> = (
  props: BarsProps,
): ReactElement => {
  const count: number = Math.max(
    1,
    props.count ?? DEFAULT_CARD_LIST_SKELETON_COUNT,
  );
  const lineCount: number = Math.max(
    0,
    props.lines ?? DEFAULT_CARD_LIST_SKELETON_LINES,
  );

  return (
    <div className={props.gridClassName || DEFAULT_CARD_LIST_GRID_CLASS_NAME}>
      {Array.from(Array(count).keys()).map((cardIndex: number) => {
        return (
          <div
            key={cardIndex}
            className="rounded-lg border border-gray-200 bg-white p-4"
            data-testid={`${CARD_LIST_SKELETON_TEST_ID}-card`}
          >
            <div className="flex h-6 items-center gap-3">
              <div className={`h-6 w-6 shrink-0 ${SKELETON_BAR_CLASS_NAME}`} />
              <div className={`h-4 w-40 ${SKELETON_BAR_CLASS_NAME}`} />
            </div>
            {Array.from(Array(lineCount).keys()).map((lineIndex: number) => {
              return (
                <div key={lineIndex} className="mt-2 flex h-5 items-center">
                  <div
                    className={`h-3 ${
                      LINE_WIDTH_CLASS_NAMES[
                        (cardIndex + lineIndex) % LINE_WIDTH_CLASS_NAMES.length
                      ]
                    } ${SKELETON_BAR_CLASS_NAME}`}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

const CardListSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SkeletonStatus
      dataTestId={CARD_LIST_SKELETON_TEST_ID}
      className={props.className}
    >
      <CardListSkeletonBars {...props} />
    </SkeletonStatus>
  );
};

export default CardListSkeleton;
