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

export interface AdminDashboardEnterprisePlugins {
  /*
   * Set only by the Enterprise plugin, to a fixed sentinel string. The EE
   * image build greps the built bundle for it (and the Community build
   * asserts it is absent), so an alias that silently fell back to the
   * Community stub cannot ship as "Enterprise".
   */
  buildMarker?: string | undefined;

  // Settings > Global SSO (SAML): the provider list and one provider.
  GlobalSSOList?: EnterprisePluginComponent | undefined;
  GlobalSSOView?: EnterprisePluginComponent | undefined;
  // Settings > Global OIDC: the provider list and one provider.
  GlobalOIDCList?: EnterprisePluginComponent | undefined;
  GlobalOIDCView?: EnterprisePluginComponent | undefined;

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
  GlobalSSOList: true,
  GlobalSSOView: true,
  GlobalOIDCList: true,
  GlobalOIDCView: true,
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
};

export const ADMIN_DASHBOARD_ENTERPRISE_PLUGIN_KEYS: ReadonlyArray<AdminDashboardEnterprisePluginKey> =
  Object.keys(PLUGIN_KEY_SET) as Array<AdminDashboardEnterprisePluginKey>;
