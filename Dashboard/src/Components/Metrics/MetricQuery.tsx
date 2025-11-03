import FiltersForm from "Common/UI/Components/Filters/FiltersForm";
import FieldType from "Common/UI/Components/Types/FieldType";
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
  const [showAdvancedFilters, setShowAdvancedFilters] =
    useState<boolean>(true);

  const initializedAdvancedFilters = React.useRef<boolean>(false);

  React.useEffect(() => {
    if (initializedAdvancedFilters.current) {
      return;
    }

    initializedAdvancedFilters.current = true;
    props.onAdvancedFiltersToggle?.(true);
  }, [props.onAdvancedFiltersToggle]);

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
    </Fragment>
  );
};

export default MetricFilter;
