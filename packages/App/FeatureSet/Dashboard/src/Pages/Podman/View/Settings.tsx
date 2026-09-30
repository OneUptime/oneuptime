import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const PodmanHostSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<PodmanHost>
        name="Host Settings"
        cardProps={{
          title: "Host Settings",
          description: "Manage settings for this Podman host.",
        }}
        modelDetailProps={{
          modelType: PodmanHost,
          id: "podman-host-settings",
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
            {
              field: {
                hostIdentifier: true,
              },
              title: "Host Identifier",
              fieldType: FieldType.Text,
            },
          ],
        }}
      />
      <TelemetryResourceRetentionSettings<PodmanHost>
        modelType={PodmanHost}
        modelId={modelId}
        resourceName="Podman host"
        modelDetailIdPrefix="model-detail-podman-host"
      />
      <ArchiveResourceCard<PodmanHost>
        modelType={PodmanHost}
        modelId={modelId}
        singularName="host"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.PODMAN_HOSTS] as Route,
        )}
      />
    </Fragment>
  );
};

export default PodmanHostSettings;
