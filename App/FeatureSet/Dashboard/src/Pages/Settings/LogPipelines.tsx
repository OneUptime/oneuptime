import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import LogPipeline from "Common/Models/DatabaseModels/LogPipeline";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
### How Log Pipelines Work

Log pipelines let you transform and enrich logs **at ingest time** — before they are stored. Each pipeline matches logs using a filter query, then runs a series of processors to modify them.

\`\`\`mermaid
flowchart TD
    A[Log Arrives] --> B{Match Against Pipelines}
    B -->|Filter Matches| C[Run Processors In Order]
    B -->|No Match| D[Store Log As-Is]
    C --> E[Processor 1: Remap Severity]
    E --> F[Processor 2: Remap Attributes]
    F --> G[Processor 3: Categorize]
    G --> H[Store Transformed Log]
\`\`\`

---

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Pipeline** | A named rule that matches logs and applies processors to them |
| **Filter Query** | Determines which logs this pipeline applies to |
| **Processor** | A transformation step that modifies the log (e.g., remap severity, rename attributes) |
| **Sort Order** | Pipelines run in order — drag rows to reorder. Lower = runs first |

---

### Filter Query Syntax

Filter queries let you target specific logs. If left empty, the pipeline matches **all logs**.

| Operator | Example | Description |
|----------|---------|-------------|
| \`=\` | \`severityText = 'ERROR'\` | Exact match |
| \`!=\` | \`severityText != 'DEBUG'\` | Not equal |
| \`LIKE\` | \`body LIKE '%timeout%'\` | Pattern match (\`%\` = wildcard) |
| \`IN\` | \`severityText IN ('ERROR', 'WARN')\` | Match any value in list |
| \`AND\` | \`severityText = 'ERROR' AND attributes.service = 'api'\` | Both conditions must match |
| \`OR\` | \`severityText = 'ERROR' OR severityText = 'WARN'\` | Either condition matches |

**Available fields:** \`severityText\`, \`body\`, \`serviceId\`, \`attributes.<key>\`

---

### Processor Types

#### Severity Remapper
Converts a log field value into a standard severity level. Useful when your application logs severity as text like "warn" or "fatal" instead of standard OpenTelemetry severity.

**Example:** Map \`level = "warn"\` → severity WARNING (13)

#### Attribute Remapper
Renames or copies a log attribute from one key to another. Useful for normalizing attribute names across different services.

**Example:** Rename \`attributes.src_ip\` → \`attributes.source_address\`

#### Category Processor
Adds a category label to logs based on filter conditions. Useful for tagging logs with business-level categories.

**Example:** Tag logs matching \`severityText = 'ERROR'\` with category "Error"

---

### Examples

#### Example 1: Normalize severity from application logs
1. Create a pipeline with filter: \`attributes.source = 'legacy-app'\`
2. Add a **Severity Remapper** processor:
   - Source Key: \`level\`
   - Mappings: \`warn\` → WARNING, \`fatal\` → FATAL, \`info\` → INFO

#### Example 2: Rename attributes for consistency
1. Create a pipeline with no filter (matches all logs)
2. Add an **Attribute Remapper** processor:
   - Source: \`attributes.client_ip\`
   - Target: \`attributes.source_address\`

#### Example 3: Categorize error logs
1. Create a pipeline with filter: \`severityText IN ('ERROR', 'FATAL')\`
2. Add a **Category Processor**:
   - Target Key: \`error_category\`
   - Categories: "Database Error" for \`body LIKE '%connection%'\`, "Timeout" for \`body LIKE '%timeout%'\`
`;

const LogPipelines: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<LogPipeline>
        modelType={LogPipeline}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="log-pipelines-table"
        name="Settings > Log Pipelines"
        userPreferencesKey="log-pipelines-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        sortBy="sortOrder"
        sortOrder={SortOrder.Ascending}
        enableDragAndDrop={true}
        dragDropIndexField="sortOrder"
        cardProps={{
          title: "Log Pipelines",
          description:
            "Transform and enrich logs at ingest time. Each pipeline matches logs using a filter, then runs processors in order to modify them. Click a pipeline to configure its filter and processors.",
        }}
        helpContent={{
          title: "How Log Pipelines Work",
          description:
            "Understanding filters, processors, and how logs are transformed at ingest time",
          markdown: documentationMarkdown,
        }}
        noItemsMessage={"No log pipelines found."}
        viewPageRoute={Navigation.getCurrentRoute()}
        createInitialValues={{
          isEnabled: true,
        }}
        onBeforeCreate={async (item: LogPipeline) => {
          item.sortOrder = 1;
          return item;
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Parse Nginx Logs",
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
            placeholder: "Describe what this pipeline does.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
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
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: LogPipeline): ReactElement => {
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

export default LogPipelines;
