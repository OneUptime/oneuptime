import NotificationMethodTabs from "../../Components/NotificationMethods/NotificationMethodTabs";
import TestPageCard from "../../Components/OnCallTestPage/TestPageCard";
import UserSettingsPageIntro, {
  USER_SETTINGS_PAGE_LINK_CLASS_NAME,
} from "../../Components/UserSettings/UserSettingsPageIntro";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * WHERE THE DELETION WARNING LIVES.
 *
 * Every method on this page can be deleted with two clicks, and each one takes
 * every notification rule that points at it down with it - the foreign keys
 * from UserNotificationRule are all `onDelete: "CASCADE"`. The person doing it
 * is usually retiring an old phone number and has no way of knowing that a
 * severity just lost the only rule it had.
 *
 * That is answered in the delete confirmation itself (DeletionImpactModal, via
 * useNotificationMethodDeleteGuard on each method table), which names the rules
 * and the severities the delete would empty out. It is deliberately NOT also
 * restated in a standing panel above the tabs: the same warning shown on every
 * visit is the warning people learn to skim, and it arrives there long before
 * anyone can act on it.
 *
 * Above the methods: "Send me a test page" (OnCallTestPage), the one way to
 * prove each of them works before a real incident does - an action, not a
 * warning.
 *
 * Above that, the page's first line (#8887): this page is where OneUptime can
 * reach you, and the two pages that decide when each method is used - How to
 * Reach Me for on-call pages, Notification Settings for updates - are a
 * click away. The four pages of Alerts & Notifications sound alike, and each
 * says which one it is.
 */

export const NOTIFICATION_METHODS_INTRO: string = translationKey(
  "Where OneUptime can reach you in this project: email addresses, phone numbers, chat accounts, devices and webhooks. {{howToReachMe}} and {{notificationSettings}} decide when each is used.",
);

export const NOTIFICATION_METHODS_INTRO_TEST_ID: string =
  "notification-methods-intro";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();

  const howToReachMeRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_ON_CALL_RULES] as Route,
  );
  const notificationSettingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS] as Route,
  );

  return (
    <Fragment>
      <UserSettingsPageIntro
        docsPath="/docs/notifications/notification-methods"
        dataTestId={NOTIFICATION_METHODS_INTRO_TEST_ID}
      >
        <TranslatedSentence
          template={NOTIFICATION_METHODS_INTRO}
          slots={{
            howToReachMe: (
              <Link
                to={howToReachMeRoute}
                className={USER_SETTINGS_PAGE_LINK_CLASS_NAME}
              >
                {translator.translateText("How to Reach Me")}
              </Link>
            ),
            notificationSettings: (
              <Link
                to={notificationSettingsRoute}
                className={USER_SETTINGS_PAGE_LINK_CLASS_NAME}
              >
                {translator.translateText("Notification Settings")}
              </Link>
            ),
          }}
        />
      </UserSettingsPageIntro>
      <TestPageCard dataTestId="notification-methods-test-page-card" />
      <NotificationMethodTabs />
    </Fragment>
  );
};

export default Settings;
