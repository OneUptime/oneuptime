import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import KubernetesClusterOwnerTeam from "Common/Models/DatabaseModels/KubernetesClusterOwnerTeam";
import KubernetesClusterOwnerUser from "Common/Models/DatabaseModels/KubernetesClusterOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const KubernetesClusterOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<KubernetesClusterOwnerUser, KubernetesClusterOwnerTeam>
      resourceId={modelId}
      resourceIdField="kubernetesClusterId"
      resourceDisplayName="Kubernetes cluster"
      ownerUserModelType={KubernetesClusterOwnerUser}
      ownerTeamModelType={KubernetesClusterOwnerTeam}
    />
  );
};

export default KubernetesClusterOwners;
