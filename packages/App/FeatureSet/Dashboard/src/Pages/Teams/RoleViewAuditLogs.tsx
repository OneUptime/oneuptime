import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../Components/AuditLogs/AuditLogsTable";

/*
 * Who made this custom role, what it gives and who changed it, and when:
 * every entry that rolls up to the role - its own and its permissions'
 * (#10293), as a team's page lists its own.
 */
const TeamRoleViewAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Custom Role Audit Logs"
      description="Every change made to this custom role and its permissions: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default TeamRoleViewAuditLogs;
