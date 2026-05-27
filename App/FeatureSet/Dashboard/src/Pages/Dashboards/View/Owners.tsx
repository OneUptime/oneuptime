import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import DashboardOwnerTeam from "Common/Models/DatabaseModels/DashboardOwnerTeam";
import DashboardOwnerUser from "Common/Models/DatabaseModels/DashboardOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const DashboardOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<DashboardOwnerUser, DashboardOwnerTeam>
      resourceId={modelId}
      resourceIdField="dashboardId"
      resourceDisplayName="dashboard"
      ownerUserModelType={DashboardOwnerUser}
      ownerTeamModelType={DashboardOwnerTeam}
    />
  );
};

export default DashboardOwners;
