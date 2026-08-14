import UserCall from "../../Components/NotificationMethods/Call";
import UserEmail from "../../Components/NotificationMethods/Email";
import { OnCallExposurePanel } from "../../Components/NotificationMethods/NotificationMethod";
import UserPush from "../../Components/NotificationMethods/Push";
import UserSMS from "../../Components/NotificationMethods/SMS";
import UserTelegram from "../../Components/NotificationMethods/Telegram";
import UserWebhook from "../../Components/NotificationMethods/Webhook";
import UserWhatsApp from "../../Components/NotificationMethods/WhatsApp";
import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  /*
   * WHY THE PANEL SITS ABOVE THE TABS RATHER THAN INSIDE ONE.
   *
   * Every method on this page can be deleted with two clicks, and each one
   * takes every notification rule that points at it down with it - the foreign
   * keys from UserNotificationRule are all `onDelete: "CASCADE"`. The person
   * doing it is usually retiring an old phone number and has no way of knowing
   * that a severity just lost the only rule it had.
   *
   * The panel answers that before they reach for Delete, and it deliberately
   * spans all three tabs: the method being deleted lives under one tab, but the
   * rules it carries are the same set whichever tab you are looking at, and a
   * warning that only exists on the tab you are not on is no warning. It stays
   * silent when nothing points at any method, because a panel that is always
   * there is a panel nobody reads.
   */
  const userId: ObjectID | null = User.getUserId();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  return (
    <Fragment>
      <div className="space-y-4">
        <OnCallExposurePanel userId={userId} projectId={projectId} />
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
      </div>
    </Fragment>
  );
};

export default Settings;
