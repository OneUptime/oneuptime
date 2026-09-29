import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import ProxmoxClusterOwnerTeam from "Common/Models/DatabaseModels/ProxmoxClusterOwnerTeam";
import ProxmoxClusterOwnerUser from "Common/Models/DatabaseModels/ProxmoxClusterOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const ProxmoxClusterOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<ProxmoxClusterOwnerUser, ProxmoxClusterOwnerTeam>
      resourceId={modelId}
      resourceIdField="proxmoxClusterId"
      resourceDisplayName="Proxmox cluster"
      ownerUserModelType={ProxmoxClusterOwnerUser}
      ownerTeamModelType={ProxmoxClusterOwnerTeam}
    />
  );
};

export default ProxmoxClusterOwners;
