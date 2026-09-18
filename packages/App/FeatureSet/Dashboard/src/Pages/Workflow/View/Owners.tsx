import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import WorkflowOwnerTeam from "Common/Models/DatabaseModels/WorkflowOwnerTeam";
import WorkflowOwnerUser from "Common/Models/DatabaseModels/WorkflowOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const WorkflowOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<WorkflowOwnerUser, WorkflowOwnerTeam>
      resourceId={modelId}
      resourceIdField="workflowId"
      resourceDisplayName="workflow"
      ownerUserModelType={WorkflowOwnerUser}
      ownerTeamModelType={WorkflowOwnerTeam}
    />
  );
};

export default WorkflowOwners;
