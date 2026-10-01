import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const DockerSwarmClusterSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<DockerSwarmCluster>
        name="Cluster Settings"
        cardProps={{
          title: "Cluster Settings",
          description: "Manage settings for this Docker Swarm cluster.",
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
              "Name for this Docker Swarm cluster. This should match the docker.swarm.cluster.name resource attribute reported by the Docker Swarm Agent.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "swarm-production",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            description: "Friendly description for this Docker Swarm cluster.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production Docker Swarm cluster in US East",
          },
        ]}
        modelDetailProps={{
          modelType: DockerSwarmCluster,
          id: "docker-swarm-cluster-settings",
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
      <TelemetryResourceRetentionSettings<DockerSwarmCluster>
        modelType={DockerSwarmCluster}
        modelId={modelId}
        resourceName="Docker Swarm cluster"
        modelDetailIdPrefix="model-detail-docker-swarm-cluster"
      />
      <ArchiveResourceCard<DockerSwarmCluster>
        modelType={DockerSwarmCluster}
        modelId={modelId}
        singularName="cluster"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_SWARM_CLUSTERS] as Route,
        )}
      />
    </Fragment>
  );
};

export default DockerSwarmClusterSettings;
