import FieldType from "Common/UI/Components/Types/FieldType";
import JSONFilter from "Common/UI/Components/Filters/JSONFilter";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IconProp from "Common/Types/Icon/IconProp";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricsQuery from "Common/Types/Metrics/MetricsQuery";
import MetricQueryData from "Common/Types/Metrics/MetricQueryData";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import { AggregationTemporality } from "Common/Models/AnalyticsModels/Metric";
import Icon from "Common/UI/Components/Icon/Icon";
import HintChip from "./HintChip";

export interface ComponentProps {
  data: MetricQueryData;
  onDataChanged: (filterData: MetricQueryData) => void;
  metricTypes: Array<MetricType>;
  telemetryAttributes: string[];
  telemetryAttributeValueSuggestions?:
    | Record<string, Array<string>>
    | undefined;
  onAttributeKeySelected?: ((key: string) => void) | undefined;
  onAttributeValueSearch?:
    | ((key: string, searchText: string) => void)
    | undefined;
  onAdvancedFiltersToggle?:
    | undefined
    | ((showAdvancedFilters: boolean) => void);
  isAttributesLoading?: boolean | undefined;
  attributesError?: string | undefined;
  onAttributesRetry?: (() => void) | undefined;
  loadingAttributeValueKeys?: Array<string> | undefined;
  /*
   * Whether the owning query already plots as a per-second rate
   * (MetricQueryConfigData.transformAsRate). Suppresses the cumulative-
   * counter hint below the aggregation picker when true.
   */
  transformAsRate?: boolean | undefined;
  // Enables the rate transform on the owning query (hint-chip click).
  onEnableRateTransform?: (() => void) | undefined;
  /*
   * Initial state of the "Filters & grouping" section. Hosts pass true
   * when the query already carries attribute filters or group-by keys so
   * a deep-linked/saved view opens with its filters visible.
   */
  defaultShowAdvancedFilters?: boolean | undefined;
}

/*
 * Name suffixes that suggest a cumulative counter when the MetricType
 * catalog carries no counter metadata (older ingests) — used for a
 * softer version of the rate-transform hint.
 */
const COUNTER_LIKE_NAME_SUFFIXES: Array<string> = [
  ".count",
  "_total",
  ".io",
  ".sum",
];

const MetricFilter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(
    props.defaultShowAdvancedFilters || false,
  );

  /*
   * When the section starts open (pre-filtered query), the host still
   * needs the toggle callback to kick off its attribute fetch — the
   * user never clicked the toggle, so fire it once on mount.
   */
  useEffect(() => {
    if (showAdvancedFilters) {
      props.onAdvancedFiltersToggle?.(true);
    }
  }, []);

  /*
   * Metric name the user dismissed the rate hint for. Keyed by name (not a
   * boolean) so switching to another counter metric re-surfaces the hint.
   */
  const [rateHintDismissedForMetric, setRateHintDismissedForMetric] =
    useState<string>("");

  const selectedMetricName: string =
    props.data.filterData?.metricName?.toString() || "";
  const selectedMetricType: MetricType | undefined = props.metricTypes.find(
    (metricType: MetricType) => {
      return metricType.name === selectedMetricName;
    },
  );

  /*
   * Cumulative-counter hint. The strong form fires when the MetricType
   * catalog says the metric is a Cumulative monotonic counter; when that
   * metadata is absent (older ingests), fall back to a name heuristic
   * with softer copy. Metadata that says "not a cumulative counter"
   * (Delta, or isMonotonic false) suppresses the heuristic too.
   */
  const hasCounterMetadata: boolean =
    selectedMetricType?.aggregationTemporality !== undefined ||
    selectedMetricType?.isMonotonic !== undefined;
  const isKnownCumulativeCounter: boolean =
    selectedMetricType?.aggregationTemporality ===
      AggregationTemporality.Cumulative &&
    selectedMetricType?.isMonotonic === true;
  const looksLikeCounterByName: boolean = COUNTER_LIKE_NAME_SUFFIXES.some(
    (suffix: string) => {
      return selectedMetricName.endsWith(suffix);
    },
  );

  const showRateHint: boolean =
    Boolean(selectedMetricName) &&
    Boolean(props.onEnableRateTransform) &&
    !props.transformAsRate &&
    rateHintDismissedForMetric !== selectedMetricName &&
    (isKnownCumulativeCounter ||
      (!hasCounterMetadata && looksLikeCounterByName));

  const rateHintCopy: string = isKnownCumulativeCounter
    ? "Cumulative counter — convert to per-second rate?"
    : "This metric looks like a cumulative counter — convert to per-second rate?";

  const toggleAdvancedFilters: () => void = (): void => {
    setShowAdvancedFilters((prev: boolean): boolean => {
      const next: boolean = !prev;
      props.onAdvancedFiltersToggle?.(next);
      return next;
    });
  };

  /*
   * Direct write onto filterData (the shape FiltersForm used to manage):
   * set or delete a single key, preserving everything else (attributes,
   * groupByAttribute, ...) so query state never gets dropped on the floor.
   */
  const updateFilterDataKey: (
    key: string,
    value: string | undefined,
  ) => void = (key: string, value: string | undefined): void => {
    const newFilterData: Record<string, unknown> = {
      ...(props.data.filterData as Record<string, unknown>),
    };
    if (value) {
      newFilterData[key] = value;
    } else {
      delete newFilterData[key];
    }
    props.onDataChanged({
      ...props.data,
      filterData: newFilterData as MetricQueryData["filterData"],
    });
  };

  const metricNameOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromArray(
      props.metricTypes.map((metricType: MetricType) => {
        return metricType.name || "";
      }),
    );

  const selectedMetricNameOption: DropdownOption | undefined =
    metricNameOptions.find((option: DropdownOption) => {
      return option.value === selectedMetricName;
    });

  const aggregationOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(MetricsAggregationType);

  const selectedAggregationType: string =
    props.data.filterData?.aggegationType?.toString() ||
    MetricsAggregationType.Avg;

  const selectedAggregationOption: DropdownOption | undefined =
    aggregationOptions.find((option: DropdownOption) => {
      return option.value === selectedAggregationType;
    });

  const groupByOptions: Array<DropdownOption> = (
    props.telemetryAttributes || []
  ).map((attr: string) => {
    return { value: attr, label: attr };
  });

  const selectedGroupByKeys: Array<string> =
    props.data.groupByAttributeKeys || [];

  const selectedGroupByOptions: Array<DropdownOption> = groupByOptions.filter(
    (option: DropdownOption) => {
      return selectedGroupByKeys.includes(String(option.value));
    },
  );

  const activeFilterCount: number = Object.keys(
    ((props.data.filterData as Record<string, unknown> | undefined)?.[
      "attributes"
    ] as Record<string, unknown> | undefined) || {},
  ).length;

  return (
    <Fragment>
      {/*
       * Inline query builder: metric picker + aggregation on one row,
       * replacing the old label-column FiltersForm rows.
       */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Metric
          </label>
          <Dropdown
            options={metricNameOptions}
            value={selectedMetricNameOption}
            placeholder="Search and select a metric..."
            ariaLabel="Metric name"
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              updateFilterDataKey(
                "metricName",
                value ? value.toString() : undefined,
              );
            }}
          />
        </div>
        <div className="w-full sm:w-44">
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Aggregate by
          </label>
          <Dropdown
            options={aggregationOptions}
            value={selectedAggregationOption}
            placeholder="Aggregation"
            ariaLabel="Aggregation type"
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              /*
               * A cleared aggregation falls back to Avg — every query
               * needs one, and Avg is the creation-site default.
               */
              updateFilterDataKey(
                "aggegationType",
                value ? value.toString() : MetricsAggregationType.Avg,
              );
            }}
          />
        </div>
      </div>

      {showRateHint ? (
        <div className="mt-3">
          <HintChip variant="amber" icon={IconProp.Bolt}>
            <button
              type="button"
              className="rounded font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              title="Plot this metric as a per-second rate of change"
              onClick={(): void => {
                props.onEnableRateTransform?.();
              }}
            >
              {rateHintCopy}
            </button>
            <button
              type="button"
              aria-label="Dismiss rate hint"
              className="inline-flex h-4 w-4 items-center justify-center rounded text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              title="Dismiss"
              onClick={(): void => {
                setRateHintDismissedForMetric(selectedMetricName);
              }}
            >
              <Icon icon={IconProp.Close} className="h-2.5 w-2.5" />
            </button>
          </HintChip>
        </div>
      ) : null}

      {/* Filters & grouping toggle */}
      <div className="mt-3">
        <button
          type="button"
          aria-expanded={showAdvancedFilters}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          onClick={toggleAdvancedFilters}
        >
          <Icon
            icon={
              showAdvancedFilters ? IconProp.ChevronUp : IconProp.ChevronDown
            }
            className="h-3 w-3"
          />
          <span>Filters &amp; grouping</span>
          {!showAdvancedFilters &&
          (activeFilterCount > 0 || selectedGroupByKeys.length > 0) ? (
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400" />
          ) : null}
        </button>
      </div>

      {showAdvancedFilters ? (
        <div className="mt-2 space-y-4 border-l-2 border-gray-100 pl-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Filter by attributes
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Only chart series whose attributes match these conditions.
            </p>
            {props.attributesError ? (
              <div className="py-2">
                <ErrorMessage
                  message={props.attributesError}
                  onRefreshClick={props.onAttributesRetry}
                />
              </div>
            ) : (
              <div className="mt-2">
                <JSONFilter<MetricsQuery>
                  filter={{
                    key: "attributes",
                    type: FieldType.JSON,
                    title: "Attribute Filter",
                  }}
                  filterData={props.data.filterData}
                  onFilterChanged={(
                    filterData: MetricQueryData["filterData"],
                  ) => {
                    props.onDataChanged({
                      ...props.data,
                      filterData,
                    });
                  }}
                  jsonKeys={props.telemetryAttributes}
                  jsonValueSuggestions={
                    props.telemetryAttributeValueSuggestions
                  }
                  onJsonKeySelected={props.onAttributeKeySelected}
                  onJsonValueSearch={props.onAttributeValueSearch}
                  isLoadingJsonKeys={props.isAttributesLoading}
                  loadingJsonValueKeys={props.loadingAttributeValueKeys}
                  enableOperators={true}
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Group by
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Split this query into one series per unique value (e.g. one line
              per host). Leave empty to aggregate everything into a single
              series.
            </p>
            <div className="mt-2">
              <Dropdown
                options={groupByOptions}
                isMultiSelect={true}
                value={selectedGroupByOptions}
                placeholder="Select attributes to group by"
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ): void => {
                  const keys: Array<string> = Array.isArray(value)
                    ? value.map((v: DropdownValue) => {
                        return String(v);
                      })
                    : value
                      ? [String(value)]
                      : [];

                  props.onDataChanged({
                    ...props.data,
                    groupByAttributeKeys: keys.length > 0 ? keys : undefined,
                  });
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </Fragment>
  );
};

export default MetricFilter;
