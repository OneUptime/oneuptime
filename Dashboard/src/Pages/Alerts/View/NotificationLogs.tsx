import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import PageComponentProps from "../../PageComponentProps";

import AlertViewNotificationLogsEmail from "./NotificationLogsEmail";
import AlertSmsLogs from "./NotificationLogsSms";
import AlertViewNotificationLogsCall from "./NotificationLogsCall";
import AlertViewNotificationLogsPush from "./NotificationLogsPush";
import AlertWorkspaceLogs from "./NotificationLogsWorkspace";

const AlertNotificationLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <div>
      <Tabs
        tabs={[
          { name: "Email", children: <AlertViewNotificationLogsEmail {...props} /> },
          { name: "SMS", children: <AlertSmsLogs {...props} /> },
          { name: "Call", children: <AlertViewNotificationLogsCall {...props} /> },
          { name: "Push", children: <AlertViewNotificationLogsPush {...props} /> },
          { name: "Workspace", children: <AlertWorkspaceLogs {...props} /> },
        ]}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default AlertNotificationLogs;
