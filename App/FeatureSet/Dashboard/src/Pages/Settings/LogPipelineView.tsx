import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import LogPipeline from "Common/Models/DatabaseModels/LogPipeline";
import LogPipelineProcessor from "Common/Models/DatabaseModels/LogPipelineProcessor";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const LogPipelineView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      <CardModelDetail<LogPipeline>
        name="Log Pipeline Details"
        cardProps={{
          title: "Log Pipeline Details",
          description: "Details for this log pipeline.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Pipeline Name",
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
            placeholder: "Pipeline Description",
          },
          {
            field: {
              filterQuery: true,
            },
            title: "Filter Query",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "e.g. severityText = 'ERROR' AND attributes.service = 'api'",
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
        modelDetailProps={{
          modelType: LogPipeline,
          id: "model-detail-log-pipeline",
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
            {
              field: {
                filterQuery: true,
              },
              title: "Filter Query",
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FieldType.Boolean,
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelTable<LogPipelineProcessor>
        modelType={LogPipelineProcessor}
        query={{
          logPipelineId: modelId,
        }}
        id="log-pipeline-processors-table"
        name="Log Pipeline > Processors"
        userPreferencesKey="log-pipeline-processors-table"
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
            "Processors transform logs matched by this pipeline. They run in the order shown below. Drag to reorder.",
        }}
        noItemsMessage={"No processors configured for this pipeline."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Remap severity",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              processorType: true,
            },
            title: "Processor Type",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: [
              {
                label: "Severity Remapper",
                value: "SeverityRemapper",
              },
              {
                label: "Attribute Remapper",
                value: "AttributeRemapper",
              },
              {
                label: "Category Processor",
                value: "CategoryProcessor",
              },
            ],
          },
          {
            field: {
              configuration: true,
            },
            title: "Configuration (JSON)",
            fieldType: FormFieldSchemaType.JSON,
            required: true,
            description:
              'SeverityRemapper: {"sourceKey":"level","mappings":[{"matchValue":"warn","severityText":"WARNING","severityNumber":13}]} — AttributeRemapper: {"sourceKey":"src","targetKey":"dst","preserveSource":false} — CategoryProcessor: {"targetKey":"category","categories":[{"name":"Error","filterQuery":"severityText = \'ERROR\'"}]}',
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
        createInitialValues={{
          logPipelineId: modelId,
        }}
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
              processorType: true,
            },
            title: "Type",
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
      />

      <ModelDelete
        modelType={LogPipeline}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteMap[PageMap.SETTINGS_LOG_PIPELINES] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default LogPipelineView;
