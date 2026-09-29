import LicenseManager from "./LicenseManager";
import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";

/*
 * License management in the edition dialog - the pill in the Admin
 * Dashboard's header. The core Header hands it to EditionLabel, which keeps
 * the read-only license status and renders this for everything that changes
 * the license (see ./LicenseManager.tsx).
 *
 * Not lazy, unlike the page plugins: the manager wraps the dialog and holds
 * what an admin typed while the dialog is closed, so it is mounted with the
 * header on every page.
 */
type LicensePluginKeys = "LicenseManager";

const LicensePlugins: Pick<AdminDashboardEnterprisePlugins, LicensePluginKeys> =
  {
    LicenseManager: LicenseManager,
  };

export default LicensePlugins;
