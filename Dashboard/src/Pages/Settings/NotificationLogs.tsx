import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import PageComponentProps from "../PageComponentProps";
import EmailLogsTable from "../../Components/NotificationLogs/EmailLogsTable";
import SmsLogsTable from "../../Components/NotificationLogs/SmsLogsTable";
import CallLogsTable from "../../Components/NotificationLogs/CallLogsTable";
import PushLogsTable from "../../Components/NotificationLogs/PushLogsTable";
import WorkspaceLogsTable from "../../Components/NotificationLogs/WorkspaceLogsTable";

const SettingsEmailLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <EmailLogsTable />;
};

const SettingsSmsLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <SmsLogsTable />;
};

const SettingsCallLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <CallLogsTable />;
};

const SettingsPushLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <PushLogsTable />;
};


const SettingsWorkspaceLog: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <WorkspaceLogsTable />;
};

const SettingsNotificationLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <div>
      <Tabs
        tabs={[
          {
            name: "Email",
            children: <SettingsEmailLogs {...props} />,
          },
          {
            name: "SMS",
            children: <SettingsSmsLogs {...props} />,
          },
          {
            name: "Call",
            children: <SettingsCallLogs {...props} />,
          },
          {
            name: "Push",
            children: <SettingsPushLogs {...props} />,
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
