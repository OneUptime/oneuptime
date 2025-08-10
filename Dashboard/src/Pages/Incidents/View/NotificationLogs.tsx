import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import PageComponentProps from "../../PageComponentProps";

import IncidentEmailLogs from "./NotificationLogsEmail";
import IncidentSmsLogs from "./NotificationLogsSms";
import IncidentCallLogs from "./NotificationLogsCall";
import IncidentPushLogs from "./NotificationLogsPush";
import IncidentWorkspaceLogs from "./NotificationLogsWorkspace";

const IncidentNotificationLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <div>
      <Tabs
        tabs={[
          { name: "Email", children: <IncidentEmailLogs {...props} /> },
          { name: "SMS", children: <IncidentSmsLogs {...props} /> },
          { name: "Call", children: <IncidentCallLogs {...props} /> },
          { name: "Push", children: <IncidentPushLogs {...props} /> },
          { name: "Workspace", children: <IncidentWorkspaceLogs {...props} /> },
        ]}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default IncidentNotificationLogs;
