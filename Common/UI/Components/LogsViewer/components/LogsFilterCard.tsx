import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import Card from "../../Card/Card";
import FiltersForm from "../../Filters/FiltersForm";
import FieldType from "../../Types/FieldType";
import DropdownUtil from "../../../Utils/Dropdown";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import Query from "../../../../Types/BaseDatabase/Query";
import Log from "../../../../Models/AnalyticsModels/Log";

export interface LogsFilterCardProps {
  filterData: Query<Log>;
  onFilterChanged: (filterData: Query<Log>) => void;
  onAdvancedFiltersToggle: (show: boolean) => void;
  isFilterLoading: boolean;
  filterError?: string | undefined;
  onFilterRefreshClick?: (() => void) | undefined;
  logAttributes: Array<string>;
  toolbar: ReactNode;
}

const LogsFilterCard: FunctionComponent<LogsFilterCardProps> = (
  props: LogsFilterCardProps,
): ReactElement => {
  return (
    <Card>
      <div className="-mt-8">
        <FiltersForm<Log>
          id="logs-filter"
          showFilter={true}
          filterData={props.filterData}
          onFilterChanged={props.onFilterChanged}
          onAdvancedFiltersToggle={props.onAdvancedFiltersToggle}
          isFilterLoading={props.isFilterLoading}
          filterError={props.filterError}
          onFilterRefreshClick={props.onFilterRefreshClick}
          filters={[
            {
              key: "body",
              type: FieldType.Text,
              title: "Search Log",
            },
            {
              key: "severityText",
              filterDropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnum(LogSeverity),
              type: FieldType.Dropdown,
              title: "Log Severity",
              isAdvancedFilter: true,
            },
            {
              key: "time",
              type: FieldType.DateTime,
              title: "Start and End Date",
              isAdvancedFilter: true,
            },
            {
              key: "attributes",
              type: FieldType.JSON,
              title: "Filter by Attributes",
              jsonKeys: props.logAttributes,
              isAdvancedFilter: true,
            },
          ]}
        />
      </div>

      <div className="-mx-6 -mb-6 border-t border-slate-200 bg-white/60 px-6 py-3 backdrop-blur">
        {props.toolbar}
      </div>
    </Card>
  );
};

export default LogsFilterCard;
