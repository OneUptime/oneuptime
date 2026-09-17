import React, { FunctionComponent, ReactElement } from "react";
import { ActiveFilter } from "../types";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import Link from "../../Link/Link";
import { formatDictionaryValueForDisplay } from "../../Dictionary/DictionaryFilterOperator";
import LockedFilterChip from "../../TelemetryViewer/components/LockedFilterChip";
import { TelemetrySignal } from "../../../../Utils/Telemetry/LockedFilterSearch";

export interface ActiveFilterChipsProps {
  filters: Array<ActiveFilter>;
  onRemove: (facetKey: string, value: string) => void;
  onClearAll: () => void;
  /*
   * Which explorer the read-only chips belong to — names the explorer in the
   * locked chips' tooltips. Defaults to logs, the only signal this list
   * renders.
   */
  signal?: TelemetrySignal | undefined;
}

/*
 * `ActiveFilter.displayValue` is typed `string`, but chips are built from
 * query objects that reach here through `as` casts, and an attribute filter
 * carrying an operator (`contains`, `is any of`, ...) is an object, not a
 * string. React answers an object child by throwing, which unmounts whatever
 * renders the viewer — for the log monitor's criteria modal that meant a
 * "Something went wrong" card in place of the form and no way to reach Save.
 *
 * Callers are expected to format their own text (see the log viewer's base
 * chips); this is the backstop that keeps a mistyped value a bad-looking chip
 * instead of a lost page.
 */
const chipText: (value: string) => string = (value: string): string => {
  if (typeof value === "string") {
    return value;
  }

  return formatDictionaryValueForDisplay(value);
};

const renderOpenAffordance: (
  filter: ActiveFilter,
  colorClassName: string,
) => ReactElement | null = (
  filter: ActiveFilter,
  colorClassName: string,
): ReactElement | null => {
  if (!filter.openRoute) {
    return null;
  }

  return (
    <Link
      to={filter.openRoute}
      className={`ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded transition-colors ${colorClassName}`}
      title={`Open ${filter.displayKey.toLowerCase()} view`}
    >
      <Icon icon={IconProp.ExternalLink} className="h-2.5 w-2.5" />
    </Link>
  );
};

const ActiveFilterChips: FunctionComponent<ActiveFilterChipsProps> = (
  props: ActiveFilterChipsProps,
): ReactElement | null => {
  if (props.filters.length === 0) {
    return null;
  }

  const signal: TelemetrySignal = props.signal || "logs";

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
        const chipKey: string = `readonly:${filter.facetKey}:${chipText(filter.value)}`;
        return (
          <LockedFilterChip
            key={chipKey}
            displayKey={filter.displayKey}
            displayValue={chipText(filter.displayValue)}
            lockedDetail={filter.lockedDetail}
            signal={signal}
            trailing={renderOpenAffordance(
              filter,
              "text-gray-400 hover:bg-gray-200 hover:text-indigo-600",
            )}
          />
        );
      })}
      {removableFilters.map((filter: ActiveFilter) => {
        const chipKey: string = `${filter.facetKey}:${chipText(filter.value)}`;
        return (
          <span
            key={chipKey}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 py-0.5 pl-2 pr-1 text-xs text-indigo-700"
          >
            <span className="font-medium text-indigo-500">
              {filter.displayKey}:
            </span>
            <span>{chipText(filter.displayValue)}</span>
            {renderOpenAffordance(
              filter,
              "text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600",
            )}
            <button
              type="button"
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600"
              onClick={() => {
                /*
                 * The same coercion the chip's text gets. `value` is what the
                 * viewer deletes out of its Set<string> of applied filters, so
                 * handing the handler a raw object made the chip render fine
                 * and then refuse to be removed.
                 */
                props.onRemove(filter.facetKey, chipText(filter.value));
              }}
              title={`Remove ${filter.displayKey}: ${chipText(filter.displayValue)}`}
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

export default ActiveFilterChips;
