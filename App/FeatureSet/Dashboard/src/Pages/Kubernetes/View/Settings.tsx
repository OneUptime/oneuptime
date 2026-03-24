import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const KubernetesClusterSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<KubernetesCluster>
        name="Cluster Settings"
        cardProps={{
          title: "Cluster Settings",
          description: "Manage settings for this Kubernetes cluster.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        modelDetailProps={{
          modelType: KubernetesCluster,
          id: "kubernetes-cluster-settings",
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
                clusterIdentifier: true,
              },
              title: "Cluster Identifier",
              fieldType: FieldType.Text,
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default KubernetesClusterSettings;
