import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import AlertIncidentRule from "Common/Models/DatabaseModels/AlertIncidentRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { ALERT_INCIDENT_RULE_MAX_WAIT_IN_MINUTES } from "Common/Types/Alert/AlertIncidentRuleWait";
import { Black, Green, Red } from "Common/Types/BrandColors";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  ALERT_INCIDENT_RULE_NAME_DESCRIPTION,
  ALERT_INCIDENT_RULE_SAME_SEVERITY,
  ALERT_INCIDENT_RULE_SEVERITY_DESCRIPTION,
  ALERT_INCIDENT_RULE_SEVERITY_TITLE,
  ALERT_INCIDENT_RULE_STATUS_PAGE_DESCRIPTION,
  ALERT_INCIDENT_RULE_STATUS_PAGE_TITLE,
  ALERT_INCIDENT_RULE_WAIT_DESCRIPTION,
  ALERT_INCIDENT_RULE_WAIT_TITLE,
  ALERT_INCIDENT_RULE_WHEN_COLUMN_TITLE,
  ALERT_INCIDENT_RULES_CARD_DESCRIPTION,
  ALERT_INCIDENT_RULES_CARD_TITLE,
  ALERT_INCIDENT_RULES_NO_ITEMS_MESSAGE,
  describeAlertIncidentRuleWhen,
  followSeverityWithRuleName,
  getNewAlertIncidentRuleValues,
} from "../../../Components/AlertIncidentRule/AlertIncidentRuleCopy";
import {
  RULE_ENABLED_DESCRIPTION,
  RULE_NAME_MAX_LENGTH,
} from "../../../Utils/Form/ResourceRuleForm";

const alertIncidentRuleDocumentation: string = `
### How Alert Incident Rules Work

An incident rule declares an incident from the alerts it matches, so an alert that needs an incident gets one without anyone having to declare it by hand.

\`\`\`mermaid
flowchart TD
    A[New Alert Created] --> B{First Rule That Matches}
    B -->|No Rule Matches| C[It Stays an Alert]
    B -->|Declares Right Away| D[Incident Declared]
    B -->|Has a Wait| E{Still Unresolved When the Wait Is Up?}
    E -->|Yes| D
    E -->|No| C
    D --> F[Alert Linked to the Incident]
\`\`\`

### Match Criteria

The conditions an alert must meet.

### What It Does

When a rule matches, OneUptime declares an incident from the alert, as **Declare Incident** on the alert's page would: the incident takes the alert's title, description, monitor, resources and labels, is private when the alert is, and the alert is linked to it. The incident's own rules - on-call, owner, label and privacy rules - then run on it as on any new incident.

### Severity

Pick the incident's severity, or leave it empty to give each incident the severity that matches its alert's: the incident severity with the same name, or else the one at the same place in the list.

### Waiting Before Declaring

With **Declare After (Minutes)** above 0, the incident is declared only if the alert is still unresolved when the wait is up. An alert that resolves on its own before then never becomes an incident.

### Several Matching Rules

Rules are checked from the top of the list down, and the first one that matches an alert decides. Drag the rows to put the rules in order. An alert becomes at most one incident this way: one already linked to an incident is left alone.
`;

const AlertIncidentRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * What most rules leave alone, folded under More fields on the Incident
   * step: whether the incident shows on status pages (on, as for every
   * incident) and the rule's description. Built once, so the form folds it
   * the same way each time.
   */
  const moreFields: FormFieldCollapsibleSection<AlertIncidentRule> =
    useMemo(() => {
      return getAdvancedFormSection<AlertIncidentRule>();
    }, []);

  return (
    <ModelTable<AlertIncidentRule>
      modelType={AlertIncidentRule}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{ column: "isEnabled" }}
      id="alert-incident-rules-table"
      name="Settings > Alert Incident Rules"
      userPreferencesKey="alert-incident-rules-table"
      saveFilterProps={{
        tableId: "alert-incident-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      // The first rule that matches decides, from the top; a new one goes last.
      sortBy="order"
      sortOrder={SortOrder.Ascending}
      enableDragAndDrop={true}
      dragDropIndexField="order"
      // Named for the alert's own severity until one is picked.
      createInitialValues={getNewAlertIncidentRuleValues<AlertIncidentRule>()}
      cardProps={{
        title: ALERT_INCIDENT_RULES_CARD_TITLE,
        description: ALERT_INCIDENT_RULES_CARD_DESCRIPTION,
      }}
      noItemsMessage={ALERT_INCIDENT_RULES_NO_ITEMS_MESSAGE}
      helpContent={{
        title: "How Alert Incident Rules Work",
        description: "Which alerts become incidents, and when.",
        markdown: alertIncidentRuleDocumentation,
      }}
      selectMoreFields={{
        isEnabled: true,
        declareAfterInMinutes: true,
      }}
      filters={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
        },
        {
          field: {
            incidentSeverity: {
              color: true,
              name: true,
            },
          },
          title: ALERT_INCIDENT_RULE_SEVERITY_TITLE,
          type: FieldType.Entity,
          getElement: (item: AlertIncidentRule): ReactElement => {
            if (!item.incidentSeverity) {
              return (
                <span className="text-gray-500">
                  {translator.translateText(ALERT_INCIDENT_RULE_SAME_SEVERITY)}
                </span>
              );
            }

            return (
              <Pill
                color={item.incidentSeverity.color || Black}
                text={item.incidentSeverity.name || ""}
                isUserContent={isRecordNameAsWritten(
                  StateListType.IncidentSeverity,
                  item.incidentSeverity.name,
                )}
              />
            );
          },
        },
        {
          field: { declareAfterInMinutes: true },
          title: ALERT_INCIDENT_RULE_WHEN_COLUMN_TITLE,
          type: FieldType.Text,
          getElement: (item: AlertIncidentRule): ReactElement => {
            return (
              <span>
                {describeAlertIncidentRuleWhen(
                  item.declareAfterInMinutes,
                  translator,
                )}
              </span>
            );
          },
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: AlertIncidentRule): ReactElement => {
            if (item.isEnabled) {
              return <Pill color={Green} text="Enabled" />;
            }
            return <Pill color={Red} text="Disabled" />;
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={[
        { title: "Match", id: "match-criteria" },
        { title: "Incident", id: "incident" },
      ]}
      formFields={[
        // Match: drawn as one conditions builder, on "All alerts".
        {
          field: { monitors: true },
          title: "Monitors",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter alerts by which monitor produced them and their severity/labels. Leave a filter empty to skip it.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Monitor,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Monitors",
        },
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
          placeholder: "Select Severities",
        },
        {
          field: { alertLabels: true },
          title: "Alert Labels",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Alert Labels",
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
          placeholder: "Select Monitor Labels",
        },
        {
          field: { alertTitlePattern: true },
          title: "Alert Title",
          description: "Leave empty to match any title.",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against alert and monitor text.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "CPU.*high",
        },
        {
          field: { alertDescriptionPattern: true },
          title: "Alert Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "timeout|connection refused",
        },
        {
          field: { monitorNamePattern: true },
          title: "Monitor Name",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { monitorDescriptionPattern: true },
          title: "Monitor Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        /*
         * Incident: the severity it is declared with - none picked is the
         * alert's own, mapped - and how long the alert must stay unresolved
         * first, then the rule's name, filled in from the severity.
         */
        {
          field: { incidentSeverity: true },
          title: ALERT_INCIDENT_RULE_SEVERITY_TITLE,
          description: ALERT_INCIDENT_RULE_SEVERITY_DESCRIPTION,
          stepId: "incident",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownModal: {
            type: IncidentSeverity,
            labelField: "name",
            valueField: "_id",
            sort: {
              order: SortOrder.Ascending,
            },
          },
          required: false,
          // What no severity means, said where none is picked.
          placeholder: ALERT_INCIDENT_RULE_SAME_SEVERITY,
          onChange: followSeverityWithRuleName<AlertIncidentRule>(),
        },
        {
          field: { declareAfterInMinutes: true },
          title: ALERT_INCIDENT_RULE_WAIT_TITLE,
          description: ALERT_INCIDENT_RULE_WAIT_DESCRIPTION,
          stepId: "incident",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          placeholder: "0",
          validation: {
            minValue: 0,
            maxValue: ALERT_INCIDENT_RULE_MAX_WAIT_IN_MINUTES,
          },
        },
        {
          field: { name: true },
          title: "Name",
          description: ALERT_INCIDENT_RULE_NAME_DESCRIPTION,
          stepId: "incident",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. Declare SEV1 incidents",
          validation: {
            minLength: 2,
            maxLength: RULE_NAME_MAX_LENGTH,
          },
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          description: RULE_ENABLED_DESCRIPTION,
          stepId: "incident",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          // A rule starts on: the switch is on its edit form only.
          doNotShowWhenCreating: true,
        },
        {
          field: { showIncidentOnStatusPage: true },
          title: ALERT_INCIDENT_RULE_STATUS_PAGE_TITLE,
          description: ALERT_INCIDENT_RULE_STATUS_PAGE_DESCRIPTION,
          stepId: "incident",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          collapsibleSection: moreFields,
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "incident",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          collapsibleSection: moreFields,
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default AlertIncidentRulesPage;
