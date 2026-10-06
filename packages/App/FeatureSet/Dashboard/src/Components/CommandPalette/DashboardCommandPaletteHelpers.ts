import PageMap from "../../Utils/PageMap";
import {
  PageSearchAction,
  PageSearchArea,
  PageSearchGate,
  PageSearchPage,
  PageSearchPermission,
  PageSearchSection,
} from "./PageSearchIndex";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "Common/Types/HeldPermissions";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
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

/*
 * Between two equally good search matches: a product first, then a page (or
 * an action done on one, such as Delete Project), then the palette's own
 * actions and quick links. "pager" opens On-Call Duty, then On-Call
 * Policies, then My On-Call Policies.
 */
export const PALETTE_SEARCH_PRIORITY: {
  product: number;
  page: number;
  action: number;
} = {
  product: 2,
  page: 1,
  action: 0,
};

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
  keywords?: Array<string> | undefined;
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

// ---- every page: the search index → command descriptors -------------------

/*
 * What decides, for one person in one project, which of the index's pages
 * and actions Search offers. Pages follow the menus: a page the menus show
 * is offered (the page itself says when you may not change it). Actions
 * that change something are offered only to people allowed to do them.
 */
export interface PageSearchAvailability {
  // Billing, invoices and AI credits exist only where billing is turned on.
  isBillingEnabled: boolean;
  // The project has monitor groups turned on.
  isMonitorGroupsEnabled: boolean;
  // May delete the project (Project Owner, or Delete Project).
  canDeleteProject: boolean;
}

export interface PageSearchCommandDescriptor {
  // Stable across projects and languages: recents remember it.
  id: string;
  // In the reader's language.
  title: string;
  // Its English title, when that is not the title: searched as the title.
  titleAliases: Array<string>;
  // Other words for it ("pager", "2fa"), never shown.
  keywords: Array<string>;
  // Where it lives, in the reader's language: ["Project Settings", "Advanced"].
  breadcrumb: Array<string>;
  // The breadcrumb in English, searched but not shown.
  breadcrumbKeywords: Array<string>;
  icon?: IconProp | undefined;
  iconColor: string;
  // The path it opens in the current project, with its query string.
  routePath: string;
  // The index area it comes from.
  areaId: string;
  // A thing done on a page ("Delete Project") rather than the page itself.
  isAction: boolean;
}

export interface BuildPageSearchCommandsInput {
  areas: ReadonlyArray<PageSearchArea>;
  availability: PageSearchAvailability;
  // A page key's route template ("/dashboard/:projectId/settings/api-keys").
  getRouteTemplate: (pageKey: string) => string | undefined;
  // A page key's route in the current project (":projectId" left in without one).
  getRoutePath: (pageKey: string) => string | undefined;
  /*
   * The products menu's name for the product a route opens, in the reader's
   * language, so a breadcrumb names a product exactly as that menu does.
   */
  getProductTitle: (routePath: string) => string | undefined;
  // A menu's English text in the reader's language.
  translate: (text: string) => string;
  /*
   * The products the palette already lists. A page that is the same place
   * under the same name ("Workflows" in Workflows) is left out rather than
   * listed twice.
   */
  catalog: Array<{ routePath: string; title: string }>;
}

const isGateOpen: (
  gate: PageSearchGate | undefined,
  availability: PageSearchAvailability,
) => boolean = (
  gate: PageSearchGate | undefined,
  availability: PageSearchAvailability,
): boolean => {
  if (gate === PageSearchGate.Billing) {
    return availability.isBillingEnabled;
  }

  if (gate === PageSearchGate.MonitorGroups) {
    return availability.isMonitorGroupsEnabled;
  }

  return true;
};

const isActionAllowed: (
  action: PageSearchAction,
  availability: PageSearchAvailability,
) => boolean = (
  action: PageSearchAction,
  availability: PageSearchAvailability,
): boolean => {
  if (action.permission === PageSearchPermission.DeleteProject) {
    return availability.canDeleteProject;
  }

  return true;
};

const isSameName: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

/*
 * The English behind a translated name, searched so English still finds the
 * page in any language. Nothing when the name shown is the English.
 */
const englishUnlessShown: (shown: string, english: string) => Array<string> = (
  shown: string,
  english: string,
): Array<string> => {
  return isSameName(shown, english) ? [] : [english];
};

/*
 * Turn the page index into palette command descriptors for one person in one
 * project: gated pages and actions dropped, names translated, breadcrumbs
 * built ("Project Settings > Advanced"), and pages that cannot be opened
 * right now (no project selected) left out.
 */
export function buildPageSearchCommandDescriptors(
  input: BuildPageSearchCommandsInput,
): Array<PageSearchCommandDescriptor> {
  const descriptors: Array<PageSearchCommandDescriptor> = [];

  for (const area of input.areas) {
    const productRoutePath: string | undefined = area.productPage
      ? input.getRoutePath(area.productPage)
      : undefined;
    const areaTitle: string =
      (productRoutePath && input.getProductTitle(productRoutePath)) ||
      input.translate(area.title);

    for (const section of area.sections) {
      if (!isGateOpen(section.gate, input.availability)) {
        continue;
      }

      for (const page of section.pages) {
        if (!isGateOpen(page.gate, input.availability)) {
          continue;
        }

        const template: string | undefined = input.getRouteTemplate(page.page);
        const path: string | undefined = input.getRoutePath(page.page);

        if (!template || !path) {
          continue;
        }

        const queryString: string = page.queryString || "";
        const routePath: string = path + queryString;

        if (!isRoutePathNavigable(routePath)) {
          continue;
        }

        const title: string = input.translate(page.title);

        /*
         * The section is named only when it says more than the area or the
         * page: API Keys is under "Project Settings > Advanced", the Danger
         * Zone page under "Project Settings".
         */
        const sectionTitle: string | undefined =
          section.title &&
          !isSameName(section.title, area.title) &&
          !isSameName(section.title, page.title)
            ? section.title
            : undefined;

        const breadcrumb: Array<string> = [areaTitle];
        const breadcrumbKeywords: Array<string> = [area.title];

        if (sectionTitle) {
          breadcrumb.push(input.translate(sectionTitle));
          breadcrumbKeywords.push(sectionTitle);
        }

        const isListedProduct: boolean = input.catalog.some(
          (product: { routePath: string; title: string }): boolean => {
            return (
              product.routePath === routePath &&
              isSameName(product.title, title)
            );
          },
        );

        if (!isListedProduct) {
          descriptors.push({
            id: slugifyPaletteCommandId("page", template + queryString),
            title,
            titleAliases: englishUnlessShown(title, page.title),
            keywords: page.keywords || [],
            breadcrumb,
            breadcrumbKeywords,
            icon: page.icon || area.icon,
            iconColor: area.iconColor,
            routePath,
            areaId: area.id,
            isAction: false,
          });
        }

        for (const action of page.actions || []) {
          if (!isActionAllowed(action, input.availability)) {
            continue;
          }

          const actionTitle: string = input.translate(action.title);

          /*
           * An action names the page it is done on: Delete Project is under
           * "Project Settings > Danger Zone".
           */
          const actionBreadcrumb: Array<string> = isSameName(
            breadcrumb[breadcrumb.length - 1] || "",
            title,
          )
            ? breadcrumb
            : [...breadcrumb, title];

          descriptors.push({
            id: slugifyPaletteCommandId("page-action", action.id),
            title: actionTitle,
            titleAliases: englishUnlessShown(actionTitle, action.title),
            keywords: action.keywords || [],
            breadcrumb: actionBreadcrumb,
            breadcrumbKeywords: [...breadcrumbKeywords, page.title],
            icon: action.icon || page.icon || area.icon,
            iconColor: area.iconColor,
            routePath,
            areaId: area.id,
            isAction: true,
          });
        }
      }
    }
  }

  return descriptors;
}

export interface PageSearchIndexEntry {
  area: PageSearchArea;
  section: PageSearchSection;
  page: PageSearchPage;
}

// Every page of the index, flattened, in index order.
export function getPageSearchIndexEntries(
  areas: ReadonlyArray<PageSearchArea>,
): Array<PageSearchIndexEntry> {
  const entries: Array<PageSearchIndexEntry> = [];

  for (const area of areas) {
    for (const section of area.sections) {
      for (const page of section.pages) {
        entries.push({ area, section, page });
      }
    }
  }

  return entries;
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

// A model whose own permission list for an operation is asked about.
interface PaletteGatedModel {
  isOperationalResource?: boolean | undefined;
  getCreatePermissions: () => Array<Permission>;
  getDeletePermissions: () => Array<Permission>;
}

/*
 * Whether the snapshot holds one of a model's own permissions for an
 * operation, by the rule the server follows (HeldPermissionsUtil
 * .holdsModelPermission): one of the permissions held, no team block on any
 * of them, and the operational resource wildcard for a model that is one.
 * The snapshot arrives whole (PermissionGate.getHeldPermissions) so this
 * stays pure.
 */
function holdsModelPermission(data: {
  model: PaletteGatedModel;
  operation: "create" | "delete";
  held: HeldPermissions;
}): boolean {
  return HeldPermissionsUtil.holdsModelPermission(data.held, {
    isOperationalResource: data.model.isOperationalResource,
    operation: data.operation,
    modelPermissions:
      (data.operation === "create"
        ? data.model.getCreatePermissions()
        : data.model.getDeletePermissions()) || [],
  });
}

/*
 * Mirror of BaseModelTable's create-button gating: the user can run a create
 * action when their permission snapshot grants create on the model, or they
 * are a master admin.
 */
export function computeCreateActionGates(data: {
  // What the user holds, blocks included (PermissionGate.getHeldPermissions).
  held: HeldPermissions | null;
  isMasterAdmin: boolean;
}): PaletteCreateActionGates {
  const canCreate: (model: PaletteGatedModel) => boolean = (
    model: PaletteGatedModel,
  ): boolean => {
    if (data.isMasterAdmin) {
      return true;
    }
    if (!data.held) {
      // A missing snapshot (e.g. right after SSO login) hides create actions.
      return false;
    }
    return holdsModelPermission({
      model: model,
      operation: "create",
      held: data.held,
    });
  };

  return {
    canCreateIncident: canCreate(new Incident()),
    canCreateMonitor: canCreate(new Monitor()),
    canCreateAlert: canCreate(new Alert()),
    canCreateScheduledMaintenance: canCreate(new ScheduledMaintenance()),
    canCreateAnnouncement: canCreate(new StatusPageAnnouncement()),
  };
}

/*
 * The same rule for the actions the page index offers: Delete Project needs
 * the project's delete permission (Project Owner or Delete Project), or a
 * master admin. A missing permission snapshot hides it.
 */
export function canDeleteProject(data: {
  // What the user holds, blocks included (PermissionGate.getHeldPermissions).
  held: HeldPermissions | null;
  isMasterAdmin: boolean;
}): boolean {
  if (data.isMasterAdmin) {
    return true;
  }

  if (!data.held) {
    return false;
  }

  return holdsModelPermission({
    model: new Project(),
    operation: "delete",
    held: data.held,
  });
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
