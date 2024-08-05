import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import TelemetryIngestionKey from "Common/AppModels/Models/TelemetryIngestionKey";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const APIKeys: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<TelemetryIngestionKey>
        modelType={TelemetryIngestionKey}
        query={{
          projectId: DashboardNavigation.getProjectId()?.toString(),
        }}
        id="api-keys-table"
        name="Settings > Telemetry Ingestion Keys"
        isDeleteable={false}
        isEditable={false}
        showViewIdButton={false}
        isCreateable={true}
        isViewable={true}
        singularName="Ingestion Key"
        cardProps={{
          title: "Telemetry Ingestion Keys",
          description:
            "These keys are used to ingest telemetry data like Logs, Traces and Metrics for your project.",
        }}
        noItemsMessage={"No telemetry ingestion keys found."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Ingestion Key Name",
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
            required: true,
            placeholder: "Ingestion Key Description",
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
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
              description: true,
            },
            type: FieldType.Text,
            title: "Description",
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
            title: "Description",
            type: FieldType.Text,
          },
        ]}
      />
    </Fragment>
  );
};

export default APIKeys;
