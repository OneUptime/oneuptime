import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const MonitorOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      <OwnersCard<MonitorOwnerUser, MonitorOwnerTeam>
        resourceId={modelId}
        resourceIdField="monitorId"
        resourceDisplayName="monitor"
        ownerUserModelType={MonitorOwnerUser}
        ownerTeamModelType={MonitorOwnerTeam}
      />
    </Fragment>
  );
};

export default MonitorOwners;
