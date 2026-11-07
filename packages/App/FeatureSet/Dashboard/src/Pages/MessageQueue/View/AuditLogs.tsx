import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who changed this queue, and what belongs to it (its owners), and when.
 * Every entry that rolls up to the queue: the queue's own and its owners'.
 */
const MessageQueueAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Queue Audit Logs"
      description="Every change made to this queue and its owners: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default MessageQueueAuditLogs;
