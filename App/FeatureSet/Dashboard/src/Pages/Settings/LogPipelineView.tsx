import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
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
import Navigation from "Common/UI/Utils/Navigation";
import LogPipeline from "Common/Models/DatabaseModels/LogPipeline";
import LogPipelineProcessor from "Common/Models/DatabaseModels/LogPipelineProcessor";
import FilterQueryBuilder from "../../Components/LogPipeline/FilterQueryBuilder";
import ProcessorForm from "../../Components/LogPipeline/ProcessorForm";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const LogPipelineView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [showProcessorForm, setShowProcessorForm] = useState<boolean>(false);
  const [refreshProcessorToggle, setRefreshProcessorToggle] =
    useState<string>("initial");

  return (
    <Fragment>
      {/* Section 1: Pipeline Details */}
      <CardModelDetail<LogPipeline>
        name="Log Pipeline Details"
        cardProps={{
          title: "Pipeline Details",
          description: "Basic information about this pipeline.",
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
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FieldType.Boolean,
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Section 2: Filter Conditions (Visual Builder) */}
      <FilterQueryBuilder pipelineId={modelId} />

      {/* Section 3: Processors */}
      {showProcessorForm ? (
        <ProcessorForm
          pipelineId={modelId}
          onProcessorCreated={() => {
            setShowProcessorForm(false);
            setRefreshProcessorToggle(Date.now().toString());
          }}
          onCancel={() => {
            setShowProcessorForm(false);
          }}
        />
      ) : (
        <ModelTable<LogPipelineProcessor>
          modelType={LogPipelineProcessor}
          query={{
            logPipelineId: modelId,
          }}
          id="log-pipeline-processors-table"
          name="Log Pipeline > Processors"
          userPreferencesKey="log-pipeline-processors-table"
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
              "Processors transform logs matched by this pipeline. They run in the order shown below. Drag to reorder.",
            buttons: [
              {
                title: "Add Processor",
                buttonStyle: ButtonStyleType.PRIMARY,
                onClick: () => {
                  setShowProcessorForm(true);
                },
                icon: IconProp.Add,
              },
            ],
          }}
          noItemsMessage={
            "No processors configured. Click 'Add Processor' above to add your first processor."
          }
          showRefreshButton={true}
          refreshToggle={refreshProcessorToggle}
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
      )}

      {/* Section 4: Delete Pipeline */}
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
