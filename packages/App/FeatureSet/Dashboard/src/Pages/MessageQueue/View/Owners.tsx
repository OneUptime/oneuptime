import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import MessageQueueOwnerTeam from "Common/Models/DatabaseModels/MessageQueueOwnerTeam";
import MessageQueueOwnerUser from "Common/Models/DatabaseModels/MessageQueueOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Who owns this queue. Owner rules (Queues → Settings → Owner Rules) assign
 * owners automatically; this page shows the result and lets people adjust
 * it by hand.
 */
const MessageQueueOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/owners, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<MessageQueueOwnerUser, MessageQueueOwnerTeam>
      resourceId={modelId}
      resourceIdField="messageQueueId"
      resourceDisplayName="queue"
      ownerUserModelType={MessageQueueOwnerUser}
      ownerTeamModelType={MessageQueueOwnerTeam}
    />
  );
};

export default MessageQueueOwners;
