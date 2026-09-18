import React, { FunctionComponent, ReactElement } from "react";

export interface SavedViewsShowMoreButtonProps {
  /*
   * Whether the toggle has anything to do in either direction. Taken straight
   * from getVisibleSavedViews, which answers it from the list rather than from
   * the expanded flag — otherwise a list that shrinks while expanded leaves a
   * "Show less" behind that collapses nothing.
   */
  hasMore: boolean;
  isShowingAll: boolean;
  // Matching views the collapsed list holds back. Zero while expanded.
  hiddenCount: number;
  onToggle: () => void;
  className?: string | undefined;
}

/*
 * The "+N more" / "Show less" toggle the facet sections use, lifted out so the
 * saved-views lists read the same way. Renders nothing when the list is
 * already whole — a "Show less" with nothing to collapse is a dead control.
 */
const SavedViewsShowMoreButton: FunctionComponent<
  SavedViewsShowMoreButtonProps
> = (props: SavedViewsShowMoreButtonProps): ReactElement | null => {
  if (!props.hasMore) {
    return null;
  }

  return (
    <button
      type="button"
      className={
        props.className ||
        "mt-1 px-1 text-[11px] font-medium text-indigo-500 hover:text-indigo-600"
      }
      onClick={props.onToggle}
    >
      {props.isShowingAll ? "Show less" : `+${props.hiddenCount} more`}
    </button>
  );
};

export default SavedViewsShowMoreButton;
