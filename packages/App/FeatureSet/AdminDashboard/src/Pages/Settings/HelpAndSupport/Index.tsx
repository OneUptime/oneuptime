import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import HelpAndSupportSettings from "./HelpAndSupportSettings";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Settings > Help and Support (#10864, #10865, #10866): where this server
 * sends its people for help - its own support address, chat, help page,
 * feedback, mobile app page and sign-in message, or OneUptime's
 * (HelpAndSupportSettings).
 */
const SettingsHelpAndSupport: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

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
          title: t("breadcrumbs.helpAndSupport"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_HELP_AND_SUPPORT] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <HelpAndSupportSettings />
    </Page>
  );
};

export default SettingsHelpAndSupport;
