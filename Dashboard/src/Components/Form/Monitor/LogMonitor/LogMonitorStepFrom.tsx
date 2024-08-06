import MonitorStepLogMonitor from "Common/Types/Monitor/MonitorStepLogMonitor";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import React, { FunctionComponent, ReactElement } from "react";
import BasicForm from "CommonUI/src/Components/Forms/BasicForm";
import LogSeverity from "Common/Types/Log/LogSeverity";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import Button, { ButtonStyleType } from "CommonUI/src/Components/Button/Button";

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
  const [showAdvancedOptions, setShowAdvancedOptions] = React.useState(false);

  return (
    <div>
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
            fieldType: FormFieldSchemaType.Text,
            title: "Monitor Logs that include this text",
            hideOptionalLabel: true,
          },
          {
            field: {
              lastXSecondsOfLogs: true,
            },
            defaultValue: 60,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: [
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
            title: "Monitor Logs for (time)",
            description:
              "Select the time interval for which you want to monitor logs.",
            hideOptionalLabel: true,
          },
          {
            field: {
              severityTexts: true,
            },
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(LogSeverity),
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            title: "Log Severity",
            hideOptionalLabel: true,
            showIf: () => {
              return showAdvancedOptions;
            },
          },
          {
            field: {
              telemetryServiceIds: true,
            },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: props.telemetryServices.map(
              (telemetryService: TelemetryService) => {
                return {
                  label: telemetryService.name!,
                  value: telemetryService.id?.toString() || "",
                };
              },
            ),
            title: "Filter by Telemetry Service",
            hideOptionalLabel: true,
            showIf: () => {
              return showAdvancedOptions;
            },
          },
          {
            field: {
              attributes: true,
            },
            fieldType: FormFieldSchemaType.Dictionary,
            title: "Filter by Attributes",
            jsonKeysForDictionary: props.attributeKeys,
            hideOptionalLabel: true,
            showIf: () => {
              return showAdvancedOptions;
            },
          },
        ]}
      />

      <Button
        className="-ml-3 -mt-10"
        buttonStyle={ButtonStyleType.SECONDARY_LINK}
        title={
          showAdvancedOptions
            ? "Hide Advanced Options"
            : "Show Advanced Options"
        }
        onClick={() => {
          return setShowAdvancedOptions(!showAdvancedOptions);
        }}
      />
    </div>
  );
};

export default LogMonitorStepForm;
