import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import VMwareVCenterOwnerTeam from "Common/Models/DatabaseModels/VMwareVCenterOwnerTeam";
import VMwareVCenterOwnerUser from "Common/Models/DatabaseModels/VMwareVCenterOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const VMwareVCenterOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<VMwareVCenterOwnerUser, VMwareVCenterOwnerTeam>
      resourceId={modelId}
      resourceIdField="vmwareVCenterId"
      resourceDisplayName="vCenter"
      ownerUserModelType={VMwareVCenterOwnerUser}
      ownerTeamModelType={VMwareVCenterOwnerTeam}
    />
  );
};

export default VMwareVCenterOwners;
