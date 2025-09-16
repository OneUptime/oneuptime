import React, { FunctionComponent } from "react";
import Log from "Common/Models/AnalyticsModels/Log";
import Query from "Common/Types/BaseDatabase/Query";
import LogSeverity from "Common/Types/Log/LogSeverity";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import FiltersForm from "Common/UI/Components/Filters/FiltersForm";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Card from "Common/UI/Components/Card/Card";

export interface ToolbarProps {
  searchTerm: string;
  onSearchTermChange: (v: string) => void;
  timeRangePreset: string;
  onTimePresetChange: (preset: string) => void;
  severityFilter: Array<LogSeverity>;
  toggleSeverity: (s: LogSeverity) => void;
  wrapLines: boolean;
  onToggleWrap: (v: boolean) => void;
  showJSON: boolean;
  onToggleJSON: (v: boolean) => void;
  liveTail: boolean;
  onToggleLiveTail: (v: boolean) => void;
  autoScroll: boolean;
  onToggleAutoScroll: (v: boolean) => void;
  enableRealtime: boolean;
  onRefresh: () => void;
  showFilters: boolean;
  onApplyFilters: () => void;
  initialLoadingAttributes: boolean;
  attributeError: string;
  showAdvancedFilters: boolean;
  filterOptions: Query<Log>;
  setFilterOptions: (q: Query<Log>) => void;
  logAttributes: Array<string>;
}

const Toolbar: FunctionComponent<ToolbarProps> = (props: ToolbarProps) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center space-x-2 flex-wrap">
        <div className="flex items-center bg-white rounded-md border border-gray-200 px-2 shadow-sm">
          <input
            type="text"
            value={props.searchTerm}
            onChange={(e) => {
              return props.onSearchTermChange(e.target.value);
            }}
            placeholder="Search body / trace / span"
            className="px-2 py-1 text-sm focus:outline-none bg-transparent"
          />
          {props.searchTerm && (
            <Button
              title="Clear"
              buttonStyle={ButtonStyleType.LINK}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                return props.onSearchTermChange("");
              }}
            />
          )}
        </div>
        <div className="flex items-center space-x-1">
          {["5m", "15m", "1h", "6h", "24h"].map((preset) => {
            return (
              <button
                key={preset}
                className={`text-xs px-2 py-1 rounded border transition ${props.timeRangePreset === preset ? "bg-indigo-600 text-white border-indigo-600 shadow" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
                onClick={() => {
                  return props.onTimePresetChange(preset);
                }}
              >
                {preset}
              </button>
            );
          })}
        </div>
        <div className="flex items-center space-x-1">
          {Object.values(LogSeverity)
            .filter((v) => {
              return typeof v === "string";
            })
            .map((sev, i) => {
              return (
                <button
                  key={i}
                  className={`text-xs px-2 py-1 rounded border transition ${props.severityFilter.includes(sev as LogSeverity) ? "bg-indigo-600 text-white border-indigo-600 shadow" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
                  onClick={() => {
                    return props.toggleSeverity(sev as LogSeverity);
                  }}
                >
                  {sev}
                </button>
              );
            })}
        </div>
        <Toggle
          title="Wrap"
          value={props.wrapLines}
          onChange={(v) => {
            return props.onToggleWrap(v);
          }}
        />
        <Toggle
          title="JSON"
          value={props.showJSON}
          onChange={(v) => {
            return props.onToggleJSON(v);
          }}
        />
        {props.enableRealtime && (
          <div className="flex items-center space-x-1">
            <Toggle
              title="Live Tail"
              value={props.liveTail}
              onChange={(v) => {
                return props.onToggleLiveTail(v);
              }}
            />
            <span
              className={`text-xs px-2 py-1 rounded-full ${props.liveTail ? "bg-green-100 text-green-700 animate-pulse" : "bg-gray-200 text-gray-600"}`}
            >
              {props.liveTail ? "Streaming" : "Paused"}
            </span>
          </div>
        )}
        <Toggle
          title="Auto Scroll"
          value={props.autoScroll}
          onChange={(v) => {
            return props.onToggleAutoScroll(v);
          }}
        />
        <Button
          title="Refresh"
          icon={IconProp.Refresh}
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={() => {
            return props.onRefresh();
          }}
        />
        {props.showFilters && (
          <Button
            title="Apply Filters"
            icon={IconProp.Search}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.PRIMARY}
            onClick={() => {
              return props.onApplyFilters();
            }}
          />
        )}
      </div>
      {props.showAdvancedFilters && (
        <Card className="p-3">
          <FiltersForm<Log>
            id="advanced-log-filters"
            showFilter={true}
            filterData={props.filterOptions}
            onFilterChanged={(f: Query<Log>) => {
              return props.setFilterOptions(f);
            }}
            filters={[
              { key: "body", type: FieldType.Text, title: "Search Log" },
              {
                key: "severityText",
                filterDropdownOptions:
                  DropdownUtil.getDropdownOptionsFromEnum(LogSeverity),
                type: FieldType.Dropdown,
                title: "Severity",
                isAdvancedFilter: true,
              },
              {
                key: "time",
                type: FieldType.DateTime,
                title: "Start / End",
                isAdvancedFilter: true,
              },
              {
                key: "attributes",
                type: FieldType.JSON,
                title: "Attributes",
                jsonKeys: props.logAttributes,
                isAdvancedFilter: true,
              },
            ]}
          />
          {props.initialLoadingAttributes ? (
            <div className="text-sm text-gray-400">
              Loading attribute keys...
            </div>
          ) : (
            <></>
          )}
          {!props.initialLoadingAttributes && props.attributeError ? (
            <div className="text-xs text-rose-500">
              Failed to load attribute keys: {props.attributeError}
            </div>
          ) : (
            <></>
          )}
        </Card>
      )}
    </div>
  );
};

export default Toolbar;
