import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who accepted, assigned or resolved this issue, and when. What the
 * checks found and said about it is its Timeline.
 */
const DataSecurityIssueAuditLogsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Issue Audit Logs"
      description="Every change made to this issue: who accepted, assigned or resolved it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default DataSecurityIssueAuditLogsPage;
