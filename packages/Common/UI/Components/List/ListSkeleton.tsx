import Skeleton from "../Skeleton/Skeleton";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /*
   * One placeholder line per field the real ListRow will render, so the
   * cards are the right height before the data arrives.
   */
  fieldsCount: number;
  itemsOnPage: number;
}

/*
 * Card-shaped placeholders for the list's first load, matching ListBody's
 * wrapper (space-y-6 p-6 border-t) so nothing shifts when real rows land.
 */
const ListSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Enough cards to look like a page without painting offscreen ones.
  const cardCount: number = Math.max(1, Math.min(props.itemsOnPage || 0, 6));
  const cardIndexes: Array<number> = Array.from(Array(cardCount).keys());
  const lineIndexes: Array<number> = Array.from(
    Array(Math.max(1, props.fieldsCount)).keys(),
  );

  return (
    <div
      data-testid="list-skeleton-loader"
      role="status"
      aria-live="polite"
      className="space-y-6 p-6 border-t border-gray-200"
    >
      <span className="sr-only">Loading...</span>
      {cardIndexes.map((cardIndex: number) => {
        return (
          <div key={cardIndex} className="space-y-3">
            {lineIndexes.map((lineIndex: number) => {
              return (
                <Skeleton
                  key={lineIndex}
                  className="h-4"
                  widthVariantIndex={cardIndex + lineIndex}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export default ListSkeleton;
