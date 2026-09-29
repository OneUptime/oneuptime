import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<IncidentOwnerUser, IncidentOwnerTeam>
      resourceId={modelId}
      resourceIdField="incidentId"
      resourceDisplayName="incident"
      ownerUserModelType={IncidentOwnerUser}
      ownerTeamModelType={IncidentOwnerTeam}
    />
  );
};

export default IncidentOwners;
