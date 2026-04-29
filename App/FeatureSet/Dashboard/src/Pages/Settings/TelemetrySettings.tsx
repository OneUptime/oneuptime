import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const TelemetrySettings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <CardModelDetail
        name="Telemetry Data Retention"
        cardProps={{
          title: "Telemetry Data Retention",
          description:
            "Project-wide default for how long telemetry data (logs, traces, metrics) is retained. Individual services can override this by setting their own retention period.",
        }}
        isEditable={true}
        editButtonText="Edit Retention Settings"
        formFields={[
          {
            field: { defaultTelemetryRetentionInDays: true },
            title: "Default Retention (Days)",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            description:
              "Number of days to retain telemetry data for services that do not set their own retention period.",
            placeholder: "15",
            validation: {
              minValue: 1,
            },
          },
        ]}
        onSaveSuccess={() => {
          Navigation.reload();
        }}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-telemetry-retention",
          fields: [
            {
              field: { defaultTelemetryRetentionInDays: true },
              fieldType: FieldType.Number,
              title: "Default Retention (Days)",
              placeholder: "15",
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </Fragment>
  );
};

export default TelemetrySettings;
