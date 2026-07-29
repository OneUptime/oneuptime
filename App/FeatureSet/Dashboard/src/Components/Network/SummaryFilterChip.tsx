import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // What the table is currently narrowed to, e.g. "Devices down / stale".
  label: string;
  /*
   * Optional qualifier shown next to the chip — used where the filter is a
   * snapshot rather than a live predicate, so the user can see how old it is
   * instead of wondering why a row disagrees with its own status column.
   */
  detail?: string | undefined;
  onClear: () => void;
  // Suffix for the chip's `data-testid`, so both pages stay distinguishable.
  testIdSuffix: string;
}

/*
 * The one visible sign that a table is showing a subset. A tile click narrows
 * the list below it, and without something like this the user is left staring
 * at a short table with no explanation and no way back other than reloading
 * the page.
 *
 * Rendered through ModelTable's `topContent`, so it sits inside the table
 * card, directly above the rows it describes.
 */
const SummaryFilterChip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      data-testid={`summary-filter-chip-${props.testIdSuffix}`}
      className="mb-4 flex items-center gap-2"
    >
      <span className="text-sm text-gray-500">Filtered by</span>
      <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 py-1 pl-3 pr-1 text-sm font-medium text-indigo-700">
        {props.label}
        <button
          type="button"
          aria-label={`Clear the ${props.label} filter`}
          data-testid={`summary-filter-chip-clear-${props.testIdSuffix}`}
          onClick={props.onClear}
          className="flex h-5 w-5 items-center justify-center rounded-full text-indigo-500 hover:bg-indigo-100 hover:text-indigo-800"
        >
          <Icon icon={IconProp.Close} size={SizeProp.ExtraSmall} />
        </button>
      </span>
      {props.detail ? (
        <span
          data-testid={`summary-filter-chip-detail-${props.testIdSuffix}`}
          className="text-sm text-gray-500"
        >
          {props.detail}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SummaryFilterChip;
