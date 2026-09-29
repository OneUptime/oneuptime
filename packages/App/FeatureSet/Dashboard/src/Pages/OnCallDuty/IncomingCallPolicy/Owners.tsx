import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import IncomingCallPolicyOwnerTeam from "Common/Models/DatabaseModels/IncomingCallPolicyOwnerTeam";
import IncomingCallPolicyOwnerUser from "Common/Models/DatabaseModels/IncomingCallPolicyOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const IncomingCallPolicyOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<IncomingCallPolicyOwnerUser, IncomingCallPolicyOwnerTeam>
      resourceId={modelId}
      resourceIdField="incomingCallPolicyId"
      resourceDisplayName="incoming call policy"
      ownerUserModelType={IncomingCallPolicyOwnerUser}
      ownerTeamModelType={IncomingCallPolicyOwnerTeam}
    />
  );
};

export default IncomingCallPolicyOwners;
