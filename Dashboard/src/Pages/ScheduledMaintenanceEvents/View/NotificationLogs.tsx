import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import NotificationLogsTabs from "../../../Components/NotificationLogs/NotificationLogsTabs";

const ScheduledMaintenanceNotificationLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <NotificationLogsTabs
      singularName="scheduled maintenance"
      queryKey="scheduledMaintenanceId"
    />
  );
};

export default ScheduledMaintenanceNotificationLogs;
