import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const SloOwners: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<ServiceLevelObjectiveOwnerUser, ServiceLevelObjectiveOwnerTeam>
      resourceId={modelId}
      resourceIdField="serviceLevelObjectiveId"
      resourceDisplayName="SLO"
      ownerUserModelType={ServiceLevelObjectiveOwnerUser}
      ownerTeamModelType={ServiceLevelObjectiveOwnerTeam}
    />
  );
};

export default SloOwners;
