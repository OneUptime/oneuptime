import React, { FunctionComponent, ReactElement } from "react";

export interface FacetShowMoreButtonProps {
  // Whether the list is longer than the collapsed view in either direction.
  hasMore: boolean;
  isShowingAll: boolean;
  // Values the collapsed list holds back, counted from the filtered list.
  hiddenCount: number;
  onToggle: () => void;
}

/*
 * A facet section's "Show N more" / "Show less" toggle. Renders nothing when
 * the list already fits — a "Show less" with nothing to collapse is a dead
 * control.
 */
const FacetShowMoreButton: FunctionComponent<FacetShowMoreButtonProps> = (
  props: FacetShowMoreButtonProps,
): ReactElement | null => {
  if (!props.hasMore) {
    return null;
  }

  return (
    <button
      type="button"
      className="mt-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-indigo-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
      aria-expanded={props.isShowingAll}
      onClick={props.onToggle}
    >
      {props.isShowingAll ? "Show less" : `Show ${props.hiddenCount} more`}
    </button>
  );
};

export default FacetShowMoreButton;
