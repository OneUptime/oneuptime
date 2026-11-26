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
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";
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
Processors are the steps this pipeline runs on every span it matches, in order, each on what the one before it left. Drag a processor to change its place, and turn one off to skip it without deleting it.

## Attribute Remapper

Renames or copies a span attribute, such as \`http.user_agent\` to \`user_agent\`.

## Span Name Remapper

Rewrites a span's name when a field has a value. Use \`name\` as the **Source Key** to match on the span's current name, or any attribute key to match on that attribute's value.

## Status Remapper

Sets a span's status from an attribute's value: Unset (0), Ok (1) or Error (2).

## Span Kind Remapper

Sets a span's kind from an attribute's value: Server, Client, Producer, Consumer or Internal.

## Category Processor

Writes a category to an attribute. Its categories are checked in order, and the first one whose filter a span matches is written.
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
                return <Pill tone={PillTone.Paused} text="Disabled" />;
              },
            },
            {
              // The pipeline's line: its ID, who created it and who last changed it.
              field: { _id: true },
              title: "ID",
              fieldType: FieldType.ObjectID,
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
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        query={{
          tracePipelineId: modelId,
        }}
        id="trace-pipeline-processors-table"
        name="Trace Pipeline > Processors"
        userPreferencesKey="trace-pipeline-processors-table"
        saveFilterProps={{
          tableId: "trace-pipeline-processors-table",
        }}
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
              phoneTitle: "Add",
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
            "The steps this pipeline runs on every span it matches, in order.",
          markdown: processorsDocMarkdown,
        }}
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
