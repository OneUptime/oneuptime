import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import HostOwnerTeam from "Common/Models/DatabaseModels/HostOwnerTeam";
import HostOwnerUser from "Common/Models/DatabaseModels/HostOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const HostOwners: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<HostOwnerUser, HostOwnerTeam>
      resourceId={modelId}
      resourceIdField="hostId"
      resourceDisplayName="host"
      ownerUserModelType={HostOwnerUser}
      ownerTeamModelType={HostOwnerTeam}
    />
  );
};

export default HostOwners;
