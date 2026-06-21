import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import CephClusterOwnerTeam from "Common/Models/DatabaseModels/CephClusterOwnerTeam";
import CephClusterOwnerUser from "Common/Models/DatabaseModels/CephClusterOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const CephClusterOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<CephClusterOwnerUser, CephClusterOwnerTeam>
      resourceId={modelId}
      resourceIdField="cephClusterId"
      resourceDisplayName="Ceph cluster"
      ownerUserModelType={CephClusterOwnerUser}
      ownerTeamModelType={CephClusterOwnerTeam}
    />
  );
};

export default CephClusterOwners;
