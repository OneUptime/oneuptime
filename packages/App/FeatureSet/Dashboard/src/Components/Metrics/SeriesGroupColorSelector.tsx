import React, { FunctionComponent, ReactElement, useState } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import SeriesColorSelector, {
  SERIES_COLOR_SWATCHES,
} from "./SeriesColorSelector";

export interface ComponentProps {
  // Attribute keys the query groups by (e.g. ["service.name"]).
  groupByKeys: Array<string>;
  // Discovered distinct values per group key (best-effort, may be partial).
  valueSuggestions: Record<string, Array<string>>;
  // Group keys whose values are currently being fetched.
  loadingKeys: Array<string>;
  // Current pins, keyed by the "key=value" segment (see MetricQueryConfigData).
  value: Record<string, string>;
  onChange: (colorsByGroup: Record<string, string>) => void;
}

/*
 * The value MetricCharts uses for a null/empty group. Offered as a pinnable
 * option so those series can be colored too.
 */
const UNSET_VALUE: string = "(unset)";

/*
 * Per-group color editor for GROUP-BY queries. Cardinality-safe: it renders one
 * row per PINNED value (not per discovered value, which can be hundreds), plus
 * an autocomplete "add" control fed by discovered values. Pins are keyed by the
 * exact "key=value" segment MetricCharts emits, so a pin on service.name=api
 * colors every series whose composed name contains that segment (works for
 * multi-key group-bys too).
 */
const SeriesGroupColorSelector: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const idPrefix: string = React.useId();
  // Per-key text buffer for the "add value" input.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const segmentsForKey: (key: string) => Array<string> = (
    key: string,
  ): Array<string> => {
    const prefix: string = `${key}=`;
    return Object.keys(props.value)
      .filter((segment: string): boolean => {
        return segment.startsWith(prefix);
      })
      .sort();
  };

  const valueOfSegment: (key: string, segment: string) => string = (
    key: string,
    segment: string,
  ): string => {
    return segment.slice(key.length + 1);
  };

  const setSegment: (segment: string, color: string | undefined) => void = (
    segment: string,
    color: string | undefined,
  ): void => {
    const next: Record<string, string> = { ...props.value };
    if (color) {
      next[segment] = color;
    } else {
      delete next[segment];
    }
    props.onChange(next);
  };

  const addValue: (key: string) => void = (key: string): void => {
    const raw: string = (drafts[key] || "").trim();
    setDrafts((d: Record<string, string>) => {
      return { ...d, [key]: "" };
    });
    if (!raw) {
      return;
    }
    const segment: string = `${key}=${raw}`;
    if (props.value[segment]) {
      return;
    }
    // Default a new pin to a palette color, rotating by how many exist.
    const existingCount: number = segmentsForKey(key).length;
    const defaultColor: string =
      SERIES_COLOR_SWATCHES[existingCount % SERIES_COLOR_SWATCHES.length]!.hex;
    setSegment(segment, defaultColor);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Group colors
        </label>
        <p className="text-xs text-gray-400">
          Pin a color to specific group values. Unpinned groups use the series
          color or theme palette.
        </p>
        {props.groupByKeys.length > 1 && (
          <p className="text-xs text-gray-400 mt-1">
            A pin on one attribute value applies to every series containing it.
          </p>
        )}
      </div>

      {props.groupByKeys.map((key: string): ReactElement => {
        const isLoading: boolean = props.loadingKeys.includes(key);
        const pinnedSegments: Array<string> = segmentsForKey(key);
        const pinnedValues: Set<string> = new Set<string>(
          pinnedSegments.map((segment: string): string => {
            return valueOfSegment(key, segment);
          }),
        );
        const suggestions: Array<string> = props.valueSuggestions[key] || [];
        const datalistId: string = `${idPrefix}-${key}`;
        const availableSuggestions: Array<string> = [
          UNSET_VALUE,
          ...suggestions,
        ].filter((v: string): boolean => {
          return !pinnedValues.has(v);
        });

        return (
          <div
            key={key}
            className="rounded-lg border border-gray-200 bg-white p-3"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-xs font-medium text-gray-700">
                {key}
              </span>
              {isLoading && (
                <span className="text-xs text-gray-400">loading values…</span>
              )}
            </div>

            {pinnedSegments.length > 0 ? (
              <div className="space-y-2 mb-2">
                {pinnedSegments.map((segment: string): ReactElement => {
                  const val: string = valueOfSegment(key, segment);
                  return (
                    <div key={segment} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <SeriesColorSelector
                          compact={true}
                          hideAuto={true}
                          label={val}
                          value={props.value[segment]}
                          onChange={(color: string | undefined) => {
                            setSegment(segment, color);
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        title={`Remove ${val}`}
                        aria-label={`Remove ${val}`}
                        onClick={() => {
                          setSegment(segment, undefined);
                        }}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                      >
                        <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs italic text-gray-400 mb-2">
                No pinned values yet.
              </p>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                list={datalistId}
                value={drafts[key] || ""}
                placeholder={
                  suggestions.length > 0
                    ? "Pick or type a value…"
                    : "Type a group value…"
                }
                spellCheck={false}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const next: string = e.target.value;
                  setDrafts((d: Record<string, string>) => {
                    return { ...d, [key]: next };
                  });
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addValue(key);
                  }
                }}
                className="h-7 flex-1 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <datalist id={datalistId}>
                {availableSuggestions.map((v: string) => {
                  return <option key={v} value={v} />;
                })}
              </datalist>
              <button
                type="button"
                onClick={() => {
                  addValue(key);
                }}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                <Icon icon={IconProp.Add} className="h-3 w-3" />
                Add
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SeriesGroupColorSelector;
