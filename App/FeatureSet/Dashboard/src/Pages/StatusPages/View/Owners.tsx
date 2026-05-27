import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import StatusPageOwnerTeam from "Common/Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Common/Models/DatabaseModels/StatusPageOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const StatusPageOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<StatusPageOwnerUser, StatusPageOwnerTeam>
      resourceId={modelId}
      resourceIdField="statusPageId"
      resourceDisplayName="status page"
      ownerUserModelType={StatusPageOwnerUser}
      ownerTeamModelType={StatusPageOwnerTeam}
    />
  );
};

export default StatusPageOwners;
