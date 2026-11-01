import { isLicenseSettingsAvailable } from "./LicenseSettingsAPI";
import LicenseSettingsView from "./LicenseSettingsView";
import { getEnterpriseSettingsPageRoute } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import DashboardSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
import PageMap from "@oneuptime/admin-dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/admin-dashboard/Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { LICENSE_SETTINGS_PAGE_PATH } from "Common/UI/Components/EditionLabel/LicenseSettingsPage";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Admin Dashboard > Settings > License, where master admins add, refresh and
 * replace the Enterprise license (./LicenseSettingsView.tsx).
 *
 * Enterprise Edition only: the routes it calls exist only in the Enterprise
 * server, and the Community build has no such page. Rendered only where
 * there is a license to manage; anywhere else it draws nothing, exactly as a
 * settings path that does not exist.
 */
const LicenseSettingsPage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  if (!isLicenseSettingsAvailable()) {
    return <></>;
  }

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.enterpriseLicense"),
          to: getEnterpriseSettingsPageRoute(LICENSE_SETTINGS_PAGE_PATH),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <div data-testid="license-settings-page">
        <LicenseSettingsView />
      </div>
    </Page>
  );
};

export default LicenseSettingsPage;
