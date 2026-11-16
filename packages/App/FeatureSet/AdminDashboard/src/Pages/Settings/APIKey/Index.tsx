import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import MasterApiKeyCard from "./MasterApiKeyCard";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Settings > API Key: the server's master API key (MasterApiKeyCard). It is
 * stored hashed (#7901), so the page says whether there is one, makes one
 * and shows it once; it used to read the key back into a hidden field with
 * a copy button, and an Edit dialog took a key of the admin's choosing.
 */
const Settings: FunctionComponent = (): ReactElement => {
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
          title: t("breadcrumbs.apiKey"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_API_KEY] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <MasterApiKeyCard />
    </Page>
  );
};

export default Settings;
