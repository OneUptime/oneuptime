import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import MetricAlias from "./MetricAlias";
import MetricQuery from "./MetricQuery";
import SeriesColorSelector from "./SeriesColorSelector";
import SeriesGroupColorSelector from "./SeriesGroupColorSelector";
import Card from "Common/UI/Components/Card/Card";
import MetricQueryConfigData, {
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MetricAliasData from "Common/Types/Metrics/MetricAliasData";
import MetricQueryData from "Common/Types/Metrics/MetricQueryData";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Dictionary from "Common/Types/Dictionary";
import {
  DictionaryEntryValue,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  detectOperatorFromValue,
  getOperatorOption,
} from "Common/UI/Components/Dictionary/DictionaryFilterOperator";

export interface ComponentProps {
  data: MetricQueryConfigData;
  onChange?: ((data: MetricQueryConfigData) => void) | undefined;
  metricTypes: Array<MetricType>;
  telemetryAttributes: string[];
  onRemove?: (() => void) | undefined;
  error?: string | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  tabIndex?: number | undefined;
  hideCard?: boolean | undefined;
  onAdvancedFiltersToggle?:
    | undefined
    | ((showAdvancedFilters: boolean) => void);
  attributesLoading?: boolean | undefined;
  attributesError?: string | undefined;
  onAttributesRetry?: (() => void) | undefined;
  onMetricNameChanged?: ((metricName: string) => void) | undefined;
  telemetryAttributeValueSuggestions?:
    | Record<string, Array<string>>
    | undefined;
  onAttributeKeySelected?: ((key: string) => void) | undefined;
  onAttributeValueSearch?:
    | ((key: string, searchText: string) => void)
    | undefined;
  loadingAttributeValueKeys?: Array<string> | undefined;
  /*
   * Whether this query may overlay onto the previous query's chart panel
   * (i.e. it is not the first query in the view). The overlay toggle in
   * Display Settings is only rendered when true.
   */
  canOverlayWithPreviousQuery?: boolean | undefined;
  // Initial state of the "Filters & grouping" section (see MetricQuery).
  defaultShowAdvancedFilters?: boolean | undefined;
}

// Options for the Display Settings "Chart type" select.
const CHART_TYPE_OPTIONS: Array<DropdownOption> = [
  { value: MetricChartType.LINE, label: "Line" },
  { value: MetricChartType.AREA, label: "Area" },
  { value: MetricChartType.BAR, label: "Bar" },
];

const SIX_DIGIT_HEX_REGEX: RegExp = /^#[0-9a-fA-F]{6}$/;

/*
 * Tint styles for the variable badge from the query's lead series color.
 * A 6-digit hex gets an alpha-suffixed wash; anything else (or no color)
 * returns undefined so the badge falls back to the indigo utility tint.
 */
function getBadgeTintStyle(
  color: string | undefined,
): React.CSSProperties | undefined {
  if (!color || !SIX_DIGIT_HEX_REGEX.test(color)) {
    return undefined;
  }
  return {
    backgroundColor: `${color}1f`,
    borderColor: `${color}55`,
    /*
     * Text stays theme-driven rather than using the raw user hex: a dark
     * hex is illegible on the dark surface (and a pale hex on the light
     * one), and inline styles would beat Theme.css's dark-mode overrides.
     * The wash is only ~12% alpha over the card surface, so the theme's
     * own text color is always readable on it in both modes.
     */
    color: "var(--ou-text-primary)",
  };
}

const MetricGraphConfig: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showDisplaySettings, setShowDisplaySettings] =
    useState<boolean>(false);

  /*
   * Group-by attribute keys this query splits into series. Drives the per-group
   * color editor and its value discovery.
   */
  const groupByKeys: Array<string> =
    props.data?.metricQueryData?.groupByAttributeKeys || [];
  const groupByKeysDep: string = groupByKeys.join("|");
  const metricNameForGrouping: string =
    props.data?.metricQueryData?.filterData?.metricName?.toString() || "";

  /*
   * Whether any per-group pin belongs to a CURRENT group-by key. Pins for keys
   * the query no longer groups by are intentionally kept in storage (so they
   * return if the key is re-added rather than being destroyed on a toggle), but
   * they are inert and must not light the "customized" indicator.
   */
  const groupColorPinsMap: Record<string, string> =
    props.data?.colorsByGroup || {};
  const hasActiveGroupColorPins: boolean = groupByKeys.some(
    (key: string): boolean => {
      return Object.keys(groupColorPinsMap).some((segment: string): boolean => {
        return segment.startsWith(`${key}=`);
      });
    },
  );

  /*
   * Load distinct values for each group-by key so the per-group editor can
   * suggest them. The Group By multi-select never triggers a value fetch (only
   * the JSON filter editor does), so kick it off here via onAttributeKeySelected
   * (which maps to loadAttributeValues in ArgumentsForm and is itself
   * de-duplicated). Guarded so it doesn't refetch keys already loaded/loading.
   */
  useEffect(() => {
    if (!metricNameForGrouping) {
      return;
    }
    for (const key of groupByKeys) {
      const hasValues: boolean = Boolean(
        props.telemetryAttributeValueSuggestions?.[key],
      );
      const isLoading: boolean = Boolean(
        props.loadingAttributeValueKeys?.includes(key),
      );
      if (!hasValues && !isLoading) {
        props.onAttributeKeySelected?.(key);
      }
    }
  }, [groupByKeysDep, metricNameForGrouping]);

  const defaultAliasData: MetricAliasData = {
    metricVariable: undefined,
    title: undefined,
    description: undefined,
    legend: undefined,
    legendUnit: undefined,
  };

  /*
   * Compute active attribute count for the header summary.
   * Empty key or empty value entries are ignored — they aren't applied as
   * filters and shouldn't appear in the "Filtered by:" chips either.
   * Operator wrappers (NotEqual, IsNull, etc.) are kept; for value-less
   * operators (IsEmpty, IsNotEmpty) the entry is valid even with an
   * empty raw value.
   */
  const rawAttributes: Dictionary<DictionaryEntryValue> | undefined = (
    props.data?.metricQueryData?.filterData as Record<string, unknown>
  )?.["attributes"] as Dictionary<DictionaryEntryValue> | undefined;

  const attributes: Dictionary<DictionaryEntryValue> | undefined = (() => {
    if (!rawAttributes) {
      return undefined;
    }
    const filtered: Dictionary<DictionaryEntryValue> = {};
    for (const [key, value] of Object.entries(rawAttributes)) {
      if (key.trim() === "" || value === undefined || value === null) {
        continue;
      }
      const detected: {
        operator: DictionaryFilterOperator;
        rawValue: string;
      } = detectOperatorFromValue(value);
      const option: DictionaryFilterOperatorOption = getOperatorOption(
        detected.operator,
      );
      /*
       * IsEmpty/IsNotEmpty are valid without a value; everything else
       * must have a non-empty raw value to count.
       */
      if (!option.hidesValueInput && detected.rawValue.trim() === "") {
        continue;
      }
      filtered[key] = value;
    }
    return filtered;
  })();

  const activeAttributeCount: number = attributes
    ? Object.keys(attributes).length
    : 0;

  const metricName: string =
    props.data?.metricQueryData?.filterData?.metricName?.toString() ||
    "No metric selected";

  /*
   * Look up the currently selected metric's native unit so MetricAlias
   * can show a dropdown of compatible units (e.g. ms/sec/min when the
   * metric is in seconds) rather than a free-text input.
   */
  const selectedMetricType: MetricType | undefined = props.metricTypes.find(
    (m: MetricType) => {
      return (
        m.name ===
        props.data?.metricQueryData?.filterData?.metricName?.toString()
      );
    },
  );
  const selectedMetricNativeUnit: string | undefined =
    selectedMetricType?.unit || undefined;

  const aggregationType: string =
    props.data?.metricQueryData?.filterData?.aggegationType?.toString() ||
    "Avg";

  // Remove a single attribute filter
  const handleRemoveAttribute: (key: string) => void = (key: string): void => {
    if (!attributes) {
      return;
    }

    const newAttributes: Dictionary<DictionaryEntryValue> = {
      ...attributes,
    };
    delete newAttributes[key];

    const newFilterData: Record<string, unknown> = {
      ...(props.data.metricQueryData.filterData as Record<string, unknown>),
    };

    if (Object.keys(newAttributes).length > 0) {
      newFilterData["attributes"] = newAttributes;
    } else {
      delete newFilterData["attributes"];
    }

    if (props.onChange) {
      props.onChange({
        ...props.data,
        metricQueryData: {
          ...props.data.metricQueryData,
          filterData: newFilterData as MetricQueryData["filterData"],
        },
      });
    }
  };

  // Clear all attribute filters
  const handleClearAllAttributes: () => void = (): void => {
    const newFilterData: Record<string, unknown> = {
      ...(props.data.metricQueryData.filterData as Record<string, unknown>),
    };
    delete newFilterData["attributes"];

    if (props.onChange) {
      props.onChange({
        ...props.data,
        metricQueryData: {
          ...props.data.metricQueryData,
          filterData: newFilterData as MetricQueryData["filterData"],
        },
      });
    }
  };

  const getHeader: () => ReactElement = (): ReactElement => {
    const badgeTintStyle: React.CSSProperties | undefined = getBadgeTintStyle(
      props.data?.color,
    );

    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Variable badge, tinted with the query's lead series color */}
          {props.data?.metricAliasData?.metricVariable && (
            <div
              className={`flex h-6 w-6 min-w-6 items-center justify-center rounded-md border text-xs font-bold ${
                badgeTintStyle
                  ? ""
                  : "border-indigo-200 bg-indigo-50 text-indigo-700"
              }`}
              style={badgeTintStyle}
            >
              {props.data.metricAliasData.metricVariable}
            </div>
          )}
          {/* Summary info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900 truncate">
                {metricName}
              </span>
              <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {aggregationType}
              </span>
              {/* Quiet metadata chips — summary while the body is collapsed */}
              {!isExpanded && activeAttributeCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  <Icon icon={IconProp.Filter} className="h-3 w-3" />
                  {activeAttributeCount}{" "}
                  {activeAttributeCount === 1 ? "filter" : "filters"}
                </span>
              )}
              {!isExpanded && groupByKeys.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {groupByKeys.length}{" "}
                  {groupByKeys.length === 1 ? "group-by" : "group-bys"}
                </span>
              )}
            </div>
            {props.data?.metricAliasData?.title &&
              props.data.metricAliasData.title !== metricName && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {props.data.metricAliasData.title}
                </p>
              )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 ml-3">
          <button
            type="button"
            aria-label={isExpanded ? "Collapse query" : "Expand query"}
            aria-expanded={isExpanded}
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
            title={isExpanded ? "Collapse" : "Expand"}
          >
            <Icon
              icon={isExpanded ? IconProp.ChevronUp : IconProp.ChevronDown}
              className="h-4 w-4"
            />
          </button>
          {props.onRemove && (
            <button
              type="button"
              aria-label="Remove query"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              onClick={() => {
                props.onBlur?.();
                props.onFocus?.();
                return props.onRemove?.();
              }}
              title="Remove query"
            >
              <Icon icon={IconProp.Trash} className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const getAttributeChips: () => ReactElement | null =
    (): ReactElement | null => {
      if (!attributes || activeAttributeCount === 0) {
        return null;
      }

      return (
        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-gray-100">
          <span className="text-xs text-gray-400 font-medium mr-1">
            Filtered by:
          </span>
          {Object.entries(attributes).map(
            ([key, value]: [string, DictionaryEntryValue]) => {
              const detected: {
                operator: DictionaryFilterOperator;
                rawValue: string;
              } = detectOperatorFromValue(value);
              const option: DictionaryFilterOperatorOption = getOperatorOption(
                detected.operator,
              );
              const valueSegment: string = option.hidesValueInput
                ? ""
                : detected.rawValue;
              const chipText: string = option.hidesValueInput
                ? `${key} ${option.symbol}`
                : `${key} ${option.symbol} ${valueSegment}`;
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 py-0.5 pl-2 pr-1 text-xs text-indigo-700"
                >
                  <span className="font-medium text-indigo-500">{key}</span>
                  <span className="text-indigo-400">{option.symbol}</span>
                  {!option.hidesValueInput && <span>{valueSegment}</span>}
                  <button
                    type="button"
                    aria-label={`Remove filter ${chipText}`}
                    className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    onClick={() => {
                      handleRemoveAttribute(key);
                    }}
                    title={`Remove ${chipText}`}
                  >
                    <Icon icon={IconProp.Close} className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            },
          )}
          {activeAttributeCount > 1 && (
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              onClick={handleClearAllAttributes}
            >
              Clear all
            </button>
          )}
        </div>
      );
    };

  const getContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        {/* Header with summary */}
        {getHeader()}

        {/* Expandable content */}
        {isExpanded && (
          <div className="mt-4 space-y-4">
            {/* Metric query selection */}
            {props.data?.metricQueryData && (
              <MetricQuery
                data={props.data?.metricQueryData || {}}
                onDataChanged={(data: MetricQueryData) => {
                  props.onBlur?.();
                  props.onFocus?.();
                  if (props.onChange) {
                    const selectedMetricName: string | undefined =
                      data.filterData?.metricName?.toString();
                    const previousMetricName: string | undefined =
                      props.data?.metricQueryData?.filterData?.metricName?.toString();

                    // If metric changed, prefill all alias fields from MetricType and reload attributes
                    if (
                      selectedMetricName &&
                      selectedMetricName !== previousMetricName
                    ) {
                      props.onMetricNameChanged?.(selectedMetricName);
                      const metricType: MetricType | undefined =
                        props.metricTypes.find((m: MetricType) => {
                          return m.name === selectedMetricName;
                        });

                      if (metricType) {
                        const currentAlias: MetricAliasData =
                          props.data.metricAliasData || defaultAliasData;

                        props.onChange({
                          ...props.data,
                          metricQueryData: data,
                          metricAliasData: {
                            ...currentAlias,
                            title: metricType.name || "",
                            description: metricType.description || "",
                            legend: metricType.name || "",
                            legendUnit: metricType.unit || "",
                          },
                        });
                        return;
                      }
                    }

                    props.onChange({ ...props.data, metricQueryData: data });
                  }
                }}
                metricTypes={props.metricTypes}
                transformAsRate={props.data?.transformAsRate}
                onEnableRateTransform={() => {
                  props.onBlur?.();
                  props.onFocus?.();
                  if (props.onChange) {
                    props.onChange({
                      ...props.data,
                      transformAsRate: true,
                    });
                  }
                }}
                defaultShowAdvancedFilters={props.defaultShowAdvancedFilters}
                telemetryAttributes={props.telemetryAttributes}
                telemetryAttributeValueSuggestions={
                  props.telemetryAttributeValueSuggestions
                }
                onAttributeKeySelected={props.onAttributeKeySelected}
                onAttributeValueSearch={props.onAttributeValueSearch}
                onAdvancedFiltersToggle={props.onAdvancedFiltersToggle}
                isAttributesLoading={props.attributesLoading}
                attributesError={props.attributesError}
                onAttributesRetry={props.onAttributesRetry}
                loadingAttributeValueKeys={props.loadingAttributeValueKeys}
              />
            )}

            {/* Attribute filter chips */}
            {getAttributeChips()}

            {/* Display Settings - collapsible */}
            <div className="border-t border-gray-200 pt-3">
              <button
                type="button"
                aria-expanded={showDisplaySettings}
                className="flex w-full items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 transition-colors hover:text-gray-600"
                onClick={() => {
                  setShowDisplaySettings(!showDisplaySettings);
                }}
              >
                <Icon
                  icon={
                    showDisplaySettings
                      ? IconProp.ChevronDown
                      : IconProp.ChevronRight
                  }
                  className="h-3 w-3"
                />
                <span>Display Settings</span>
                {(props.data?.metricAliasData?.title ||
                  props.data?.color ||
                  props.data?.chartType ||
                  hasActiveGroupColorPins ||
                  props.data?.transformAsRate ||
                  props.data?.overlayWithPreviousQuery ||
                  props.data?.warningThreshold !== undefined ||
                  props.data?.criticalThreshold !== undefined) && (
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400" />
                )}
              </button>

              {showDisplaySettings && (
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <MetricAlias
                      data={props.data?.metricAliasData || defaultAliasData}
                      onDataChanged={(data: MetricAliasData) => {
                        props.onBlur?.();
                        props.onFocus?.();
                        if (props.onChange) {
                          props.onChange({
                            ...props.data,
                            metricAliasData: data,
                          });
                        }
                      }}
                      isFormula={false}
                      hideVariableBadge={true}
                      unitFamilyBasedOn={selectedMetricNativeUnit}
                    />
                  </div>

                  {/* Chart type (Area is the render default when unset) */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Chart type
                    </label>
                    <Dropdown
                      options={CHART_TYPE_OPTIONS}
                      value={
                        CHART_TYPE_OPTIONS.find((option: DropdownOption) => {
                          return (
                            option.value ===
                            (props.data?.chartType || MetricChartType.AREA)
                          );
                        }) || undefined
                      }
                      onChange={(
                        value: DropdownValue | Array<DropdownValue> | null,
                      ) => {
                        props.onBlur?.();
                        props.onFocus?.();
                        if (props.onChange) {
                          const chartType: MetricChartType | undefined =
                            value === MetricChartType.LINE ||
                            value === MetricChartType.BAR
                              ? (value as MetricChartType)
                              : undefined;
                          props.onChange({
                            ...props.data,
                            chartType: chartType,
                          });
                        }
                      }}
                    />
                  </div>

                  {/* Series color */}
                  <SeriesColorSelector
                    label={
                      groupByKeys.length > 0
                        ? "Default series color"
                        : undefined
                    }
                    description={
                      groupByKeys.length > 0
                        ? "Colors the first unpinned group; the rest use the theme palette."
                        : undefined
                    }
                    value={props.data?.color}
                    onChange={(color: string | undefined) => {
                      props.onBlur?.();
                      props.onFocus?.();
                      if (props.onChange) {
                        props.onChange({
                          ...props.data,
                          color: color,
                        });
                      }
                    }}
                  />

                  {/* Per-group color pins (only for group-by queries) */}
                  {groupByKeys.length > 0 && (
                    <div className="sm:col-span-2">
                      <SeriesGroupColorSelector
                        groupByKeys={groupByKeys}
                        valueSuggestions={
                          props.telemetryAttributeValueSuggestions || {}
                        }
                        loadingKeys={props.loadingAttributeValueKeys || []}
                        value={props.data?.colorsByGroup || {}}
                        onChange={(colorsByGroup: Record<string, string>) => {
                          props.onBlur?.();
                          props.onFocus?.();
                          if (props.onChange) {
                            props.onChange({
                              ...props.data,
                              colorsByGroup:
                                Object.keys(colorsByGroup).length > 0
                                  ? colorsByGroup
                                  : undefined,
                            });
                          }
                        }}
                      />
                    </div>
                  )}

                  {/* Per-second rate transform (for cumulative counters) */}
                  <Toggle
                    title="Convert to per-second rate"
                    description="Plot the per-second rate of change instead of the raw value. Recommended for cumulative counters (e.g. system.disk.io)."
                    value={props.data?.transformAsRate || false}
                    onChange={(checked: boolean) => {
                      props.onBlur?.();
                      props.onFocus?.();
                      if (props.onChange) {
                        props.onChange({
                          ...props.data,
                          transformAsRate: checked ? true : undefined,
                        });
                      }
                    }}
                  />

                  {/* Overlay onto the previous query's chart panel */}
                  {props.canOverlayWithPreviousQuery && (
                    <Toggle
                      title="Overlay with previous query"
                      description="Draw this query on the previous query's chart instead of its own, sharing the same axes."
                      value={props.data?.overlayWithPreviousQuery || false}
                      onChange={(checked: boolean) => {
                        props.onBlur?.();
                        props.onFocus?.();
                        if (props.onChange) {
                          props.onChange({
                            ...props.data,
                            overlayWithPreviousQuery: checked
                              ? true
                              : undefined,
                          });
                        }
                      }}
                    />
                  )}

                  {/* Thresholds */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Warning Threshold
                    </label>
                    <Input
                      value={props.data?.warningThreshold?.toString() || ""}
                      type={InputType.NUMBER}
                      onChange={(value: string) => {
                        props.onBlur?.();
                        props.onFocus?.();
                        if (props.onChange) {
                          props.onChange({
                            ...props.data,
                            warningThreshold: value ? Number(value) : undefined,
                          });
                        }
                      }}
                      placeholder="e.g. 80"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Critical Threshold
                    </label>
                    <Input
                      value={props.data?.criticalThreshold?.toString() || ""}
                      type={InputType.NUMBER}
                      onChange={(value: string) => {
                        props.onBlur?.();
                        props.onFocus?.();
                        if (props.onChange) {
                          props.onChange({
                            ...props.data,
                            criticalThreshold: value
                              ? Number(value)
                              : undefined,
                          });
                        }
                      }}
                      placeholder="e.g. 95"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {props.error && (
          <p data-testid="error-message" className="mt-3 text-sm text-red-400">
            {props.error}
          </p>
        )}
      </div>
    );
  };

  if (props.hideCard) {
    return getContent();
  }

  return (
    <Card>
      <div className="-mt-5" tabIndex={props.tabIndex}>
        {getContent()}
      </div>
    </Card>
  );
};

export default MetricGraphConfig;
