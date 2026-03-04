import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../PageComponentProps";
import NotificationLogsTabs from "../../Components/NotificationLogs/NotificationLogsTabs";

const SettingsNotificationLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <NotificationLogsTabs />;
};

export default SettingsNotificationLogs;
