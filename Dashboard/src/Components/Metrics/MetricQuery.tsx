import FiltersForm from "CommonUI/src/Components/Filters/FiltersForm";
import FilterData from "CommonUI/src/Components/Filters/Types/FilterData";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Metric from "Model/AnalyticsModels/Metric";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import MetricQuery from "Common/Types/Metrics/MetricsQuery";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";

export interface MetricQueryData {
  filterData: FilterData<MetricQuery>;
}

export interface ComponentProps {
  data: MetricQueryData;
  onDataChanged: (filterData: MetricQueryData) => void;
}

const MetricFilter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <div>
        <FiltersForm<MetricQuery>
          showFilter={true}
          id="metrics-filter"
          filterData={props.data.filterData}
          onFilterChanged={(filterData: FilterData<Metric>) => {
            props.onDataChanged({ filterData });
          }}
          filters={[
            {
              key: "metricName",
              title: "Metric Name",
              type: FieldType.Text,
            },
            {
              key: "attributes",
              type: FieldType.JSON,
              title: "Filter by Attributes",
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
