import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
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
        isEditable={true}
        editButtonText="Edit Settings"
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
    </Fragment>
  );
};

export default DockerHostSettings;
