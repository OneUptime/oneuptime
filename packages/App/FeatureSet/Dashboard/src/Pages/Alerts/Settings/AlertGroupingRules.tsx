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
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUser from "../../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import {
  GROUPING_RULE_COPY,
  GROUPING_RULE_TEMPLATES,
  GroupingRuleKind,
  GroupingRuleValues,
  getGroupingRuleSummarySelect,
  getGroupingRuleSummaryText,
} from "../../../Utils/GroupingRule/GroupingRuleSetup";
import GroupingRuleSummary from "../../../Components/GroupingRule/GroupingRuleSummary";
import {
  getGroupingModeFormField,
  getGroupingRuleColumnFormFields,
  getInactivityTimeoutFormField,
  getReopenWindowFormField,
  getResolveDelayFormField,
  getShowAdvancedSettingsFormField,
  getTimeWindowFormField,
  isCustomGroupingSelected,
  isShowingAdvancedSettings,
} from "../../../Components/GroupingRule/GroupingRuleFormFields";
import useGroupingRuleTableExtras, {
  GroupingRuleTableExtras,
} from "../../../Components/GroupingRule/GroupingRuleTableExtras";
import { translateGroupingRuleText } from "../../../Components/GroupingRule/GroupingRuleTranslate";

const documentationMarkdown: string = `
### How Alert Grouping Works

Alert grouping automatically combines related alerts into logical containers called **Episodes**. This reduces alert fatigue by showing one episode with 50 alerts instead of 50 individual notifications.

\`\`\`mermaid
flowchart TD
    A[🔔 New Alert Created] --> B{Match Against Rules}
    B -->|Rule Matches| C{Find Existing Episode}
    B -->|No Match| D[Alert Stays Ungrouped]
    C -->|Episode Found| E[Add Alert to Episode]
    C -->|No Episode| F[Create New Episode]
    E --> G[Update Episode Count]
    F --> H[Execute On-Call Policy]
\`\`\`

---

### Match Criteria vs Group By

These two concepts work together but serve different purposes:

| Aspect | Match Criteria | Group By |
|--------|---------------|----------|
| **Purpose** | Filter which alerts this rule applies to | Partition matching alerts into separate episodes |
| **Question** | "Does this alert qualify for this rule?" | "Which episode does this alert go into?" |
| **Example** | Only Critical alerts from production monitors | Separate episode per monitor |

#### Match Criteria (Filtering)

Match criteria acts as a **filter** that determines which alerts are eligible for this grouping rule. An alert must pass ALL specified criteria to be processed by the rule.

- **Monitors**: Only alerts from these specific monitors
- **Severities**: Only alerts with these severity levels
- **Labels**: Only alerts with at least one of these labels
- **Title/Description Patterns**: Regex patterns to match alert content

#### Group By (Partitioning)

Group By determines **how matching alerts are subdivided** into separate episodes. This creates the "grouping key" that identifies which episode an alert belongs to.

\`\`\`mermaid
flowchart LR
    subgraph "Match Criteria: Severity = Critical"
        A1[Alert: CPU High<br/>Monitor A]
        A2[Alert: Memory Low<br/>Monitor A]
        A3[Alert: CPU High<br/>Monitor B]
        A4[Alert: Disk Full<br/>Monitor B]
    end

    subgraph "Group By: Monitor"
        E1[Episode 1<br/>Monitor A<br/>2 alerts]
        E2[Episode 2<br/>Monitor B<br/>2 alerts]
    end

    A1 --> E1
    A2 --> E1
    A3 --> E2
    A4 --> E2
\`\`\`

---

### Group By Options Explained

| Option | When Enabled | When Disabled |
|--------|-------------|---------------|
| **Group By Monitor** | Alerts from different monitors → separate episodes | Alerts from any monitor can be grouped together |
| **Group By Severity** | Alerts with different severities → separate episodes | Alerts of any severity can be grouped together |
| **Group By Alert Title** | Alerts with different titles → separate episodes | Alerts with any title can be grouped together |
| **Group By Alert Labels** | Alerts with different sets of labels → separate episodes (exact set match) | Alert labels are ignored for grouping |
| **Group By Monitor Labels** | Alerts whose monitors have different sets of labels → separate episodes (exact set match) | Monitor labels are ignored for grouping |

#### Default Behavior

**If NO Group By options are enabled**, all matching alerts go into **ONE single episode**. This is useful when you want to group all related alerts regardless of their source.

\`\`\`mermaid
flowchart TD
    subgraph "No Group By Enabled"
        direction TB
        A1[Alert 1] --> E[Single Episode<br/>All Matching Alerts]
        A2[Alert 2] --> E
        A3[Alert 3] --> E
        A4[Alert 4] --> E
    end
\`\`\`

---

### Examples

#### Example 1: Group all Critical alerts by Monitor

**Configuration:**
- Match Criteria: Severity = Critical
- Group By: Monitor ✓

**Result:** Each monitor gets its own episode for critical alerts.

#### Example 2: Single episode for all database alerts

**Configuration:**
- Match Criteria: Monitor Labels = "database"
- Group By: (none enabled)

**Result:** ALL database alerts go into one episode, regardless of which specific database monitor they come from.

#### Example 3: Fine-grained grouping

**Configuration:**
- Match Criteria: (none - matches all alerts)
- Group By: Monitor ✓, Severity ✓, Alert Title ✓

**Result:** Very specific episodes - one per unique combination of monitor + severity + title.
`;

const KIND: GroupingRuleKind = GroupingRuleKind.Alert;

/*
 * The alert twin of Incidents > Settings > Grouping Rules, kept to the same
 * design (see Utils/GroupingRule/GroupingRuleSetup): ready-made rules added
 * in one click, a sentence per rule in the list, and a form that asks how to
 * group and how close together, with everything else behind "Show advanced
 * settings". The rule stores and the engine reads exactly what they did
 * before.
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
            "Understanding Match Criteria, Group By, and how alerts are organized into episodes",
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
            getElement: (item: AlertGroupingRule): ReactElement => {
              return (
                <div>
                  <p className="font-medium text-gray-900">{item.name}</p>
                  {item.description ? (
                    <p className="mt-0.5 line-clamp-2 text-sm text-gray-500">
                      {item.description}
                    </p>
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
         * Group By only appears for a custom mix of switches, and the last
         * three steps only behind "Show advanced settings" - which a rule
         * that already uses them opens with.
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
          {
            title: "Episode Lifecycle",
            id: "episode-lifecycle",
            showIf: (values: FormValues<AlertGroupingRule>): boolean => {
              return isShowingAdvancedSettings(
                values as unknown as GroupingRuleValues,
              );
            },
          },
          {
            title: "Details",
            id: "details",
            showIf: (values: FormValues<AlertGroupingRule>): boolean => {
              return isShowingAdvancedSettings(
                values as unknown as GroupingRuleValues,
              );
            },
          },
          {
            title: "On-Call & Ownership",
            id: "on-call-ownership",
            columns: 2,
            showIf: (values: FormValues<AlertGroupingRule>): boolean => {
              return isShowingAdvancedSettings(
                values as unknown as GroupingRuleValues,
              );
            },
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
          getShowAdvancedSettingsFormField<AlertGroupingRule>(),
          ...getGroupingRuleColumnFormFields<AlertGroupingRule>(),
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
              "When enabled, alerts from different monitors will be grouped into separate episodes. When disabled, alerts from any monitor can be grouped together.",
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
              "When enabled, alerts with different severities will be grouped into separate episodes. When disabled, alerts of any severity can be grouped together.",
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
              "When enabled, alerts with different titles will be grouped into separate episodes. When disabled, alerts with any title can be grouped together.",
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
              "When enabled, alerts with different sets of labels will be grouped into separate episodes (exact set match). When disabled, alert labels are ignored for grouping.",
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
              "When enabled, alerts whose monitors have different sets of labels will be grouped into separate episodes (exact set match). When disabled, monitor labels are ignored for grouping.",
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
            placeholder: "Select Monitors (optional)",
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
            placeholder: "Select Severities (optional)",
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
            placeholder: "Select Alert Labels (optional)",
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
            placeholder: "Select Monitor Labels (optional)",
          },
          {
            field: {
              alertTitlePattern: true,
            },
            title: "Alert Title",
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
          // Episode lifecycle - reopen, wait to resolve, resolve when quiet
          getReopenWindowFormField<AlertGroupingRule>(KIND),
          getResolveDelayFormField<AlertGroupingRule>(KIND),
          getInactivityTimeoutFormField<AlertGroupingRule>(KIND),
          // Details - the rule's own description, and the episodes it opens
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "details",
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
            stepId: "details",
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
            stepId: "details",
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
            stepId: "details",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Labels to automatically attach to episodes created by this rule.",
            placeholder: "Select Labels (optional)",
          },
          // On-call and ownership of the episodes this rule opens
          {
            field: {
              onCallDutyPolicies: true,
            },
            title: "On-Call Duty Policies",
            stepId: "on-call-ownership",
            sectionTitle: "Policies to Execute",
            sectionDescription:
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
          {
            field: {
              defaultAssignToTeam: true,
            },
            title: "Default Assign To Team",
            stepId: "on-call-ownership",
            sectionTitle: "Default Assignees",
            sectionDescription:
              "The team and user new episodes are assigned to by default. Both are optional.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Team",
          },
          {
            field: {
              defaultAssignToUser: true,
            },
            title: "Default Assign To User",
            stepId: "on-call-ownership",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            required: false,
            placeholder: "Select User",
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
