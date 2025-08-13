import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import NotificationLogsTabs from "../../../Components/NotificationLogs/NotificationLogsTabs";

const AlertNotificationLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <NotificationLogsTabs singularName="alert" queryKey="alertId" />;
};

export default AlertNotificationLogs;
