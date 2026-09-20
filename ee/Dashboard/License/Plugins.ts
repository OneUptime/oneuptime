import LicenseManager from "../../AdminDashboard/License/LicenseManager";
import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";

/*
 * License management in the edition dialog - the pill in the Dashboard's
 * footer. The core Footer hands it to EditionLabel, which keeps the read-only
 * license status and renders this for everything that changes the license.
 *
 * The same component as the Admin Dashboard's, imported from
 * ee/AdminDashboard/License: it reaches core only through Common/... and
 * react, which both bundles resolve, and this Dashboard's tsconfig includes
 * that directory so its type check covers the shared file too.
 *
 * Not lazy, unlike the page plugins: the manager wraps the dialog and holds
 * what an admin typed while the dialog is closed, so it is mounted with the
 * footer on every page.
 */
type LicensePluginKeys = "LicenseManager";

const LicensePlugins: Pick<DashboardEnterprisePlugins, LicensePluginKeys> = {
  LicenseManager: LicenseManager,
};

export default LicensePlugins;
