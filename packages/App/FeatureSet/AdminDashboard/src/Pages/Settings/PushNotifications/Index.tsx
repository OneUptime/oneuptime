import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import {
  getPushNotificationsSwitchConfirmation,
  getPushNotificationsSwitchDescription,
  PUSH_NOTIFICATIONS_SWITCH_TEST_ID,
} from "./PushNotificationsCopy";
import ServerTestCard, {
  SERVER_TEST_CARD_COPY,
} from "../../../Components/ServerSetup/ServerTestCard";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { ServerSendingChannel } from "Common/Types/ServerSending/ServerSendingStatus";
import { ServerSetupCheckId } from "Common/Types/ServerSetup/ServerSetupChecklist";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import Page from "Common/UI/Components/Page/Page";
import {
  useServerSetupChecklist,
  UseServerSetupChecklistResult,
} from "Common/UI/Utils/ServerSetupChecklist";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import { translationKey } from "Common/Types/Translator";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Settings > Push Notifications: one switch for the whole server, saved the
 * moment it is flipped (the shared ModelSwitchCard). "Send push
 * notifications" is on while GlobalConfig.disablePushNotifications is
 * false - as every installation was before the switch.
 *
 * Turned off, nothing is pushed to a phone or browser through OneUptime's
 * apps, in any project, and no device can be registered: for an
 * installation whose rules let nothing out through Expo, the push relay or
 * a browser's push service. It reaches people through a custom channel
 * instead - often its own app - so turning push off asks first, and says so
 * (PushNotificationsCopy).
 *
 * GlobalConfig is one row, with the zero id.
 *
 * It starts, as Settings > Emails and Settings > Call and SMS do, with where
 * push stands and "Send test push" (#7028): a test to the admin's own
 * phones and browsers, which says plainly when push is off, when they have
 * nothing registered, and when the server has no VAPID keys for a browser.
 */
const SettingsPushNotifications: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  // Where push stands, for the test card.
  const checklist: UseServerSetupChecklistResult = useServerSetupChecklist();

  return (
    <Page
      title={t("pages.settings.title")}
      isTitleTranslated={true}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "Push Notifications",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_PUSH_NOTIFICATIONS] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <ServerTestCard
        check={ServerSetupCheckId.BrowserPush}
        title={t(SERVER_TEST_CARD_COPY.pushTitle)}
        description={t(SERVER_TEST_CARD_COPY.pushDescription)}
        channels={[ServerSendingChannel.Push]}
        checklist={checklist}
      />

      <ModelSwitchCard<GlobalConfig>
        modelType={GlobalConfig}
        modelId={ObjectID.getZeroObjectID()}
        column="disablePushNotifications"
        isInverted={true}
        modelAPI={AdminModelAPI}
        cardTitle="Push Notifications"
        cardDescription={translationKey(
          "Notifications pushed to the OneUptime mobile app and to browsers, through Expo, the push relay and the browsers' push services.",
        )}
        title="Send push notifications"
        getDescription={getPushNotificationsSwitchDescription}
        getConfirmation={getPushNotificationsSwitchConfirmation}
        dataTestId={PUSH_NOTIFICATIONS_SWITCH_TEST_ID}
      />
    </Page>
  );
};

export default SettingsPushNotifications;
