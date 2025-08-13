import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import PageComponentProps from "../../PageComponentProps";

import ScheduledMaintenanceEmailLogs from "./NotificationLogsEmail";
import ScheduledMaintenanceSmsLogs from "./NotificationLogsSms";
import ScheduledMaintenanceCallLogs from "./NotificationLogsCall";
import ScheduledMaintenancePushLogs from "./NotificationLogsPush";
import ScheduledMaintenanceWorkspaceLogs from "./NotificationLogsWorkspace";

const ScheduledMaintenanceNotificationLogs: FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): ReactElement => {
  return (
    <div>
      <Tabs
        tabs={[
          {
            name: "Email",
            children: <ScheduledMaintenanceEmailLogs {...props} />,
          },
          { name: "SMS", children: <ScheduledMaintenanceSmsLogs {...props} /> },
          {
            name: "Call",
            children: <ScheduledMaintenanceCallLogs {...props} />,
          },
          {
            name: "Push",
            children: <ScheduledMaintenancePushLogs {...props} />,
          },
          {
            name: "Workspace",
            children: <ScheduledMaintenanceWorkspaceLogs {...props} />,
          },
        ]}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default ScheduledMaintenanceNotificationLogs;
