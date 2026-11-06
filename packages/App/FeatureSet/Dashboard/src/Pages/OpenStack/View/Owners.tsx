import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import OpenStackCloudOwnerTeam from "Common/Models/DatabaseModels/OpenStackCloudOwnerTeam";
import OpenStackCloudOwnerUser from "Common/Models/DatabaseModels/OpenStackCloudOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const OpenStackCloudOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<OpenStackCloudOwnerUser, OpenStackCloudOwnerTeam>
      resourceId={modelId}
      resourceIdField="openStackCloudId"
      resourceDisplayName="OpenStack cloud"
      ownerUserModelType={OpenStackCloudOwnerUser}
      ownerTeamModelType={OpenStackCloudOwnerTeam}
    />
  );
};

export default OpenStackCloudOwners;
