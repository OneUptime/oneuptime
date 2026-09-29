import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Navigation from "Common/UI/Utils/Navigation";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import TelemetryRetentionConfigForm from "Common/UI/Components/Telemetry/TelemetryRetentionConfigForm";
import TelemetryRetentionConfigSummary from "Common/UI/Components/Telemetry/TelemetryRetentionConfigSummary";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
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
          {
            field: {
              retainTelemetryDataForDays: true,
            },
            title: "Retain Telemetry Data For (Days)",
            description:
              "Default retention for telemetry collected from this Docker Swarm cluster. Leave blank to use the project's default.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "Use project default",
            validation: {
              minValue: 1,
            },
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
            {
              field: {
                retainTelemetryDataForDays: true,
              },
              title: "Retain Telemetry Data For (Days)",
              description:
                "Default retention for telemetry collected from this Docker Swarm cluster. Falls back to the project's default when not set.",
              fieldType: FieldType.Number,
              placeholder: "Using project default",
            },
          ],
        }}
      />
      <CardModelDetail<DockerSwarmCluster>
        name="Retention by Telemetry Type"
        cardProps={{
          title: "Retention by Telemetry Type",
          description:
            "Override retention for specific telemetry types for this Docker Swarm cluster. Any field left blank falls back to the cluster default, then the project's settings.",
        }}
        isEditable={true}
        editButtonText="Edit Overrides"
        createEditModalWidth={ModalWidth.Large}
        formFields={[
          {
            field: { telemetryRetentionConfig: true },
            title: "Retention Overrides",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              value: FormValues<DockerSwarmCluster>,
              props: CustomElementProps,
            ) => {
              return (
                <TelemetryRetentionConfigForm
                  {...props}
                  value={
                    value.telemetryRetentionConfig as
                      | TelemetryRetentionConfig
                      | undefined
                  }
                />
              );
            },
          },
        ]}
        modelDetailProps={{
          modelType: DockerSwarmCluster,
          id: "model-detail-docker-swarm-cluster-telemetry-retention-overrides",
          fields: [
            {
              field: { telemetryRetentionConfig: true },
              fieldType: FieldType.Element,
              title: "Retention Overrides",
              getElement: (item: DockerSwarmCluster) => {
                return (
                  <TelemetryRetentionConfigSummary
                    config={item.telemetryRetentionConfig}
                  />
                );
              },
            },
          ],
          modelId: modelId,
        }}
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
