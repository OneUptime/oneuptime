import PageMap from "../../Utils/PageMap";
import {
  PageSearchAction,
  PageSearchArea,
  PageSearchGate,
  PageSearchPage,
  PageSearchPermission,
  PageSearchSection,
  PageSearchSetting,
} from "./PageSearchIndex";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import ProductKey from "Common/Types/Product/ProductKey";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "Common/Types/HeldPermissions";
import Alert from "Common/Models/DatabaseModels/Alert";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import {
  RecordNumberColumns,
  getNumberedRecordName,
  getRecordNumber,
  getRecordNumberColumns,
} from "Common/Utils/Project/RecordNumber";
import { withMeaningKeyAsItsWord } from "Common/Types/MeaningKeys";

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
 * an action done on one, such as Delete Project), then a setting on a page,
 * then the palette's own actions and quick links. "pager" opens On-Call
 * Duty, then On-Call Policies, then My On-Call Policies; "monitor groups"
 * opens the Monitor Groups page, then the Feature Flags switch that turns
 * them on. On a record's page, that record's own pages come before the
 * pages of the same name that open without a record (#9204): "settings" on
 * a status page opens its Settings before Project Settings' pages.
 */
export const PALETTE_SEARCH_PRIORITY: {
  product: number;
  recordPage: number;
  page: number;
  setting: number;
  action: number;
} = {
  product: 2,
  recordPage: 1.5,
  page: 1,
  setting: 0.5,
  action: 0,
};

/*
 * What a result named for another product ("Import from PagerDuty") gives up
 * in Search (PaletteCommand.searchPenalty): enough that a word one of
 * OneUptime's own pages holds, even as the start of one of its other names
 * ("pager", "pag"), opens that page first, while a name only the import
 * holds ("pagerduty", "uptime kuma") opens the import.
 */
export const PALETTE_ANOTHER_PRODUCT_SEARCH_PENALTY: number = 12;

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
  /*
   * Offered only to someone searching (#6814): a product the project hides
   * is still found by Search, but browsing lists the products it shows.
   */
  isSearchOnly?: boolean | undefined;
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
  /*
   * OneUptime Cloud records its setup pages (#6834), so the switches that
   * turn it off are on the page. Absent is off.
   */
  isDashboardRecordingOn?: boolean | undefined;
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
  /*
   * The key its title is looked up by, as the index writes it: a page's or
   * a setting's name, or an action's template, which titleValues fill once
   * it is translated ("Import from {{tool}}", { tool: "PagerDuty" }). Ask
   * AI's page catalog keeps them, so its Go to button and its chip draw
   * the title in the reader's language (#8834).
   */
  titleKey: string;
  titleValues?: Record<string, string> | undefined;
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
  /*
   * A setting on a page ("Require SSO to Sign In" on SSO), named as its card
   * or switch names it, rather than the page itself.
   */
  isSetting: boolean;
  /*
   * A setting's: the id of its page's own result, which it never comes
   * before (PaletteCommand.onPageCommandId).
   */
  onPageId?: string | undefined;
  /*
   * Named for another product: it gives way to OneUptime's own pages
   * (PALETTE_ANOTHER_PRODUCT_SEARCH_PENALTY).
   */
  isNamedForAnotherProduct?: boolean | undefined;
  /*
   * Found only by a query that holds one of these names whole: "Import from
   * incident.io" by "incident.io", never by "incident" (#7034).
   */
  foundOnlyByWholeName?: Array<string> | undefined;
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

  if (gate === PageSearchGate.DashboardRecording) {
    return availability.isDashboardRecordingOn === true;
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
 * A name of the index as English draws it, searched without being shown.
 * The index names a page by its locale key, and a key that names its
 * meaning is not its English: the explorers' tab is "Insights (explorer
 * analytics)", which English draws as "Insights" (Common/Types/MeaningKeys).
 * Searched as written, the note to translators found the tab for
 * "analytics" in every language (#8830).
 */
export const englishOfIndexName: (key: string) => string =
  withMeaningKeyAsItsWord;

/*
 * The English behind a translated name, searched so English still finds the
 * page in any language: the English the Dashboard draws for `key`. Nothing
 * when the name shown is that English.
 */
const englishUnlessShown: (shown: string, key: string) => Array<string> = (
  shown: string,
  key: string,
): Array<string> => {
  const english: string = englishOfIndexName(key);

  return isSameName(shown, english) ? [] : [english];
};

/*
 * A title with its {{placeholders}} filled, after it is translated: the
 * values are brands ("PagerDuty"), the same in every language.
 */
export const fillPageSearchTitle: (
  title: string,
  values: Record<string, string> | undefined,
) => string = (
  title: string,
  values: Record<string, string> | undefined,
): string => {
  let filled: string = title;

  for (const name of Object.keys(values || {})) {
    filled = filled.split(`{{${name}}}`).join(values![name]!);
  }

  return filled;
};

/*
 * The settings of a page that are there for this person, each as its card
 * or switch names it, in the order the page lists them: Customer Support
 * Access only where billing is on, as its card is. A setting that would
 * only repeat its page's own name is the page's result already.
 */
export const getOfferedPageSettings: (
  page: PageSearchPage,
  availability: PageSearchAvailability,
) => Array<PageSearchSetting> = (
  page: PageSearchPage,
  availability: PageSearchAvailability,
): Array<PageSearchSetting> => {
  return (page.settings || [])
    .map((setting: string | PageSearchSetting): PageSearchSetting => {
      return typeof setting === "string" ? { name: setting } : setting;
    })
    .filter((setting: PageSearchSetting): boolean => {
      return (
        isGateOpen(setting.gate, availability) &&
        !isSameName(setting.name, page.title)
      );
    });
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
        // Where it is in English, as the Dashboard draws it: searched, not shown.
        const breadcrumbKeywords: Array<string> = [
          englishOfIndexName(area.title),
        ];

        if (sectionTitle) {
          breadcrumb.push(input.translate(sectionTitle));
          breadcrumbKeywords.push(englishOfIndexName(sectionTitle));
        }

        const isListedProduct: boolean = input.catalog.some(
          (product: { routePath: string; title: string }): boolean => {
            return (
              product.routePath === routePath &&
              isSameName(product.title, title)
            );
          },
        );

        /*
         * The page's own result: its row here, or the product's where the
         * products menu lists the page as a product.
         */
        const pageCommandId: string = isListedProduct
          ? slugifyPaletteCommandId("nav", template)
          : slugifyPaletteCommandId("page", template + queryString);

        /*
         * An action named as its page is, that opens the page as it is,
         * stands in for the page's own row: "Delete Project" is the page
         * the Danger Zone holds and the action done there, and two rows of
         * one name led to one place (#9134). Someone the action is not
         * offered to still finds the page, which says why.
         */
        const standInAction: PageSearchAction | undefined = (
          page.actions || []
        ).find((action: PageSearchAction): boolean => {
          return (
            isActionAllowed(action, input.availability) &&
            action.queryString === undefined &&
            !action.anchor &&
            isSameName(action.title, page.title)
          );
        });

        if (!isListedProduct && !standInAction) {
          descriptors.push({
            id: pageCommandId,
            title,
            titleAliases: englishUnlessShown(title, page.title),
            titleKey: page.title,
            keywords: page.keywords || [],
            breadcrumb,
            breadcrumbKeywords,
            icon: page.icon || area.icon,
            iconColor: area.iconColor,
            routePath,
            areaId: area.id,
            isAction: false,
            isSetting: false,
          });
        }

        /*
         * An action, or a setting, names the page it is on: Delete Project
         * is under "Project Settings > Danger Zone", Require SSO to Sign In
         * under "Project Settings > Security > SSO".
         */
        const onPageBreadcrumb: Array<string> = isSameName(
          breadcrumb[breadcrumb.length - 1] || "",
          title,
        )
          ? breadcrumb
          : [...breadcrumb, title];

        for (const action of page.actions || []) {
          if (!isActionAllowed(action, input.availability)) {
            continue;
          }

          const actionTitle: string = fillPageSearchTitle(
            input.translate(action.title),
            action.titleValues,
          );
          const englishActionTitle: string = fillPageSearchTitle(
            englishOfIndexName(action.title),
            action.titleValues,
          );
          // Its own query string, where it opens the page on itself.
          const actionRoutePath: string =
            action.queryString !== undefined
              ? path + action.queryString
              : routePath;

          descriptors.push({
            id: slugifyPaletteCommandId("page-action", action.id),
            title: actionTitle,
            titleAliases: englishUnlessShown(actionTitle, englishActionTitle),
            titleKey: action.title,
            ...(action.titleValues
              ? { titleValues: { ...action.titleValues } }
              : {}),
            keywords:
              action === standInAction
                ? [...(action.keywords || []), ...(page.keywords || [])]
                : action.keywords || [],
            breadcrumb:
              action === standInAction ? breadcrumb : onPageBreadcrumb,
            breadcrumbKeywords: [
              ...breadcrumbKeywords,
              englishOfIndexName(page.title),
            ],
            icon: action.icon || page.icon || area.icon,
            iconColor: area.iconColor,
            /*
             * At its place on the page, when it has one: a card folded under
             * More settings opens there.
             */
            routePath: action.anchor
              ? `${actionRoutePath}#${action.anchor}`
              : actionRoutePath,
            areaId: area.id,
            isAction: true,
            isSetting: false,
            ...(action.isNamedForAnotherProduct
              ? { isNamedForAnotherProduct: true }
              : {}),
            ...(action.foundOnlyByWholeName &&
            action.foundOnlyByWholeName.length > 0
              ? { foundOnlyByWholeName: [...action.foundOnlyByWholeName] }
              : {}),
          });
        }

        /*
         * Each setting a result of its own, named as its card or switch
         * names it: "cancel plan" finds Cancel Plan, under "Project
         * Settings > Billing and Invoices > Billing", rather than a row
         * called Billing that never says why it was found.
         */
        for (const setting of getOfferedPageSettings(
          page,
          input.availability,
        )) {
          const settingTitle: string = input.translate(setting.name);

          descriptors.push({
            id: slugifyPaletteCommandId(
              "page-setting",
              `${template}${queryString} ${setting.name}`,
            ),
            title: settingTitle,
            titleAliases: englishUnlessShown(settingTitle, setting.name),
            titleKey: setting.name,
            keywords: [],
            breadcrumb: onPageBreadcrumb,
            breadcrumbKeywords: [
              ...breadcrumbKeywords,
              englishOfIndexName(page.title),
            ],
            icon: page.icon || area.icon,
            iconColor: area.iconColor,
            // At its card, where it waits folded under More settings.
            routePath: setting.anchor
              ? `${routePath}#${setting.anchor}`
              : routePath,
            areaId: area.id,
            isAction: false,
            isSetting: true,
            onPageId: pageCommandId,
          });
        }
      }
    }
  }

  return descriptors;
}

/*
 * How a result of the page index ranks against the rest, as Search reads
 * it: between equally good matches a page before a setting on a page, and
 * a setting never before the page it is on; and what a query has to hold
 * for it to be found at all. The palette and the tests that search the
 * index both read it here.
 */
export interface PageSearchCommandRanking {
  searchPriority: number;
  onPageCommandId?: string | undefined;
  searchPenalty?: number | undefined;
  foundOnlyByWholeName?: Array<string> | undefined;
}

// Where a result of the page index ranks, between equally good matches.
const getPageSearchCommandPlace: (
  descriptor: PageSearchCommandDescriptor,
) => PageSearchCommandRanking = (
  descriptor: PageSearchCommandDescriptor,
): PageSearchCommandRanking => {
  // "Import from PagerDuty" gives way to OneUptime's own pages.
  if (descriptor.isNamedForAnotherProduct) {
    return {
      searchPriority: PALETTE_SEARCH_PRIORITY.page,
      searchPenalty: PALETTE_ANOTHER_PRODUCT_SEARCH_PENALTY,
    };
  }

  if (!descriptor.isSetting) {
    return { searchPriority: PALETTE_SEARCH_PRIORITY.page };
  }

  return {
    searchPriority: PALETTE_SEARCH_PRIORITY.setting,
    onPageCommandId: descriptor.onPageId,
  };
};

export const getPageSearchCommandRanking: (
  descriptor: PageSearchCommandDescriptor,
) => PageSearchCommandRanking = (
  descriptor: PageSearchCommandDescriptor,
): PageSearchCommandRanking => {
  const ranking: PageSearchCommandRanking =
    getPageSearchCommandPlace(descriptor);

  // "Import from incident.io" is found only by its whole name (#7034).
  return descriptor.foundOnlyByWholeName
    ? { ...ranking, foundOnlyByWholeName: descriptor.foundOnlyByWholeName }
    : ranking;
};

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
  | "action-create-status-page"
  | "action-create-on-call-policy"
  | "action-create-on-call-schedule"
  | "action-create-dashboard"
  | "action-create-workflow"
  | "action-invite-user"
  | "action-toggle-theme"
  | "action-system-theme"
  | "action-ask-ai"
  | "action-keyboard-shortcuts"
  | "action-how-oneuptime-works"
  | "action-glossary"
  | "action-give-feedback"
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
  /*
   * The actions that open a list's create form (#7035,
   * PALETTE_LIST_CREATE_ACTIONS). Left out, they are not offered.
   */
  canCreateStatusPage?: boolean | undefined;
  canCreateOnCallPolicy?: boolean | undefined;
  canCreateOnCallSchedule?: boolean | undefined;
  canCreateDashboard?: boolean | undefined;
  canCreateWorkflow?: boolean | undefined;
  // Invite User: a membership of the project's teams, created.
  canInviteUser?: boolean | undefined;
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
    canCreateStatusPage: canCreate(new StatusPage()),
    canCreateOnCallPolicy: canCreate(new OnCallDutyPolicy()),
    canCreateOnCallSchedule: canCreate(new OnCallDutyPolicySchedule()),
    canCreateDashboard: canCreate(new Dashboard()),
    canCreateWorkflow: canCreate(new Workflow()),
    canInviteUser: canCreate(new TeamMember()),
  };
}

/*
 * Whether Search looks for a kind of record at all (#6816): only when the
 * person may read it, by the rule the server follows for a list - one of
 * the model's read permissions held and not blocked, or the operational
 * resource wildcard. A kind they may not read would only send a request
 * the server refuses. A master admin reads everything. A snapshot that
 * holds nothing at all - missing, or not read yet, right after SSO login -
 * leaves it to the server, as Search did for every kind before: what the
 * server will not list, it does not send.
 */
export function canSearchRecordsOf(data: {
  model: {
    isOperationalResource?: boolean | undefined;
    getReadPermissions: () => Array<Permission>;
  };
  // What the user holds, blocks included (PermissionGate.getHeldPermissions).
  held: HeldPermissions | null;
  isMasterAdmin: boolean;
}): boolean {
  if (data.isMasterAdmin || !data.held || data.held.allowed.length === 0) {
    return true;
  }

  return HeldPermissionsUtil.holdsModelPermission(data.held, {
    isOperationalResource: data.model.isOperationalResource,
    operation: "read",
    modelPermissions: data.model.getReadPermissions() || [],
  });
}

/*
 * Whether Search looks for the project's people (#7036): only for someone
 * who may see them as the Users page lists them - the project's memberships
 * read with each one's user, which needs one of the user column's read
 * permissions and no team's block on them (the server's own check,
 * Server/Utils/Team/ProjectMemberSearch, holds anyone else to a refusal). A
 * master admin sees everyone. A snapshot that holds nothing at all leaves it
 * to the server, as canSearchRecordsOf does.
 */
export function canSearchMembers(data: {
  // What the user holds, blocks included (PermissionGate.getHeldPermissions).
  held: HeldPermissions | null;
  isMasterAdmin: boolean;
}): boolean {
  if (data.isMasterAdmin || !data.held || data.held.allowed.length === 0) {
    return true;
  }

  const membership: TeamMember = new TeamMember();

  return (
    canSearchRecordsOf({
      model: membership,
      held: data.held,
      isMasterAdmin: data.isMasterAdmin,
    }) &&
    HeldPermissionsUtil.holdsColumnPermission(data.held, {
      isOperationalResource: membership.isOperationalResource,
      operation: "read",
      tablePermissions: membership.getReadPermissions() || [],
      columnPermissions:
        membership.getColumnAccessControlFor("user")?.read || [],
    })
  );
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

/*
 * Search's actions that open a list's create form (#7035): Create Status
 * Page, Create On-Call Policy, Create On-Call Schedule, Create Dashboard,
 * Create Workflow and Invite User. Unlike Declare Incident or Create
 * Monitor, none has a page of its own: each form opens on its list, so the
 * action opens the list with ?create=1 (Common/UI/Utils/CreateFormAddress),
 * which opens the form as the list's Create button does - for whoever that
 * button is open to, the gate below being the same rule. Offered while
 * searching ("create", "new", "invite", "status page"), so the list Search
 * opens on stays as short as it was. Ask AI's page catalog sends people to
 * the same addresses (AIDashboardPagesCatalog).
 */
export interface PaletteListCreateAction {
  id: PaletteActionId;
  /*
   * In English, as the list's own Create button says it: a key every
   * Dashboard locale words.
   */
  title: string;
  // The list whose create form it opens.
  page: PageMap;
  // Where the list is, in English, as the menus name it.
  where: Array<string>;
  // Other words for it, in English, never shown.
  keywords: Array<string>;
  icon: IconProp;
  iconColor: string;
  // Whether the person may create there (computeCreateActionGates).
  gate: keyof PaletteCreateActionGates;
}

export const PALETTE_LIST_CREATE_ACTIONS: ReadonlyArray<PaletteListCreateAction> =
  [
    {
      id: "action-create-status-page",
      title: "Create Status Page",
      page: PageMap.STATUS_PAGES,
      where: ["Status Pages"],
      keywords: ["new", "add", "new status page", "public status page"],
      icon: IconProp.CheckCircle,
      iconColor: "emerald",
      gate: "canCreateStatusPage",
    },
    {
      id: "action-create-on-call-policy",
      title: "Create On-Call Policy",
      page: PageMap.ON_CALL_DUTY_POLICIES,
      where: ["On-Call"],
      keywords: ["new", "add", "new on-call policy", "escalation policy"],
      icon: IconProp.Call,
      iconColor: "stone",
      gate: "canCreateOnCallPolicy",
    },
    {
      id: "action-create-on-call-schedule",
      title: "Create On-Call Schedule",
      page: PageMap.ON_CALL_DUTY_SCHEDULES,
      where: ["On-Call"],
      keywords: ["new", "add", "new on-call schedule", "new rotation"],
      icon: IconProp.Calendar,
      iconColor: "stone",
      gate: "canCreateOnCallSchedule",
    },
    {
      id: "action-create-dashboard",
      title: "Create Dashboard",
      page: PageMap.DASHBOARDS,
      where: ["Dashboards"],
      keywords: ["new", "add", "new dashboard"],
      icon: IconProp.ChartBar,
      iconColor: "violet",
      gate: "canCreateDashboard",
    },
    {
      id: "action-create-workflow",
      title: "Create Workflow",
      page: PageMap.WORKFLOWS,
      where: ["Workflows"],
      keywords: ["new", "add", "new workflow", "automation"],
      icon: IconProp.Workflow,
      iconColor: "pink",
      gate: "canCreateWorkflow",
    },
    {
      id: "action-invite-user",
      title: "Invite User",
      page: PageMap.USERS,
      where: ["Users"],
      keywords: [
        "new",
        "add",
        "add user",
        "invite member",
        "add member",
        "invite teammate",
        "add teammate",
      ],
      icon: IconProp.UserPlus,
      iconColor: "blue",
      gate: "canInviteUser",
    },
  ];

export interface PaletteActionAvailability extends PaletteCreateActionGates {
  hasProjectSelected: boolean;
  isMasterAdmin: boolean;
  /*
   * Whether the person's theme follows their device - System, or nothing
   * picked (Common/Types/Theme/ThemePreference.ts). False once they picked
   * Light or Dark: the palette then also offers the way back to System.
   * Left out, the palette offers only the switch to the other theme.
   */
  isThemeFollowingDevice?: boolean | undefined;
  /*
   * Whether this server takes feedback (#6832, ProductFeedback.isOn): Give
   * feedback is offered beside the Glossary. Left out, it is not.
   */
  canGiveFeedback?: boolean | undefined;
}

/*
 * The full visible-action decision for one render: create actions need a
 * project AND create permission; the admin dashboard needs master admin;
 * theme, Ask AI, logout and the global pages are always available, and the
 * way back to the system theme while Light or Dark is picked.
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

    // The lists' create forms (#7035), each for whoever may create there.
    for (const action of PALETTE_LIST_CREATE_ACTIONS) {
      if (availability[action.gate]) {
        actionIds.push(action.id);
      }
    }
  }

  actionIds.push("action-toggle-theme");

  if (availability.isThemeFollowingDevice === false) {
    actionIds.push("action-system-theme");
  }

  actionIds.push("action-ask-ai");
  /*
   * Never gated: the shortcuts dialog is a reference, not a capability, and
   * someone who has just met the palette is exactly who needs to find it.
   */
  actionIds.push("action-keyboard-shortcuts");
  /*
   * Never gated either (#6936): the map of the product and the Glossary
   * are for whoever is lost, which is anyone, in any project or none.
   */
  actionIds.push("action-how-oneuptime-works");
  actionIds.push("action-glossary");

  // Tell OneUptime what was hard (#6832), where the server takes feedback.
  if (availability.canGiveFeedback) {
    actionIds.push("action-give-feedback");
  }

  actionIds.push("action-active-incidents");
  actionIds.push("action-my-on-call-policies");
  actionIds.push("action-project-invitations");

  if (availability.isMasterAdmin) {
    actionIds.push("action-admin-dashboard");
  }

  actionIds.push("action-log-out");

  return actionIds;
}

/*
 * The product each action belongs to (#6815): an action of a product
 * switched off on the server is not offered. The rest belong to OneUptime
 * itself.
 */
export const PALETTE_ACTION_PRODUCTS: Readonly<
  Partial<Record<PaletteActionId, ProductKey>>
> = {
  "action-declare-incident": ProductKey.Incidents,
  "action-create-monitor": ProductKey.Monitors,
  "action-create-alert": ProductKey.Alerts,
  "action-create-scheduled-maintenance": ProductKey.ScheduledMaintenance,
  "action-create-announcement": ProductKey.StatusPages,
  "action-create-status-page": ProductKey.StatusPages,
  "action-create-on-call-policy": ProductKey.OnCall,
  "action-create-on-call-schedule": ProductKey.OnCall,
  "action-create-dashboard": ProductKey.Dashboards,
  "action-create-workflow": ProductKey.Workflows,
  "action-invite-user": ProductKey.Users,
  "action-ask-ai": ProductKey.AIChat,
  "action-active-incidents": ProductKey.Incidents,
  "action-my-on-call-policies": ProductKey.OnCall,
};

// The actions left once those of products switched off on the server go.
export function withoutActionsOfProductsOff(
  actionIds: ReadonlyArray<PaletteActionId>,
  offProducts: ReadonlyArray<ProductKey>,
): Array<PaletteActionId> {
  return actionIds.filter((actionId: PaletteActionId): boolean => {
    const product: ProductKey | undefined = PALETTE_ACTION_PRODUCTS[actionId];
    return !product || !offProducts.includes(product);
  });
}

// ---- entity search providers ------------------------------------------------

export interface PaletteEntitySearchSpec {
  /** Stable provider id, also used in the palette's section test ids. */
  id: string;
  /**
   * Which model column carries the human name of a row: name or title, and
   * an inventory item's displayName (RecordPageSearchModels).
   */
  titleField: string;
  /**
   * Columns the free-text search runs over. MUST be real entity property
   * names for the model — verified against each model class and the
   * searchableFields the existing tables declare.
   */
  searchFields: Array<string>;
  /** PageMap key of the entity's view page (takes a modelId route param). */
  viewPageMap: PageMap;
  /**
   * The columns that number a row, for an entity its project numbers
   * (incidentNumber and incidentNumberWithPrefix): a result reads "INC-18
   * Manually declared", as the record's page is headed, so two incidents
   * of one title are two results that read differently, and "INC-18"
   * finds it.
   */
  numberFields?: RecordNumberColumns | undefined;
  icon: IconProp;
  /** Tailwind color name — matches the NavBar item for the same entity. */
  iconColor: string;
  /**
   * The rows of the model this kind is, where two products show one model:
   * App Platforms' environments and Cloud's resources are both
   * CloudResource rows (RecordPageSearchModels).
   */
  filter?: JSONObject | undefined;
}

// A numbered entity is found by its number too: "INC-18".
function getNumberSearchFields(
  numberFields: RecordNumberColumns | null,
): Array<string> {
  return numberFields ? [numberFields.numberWithPrefixColumn] : [];
}

/*
 * Field lists mirror the searchableFields of the corresponding table
 * components (MonitorTable, IncidentsTable, AlertsTable, StatusPages,
 * OnCallDutyPolicies, and the lists of the kinds below them) - every column
 * below exists on the model class - and a numbered entity's number with its
 * prefix besides.
 *
 * The first five are the kinds Search always found. Then the next most
 * opened (#6816): services, hosts, on-call schedules, scheduled
 * maintenance, dashboards, workflows, runbooks and teams. Each is searched
 * only where the person may read it (canSearchRecordsOf), all in the one
 * debounced round, PALETTE_ENTITY_SEARCH_LIMIT rows each.
 */
export function getEntitySearchSpecs(): Array<PaletteEntitySearchSpec> {
  // The columns that number incidents and alerts (Utils/Project/RecordNumber).
  const incidentNumbers: RecordNumberColumns | null = getRecordNumberColumns(
    new Incident(),
  );
  const alertNumbers: RecordNumberColumns | null = getRecordNumberColumns(
    new Alert(),
  );
  const maintenanceNumbers: RecordNumberColumns | null = getRecordNumberColumns(
    new ScheduledMaintenance(),
  );

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
      searchFields: [
        "title",
        "description",
        ...getNumberSearchFields(incidentNumbers),
      ],
      viewPageMap: PageMap.INCIDENT_VIEW,
      numberFields: incidentNumbers || undefined,
      icon: IconProp.Alert,
      iconColor: "rose",
    },
    {
      id: "alerts",
      titleField: "title",
      searchFields: [
        "title",
        "description",
        ...getNumberSearchFields(alertNumbers),
      ],
      viewPageMap: PageMap.ALERT_VIEW,
      numberFields: alertNumbers || undefined,
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
    {
      id: "services",
      titleField: "name",
      searchFields: ["name", "description"],
      viewPageMap: PageMap.SERVICE_VIEW,
      icon: IconProp.SquareStack3D,
      iconColor: "indigo",
    },
    {
      id: "hosts",
      titleField: "name",
      searchFields: ["name", "description"],
      viewPageMap: PageMap.HOST_VIEW,
      icon: IconProp.Server,
      iconColor: "slate",
    },
    {
      id: "on-call-schedules",
      titleField: "name",
      searchFields: ["name", "description"],
      viewPageMap: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW,
      icon: IconProp.Calendar,
      iconColor: "stone",
    },
    {
      id: "scheduled-maintenance",
      titleField: "title",
      searchFields: [
        "title",
        "description",
        ...getNumberSearchFields(maintenanceNumbers),
      ],
      viewPageMap: PageMap.SCHEDULED_MAINTENANCE_VIEW,
      numberFields: maintenanceNumbers || undefined,
      icon: IconProp.Clock,
      iconColor: "cyan",
    },
    {
      id: "dashboards",
      titleField: "name",
      searchFields: ["name", "description"],
      viewPageMap: PageMap.DASHBOARD_VIEW,
      icon: IconProp.ChartBar,
      iconColor: "violet",
    },
    {
      id: "workflows",
      titleField: "name",
      searchFields: ["name", "description"],
      viewPageMap: PageMap.WORKFLOW_VIEW,
      icon: IconProp.Workflow,
      iconColor: "pink",
    },
    {
      id: "runbooks",
      titleField: "name",
      searchFields: ["name", "description"],
      viewPageMap: PageMap.RUNBOOK_VIEW,
      icon: IconProp.Book,
      iconColor: "amber",
    },
    {
      id: "teams",
      titleField: "name",
      searchFields: ["name", "description"],
      viewPageMap: PageMap.TEAM_VIEW,
      icon: IconProp.Team,
      iconColor: "blue",
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
    ...(spec.filter || {}),
    _multiFieldSearch: new MultiSearch({
      fields: spec.searchFields,
      value: searchText.trim(),
    }),
  } as unknown as JSONObject;
}

/**
 * Only the id and the display column — the palette needs nothing else — and
 * a numbered entity's number, which its result leads with.
 */
export function buildEntitySearchSelect(
  spec: PaletteEntitySearchSpec,
): JSONObject {
  const select: JSONObject = {
    _id: true,
    [spec.titleField]: true,
  };

  if (spec.numberFields) {
    select[spec.numberFields.numberColumn] = true;
    select[spec.numberFields.numberWithPrefixColumn] = true;
  }

  return select;
}

/**
 * What one result says: the row's name, after its number for a numbered
 * entity - "INC-18 Manually declared" - or "" for a row with no name, which
 * the palette leaves out.
 */
export function getEntitySearchResultTitle(
  spec: PaletteEntitySearchSpec,
  item: unknown,
): string {
  if (!item || typeof item !== "object") {
    return "";
  }

  const name: unknown = (item as JSONObject)[spec.titleField];

  if (typeof name !== "string" || !name.trim()) {
    return "";
  }

  return getNumberedRecordName({
    number: getRecordNumber(item, spec.numberFields),
    name: name,
  });
}

export function buildEntitySearchSort(
  spec: PaletteEntitySearchSpec,
): JSONObject {
  return {
    [spec.titleField]: SortOrder.Ascending,
  } as unknown as JSONObject;
}

// ---- switching project (#6816) ---------------------------------------------

export interface PaletteProject {
  id: string;
  name: string;
}

export interface PaletteProjectSwitchDescriptor {
  // Stable across languages: recents remember it.
  id: string;
  projectId: string;
  name: string;
}

/*
 * One result for each of the person's other projects ("Switch to Acme
 * Staging"), in the project picker's order, each once: not the project
 * they are in, nor one with no id or no name to show.
 */
export function buildProjectSwitchDescriptors(data: {
  projects: ReadonlyArray<PaletteProject>;
  currentProjectId: string;
}): Array<PaletteProjectSwitchDescriptor> {
  const seen: Set<string> = new Set();
  const descriptors: Array<PaletteProjectSwitchDescriptor> = [];

  for (const project of data.projects) {
    const name: string = project.name.trim();

    if (
      !project.id ||
      !name ||
      project.id === data.currentProjectId ||
      seen.has(project.id)
    ) {
      continue;
    }

    seen.add(project.id);
    descriptors.push({
      id: `project-switch-${project.id}`,
      projectId: project.id,
      name: name,
    });
  }

  return descriptors;
}

// Words that find every "Switch to ..." result, never shown.
export const PROJECT_SWITCH_KEYWORDS: Array<string> = [
  "switch project",
  "change project",
  "other project",
  "project",
];

// ---- the Glossary's terms (#6936) -----------------------------------------

export interface PaletteGlossaryEntry {
  // The term's anchor on the Glossary page: a GlossaryTerm value.
  id: string;
  // The term, in the Glossary's language.
  term: string;
  // Its other names ("Also called"), in the same language.
  alsoCalled: Array<string>;
}

export interface PaletteGlossaryTermDescriptor {
  id: string;
  termId: string;
  title: string;
  keywords: Array<string>;
}

/*
 * One result for each of the Glossary's terms, found by the term and its
 * other names: "probe" offers Probe, "escalation" Escalation Rule. Each
 * opens the term on the Glossary page (getGlossaryTermUrl).
 */
export function buildGlossaryTermDescriptors(
  entries: ReadonlyArray<PaletteGlossaryEntry>,
): Array<PaletteGlossaryTermDescriptor> {
  return entries
    .filter((entry: PaletteGlossaryEntry): boolean => {
      return Boolean(entry.id && entry.term.trim());
    })
    .map((entry: PaletteGlossaryEntry): PaletteGlossaryTermDescriptor => {
      return {
        id: `glossary-term-${entry.id}`,
        termId: entry.id,
        title: entry.term.trim(),
        keywords: entry.alsoCalled,
      };
    });
}

// ---- a question nothing answers (#6816) -----------------------------------

/*
 * The words a question starts with, in English: "how do I add a phone
 * number" is a question though it has no question mark.
 */
const QUESTION_WORDS: ReadonlyArray<string> = [
  "how",
  "what",
  "why",
  "where",
  "when",
  "who",
  "which",
  "can",
  "could",
  "should",
  "is",
  "are",
  "does",
  "do",
  "will",
  "would",
];

// A question mark in any script: Latin, Arabic and Persian, full width.
const QUESTION_MARKS: RegExp = /[?\u061F\uFF1F]\s*$/;

/*
 * Whether what was typed into Search reads as a question: it ends with a
 * question mark, or it is at least three words and starts with a question
 * word. "how do I add a phone number" is; "how", "status pages" and
 * "monitor?" with nothing before the mark are not worth asking.
 */
export function isQuestion(text: string): boolean {
  const trimmed: string = text.trim();

  if (!trimmed) {
    return false;
  }

  if (QUESTION_MARKS.test(trimmed)) {
    return trimmed.replace(QUESTION_MARKS, "").trim().length > 0;
  }

  const words: Array<string> = trimmed.toLowerCase().split(/\s+/);

  return words.length >= 3 && QUESTION_WORDS.includes(words[0] || "");
}
