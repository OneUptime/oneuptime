import PageComponentProps from "../../PageComponentProps";
import LogsNavTabs from "../../../Components/Logs/LogsNavTabs";
import LogsSettingsNavTabs from "../../../Components/Logs/LogsSettingsNavTabs";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
### How Log Drop Filters Work

Drop filters let you **discard or sample logs before they are stored**, reducing storage costs and noise. They run **before** pipeline processing.

\`\`\`mermaid
flowchart TD
    A[Log Arrives] --> B{Match Against Drop Filters}
    B -->|Filter Matches| C{Action Type}
    B -->|No Match| D[Continue to Pipelines]
    C -->|Drop| E[Log Discarded]
    C -->|Sample| F{Random Check}
    F -->|Keep %| D
    F -->|Discard %| E
\`\`\`

---

### Actions

| Action | Description |
|--------|-------------|
| **Drop** | Permanently discard all matching logs — they will never be stored |
| **Sample** | Keep only a percentage of matching logs. For example, 10% means ~1 in 10 matching logs are kept |

---

### Filter Query Syntax

Filter queries determine which logs this drop filter applies to.

| Operator | Example | Description |
|----------|---------|-------------|
| \`=\` | \`severityText = 'DEBUG'\` | Exact match |
| \`!=\` | \`severityText != 'ERROR'\` | Not equal |
| \`LIKE\` | \`body LIKE '%healthcheck%'\` | Pattern match (\`%\` = wildcard) |
| \`IN\` | \`severityText IN ('DEBUG', 'TRACE')\` | Match any value in list |
| \`AND\` / \`OR\` | \`severityText = 'DEBUG' AND attributes.source = 'loadbalancer'\` | Combine conditions |

**Available fields:** \`severityText\`, \`body\`, \`serviceId\`, \`attributes.<key>\`

---

### Examples

#### Example 1: Drop all debug logs
- **Filter Query:** \`severityText = 'DEBUG'\`
- **Action:** Drop
- **Result:** All debug-level logs are discarded before storage

#### Example 2: Sample verbose health check logs
- **Filter Query:** \`body LIKE '%healthcheck%' AND severityText = 'INFO'\`
- **Action:** Sample
- **Sample Percentage:** 5
- **Result:** Only 5% of health check info logs are kept — enough to spot trends without the noise

#### Example 3: Drop internal load balancer logs
- **Filter Query:** \`attributes.source = 'internal-lb'\`
- **Action:** Drop
- **Result:** All logs from the internal load balancer are discarded

---

### Tips
- **Order matters** — filters run in order. Drag rows to reorder
- **Start with Sample** — if unsure, sample at 50% first to see the impact before dropping entirely
- **Be specific** — use narrow filters to avoid accidentally dropping important logs
- **Drop filters run before pipelines** — a dropped log will never reach any pipeline processor
`;

const LogDropFilters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <LogsNavTabs active="settings" />
      <LogsSettingsNavTabs active="drop-filters" />
      <ModelTable<LogDropFilter>
        modelType={LogDropFilter}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="log-drop-filters-table"
        name="Logs > Settings > Drop Filters"
        userPreferencesKey="log-drop-filters-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        sortBy="sortOrder"
        sortOrder={SortOrder.Ascending}
        enableDragAndDrop={true}
        dragDropIndexField="sortOrder"
        cardProps={{
          title: "Log Drop Filters",
          description:
            "Discard or sample logs before they are stored to reduce noise and storage costs. Click a filter to configure its conditions and action.",
        }}
        helpContent={{
          title: "How Log Drop Filters Work",
          description:
            "Understanding drop vs sample actions, filter queries, and how logs are discarded at ingest time",
          markdown: documentationMarkdown,
        }}
        noItemsMessage={"No drop filters found."}
        selectMoreFields={{
          samplePercentage: true,
        }}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Drop Debug Logs",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Describe what this filter does.",
          },
        ]}
        showRefreshButton={true}
        showViewIdButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              action: true,
            },
            type: FieldType.Text,
            title: "Action",
          },
          {
            field: {
              isEnabled: true,
            },
            type: FieldType.Boolean,
            title: "Enabled",
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
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              action: true,
            },
            title: "Action",
            type: FieldType.Text,
            getElement: (item: LogDropFilter): ReactElement => {
              if (item.action === "drop") {
                return <Pill color={Red} text="Drop" />;
              }
              if (item.action === "sample") {
                return (
                  <Pill
                    color={Yellow}
                    text={`Sample ${item.samplePercentage ? item.samplePercentage + "%" : ""}`}
                  />
                );
              }
              return <Pill color={Red} text={item.action || "-"} />;
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: LogDropFilter): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default LogDropFilters;
