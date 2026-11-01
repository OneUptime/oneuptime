import { isLicenseSettingsAvailable } from "./LicenseSettingsAPI";
import { getEnterpriseSettingsPageRoute } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import IconProp from "Common/Types/Icon/IconProp";
import { LICENSE_SETTINGS_PAGE_PATH } from "Common/UI/Components/EditionLabel/LicenseSettingsPage";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Settings > License in the Admin Dashboard's side menu, wherever there is a
 * license to manage. Whether the license is valid does not matter: this is
 * where a lapsed one is fixed.
 */
const LicenseSideMenuItem: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  if (!isLicenseSettingsAvailable()) {
    return <></>;
  }

  return (
    <SideMenuItem
      link={{
        title: t("breadcrumbs.enterpriseLicense"),
        to: getEnterpriseSettingsPageRoute(LICENSE_SETTINGS_PAGE_PATH),
      }}
      icon={IconProp.Key}
    />
  );
};

export default LicenseSideMenuItem;
