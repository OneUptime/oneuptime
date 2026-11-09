import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who was added to or removed from this team, what it may do, and who
 * changed it, and when: every entry that rolls up to the team - its own,
 * its members' and its permissions'.
 */
const TeamAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Team Audit Logs"
      description="Every change made to this team, its members and its permissions: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default TeamAuditLogs;
