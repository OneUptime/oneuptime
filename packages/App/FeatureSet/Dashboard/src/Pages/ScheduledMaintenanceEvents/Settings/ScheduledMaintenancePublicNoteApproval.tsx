import PageComponentProps from "../../PageComponentProps";
import PublicNoteApprovalSettings from "../../../Components/PublicNoteApproval/PublicNoteApprovalSettings";
import { PublicNoteApprovalEventType } from "Common/Types/StatusPage/PublicNoteApproval";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Scheduled Maintenance > Settings > Public Note Approval: whether public
 * notes on scheduled maintenance events wait for approval before they are
 * published, and who approves them (PublicNoteApprovalSettings).
 */
const ScheduledMaintenancePublicNoteApproval: FunctionComponent<
  PageComponentProps
> = (_props: PageComponentProps): ReactElement => {
  return (
    <PublicNoteApprovalSettings
      eventType={PublicNoteApprovalEventType.ScheduledMaintenance}
    />
  );
};

export default ScheduledMaintenancePublicNoteApproval;
