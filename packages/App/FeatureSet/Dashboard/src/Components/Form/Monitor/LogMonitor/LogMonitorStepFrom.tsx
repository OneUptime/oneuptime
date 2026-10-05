import MonitorStepLogMonitor from "Common/Types/Monitor/MonitorStepLogMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import React, { FunctionComponent, ReactElement } from "react";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import LogSeverity from "Common/Types/Log/LogSeverity";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import LogMonitorPreview from "../../../Monitor/LogMonitor/LogMonitorPreview";

/*
 * The filters that narrow a log monitor down further - telemetry service,
 * infrastructure entity and attributes - fold under the same More fields
 * section as the rarely needed fields of every other form, instead of the
 * Show / Hide Advanced Options link this form had of its own (which, taking
 * an empty filter for a set one, never started folded). Log Severity stays
 * on screen with the text and the time window: it is the filter most log
 * monitors use, and the security event monitor learnt that a hidden
 * severity reads as one that cannot be filtered on (issue #3398). Folded,
 * the section's header names its filters and shows each one a monitor uses
 * as a chip ("Filter by Telemetry Service: 1"), so editing a monitor never
 * hides a filter it has. Folded fields stay mounted: the preview below and
 * the saved step always get the whole filter set. Built once, so every
 * render hands its fields the same section.
 */
const MORE_LOG_FILTERS: FormFieldCollapsibleSection<MonitorStepLogMonitor> =
  getAdvancedFormSection<MonitorStepLogMonitor>();

export interface ComponentProps {
  monitorStepLogMonitor: MonitorStepLogMonitor;
  onMonitorStepLogMonitorChanged: (
    monitorStepLogMonitor: MonitorStepLogMonitor,
  ) => void;
  attributeKeys: Array<string>;
  telemetryServices: Array<Service>;
  telemetryEntities?: Array<InventoryItem> | undefined;
  isLoadingAttributeKeys?: boolean | undefined;
  attributeValueSuggestions?: Record<string, Array<string>> | undefined;
  loadingAttributeValueKeys?: Array<string> | undefined;
  onAttributeKeySelected?: ((key: string) => void) | undefined;
}

const LogMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [monitorStepLogMonitor, setMonitorStepLogMonitor] =
    React.useState<MonitorStepLogMonitor>(props.monitorStepLogMonitor);

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
            collapsibleSection: MORE_LOG_FILTERS,
          },
          {
            field: {
              entityKeys: true,
            },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: (props.telemetryEntities || []).map(
              (telemetryEntity: InventoryItem) => {
                return {
                  label: `${
                    telemetryEntity.displayName ||
                    telemetryEntity.entityKey ||
                    ""
                  } (${telemetryEntity.entityType || ""})`,
                  value: telemetryEntity.entityKey || "",
                };
              },
            ),
            title: "Filter by Infrastructure Entity",
            description: "Scope to specific infrastructure entities (optional)",
            hideOptionalLabel: true,
            collapsibleSection: MORE_LOG_FILTERS,
          },
          {
            field: {
              attributes: true,
            },
            fieldType: FormFieldSchemaType.Dictionary,
            title: "Filter by Attributes",
            jsonKeysForDictionary: props.attributeKeys,
            isLoadingDictionaryKeys: props.isLoadingAttributeKeys,
            dictionaryValueSuggestions: props.attributeValueSuggestions,
            loadingDictionaryValueKeys: props.loadingAttributeValueKeys,
            onDictionaryKeySelected: props.onAttributeKeySelected,
            dictionaryEnableOperators: true,
            description:
              "You can filter the logs based on the attributes that are attached to the logs.",
            hideOptionalLabel: true,
            collapsibleSection: MORE_LOG_FILTERS,
          },
        ]}
      />
      <div>
        <HorizontalRule />
        <FieldLabelElement
          title={"Logs Preview"}
          description={
            "The logs these filters match, so you can check the filters before you save."
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
