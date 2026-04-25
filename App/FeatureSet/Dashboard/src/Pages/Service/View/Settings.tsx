import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import TechStack from "Common/Types/Service/TechStack";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import Service from "Common/Models/DatabaseModels/Service";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail
        name="Service Settings"
        cardProps={{
          title: "Service Settings",
          description: "Configure settings for your service.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              serviceColor: true,
            },
            title: "Service Color",
            description: "Choose a color for your service.",
            fieldType: FormFieldSchemaType.Color,
            required: true,
            placeholder: "15",
          },
          {
            field: {
              techStack: true,
            },
            title: "Tech Stack",
            description:
              "Tech stack used in the service. This will help other developers understand the service better.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            required: false,
            placeholder: "Tech Stack",
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(TechStack),
          },
          {
            field: {
              retainTelemetryDataForDays: true,
            },
            title: "Retain Telemetry Data For (Days)",
            description:
              "Number of days to retain telemetry data (logs, traces, metrics) for this service. Leave blank to use the project-wide default.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "Use project default",
            validation: {
              minValue: 1,
            },
          },
        ]}
        modelDetailProps={{
          modelType: Service,
          id: "model-detail-service",
          fields: [
            {
              field: {
                serviceColor: true,
              },
              title: "Service Color",
              description: "Color for your service.",
              fieldType: FieldType.Color,
            },
            {
              field: {
                techStack: true,
              },
              title: "Tech Stack",
              description:
                "Tech stack used in the service. This will help other developers understand the service better.",
              fieldType: FieldType.ArrayOfText,
            },
            {
              field: {
                retainTelemetryDataForDays: true,
              },
              title: "Retain Telemetry Data For (Days)",
              description:
                "Number of days telemetry data (logs, traces, metrics) is retained for this service. Falls back to the project-wide default when not set.",
              fieldType: FieldType.Number,
              placeholder: "Using project default",
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default ServiceSettings;
