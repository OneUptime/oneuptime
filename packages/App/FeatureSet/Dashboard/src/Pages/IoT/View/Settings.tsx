import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
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
      <ResourceDetailsCard<IoTFleet>
        modelType={IoTFleet}
        modelId={modelId}
        id="iot-fleet-details"
        title="Fleet Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Name",
          description:
            "Must match the iot.fleet.name your devices report. Telemetry is matched to this fleet by it: rename it on the devices too, or their next report creates a new fleet.",
          placeholder: "field-sensors-us-east",
        }}
        descriptionField={{
          placeholder: "Production IoT fleet running in US East",
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
