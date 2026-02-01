import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
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
| **Group By Service** | Incidents from monitors in different services → separate episodes | Incidents can be grouped regardless of service |
| **Group By Monitor** | Incidents from different monitors → separate episodes | Incidents from any monitor can be grouped together |
| **Group By Severity** | Incidents with different severities → separate episodes | Incidents of any severity can be grouped together |
| **Group By Incident Title** | Incidents with different titles → separate episodes | Incidents with any title can be grouped together |

> **Note:** Monitors can be attached to Services. A Service can have multiple monitors. Group By Service is useful when you want to group all incidents from a service together regardless of which specific monitor triggered them.

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

const IncidentGroupingRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentGroupingRule>
        modelType={IncidentGroupingRule}
        id="incident-grouping-rules-table"
        name="Settings > Incident Grouping Rules"
        userPreferencesKey="incident-grouping-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Incident Grouping Rules",
          description:
            "Define rules to automatically group related incidents into episodes. Rules are evaluated in priority order - lower priority numbers are evaluated first.",
        }}
        helpContent={{
          title: "How Incident Grouping Rules Work",
          description:
            "Understanding Match Criteria, Group By, and how incidents are organized into episodes",
          markdown: documentationMarkdown,
        }}
        sortBy="priority"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          priority: true,
          isEnabled: true,
        }}
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
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: {
              priority: true,
            },
            title: "Priority",
            type: FieldType.Number,
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
          {
            field: {
              timeWindowMinutes: true,
            },
            title: "Time Window (min)",
            type: FieldType.Number,
          },
          {
            field: {
              inactivityTimeoutMinutes: true,
            },
            title: "Inactivity Timeout (min)",
            type: FieldType.Number,
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "Match Criteria",
            id: "match-criteria",
          },
          {
            title: "Group By",
            id: "group-by",
          },
          {
            title: "Time Settings",
            id: "time-settings",
          },
          {
            title: "Episode Template",
            id: "episode-template",
          },
          {
            title: "Episode Roles",
            id: "episode-roles",
          },
          {
            title: "On-Call & Ownership",
            id: "on-call-ownership",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Critical Service Incidents",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Groups all critical incidents from production services",
          },
          {
            field: {
              priority: true,
            },
            title: "Priority",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "1",
            description:
              "Lower numbers have higher priority. Rules are evaluated in order.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: "Enable or disable this grouping rule.",
          },
          // Match Criteria Fields
          {
            field: {
              monitors: true,
            },
            title: "Monitors",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Only group incidents from these monitors. Leave empty to match incidents from any monitor.",
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
            description:
              "Only group incidents with these severities. Leave empty to match incidents of any severity.",
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
            description:
              "Only group incidents that have at least one of these labels attached to them. Leave empty to match incidents regardless of incident labels.",
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
            description:
              "Only group incidents from monitors that have at least one of these labels. Leave empty to match incidents regardless of monitor labels.",
            placeholder: "Select Monitor Labels (optional)",
          },
          {
            field: {
              incidentTitlePattern: true,
            },
            title: "Incident Title Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "CPU.*high",
            description:
              "Regular expression pattern to match incident titles. Leave empty to match any title. Example: 'CPU.*high' matches titles containing 'CPU' followed by 'high'.",
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
            description:
              "Regular expression pattern to match incident descriptions. Leave empty to match any description. Example: 'timeout|connection refused' matches descriptions containing either phrase.",
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
            description:
              "Regular expression pattern to match monitor names. Leave empty to match any monitor. Example: 'prod-.*' matches monitors starting with 'prod-'.",
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
            description:
              "Regular expression pattern to match monitor descriptions. Leave empty to match any description.",
          },
          // Group By Fields
          {
            field: {
              groupByService: true,
            },
            title: "Group By Service",
            stepId: "group-by",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "When enabled, incidents from monitors belonging to different services will be grouped into separate episodes. Monitors can be attached to services, and a service can have multiple monitors.",
          },
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
          // Time Settings Fields
          {
            field: {
              enableTimeWindow: true,
            },
            title: "Enable Time Window",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Enable time-based grouping to limit how long an episode stays open for new incidents. When disabled, all incidents matching the grouping criteria (severity, title, monitor, etc.) will be grouped into a single ongoing episode regardless of when they occur. When enabled, incidents are only grouped if they arrive within the specified time window of the last incident.",
          },
          {
            field: {
              timeWindowMinutes: true,
            },
            title: "Time Window (minutes)",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "60",
            showIf: (model: FormValues<IncidentGroupingRule>): boolean => {
              return model.enableTimeWindow === true;
            },
            description:
              "Rolling window that determines how long an episode stays open for new incidents. Incidents arriving within this time gap of the last incident will be grouped into the same episode. For example, if set to 60 minutes, incidents will keep grouping as long as each new incident arrives within 60 minutes of the previous one.",
          },
          {
            field: {
              enableResolveDelay: true,
            },
            title: "Enable Resolve Delay",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Enable this to add a grace period before auto-resolving an episode after all its incidents are resolved. This helps prevent unnecessary state changes during incident flapping - when incidents rapidly toggle between triggered and resolved states. Without this, the episode would resolve immediately when incidents resolve, then potentially reopen moments later if the issue recurs.",
          },
          {
            field: {
              resolveDelayMinutes: true,
            },
            title: "Resolve Delay (minutes)",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "5",
            showIf: (model: FormValues<IncidentGroupingRule>): boolean => {
              return model.enableResolveDelay === true;
            },
            description:
              "Number of minutes to wait after all incidents in the episode are resolved before automatically resolving the episode itself.",
          },
          {
            field: {
              enableReopenWindow: true,
            },
            title: "Enable Reopen Window",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Enable this to reopen recently resolved episodes instead of creating new ones when matching incidents arrive. This is useful for recurring issues - if a problem returns shortly after being resolved, it makes more sense to continue tracking it in the same episode rather than fragmenting the incident history across multiple episodes.",
          },
          {
            field: {
              reopenWindowMinutes: true,
            },
            title: "Reopen Window (minutes)",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "30",
            showIf: (model: FormValues<IncidentGroupingRule>): boolean => {
              return model.enableReopenWindow === true;
            },
            description:
              "Time window after an episode is resolved during which a new matching incident will reopen that episode instead of creating a new one.",
          },
          {
            field: {
              enableInactivityTimeout: true,
            },
            title: "Enable Inactivity Timeout",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Enable this to automatically resolve episodes after a period of inactivity. This helps clean up stale episodes that are no longer receiving incidents, ensuring your active episode list stays current and relevant. Without this, episodes would remain open indefinitely until manually resolved.",
          },
          {
            field: {
              inactivityTimeoutMinutes: true,
            },
            title: "Inactivity Timeout (minutes)",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "60",
            showIf: (model: FormValues<IncidentGroupingRule>): boolean => {
              return model.enableInactivityTimeout === true;
            },
            description:
              "Number of minutes of inactivity (no new incidents added) after which the episode will be automatically resolved.",
          },
          {
            field: {
              episodeTitleTemplate: true,
            },
            title: "Episode Title Template",
            stepId: "episode-template",
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
            stepId: "episode-template",
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
          // Episode Roles Fields
          {
            field: {
              episodeMemberRoleAssignments: true,
            },
            title: "Episode Role Assignments",
            stepId: "episode-roles",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            description:
              "Automatically assign users to specific roles when episodes are created with this rule. These role assignments will be applied to all new episodes that match this grouping rule.",
            getCustomElement: (
              value: EpisodeMemberRoleAssignment[] | undefined,
              props: CustomElementProps,
            ): ReactElement => {
              return (
                <EpisodeMemberRoleAssignmentsFormField
                  initialValue={value || []}
                  onChange={(assignments: Array<EpisodeMemberRoleAssignment>) => {
                    props.onChange(assignments);
                  }}
                  error={props.error}
                />
              );
            },
          },
          {
            field: {
              onCallDutyPolicies: true,
            },
            title: "On-Call Duty Policies",
            stepId: "on-call-ownership",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: OnCallDutyPolicy,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "On-call policies to execute when an episode is created with this rule.",
            placeholder: "Select On-Call Policies",
          },
          {
            field: {
              defaultAssignToTeam: true,
            },
            title: "Default Assign To Team",
            stepId: "on-call-ownership",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Default team to assign episodes created by this rule.",
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
            description:
              "Default user to assign episodes created by this rule.",
            placeholder: "Select User",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentGroupingRulesPage;
