import PageMap from "./PageMap";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The Data Observability menu, as data.
 *
 * A data engineer comes to Data Observability asking, in this order: is
 * anything wrong with our data, what is watched and where does it come
 * from, do the rules we wrote hold, and who uses it and what does it cost.
 * The menu reads the same way:
 *
 *   Data Observability  the everyday pages: the Overview (what needs
 *                       someone now), every Table, the Pipelines that write
 *                       them, what changed in their Schemas, and where they
 *                       are read from - Databases and Storage Paths
 *   Quality             the rules the data must keep: Checks on what a
 *                       table holds, and Reconciliations of two tables that
 *                       must agree
 *   Usage               who relies on the data and what it costs: Data
 *                       Products promised to their consumers, the BI
 *                       Dashboards built on it, Warehouse Spend, and the
 *                       Unused Tables nobody reads
 *   Rules               who owns a table and how it is labelled, assigned by
 *                       rules rather than by hand
 *   Help                the guide, for a first visit
 *   Advanced            set once and looked at rarely: the check Settings,
 *                       and the tables gone from their databases, kept with
 *                       their history - last, as Advanced closes every menu
 *
 * Rules, Help and Advanced fold by their titles
 * (SECTION_TITLES_COLLAPSED_BY_DEFAULT), and each opens by itself on its
 * own pages. Before, eleven entries stood in one section, with Unused
 * Tables and the rules folded under Advanced.
 *
 * Kept free of React so the menu - its sections, their order, the pages and
 * their names - can be read by Search (PageSearchIndex) and pinned in plain
 * tests.
 */

export interface DataObservabilityMenuItem {
  page: PageMap;
  title: string;
  icon: IconProp;
}

export interface DataObservabilityMenuSection {
  title: string;
  items: Array<DataObservabilityMenuItem>;
}

export const DATA_OBSERVABILITY_MENU: Array<DataObservabilityMenuSection> = [
  {
    title: "Data Observability",
    items: [
      {
        page: PageMap.DATA_OBSERVABILITY_OVERVIEW,
        title: "Overview",
        icon: IconProp.Home,
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLES,
        title: "Tables",
        icon: IconProp.TableCells,
      },
      {
        page: PageMap.DATA_OBSERVABILITY_PIPELINES,
        title: "Pipelines",
        icon: IconProp.Workflow,
      },
      {
        page: PageMap.DATA_OBSERVABILITY_SCHEMA_CHANGES,
        title: "Schema Changes",
        icon: IconProp.List,
      },
      {
        page: PageMap.DATA_OBSERVABILITY_STORES,
        title: "Databases",
        icon: IconProp.Database,
      },
      {
        page: PageMap.DATA_OBSERVABILITY_STORAGE_PATHS,
        title: "Storage Paths",
        icon: IconProp.Folder,
      },
    ],
  },
  {
    title: "Quality",
    items: [
      {
        page: PageMap.DATA_OBSERVABILITY_CHECKS,
        title: "Checks",
        icon: IconProp.CheckCircle,
      },
      {
        page: PageMap.DATA_OBSERVABILITY_RECONCILIATIONS,
        title: "Reconciliations",
        icon: IconProp.Scale,
      },
    ],
  },
  {
    title: "Usage",
    items: [
      {
        page: PageMap.DATA_OBSERVABILITY_DATA_PRODUCTS,
        title: "Data Products",
        icon: IconProp.Layers,
      },
      {
        page: PageMap.DATA_OBSERVABILITY_BI_DASHBOARDS,
        title: "BI Dashboards",
        icon: IconProp.ChartBar,
      },
      {
        page: PageMap.DATA_OBSERVABILITY_SPEND,
        title: "Warehouse Spend",
        icon: IconProp.Billing,
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLES_UNUSED,
        title: "Unused Tables",
        icon: IconProp.Moon,
      },
    ],
  },
  {
    title: "Rules",
    items: [
      {
        page: PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULES,
        title: "Owner Rules",
        icon: IconProp.Team,
      },
      {
        page: PageMap.DATA_OBSERVABILITY_SETTINGS_LABEL_RULES,
        title: "Label Rules",
        icon: IconProp.Label,
      },
    ],
  },
  {
    title: "Help",
    items: [
      {
        page: PageMap.DATA_OBSERVABILITY_DOCUMENTATION,
        title: "Documentation",
        icon: IconProp.Book,
      },
    ],
  },
  {
    title: "Advanced",
    items: [
      {
        page: PageMap.DATA_OBSERVABILITY_SETTINGS,
        title: "Settings",
        icon: IconProp.Settings,
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLES_DROPPED,
        title: "Dropped Tables",
        icon: IconProp.Archive,
      },
    ],
  },
];

// Where the product opens: the Overview.
export const DATA_OBSERVABILITY_LANDING_PAGE: PageMap =
  PageMap.DATA_OBSERVABILITY_OVERVIEW;

// Every entry of the menu, in menu order.
export function getDataObservabilityMenuItems(): Array<DataObservabilityMenuItem> {
  return DATA_OBSERVABILITY_MENU.flatMap(
    (
      section: DataObservabilityMenuSection,
    ): Array<DataObservabilityMenuItem> => {
      return section.items;
    },
  );
}

// The section a page sits in, if the menu lists it.
export function getDataObservabilityMenuSectionFor(
  page: PageMap | undefined,
): DataObservabilityMenuSection | undefined {
  if (!page) {
    return undefined;
  }

  return DATA_OBSERVABILITY_MENU.find(
    (section: DataObservabilityMenuSection): boolean => {
      return section.items.some((item: DataObservabilityMenuItem): boolean => {
        return item.page === page;
      });
    },
  );
}
