import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who connected or changed this repository, and when. What OneUptime AI
 * did in it is its Tasks.
 */
const CodeRepositoryAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Repository Audit Logs"
      description="Every change made to this repository: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default CodeRepositoryAuditLogs;
