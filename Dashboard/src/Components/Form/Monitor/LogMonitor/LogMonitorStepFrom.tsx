import MonitorStepLogMonitor from "Common/Types/Monitor/MonitorStepLogMonitor";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import React, { FunctionComponent, ReactElement } from "react";
import BasicForm from "CommonUI/src/Components/Forms/BasicForm";
import LogSeverity from "Common/Types/Log/LogSeverity";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";

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
    <BasicForm
      id="logs-filter"
      hideSubmitButton={true}
      initialValue={props.monitorStepLogMonitor}
      onChange={props.onMonitorStepLogMonitorChanged}
      fields={[
        {
          field: {
            body: true,
          },
          type: FormFieldSchemaType.Text,
          title: "Search Log Body",
        },
        {
          field: {
            lastXSecondsOfLogs: true,
          },
          type: FormFieldSchemaType.Dropdown,
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
          title: "Monitor Logs for",
          isAdvancedFilter: true,
        },
        {
          field: {
            severityTexts: true,
          },
          filterDropdownOptions:
            DropdownUtil.getDropdownOptionsFromEnum(LogSeverity),
          type: FormFieldSchemaType.MultiSelectDropdown,
          title: "Log Severity",
          isAdvancedFilter: true,
        },
        {
          field: {
            telemetryServiceIds: true,
          },
          type: FormFieldSchemaType.MultiSelectDropdown,
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
          field: {
            attributes: true,
          },
          type: FormFieldSchemaType.JSON,
          title: "Filter by Attributes",
          jsonKeys: props.attributeKeys,
          isAdvancedFilter: true,
        },
      ]}
    />
  );
};

export default LogMonitorStepForm;
