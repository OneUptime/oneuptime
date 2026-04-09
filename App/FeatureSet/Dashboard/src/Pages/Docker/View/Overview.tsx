import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const DockerHostOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<DockerHost>
        name="Docker Host Details"
        cardProps={{
          title: "Docker Host Details",
          description: "Overview of this Docker host.",
        }}
        isEditable={true}
        editButtonText="Edit Host"
        modelDetailProps={{
          modelType: DockerHost,
          id: "docker-host-details",
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
            {
              field: {
                otelCollectorStatus: true,
              },
              title: "Collector Status",
              fieldType: FieldType.Text,
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                containersRunning: true,
              },
              title: "Containers Running",
              fieldType: FieldType.Number,
            },
            {
              field: {
                containersStopped: true,
              },
              title: "Containers Stopped",
              fieldType: FieldType.Number,
            },
            {
              field: {
                containersPaused: true,
              },
              title: "Containers Paused",
              fieldType: FieldType.Number,
            },
            {
              field: {
                osType: true,
              },
              title: "OS Type",
              fieldType: FieldType.Text,
            },
            {
              field: {
                osVersion: true,
              },
              title: "OS Version",
              fieldType: FieldType.Text,
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: DockerHost): ReactElement => {
                return (
                  <LabelsElement
                    labels={item["labels"] as Array<Label>}
                  />
                );
              },
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default DockerHostOverview;
