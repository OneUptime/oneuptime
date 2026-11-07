import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who changed this table and its owners, and when: every entry that
 * rolls up to the table (a Data Asset). What its database's collection
 * found - columns, rows, size - is its Timeline, not this page.
 */
const TableAuditLogsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Table Audit Logs"
      description="Every change made to this table and its owners: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default TableAuditLogsPage;
