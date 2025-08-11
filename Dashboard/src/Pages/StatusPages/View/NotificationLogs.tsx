import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import PageComponentProps from "../../PageComponentProps";

import StatusPageViewNotificationLogsEmail from "./NotificationLogsEmail";
import StatusPageViewNotificationLogsSms from "./NotificationLogsSms";
import StatusPageViewNotificationLogsCall from "./NotificationLogsCall";
import StatusPageViewNotificationLogsPush from "./NotificationLogsPush";
import StatusPageViewNotificationLogsWorkspace from "./NotificationLogsWorkspace";

const StatusPageNotificationLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <div>
      <Tabs
        tabs={[
          {
            name: "Email",
            children: <StatusPageViewNotificationLogsEmail {...props} />,
          },
          { name: "SMS", children: <StatusPageViewNotificationLogsSms {...props} /> },
          {
            name: "Call",
            children: <StatusPageViewNotificationLogsCall {...props} />,
          },
          {
            name: "Push",
            children: <StatusPageViewNotificationLogsPush {...props} />,
          },
          {
            name: "Workspace",
            children: <StatusPageViewNotificationLogsWorkspace {...props} />,
          },
        ]}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default StatusPageNotificationLogs;
