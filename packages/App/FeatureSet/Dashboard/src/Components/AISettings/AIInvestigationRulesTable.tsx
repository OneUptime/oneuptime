import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AIInvestigationRule from "Common/Models/DatabaseModels/AIInvestigationRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AIInvestigationRuleTriggerEntity from "Common/Types/AI/AIInvestigationRuleTriggerEntity";
import { Green, Red } from "Common/Types/BrandColors";
import React, { FunctionComponent, ReactElement } from "react";
import {
  AI_LANE_ADVANCED_CARD_TITLES,
  AI_LANE_INVESTIGATION_RULES_TABLE_ID,
  AI_LANE_RULE_CRITERIA_SUBJECTS,
  AI_LANE_RULES_COPY,
  AiLane,
  AiLaneAdvancedCard,
} from "./ProjectAiSettingsCopy";
import { reportEnabledAiLaneRuleCount } from "./AiLaneRuleCount";
import {
  INVESTIGATION_RULE_TIMING_COLUMN_TITLE,
  INVESTIGATION_RULE_TIMING_COPY,
  INVESTIGATION_RULE_TIMING_FIELD_KEY,
  INVESTIGATION_RULE_TIMING_FIELD_TITLE,
  INVESTIGATION_RULE_TIMINGS,
  INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION,
  INVESTIGATION_RULE_WAIT_FIELD_TITLE,
  InvestigationRuleTiming,
  describeInvestigationRuleTiming,
  getInvestigationRuleTiming,
  getValuesForInvestigationRuleTiming,
  isInvestigationRuleTiming,
  isWaitChosen,
  validateInvestigationRuleWait,
} from "./InvestigationRuleTiming";
import {
  RULE_ENABLED_DESCRIPTION,
  RULE_NAME_MAX_LENGTH,
} from "../../Utils/Form/ResourceRuleForm";

export interface ComponentProps {
  lane: AiLane;
  // How many enabled rules there are, after every read of the table.
  onRulesLoaded?: ((count: number) => void) | undefined;
}

export const AI_LANE_INVESTIGATION_RULE_TRIGGER: Record<
  AiLane,
  AIInvestigationRuleTriggerEntity
> = {
  [AiLane.Incident]: AIInvestigationRuleTriggerEntity.Incident,
  [AiLane.Alert]: AIInvestigationRuleTriggerEntity.Alert,
};

/*
 * What most rules leave alone, folded under More fields on the Investigate
 * step: the description. Built once, so the form folds it the same way each
 * time.
 */
const INVESTIGATION_RULE_MORE_FIELDS: FormFieldCollapsibleSection<AIInvestigationRule> =
  getAdvancedFormSection<AIInvestigationRule>();

// When to investigate: the two answers, each with its line.
export const getInvestigationRuleTimingChoices: (
  lane: AiLane,
) => Array<RadioButton> = (lane: AiLane): Array<RadioButton> => {
  return INVESTIGATION_RULE_TIMINGS.map(
    (timing: InvestigationRuleTiming): RadioButton => {
      return {
        value: timing,
        title: INVESTIGATION_RULE_TIMING_COPY[lane][timing].title,
        description: INVESTIGATION_RULE_TIMING_COPY[lane][timing].description,
      };
    },
  );
};

/*
 * Incidents (or Alerts) → Settings → AI → More settings → Investigation
 * rules: which new incidents OneUptime AI investigates on its own, while
 * "Investigate new incidents" is on, and when. With no rule, every one is,
 * right away; with rules, only those that match at least one.
 *
 * A rule asks what the project's other incident rules ask: what it matches
 * (Match: the same conditions as an auto remediation rule's, drawn as one
 * conditions builder that starts on "All incidents"), then what it does
 * (Investigate: right away, or only if the incident is still open after a
 * wait - issue #5074 - and the rule's name). The wait's words are in
 * InvestigationRuleTiming.
 */
const AIInvestigationRulesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isIncident: boolean = props.lane === AiLane.Incident;
  const triggerEntityType: AIInvestigationRuleTriggerEntity =
    AI_LANE_INVESTIGATION_RULE_TRIGGER[props.lane];

  return (
    <ModelTable<AIInvestigationRule>
      modelType={AIInvestigationRule}
      id={AI_LANE_INVESTIGATION_RULES_TABLE_ID[props.lane]}
      name="Settings > AI > Investigation Rules"
      userPreferencesKey={AI_LANE_INVESTIGATION_RULES_TABLE_ID[props.lane]}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      // "All incidents" or "Only incidents that match conditions".
      ruleCriteriaSubject={AI_LANE_RULE_CRITERIA_SUBJECTS[props.lane]}
      query={{ triggerEntityType: triggerEntityType }}
      onBeforeCreate={async (item: AIInvestigationRule) => {
        item.triggerEntityType = triggerEntityType;
        return item;
      }}
      onFetchSuccess={() => {
        void reportEnabledAiLaneRuleCount<AIInvestigationRule>({
          modelType: AIInvestigationRule,
          triggerEntityType: triggerEntityType,
          onRulesLoaded: props.onRulesLoaded,
        });
      }}
      cardProps={{
        title:
          AI_LANE_ADVANCED_CARD_TITLES[props.lane][
            AiLaneAdvancedCard.InvestigationRules
          ],
        description:
          AI_LANE_RULES_COPY[props.lane].investigationRulesDescription,
      }}
      noItemsMessage={
        isIncident
          ? "No rules. Every new incident is investigated."
          : "No rules. Every new alert is investigated."
      }
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{ isEnabled: true }}
      filters={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { onlyIfOpenAfterMinutes: true },
          title: INVESTIGATION_RULE_TIMING_COLUMN_TITLE,
          type: FieldType.Element,
          disableSort: true,
          getElement: (item: AIInvestigationRule): ReactElement => {
            return (
              <span data-testid="investigation-rule-timing">
                {describeInvestigationRuleTiming(item.onlyIfOpenAfterMinutes)}
              </span>
            );
          },
          getExportValue: (item: AIInvestigationRule): string => {
            return describeInvestigationRuleTiming(item.onlyIfOpenAfterMinutes);
          },
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: AIInvestigationRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={[
        { title: "Match", id: "match-criteria" },
        { title: "Investigate", id: "investigate" },
      ]}
      formFields={[
        // Match: drawn as one conditions builder, on "All incidents".
        {
          field: { monitors: true },
          title: "Monitors",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Monitor,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Monitors (optional)",
        },
        ...(isIncident
          ? [
              {
                field: { incidentSeverities: true },
                title: "Incident Severities",
                stepId: "match-criteria",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: IncidentSeverity,
                  labelField: "name",
                  valueField: "_id",
                  sort: {
                    order: SortOrder.Ascending,
                  },
                },
                required: false,
                placeholder: "Select Severities (optional)",
              },
            ]
          : [
              {
                field: { alertSeverities: true },
                title: "Alert Severities",
                stepId: "match-criteria",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: AlertSeverity,
                  labelField: "name",
                  valueField: "_id",
                  sort: {
                    order: SortOrder.Ascending,
                  },
                },
                required: false,
                placeholder: "Select Severities (optional)",
              },
            ]),
        {
          field: { labels: true },
          title: isIncident ? "Incident Labels" : "Alert Labels",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels (optional)",
        },
        {
          field: { monitorLabels: true },
          title: "Monitor Labels",
          description:
            "Only match incidents and alerts whose monitor has one of these labels.",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Monitor Labels (optional)",
        },
        {
          field: { titlePattern: true },
          title: isIncident ? "Incident Title" : "Alert Title",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "database|postgres|db-",
        },
        {
          field: { descriptionPattern: true },
          title: isIncident ? "Incident Description" : "Alert Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "timeout|connection refused",
        },
        /*
         * Investigate: right away (the default, and what every rule did
         * before rules could wait), or only if the incident is still open
         * after a wait (issue #5074). Form-only: it starts on the answer
         * the rule's wait makes, and a pick writes the wait - cleared for
         * right away, the minutes below otherwise.
         */
        {
          overrideField: {
            onlyIfOpenAfterMinutes: true,
          },
          overrideFieldKey: INVESTIGATION_RULE_TIMING_FIELD_KEY,
          formOnly: true,
          title: INVESTIGATION_RULE_TIMING_FIELD_TITLE,
          stepId: "investigate",
          fieldType: FormFieldSchemaType.RadioButton,
          radioButtonOptions: getInvestigationRuleTimingChoices(props.lane),
          required: true,
          // Each answer says what it does; the column's sentence is half of it.
          hideColumnDescription: true,
          dataTestId: "investigation-rule-timing-choice",
          getDefaultValue: (
            values: FormValues<AIInvestigationRule>,
          ): string => {
            return getInvestigationRuleTiming(values);
          },
          onChange: (
            value: unknown,
            currentValues: FormValues<AIInvestigationRule>,
            setNewFormValues: (values: FormValues<AIInvestigationRule>) => void,
          ): void => {
            if (!isInvestigationRuleTiming(value)) {
              return;
            }

            setNewFormValues(
              getValuesForInvestigationRuleTiming({
                values: currentValues,
                timing: value,
              }),
            );
          },
        },
        {
          field: { onlyIfOpenAfterMinutes: true },
          title: INVESTIGATION_RULE_WAIT_FIELD_TITLE,
          description: INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION[props.lane],
          stepId: "investigate",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          // Asked only with a wait, and then it is needed: no "(Optional)".
          hideOptionalLabel: true,
          placeholder: "10",
          dataTestId: "investigation-rule-wait-minutes",
          showIf: (values: FormValues<AIInvestigationRule>): boolean => {
            return isWaitChosen(values);
          },
          // A whole number from 1 to the longest wait, in one message.
          customValidation: (
            values: FormValues<AIInvestigationRule>,
          ): string | null => {
            return validateInvestigationRuleWait(values);
          },
        },
        {
          field: { name: true },
          title: "Name",
          stepId: "investigate",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          // "Name of this investigation rule." says nothing the title does not.
          hideColumnDescription: true,
          placeholder: isIncident
            ? "Investigate production incidents"
            : "Investigate production alerts",
          validation: {
            minLength: 2,
            maxLength: RULE_NAME_MAX_LENGTH,
          },
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          description: RULE_ENABLED_DESCRIPTION,
          stepId: "investigate",
          fieldType: FormFieldSchemaType.Toggle,
          // A rule starts on: the switch is on its edit form only.
          doNotShowWhenCreating: true,
          required: false,
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "investigate",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          collapsibleSection: INVESTIGATION_RULE_MORE_FIELDS,
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default AIInvestigationRulesTable;
