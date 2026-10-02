import PageComponentProps from "../../PageComponentProps";
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
import { Green, Red } from "Common/Types/BrandColors";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUser from "../../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import EpisodeMemberRoleAssignmentsFormField from "../../../Components/IncidentGroupingRule/EpisodeMemberRoleAssignmentsFormField";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
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
### How Incident Grouping Works

Incident grouping automatically combines related incidents into logical containers called **Episodes**. This reduces incident fatigue by showing one episode with 50 incidents instead of 50 individual notifications.

\`\`\`mermaid
flowchart TD
    A[New Incident Created] --> B{Match Against Rules}
    B -->|Rule Matches| C{Find Existing Episode}
    B -->|No Match| D[Incident Stays Ungrouped]
    C -->|Episode Found| E[Add Incident to Episode]
    C -->|No Episode| F[Create New Episode]
    E --> G[Update Episode Count]
    F --> H[Execute On-Call Policy]
\`\`\`

---

### Match Criteria vs Group By

These two concepts work together but serve different purposes:

| Aspect | Match Criteria | Group By |
|--------|---------------|----------|
| **Purpose** | Filter which incidents this rule applies to | Partition matching incidents into separate episodes |
| **Question** | "Does this incident qualify for this rule?" | "Which episode does this incident go into?" |
| **Example** | Only Critical incidents from production monitors | Separate episode per monitor |

#### Match Criteria (Filtering)

Match criteria acts as a **filter** that determines which incidents are eligible for this grouping rule. An incident must pass ALL specified criteria to be processed by the rule.

- **Monitors**: Only incidents from these specific monitors
- **Severities**: Only incidents with these severity levels
- **Labels**: Only incidents with at least one of these labels
- **Title/Description Patterns**: Regex patterns to match incident content

#### Group By (Partitioning)

Group By determines **how matching incidents are subdivided** into separate episodes. This creates the "grouping key" that identifies which episode an incident belongs to.

\`\`\`mermaid
flowchart LR
    subgraph "Match Criteria: Severity = Critical"
        A1[Incident: CPU High<br/>Monitor A]
        A2[Incident: Memory Low<br/>Monitor A]
        A3[Incident: CPU High<br/>Monitor B]
        A4[Incident: Disk Full<br/>Monitor B]
    end

    subgraph "Group By: Monitor"
        E1[Episode 1<br/>Monitor A<br/>2 incidents]
        E2[Episode 2<br/>Monitor B<br/>2 incidents]
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
| **Group By Monitor** | Incidents from different monitors → separate episodes | Incidents from any monitor can be grouped together |
| **Group By Severity** | Incidents with different severities → separate episodes | Incidents of any severity can be grouped together |
| **Group By Incident Title** | Incidents with different titles → separate episodes | Incidents with any title can be grouped together |
| **Group By Incident Labels** | Incidents with different sets of labels → separate episodes (exact set match) | Incident labels are ignored for grouping |
| **Group By Monitor Labels** | Incidents whose monitors have different sets of labels → separate episodes (exact set match) | Monitor labels are ignored for grouping |

#### Default Behavior

**If NO Group By options are enabled**, all matching incidents go into **ONE single episode**. This is useful when you want to group all related incidents regardless of their source.

\`\`\`mermaid
flowchart TD
    subgraph "No Group By Enabled"
        direction TB
        A1[Incident 1] --> E[Single Episode<br/>All Matching Incidents]
        A2[Incident 2] --> E
        A3[Incident 3] --> E
        A4[Incident 4] --> E
    end
\`\`\`

---

### Examples

#### Example 1: Group all Critical incidents by Monitor

**Configuration:**
- Match Criteria: Severity = Critical
- Group By: Monitor

**Result:** Each monitor gets its own episode for critical incidents.

#### Example 2: Single episode for all database incidents

**Configuration:**
- Match Criteria: Monitor Labels = "database"
- Group By: (none enabled)

**Result:** ALL database incidents go into one episode, regardless of which specific database monitor they come from.

#### Example 3: Fine-grained grouping

**Configuration:**
- Match Criteria: (none - matches all incidents)
- Group By: Monitor, Severity, Incident Title

**Result:** Very specific episodes - one per unique combination of monitor + severity + title.
`;

const KIND: GroupingRuleKind = GroupingRuleKind.Incident;

/*
 * Grouping rules, made simple to set up (see Utils/GroupingRule/
 * GroupingRuleSetup for the whole story): an empty list offers four
 * ready-made rules that are added in one click, the list says what each rule
 * does in words, and the form asks two questions - how to group, and how close
 * together - with everything else behind "Show advanced settings". The rule
 * stores and the engine reads exactly what they did before.
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
            "Understanding Match Criteria, Group By, and how incidents are organized into episodes",
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
            getElement: (item: IncidentGroupingRule): ReactElement => {
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
              return <Pill color={Red} text="Disabled" />;
            },
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        /*
         * Two questions, then Create: how to group and how close together
         * (Grouping), and which incidents (every one, unless narrowed down).
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
          {
            title: "Episode Lifecycle",
            id: "episode-lifecycle",
            showIf: (values: FormValues<IncidentGroupingRule>): boolean => {
              return isShowingAdvancedSettings(
                values as unknown as GroupingRuleValues,
              );
            },
          },
          {
            title: "Details",
            id: "details",
            showIf: (values: FormValues<IncidentGroupingRule>): boolean => {
              return isShowingAdvancedSettings(
                values as unknown as GroupingRuleValues,
              );
            },
          },
          {
            title: "On-Call & Ownership",
            id: "on-call-ownership",
            columns: 2,
            showIf: (values: FormValues<IncidentGroupingRule>): boolean => {
              return isShowingAdvancedSettings(
                values as unknown as GroupingRuleValues,
              );
            },
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
          getShowAdvancedSettingsFormField<IncidentGroupingRule>(),
          ...getGroupingRuleColumnFormFields<IncidentGroupingRule>(),
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
              "When enabled, incidents from different monitors will be grouped into separate episodes. When disabled, incidents from any monitor can be grouped together.",
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
              "When enabled, incidents with different severities will be grouped into separate episodes. When disabled, incidents of any severity can be grouped together.",
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
              "When enabled, incidents with different titles will be grouped into separate episodes. When disabled, incidents with any title can be grouped together.",
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
              "When enabled, incidents with different sets of labels will be grouped into separate episodes (exact set match). When disabled, incident labels are ignored for grouping.",
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
              "When enabled, incidents whose monitors have different sets of labels will be grouped into separate episodes (exact set match). When disabled, monitor labels are ignored for grouping.",
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
            placeholder: "Select Monitors (optional)",
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
            },
            required: false,
            placeholder: "Select Severities (optional)",
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
            placeholder: "Select Incident Labels (optional)",
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
              incidentTitlePattern: true,
            },
            title: "Incident Title Pattern",
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
            title: "Incident Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "timeout|connection refused",
          },
          {
            field: {
              monitorNamePattern: true,
            },
            title: "Monitor Name Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "prod-.*|api-server-.*",
          },
          {
            field: {
              monitorDescriptionPattern: true,
            },
            title: "Monitor Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "production|critical",
          },
          // Episode lifecycle - reopen, wait to resolve, resolve when quiet
          getReopenWindowFormField<IncidentGroupingRule>(KIND),
          getResolveDelayFormField<IncidentGroupingRule>(KIND),
          getInactivityTimeoutFormField<IncidentGroupingRule>(KIND),
          // Details - the rule's own description, and the episodes it opens
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "details",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Groups all critical incidents from production services",
          },
          {
            field: {
              episodeTitleTemplate: true,
            },
            title: "Episode Title Template",
            stepId: "details",
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
            title: "Episode Description Template",
            stepId: "details",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Episode created from {{incidentSeverity}} incident: {{incidentTitle}} on monitor {{monitorName}}",
            description:
              "Template for auto-generated episode descriptions. Uses the first incident's data to generate the description.",
            footerElement: (
              <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200 text-sm">
                <p className="font-medium mb-3">
                  Supported Template Variables:
                </p>
                <div className="mb-3">
                  <p className="text-xs font-medium text-gray-500 mb-1">
                    Static Variables (from first incident):
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-gray-700">
                    <li>
                      <code className="bg-gray-200 px-1 rounded">
                        {"{{incidentTitle}}"}
                      </code>{" "}
                      - Title of the incident
                    </li>
                    <li>
                      <code className="bg-gray-200 px-1 rounded">
                        {"{{incidentDescription}}"}
                      </code>{" "}
                      - Description of the incident
                    </li>
                    <li>
                      <code className="bg-gray-200 px-1 rounded">
                        {"{{incidentSeverity}}"}
                      </code>{" "}
                      - Severity level (e.g., Critical, Warning)
                    </li>
                    <li>
                      <code className="bg-gray-200 px-1 rounded">
                        {"{{monitorName}}"}
                      </code>{" "}
                      - Name of the monitor that triggered the incident
                    </li>
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">
                    Dynamic Variables (updated as incidents join):
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-gray-700">
                    <li>
                      <code className="bg-gray-200 px-1 rounded">
                        {"{{incidentCount}}"}
                      </code>{" "}
                      - Number of incidents in the episode
                    </li>
                  </ul>
                </div>
                <p className="mt-3 text-gray-500 text-xs">
                  Static variables use data from the first incident. Dynamic
                  variables update automatically when incidents are added or
                  removed.
                </p>
              </div>
            ),
          },
          {
            field: {
              showEpisodeOnStatusPage: true,
            },
            title: "Show Episodes on Status Page",
            stepId: "details",
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
          {
            field: {
              episodeMemberRoleAssignments: true,
            },
            title: "Episode Role Assignments",
            stepId: "on-call-ownership",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            spanFullRow: true,
            description:
              "Automatically assign users to specific roles when episodes are created with this rule. These role assignments will be applied to all new episodes that match this grouping rule.",
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
        ]}
        showRefreshButton={true}
      />
      {extras.templatesModal}
      {extras.statusMessage}
    </Fragment>
  );
};

export default IncidentGroupingRulesPage;
