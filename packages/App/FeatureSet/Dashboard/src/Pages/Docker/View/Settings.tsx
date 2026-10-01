import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const DockerHostSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<DockerHost>
        name="Host Settings"
        cardProps={{
          title: "Host Settings",
          description: "Manage settings for this Docker host.",
        }}
        modelDetailProps={{
          modelType: DockerHost,
          id: "docker-host-settings",
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
      <TelemetryResourceRetentionSettings<DockerHost>
        modelType={DockerHost}
        modelId={modelId}
        resourceName="Docker host"
        modelDetailIdPrefix="model-detail-docker-host"
      />
      <ArchiveResourceCard<DockerHost>
        modelType={DockerHost}
        modelId={modelId}
        singularName="host"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_HOSTS] as Route,
        )}
      />
    </Fragment>
  );
};

export default DockerHostSettings;
