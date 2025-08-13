import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import NotificationLogsTabs from "../../../Components/NotificationLogs/NotificationLogsTabs";

const IncidentNotificationLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <NotificationLogsTabs singularName="incident" queryKey="incidentId" />
  );
};

export default IncidentNotificationLogs;
