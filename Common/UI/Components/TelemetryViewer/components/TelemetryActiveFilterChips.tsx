import React, { FunctionComponent, ReactElement } from "react";
import { ActiveFilter } from "../types";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";

export interface TelemetryActiveFilterChipsProps {
  filters: Array<ActiveFilter>;
  onRemove: (facetKey: string, value: string) => void;
  onClearAll: () => void;
}

const TelemetryActiveFilterChips: FunctionComponent<
  TelemetryActiveFilterChipsProps
> = (props: TelemetryActiveFilterChipsProps): ReactElement | null => {
  if (props.filters.length === 0) {
    return null;
  }

  const readOnlyFilters: Array<ActiveFilter> = props.filters.filter(
    (f: ActiveFilter) => {
      return f.readOnly;
    },
  );
  const removableFilters: Array<ActiveFilter> = props.filters.filter(
    (f: ActiveFilter) => {
      return !f.readOnly;
    },
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-0.5">
      {readOnlyFilters.map((filter: ActiveFilter) => {
        const chipKey: string = `readonly:${filter.facetKey}:${filter.value}`;
        return (
          <span
            key={chipKey}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-gray-100 py-0.5 pl-2 pr-2 text-xs text-gray-700"
            title={`${filter.displayKey}: ${filter.displayValue} (applied filter)`}
          >
            <Icon icon={IconProp.Lock} className="h-2.5 w-2.5 text-gray-400" />
            <span className="font-medium text-gray-500">
              {filter.displayKey}:
            </span>
            <span>{filter.displayValue}</span>
          </span>
        );
      })}
      {removableFilters.map((filter: ActiveFilter) => {
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
      {removableFilters.length > 1 && (
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

export default TelemetryActiveFilterChips;
