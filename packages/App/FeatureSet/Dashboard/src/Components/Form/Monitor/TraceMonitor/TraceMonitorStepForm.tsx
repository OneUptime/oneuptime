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
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FOLDED_SECTION_LINE } from "Common/UI/Components/FoldedSection/FoldedSectionVariant";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
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

// The fold under the filters that lists the spans they match.
export const MATCHING_SPANS_TITLE: string = translationKey("Matching spans");

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

  // Folded, and drawn only once opened: the rule's preview counts them.
  const [isMatchingSpansCollapsed, setIsMatchingSpansCollapsed] =
    React.useState<boolean>(true);

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
          /*
           * The time window is the rule's ("When to alert"), set there
           * beside the number it goes with.
           */
          {
            field: {
              spanStatuses: true,
            },
            dropdownOptions: SpanUtil.getSpanStatusDropdownOptions(),
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            title: "Span Status",
            description:
              "Only spans with these statuses, such as Error for failed requests. Empty: every status.",
            hideOptionalLabel: true,
          },
          {
            field: {
              spanName: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Span name contains",
            description:
              "Only spans whose name contains this text, such as an operation or a route. Empty: every span.",
            placeholder: "POST /api/checkout",
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
      <FoldedSection
        title={MATCHING_SPANS_TITLE}
        description="The spans these filters match now, to check them before you save."
        variant={FOLDED_SECTION_LINE}
        className="mt-4"
        isCollapsed={isMatchingSpansCollapsed}
        onToggle={(isCollapsed: boolean) => {
          setIsMatchingSpansCollapsed(isCollapsed);
        }}
        dataTestId="trace-monitor-matching-spans"
      >
        {isMatchingSpansCollapsed ? (
          <></>
        ) : (
          <div className="mt-2">
            <TraceMonitorPreview
              monitorStepTraceMonitor={monitorStepTraceMonitor!}
            />
          </div>
        )}
      </FoldedSection>
    </div>
  );
};

export default TraceMonitorStepForm;
