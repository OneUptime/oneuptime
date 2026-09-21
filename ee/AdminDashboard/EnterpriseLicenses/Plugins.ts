import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";

/*
 * Enterprise license management - the OneUptime Cloud license server's admin
 * screens (the license list and one license).
 *
 * The core shells at Pages/EnterpriseLicenses/Index.tsx and
 * Pages/EnterpriseLicenses/View/Index.tsx render these only when billing is
 * enabled (OneUptime Cloud); everywhere else they keep the "Only available on
 * OneUptime Cloud" empty state.
 *
 * Lazy, so the screens download only when a master admin opens them. Core is
 * imported through "@oneuptime/admin-dashboard/..." and "Common/..." only.
 */
type EnterpriseLicensesPluginKeys =
  | "EnterpriseLicensesList"
  | "EnterpriseLicenseView";

const EnterpriseLicensesPlugins: Pick<
  AdminDashboardEnterprisePlugins,
  EnterpriseLicensesPluginKeys
> = {
  EnterpriseLicensesList: lazy(() => {
    return import("./Pages/Index");
  }),
  EnterpriseLicenseView: lazy(() => {
    return import("./Pages/View/Index");
  }),
};

export default EnterpriseLicensesPlugins;
