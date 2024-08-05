import LogSeverity from "Common/Types/Log/LogSeverity";
import MonitorStepLogMonitor from "Common/Types/Monitor/MonitorStepLogMonitor";
import FiltersForm from "CommonUI/src/Components/Filters/FiltersForm";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Query from "CommonUI/src/Utils/BaseDatabase/Query";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorStepLogMonitor: MonitorStepLogMonitor;
  onMonitorStepLogMonitorChanged: (
    monitorStepLogMonitor: MonitorStepLogMonitor,
  ) => void;
  attributeKeys: Array<string>;
  telemetryServices: Array<TelemetryService>;
}

const LogMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <FiltersForm<MonitorStepLogMonitor>
      id="logs-filter"
      showFilter={true}
      filterData={props.monitorStepLogMonitor}
      onFilterChanged={(filterData: Query<MonitorStepLogMonitor>) => {
        props.onMonitorStepLogMonitorChanged(
          filterData as MonitorStepLogMonitor,
        );
      }}
      filters={[
        {
          key: "body",
          type: FieldType.Text,
          title: "Search Log Body",
        },
        {
          key: "lastXSecondsOfLogs",
          type: FieldType.Dropdown,
          filterDropdownOptions: [
            {
              label: "Last 5 seconds",
              value: 5,
            },
            {
              label: "Last 10 seconds",
              value: 10,
            },
            {
              label: "Last 30 seconds",
              value: 30,
            },
            {
              label: "Last 1 minute",
              value: 60,
            },
            {
              label: "Last 5 minutes",
              value: 300,
            },
            {
              label: "Last 15 minutes",
              value: 900,
            },
            {
              label: "Last 30 minutes",
              value: 1800,
            },
            {
              label: "Last 1 hour",
              value: 3600,
            },
            {
              label: "Last 6 hours",
              value: 21600,
            },
            {
              label: "Last 12 hours",
              value: 43200,
            },
            {
              label: "Last 24 hours",
              value: 86400,
            },
          ],
          title: "Monitor Last X Time of Logs",
          isAdvancedFilter: true,
        },
        {
          key: "severityText",
          filterDropdownOptions:
            DropdownUtil.getDropdownOptionsFromEnum(LogSeverity),
          type: FieldType.MultiSelectDropdown,
          title: "Log Severity",
          isAdvancedFilter: true,
        },
        {
          key: "telemetryServiceId",
          type: FieldType.MultiSelectDropdown,
          filterDropdownOptions: props.telemetryServices.map(
            (telemetryService: TelemetryService) => {
              return {
                label: telemetryService.name!,
                value: telemetryService.id?.toString() || "",
              };
            },
          ),
          title: "Filter by Telemetry Service",
          isAdvancedFilter: true,
        },
        {
          key: "attributes",
          type: FieldType.JSON,
          title: "Filter by Attributes",
          jsonKeys: props.attributeKeys,
          isAdvancedFilter: true,
        },
      ]}
    />
  );
};

export default LogMonitorStepForm;
