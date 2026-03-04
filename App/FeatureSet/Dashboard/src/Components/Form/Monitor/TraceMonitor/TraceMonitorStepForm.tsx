import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepTraceMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import React, { FunctionComponent, ReactElement } from "react";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import TraceMonitorPreview from "../../../Monitor/TraceMonitor/TraceMonitorPreview";
import SpanUtil from "../../../../Utils/SpanUtil";

export interface ComponentProps {
  monitorStepTraceMonitor?: MonitorStepTraceMonitor | undefined;
  onMonitorStepTraceMonitorChanged: (
    monitorStepTraceMonitor: MonitorStepTraceMonitor,
  ) => void;
  attributeKeys: Array<string>;
  telemetryServices: Array<Service>;
}

const TraceMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let showAdvancedOptionsByDefault: boolean = false;
  const monitorStepTraceMonitor: MonitorStepTraceMonitor =
    props.monitorStepTraceMonitor || MonitorStepTraceMonitorUtil.getDefault();

  if (
    monitorStepTraceMonitor &&
    (monitorStepTraceMonitor.attributes ||
      monitorStepTraceMonitor.spanStatuses ||
      monitorStepTraceMonitor.telemetryServiceIds)
  ) {
    showAdvancedOptionsByDefault = true;
  }

  const [showAdvancedOptions, setShowAdvancedOptions] = React.useState(
    showAdvancedOptionsByDefault,
  );

  return (
    <div>
      <BasicForm
        id="Traces-filter"
        hideSubmitButton={true}
        initialValues={monitorStepTraceMonitor}
        onChange={(values: MonitorStepTraceMonitor) => {
          props.onMonitorStepTraceMonitorChanged(values);
        }}
        fields={[
          {
            field: {
              spanName: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Span Name",
            description:
              "This monitor will filter all the spans that include this name.",
            hideOptionalLabel: true,
          },
          {
            field: {
              lastXSecondsOfSpans: true,
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
            title: "Monitor Traces for (time)",
            description:
              "We will fetch all the Traces that were generated in the last X time.",
            hideOptionalLabel: true,
          },
          {
            field: {
              spanStatuses: true,
            },
            dropdownOptions: SpanUtil.getSpanStatusDropdownOptions(),
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            title: "Filter by Span Status",
            description: "Select the status of the spans you want to monitor.",
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
              "You can filter the Traces based on the attributes that are attached to the Traces.",
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
          title={"Spans Preview"}
          description={
            "Here is the preview of the Traces that will be monitored based on the filters you have set above."
          }
          hideOptionalLabel={true}
          isHeading={true}
        />
        <div className="mt-5 mb-5">
          <TraceMonitorPreview
            monitorStepTraceMonitor={monitorStepTraceMonitor!}
          />
        </div>
      </div>
    </div>
  );
};

export default TraceMonitorStepForm;
