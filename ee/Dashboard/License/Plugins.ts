import LicenseDetails from "../../AdminDashboard/License/LicenseDetails";
import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";

/*
 * The license details in the edition dialog - the pill in the Dashboard's
 * footer. The core Footer hands them to EditionLabel, which adds the seat
 * usage and the instances to the read-only status. Nothing here changes the
 * license: a master admin does that on Settings > License in the Admin
 * Dashboard, and the dialog links there.
 *
 * The same component as the Admin Dashboard's, imported from
 * ee/AdminDashboard/License: it reaches core only through Common/... and
 * react, which both bundles resolve, and this Dashboard's tsconfig includes
 * that file so its type check covers it too.
 *
 * Not lazy, unlike the page plugins: the dialog has no Suspense around it.
 */
type LicensePluginKeys = "LicenseDetails";

const LicensePlugins: Pick<DashboardEnterprisePlugins, LicensePluginKeys> = {
  LicenseDetails: LicenseDetails,
};

export default LicensePlugins;
