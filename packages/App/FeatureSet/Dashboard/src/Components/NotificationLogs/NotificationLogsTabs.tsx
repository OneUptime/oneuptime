import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import EmailLogsTable from "./EmailLogsTable";
import SmsLogsTable from "./SmsLogsTable";
import CallLogsTable from "./CallLogsTable";
import PushLogsTable from "./PushLogsTable";
import WorkspaceLogsTable from "./WorkspaceLogsTable";
import WhatsAppLogsTable from "./WhatsAppLogsTable";
import TelegramLogsTable from "./TelegramLogsTable";
import WebhookLogsTable from "./WebhookLogsTable";
import {
  NOTIFICATION_LOGS_TAB_NAMES,
  NOTIFICATION_LOGS_TAB_QUERY_PARAM,
  NotificationLogsTab,
  readNotificationLogsTab,
} from "./NotificationLogsTabQuery";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Types/Workflow/Components/BaseModel";
import Navigation from "Common/UI/Utils/Navigation";

export interface NotificationLogsTabsProps {
  singularName?: string; // e.g., "incident", "alert", "scheduled maintenance", "status page" - optional for global logs
  query?: Query<BaseModel>; // query object to filter logs - optional for global logs
}

const NotificationLogsTabs: FunctionComponent<NotificationLogsTabsProps> = (
  props: NotificationLogsTabsProps,
): ReactElement => {
  const commonProps: {
    query: Query<BaseModel>;
    singularName?: string;
  } = {
    ...(props.singularName && { singularName: props.singularName }),
    query: props.query || {},
  };

  /*
   * The tab the address asks for (?tab=sms: NotificationLogsTabQuery), as
   * the verify dialog's link to what became of a code opens it (#7374).
   */
  const requestedTab: NotificationLogsTab | null = readNotificationLogsTab(
    Navigation.getQueryStringByName(NOTIFICATION_LOGS_TAB_QUERY_PARAM),
  );

  return (
    <div>
      <Tabs
        label="Notification Logs"
        initialTabName={
          requestedTab ? NOTIFICATION_LOGS_TAB_NAMES[requestedTab] : undefined
        }
        tabs={[
          {
            name: "Email",
            children: <EmailLogsTable {...commonProps} />,
          },
          {
            name: "SMS",
            children: <SmsLogsTable {...commonProps} />,
          },
          {
            name: "WhatsApp",
            children: <WhatsAppLogsTable {...commonProps} />,
          },
          {
            name: "Telegram",
            children: <TelegramLogsTable {...commonProps} />,
          },
          {
            name: "Webhook",
            children: <WebhookLogsTable {...commonProps} />,
          },
          {
            name: "Call",
            children: <CallLogsTable {...commonProps} />,
          },
          {
            name: "Push",
            children: <PushLogsTable {...commonProps} />,
          },
          {
            name: "Workspace",
            children: <WorkspaceLogsTable {...commonProps} />,
          },
        ]}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default NotificationLogsTabs;
