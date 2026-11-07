import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who changed this resource and its owners in OneUptime, and when: every
 * entry that rolls up to the resource. What changed in the cloud itself
 * is the resource's Changes.
 */
const CloudResourceAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Resource Audit Logs"
      description="Every change made to this resource and its owners in OneUptime: who made it, when, and what changed. What changed in the cloud itself is under Changes."
      rootResourceId={modelId}
    />
  );
};

export default CloudResourceAuditLogs;
