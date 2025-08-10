import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import PageComponentProps from "../../../PageComponentProps";

import AnnouncementEmailLogs from "./NotificationLogsEmail";
import AnnouncementSmsLogs from "./NotificationLogsSms";
import AnnouncementCallLogs from "./NotificationLogsCall";
import AnnouncementPushLogs from "./NotificationLogsPush";
import AnnouncementWorkspaceLogs from "./NotificationLogsWorkspace";

const AnnouncementNotificationLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <div>
      <Tabs
        tabs={[
          { name: "Email", children: <AnnouncementEmailLogs {...props} /> },
          { name: "SMS", children: <AnnouncementSmsLogs {...props} /> },
          { name: "Call", children: <AnnouncementCallLogs {...props} /> },
          { name: "Push", children: <AnnouncementPushLogs {...props} /> },
          { name: "Workspace", children: <AnnouncementWorkspaceLogs {...props} /> },
        ]}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default AnnouncementNotificationLogs;
