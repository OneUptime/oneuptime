import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import LogPipeline from "Common/Models/DatabaseModels/LogPipeline";
import ProjectUtil from "Common/UI/Utils/Project";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const LogPipelines: FunctionComponent<PageComponentProps> = (): ReactElement => {
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
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Log Pipelines",
          description:
            "Configure server-side log processing pipelines that transform logs at ingest time. Pipelines run in sort order and apply processors to matching logs.",
        }}
        noItemsMessage={"No log pipelines found."}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SETTINGS_LOG_PIPELINE_VIEW] as Route,
        )}
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
          {
            field: {
              sortOrder: true,
            },
            title: "Sort Order",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "0",
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
            title: "Enabled",
            type: FieldType.Boolean,
          },
          {
            field: {
              sortOrder: true,
            },
            title: "Sort Order",
            type: FieldType.Number,
          },
        ]}
      />
    </Fragment>
  );
};

export default LogPipelines;
