import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import RunbookOwnerTeam from "Common/Models/DatabaseModels/RunbookOwnerTeam";
import RunbookOwnerUser from "Common/Models/DatabaseModels/RunbookOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const RunbookOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<RunbookOwnerUser, RunbookOwnerTeam>
      resourceId={modelId}
      resourceIdField="runbookId"
      resourceDisplayName="runbook"
      ownerUserModelType={RunbookOwnerUser}
      ownerTeamModelType={RunbookOwnerTeam}
    />
  );
};

export default RunbookOwners;
