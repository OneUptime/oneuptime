import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
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
  AI_LANE_RULES_COPY,
  AiLane,
  AiLaneAdvancedCard,
} from "./ProjectAiSettingsCopy";
import { reportEnabledAiLaneRuleCount } from "./AiLaneRuleCount";

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
 * Incidents (or Alerts) → Settings → AI → More settings → Investigation
 * rules: which new incidents OneUptime AI investigates on its own, while
 * "Investigate new incidents" is on. With no rule, every one is; with rules,
 * only those that match at least one. A rule is a name and its conditions -
 * the same conditions, read the same way, as an auto remediation rule's.
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
        { title: "Rule", id: "basic-info" },
        { title: "Conditions", id: "match-criteria" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: isIncident
            ? "Investigate production incidents"
            : "Investigate production alerts",
          validation: { minLength: 2 },
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          // A rule starts on: the switch is on its edit form only.
          doNotShowWhenCreating: true,
          required: false,
        },
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
      ]}
      showRefreshButton={true}
    />
  );
};

export default AIInvestigationRulesTable;
