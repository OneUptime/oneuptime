import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../../PageComponentProps";
import NotificationLogsTabs from "../../../../Components/NotificationLogs/NotificationLogsTabs";

const AnnouncementNotificationLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <NotificationLogsTabs singularName="announcement" queryKey="statusPageAnnouncementId" />
  );
};

export default AnnouncementNotificationLogs;
