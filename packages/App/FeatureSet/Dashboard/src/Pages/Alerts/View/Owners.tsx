import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import AlertOwnerTeam from "Common/Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "Common/Models/DatabaseModels/AlertOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const AlertOwners: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<AlertOwnerUser, AlertOwnerTeam>
      resourceId={modelId}
      resourceIdField="alertId"
      resourceDisplayName="alert"
      ownerUserModelType={AlertOwnerUser}
      ownerTeamModelType={AlertOwnerTeam}
    />
  );
};

export default AlertOwners;
