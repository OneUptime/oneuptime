import PageComponentProps from "../Pages/PageComponentProps";
import {
  CustomRolesCardState,
  CustomRolesCardStateHandler,
} from "../Components/CustomRole/CustomRolesFold";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import { LicenseManagerComponent } from "Common/UI/Components/EditionLabel/LicenseManager";
import { ComponentType, ExoticComponent } from "react";

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

// A service or telemetry resource whose retention can be overridden.
export interface TelemetryRetentionModel extends BaseModel {
  retainTelemetryDataForDays?: number | undefined;
  telemetryRetentionConfig?: TelemetryRetentionConfig | undefined;
}

/*
 * Props of the retention cards on a service's or resource's Settings page
 * (Components/TelemetryResource/TelemetryResourceRetentionSettings).
 */
export interface TelemetryResourceRetentionSettingsProps {
  modelType: { new (): TelemetryRetentionModel };
  modelId: ObjectID;
  // Lower-case, as it reads in a sentence: "service", "Kubernetes cluster".
  resourceName: string;
  // Prefix of the cards' ids: "<prefix>-telemetry-retention(-overrides)".
  modelDetailIdPrefix: string;
  /*
   * Which of the resource's telemetry the retention covers, when that is not
   * simply everything collected from it. English: the card translates it and
   * says it in its description, after its own first sentence.
   */
  scopeNote?: string | undefined;
}

/*
 * What a custom roles card holds, told to the page it is drawn on: declared
 * with the More settings rules that read it, React-free
 * (Components/CustomRole/CustomRolesFold).
 */
export type { CustomRolesCardState, CustomRolesCardStateHandler };

// Props of a team's custom roles card, on the team's Permissions page.
export interface TeamCustomRolesProps {
  teamId: ObjectID;
  onRolesChange?: CustomRolesCardStateHandler | undefined;
}

// Props of an API key's custom roles card, on the key's page.
export interface ApiKeyCustomRolesProps {
  apiKeyId: ObjectID;
  onRolesChange?: CustomRolesCardStateHandler | undefined;
}

// Props of a status page card that edits one page's settings.
export interface StatusPageSettingCardProps {
  statusPageId: ObjectID;
}

// A status page, public dashboard or form: the records with an IP allow-list.
export interface IpAllowlistModel extends BaseModel {
  ipWhitelist?: string | undefined;
}

/*
 * Props of the IP allow-list card (Components/IpAllowlist/IpAllowlistSettings).
 * Each page words it its own way, so the words are props: English, which the
 * card translates.
 */
export interface IpAllowlistCardProps {
  modelType: { new (): IpAllowlistModel };
  modelId: ObjectID;
  // The card's name for ModelDetail, and its id ("model-detail-...").
  cardName: string;
  modelDetailId: string;
  // The allowlist's own name: the form field's title and the list's.
  title: string;
  // The card's title, where a page names the card otherwise (a form's Access card).
  cardTitle?: string | undefined;
  description: string;
  editButtonText: string;
  fieldDescription: string;
  // Shown while no allow-list is set.
  emptyText: string;
  // Shown for an allow-list with no address in it.
  noAddressText: string;
  // The test id of the list of entries.
  entriesTestId: string;
  // Told the allow-list each time it is read, so the page can say whether one is set.
  onLoaded?: ((ipAllowlist: string) => void) | undefined;
}

export interface DashboardEnterprisePlugins {
  /*
   * Set only by the Enterprise plugin, to a fixed sentinel string. The EE
   * image build greps the built bundle for it (and the Community build
   * asserts it is absent), so an alias that silently fell back to the
   * Community stub cannot ship as "Enterprise".
   */
  buildMarker?: string | undefined;

  // Settings > SCIM for the current project (includes its SCIM logs).
  SettingsSCIM?: EnterprisePluginComponent<PageComponentProps> | undefined;
  // Settings > Audit Logs (the recording switch and retention).
  SettingsAuditLogsSettings?:
    | EnterprisePluginComponent<PageComponentProps>
    | undefined;
  /*
   * Settings > Audit Logs > Export: where the project's audit log is sent
   * (S3, Google Cloud Storage, Azure Blob Storage, a webhook, syslog).
   */
  SettingsAuditLogExport?:
    | EnterprisePluginComponent<PageComponentProps>
    | undefined;

  // Status page > SCIM for private status page users (includes its logs).
  StatusPageSCIM?: EnterprisePluginComponent<PageComponentProps> | undefined;

  /*
   * Team > Compliance (rules and the member status table). The status table
   * is not a key of its own: only this page shows it, and ee's page imports
   * it from ee/ directly.
   */
  TeamCompliance?: EnterprisePluginComponent<PageComponentProps> | undefined;

  /*
   * Body of the shared audit log table. Core's AuditLogsTable stays the one
   * every resource page imports (same props, same export) and renders this.
   */
  AuditLogsTable?: EnterprisePluginComponent<AuditLogsTableProps> | undefined;

  /*
   * Settings > Telemetry: the project's retention by telemetry type. The
   * project's default retention stays in core, on the same page.
   */
  SettingsTelemetryRetentionByType?:
    | EnterprisePluginComponent<PageComponentProps>
    | undefined;

  /*
   * The retention cards of every service and telemetry resource Settings
   * page: the resource's own retention and its retention by telemetry type.
   */
  TelemetryResourceRetentionSettings?:
    | EnterprisePluginComponent<TelemetryResourceRetentionSettingsProps>
    | undefined;

  /*
   * Teams > Settings > Roles: the project's custom roles - create, list,
   * open, delete. The built-in roles under them stay in core, on the same
   * page.
   */
  TeamRoles?: EnterprisePluginComponent<PageComponentProps> | undefined;

  // Teams > Settings > Roles > a role: its permissions and the teams given it.
  TeamRoleView?: EnterprisePluginComponent<PageComponentProps> | undefined;

  // A team's Permissions page: the custom roles the team is given.
  TeamCustomRoles?: EnterprisePluginComponent<TeamCustomRolesProps> | undefined;

  // An API key's page: the custom roles the key is given.
  ApiKeyCustomRoles?:
    | EnterprisePluginComponent<ApiKeyCustomRolesProps>
    | undefined;

  /*
   * The IP allow-list card of a private status page (Security > Access), a
   * public dashboard (Sharing) and a form (Share).
   */
  IpAllowlistCard?: EnterprisePluginComponent<IpAllowlistCardProps> | undefined;

  // A status page's Powered by OneUptime switch (Settings > Display).
  StatusPagePoweredBy?:
    | EnterprisePluginComponent<StatusPageSettingCardProps>
    | undefined;

  // A status page's Reader Sessions card (Security > Access).
  StatusPageSessionLength?:
    | EnterprisePluginComponent<StatusPageSettingCardProps>
    | undefined;

  /*
   * A status page's subscriber restrictions (Subscribers > Settings): only
   * private users can subscribe, and the email domains subscribers may use.
   */
  StatusPageSubscriberRestrictions?:
    | EnterprisePluginComponent<StatusPageSettingCardProps>
    | undefined;

  /*
   * License management (activation, refresh, seat usage, the instances on
   * the license) in the edition dialog of the footer's edition pill. Footer
   * passes it to EditionLabel, which keeps the read-only license status. Not
   * a page and never lazy: see Common/UI/Components/EditionLabel/LicenseManager.ts.
   */
  LicenseManager?: LicenseManagerComponent | undefined;
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
  SettingsSCIM: true,
  SettingsAuditLogsSettings: true,
  SettingsAuditLogExport: true,
  StatusPageSCIM: true,
  TeamCompliance: true,
  AuditLogsTable: true,
  SettingsTelemetryRetentionByType: true,
  TelemetryResourceRetentionSettings: true,
  TeamRoles: true,
  TeamRoleView: true,
  TeamCustomRoles: true,
  ApiKeyCustomRoles: true,
  IpAllowlistCard: true,
  StatusPagePoweredBy: true,
  StatusPageSessionLength: true,
  StatusPageSubscriberRestrictions: true,
  LicenseManager: true,
};

export const DASHBOARD_ENTERPRISE_PLUGIN_KEYS: ReadonlyArray<DashboardEnterprisePluginKey> =
  Object.keys(PLUGIN_KEY_SET) as Array<DashboardEnterprisePluginKey>;
