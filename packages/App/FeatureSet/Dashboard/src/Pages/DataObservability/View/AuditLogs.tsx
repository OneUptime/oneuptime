import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who renamed this database, changed how it is reached, stopped watching
 * it or removed it from Data Observability, and when (#11147): every entry
 * that rolls up to its store, the same list Data Security's page of it
 * shows.
 */
const StoreAuditLogsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Database Audit Logs"
      description="Every change made to this database: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default StoreAuditLogsPage;
