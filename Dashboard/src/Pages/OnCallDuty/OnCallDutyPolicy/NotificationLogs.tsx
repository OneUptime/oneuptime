import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import NotificationLogsTabs from "../../../Components/NotificationLogs/NotificationLogsTabs";

const OnCallDutyPolicyNotificationLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <NotificationLogsTabs
      singularName="on-call policy"
      queryKey="onCallDutyPolicyId"
    />
  );
};

export default OnCallDutyPolicyNotificationLogs;
