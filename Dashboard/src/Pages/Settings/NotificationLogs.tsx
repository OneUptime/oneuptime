import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import PageComponentProps from "../PageComponentProps";

// Reuse existing individual log pages as tab contents
import EmailLogs from "./EmailLog";
import SMSLogs from "./SmsLog";
import CallLogs from "./CallLog";
import PushLogs from "./PushLog";
import SettingsWorkspaceLog from "./WorkspaceLog";

const SettingsNotificationLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <div>
      <Tabs
        tabs={[
          {
            name: "Email",
            children: <EmailLogs {...props} />,
          },
          {
            name: "SMS",
            children: <SMSLogs {...props} />,
          },
          {
            name: "Call",
            children: <CallLogs {...props} />,
          },
          {
            name: "Push",
            children: <PushLogs {...props} />,
          },
          {
            name: "Workspace",
            children: <SettingsWorkspaceLog {...props} />,
          },
        ]}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default SettingsNotificationLogs;
