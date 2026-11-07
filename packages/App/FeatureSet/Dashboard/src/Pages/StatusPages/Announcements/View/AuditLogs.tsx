import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who wrote, changed or rescheduled this announcement, and when. Who it
 * was sent to is its Notification Logs.
 */
const AnnouncementViewAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Announcement Audit Logs"
      description="Every change made to this announcement: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default AnnouncementViewAuditLogs;
