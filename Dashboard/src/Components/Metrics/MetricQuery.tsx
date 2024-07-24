import FiltersForm from "CommonUI/src/Components/Filters/FiltersForm";
import FilterData from "CommonUI/src/Components/Filters/Types/FilterData";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import Query from "CommonUI/src/Utils/BaseDatabase/Query";
import MetricsQuery from "Common/Types/Metrics/MetricsQuery";

export interface MetricQueryData {
  filterData: FilterData<MetricsQuery>;
}

export interface ComponentProps {
  data: MetricQueryData;
  onDataChanged: (filterData: MetricQueryData) => void;
  metricNames: string[];
  telemetryAttributes: string[];
}

const MetricFilter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <div>
        <FiltersForm<MetricsQuery>
          showFilter={true}
          id="metrics-filter"
          filterData={props.data.filterData}
          onFilterChanged={(filterData: Query<MetricsQuery>) => {
            props.onDataChanged({
              filterData,
            });
          }}
          filters={[
            {
              key: "metricName",
              title: "Metric Name",
              type: FieldType.Dropdown,
              filterDropdownOptions: DropdownUtil.getDropdownOptionsFromArray(
                props.metricNames,
              ),
            },
            {
              key: "attributes",
              type: FieldType.JSON,
              title: "Filter by Attributes",
              jsonKeys: props.telemetryAttributes,
            },
            {
              key: "aggregateBy",
              type: FieldType.Dropdown,
              title: "Aggregate By",
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
