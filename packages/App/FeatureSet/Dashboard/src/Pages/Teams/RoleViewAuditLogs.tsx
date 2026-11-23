import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../Components/AuditLogs/AuditLogsTable";

/*
 * What a custom role gives, who changed it, and when: every entry that
 * rolls up to the role - its own and its permissions' - as a team's Audit
 * Logs page lists the team's (Pages/Teams/View/AuditLogs).
 */
const TeamRoleViewAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is roles/<modelId>/audit-logs, so the id is one segment back.
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
