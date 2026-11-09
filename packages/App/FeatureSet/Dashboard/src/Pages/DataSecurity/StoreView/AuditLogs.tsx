import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who changed this data store and its owners, and who gave a verdict on
 * what its scans found, and when: every entry that rolls up to the
 * store. Its issues have Audit Logs pages of their own.
 */
const DataStoreAuditLogsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Data Store Audit Logs"
      description="Every change made to this data store, its owners and the verdicts on its findings: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default DataStoreAuditLogsPage;
