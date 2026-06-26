import UserCall from "../../Components/NotificationMethods/Call";
import UserEmail from "../../Components/NotificationMethods/Email";
import UserPush from "../../Components/NotificationMethods/Push";
import UserSMS from "../../Components/NotificationMethods/SMS";
import UserTelegram from "../../Components/NotificationMethods/Telegram";
import UserWebhook from "../../Components/NotificationMethods/Webhook";
import UserWhatsApp from "../../Components/NotificationMethods/WhatsApp";
import PageComponentProps from "../PageComponentProps";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <Tabs
        tabs={[
          {
            name: "Direct Contact",
            children: (
              <div className="space-y-4">
                <UserEmail />
                <UserSMS />
                <UserCall />
                <UserWhatsApp />
                <UserTelegram />
              </div>
            ),
          },
          {
            name: "Push Notifications",
            children: <UserPush />,
          },
          {
            name: "Webhooks",
            children: <UserWebhook />,
          },
        ]}
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

export default Settings;
