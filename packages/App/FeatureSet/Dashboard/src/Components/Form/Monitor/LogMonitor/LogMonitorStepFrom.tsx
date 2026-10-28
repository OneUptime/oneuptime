import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import React, { FunctionComponent, ReactElement } from "react";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import LogSeverity from "Common/Types/Log/LogSeverity";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FOLDED_SECTION_LINE } from "Common/UI/Components/FoldedSection/FoldedSectionVariant";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import LogMonitorPreview from "../../../Monitor/LogMonitor/LogMonitorPreview";
import LogGroupByAttributesInput from "./LogGroupByAttributesInput";

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

// The fold under the filters that lists the logs they match.
export const MATCHING_LOGS_TITLE: string = translationKey("Matching logs");

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

  /*
   * The logs these filters match, folded: the rule's preview below counts
   * them, and the list is there for whoever wants to read them. Drawn only
   * once opened, so the form reads no logs until it is.
   */
  const [isMatchingLogsCollapsed, setIsMatchingLogsCollapsed] =
    React.useState<boolean>(true);

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
          /*
           * The time window is the rule's ("When to alert": "more than 10
           * in 5 minutes"), so it is set there, beside the number it goes
           * with.
           */
          {
            field: {
              severityTexts: true,
            },
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(LogSeverity),
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            title: "Log Severity",
            description:
              "Only logs of these severities. Empty: every severity.",
            hideOptionalLabel: true,
          },
          {
            field: {
              body: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Message contains",
            description:
              "Only logs whose message contains this text, in any case. Empty: every message.",
            placeholder: "payment declined",
            hideOptionalLabel: true,
          },
          /*
           * Not a filter, so not folded with them: it changes what the
           * monitor alerts on - one alert per group (per IPsec tunnel, per
           * user) instead of one for the whole monitor.
           */
          {
            field: {
              groupByAttributes: true,
            },
            fieldType: FormFieldSchemaType.CustomComponent,
            title: "Group by Attributes",
            description:
              "Open a separate alert or incident per combination of these values, such as one per IPsec tunnel. Leave empty to count every matching log together.",
            hideOptionalLabel: true,
            getCustomElement: (
              values: FormValues<MonitorStepLogMonitor>,
              customElementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <LogGroupByAttributesInput
                  initialValue={
                    values.groupByAttributes as Array<string> | undefined
                  }
                  suggestions={props.attributeKeys}
                  isLoadingSuggestions={props.isLoadingAttributeKeys}
                  ariaLabelledby={customElementProps.ariaLabelledby}
                  onChange={(groupByAttributes: Array<string>) => {
                    customElementProps.onChange?.(groupByAttributes);
                  }}
                />
              );
            },
          },
          /*
           * Only there once the monitor is grouped: it says how a GROUP
           * is resolved, and a monitor with no groups has nothing for it
           * to act on. What was entered is kept while Group By is empty.
           */
          {
            field: {
              resolvedByAttributes: true,
            },
            fieldType: FormFieldSchemaType.Dictionary,
            title: "Resolved by Attributes",
            description:
              "Keep a group's alert or incident open until a log with these attributes arrives. Leave empty to resolve a group when its logs stop.",
            jsonKeysForDictionary: props.attributeKeys,
            isLoadingDictionaryKeys: props.isLoadingAttributeKeys,
            dictionaryValueSuggestions: props.attributeValueSuggestions,
            loadingDictionaryValueKeys: props.loadingAttributeValueKeys,
            onDictionaryKeySelected: props.onAttributeKeySelected,
            hideOptionalLabel: true,
            showIf: (values: FormValues<MonitorStepLogMonitor>): boolean => {
              return (
                MonitorStepLogMonitorUtil.getGroupByAttributes({
                  groupByAttributes: values.groupByAttributes as
                    | Array<string>
                    | undefined,
                }).length > 0
              );
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
      <FoldedSection
        title={MATCHING_LOGS_TITLE}
        description="The logs these filters match now, to check them before you save."
        variant={FOLDED_SECTION_LINE}
        className="mt-4"
        isCollapsed={isMatchingLogsCollapsed}
        onToggle={(isCollapsed: boolean) => {
          setIsMatchingLogsCollapsed(isCollapsed);
        }}
        dataTestId="log-monitor-matching-logs"
      >
        {isMatchingLogsCollapsed ? (
          <></>
        ) : (
          <div className="mt-2">
            <LogMonitorPreview monitorStepLogMonitor={monitorStepLogMonitor} />
          </div>
        )}
      </FoldedSection>
    </div>
  );
};

export default LogMonitorStepForm;
