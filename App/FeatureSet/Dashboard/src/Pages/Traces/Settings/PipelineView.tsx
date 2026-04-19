import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import TracePipeline from "Common/Models/DatabaseModels/TracePipeline";
import TracePipelineProcessor from "Common/Models/DatabaseModels/TracePipelineProcessor";
import TracePipelineProcessorType from "Common/Types/Trace/TracePipelineProcessorType";
import FilterQueryBuilder from "../../../Components/FilterQueryBuilder/FilterQueryBuilder";
import TraceFilterConfig from "../../../Components/FilterQueryBuilder/TraceFilterConfig";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const attributeRemapperExample: string = JSON.stringify(
  {
    sourceKey: "http.user_agent",
    targetKey: "user_agent",
    preserveSource: false,
    overrideOnConflict: true,
  },
  null,
  2,
);

const spanNameRemapperExample: string = JSON.stringify(
  {
    sourceKey: "http.route",
    mappings: [
      { matchValue: "/api/v1/users", newName: "ListUsers" },
      { matchValue: "/api/v1/users/:id", newName: "GetUser" },
    ],
  },
  null,
  2,
);

const statusRemapperExample: string = JSON.stringify(
  {
    sourceKey: "http.status_code",
    mappings: [
      { matchValue: "500", statusCode: 2, statusMessage: "Internal Error" },
      { matchValue: "200", statusCode: 1 },
    ],
  },
  null,
  2,
);

const spanKindRemapperExample: string = JSON.stringify(
  {
    sourceKey: "messaging.operation",
    mappings: [
      { matchValue: "publish", kind: "SPAN_KIND_PRODUCER" },
      { matchValue: "process", kind: "SPAN_KIND_CONSUMER" },
    ],
  },
  null,
  2,
);

const categoryProcessorExample: string = JSON.stringify(
  {
    targetKey: "span_category",
    categories: [
      { name: "Slow Request", filterQuery: "durationUnixNano > 1000000000" },
      { name: "Error", filterQuery: "statusCode = '2'" },
    ],
  },
  null,
  2,
);

const processorDocMarkdown: string = `
### Processor Types

Pick a processor type, then set the \`configuration\` JSON to match the shape below.

#### AttributeRemapper
Copy or rename a span attribute.

\`\`\`json
${attributeRemapperExample}
\`\`\`

#### SpanNameRemapper
Override the span name when a source field matches a value. \`sourceKey\` can be \`"name"\` or any attribute key.

\`\`\`json
${spanNameRemapperExample}
\`\`\`

#### StatusRemapper
Override span status (0=Unset, 1=Ok, 2=Error) based on an attribute value.

\`\`\`json
${statusRemapperExample}
\`\`\`

#### SpanKindRemapper
Override span kind (SPAN_KIND_SERVER / CLIENT / PRODUCER / CONSUMER / INTERNAL).

\`\`\`json
${spanKindRemapperExample}
\`\`\`

#### CategoryProcessor
Tag spans with a category attribute based on filter rules (first match wins).

\`\`\`json
${categoryProcessorExample}
\`\`\`
`;

const TracePipelineView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* Section 1: Pipeline Details */}
      <CardModelDetail<TracePipeline>
        name="Trace Pipeline Details"
        cardProps={{
          title: "Pipeline Details",
          description: "Basic information about this pipeline.",
        }}
        isEditable={true}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Pipeline Name",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Describe what this pipeline does.",
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          modelType: TracePipeline,
          id: "model-detail-trace-pipeline",
          fields: [
            { field: { name: true }, title: "Name" },
            { field: { description: true }, title: "Description" },
            {
              field: { isEnabled: true },
              title: "Status",
              fieldType: FieldType.Boolean,
              getElement: (item: TracePipeline): ReactElement => {
                if (item.isEnabled) {
                  return (
                    <Pill color={Green} text="Enabled" icon={IconProp.Check} />
                  );
                }
                return (
                  <Pill color={Red} text="Disabled" icon={IconProp.Close} />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Section 2: Filter Conditions (Visual Builder) */}
      <FilterQueryBuilder
        modelType={TracePipeline}
        modelId={modelId}
        config={TraceFilterConfig}
        title="Filter Conditions"
        description="Define which spans this pipeline applies to. Only spans that match these conditions will be processed. Leave empty to match all spans."
      />

      {/* Section 3: Processors */}
      <ModelTable<TracePipelineProcessor>
        modelType={TracePipelineProcessor}
        query={{
          tracePipelineId: modelId,
        }}
        id="trace-pipeline-processors-table"
        name="Trace Pipeline > Processors"
        userPreferencesKey="trace-pipeline-processors-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        sortBy="sortOrder"
        sortOrder={SortOrder.Ascending}
        enableDragAndDrop={true}
        dragDropIndexField="sortOrder"
        cardProps={{
          title: "Processors",
          description:
            "Processors transform spans matched by this pipeline. They run in the order shown below. Drag to reorder.",
        }}
        helpContent={{
          title: "How Trace Processors Work",
          description:
            "Understanding AttributeRemapper, SpanNameRemapper, StatusRemapper, SpanKindRemapper, and CategoryProcessor",
          markdown: processorDocMarkdown,
        }}
        noItemsMessage={
          "No processors configured. Click 'Create' above to add your first processor."
        }
        showRefreshButton={true}
        createInitialValues={{
          tracePipelineId: modelId,
          isEnabled: true,
        }}
        onBeforeCreate={async (item: TracePipelineProcessor) => {
          item.tracePipelineId = modelId;
          if (!item.sortOrder) {
            item.sortOrder = 1;
          }
          return item;
        }}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Normalize HTTP route names",
            validation: { minLength: 2 },
          },
          {
            field: { processorType: true },
            title: "Processor Type",
            description: "The kind of transformation this processor applies.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: [
              {
                label: "Attribute Remapper",
                value: TracePipelineProcessorType.AttributeRemapper,
              },
              {
                label: "Span Name Remapper",
                value: TracePipelineProcessorType.SpanNameRemapper,
              },
              {
                label: "Status Remapper",
                value: TracePipelineProcessorType.StatusRemapper,
              },
              {
                label: "Span Kind Remapper",
                value: TracePipelineProcessorType.SpanKindRemapper,
              },
              {
                label: "Category Processor",
                value: TracePipelineProcessorType.CategoryProcessor,
              },
            ],
          },
          {
            field: { configuration: true },
            title: "Configuration (JSON)",
            description:
              "Processor-specific config. See the Help panel for the shape of each type.",
            fieldType: FormFieldSchemaType.JSON,
            required: true,
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        filters={[
          {
            field: { name: true },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: { processorType: true },
            type: FieldType.Text,
            title: "Type",
          },
          {
            field: { isEnabled: true },
            type: FieldType.Boolean,
            title: "Enabled",
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { processorType: true },
            title: "Type",
            type: FieldType.Text,
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
      />

      {/* Section 4: Delete Pipeline */}
      <ModelDelete
        modelType={TracePipeline}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.TRACES_SETTINGS_PIPELINES] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default TracePipelineView;
