import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import DockerSwarmClusterOwnerTeam from "Common/Models/DatabaseModels/DockerSwarmClusterOwnerTeam";
import DockerSwarmClusterOwnerUser from "Common/Models/DatabaseModels/DockerSwarmClusterOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const DockerSwarmClusterOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<DockerSwarmClusterOwnerUser, DockerSwarmClusterOwnerTeam>
      resourceId={modelId}
      resourceIdField="dockerSwarmClusterId"
      resourceDisplayName="Docker Swarm cluster"
      ownerUserModelType={DockerSwarmClusterOwnerUser}
      ownerTeamModelType={DockerSwarmClusterOwnerTeam}
    />
  );
};

export default DockerSwarmClusterOwners;
