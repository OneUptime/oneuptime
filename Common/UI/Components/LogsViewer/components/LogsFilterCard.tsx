import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import FiltersForm from "../../Filters/FiltersForm";
import FieldType from "../../Types/FieldType";
import DropdownUtil from "../../../Utils/Dropdown";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import Query from "../../../../Types/BaseDatabase/Query";
import Log from "../../../../Models/AnalyticsModels/Log";
import LogSearchBar from "./LogSearchBar";

export interface LogsFilterCardProps {
  filterData: Query<Log>;
  onFilterChanged: (filterData: Query<Log>) => void;
  onAdvancedFiltersToggle: (show: boolean) => void;
  isFilterLoading: boolean;
  filterError?: string | undefined;
  onFilterRefreshClick?: (() => void) | undefined;
  logAttributes: Array<string>;
  toolbar: ReactNode;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSearchSubmit: () => void;
}

const LogsFilterCard: FunctionComponent<LogsFilterCardProps> = (
  props: LogsFilterCardProps,
): ReactElement => {
  const searchBarSuggestions: Array<string> = [
    "severity",
    "service",
    "trace",
    "span",
    ...props.logAttributes.map((attr: string) => `@${attr}`),
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="p-4">
        <div className="mb-3">
          <LogSearchBar
            value={props.searchQuery}
            onChange={props.onSearchQueryChange}
            onSubmit={props.onSearchSubmit}
            suggestions={searchBarSuggestions}
          />
        </div>

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

      <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-2.5">
        {props.toolbar}
      </div>
    </div>
  );
};

export default LogsFilterCard;
