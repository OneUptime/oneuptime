import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import EmailLogsTable from "./EmailLogsTable";
import SmsLogsTable from "./SmsLogsTable";
import CallLogsTable from "./CallLogsTable";
import PushLogsTable from "./PushLogsTable";
import WorkspaceLogsTable from "./WorkspaceLogsTable";

export interface NotificationLogsTabsProps {
  singularName?: string; // e.g., "incident", "alert", "scheduled maintenance", "status page" - optional for global logs
  query?: Record<string, any>; // query object to filter logs - optional for global logs
}

const NotificationLogsTabs: FunctionComponent<NotificationLogsTabsProps> = (
  props: NotificationLogsTabsProps,
): ReactElement => {

  const commonProps = {
    ...(props.singularName && { singularName: props.singularName }),
    query: props.query || {},
  };

  return (
    <div>
      <Tabs
        tabs={[
          {
            name: "Email",
            children: (
              <EmailLogsTable {...commonProps} />
            ),
          },
          {
            name: "SMS",
            children: (
              <SmsLogsTable {...commonProps} />
            ),
          },
          {
            name: "Call",
            children: (
              <CallLogsTable {...commonProps} />
            ),
          },
          {
            name: "Push",
            children: (
              <PushLogsTable {...commonProps} />
            ),
          },
          {
            name: "Workspace",
            children: (
              <WorkspaceLogsTable {...commonProps} />
            ),
          },
        ]}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default NotificationLogsTabs;
