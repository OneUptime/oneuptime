import FiltersForm from "Common/UI/Components/Filters/FiltersForm";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import Query from "Common/Types/BaseDatabase/Query";
import MetricsQuery from "Common/Types/Metrics/MetricsQuery";
import MetricNameAndUnit from "./Types/MetricNameAndUnit";
import GroupBy from "Common/UI/Utils/BaseDatabase/GroupBy";
import Metric from "Common/Models/AnalyticsModels/Metric";

export interface MetricQueryData {
  filterData: FilterData<MetricsQuery>;
  groupBy?: GroupBy<Metric> | undefined; 
}

export interface ComponentProps {
  data: MetricQueryData;
  onDataChanged: (filterData: MetricQueryData) => void;
  metricNameAndUnits: Array<MetricNameAndUnit>;
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
              ...props.data,
              filterData,
            });
          }}
          filters={[
            {
              key: "metricName",
              title: "Metric Name",
              type: FieldType.Dropdown,
              filterDropdownOptions: DropdownUtil.getDropdownOptionsFromArray(
                props.metricNameAndUnits.map(
                  (metricNameAndUnits: MetricNameAndUnit) => {
                    return metricNameAndUnits.metricName;
                  },
                ), // metricNameAndUnit is an array of MetricNameAndUnit
              ),
            },
            {
              key: "attributes",
              type: FieldType.JSON,
              title: "Filter by Attributes",
              jsonKeys: props.telemetryAttributes,
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
