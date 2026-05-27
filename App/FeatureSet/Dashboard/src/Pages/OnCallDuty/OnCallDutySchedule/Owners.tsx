import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyScheduleOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import OnCallDutyPolicyScheduleOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const OnCallDutyScheduleOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<
      OnCallDutyPolicyScheduleOwnerUser,
      OnCallDutyPolicyScheduleOwnerTeam
    >
      resourceId={modelId}
      resourceIdField="onCallDutyPolicyScheduleId"
      resourceDisplayName="on-call schedule"
      ownerUserModelType={OnCallDutyPolicyScheduleOwnerUser}
      ownerTeamModelType={OnCallDutyPolicyScheduleOwnerTeam}
    />
  );
};

export default OnCallDutyScheduleOwners;
