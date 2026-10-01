import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const IoTFleetSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<IoTFleet>
        name="Fleet Settings"
        cardProps={{
          title: "Fleet Settings",
          description: "Manage settings for this IoT fleet.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            description:
              "Name for this IoT fleet. This should match the iot.fleet.name resource attribute reported by your devices.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "building-a-sensors",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            description: "Friendly description for this IoT fleet.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Temperature sensors across Building A",
          },
        ]}
        modelDetailProps={{
          modelType: IoTFleet,
          id: "iot-fleet-settings",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
            },
          ],
        }}
      />
      <TelemetryResourceRetentionSettings<IoTFleet>
        modelType={IoTFleet}
        modelId={modelId}
        resourceName="IoT fleet"
        modelDetailIdPrefix="model-detail-iot-fleet"
      />
      <ArchiveResourceCard<IoTFleet>
        modelType={IoTFleet}
        modelId={modelId}
        singularName="fleet"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.IOT_FLEETS] as Route,
        )}
      />
    </Fragment>
  );
};

export default IoTFleetSettings;
