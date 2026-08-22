import React, { FunctionComponent, ReactElement } from "react";

export interface SavedViewsSearchInputProps {
  value: string;
  onChange: (searchText: string) => void;
  // Overrides the default placeholder/accessible name, e.g. per surface.
  label?: string | undefined;
  className?: string | undefined;
}

const DEFAULT_LABEL: string = "Search saved views...";

/*
 * One search box, shared by every saved-views surface, so the logs sidebar,
 * the logs dropdown and the telemetry dropdown cannot drift apart in look or
 * in accessible name. Styling deliberately matches the facet sections' search
 * input — the sidebar renders the two side by side.
 */
const SavedViewsSearchInput: FunctionComponent<SavedViewsSearchInputProps> = (
  props: SavedViewsSearchInputProps,
): ReactElement => {
  const label: string = props.label || DEFAULT_LABEL;

  return (
    <input
      type="text"
      /*
       * A placeholder is not a label: it disappears the moment the user
       * types, taking the field's only description with it. The aria-label
       * carries it for anyone who cannot see the box.
       */
      aria-label={label}
      placeholder={label}
      value={props.value}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
        props.onChange(event.target.value);
      }}
      className={
        props.className ||
        "w-full rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-700 placeholder-gray-400 outline-none focus:border-indigo-300 focus:bg-white focus:ring-1 focus:ring-indigo-200"
      }
    />
  );
};

export default SavedViewsSearchInput;
