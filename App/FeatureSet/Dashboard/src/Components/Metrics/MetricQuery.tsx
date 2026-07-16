import FiltersForm from "Common/UI/Components/Filters/FiltersForm";
import FieldType from "Common/UI/Components/Types/FieldType";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
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
import Query from "Common/Types/BaseDatabase/Query";
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

  return (
    <Fragment>
      <div>
        <FiltersForm<MetricsQuery>
          showFilter={true}
          id="metrics-filter"
          filterData={props.data.filterData}
          onFilterChanged={(filterData: Query<MetricsQuery>) => {
            props.onDataChanged({
              ...props.data,
              filterData,
            });
          }}
          showAdvancedFilters={showAdvancedFilters}
          hideAdvancedFilterToggle={true}
          isFilterLoading={false}
          filterError={showAdvancedFilters ? props.attributesError : undefined}
          onFilterRefreshClick={
            showAdvancedFilters ? props.onAttributesRetry : undefined
          }
          filters={[
            {
              key: "metricName",
              title: "Metric Name",
              type: FieldType.Dropdown,
              filterDropdownOptions: DropdownUtil.getDropdownOptionsFromArray(
                props.metricTypes.map((metricType: MetricType) => {
                  return metricType.name || "";
                }),
              ),
            },
            {
              key: "aggegationType",
              type: FieldType.Dropdown,
              title: "Aggregation Type",
              filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
                MetricsAggregationType,
              ),
            },
            {
              key: "attributes",
              type: FieldType.JSON,
              title: "Filter by Attributes",
              jsonKeys: props.telemetryAttributes,
              jsonValueSuggestions: props.telemetryAttributeValueSuggestions,
              onJsonKeySelected: props.onAttributeKeySelected,
              onJsonValueSearch: props.onAttributeValueSearch,
              isLoadingJsonKeys: props.isAttributesLoading,
              loadingJsonValueKeys: props.loadingAttributeValueKeys,
              jsonEnableOperators: true,
              isAdvancedFilter: true,
            },
          ]}
        />
      </div>

      {showRateHint ? (
        <div className="mt-2">
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

      {showAdvancedFilters ? (
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700">
            Group By
          </label>
          <p className="mt-1 text-xs text-gray-500">
            Split this query into one series per unique value (e.g. one line per
            host). Leave empty to aggregate everything into a single series.
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
      ) : null}

      <div className="mt-3">
        <Button
          className="-ml-3"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          icon={showAdvancedFilters ? IconProp.ChevronUp : IconProp.ChevronDown}
          title="Filters & grouping"
          onClick={toggleAdvancedFilters}
        />
      </div>
    </Fragment>
  );
};

export default MetricFilter;
