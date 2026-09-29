import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../Enterprise/Plugins";
import EnterpriseLicensesUnavailable from "./EnterpriseLicensesUnavailable";
import { BILLING_ENABLED } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Settings > Enterprise Licenses. The screen is the OneUptime Cloud license
 * server's and ships in the Enterprise Edition
 * (ee/AdminDashboard/EnterpriseLicenses); this shell keeps the route. It
 * renders the Enterprise screen only where licenses are managed (billing
 * enabled), and the "Only available on OneUptime Cloud" state everywhere
 * else.
 */
const EnterpriseLicenses: FunctionComponent = (): ReactElement => {
  return (
    <EnterprisePluginPage
      plugin={getAdminDashboardPlugins().EnterpriseLicensesList}
      isEligible={BILLING_ENABLED}
      renderUpsell={() => {
        return (
          <EnterpriseLicensesUnavailable isBillingEnabled={BILLING_ENABLED} />
        );
      }}
    />
  );
};

export default EnterpriseLicenses;
