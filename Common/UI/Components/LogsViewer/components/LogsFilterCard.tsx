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
    <div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <LogSearchBar
            value={props.searchQuery}
            onChange={props.onSearchQueryChange}
            onSubmit={props.onSearchSubmit}
            suggestions={searchBarSuggestions}
          />
        </div>
        <div className="flex-none pt-0.5">
          {props.toolbar}
        </div>
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
  );
};

export default LogsFilterCard;
