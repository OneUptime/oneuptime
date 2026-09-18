import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const OnCallDutyPolicyOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<OnCallDutyPolicyOwnerUser, OnCallDutyPolicyOwnerTeam>
      resourceId={modelId}
      resourceIdField="onCallDutyPolicyId"
      resourceDisplayName="on-call duty policy"
      ownerUserModelType={OnCallDutyPolicyOwnerUser}
      ownerTeamModelType={OnCallDutyPolicyOwnerTeam}
    />
  );
};

export default OnCallDutyPolicyOwners;
