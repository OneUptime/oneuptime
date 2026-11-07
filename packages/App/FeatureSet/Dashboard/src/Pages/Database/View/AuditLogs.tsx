import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who changed this database, its endpoints and its owners, and when: every
 * entry that rolls up to the database.
 */
const DatabaseServerAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Database Audit Logs"
      description="Every change made to this database, its endpoints and its owners: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default DatabaseServerAuditLogs;
