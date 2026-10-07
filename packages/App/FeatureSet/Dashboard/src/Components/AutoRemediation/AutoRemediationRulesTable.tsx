import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import AutoRemediationAction from "Common/Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "Common/Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import { Blue, Green, Purple, Red, Yellow } from "Common/Types/BrandColors";
import React, { FunctionComponent, ReactElement } from "react";
import {
  AI_LANE_ADVANCED_CARD_TITLES,
  AI_LANE_REMEDIATION_RULES_TABLE_ID,
  AI_LANE_RULES_COPY,
  AiLane,
  AiLaneAdvancedCard,
} from "../AISettings/ProjectAiSettingsCopy";
import { reportEnabledAiLaneRuleCount } from "../AISettings/AiLaneRuleCount";
import {
  AUTO_REMEDIATION_APPROVAL_OPTIONS,
  AUTO_REMEDIATION_APPROVAL_TEXT,
  AUTO_REMEDIATION_FIX_WITH_OPTIONS,
  AUTO_REMEDIATION_FIX_WITH_TEXT,
  AutoRemediationFixWith,
  doesAutoRemediationRuleAskFirst,
  getAutoRemediationFixWith,
  isRunbooksFixWith,
} from "./AutoRemediationRuleCopy";

export interface ComponentProps {
  lane: AiLane;
  // How many enabled rules there are, after every read of the table.
  onRulesLoaded?: ((count: number) => void) | undefined;
}

export const AI_LANE_REMEDIATION_RULE_TRIGGER: Record<
  AiLane,
  AutoRemediationTriggerEntity
> = {
  [AiLane.Incident]: AutoRemediationTriggerEntity.Incident,
  [AiLane.Alert]: AutoRemediationTriggerEntity.Alert,
};

/*
 * Incidents (or Alerts) → Settings → AI → More settings → Auto remediation
 * rules: which new incidents are fixed, and how, while "Fix new incidents
 * automatically" is on. With no rule, OneUptime AI fixes every one; with
 * rules, only those that match at least one are fixed.
 *
 * A rule used to be five steps of fourteen fields - runbooks, "let AI pick
 * the runbook", "let AI compose commands", a command allowlist, command
 * Runners, an execution mode, a verification window and auto-resolve. From
 * first principles a rule answers three questions, and that is all it asks:
 *
 *   - Which incidents? Its conditions.
 *   - Who fixes them? OneUptime AI, through the AI agent on the cluster or
 *     host they affect, or the runbooks the rule names.
 *   - Ask first? Whether a fix waits for someone to approve it.
 *
 * What the old fields hold on a rule saved before is kept and still used
 * (AutoRemediationRuleEngineService): the form never sends them, so editing
 * a rule's name or conditions does not change how it fixes. The table names
 * those rules for what they still do.
 */

const FIX_WITH_PILLS: Record<
  AutoRemediationFixWith,
  { text: string; color: typeof Blue }
> = {
  [AutoRemediationFixWith.OneUptimeAi]: {
    text: AUTO_REMEDIATION_FIX_WITH_TEXT.oneUptimeAi,
    color: Purple,
  },
  [AutoRemediationFixWith.Runbooks]: {
    text: AUTO_REMEDIATION_FIX_WITH_TEXT.runbooks,
    color: Blue,
  },
  [AutoRemediationFixWith.RunnerCommands]: {
    text: AUTO_REMEDIATION_FIX_WITH_TEXT.runnerCommands,
    color: Purple,
  },
  [AutoRemediationFixWith.AiPickedRunbook]: {
    text: AUTO_REMEDIATION_FIX_WITH_TEXT.aiPickedRunbook,
    color: Purple,
  },
};

const AutoRemediationRulesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isIncident: boolean = props.lane === AiLane.Incident;
  const triggerEntityType: AutoRemediationTriggerEntity =
    AI_LANE_REMEDIATION_RULE_TRIGGER[props.lane];

  return (
    <ModelTable<AutoRemediationRule>
      modelType={AutoRemediationRule}
      id={AI_LANE_REMEDIATION_RULES_TABLE_ID[props.lane]}
      name="Settings > AI > Auto Remediation Rules"
      userPreferencesKey={AI_LANE_REMEDIATION_RULES_TABLE_ID[props.lane]}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      query={{ triggerEntityType: triggerEntityType }}
      onBeforeCreate={async (item: AutoRemediationRule) => {
        item.triggerEntityType = triggerEntityType;
        return item;
      }}
      onFetchSuccess={() => {
        void reportEnabledAiLaneRuleCount<AutoRemediationRule>({
          modelType: AutoRemediationRule,
          triggerEntityType: triggerEntityType,
          onRulesLoaded: props.onRulesLoaded,
        });
      }}
      cardProps={{
        title:
          AI_LANE_ADVANCED_CARD_TITLES[props.lane][
            AiLaneAdvancedCard.RemediationRules
          ],
        description: AI_LANE_RULES_COPY[props.lane].remediationRulesDescription,
      }}
      noItemsMessage={
        isIncident
          ? "No rules. Every new incident is fixed while fixing is on."
          : "No rules. Every new alert is fixed while fixing is on."
      }
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{
        isEnabled: true,
        remediationAction: true,
        aiSelectsRunbook: true,
        aiComposesCommands: true,
      }}
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
          field: { remediationAction: true },
          title: "Fix With",
          type: FieldType.Text,
          getElement: (item: AutoRemediationRule): ReactElement => {
            const pill: { text: string; color: typeof Blue } =
              FIX_WITH_PILLS[getAutoRemediationFixWith(item)];
            return <Pill color={pill.color} text={pill.text} />;
          },
        },
        {
          field: { executionMode: true },
          title: "Approval",
          type: FieldType.Text,
          getElement: (item: AutoRemediationRule): ReactElement => {
            return doesAutoRemediationRuleAskFirst(item) ? (
              <Pill
                color={Blue}
                text={AUTO_REMEDIATION_APPROVAL_TEXT.asksFirst}
              />
            ) : (
              <Pill
                color={Yellow}
                text={AUTO_REMEDIATION_APPROVAL_TEXT.withoutAsking}
              />
            );
          },
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: AutoRemediationRule): ReactElement => {
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
        { title: "Fix", id: "remediation" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Restart API pods on high error rate",
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
        {
          // Who fixes: OneUptime AI or the rule's runbooks.
          field: { remediationAction: true },
          title: "Fix With",
          stepId: "remediation",
          fieldType: FormFieldSchemaType.CardSelect,
          cardSelectSingleColumn: true,
          cardSelectOptions: AUTO_REMEDIATION_FIX_WITH_OPTIONS,
          required: true,
          defaultValue: AutoRemediationAction.OneUptimeAI,
          dataTestId: "auto-remediation-fix-with-field",
        },
        {
          field: { runbooks: true },
          title: "Runbooks",
          stepId: "remediation",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Runbook,
            labelField: "name",
            valueField: "_id",
          },
          required: isRunbooksFixWith,
          showIf: isRunbooksFixWith,
          placeholder: "Select Runbooks",
        },
        {
          // Ask first: whether a fix waits for someone to approve it.
          field: { executionMode: true },
          title: "Approval",
          stepId: "remediation",
          fieldType: FormFieldSchemaType.CardSelect,
          cardSelectSingleColumn: true,
          cardSelectOptions: AUTO_REMEDIATION_APPROVAL_OPTIONS,
          required: true,
          defaultValue: AutoRemediationExecutionMode.Suggest,
          dataTestId: "auto-remediation-approval-field",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export {
  AUTO_REMEDIATION_APPROVAL_OPTIONS,
  AUTO_REMEDIATION_APPROVAL_TEXT,
  AUTO_REMEDIATION_FIX_WITH_OPTIONS,
  AUTO_REMEDIATION_FIX_WITH_TEXT,
  AutoRemediationFixWith,
  doesAutoRemediationRuleAskFirst,
  getAutoRemediationFixWith,
  isRunbooksFixWith,
};

export default AutoRemediationRulesTable;
