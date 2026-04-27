import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import TracePipeline from "Common/Models/DatabaseModels/TracePipeline";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
### How Trace Pipelines Work

Trace pipelines let you transform and enrich spans **at ingest time** — before they are stored. Each pipeline matches spans using a filter query, then runs a series of processors to modify them.

---

### Processor Types

- **Attribute Remapper** — copy/rename span attribute keys.
- **Span Name Remapper** — rewrite span names based on a source field.
- **Status Remapper** — override span status code / message based on a source field.
- **Span Kind Remapper** — override span kind.
- **Category Processor** — tag spans with a category attribute based on filter rules.

### Filter Query Syntax

| Operator | Example | Description |
|----------|---------|-------------|
| \`=\` | \`kind = 'SPAN_KIND_SERVER'\` | Exact match |
| \`!=\` | \`statusCode != 2\` | Not equal |
| \`LIKE\` | \`name LIKE '%health%'\` | Pattern match (\`%\` = wildcard) |
| \`IN\` | \`kind IN ('SPAN_KIND_CLIENT', 'SPAN_KIND_PRODUCER')\` | Match any value in list |
| \`AND\` / \`OR\` | combine conditions |

**Available fields:** \`name\`, \`kind\`, \`statusCode\`, \`serviceId\`, \`attributes.<key>\`
`;

const TracePipelines: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<TracePipeline>
      modelType={TracePipeline}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="trace-pipelines-table"
      name="Traces > Settings > Pipelines"
      userPreferencesKey="trace-pipelines-table"
      isDeleteable={false}
      isEditable={false}
      isCreateable={true}
      isViewable={true}
      sortBy="sortOrder"
      sortOrder={SortOrder.Ascending}
      enableDragAndDrop={true}
      dragDropIndexField="sortOrder"
      cardProps={{
        title: "Trace Pipelines",
        description:
          "Transform and enrich spans at ingest time. Each pipeline matches spans using a filter, then runs processors in order to modify them. Click a pipeline to configure its filter and processors.",
      }}
      helpContent={{
        title: "How Trace Pipelines Work",
        description:
          "Understanding filters, processors, and how spans are transformed at ingest time",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No trace pipelines found."}
      viewPageRoute={Navigation.getCurrentRoute()}
      createInitialValues={{
        isEnabled: true,
      }}
      onBeforeCreate={async (item: TracePipeline) => {
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
          placeholder: "e.g. Normalize HTTP Spans",
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
          getElement: (item: TracePipeline): ReactElement => {
            if (item.isEnabled) {
              return <Pill color={Green} text="Enabled" />;
            }
            return <Pill color={Red} text="Disabled" />;
          },
        },
      ]}
    />
  );
};

export default TracePipelines;
