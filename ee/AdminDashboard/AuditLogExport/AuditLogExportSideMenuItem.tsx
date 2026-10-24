import { getEnterpriseSettingsPageRoute } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import React, { FunctionComponent, ReactElement } from "react";
import {
  AUDIT_LOG_EXPORT_SETTINGS_PAGE_PATH,
  AUDIT_LOG_EXPORT_SETTINGS_PAGE_TITLE,
} from "./AuditLogExportPaths";

/*
 * Settings > Audit Log Export in the Admin Dashboard's side menu, on every
 * Enterprise installation: the page itself says when the license has
 * stopped audit logs, and what still works then (reading and deleting the
 * exports).
 */
const AuditLogExportSideMenuItem: FunctionComponent = (): ReactElement => {
  return (
    <SideMenuItem
      link={{
        title: AUDIT_LOG_EXPORT_SETTINGS_PAGE_TITLE,
        to: getEnterpriseSettingsPageRoute(AUDIT_LOG_EXPORT_SETTINGS_PAGE_PATH),
      }}
      icon={IconProp.DocumentArrowUp}
    />
  );
};

export default AuditLogExportSideMenuItem;
