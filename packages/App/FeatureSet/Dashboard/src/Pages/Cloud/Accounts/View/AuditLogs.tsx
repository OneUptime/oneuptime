import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who changed this cloud account in OneUptime, and when. What changed
 * in the cloud itself - its activity log - is the account's Changes.
 */
const CloudAccountAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Cloud Account Audit Logs"
      description="Every change made to this account in OneUptime: who made it, when, and what changed. What changed in the cloud itself is under Changes."
      rootResourceId={modelId}
    />
  );
};

export default CloudAccountAuditLogs;
