import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import TechStack from "Common/Types/Service/TechStack";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import Service from "Common/Models/DatabaseModels/Service";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ResourceDetailsCard<Service>
        modelType={Service}
        modelId={modelId}
        id="service-details"
        title="Service Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Name",
          description:
            "Must match the service.name your service's telemetry reports. Telemetry is matched to this service by it: change it in your OpenTelemetry setup too, or the next report creates a new service.",
          placeholder: "checkout-api",
        }}
        descriptionField={{
          placeholder: "Description",
        }}
      />
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
          },
          {
            field: {
              techStack: true,
            },
            title: "Tech Stack",
            /*
             * Edited here only: the Overview's Service Details card is
             * read-only. Optional - left blank, the language detected from
             * the service's telemetry is shown instead.
             */
            description:
              "Optional. The language or framework used to build this service. Leave blank to use the language detected from this service's telemetry.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            required: false,
            placeholder: "Tech Stack",
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(TechStack),
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
          ],
          modelId: modelId,
        }}
      />
      <TelemetryResourceRetentionSettings<Service>
        modelType={Service}
        modelId={modelId}
        resourceName="service"
        modelDetailIdPrefix="model-detail-service"
      />
      <ArchiveResourceCard<Service>
        modelType={Service}
        modelId={modelId}
        singularName="service"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SERVICES] as Route,
        )}
      />
    </Fragment>
  );
};

export default ServiceSettings;
