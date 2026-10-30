import PageMap from "./PageMap";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The Data Security menu, as data.
 *
 * Data Security answers four questions, in the order people ask them: what
 * sensitive data do we have, where is it, who can reach it, and what do we
 * fix first. The menu reads the same way:
 *
 *   Data Security   the everyday pages: the Overview, every Data Store,
 *                   the Issues to fix (with how many are open), the
 *                   Sensitive Data found, what turned up In Your Telemetry,
 *                   where data flows, who has Access, and Compliance
 *   Settings        how the project's data is judged, set up once: Data
 *                   Types, Checks, Residency Rules, and Scan Settings (what
 *                   is read, how often, and what follows an issue)
 *   Rules           who owns a store and how it is labelled, assigned by
 *                   rules rather than by hand
 *   Help            the setup guide, for a first visit
 *   Advanced        what is looked at when something needs checking: every
 *                   Scan that ran and what it read, and the stores that are
 *                   gone from their clouds, kept with their history - last,
 *                   as Advanced closes every menu
 *
 * Settings, Rules, Help and Advanced fold by their titles
 * (SECTION_TITLES_COLLAPSED_BY_DEFAULT), and each opens by itself on its
 * own pages. The scans had a section of their own, "Scanning", which most
 * languages read as "a scan is running"; so does the settings page's old
 * name, which is now Scan Settings.
 *
 * Kept free of React so the menu - its sections, their order, the pages and
 * their names - can be read by the breadcrumbs and by Search (PageSearchIndex)
 * and pinned in plain tests.
 */

// A live count beside an entry: the issues still open.
export type DataSecurityMenuBadge = "openIssues";

export interface DataSecurityMenuItem {
  page: PageMap;
  title: string;
  icon: IconProp;
  badge?: DataSecurityMenuBadge | undefined;
}

export interface DataSecurityMenuSection {
  title: string;
  items: Array<DataSecurityMenuItem>;
  /*
   * Folded to its title until someone opens it, or is on one of its pages,
   * for a section whose title does not fold by itself.
   */
  startsCollapsed?: boolean | undefined;
}

export const DATA_SECURITY_MENU: Array<DataSecurityMenuSection> = [
  {
    title: "Data Security",
    items: [
      {
        page: PageMap.DATA_SECURITY_OVERVIEW,
        title: "Overview",
        icon: IconProp.ChartBar,
      },
      {
        page: PageMap.DATA_SECURITY_STORES,
        title: "Data Stores",
        icon: IconProp.Database,
      },
      {
        page: PageMap.DATA_SECURITY_ISSUES,
        title: "Issues",
        icon: IconProp.ShieldExclamation,
        badge: "openIssues",
      },
      {
        page: PageMap.DATA_SECURITY_SENSITIVE_DATA,
        title: "Sensitive Data",
        icon: IconProp.Fingerprint,
      },
      {
        page: PageMap.DATA_SECURITY_TELEMETRY,
        title: "In Your Telemetry",
        icon: IconProp.Logs,
      },
      {
        page: PageMap.DATA_SECURITY_FLOWS,
        title: "Data Flows",
        icon: IconProp.Share,
      },
      {
        page: PageMap.DATA_SECURITY_ACCESS,
        title: "Access",
        icon: IconProp.Key,
      },
      {
        page: PageMap.DATA_SECURITY_COMPLIANCE,
        title: "Compliance",
        icon: IconProp.ClipboardDocumentCheck,
      },
    ],
  },
  {
    title: "Settings",
    items: [
      {
        page: PageMap.DATA_SECURITY_SETTINGS_DATA_TYPES,
        title: "Data Types",
        icon: IconProp.TableCells,
      },
      {
        page: PageMap.DATA_SECURITY_SETTINGS_CHECKS,
        title: "Checks",
        icon: IconProp.CheckCircle,
      },
      {
        page: PageMap.DATA_SECURITY_SETTINGS_RESIDENCY,
        title: "Residency Rules",
        icon: IconProp.Globe,
      },
      {
        page: PageMap.DATA_SECURITY_SETTINGS_SCANNING,
        title: "Scan Settings",
        icon: IconProp.Clock,
      },
    ],
  },
  {
    title: "Rules",
    items: [
      {
        page: PageMap.DATA_SECURITY_SETTINGS_OWNER_RULES,
        title: "Owner Rules",
        icon: IconProp.User,
      },
      {
        page: PageMap.DATA_SECURITY_SETTINGS_LABEL_RULES,
        title: "Label Rules",
        icon: IconProp.Tag,
      },
    ],
  },
  {
    title: "Help",
    items: [
      {
        page: PageMap.DATA_SECURITY_DOCUMENTATION,
        title: "Documentation",
        icon: IconProp.Book,
      },
    ],
  },
  {
    /*
     * Records looked at when something needs checking, not every visit:
     * every scan and what it read, and the way back to the stores that are
     * gone from their clouds, which the Data Stores list leaves out. Last,
     * as Advanced closes every menu.
     */
    title: "Advanced",
    items: [
      {
        page: PageMap.DATA_SECURITY_SCANS,
        title: "Scans",
        icon: IconProp.MagnifyingGlass,
      },
      {
        page: PageMap.DATA_SECURITY_STORES_ARCHIVED,
        title: "Archived Stores",
        icon: IconProp.Archive,
      },
    ],
  },
];

// Where the product opens: the Overview.
export const DATA_SECURITY_LANDING_PAGE: PageMap =
  PageMap.DATA_SECURITY_OVERVIEW;

/*
 * The pages that open on their own, outside the menu's layout, reached from
 * their lists: a store's pages and an issue's pages, each under a side menu
 * of its own.
 */
export const DATA_SECURITY_STORE_VIEW_PAGES: Array<PageMap> = [
  PageMap.DATA_SECURITY_STORE_VIEW,
  PageMap.DATA_SECURITY_STORE_VIEW_INSIDE,
  PageMap.DATA_SECURITY_STORE_VIEW_ACCESS,
  PageMap.DATA_SECURITY_STORE_VIEW_ISSUES,
  PageMap.DATA_SECURITY_STORE_VIEW_FLOWS,
  PageMap.DATA_SECURITY_STORE_VIEW_SCANS,
  PageMap.DATA_SECURITY_STORE_VIEW_TIMELINE,
  PageMap.DATA_SECURITY_STORE_VIEW_OWNERS,
  PageMap.DATA_SECURITY_STORE_VIEW_SETTINGS,
  PageMap.DATA_SECURITY_STORE_VIEW_DELETE,
];

export const DATA_SECURITY_ISSUE_VIEW_PAGES: Array<PageMap> = [
  PageMap.DATA_SECURITY_ISSUE_VIEW,
  PageMap.DATA_SECURITY_ISSUE_VIEW_TIMELINE,
  PageMap.DATA_SECURITY_ISSUE_VIEW_DELETE,
];

// Every entry of the menu, in menu order.
export function getDataSecurityMenuItems(): Array<DataSecurityMenuItem> {
  return DATA_SECURITY_MENU.flatMap(
    (section: DataSecurityMenuSection): Array<DataSecurityMenuItem> => {
      return section.items;
    },
  );
}

// The section a page sits in, if the menu lists it.
export function getDataSecurityMenuSectionFor(
  page: PageMap | undefined,
): DataSecurityMenuSection | undefined {
  if (!page) {
    return undefined;
  }

  return DATA_SECURITY_MENU.find(
    (section: DataSecurityMenuSection): boolean => {
      return section.items.some((item: DataSecurityMenuItem): boolean => {
        return item.page === page;
      });
    },
  );
}

// A page's entry in the menu, if it has one.
export function getDataSecurityMenuItemFor(
  page: PageMap | undefined,
): DataSecurityMenuItem | undefined {
  if (!page) {
    return undefined;
  }

  return getDataSecurityMenuItems().find(
    (item: DataSecurityMenuItem): boolean => {
      return item.page === page;
    },
  );
}
