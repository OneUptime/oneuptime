import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who changed this site and the rules that assign devices to it, and
 * when: every entry that rolls up to the site.
 */
const NetworkSiteAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Site Audit Logs"
      description="Every change made to this site and the rules that assign devices to it: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default NetworkSiteAuditLogs;
