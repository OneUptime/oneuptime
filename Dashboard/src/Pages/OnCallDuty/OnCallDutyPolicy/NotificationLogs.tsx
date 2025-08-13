import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import PageComponentProps from "../../PageComponentProps";

import OnCallDutyPolicyEmailLogs from "./NotificationLogsEmail";
import OnCallDutyPolicySmsLogs from "./NotificationLogsSms";
import OnCallDutyPolicyCallLogs from "./NotificationLogsCall";
import OnCallDutyPolicyPushLogs from "./NotificationLogsPush";
import OnCallDutyPolicyWorkspaceLogs from "./NotificationLogsWorkspace";

const OnCallDutyPolicyNotificationLogs: FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): ReactElement => {
  return (
    <div>
      <Tabs
        tabs={[
          {
            name: "Email",
            children: <OnCallDutyPolicyEmailLogs {...props} />,
          },
          { name: "SMS", children: <OnCallDutyPolicySmsLogs {...props} /> },
          { name: "Call", children: <OnCallDutyPolicyCallLogs {...props} /> },
          { name: "Push", children: <OnCallDutyPolicyPushLogs {...props} /> },
          {
            name: "Workspace",
            children: <OnCallDutyPolicyWorkspaceLogs {...props} />,
          },
        ]}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default OnCallDutyPolicyNotificationLogs;
