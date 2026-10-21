import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import StorageArrayOwnerTeam from "Common/Models/DatabaseModels/StorageArrayOwnerTeam";
import StorageArrayOwnerUser from "Common/Models/DatabaseModels/StorageArrayOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const StorageArrayOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<StorageArrayOwnerUser, StorageArrayOwnerTeam>
      resourceId={modelId}
      resourceIdField="storageArrayId"
      resourceDisplayName="storage array"
      ownerUserModelType={StorageArrayOwnerUser}
      ownerTeamModelType={StorageArrayOwnerTeam}
    />
  );
};

export default StorageArrayOwners;
