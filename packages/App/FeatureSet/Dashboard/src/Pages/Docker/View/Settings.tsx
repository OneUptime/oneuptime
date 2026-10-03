import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
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
      <ResourceDetailsCard<DockerHost>
        modelType={DockerHost}
        modelId={modelId}
        id="docker-host-details"
        title="Docker Host Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Display Name",
          description:
            "Shown everywhere this resource appears. Telemetry is not matched by the display name, so renaming is safe.",
          placeholder: "Production Docker host",
        }}
        descriptionField={{
          placeholder: "Production Docker host running in US East",
        }}
        identityFields={[
          {
            column: "hostIdentifier",
            title: "Host Name (host.name)",
            description:
              "Telemetry is matched by this host name. Change it only when the host reports a new one: telemetry that still reports the old name creates a new host.",
            placeholder: "docker-host-prod-1",
          },
        ]}
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
