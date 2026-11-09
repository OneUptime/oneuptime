import PageComponentProps from "../../PageComponentProps";
import PublicNoteApprovalSettings from "../../../Components/PublicNoteApproval/PublicNoteApprovalSettings";
import { PublicNoteApprovalEventType } from "Common/Types/StatusPage/PublicNoteApproval";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Incidents > Settings > Public Note Approval: whether public notes on
 * incidents and episodes wait for approval before they are published, and
 * who approves them (PublicNoteApprovalSettings).
 */
const IncidentPublicNoteApproval: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <PublicNoteApprovalSettings
      eventType={PublicNoteApprovalEventType.Incident}
    />
  );
};

export default IncidentPublicNoteApproval;
