import React, { FunctionComponent, ReactElement } from "react";
import { ActiveFilter } from "../types";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";

export interface ActiveFilterChipsProps {
  filters: Array<ActiveFilter>;
  onRemove: (facetKey: string, value: string) => void;
  onClearAll: () => void;
}

const ActiveFilterChips: FunctionComponent<ActiveFilterChipsProps> = (
  props: ActiveFilterChipsProps,
): ReactElement | null => {
  if (props.filters.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-0.5">
      {props.filters.map((filter: ActiveFilter) => {
        const chipKey: string = `${filter.facetKey}:${filter.value}`;
        return (
          <span
            key={chipKey}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 py-0.5 pl-2 pr-1 text-xs text-indigo-700"
          >
            <span className="font-medium text-indigo-500">
              {filter.displayKey}:
            </span>
            <span>{filter.displayValue}</span>
            <button
              type="button"
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600"
              onClick={() => {
                props.onRemove(filter.facetKey, filter.value);
              }}
              title={`Remove ${filter.displayKey}: ${filter.displayValue}`}
            >
              <Icon icon={IconProp.Close} className="h-2.5 w-2.5" />
            </button>
          </span>
        );
      })}
      {props.filters.length > 1 && (
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          onClick={props.onClearAll}
        >
          Clear all
        </button>
      )}
    </div>
  );
};

export default ActiveFilterChips;
