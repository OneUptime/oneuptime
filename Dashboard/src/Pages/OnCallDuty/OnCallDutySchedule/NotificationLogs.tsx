import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import PageComponentProps from "../../PageComponentProps";

import OnCallDutyScheduleEmailLogs from "./NotificationLogsEmail";
import OnCallDutyScheduleSmsLogs from "./NotificationLogsSms";
import OnCallDutyScheduleCallLogs from "./NotificationLogsCall";
import OnCallDutySchedulePushLogs from "./NotificationLogsPush";
import OnCallDutyScheduleWorkspaceLogs from "./NotificationLogsWorkspace";

const OnCallDutyScheduleNotificationLogs: FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): ReactElement => {
  return (
    <div>
      <Tabs
        tabs={[
          {
            name: "Email",
            children: <OnCallDutyScheduleEmailLogs {...props} />,
          },
          { name: "SMS", children: <OnCallDutyScheduleSmsLogs {...props} /> },
          { name: "Call", children: <OnCallDutyScheduleCallLogs {...props} /> },
          { name: "Push", children: <OnCallDutySchedulePushLogs {...props} /> },
          {
            name: "Workspace",
            children: <OnCallDutyScheduleWorkspaceLogs {...props} />,
          },
        ]}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default OnCallDutyScheduleNotificationLogs;
