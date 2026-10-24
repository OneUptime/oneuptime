import { AuditLogExportScope } from "../../Dashboard/AuditLogExport/AuditLogExportCopy";
import AuditLogExportLicenseNotice from "../../Dashboard/AuditLogExport/AuditLogExportLicenseNotice";
import AuditLogExportTable from "../../Dashboard/AuditLogExport/AuditLogExportTable";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
  isEnterpriseConfigurationReadOnly,
} from "../../Dashboard/Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../../Dashboard/Identity/License/UseEnterpriseLicenseMode";
import {
  AUDIT_LOG_EXPORT_SETTINGS_PAGE_PATH,
  AUDIT_LOG_EXPORT_SETTINGS_PAGE_TITLE,
} from "./AuditLogExportPaths";
import { getEnterpriseSettingsPageRoute } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import DashboardSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import PageMap from "@oneuptime/admin-dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/admin-dashboard/Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Admin Dashboard > Settings > Audit Log Export: where the audit log of the
 * whole instance - every project's - is sent, as it is recorded. Master
 * admins only (the Admin Dashboard is theirs, and the server refuses an
 * export without a project to anyone else).
 *
 * The table, form and test are the project page's
 * (ee/Dashboard/AuditLogExport), with the instance's exports (no project),
 * the Admin Dashboard's model API (no project header) and the instance's
 * test route.
 */
const AuditLogExportSettingsPage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.AuditLogs,
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
          title: AUDIT_LOG_EXPORT_SETTINGS_PAGE_TITLE,
          to: getEnterpriseSettingsPageRoute(
            AUDIT_LOG_EXPORT_SETTINGS_PAGE_PATH,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <div data-testid="audit-log-export-settings">
        <AuditLogExportLicenseNotice mode={licenseMode} />
        <AuditLogExportTable
          scope={AuditLogExportScope.Instance}
          modelAPI={AdminModelAPI}
          isLicenseReadOnly={isEnterpriseConfigurationReadOnly(licenseMode)}
        />
      </div>
    </Page>
  );
};

export default AuditLogExportSettingsPage;
