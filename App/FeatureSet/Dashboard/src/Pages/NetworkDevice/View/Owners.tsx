import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import NetworkDeviceOwnerTeam from "Common/Models/DatabaseModels/NetworkDeviceOwnerTeam";
import NetworkDeviceOwnerUser from "Common/Models/DatabaseModels/NetworkDeviceOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const NetworkDeviceOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<NetworkDeviceOwnerUser, NetworkDeviceOwnerTeam>
      resourceId={modelId}
      resourceIdField="networkDeviceId"
      resourceDisplayName="network device"
      ownerUserModelType={NetworkDeviceOwnerUser}
      ownerTeamModelType={NetworkDeviceOwnerTeam}
    />
  );
};

export default NetworkDeviceOwners;
