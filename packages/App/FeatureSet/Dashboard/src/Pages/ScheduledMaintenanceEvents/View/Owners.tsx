import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const ScheduledMaintenanceOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<ScheduledMaintenanceOwnerUser, ScheduledMaintenanceOwnerTeam>
      resourceId={modelId}
      resourceIdField="scheduledMaintenanceId"
      resourceDisplayName="scheduled maintenance"
      ownerUserModelType={ScheduledMaintenanceOwnerUser}
      ownerTeamModelType={ScheduledMaintenanceOwnerTeam}
    />
  );
};

export default ScheduledMaintenanceOwners;
