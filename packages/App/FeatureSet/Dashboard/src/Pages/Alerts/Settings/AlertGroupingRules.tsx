import PageComponentProps from "../../PageComponentProps";
import { ALERT_EPISODE_TEMPLATE_VARIABLE_GROUPS } from "Common/Utils/Episode/EpisodeTemplateVariables";
import EpisodeTemplateVariablesCopy from "../../../Components/IncidentGroupingRule/EpisodeTemplateVariablesCopy";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Select from "Common/Types/BaseDatabase/Select";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import getOwnersFormField from "Common/UI/Components/PeoplePicker/OwnersFormField";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  EPISODE_OWNERS_FIELD_KEY,
  EPISODE_OWNER_TEAMS_COLUMN,
  EPISODE_OWNER_USERS_COLUMN,
  GROUPING_RULE_COPY,
  GROUPING_RULE_TEMPLATES,
  GroupingRuleKind,
  GroupingRuleValues,
  getGroupingRuleMoreFieldsSummary,
  getGroupingRuleSummarySelect,
  getGroupingRuleSummaryText,
} from "../../../Utils/GroupingRule/GroupingRuleSetup";
import GroupingRuleSummary from "../../../Components/GroupingRule/GroupingRuleSummary";
import {
  getGroupingModeFormField,
  getGroupingRuleColumnFormFields,
  getInactivityTimeoutFormField,
  getLegacyDefaultAssigneeColumnFormFields,
  getLegacyDefaultAssigneeFormField,
  getMinimumCountColumnFormFields,
  getMinimumCountFormField,
  getReopenWindowFormField,
  getResolveDelayFormField,
  getTimeWindowFormField,
  isCustomGroupingSelected,
} from "../../../Components/GroupingRule/GroupingRuleFormFields";
import useGroupingRuleTableExtras, {
  GroupingRuleTableExtras,
} from "../../../Components/GroupingRule/GroupingRuleTableExtras";
import { translateGroupingRuleText } from "../../../Components/GroupingRule/GroupingRuleTranslate";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";

const documentationMarkdown: string = `
A grouping rule puts related alerts into one **episode**, so your team works on one problem instead of a flood of alerts. When a database goes down and 20 monitors raise alerts, all 20 can share one episode that is acknowledged and resolved together.

## Set Up a Rule

1. Start from a template, or create a custom rule.
2. Under **Group alerts by**, choose what alerts must share to go into one episode: their **Monitor**, **Severity** or **Title**, their **Connected Services**, nothing at all (**Everything Together**), or a **Custom** mix.
3. Under **Which Alerts**, narrow the rule down to the alerts it should take: its match criteria. Left as it is, the rule takes every new alert.

Rules are checked from the top of the list down, and the first one that matches an alert takes it. Drag a rule to change its place.

## How Episodes Open and Close

- An alert joins the open episode its rule groups it into, or opens a new one, which pages the rule's on-call policies. An alert no rule takes stays on its own.
- **Only group alerts that arrive close together** keeps an episode to alerts a few minutes apart. Off, matching alerts keep joining the open episode until it is resolved.
- **Wait for more alerts** opens an episode only once several matching alerts are ongoing, and puts them all in it. Until then, each alert stays on its own and pages only its own on-call policies.
- **Reopen recently resolved episodes** reopens an episode when a matching alert arrives soon after it was resolved, instead of starting a new one.
- **Wait before resolving an episode** waits, once every alert in it is resolved, in case one comes back. **Resolve quiet episodes** resolves an episode no new alert has joined for a while.

## Match Criteria

Add conditions on the alert, such as its monitor, severity, labels or title, and choose whether all of them or any one must match.

## A Custom Mix

With **Custom**, choose each thing alerts must share to go into one episode. Alerts that differ in any of them go into separate episodes:

| Option | Alerts share an episode when they have the same |
|--------|-------------------------------------------------|
| **Monitor** | Monitor |
| **Severity** | Severity |
| **Alert Title** | Title |
| **Alert Labels** | Set of labels |
| **Monitor Labels** | Set of monitor labels |
| **Connected Services** | Services, or services that call each other on the Service Map. An alert on no service is grouped by its monitor. |

## Examples

- **One episode per monitor for critical alerts**: group by **Monitor**, for alerts whose severity is Critical.
- **One episode for every database alert**: **Everything Together**, for alerts whose monitor is labelled \`database\`.
- **An episode only for a wider outage**: **Everything Together**, with **Wait for more alerts** set to 3. A lone alert stays on its own; once 3 are ongoing, one episode opens with all of them, and the next ones join it.
- **One episode for a failure that spreads**: group by **Connected Services**. The orders service slows down and raises an alert; checkout and payments, which call orders, start failing too. All three share one episode instead of paging three times.
`;

const KIND: GroupingRuleKind = GroupingRuleKind.Alert;

/*
 * Everything a rule can do beyond grouping - paging on-call and owning its
 * episodes, reopening and resolving them, their titles and labels - folded
 * under More fields at the end of the Grouping step, as on the incident
 * rules - with a sentence under its names while the rule still has an old
 * default assignee to settle. Built once: every field in it names this one
 * section.
 */
const MORE_FIELDS: FormFieldCollapsibleSection<AlertGroupingRule> =
  getAdvancedFormSection<AlertGroupingRule>({
    getSummary: (
      values: FormValues<AlertGroupingRule>,
    ): Array<string> | undefined => {
      return getGroupingRuleMoreFieldsSummary(
        values as unknown as GroupingRuleValues,
      );
    },
  });

/*
 * The alert twin of Incidents > Settings > Grouping Rules, kept to the same
 * design (see Utils/GroupingRule/GroupingRuleSetup): ready-made rules added
 * in one click, a sentence per rule in the list, and a form that asks how to
 * group and how close together, with everything else folded under More
 * fields. The rule stores and the engine reads exactly what they did before.
 */
const AlertGroupingRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const extras: GroupingRuleTableExtras<AlertGroupingRule> =
    useGroupingRuleTableExtras<AlertGroupingRule>({
      kind: KIND,
      modelType: AlertGroupingRule,
    });

  return (
    <Fragment>
      <ModelTable<AlertGroupingRule>
        modelType={AlertGroupingRule}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        id="alert-grouping-rules-table"
        name="Settings > Alert Grouping Rules"
        userPreferencesKey="alert-grouping-rules-table"
        saveFilterProps={{
          tableId: "alert-grouping-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Alert Grouping Rules",
          description: GROUPING_RULE_COPY.cardDescription[KIND],
          buttons: extras.cardButtons,
        }}
        helpContent={{
          title: "How Alert Grouping Rules Work",
          description:
            "Put related alerts into one episode, so one problem pages people once.",
          markdown: documentationMarkdown,
        }}
        noItemsMessage={extras.noItemsMessage}
        createInitialValues={extras.createInitialValues}
        showCreateForm={extras.showCreateForm}
        onCreateEditModalClose={extras.onCreateEditModalClose}
        refreshToggle={extras.refreshToggle}
        sortBy="priority"
        sortOrder={SortOrder.Ascending}
        // Evaluated from the top down; a new rule goes to the end.
        enableDragAndDrop={true}
        dragDropIndexField="priority"
        selectMoreFields={
          {
            isEnabled: true,
            description: true,
            ...getGroupingRuleSummarySelect(KIND),
          } as Select<AlertGroupingRule>
        }
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
            wrapContent: true,
            // A description under the name: each reads its own way.
            getLineText: drawsItsOwnLines,
            getElement: (item: AlertGroupingRule): ReactElement => {
              return (
                <div>
                  <p className="font-medium text-gray-900">
                    <IsolatedText text={item.name || ""} />
                  </p>
                  {item.description ? (
                    <IsolatedLine
                      as="p"
                      text={item.description}
                      className="mt-0.5 line-clamp-2 text-sm text-gray-500"
                    />
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              _id: true,
            },
            id: "grouping-summary",
            title: GROUPING_RULE_COPY.summaryColumnTitle,
            type: FieldType.Element,
            disableSort: true,
            wrapContent: true,
            getElement: (item: AlertGroupingRule): ReactElement => {
              return (
                <GroupingRuleSummary
                  rule={item as unknown as GroupingRuleValues}
                  kind={KIND}
                />
              );
            },
            getExportValue: (item: AlertGroupingRule): string => {
              return getGroupingRuleSummaryText({
                rule: item as unknown as GroupingRuleValues,
                kind: KIND,
                translate: translateGroupingRuleText,
              });
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: AlertGroupingRule): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        /*
         * Two questions, then Create: how to group and how close together
         * (Grouping), and which alerts (every one, unless narrowed down).
         * Group By only appears for a custom mix of switches. Everything
         * else is folded under More fields on the Grouping step.
         */
        formSteps={[
          {
            title: GROUPING_RULE_COPY.groupingStepTitle,
            id: "grouping",
          },
          {
            title: "Group By",
            id: "group-by",
            columns: 2,
            showIf: (values: FormValues<AlertGroupingRule>): boolean => {
              return isCustomGroupingSelected(
                values as unknown as GroupingRuleValues,
                KIND,
              );
            },
          },
          {
            title: GROUPING_RULE_COPY.whichStepTitle[KIND],
            id: "match-criteria",
            columns: 2,
          },
        ]}
        formFields={[
          // Grouping
          getGroupingModeFormField<AlertGroupingRule>(KIND),
          getTimeWindowFormField<AlertGroupingRule>(KIND),
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "grouping",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: GROUPING_RULE_TEMPLATES[0]!.name[KIND],
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "grouping",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            /*
             * The column default. Without it the switch rendered off on the
             * create form, and the form saved what it showed: every rule
             * created here was disabled until somebody turned it on.
             */
            defaultValue: true,
            description: "Enable or disable this grouping rule.",
          },
          ...getGroupingRuleColumnFormFields<AlertGroupingRule>(),
          ...getMinimumCountColumnFormFields<AlertGroupingRule>(KIND),
          ...getLegacyDefaultAssigneeColumnFormFields<AlertGroupingRule>(),
          /*
           * More fields, the end of the Grouping step: everything else a
           * rule can do, folded, under three small headings - who is paged
           * and owns its episodes, how they reopen and resolve, and how
           * they read. Every field names MORE_FIELDS.
           */
          {
            field: {
              onCallDutyPolicies: true,
            },
            title: "On-Call Policies",
            stepId: "grouping",
            collapsibleSection: MORE_FIELDS,
            sectionTitle: "On-Call & Ownership",
            description:
              "On-call policies to fire when an episode is created by this rule.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: OnCallDutyPolicy,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select On-Call Policies",
            spanFullRow: true,
          },
          /*
           * People and teams in one picker, saved to the rule's
           * episodeOwnerUsers and episodeOwnerTeams: the engine makes them
           * owners of every episode the rule opens. It replaced a Default
           * Assign To Team and User pair that nothing ever showed; a rule
           * that still has one gets a line about it just below.
           */
          getOwnersFormField<AlertGroupingRule>({
            fieldKey: EPISODE_OWNERS_FIELD_KEY,
            usersKey: EPISODE_OWNER_USERS_COLUMN,
            teamsKey: EPISODE_OWNER_TEAMS_COLUMN,
            title: GROUPING_RULE_COPY.episodeOwnersTitle,
            description: GROUPING_RULE_COPY.episodeOwnersDescription,
            stepId: "grouping",
            collapsibleSection: MORE_FIELDS,
            spanFullRow: true,
          }),
          getLegacyDefaultAssigneeFormField<AlertGroupingRule>({
            collapsibleSection: MORE_FIELDS,
          }),
          /*
           * Episode lifecycle - wait for more alerts before opening one,
           * reopen, wait to resolve, resolve when quiet
           */
          getMinimumCountFormField<AlertGroupingRule>({
            kind: KIND,
            collapsibleSection: MORE_FIELDS,
            sectionTitle: "Episode Lifecycle",
          }),
          getReopenWindowFormField<AlertGroupingRule>({
            kind: KIND,
            collapsibleSection: MORE_FIELDS,
          }),
          getResolveDelayFormField<AlertGroupingRule>({
            kind: KIND,
            collapsibleSection: MORE_FIELDS,
          }),
          getInactivityTimeoutFormField<AlertGroupingRule>({
            kind: KIND,
            collapsibleSection: MORE_FIELDS,
          }),
          // Details - the rule's own description, and the episodes it opens
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "grouping",
            collapsibleSection: MORE_FIELDS,
            sectionTitle: "Details",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Groups all critical alerts from production services",
          },
          {
            field: {
              episodeTitleTemplate: true,
            },
            // The variables, under the field and one "{{" away.
            templateVariables: ALERT_EPISODE_TEMPLATE_VARIABLE_GROUPS,
            templateVariablesDescription:
              EpisodeTemplateVariablesCopy.alertVariablesDescription,
            title: "Episode Title Template",
            stepId: "grouping",
            collapsibleSection: MORE_FIELDS,
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "{{alertSeverity}} Alert Episode on {{monitorName}}",
            description:
              "Template for auto-generated episode titles. Uses the first alert's data to generate the title.",
          },
          {
            field: {
              episodeDescriptionTemplate: true,
            },
            // The variables, under the field and one "{{" away.
            templateVariables: ALERT_EPISODE_TEMPLATE_VARIABLE_GROUPS,
            templateVariablesDescription:
              EpisodeTemplateVariablesCopy.alertVariablesDescription,
            title: "Episode Description Template",
            stepId: "grouping",
            collapsibleSection: MORE_FIELDS,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Episode created from {{alertSeverity}} alert: {{alertTitle}} on monitor {{monitorName}}",
            description:
              "Template for auto-generated episode descriptions. Uses the first alert's data to generate the description.",
          },
          {
            field: {
              episodeLabels: true,
            },
            title: "Episode Labels",
            stepId: "grouping",
            collapsibleSection: MORE_FIELDS,
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Labels to automatically attach to episodes created by this rule.",
            placeholder: "Select Labels",
          },
          // Group By - a custom mix of the five switches
          {
            field: {
              groupByMonitor: true,
            },
            title: "Group By Monitor",
            stepId: "group-by",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Alerts from different monitors go into separate episodes.",
          },
          {
            field: {
              groupBySeverity: true,
            },
            title: "Group By Alert Severity",
            stepId: "group-by",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Alerts with different severities go into separate episodes.",
          },
          {
            field: {
              groupByAlertTitle: true,
            },
            title: "Group By Alert Title",
            stepId: "group-by",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Alerts with different titles go into separate episodes.",
          },
          {
            field: {
              groupByAlertLabels: true,
            },
            title: "Group By Alert Labels",
            stepId: "group-by",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Alerts with different sets of labels go into separate episodes.",
          },
          {
            field: {
              groupByMonitorLabels: true,
            },
            title: "Group By Monitor Labels",
            stepId: "group-by",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Alerts whose monitors have different sets of labels go into separate episodes.",
          },
          {
            field: {
              groupByConnectedServices: true,
            },
            title: "Group By Connected Services",
            stepId: "group-by",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Alerts on services that call each other on the Service Map go into the same episode.",
          },
          // Which alerts - drawn as one conditions builder
          {
            field: {
              monitors: true,
            },
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
            field: {
              alertSeverities: true,
            },
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
            field: {
              alertLabels: true,
            },
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
            field: {
              monitorLabels: true,
            },
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
            field: {
              alertTitlePattern: true,
            },
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
            field: {
              alertDescriptionPattern: true,
            },
            title: "Alert Description",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "timeout|connection refused",
          },
          {
            field: {
              monitorNamePattern: true,
            },
            title: "Monitor Name",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "prod-.*|api-server-.*",
          },
          {
            field: {
              monitorDescriptionPattern: true,
            },
            title: "Monitor Description",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "production|critical",
          },
        ]}
        showRefreshButton={true}
      />
      {extras.templatesModal}
      {extras.statusMessage}
    </Fragment>
  );
};

export default AlertGroupingRulesPage;
