import PageMap from "../../Utils/PageMap";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";

/*
 * Pure decision logic for the dashboard command palette. This module is
 * deliberately React-free and browser-free (no Common/UI imports — those read
 * `window` at import time) so the App test suite, which runs in a plain node
 * environment, can exercise every branch directly.
 */

/** localStorage key the palette persists its recent command ids under. */
export const PALETTE_RECENTS_STORAGE_KEY: string =
  "oneuptime-command-palette-recents";

/** Rows fetched per entity type per keystroke — keep the fan-out cheap. */
export const PALETTE_ENTITY_SEARCH_LIMIT: number = 5;

// ---- ":"-guard --------------------------------------------------------------

/*
 * RouteUtil.populateRouteParams silently leaves `:projectId` (or `:id`) in the
 * path when there is no value for it — navigating there lands on the 404
 * route. Same guard Breadcrumbs uses (Utils/Breadcrumbs/Helper.ts): a populated
 * path that still contains ":" is not navigable and must be hidden.
 */
export function isRoutePathNavigable(routePath: string): boolean {
  return routePath.length > 0 && !routePath.includes(":");
}

// ---- navigation catalog → command descriptors -------------------------------

/*
 * A palette-facing snapshot of one NavBar catalog item. Routes travel as plain
 * strings so this stays serializable and node-testable; the component turns
 * `routePath` back into a Route when the command runs.
 */
export interface PaletteNavigationCatalogEntry {
  title: string;
  description?: string | undefined;
  icon?: IconProp | undefined;
  /** Tailwind color name like "blue" | "violet" — same convention as NavBar. */
  iconColor?: string | undefined;
  category: string;
  /** The populated (project-specific) path the command navigates to. */
  routePath: string;
  /**
   * The un-populated route template (e.g. "/dashboard/:projectId/monitors").
   * Stable across projects and languages, so it anchors the command id that
   * recents are persisted under.
   */
  templatePath: string;
}

export interface PaletteNavigationCommandDescriptor
  extends PaletteNavigationCatalogEntry {
  id: string;
}

/** "nav" + "/dashboard/:projectId/monitors" → "nav-dashboard-projectid-monitors". */
export function slugifyPaletteCommandId(prefix: string, value: string): string {
  const slug: string = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${slug}`;
}

/*
 * Turn the shared NavBar catalog into palette command descriptors, dropping
 * entries that cannot be navigated to right now (no project selected → the
 * project-scoped routes keep their ":projectId" placeholder).
 */
export function buildNavigationCommandDescriptors(
  entries: Array<PaletteNavigationCatalogEntry>,
): Array<PaletteNavigationCommandDescriptor> {
  return entries
    .filter((entry: PaletteNavigationCatalogEntry) => {
      return isRoutePathNavigable(entry.routePath);
    })
    .map((entry: PaletteNavigationCatalogEntry) => {
      return {
        ...entry,
        id: slugifyPaletteCommandId("nav", entry.templatePath),
      };
    });
}

// ---- action gating ----------------------------------------------------------

export type PaletteActionId =
  | "action-declare-incident"
  | "action-create-monitor"
  | "action-create-alert"
  | "action-create-scheduled-maintenance"
  | "action-create-announcement"
  | "action-toggle-theme"
  | "action-ask-ai"
  | "action-keyboard-shortcuts"
  | "action-log-out"
  | "action-project-invitations"
  | "action-active-incidents"
  | "action-my-on-call-policies"
  | "action-admin-dashboard";

export interface PaletteCreateActionGates {
  canCreateIncident: boolean;
  canCreateMonitor: boolean;
  canCreateAlert: boolean;
  canCreateScheduledMaintenance: boolean;
  canCreateAnnouncement: boolean;
}

/*
 * Mirror of BaseModelTable's create-button gating: the user can run a create
 * action when their permission snapshot grants create on the model, or they
 * are a master admin. Permissions arrive as a plain array (what
 * PermissionUtil.getAllPermissions returns) so this stays pure.
 */
export function computeCreateActionGates(data: {
  permissions: Array<Permission> | null;
  isMasterAdmin: boolean;
}): PaletteCreateActionGates {
  const canCreate: (model: {
    hasCreatePermissions: (permissions: Array<Permission>) => boolean;
  }) => boolean = (model: {
    hasCreatePermissions: (permissions: Array<Permission>) => boolean;
  }): boolean => {
    if (data.isMasterAdmin) {
      return true;
    }
    if (!data.permissions) {
      // A missing snapshot (e.g. right after SSO login) hides create actions.
      return false;
    }
    return model.hasCreatePermissions(data.permissions);
  };

  return {
    canCreateIncident: canCreate(new Incident()),
    canCreateMonitor: canCreate(new Monitor()),
    canCreateAlert: canCreate(new Alert()),
    canCreateScheduledMaintenance: canCreate(new ScheduledMaintenance()),
    canCreateAnnouncement: canCreate(new StatusPageAnnouncement()),
  };
}

export interface PaletteActionAvailability extends PaletteCreateActionGates {
  hasProjectSelected: boolean;
  isMasterAdmin: boolean;
}

/*
 * The full visible-action decision for one render: create actions need a
 * project AND create permission; the admin dashboard needs master admin;
 * theme, Ask AI, logout and the global pages are always available.
 */
export function getVisibleActionIds(
  availability: PaletteActionAvailability,
): Array<PaletteActionId> {
  const actionIds: Array<PaletteActionId> = [];

  if (availability.hasProjectSelected) {
    if (availability.canCreateIncident) {
      actionIds.push("action-declare-incident");
    }
    if (availability.canCreateMonitor) {
      actionIds.push("action-create-monitor");
    }
    if (availability.canCreateAlert) {
      actionIds.push("action-create-alert");
    }
    if (availability.canCreateScheduledMaintenance) {
      actionIds.push("action-create-scheduled-maintenance");
    }
    if (availability.canCreateAnnouncement) {
      actionIds.push("action-create-announcement");
    }
  }

  actionIds.push("action-toggle-theme");
  actionIds.push("action-ask-ai");
  /*
   * Never gated: the shortcuts dialog is a reference, not a capability, and
   * someone who has just met the palette is exactly who needs to find it.
   */
  actionIds.push("action-keyboard-shortcuts");
  actionIds.push("action-active-incidents");
  actionIds.push("action-my-on-call-policies");
  actionIds.push("action-project-invitations");

  if (availability.isMasterAdmin) {
    actionIds.push("action-admin-dashboard");
  }

  actionIds.push("action-log-out");

  return actionIds;
}

// ---- entity search providers ------------------------------------------------

export interface PaletteEntitySearchSpec {
  /** Stable provider id, also used in the palette's section test ids. */
  id: string;
  /** Which model column carries the human name of a row. */
  titleField: "name" | "title";
  /**
   * Columns the free-text search runs over. MUST be real entity property
   * names for the model — verified against each model class and the
   * searchableFields the existing tables declare.
   */
  searchFields: Array<string>;
  /** PageMap key of the entity's view page (takes a modelId route param). */
  viewPageMap: PageMap;
  icon: IconProp;
  /** Tailwind color name — matches the NavBar item for the same entity. */
  iconColor: string;
}

/*
 * Field lists mirror the searchableFields of the corresponding table
 * components (MonitorTable, IncidentsTable, AlertsTable, StatusPages,
 * OnCallDutyPolicies) — every column below exists on the model class.
 */
export function getEntitySearchSpecs(): Array<PaletteEntitySearchSpec> {
  return [
    {
      id: "monitors",
      titleField: "name",
      searchFields: ["name", "description"],
      viewPageMap: PageMap.MONITOR_VIEW,
      icon: IconProp.AltGlobe,
      iconColor: "blue",
    },
    {
      id: "incidents",
      titleField: "title",
      searchFields: ["title", "description"],
      viewPageMap: PageMap.INCIDENT_VIEW,
      icon: IconProp.Alert,
      iconColor: "rose",
    },
    {
      id: "alerts",
      titleField: "title",
      searchFields: ["title", "description"],
      viewPageMap: PageMap.ALERT_VIEW,
      icon: IconProp.ExclaimationCircle,
      iconColor: "amber",
    },
    {
      id: "status-pages",
      titleField: "name",
      searchFields: ["name", "description"],
      viewPageMap: PageMap.STATUS_PAGE_VIEW,
      icon: IconProp.CheckCircle,
      iconColor: "emerald",
    },
    {
      id: "on-call-policies",
      titleField: "name",
      searchFields: ["name", "description"],
      viewPageMap: PageMap.ON_CALL_DUTY_POLICY_VIEW,
      icon: IconProp.Call,
      iconColor: "stone",
    },
  ];
}

/*
 * The exact query fragment BaseModelTable builds for its search box
 * (`(fragment as any)._multiFieldSearch = new MultiSearch({fields, value})`)
 * — the server turns it into one OR-joined ILIKE across the named columns.
 */
export function buildEntitySearchQuery(
  spec: PaletteEntitySearchSpec,
  searchText: string,
): JSONObject {
  return {
    _multiFieldSearch: new MultiSearch({
      fields: spec.searchFields,
      value: searchText.trim(),
    }),
  } as unknown as JSONObject;
}

/** Only the id and the display column — the palette needs nothing else. */
export function buildEntitySearchSelect(
  spec: PaletteEntitySearchSpec,
): JSONObject {
  return {
    _id: true,
    [spec.titleField]: true,
  } as unknown as JSONObject;
}

export function buildEntitySearchSort(
  spec: PaletteEntitySearchSpec,
): JSONObject {
  return {
    [spec.titleField]: SortOrder.Ascending,
  } as unknown as JSONObject;
}
