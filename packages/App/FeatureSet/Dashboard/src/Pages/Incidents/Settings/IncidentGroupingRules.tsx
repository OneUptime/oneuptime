import { PillTone } from "Common/UI/Components/Pill/PillTone";
import PageComponentProps from "../../PageComponentProps";
import { INCIDENT_EPISODE_TEMPLATE_VARIABLE_GROUPS } from "Common/Utils/Episode/EpisodeTemplateVariables";
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
import IncidentGroupingRule, {
  EpisodeMemberRoleAssignment,
} from "Common/Models/DatabaseModels/IncidentGroupingRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green } from "Common/Types/BrandColors";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import getOwnersFormField from "Common/UI/Components/PeoplePicker/OwnersFormField";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import EpisodeMemberRoleAssignmentsFormField from "../../../Components/IncidentGroupingRule/EpisodeMemberRoleAssignmentsFormField";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
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
A grouping rule puts related incidents into one **episode**, so your team works on one problem instead of a flood of incidents. When a database goes down and 20 monitors open incidents, all 20 can share one episode that is acknowledged and resolved together.

## Set Up a Rule

1. Start from a template, or create a custom rule.
2. Under **Group incidents by**, choose what incidents must share to go into one episode: their **Monitor**, **Severity** or **Title**, their **Connected Services**, nothing at all (**Everything Together**), or a **Custom** mix.
3. Under **Which Incidents**, narrow the rule down to the incidents it should take: its match criteria. Left as it is, the rule takes every new incident.

Rules are checked from the top of the list down, and the first one that matches an incident takes it. Drag a rule to change its place.

## How Episodes Open and Close

- An incident joins the open episode its rule groups it into, or opens a new one, which pages the rule's on-call policies. An incident no rule takes stays on its own.
- **Only group incidents that arrive close together** keeps an episode to incidents a few minutes apart. Off, matching incidents keep joining the open episode until it is resolved.
- **Wait for more incidents** opens an episode only once several matching incidents are ongoing, and puts them all in it. Until then, each incident stays on its own and pages only its own on-call policies.
- **Reopen recently resolved episodes** reopens an episode when a matching incident arrives soon after it was resolved, instead of starting a new one.
- **Wait before resolving an episode** waits, once every incident in it is resolved, in case one comes back. **Resolve quiet episodes** resolves an episode no new incident has joined for a while.

## Match Criteria

Add conditions on the incident, such as its monitors, severity, labels or title, and choose whether all of them or any one must match.

## A Custom Mix

With **Custom**, choose each thing incidents must share to go into one episode. Incidents that differ in any of them go into separate episodes:

| Option | Incidents share an episode when they have the same |
|--------|----------------------------------------------------|
| **Monitor** | Monitor |
| **Severity** | Severity |
| **Incident Title** | Title |
| **Incident Labels** | Set of labels |
| **Monitor Labels** | Set of monitor labels |
| **Connected Services** | Services, or services that call each other on the Service Map. An incident on no service is grouped by its monitor. |

## Examples

- **One episode per monitor for critical incidents**: group by **Monitor**, for incidents whose severity is Critical.
- **One episode for every database incident**: **Everything Together**, for incidents whose monitor is labelled \`database\`.
- **An episode only for a wider outage**: **Everything Together**, with **Wait for more incidents** set to 3. A lone incident stays on its own; once 3 are ongoing, one episode opens with all of them, and the next ones join it.
- **One episode for a failure that spreads**: group by **Connected Services**. The orders service slows down and opens an incident; checkout and payments, which call orders, start failing too. All three share one episode instead of paging three times.
`;

const KIND: GroupingRuleKind = GroupingRuleKind.Incident;

/*
 * Everything a rule can do beyond grouping - paging on-call and owning its
 * episodes, reopening and resolving them, their titles and labels - folded
 * under More fields at the end of the Grouping step. Folded, its header names
 * what it holds and draws what a rule uses as chips ("On-Call Duty
 * Policies: 2"), on an edit form too, with a sentence under them while the
 * rule still has an old default assignee to settle. Built once: every field
 * in it names this one section, which is how the form folds them together.
 */
const MORE_FIELDS: FormFieldCollapsibleSection<IncidentGroupingRule> =
  getAdvancedFormSection<IncidentGroupingRule>({
    getSummary: (
      values: FormValues<IncidentGroupingRule>,
    ): Array<string> | undefined => {
      return getGroupingRuleMoreFieldsSummary(
        values as unknown as GroupingRuleValues,
      );
    },
  });

/*
 * Grouping rules, made simple to set up (see Utils/GroupingRule/
 * GroupingRuleSetup for the whole story): an empty list offers four
 * ready-made rules that are added in one click, the list says what each rule
 * does in words, and the form asks two questions - how to group, and how close
 * together - with everything else folded under More fields. The rule stores
 * and the engine reads exactly what they did before.
 */
const IncidentGroupingRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const extras: GroupingRuleTableExtras<IncidentGroupingRule> =
    useGroupingRuleTableExtras<IncidentGroupingRule>({
      kind: KIND,
      modelType: IncidentGroupingRule,
    });

  return (
    <Fragment>
      <ModelTable<IncidentGroupingRule>
        modelType={IncidentGroupingRule}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        id="incident-grouping-rules-table"
        name="Settings > Incident Grouping Rules"
        userPreferencesKey="incident-grouping-rules-table"
        saveFilterProps={{
          tableId: "incident-grouping-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Incident Grouping Rules",
          description: GROUPING_RULE_COPY.cardDescription[KIND],
          buttons: extras.cardButtons,
        }}
        helpContent={{
          title: "How Incident Grouping Rules Work",
          description:
            "Put related incidents into one episode, so one problem pages people once.",
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
          } as Select<IncidentGroupingRule>
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
            getElement: (item: IncidentGroupingRule): ReactElement => {
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
            getElement: (item: IncidentGroupingRule): ReactElement => {
              return (
                <GroupingRuleSummary
                  rule={item as unknown as GroupingRuleValues}
                  kind={KIND}
                />
              );
            },
            getExportValue: (item: IncidentGroupingRule): string => {
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
            getElement: (item: IncidentGroupingRule): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill tone={PillTone.Paused} text="Disabled" />;
            },
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        /*
         * Two questions, then Create: how to group and how close together
         * (Grouping), and which incidents (every one, unless narrowed down).
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
            showIf: (values: FormValues<IncidentGroupingRule>): boolean => {
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
          getGroupingModeFormField<IncidentGroupingRule>(KIND),
          getTimeWindowFormField<IncidentGroupingRule>(KIND),
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
          ...getGroupingRuleColumnFormFields<IncidentGroupingRule>(),
          ...getMinimumCountColumnFormFields<IncidentGroupingRule>(KIND),
          ...getLegacyDefaultAssigneeColumnFormFields<IncidentGroupingRule>(),
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
          getOwnersFormField<IncidentGroupingRule>({
            fieldKey: EPISODE_OWNERS_FIELD_KEY,
            usersKey: EPISODE_OWNER_USERS_COLUMN,
            teamsKey: EPISODE_OWNER_TEAMS_COLUMN,
            title: GROUPING_RULE_COPY.episodeOwnersTitle,
            description: GROUPING_RULE_COPY.episodeOwnersDescription,
            stepId: "grouping",
            collapsibleSection: MORE_FIELDS,
            spanFullRow: true,
          }),
          getLegacyDefaultAssigneeFormField<IncidentGroupingRule>({
            collapsibleSection: MORE_FIELDS,
          }),
          {
            field: {
              episodeMemberRoleAssignments: true,
            },
            title: "Episode Role Assignments",
            stepId: "grouping",
            collapsibleSection: MORE_FIELDS,
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            spanFullRow: true,
            description:
              "People to assign to roles on every new episode this rule creates.",
            getCustomElement: (
              values: FormValues<IncidentGroupingRule>,
              props: CustomElementProps,
            ): ReactElement => {
              return (
                <EpisodeMemberRoleAssignmentsFormField
                  initialValue={
                    (values.episodeMemberRoleAssignments as Array<EpisodeMemberRoleAssignment>) ||
                    []
                  }
                  onChange={(
                    assignments: Array<EpisodeMemberRoleAssignment>,
                  ) => {
                    if (props.onChange) {
                      props.onChange(assignments);
                    }
                  }}
                  error={props.error}
                />
              );
            },
          },
          /*
           * Episode lifecycle - wait for more incidents before opening one,
           * reopen, wait to resolve, resolve when quiet
           */
          getMinimumCountFormField<IncidentGroupingRule>({
            kind: KIND,
            collapsibleSection: MORE_FIELDS,
            sectionTitle: "Episode Lifecycle",
          }),
          getReopenWindowFormField<IncidentGroupingRule>({
            kind: KIND,
            collapsibleSection: MORE_FIELDS,
          }),
          getResolveDelayFormField<IncidentGroupingRule>({
            kind: KIND,
            collapsibleSection: MORE_FIELDS,
          }),
          getInactivityTimeoutFormField<IncidentGroupingRule>({
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
            placeholder:
              "Groups all critical incidents from production services",
          },
          {
            field: {
              episodeTitleTemplate: true,
            },
            // The variables, under the field and one "{{" away.
            templateVariables: INCIDENT_EPISODE_TEMPLATE_VARIABLE_GROUPS,
            templateVariablesDescription:
              EpisodeTemplateVariablesCopy.incidentVariablesDescription,
            title: "Episode Title Template",
            stepId: "grouping",
            collapsibleSection: MORE_FIELDS,
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder:
              "{{incidentSeverity}} Incident Episode on {{monitorName}}",
            description:
              "Template for auto-generated episode titles. Uses the first incident's data to generate the title.",
          },
          {
            field: {
              episodeDescriptionTemplate: true,
            },
            // The variables, under the field and one "{{" away.
            templateVariables: INCIDENT_EPISODE_TEMPLATE_VARIABLE_GROUPS,
            templateVariablesDescription:
              EpisodeTemplateVariablesCopy.incidentVariablesDescription,
            title: "Episode Description Template",
            stepId: "grouping",
            collapsibleSection: MORE_FIELDS,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Episode created from {{incidentSeverity}} incident: {{incidentTitle}} on monitor {{monitorName}}",
            description:
              "Template for auto-generated episode descriptions. Uses the first incident's data to generate the description.",
          },
          {
            field: {
              showEpisodeOnStatusPage: true,
            },
            title: "Show Episodes on Status Page",
            stepId: "grouping",
            collapsibleSection: MORE_FIELDS,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "When enabled, episodes created by this rule will be visible on public status pages.",
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
              "Incidents from different monitors go into separate episodes.",
          },
          {
            field: {
              groupBySeverity: true,
            },
            title: "Group By Incident Severity",
            stepId: "group-by",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Incidents with different severities go into separate episodes.",
          },
          {
            field: {
              groupByIncidentTitle: true,
            },
            title: "Group By Incident Title",
            stepId: "group-by",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Incidents with different titles go into separate episodes.",
          },
          {
            field: {
              groupByIncidentLabels: true,
            },
            title: "Group By Incident Labels",
            stepId: "group-by",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Incidents with different sets of labels go into separate episodes.",
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
              "Incidents whose monitors have different sets of labels go into separate episodes.",
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
              "Incidents on services that call each other on the Service Map go into the same episode.",
          },
          // Which incidents - drawn as one conditions builder
          {
            field: {
              monitors: true,
            },
            title: "Monitors",
            stepId: "match-criteria",
            sectionTitle: "Match by Attributes",
            sectionDescription:
              "Filter incidents by which monitor produced them and their severity/labels. Leave a filter empty to skip it.",
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
              incidentSeverities: true,
            },
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
            placeholder: "Select Severities",
          },
          {
            field: {
              incidentLabels: true,
            },
            title: "Incident Labels",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Incident Labels",
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
              incidentTitlePattern: true,
            },
            title: "Incident Title",
            description: "Leave empty to match any title.",
            stepId: "match-criteria",
            sectionTitle: "Match by Pattern",
            sectionDescription:
              "Case-insensitive regex matched against incident and monitor text.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "CPU.*high",
          },
          {
            field: {
              incidentDescriptionPattern: true,
            },
            title: "Incident Description",
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

export default IncidentGroupingRulesPage;
