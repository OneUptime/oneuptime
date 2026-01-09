import MonitorStepLogMonitor from "Common/Types/Monitor/MonitorStepLogMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import React, { FunctionComponent, ReactElement } from "react";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import LogSeverity from "Common/Types/Log/LogSeverity";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import LogMonitorPreview from "../../../Monitor/LogMonitor/LogMonitorPreview";

export interface ComponentProps {
  monitorStepLogMonitor: MonitorStepLogMonitor;
  onMonitorStepLogMonitorChanged: (
    monitorStepLogMonitor: MonitorStepLogMonitor,
  ) => void;
  attributeKeys: Array<string>;
  telemetryServices: Array<Service>;
}

const LogMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [monitorStepLogMonitor, setMonitorStepLogMonitor] =
    React.useState<MonitorStepLogMonitor>(props.monitorStepLogMonitor);

  let showAdvancedOptionsByDefault: boolean = false;

  if (
    monitorStepLogMonitor.attributes ||
    monitorStepLogMonitor.severityTexts ||
    monitorStepLogMonitor.telemetryServiceIds
  ) {
    showAdvancedOptionsByDefault = true;
  }

  const [showAdvancedOptions, setShowAdvancedOptions] = React.useState(
    showAdvancedOptionsByDefault,
  );

  return (
    <div>
      <BasicForm
        id="logs-filter"
        hideSubmitButton={true}
        initialValues={monitorStepLogMonitor}
        onChange={(values: MonitorStepLogMonitor) => {
          setMonitorStepLogMonitor(values);
          props.onMonitorStepLogMonitorChanged(values);
        }}
        fields={[
          {
            field: {
              body: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Monitor Logs that include this text",
            description:
              "This monitor will filter all the logs that include this text.",
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
              "We will fetch all the logs that were generated in the last X time.",
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
            description: "Select the severity of the logs you want to monitor.",
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
              (telemetryService: Service) => {
                return {
                  label: telemetryService.name!,
                  value: telemetryService.id?.toString() || "",
                };
              },
            ),
            title: "Filter by Telemetry Service",
            description: "Select the telemetry services you want to monitor.",
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
            description:
              "You can filter the logs based on the attributes that are attached to the logs.",
            hideOptionalLabel: true,
            showIf: () => {
              return showAdvancedOptions;
            },
          },
        ]}
      />
      <div className="-ml-3">
        <Button
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
      <div>
        <HorizontalRule />
        <FieldLabelElement
          title={"Logs Preview"}
          description={
            "Here is the preview of the logs that will be monitored based on the filters you have set above."
          }
          hideOptionalLabel={true}
          isHeading={true}
        />
        <div className="mt-5 mb-5">
          <LogMonitorPreview monitorStepLogMonitor={monitorStepLogMonitor} />
        </div>
      </div>
    </div>
  );
};

export default LogMonitorStepForm;
