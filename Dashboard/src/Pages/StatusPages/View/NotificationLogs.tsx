import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import NotificationLogsTabs from "../../../Components/NotificationLogs/NotificationLogsTabs";

const StatusPageNotificationLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <NotificationLogsTabs singularName="status page" queryKey="statusPageId" />
  );
};

export default StatusPageNotificationLogs;
