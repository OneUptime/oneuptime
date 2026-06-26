import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import PodmanHostOwnerTeam from "Common/Models/DatabaseModels/PodmanHostOwnerTeam";
import PodmanHostOwnerUser from "Common/Models/DatabaseModels/PodmanHostOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const PodmanHostOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<PodmanHostOwnerUser, PodmanHostOwnerTeam>
      resourceId={modelId}
      resourceIdField="podmanHostId"
      resourceDisplayName="Podman host"
      ownerUserModelType={PodmanHostOwnerUser}
      ownerTeamModelType={PodmanHostOwnerTeam}
    />
  );
};

export default PodmanHostOwners;
