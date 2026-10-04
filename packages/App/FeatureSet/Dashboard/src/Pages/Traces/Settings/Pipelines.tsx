import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
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
| \`LIKE\` | \`name LIKE 'health'\` | Substring match (use \`%\` for SQL-style wildcards) |
| \`IN\` | \`kind IN ('SPAN_KIND_CLIENT', 'SPAN_KIND_PRODUCER')\` | Match any value in list |
| \`AND\` / \`OR\` | combine conditions |

**Available fields:** \`name\`, \`kind\`, \`statusCode\`, \`primaryEntityId\`, \`attributes.<key>\`

### Example: mark successful HTTP spans as Ok

Most instrumentation leaves successful spans **Unset**, the OpenTelemetry default, and sets **Error** only on failure. So Unset already means "no error". If you want successful requests to show as **Ok**:

1. Create a pipeline with the filter condition **Status = Unset** (\`statusCode = '0'\`), so spans already marked Error are never changed.
2. Add a **Status Remapper** processor with the source key \`http.response.status_code\` (older SDKs use \`http.status_code\`) and one mapping per code, for example \`200\` → Ok, \`201\` → Ok, \`204\` → Ok and \`304\` → Ok. Each mapping matches one exact value.

Pipelines apply to spans ingested after you save them (a change can take up to a minute to reach ingest); spans already stored keep their status.
`;

/*
 * A new pipeline is a name. It does nothing until it has a filter and
 * processors, and those are set up on its own page - so the create form asks
 * only for the name (the description folded under Advanced), and creating
 * one opens its page. Enabled is not asked: the column defaults to on, and a
 * pipeline with no processors changes nothing; it is switched off on its
 * page.
 */
const ADVANCED: FormFieldCollapsibleSection<TracePipeline> =
  getAdvancedFormSection<TracePipeline>();

type GetPipelineRouteFunction = (item: TracePipeline) => Route;

const getPipelineRoute: GetPipelineRouteFunction = (
  item: TracePipeline,
): Route => {
  return new Route(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.TRACES_SETTINGS_PIPELINE_VIEW] as Route,
      {
        modelId: new ObjectID(item._id as string),
      },
    ).toString(),
  );
};

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
      saveFilterProps={{
        tableId: "trace-pipelines-table",
      }}
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
          collapsibleSection: ADVANCED,
        },
      ]}
      /*
       * Its filter and processors are what make a pipeline do anything,
       * and they are on its page: land there.
       */
      onCreateSuccess={(
        item: TracePipeline,
        modalType?: ModalType,
      ): Promise<TracePipeline> => {
        if (modalType === ModalType.Create && item._id) {
          Navigation.navigate(getPipelineRoute(item));
        }

        return Promise.resolve(item);
      }}
      showRefreshButton={true}
      searchableFields={["name", "description"]}
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
