import PageComponentProps from "../Pages/PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { ComponentType, ExoticComponent, Ref } from "react";

/*
 * The contract between the core Dashboard and the Enterprise Edition UI.
 *
 * The Enterprise Edition ships its screens from the top-level ee/ directory
 * (ee/Dashboard/Index.tsx), which default-exports an object of this shape.
 * Core never imports ee/ directly: src/Enterprise/Plugins.ts imports the bare
 * specifier "@oneuptime/ee-dashboard", which the build resolves to
 *
 *   - ee/Dashboard/Index.tsx in the Enterprise image, and
 *   - ./CommunityPlugins.ts (an empty object) everywhere else - the Community
 *     image, every tsconfig and both jest configs.
 *
 * Core keeps a small shell at each page's original path. The shell renders the
 * plugin when there is one and the upsell card when there is not (see
 * EnterprisePluginPage.tsx), so route files and the lazy page map never change.
 *
 * Every key is optional: the Community Edition provides none of them, and an
 * Enterprise area can land one screen at a time. Values are component TYPES, so
 * an ee area should hand over `React.lazy(() => import("./Page"))` rather than
 * the component itself - that keeps each enterprise screen in its own chunk,
 * downloaded the first time somebody opens it instead of on every page load.
 *
 * Props types are declared here rather than imported from the component that
 * renders them. Most of those components live in ee/ and would be a core ->
 * ee import; the rest are shells that other work may rewrite. The contract has
 * to outlive both.
 */

/*
 * Any component an ee area may hand over: a function or class component, or
 * an "exotic" one - React.lazy, React.memo, forwardRef. Exotic components are
 * listed separately because under @types/react 18.3 (Common's) a forwardRef
 * component is not a ComponentType of props that carry a ref.
 */
export type EnterprisePluginComponent<TProps> =
  | ComponentType<TProps>
  | ExoticComponent<TProps>;

// Props of the shared audit log table (Components/AuditLogs/AuditLogsTable).
export interface AuditLogsTableProps {
  title: string;
  description: string;
  resourceType?: string | undefined;
  resourceId?: ObjectID | undefined;
  /*
   * Lists every entry that rolls up to this resource: its own, and those of
   * the rows it owns (see EnableAuditLogOn.rootResource). Pass it instead of
   * resourceType / resourceId, which match the resource's own entries only.
   */
  rootResourceId?: ObjectID | undefined;
}

// Props of the per-member compliance status table on a team.
export interface TeamComplianceStatusTableProps {
  teamId: ObjectID;
}

// Imperative handle of that table: the compliance page refreshes it on save.
export interface TeamComplianceStatusTableRef {
  refresh: () => void;
}

/*
 * The table's props as a plugin receives them, ref included. Spelled out
 * rather than as RefAttributes: since @types/react 18.3 RefAttributes also
 * allows legacy string refs, which React.lazy strips - so a lazy forwardRef
 * table would not fit a RefAttributes slot, while it fits this one under
 * every @types/react the frontends and Common install.
 */
export type TeamComplianceStatusTablePluginProps =
  TeamComplianceStatusTableProps & {
    ref?: Ref<TeamComplianceStatusTableRef> | undefined;
  };

export interface DashboardEnterprisePlugins {
  /*
   * Set only by the Enterprise plugin, to a fixed sentinel string. The EE
   * image build greps the built bundle for it (and the Community build
   * asserts it is absent), so an alias that silently fell back to the
   * Community stub cannot ship as "Enterprise".
   */
  buildMarker?: string | undefined;

  // Settings > SSO (SAML) for the current project.
  SettingsSSO?: EnterprisePluginComponent<PageComponentProps> | undefined;
  // Settings > OIDC for the current project.
  SettingsOIDC?: EnterprisePluginComponent<PageComponentProps> | undefined;
  // Settings > SCIM for the current project (includes its SCIM logs).
  SettingsSCIM?: EnterprisePluginComponent<PageComponentProps> | undefined;
  // Settings > Audit Logs (the recording switch and retention).
  SettingsAuditLogsSettings?:
    | EnterprisePluginComponent<PageComponentProps>
    | undefined;

  // Status page > SSO (SAML) for private status page users.
  StatusPageSSO?: EnterprisePluginComponent<PageComponentProps> | undefined;
  // Status page > OIDC for private status page users.
  StatusPageOIDC?: EnterprisePluginComponent<PageComponentProps> | undefined;
  // Status page > SCIM for private status page users (includes its logs).
  StatusPageSCIM?: EnterprisePluginComponent<PageComponentProps> | undefined;

  // Team > Compliance (rules and the member status table).
  TeamCompliance?: EnterprisePluginComponent<PageComponentProps> | undefined;
  // The member compliance status table on its own, for other team surfaces.
  TeamComplianceStatusTable?:
    | EnterprisePluginComponent<TeamComplianceStatusTablePluginProps>
    | undefined;

  /*
   * Body of the shared audit log table. Core's AuditLogsTable stays the one
   * every resource page imports (same props, same export) and renders this.
   */
  AuditLogsTable?: EnterprisePluginComponent<AuditLogsTableProps> | undefined;
}

// Names of the screens a plugin can provide (everything but the marker).
export type DashboardEnterprisePluginKey = Exclude<
  keyof DashboardEnterprisePlugins,
  "buildMarker"
>;

/*
 * A Record, not an array literal, so the compiler proves the list complete:
 * adding a key to the interface without adding it here is a type error, and
 * so is listing a key the interface does not have.
 */
const PLUGIN_KEY_SET: Record<DashboardEnterprisePluginKey, true> = {
  SettingsSSO: true,
  SettingsOIDC: true,
  SettingsSCIM: true,
  SettingsAuditLogsSettings: true,
  StatusPageSSO: true,
  StatusPageOIDC: true,
  StatusPageSCIM: true,
  TeamCompliance: true,
  TeamComplianceStatusTable: true,
  AuditLogsTable: true,
};

export const DASHBOARD_ENTERPRISE_PLUGIN_KEYS: ReadonlyArray<DashboardEnterprisePluginKey> =
  Object.keys(PLUGIN_KEY_SET) as Array<DashboardEnterprisePluginKey>;
