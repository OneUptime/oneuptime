import EnterpriseLicensesPlugins from "./EnterpriseLicenses/Plugins";
import GlobalSSOPlugins from "./GlobalSSO/Plugins";
import HealthPlugins from "./Health/Plugins";
import LicensePlugins from "./License/Plugins";
import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";

/*
 * The Enterprise Edition's Admin Dashboard plugin: what
 * "@oneuptime/ee-admin-dashboard" resolves to when the Enterprise image builds
 * the Admin Dashboard (see packages/Common/UI/esbuild-enterprise.js). The
 * Community build resolves the same specifier to an empty stub instead.
 *
 * Assembled from one file per area so each area owns only its own keys.
 * `satisfies` rejects a key the Admin Dashboard does not know and a component
 * with the wrong props, while keeping the object's own type.
 */

/*
 * The EE image build greps the built bundle for this string and fails when it
 * is missing (and the Community build asserts it is absent), so an alias that
 * silently fell back to the Community stub cannot ship. It is stored on the
 * exported object, which the Admin Dashboard keeps, so minification and tree
 * shaking cannot drop it. Change the version suffix only together with the
 * build checks that look for it.
 */
export const ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_SENTINEL: string =
  "ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1";

export default {
  ...GlobalSSOPlugins,
  ...HealthPlugins,
  ...EnterpriseLicensesPlugins,
  ...LicensePlugins,
  buildMarker: ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_SENTINEL,
} satisfies AdminDashboardEnterprisePlugins;
