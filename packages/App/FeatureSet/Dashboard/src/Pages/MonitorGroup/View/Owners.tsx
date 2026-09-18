import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import MonitorGroupOwnerTeam from "Common/Models/DatabaseModels/MonitorGroupOwnerTeam";
import MonitorGroupOwnerUser from "Common/Models/DatabaseModels/MonitorGroupOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const MonitorGroupOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<MonitorGroupOwnerUser, MonitorGroupOwnerTeam>
      resourceId={modelId}
      resourceIdField="monitorGroupId"
      resourceDisplayName="monitor group"
      ownerUserModelType={MonitorGroupOwnerUser}
      ownerTeamModelType={MonitorGroupOwnerTeam}
    />
  );
};

export default MonitorGroupOwners;
