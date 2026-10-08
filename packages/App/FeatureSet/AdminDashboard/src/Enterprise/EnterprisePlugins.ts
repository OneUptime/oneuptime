import Route from "Common/Types/API/Route";
import { LicenseManagerComponent } from "Common/UI/Components/EditionLabel/LicenseManager";
import { ComponentType, ExoticComponent } from "react";

/*
 * The contract between the core Admin Dashboard and the Enterprise Edition UI.
 *
 * The Enterprise Edition ships its admin screens from the top-level ee/
 * directory (ee/AdminDashboard/Index.tsx), which default-exports an object of
 * this shape. Core never imports ee/ directly: src/Enterprise/Plugins.ts
 * imports the bare specifier "@oneuptime/ee-admin-dashboard", which the build
 * resolves to
 *
 *   - ee/AdminDashboard/Index.tsx in the Enterprise image, and
 *   - ./CommunityPlugins.ts (an empty object) everywhere else - the Community
 *     image, every tsconfig and both jest configs.
 *
 * Core keeps a small shell at each page's original path that renders the
 * plugin or the upsell card (see EnterprisePluginPage.tsx), so App.tsx and its
 * route wiring never change.
 *
 * Every key is optional: the Community Edition provides none of them, and an
 * Enterprise area can land one screen at a time. Values are component TYPES, so
 * an ee area should hand over `React.lazy(() => import("./Page"))` - that keeps
 * each enterprise screen in its own chunk.
 *
 * None of these screens take props: the admin dashboard has no project or
 * plan context, and every screen reads what it needs from the route or the
 * API itself. The Health entries are the page CONTENT - the core shell keeps
 * the Health layout (breadcrumbs, side menu) around them.
 */
export type NoPluginProps = Record<string, never>;

/*
 * Any component an ee area may hand over: a function or class component, or
 * an "exotic" one - React.lazy, React.memo, forwardRef.
 */
export type EnterprisePluginComponent =
  | ComponentType<NoPluginProps>
  | ExoticComponent<NoPluginProps>;

/*
 * A page an Enterprise area adds to Settings, at /admin/settings/<path>.
 * Core registers the route and renders the component inside Suspense; the
 * page draws everything else itself, the Settings side menu included, and
 * decides on its own whether it has anything to show (a page that depends on
 * the license renders nothing while the license does not allow it, exactly
 * as a route that does not exist).
 */
export interface EnterpriseSettingsPage {
  // One path segment: letters, digits and hyphens.
  path: string;
  component: EnterprisePluginComponent;
}

// The settings path of every Enterprise settings page.
export const ENTERPRISE_SETTINGS_PAGES_BASE_PATH: string = "/admin/settings";

// One Enterprise settings page's route; core's router and its menu entry use it.
export const getEnterpriseSettingsPageRoute: (path: string) => Route = (
  path: string,
): Route => {
  return new Route(`${ENTERPRISE_SETTINGS_PAGES_BASE_PATH}/${path}`);
};

export interface AdminDashboardEnterprisePlugins {
  /*
   * Set only by the Enterprise plugin, to a fixed sentinel string. The EE
   * image build greps the built bundle for it (and the Community build
   * asserts it is absent), so an alias that silently fell back to the
   * Community stub cannot ship as "Enterprise".
   */
  buildMarker?: string | undefined;

  /*
   * OneUptime Health. HealthOverview is what the landing page adds on top of
   * the Community content (capacity and links to Migrations / Support). The
   * instance log has no key: it is Community content that core renders on
   * every edition.
   */
  HealthOverview?: EnterprisePluginComponent | undefined;
  HealthQueues?: EnterprisePluginComponent | undefined;
  HealthPostgres?: EnterprisePluginComponent | undefined;
  HealthRedis?: EnterprisePluginComponent | undefined;
  HealthLogs?: EnterprisePluginComponent | undefined;
  HealthTelemetry?: EnterprisePluginComponent | undefined;
  HealthQueryConsole?: EnterprisePluginComponent | undefined;
  /*
   * The cluster section of the ClickHouse page. Capacity and its settings
   * are Community and stay in the core page around it.
   */
  HealthClickhouseCluster?: EnterprisePluginComponent | undefined;

  // Enterprise license management (the OneUptime Cloud license server only).
  EnterpriseLicensesList?: EnterprisePluginComponent | undefined;
  EnterpriseLicenseView?: EnterprisePluginComponent | undefined;

  /*
   * License management (activation, refresh, seat usage, the instances on
   * the license) in the edition dialog of the header's edition pill - on a
   * self-hosted Enterprise install, unlike the license server screens above.
   * The one key with props: Header passes it to EditionLabel, which keeps the
   * read-only license status. Not a page and never lazy: see
   * Common/UI/Components/EditionLabel/LicenseManager.ts.
   */
  LicenseManager?: LicenseManagerComponent | undefined;

  /*
   * Settings pages (see EnterpriseSettingsPage), and their entries in the
   * Settings side menu: one component the core side menu renders at the end
   * of its first section, which draws its own items - or nothing, for a page
   * the license does not allow, so no trace of it shows.
   */
  SettingsPages?: ReadonlyArray<EnterpriseSettingsPage> | undefined;
  SettingsSideMenuItems?: EnterprisePluginComponent | undefined;
}

// Names of the screens a plugin can provide (everything but the marker).
export type AdminDashboardEnterprisePluginKey = Exclude<
  keyof AdminDashboardEnterprisePlugins,
  "buildMarker"
>;

/*
 * A Record, not an array literal, so the compiler proves the list complete:
 * adding a key to the interface without adding it here is a type error, and
 * so is listing a key the interface does not have.
 */
const PLUGIN_KEY_SET: Record<AdminDashboardEnterprisePluginKey, true> = {
  HealthOverview: true,
  HealthQueues: true,
  HealthPostgres: true,
  HealthRedis: true,
  HealthLogs: true,
  HealthTelemetry: true,
  HealthQueryConsole: true,
  HealthClickhouseCluster: true,
  EnterpriseLicensesList: true,
  EnterpriseLicenseView: true,
  LicenseManager: true,
  SettingsPages: true,
  SettingsSideMenuItems: true,
};

export const ADMIN_DASHBOARD_ENTERPRISE_PLUGIN_KEYS: ReadonlyArray<AdminDashboardEnterprisePluginKey> =
  Object.keys(PLUGIN_KEY_SET) as Array<AdminDashboardEnterprisePluginKey>;
