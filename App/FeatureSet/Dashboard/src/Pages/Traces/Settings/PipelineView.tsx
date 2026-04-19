import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import { VoidFunction } from "Common/Types/FunctionTypes";
import TracePipeline from "Common/Models/DatabaseModels/TracePipeline";
import TracePipelineProcessor from "Common/Models/DatabaseModels/TracePipelineProcessor";
import FilterQueryBuilder from "../../../Components/FilterQueryBuilder/FilterQueryBuilder";
import TraceFilterConfig from "../../../Components/FilterQueryBuilder/TraceFilterConfig";
import TraceProcessorForm from "../../../Components/TracePipeline/TraceProcessorForm";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const processorsDocMarkdown: string = `
### How Processors Work

Processors are transformation steps that modify spans matched by this pipeline. They run **in order** — drag rows to reorder them.

---

### Processor Types

#### Attribute Remapper
Copy or rename a span attribute (e.g. rename \`http.user_agent\` to \`user_agent\`).

#### Span Name Remapper
Override the span name when a source field matches a value. Use \`name\` as the Source Key to match the current span name, or any attribute key to match on an attribute value.

#### Status Remapper
Override span status (Unset=0, Ok=1, Error=2) based on an attribute value.

#### Span Kind Remapper
Override span kind (Server / Client / Producer / Consumer / Internal) based on an attribute value.

#### Category Processor
Tag spans with a category attribute based on filter rules — first match wins.

---

### Tips
- **Order matters** — processors run sequentially.
- **Disable without deleting** — toggle a processor off to temporarily skip it.
`;

const TracePipelineView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [showProcessorForm, setShowProcessorForm] = useState<boolean>(false);
  const [editingProcessor, setEditingProcessor] = useState<
    TracePipelineProcessor | undefined
  >(undefined);
  const [refreshProcessorToggle, setRefreshProcessorToggle] =
    useState<string>("initial");

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
        isEditable={false}
        isCreateable={false}
        sortBy="sortOrder"
        sortOrder={SortOrder.Ascending}
        enableDragAndDrop={true}
        dragDropIndexField="sortOrder"
        cardProps={{
          title: "Processors",
          description:
            "Processors transform spans matched by this pipeline. They run in the order shown below. Drag to reorder.",
          buttons: [
            {
              title: "Add Processor",
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                setEditingProcessor(undefined);
                setShowProcessorForm(true);
              },
              icon: IconProp.Add,
            },
          ],
        }}
        helpContent={{
          title: "How Trace Processors Work",
          description:
            "Understanding AttributeRemapper, SpanNameRemapper, StatusRemapper, SpanKindRemapper, and CategoryProcessor",
          markdown: processorsDocMarkdown,
        }}
        noItemsMessage={
          "No processors configured. Click 'Add Processor' above to add your first processor."
        }
        showRefreshButton={true}
        refreshToggle={refreshProcessorToggle}
        actionButtons={[
          {
            title: "Edit",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Edit,
            onClick: async (
              item: TracePipelineProcessor,
              onCompleteAction: VoidFunction,
            ) => {
              setEditingProcessor(item);
              setShowProcessorForm(true);
              onCompleteAction();
            },
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

      {showProcessorForm && (
        <TraceProcessorForm
          pipelineId={modelId}
          existingProcessor={editingProcessor}
          onProcessorSaved={() => {
            setShowProcessorForm(false);
            setEditingProcessor(undefined);
            setRefreshProcessorToggle(Date.now().toString());
          }}
          onCancel={() => {
            setShowProcessorForm(false);
            setEditingProcessor(undefined);
          }}
        />
      )}

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
