import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import AlertEpisodeOwnerTeam from "Common/Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertEpisodeOwnerUser from "Common/Models/DatabaseModels/AlertEpisodeOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const AlertEpisodeOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<AlertEpisodeOwnerUser, AlertEpisodeOwnerTeam>
      resourceId={modelId}
      resourceIdField="alertEpisodeId"
      resourceDisplayName="alert episode"
      ownerUserModelType={AlertEpisodeOwnerUser}
      ownerTeamModelType={AlertEpisodeOwnerTeam}
    />
  );
};

export default AlertEpisodeOwners;
