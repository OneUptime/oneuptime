import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../../Dashboard/Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../../Dashboard/Identity/License/UseEnterpriseLicenseMode";
import {
  BACKUPS_SETTINGS_PAGE_PATH,
  BACKUPS_SETTINGS_PAGE_TITLE,
} from "./BackupsPaths";
import BackupsView from "./BackupsView";
import { getEnterpriseSettingsPageRoute } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import DashboardSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
import PageMap from "@oneuptime/admin-dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/admin-dashboard/Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Admin Dashboard > Settings > Backups: backups of the whole installation -
 * PostgreSQL (projects, monitors, incidents, users) and ClickHouse
 * (telemetry) - to storage the master admins choose, on a schedule, kept
 * for as many days as they say, and restored from here. Master admins only:
 * the Admin Dashboard is theirs, and every route behind it says so again.
 *
 * Enterprise Edition only (ee/Server/Backup does the work); the Community
 * build has no such page.
 */
const BackupsSettingsPage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.Backups,
  );

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
          title: BACKUPS_SETTINGS_PAGE_TITLE,
          to: getEnterpriseSettingsPageRoute(BACKUPS_SETTINGS_PAGE_PATH),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <div data-testid="backups-settings-page">
        <BackupsView licenseMode={licenseMode} />
      </div>
    </Page>
  );
};

export default BackupsSettingsPage;
