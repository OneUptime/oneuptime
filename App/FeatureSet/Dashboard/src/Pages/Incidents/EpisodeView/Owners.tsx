import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import IncidentEpisodeOwnerTeam from "Common/Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "Common/Models/DatabaseModels/IncidentEpisodeOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentEpisodeOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<IncidentEpisodeOwnerUser, IncidentEpisodeOwnerTeam>
      resourceId={modelId}
      resourceIdField="incidentEpisodeId"
      resourceDisplayName="incident episode"
      ownerUserModelType={IncidentEpisodeOwnerUser}
      ownerTeamModelType={IncidentEpisodeOwnerTeam}
    />
  );
};

export default IncidentEpisodeOwners;
