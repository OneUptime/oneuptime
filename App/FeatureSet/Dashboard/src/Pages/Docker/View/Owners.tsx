import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import DockerHostOwnerTeam from "Common/Models/DatabaseModels/DockerHostOwnerTeam";
import DockerHostOwnerUser from "Common/Models/DatabaseModels/DockerHostOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const DockerHostOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<DockerHostOwnerUser, DockerHostOwnerTeam>
      resourceId={modelId}
      resourceIdField="dockerHostId"
      resourceDisplayName="Docker host"
      ownerUserModelType={DockerHostOwnerUser}
      ownerTeamModelType={DockerHostOwnerTeam}
    />
  );
};

export default DockerHostOwners;
