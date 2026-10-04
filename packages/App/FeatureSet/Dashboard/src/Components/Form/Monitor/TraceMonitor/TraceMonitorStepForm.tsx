import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepTraceMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import React, { FunctionComponent, ReactElement } from "react";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import TraceMonitorPreview from "../../../Monitor/TraceMonitor/TraceMonitorPreview";
import SpanUtil from "../../../../Utils/SpanUtil";

/*
 * The filters that narrow a trace monitor down further - telemetry service,
 * infrastructure entity and attributes - fold under the same More fields
 * section as the rarely needed fields of every other form, instead of the
 * Show / Hide Advanced Options link this form had of its own (which, taking
 * an empty filter for a set one, never started folded). Span status stays
 * on screen with the name and the time window: filtering on ERROR is how a
 * trace monitor alerts on failures, and the security event monitor learnt
 * that a hidden filter like it reads as one that cannot be used (issue
 * #3398). Folded, the section's header names its filters and shows each one
 * a monitor uses as a chip ("Filter by Telemetry Service: 1"), so editing a
 * monitor never hides a filter it has. Folded fields stay mounted: the
 * preview below and the saved step always get the whole filter set. Built
 * once, so every render hands its fields the same section.
 */
const MORE_TRACE_FILTERS: FormFieldCollapsibleSection<MonitorStepTraceMonitor> =
  getAdvancedFormSection<MonitorStepTraceMonitor>();

export interface ComponentProps {
  monitorStepTraceMonitor?: MonitorStepTraceMonitor | undefined;
  onMonitorStepTraceMonitorChanged: (
    monitorStepTraceMonitor: MonitorStepTraceMonitor,
  ) => void;
  attributeKeys: Array<string>;
  telemetryServices: Array<Service>;
  telemetryEntities?: Array<InventoryItem> | undefined;
  isLoadingAttributeKeys?: boolean | undefined;
  attributeValueSuggestions?: Record<string, Array<string>> | undefined;
  loadingAttributeValueKeys?: Array<string> | undefined;
  onAttributeKeySelected?: ((key: string) => void) | undefined;
}

const TraceMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const monitorStepTraceMonitor: MonitorStepTraceMonitor =
    props.monitorStepTraceMonitor || MonitorStepTraceMonitorUtil.getDefault();

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
            collapsibleSection: MORE_TRACE_FILTERS,
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
            collapsibleSection: MORE_TRACE_FILTERS,
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
              "You can filter the Traces based on the attributes that are attached to the Traces.",
            hideOptionalLabel: true,
            collapsibleSection: MORE_TRACE_FILTERS,
          },
        ]}
      />
      <div>
        <HorizontalRule />
        <FieldLabelElement
          title={"Spans Preview"}
          description={
            "The spans these filters match, so you can check the filters before you save."
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
