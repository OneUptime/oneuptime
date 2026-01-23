import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import React, { Fragment, FunctionComponent, ReactElement, useState } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUser from "../../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

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
| **Group By Service** | Alerts from monitors in different services → separate episodes | Alerts can be grouped regardless of service |
| **Group By Monitor** | Alerts from different monitors → separate episodes | Alerts from any monitor can be grouped together |
| **Group By Severity** | Alerts with different severities → separate episodes | Alerts of any severity can be grouped together |
| **Group By Alert Title** | Alerts with different titles → separate episodes | Alerts with any title can be grouped together |

> **Note:** Monitors can be attached to Services. A Service can have multiple monitors. Group By Service is useful when you want to group all alerts from a service together regardless of which specific monitor triggered them.

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


const AlertGroupingRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [showDocumentation, setShowDocumentation] = useState<boolean>(false);

  return (
    <Fragment>
      {/* Documentation Toggle Button */}
      <div className="mb-5 flex justify-end">
        <Button
          title={showDocumentation ? "Hide Documentation" : "Show Documentation"}
          icon={showDocumentation ? IconProp.ChevronUp : IconProp.QuestionCircle}
          buttonStyle={ButtonStyleType.SECONDARY_OUTLINE}
          onClick={() => {
            setShowDocumentation(!showDocumentation);
          }}
        />
      </div>

      {/* Documentation Section */}
      {showDocumentation && (
        <Card
          title="How Alert Grouping Rules Work"
          description="Understanding Match Criteria, Group By, and how alerts are organized into episodes"
          className="mb-5"
        >
          <div className="p-6">
            <MarkdownViewer text={documentationMarkdown} />
          </div>
        </Card>
      )}

      <ModelTable<AlertGroupingRule>
        modelType={AlertGroupingRule}
        id="alert-grouping-rules-table"
        name="Settings > Alert Grouping Rules"
        userPreferencesKey="alert-grouping-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Alert Grouping Rules",
          description:
            "Define rules to automatically group related alerts into episodes. Rules are evaluated in priority order - lower priority numbers are evaluated first.",
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
            getElement: (item: AlertGroupingRule): ReactElement => {
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
            placeholder: "Critical Service Alerts",
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
            placeholder: "Groups all critical alerts from production services",
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
              "Only group alerts from these monitors. Leave empty to match alerts from any monitor.",
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
            },
            required: false,
            description:
              "Only group alerts with these severities. Leave empty to match alerts of any severity.",
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
            description:
              "Only group alerts that have at least one of these labels attached to them. Leave empty to match alerts regardless of alert labels.",
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
            description:
              "Only group alerts from monitors that have at least one of these labels. Leave empty to match alerts regardless of monitor labels.",
            placeholder: "Select Monitor Labels (optional)",
          },
          {
            field: {
              alertTitlePattern: true,
            },
            title: "Alert Title Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "CPU.*high",
            description:
              "Regular expression pattern to match alert titles. Leave empty to match any title. Example: 'CPU.*high' matches titles containing 'CPU' followed by 'high'.",
          },
          {
            field: {
              alertDescriptionPattern: true,
            },
            title: "Alert Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "timeout|connection refused",
            description:
              "Regular expression pattern to match alert descriptions. Leave empty to match any description. Example: 'timeout|connection refused' matches descriptions containing either phrase.",
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
              "When enabled, alerts from monitors belonging to different services will be grouped into separate episodes. Monitors can be attached to services, and a service can have multiple monitors.",
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
              "Enable time-based grouping to limit how long an episode stays open for new alerts. When disabled, all alerts matching the grouping criteria (severity, title, monitor, etc.) will be grouped into a single ongoing episode regardless of when they occur. When enabled, alerts are only grouped if they arrive within the specified time window of the last alert.",
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
            showIf: (model: FormValues<AlertGroupingRule>): boolean => {
              return model.enableTimeWindow === true;
            },
            description:
              "Rolling window that determines how long an episode stays open for new alerts. Alerts arriving within this time gap of the last alert will be grouped into the same episode. For example, if set to 60 minutes, alerts will keep grouping as long as each new alert arrives within 60 minutes of the previous one.",
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
              "Enable this to add a grace period before auto-resolving an episode after all its alerts are resolved. This helps prevent unnecessary state changes during alert flapping - when alerts rapidly toggle between triggered and resolved states. Without this, the episode would resolve immediately when alerts resolve, then potentially reopen moments later if the issue recurs.",
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
            showIf: (model: FormValues<AlertGroupingRule>): boolean => {
              return model.enableResolveDelay === true;
            },
            description:
              "Number of minutes to wait after all alerts in the episode are resolved before automatically resolving the episode itself.",
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
              "Enable this to reopen recently resolved episodes instead of creating new ones when matching alerts arrive. This is useful for recurring issues - if a problem returns shortly after being resolved, it makes more sense to continue tracking it in the same episode rather than fragmenting the incident history across multiple episodes.",
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
            showIf: (model: FormValues<AlertGroupingRule>): boolean => {
              return model.enableReopenWindow === true;
            },
            description:
              "Time window after an episode is resolved during which a new matching alert will reopen that episode instead of creating a new one.",
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
              "Enable this to automatically resolve episodes after a period of inactivity. This helps clean up stale episodes that are no longer receiving alerts, ensuring your active episode list stays current and relevant. Without this, episodes would remain open indefinitely until manually resolved.",
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
            showIf: (model: FormValues<AlertGroupingRule>): boolean => {
              return model.enableInactivityTimeout === true;
            },
            description:
              "Number of minutes of inactivity (no new alerts added) after which the episode will be automatically resolved.",
          },
          {
            field: {
              episodeTitleTemplate: true,
            },
            title: "Episode Title Template",
            stepId: "episode-template",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "{alertSeverity} Alert Episode on {monitorName}",
            description:
              "Template for auto-generated episode titles. Use placeholders like {alertSeverity}, {monitorName}, {alertTitle}.",
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
        showAs={ShowAs.OrderedStatesList}
        orderedStatesListProps={{
          titleField: "name",
          descriptionField: "description",
          orderField: "priority",
          shouldAddItemInTheEnd: true,
        }}
      />
    </Fragment>
  );
};

export default AlertGroupingRulesPage;
