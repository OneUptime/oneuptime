import FiltersForm from "Common/UI/Components/Filters/FiltersForm";
import FieldType from "Common/UI/Components/Types/FieldType";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import Query from "Common/Types/BaseDatabase/Query";
import MetricsQuery from "Common/Types/Metrics/MetricsQuery";
import MetricQueryData from "Common/Types/Metrics/MetricQueryData";
import MetricType from "Common/Models/DatabaseModels/MetricType";

export interface ComponentProps {
  data: MetricQueryData;
  onDataChanged: (filterData: MetricQueryData) => void;
  metricTypes: Array<MetricType>;
  telemetryAttributes: string[];
  telemetryAttributeValueSuggestions?:
    | Record<string, Array<string>>
    | undefined;
  onAttributeKeySelected?: ((key: string) => void) | undefined;
  onAdvancedFiltersToggle?:
    | undefined
    | ((showAdvancedFilters: boolean) => void);
  isAttributesLoading?: boolean | undefined;
  attributesError?: string | undefined;
  onAttributesRetry?: (() => void) | undefined;
}

const MetricFilter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(true);

  const initializedAdvancedFilters: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);

  React.useEffect(() => {
    if (initializedAdvancedFilters.current) {
      return;
    }

    initializedAdvancedFilters.current = true;
    props.onAdvancedFiltersToggle?.(true);
  }, [props.onAdvancedFiltersToggle]);

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
          onAdvancedFiltersToggle={(show: boolean) => {
            setShowAdvancedFilters(show);
            props.onAdvancedFiltersToggle?.(show);
          }}
          showAdvancedFiltersByDefault={true}
          isFilterLoading={
            showAdvancedFilters ? props.isAttributesLoading : false
          }
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
                }), // metricType is an array of MetricType
              ),
            },
            {
              key: "attributes",
              type: FieldType.JSON,
              title: "Filter by Attributes",
              jsonKeys: props.telemetryAttributes,
              jsonValueSuggestions: props.telemetryAttributeValueSuggestions,
              onJsonKeySelected: props.onAttributeKeySelected,
              isAdvancedFilter: true,
            },
            {
              key: "aggegationType",
              type: FieldType.Dropdown,
              title: "Aggregation Type",
              filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
                MetricsAggregationType,
              ),
            },
          ]}
        />
      </div>
      <div className="mt-4">
        <label className="block text-sm font-medium text-gray-700">
          Group By
        </label>
        <p className="mt-1 text-xs text-gray-500">
          Select one or more attributes to group by (e.g. host.name). When this
          metric is used in a monitor, the monitor fires one incident per unique
          group (e.g. one incident per host). Leave empty for whole-monitor
          evaluation.
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
    </Fragment>
  );
};

export default MetricFilter;
