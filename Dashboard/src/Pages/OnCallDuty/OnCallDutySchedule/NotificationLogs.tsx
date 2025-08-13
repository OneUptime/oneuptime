import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import NotificationLogsTabs from "../../../Components/NotificationLogs/NotificationLogsTabs";

const OnCallDutyScheduleNotificationLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <NotificationLogsTabs
      singularName="on-call schedule"
      queryKey="onCallDutyPolicyScheduleId"
    />
  );
};

export default OnCallDutyScheduleNotificationLogs;
