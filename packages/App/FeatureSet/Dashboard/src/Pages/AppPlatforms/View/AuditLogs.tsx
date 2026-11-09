import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who changed this environment and its owners, and when: every entry
 * that rolls up to the environment (a CloudResource row, as a cloud
 * resource's page reads it too).
 */
const AppPlatformEnvironmentAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Environment Audit Logs"
      description="Every change made to this environment and its owners: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default AppPlatformEnvironmentAuditLogs;
