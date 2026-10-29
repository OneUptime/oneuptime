import DocsNav, {
  DocsNavSections,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  ALERTS_NAV_GROUP,
  ALERTS_NAV_GROUP_AFTER,
  ALERTS_OVERVIEW,
  ALERT_EPISODES,
  ALERT_EPISODE_NUMBER_PREFIX,
  ALERT_NUMBER_PREFIX,
  ALERT_PAGES,
  ALERT_SETTINGS,
  ALERT_STATES,
  AlertDocsPageEntry,
  SEEDED_TEXT,
} from "./AlertDocsPages";
import { readPage } from "./DocsContentSupport";
import {
  MenuSection,
  developerSection,
  menuSections,
  quotedListConstant,
  readCommonSource,
  readDashboardSource,
  routeGroup,
  sectionByTitle,
  sectionHead,
  startsCollapsed,
  stringConstant,
  workspaceSection,
} from "./DocsDashboardMenus";
import { escapeRegExp } from "./DocsTranslationChecks";
import {
  GROUPING_MODE_OPTIONS,
  GROUPING_RULE_COPY,
  GROUPING_RULE_TEMPLATES,
  GroupingRuleKind,
  DEFAULT_TIME_WINDOW_MINUTES,
  GroupingModeOption,
  GroupingRuleTemplate,
} from "../../../FeatureSet/Dashboard/src/Utils/GroupingRule/GroupingRuleSetup";
import { STATE_SETTINGS_COPY } from "../../../FeatureSet/Dashboard/src/Components/StateSettings/StateSettingsCopy";
import {
  ALERT_EPISODE_TEMPLATE_DYNAMIC_VARIABLES,
  ALERT_EPISODE_TEMPLATE_STATIC_VARIABLES,
} from "Common/Utils/Episode/EpisodeTemplateVariables";
import { NUMBER_PREFIX_COLUMNS } from "Common/Utils/Project/NumberPrefix";
import StateMoveUtil, { StateMoveRecord } from "Common/Utils/StateMove";
import AcknowledgedStateUtil from "Common/Utils/AcknowledgedState";
import { STATE_LISTS, StateListType } from "Common/Utils/StateOrder";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 32: the Alerts pages - the overview, alert states and
 * severities, episodes and grouping rules, and alert rules and settings -
 * name a lot of the product: the Alerts side menu and every page under it,
 * the menus of an alert's and an episode's own pages, the create forms, the
 * monitor criteria's alert, the seeded states and severities, the order
 * rule's refusals, the grouping engine and its workers, the rules' forms and
 * defaults, and who is told. Markdown is not compiled, so nothing else
 * notices when the product moves on.
 *
 * These hold those facts to the source: Common's rules and lists imported,
 * the Dashboard's pages and the server's services read as text (an App test
 * must not import the Dashboard's React components). A renamed state, field,
 * menu entry, rule or setting fails here until the English pages follow -
 * and AlertDocsTranslations then carries the change into every language.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const DASHBOARD_SRC_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Dashboard/src",
);

function english(page: string): string {
  return readPage("en", page);
}

function readPackageFile(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

// Every **bold** name in a piece of markdown, in order.
const BOLD: RegExp = /\*\*([^*\n]+)\*\*/g;

// A table column's title in the Dashboard's source: `title: "Severity",`.
const COLUMN_TITLE: RegExp = /title: "([^"\n]+)",/g;

function boldNames(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(BOLD)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The cells of a markdown table row, trimmed, without the empty outer ones.
function tableCells(row: string): Array<string> {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

/*
 * The text of the section under `heading` ("## X" or "### X"), up to the
 * next heading of its level or above. A heading the page lacks fails, naming
 * it.
 */
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect({ heading: heading, found: start >= 0 }).toEqual({
    heading: heading,
    found: true,
  });

  const level: number = heading.indexOf(" ");
  const rest: string = markdown.slice(start + heading.length + 2);
  const end: number = rest.search(new RegExp(`\\n#{1,${level}} `));

  return end === -1 ? rest : rest.slice(0, end);
}

// The body rows of the first table in a piece of markdown.
function tableRows(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("|");
    })
    .slice(2);
}

// The row of a table whose first cell is `first`; fails, naming it, when none is.
function rowStartingWith(rows: Array<string>, first: string): Array<string> {
  const row: string | undefined = rows.find((candidate: string): boolean => {
    return tableCells(candidate)[0] === first;
  });

  expect({ row: first, found: Boolean(row) }).toEqual({
    row: first,
    found: true,
  });

  return tableCells(row || "");
}

// The text from `start` up to the next line that starts a heading.
function paragraphAfter(markdown: string, start: string): string {
  const at: number = markdown.indexOf(start);

  expect({ start: start, found: at >= 0 }).toEqual({ start, found: true });

  const rest: string = markdown.slice(at);
  const end: number = rest.indexOf("\n\n");

  return end === -1 ? rest : rest.slice(0, end);
}

// The Alerts product menu, with the sections it adds outside its array.
function alertsMenu(): Array<MenuSection> {
  const sections: Array<MenuSection> = menuSections(
    readDashboardSource("Pages/Alerts/SideMenu.tsx"),
    { "...(workspaceSection ?": workspaceSection() },
  );

  // A list menu gets the Developer section last (addDeveloperSideMenuSection).
  sections.push(developerSection());

  return sections;
}

// The menu on an alert's own page.
function alertViewMenu(): Array<MenuSection> {
  return menuSections(readDashboardSource("Pages/Alerts/View/SideMenu.tsx"), {
    "{getDeveloperSideMenuSection(": developerSection(),
  });
}

// The menu on an alert episode's own page.
function episodeViewMenu(): Array<MenuSection> {
  return menuSections(
    readDashboardSource("Pages/Alerts/EpisodeView/SideMenu.tsx"),
    { "{getDeveloperSideMenuSection(": developerSection() },
  );
}

function titlesOf(sections: Array<MenuSection>): Array<string> {
  return sections.map((menuSection: MenuSection): string => {
    return menuSection.title;
  });
}

/*
 * A table of a page's menu sections: its rows as sections, each the bold
 * names of its second cell before any ":" that says what they are for.
 */
function menuTable(markdown: string): Array<MenuSection> {
  return tableRows(markdown).map((row: string): MenuSection => {
    const cells: Array<string> = tableCells(row);
    const pages: string = (cells[1] || "").split(": ")[0] || "";

    return {
      title: boldNames(cells[0] || "")[0] || "",
      items: boldNames(pages),
    };
  });
}

function navGroup(title: string): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (candidate: NavGroup): boolean => {
      return candidate.title === title;
    },
  );

  expect({ group: title, found: Boolean(group) }).toEqual({
    group: title,
    found: true,
  });

  return group as NavGroup;
}

describe("the Alerts group in the docs", () => {
  it("is in Incident Response, right after the Incidents group", () => {
    const titles: Array<string> = DocsNav.map((group: NavGroup): string => {
      return group.title;
    });

    expect(DocsNavSections).toContain("Incident Response");
    expect(navGroup(ALERTS_NAV_GROUP).section).toBe("Incident Response");
    expect(titles.indexOf(ALERTS_NAV_GROUP)).toBe(
      titles.indexOf(ALERTS_NAV_GROUP_AFTER) + 1,
    );
  });

  it("lists the overview first, so /docs/alerts opens it, then the other pages in order", () => {
    expect(
      navGroup(ALERTS_NAV_GROUP).links.map((link: NavLink): Array<string> => {
        return [link.url, link.title];
      }),
    ).toEqual(
      ALERT_PAGES.map((entry: AlertDocsPageEntry): Array<string> => {
        return [`/docs/${entry.page}`, entry.navTitle];
      }),
    );
    expect(ALERT_PAGES[0]?.page).toBe(ALERTS_OVERVIEW);
  });

  it("names the group and its pages in every docs language", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const locale: {
        navGroups: Record<string, string>;
        navLinks: Record<string, string>;
      } = JSON.parse(
        readPackageFile(`App/FeatureSet/Docs/Locales/${language}.json`),
      );

      expect({
        language,
        group: typeof locale.navGroups[ALERTS_NAV_GROUP],
      }).toEqual({ language, group: "string" });

      for (const entry of ALERT_PAGES) {
        expect({
          language,
          link: entry.navTitle,
          title: typeof locale.navLinks[entry.navTitle],
        }).toEqual({ language, link: entry.navTitle, title: "string" });
      }
    }
  });

  it("names the group as each Dashboard's Products menu names Alerts", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const docs: { navGroups: Record<string, string> } = JSON.parse(
        readPackageFile(`App/FeatureSet/Docs/Locales/${language}.json`),
      );
      const dashboard: { navbar: { items: Record<string, string> } } =
        JSON.parse(readDashboardSource(`Locales/${language}.json`)) as {
          navbar: { items: Record<string, string> };
        };

      expect({
        language,
        group: docs.navGroups[ALERTS_NAV_GROUP],
      }).toEqual({
        language,
        group: dashboard.navbar.items["alertsTitle"],
      });
    }
  });

  it("is linked from Getting Started's Incident Response cards, right after Incidents, and from Core Concepts", () => {
    const gettingStarted: string = readPage(
      "en",
      "introduction/getting-started",
    );
    const incidentResponse: string = section(
      gettingStarted,
      "### Incident Response",
    );
    const cards: Array<string> = incidentResponse
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- [");
      });
    const incidentsCard: number = cards.findIndex((line: string): boolean => {
      return line.includes("(/docs/incidents/index)");
    });

    expect(incidentsCard).toBeGreaterThanOrEqual(0);
    expect(cards[incidentsCard + 1]).toContain("(/docs/alerts/index)");
    expect(
      section(
        readPage("en", "introduction/core-concepts"),
        "## Incidents and alerts",
      ),
    ).toContain("(/docs/alerts/index)");
  });
});

describe("the overview's side menu table is the Alerts side menu", () => {
  const overview: string = english(ALERTS_OVERVIEW);
  // The moves every incident, alert, episode and maintenance list offers.
  const stateEngine: string = readDashboardSource(
    "Components/EventView/useEventStateActions.tsx",
  );
  const table: string = section(
    overview,
    "## Where alerts live in the dashboard",
  );

  it("reads the menu: Developer comes last", () => {
    expect(titlesOf(alertsMenu())).toEqual([
      "Alerts",
      "Episodes",
      "AI",
      "Workspace",
      "Rules",
      "Settings",
      "Developer",
    ]);
  });

  it("has a row per section with its pages, in the menu's order (Developer is named in the paragraph under it)", () => {
    expect(menuTable(table)).toEqual(
      alertsMenu().filter((menuSection: MenuSection): boolean => {
        return menuSection.title !== "Developer";
      }),
    );
  });

  it("says which sections start open and which start folded, as the menu draws them", () => {
    const menuSource: string = readDashboardSource("Pages/Alerts/SideMenu.tsx");
    const sentence: string = paragraphAfter(
      table,
      "**Alerts** and **Episodes** are open;",
    );
    const [openPart, foldedPart] = sentence.split(";");
    const open: Array<string> = boldNames(openPart || "");
    const folded: Array<string> = boldNames(
      (foldedPart || "").split(", and a section")[0] || "",
    );

    expect([...open, ...folded].sort()).toEqual(titlesOf(alertsMenu()).sort());

    for (const title of open) {
      expect({
        section: title,
        folded: startsCollapsed(menuSource, title),
      }).toEqual({ section: title, folded: false });
    }

    for (const title of folded) {
      expect({
        section: title,
        folded: startsCollapsed(menuSource, title),
      }).toEqual({ section: title, folded: true });
    }
  });

  it("names the Products menu's own item, and says alerts never reach a status page as the list does", () => {
    const dashboardEnglish: { navbar: { items: Record<string, string> } } =
      JSON.parse(readDashboardSource("Locales/en.json"));
    const alertsTable: string = readDashboardSource(
      "Components/Alert/AlertsTable.tsx",
    );

    expect(dashboardEnglish.navbar.items["alertsTitle"]).toBe("Alerts");
    expect(overview).toContain(
      "Open **Alerts** from the **Products** menu in the top bar.",
    );
    expect(alertsTable).toContain(
      "Unlike incidents, they never appear on status pages.",
    );
    expect(overview).toContain("it never shows on a status page");
    expect(
      rowStartingWith(
        tableRows(section(overview, "## Alerts and incidents")),
        "**On status pages**",
      )[1],
    ).toBe("Never");
  });

  it("names the list's columns and its bulk actions as the alerts table draws them", () => {
    const alertsTable: string = readDashboardSource(
      "Components/Alert/AlertsTable.tsx",
    );
    const bulkLinks: string = readDashboardSource(
      "Components/Alert/BulkIncidentLinkActions.tsx",
    );
    const listSentence: string = paragraphAfter(table, "The list shows ");
    const [columnsPart, actionsPart] = listSentence.split(
      "Select alerts to act on several at once:",
    );
    const columns: Array<string> = boldNames(columnsPart || "");
    const columnsSource: string = alertsTable.slice(
      alertsTable.indexOf("columns={["),
    );

    for (const column of columns) {
      expect({
        column,
        drawn: columnsSource.includes(`title: "${column}"`),
      }).toEqual({ column, drawn: true });
    }

    /*
     * Every column the list draws, in its order - and no Monitor column:
     * the list dropped it, since Affected Resources names the monitor.
     */
    expect(columns).toEqual(
      Array.from(columnsSource.matchAll(COLUMN_TITLE)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    );
    expect(columns).not.toContain("Monitor");
    expect(columnsPart).toContain(
      "**Affected Resources** (the alert's monitor first)",
    );

    // In the order the list offers them (RowActionsAudit).
    expect(boldNames(actionsPart || "")).toEqual([
      "Acknowledge",
      "Resolve",
      "Change State",
      "Change Severity",
      "Assign to Me",
      "Add Owner",
      "Remove Owner",
      "Add Labels",
      "Remove Labels",
      "Link to Incident",
      "Declare Incident",
    ]);
    const bulk: string = alertsTable.slice(
      alertsTable.indexOf("bulkActions={{"),
      alertsTable.indexOf("actionButtons={["),
    );
    const order: Array<number> = [
      "...stateBulkActions",
      "...severityBulkActions",
      "...ownerBulkActions",
      "...labelBulkActions",
      "...incidentLinkBulkActions",
    ].map((name: string): number => {
      return bulk.indexOf(name);
    });

    expect(order[0]).toBeGreaterThan(-1);
    expect(order).toEqual(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    );
    expect(stateEngine).toContain('return "Acknowledge";');
    expect(stateEngine).toContain('return "Resolve";');
    expect(stateEngine).toContain('title: "Change State",');
    expect(alertsTable).toContain('title: "Change Severity",');
    expect(
      readCommonSource("UI/Components/BulkUpdate/BulkLabelActions.tsx"),
    ).toContain('title: "Add Labels"');
    expect(
      readCommonSource("UI/Components/BulkUpdate/BulkOwnerActions.tsx"),
    ).toContain('title: "Remove Owner"');
    expect(
      readCommonSource("UI/Components/BulkUpdate/BulkOwnerActions.tsx"),
    ).toContain('ASSIGN_TO_ME_TITLE: string = translationKey("Assign to Me");');
    expect(bulkLinks).toContain(
      'LINK_TO_INCIDENT_ACTION_TITLE: string = "Link to Incident"',
    );
    expect(bulkLinks).toContain(
      'DECLARE_INCIDENT_ACTION_TITLE: string = "Declare Incident"',
    );
    expect(alertsTable).toContain("ModalTableBulkDefaultActions.Delete");
  });

  it("names each row's ⋯ menu as the alerts table draws it: the state moves, severity and owners", () => {
    const alertsTable: string = readDashboardSource(
      "Components/Alert/AlertsTable.tsx",
    );
    const rowSentence: string = paragraphAfter(
      table,
      "Each alert's **⋯** menu, at the end of its row,",
    );

    expect(boldNames(rowSentence)).toEqual([
      "⋯",
      "Acknowledge",
      "Resolve",
      "Change State",
      "Change Severity",
      "Assign to Me",
      "Add Owner",
    ]);
    // The row's actions, in that order, through the shared engine.
    expect(alertsTable).toContain(
      "actionButtons={[\n          ...stateRowActions,\n          ...severityRowActions,\n          ...ownerRowActions,\n        ]}",
    );
    // Acknowledge and Resolve only while the alert can make the move.
    expect(stateEngine).toContain("return isQuickMoveOffered({");
    // Assign to Me only on an alert the viewer does not own.
    expect(alertsTable).toContain("isOwnedByMe: (alert: Alert)");
    expect(rowSentence).toContain(
      "**Acknowledge** and **Resolve** while the alert can make that move",
    );
    expect(rowSentence).toContain("**Assign to Me** until you own it");
  });

  it("says Affected Resources names the alert's monitor first, as the list draws it", () => {
    const alertsTable: string = readDashboardSource(
      "Components/Alert/AlertsTable.tsx",
    );
    const cell: string = readDashboardSource(
      "Components/AffectedResources/AffectedResourcesCell.tsx",
    );
    const listSentence: string = paragraphAfter(table, "The list shows ");

    expect(listSentence).toContain(
      "**Affected Resources** (the alert's monitor first)",
    );

    // The list hands the cell the alert's monitor ahead of the rest...
    const monitorAt: number = alertsTable.indexOf(
      "monitors: alert.monitor ? [alert.monitor] : [],",
    );

    expect(monitorAt).toBeGreaterThan(-1);
    expect(monitorAt).toBeLessThan(
      alertsTable.indexOf("hosts: alert.hosts || [],"),
    );

    // ...and the cell lists monitors before anything else.
    const monitorsListedAt: number = cell.indexOf(
      "for (const monitor of props.monitors || [])",
    );

    expect(monitorsListedAt).toBeGreaterThan(-1);
    expect(monitorsListedAt).toBeLessThan(
      cell.indexOf("for (const host of props.hosts || [])"),
    );
  });
});

describe("the alert page's menu table is the alert's own menu", () => {
  const overview: string = english(ALERTS_OVERVIEW);
  const table: string = section(
    overview,
    "## What each page of an alert shows",
  );

  it("reads the menu, with the Developer section where the menu adds it", () => {
    // The incident page's sections, in the incident page's order.
    expect(titlesOf(alertViewMenu())).toEqual([
      "Overview",
      "Investigation",
      "Team",
      "Notifications",
      "Notes",
      "Developer",
      "Advanced",
    ]);
  });

  it("has a row per section with its pages, in the menu's order", () => {
    expect(menuTable(table)).toEqual(alertViewMenu());
  });

  it("says which sections start open, as the menu draws them", () => {
    const viewSource: string = readDashboardSource(
      "Pages/Alerts/View/SideMenu.tsx",
    );

    expect(table).toContain(
      "**Overview**, **Investigation**, **Team** and **Notes** are open; the other sections start folded until you click them.",
    );

    for (const menuSection of alertViewMenu()) {
      const open: boolean = [
        "Overview",
        "Investigation",
        "Team",
        "Notes",
      ].includes(menuSection.title);

      expect({
        section: menuSection.title,
        folded: startsCollapsed(viewSource, menuSection.title),
      }).toEqual({ section: menuSection.title, folded: !open });
    }
  });
});

describe("the episode page's menu table is the episode's own menu", () => {
  const episodes: string = english(ALERT_EPISODES);
  const table: string = section(
    episodes,
    "## What each page of an episode shows",
  );

  it("reads the menu, with the Developer section where the menu adds it", () => {
    expect(titlesOf(episodeViewMenu())).toEqual([
      "Overview",
      "Investigation",
      "Team",
      "Alerts",
      "Notes",
      "Developer",
      "Advanced",
    ]);
  });

  it("has a row per section with its pages, in the menu's order", () => {
    expect(menuTable(table)).toEqual(episodeViewMenu());
  });

  it("names the sections that start folded, as the menu draws them", () => {
    const viewSource: string = readDashboardSource(
      "Pages/Alerts/EpisodeView/SideMenu.tsx",
    );
    const folded: Array<string> = boldNames(
      paragraphAfter(
        table,
        "**Developer** and **Advanced** start folded.",
      ).split(" start folded.")[0] || "",
    );

    expect(folded).toEqual(["Developer", "Advanced"]);

    for (const menuSection of episodeViewMenu()) {
      expect({
        section: menuSection.title,
        folded: startsCollapsed(viewSource, menuSection.title),
      }).toEqual({
        section: menuSection.title,
        folded: folded.includes(menuSection.title),
      });
    }
  });
});

/*
 * Every bold menu path on the alert pages ("**Alerts → Rules → On-Call
 * Rules**") is a section and page of the menu it starts from. A path names a
 * section and then one of its pages, or a page straight away.
 */
describe("every menu path the alert pages give is in that menu", () => {
  type MenuReader = () => Array<MenuSection>;

  const MENUS: Record<string, MenuReader> = {
    Alerts: alertsMenu,
    "User Settings": (): Array<MenuSection> => {
      return menuSections(
        readDashboardSource("Pages/UserSettings/SideMenu.tsx"),
      );
    },
  };

  const PATH: RegExp = /\*\*([^*\n]+? → [^*\n]+?)\*\*/g;

  function paths(): Array<{ page: string; segments: Array<string> }> {
    const found: Array<{ page: string; segments: Array<string> }> = [];

    for (const entry of ALERT_PAGES) {
      for (const match of Array.from(english(entry.page).matchAll(PATH))) {
        found.push({
          page: entry.page,
          segments: (match[1] as string)
            .split(" → ")
            .map((segment: string): string => {
              return segment.trim();
            }),
        });
      }
    }

    return found;
  }

  it("finds the paths, every one from a menu it knows", () => {
    const roots: Set<string> = new Set(
      paths().map((found: { segments: Array<string> }): string => {
        return found.segments[0] as string;
      }),
    );

    expect([...roots].sort()).toEqual(Object.keys(MENUS).sort());
    expect(paths().length).toBeGreaterThan(20);
  });

  it("resolves each one to a section and its page", () => {
    const unresolved: Array<string> = [];

    for (const found of paths()) {
      const sections: Array<MenuSection> = (
        MENUS[found.segments[0] as string] as MenuReader
      )();
      const rest: Array<string> = found.segments.slice(1);
      const asSection: MenuSection | undefined = sections.find(
        (candidate: MenuSection): boolean => {
          return candidate.title === rest[0];
        },
      );
      const resolves: boolean = asSection
        ? rest.length === 1 || asSection.items.includes(rest[1] as string)
        : rest.length === 1 &&
          sections.some((candidate: MenuSection): boolean => {
            return candidate.items.includes(rest[0] as string);
          });

      if (!resolves || rest.length > 2) {
        unresolved.push(`${found.page}: ${found.segments.join(" → ")}`);
      }
    }

    expect(unresolved).toEqual([]);
  });
});

/*
 * Every dashboard address the alert pages give ("`/dashboard/{projectId}/
 * alerts/settings/`") is one of the Alerts routes, and an address given as
 * a prefix ("addresses beginning ...") starts some of them.
 */
describe("every dashboard address the alert pages give is a route", () => {
  const routes: Array<string> = routeGroup("AlertsRoutePath");
  const ADDRESS: RegExp = /`\/dashboard\/\{projectId\}\/alerts(\/[^`]*)?`/g;
  const LEADING_SLASH: RegExp = /^\//;
  const PAGE_MAP_KEY: RegExp = /PageMap\.(\w+)/;

  function addresses(): Array<{ page: string; route: string }> {
    const found: Array<{ page: string; route: string }> = [];

    for (const entry of ALERT_PAGES) {
      for (const match of Array.from(english(entry.page).matchAll(ADDRESS))) {
        found.push({
          page: entry.page,
          route: (match[1] || "").replace(LEADING_SLASH, ""),
        });
      }
    }

    return found;
  }

  it("reads the Alerts routes", () => {
    expect(routes).toContain("settings/grouping-rules");
    expect(routes).toContain("episodes/create");
    expect(routes).toContain("{id}/state-timeline");
    expect(addresses().length).toBeGreaterThanOrEqual(2);
  });

  it("resolves each address to a route, or to the start of some", () => {
    const unknown: Array<string> = addresses()
      .filter((found: { route: string }): boolean => {
        if (found.route === "") {
          // The alerts list itself.
          return false;
        }

        if (found.route.endsWith("/")) {
          return !routes.some((route: string): boolean => {
            return route.startsWith(found.route);
          });
        }

        return !routes.includes(found.route);
      })
      .map((found: { page: string; route: string }): string => {
        return `${found.page}: ${found.route}`;
      });

    expect(unknown).toEqual([]);
  });

  it("puts every page of the Rules and Settings sections at the addresses the settings page gives", () => {
    const menu: Array<MenuSection> = alertsMenu();
    const routeMap: string = readDashboardSource("Utils/RouteMap.ts");
    const sideMenu: string = readDashboardSource("Pages/Alerts/SideMenu.tsx");

    expect(english(ALERT_SETTINGS)).toContain(
      "at addresses beginning `/dashboard/{projectId}/alerts/settings/`",
    );

    for (const title of [
      ...sectionByTitle(menu, "Rules").items,
      ...sectionByTitle(menu, "Settings").items,
    ]) {
      const at: number = sideMenu.indexOf(`title: "${title}"`);
      const pageKey: string = sideMenu.slice(at).match(PAGE_MAP_KEY)?.[1] || "";
      const route: string =
        routeMap.match(
          new RegExp(`\\[PageMap\\.${escapeRegExp(pageKey)}\\]:\\s*"([^"]+)"`),
        )?.[1] || "";

      expect({ title, route: route.startsWith("settings/") }).toEqual({
        title,
        route: true,
      });
    }
  });
});

// ---- Seeded states, severities and numbers ---------------------------------

/*
 * What a new project is seeded with, read from ProjectService's
 * addDefaultAlertState and addDefaultAlertSeverity: each row's name,
 * description, colour, flag and order.
 */
interface SeededRow {
  name: string;
  description: string;
  color: string;
  flag: string | null;
  order: number;
}

const SEEDED_FLAG: RegExp = /\.(is\w+State) = true;/;

function brandColor(name: string): string {
  const match: RegExpMatchArray | null = readCommonSource(
    "Types/BrandColors.ts",
  ).match(
    new RegExp(
      `export const ${escapeRegExp(name)}: Color = Color\\.fromString\\("(#[0-9a-fA-F]{6})"\\)`,
    ),
  );

  expect({ color: name, found: Boolean(match) }).toEqual({
    color: name,
    found: true,
  });

  return (match?.[1] as string).toLowerCase();
}

function seededRows(methodName: string): Array<SeededRow> {
  const source: string = readCommonSource("Server/Services/ProjectService.ts");
  const start: number = source.indexOf(`public async ${methodName}(`);

  expect({ method: methodName, found: start >= 0 }).toEqual({
    method: methodName,
    found: true,
  });

  const body: string = source.slice(start, source.indexOf("\n  }\n", start));

  return body
    .split("if (!existingNames.has(")
    .slice(1)
    .map((block: string): SeededRow => {
      const field: (name: string) => string = (name: string): string => {
        return (
          block.match(
            new RegExp(`\\.${escapeRegExp(name)} =\\s*([^;]+);`),
          )?.[1] || ""
        ).trim();
      };
      const flag: RegExpMatchArray | null = block.match(SEEDED_FLAG);

      return {
        name: JSON.parse(field("name")) as string,
        description: JSON.parse(field("description")) as string,
        color: brandColor(field("color")),
        flag: flag ? (flag[1] as string) : null,
        order: Number(field("order")),
      };
    });
}

describe("the seeded alert states and severities", () => {
  const states: Array<SeededRow> = seededRows("addDefaultAlertState");
  const severities: Array<SeededRow> = seededRows("addDefaultAlertSeverity");

  it("are read from the project's seeding", () => {
    expect(
      states.map((row: SeededRow): string => {
        return row.name;
      }),
    ).toEqual(["Identified", "Acknowledged", "Resolved"]);
    expect(
      severities.map((row: SeededRow): string => {
        return row.name;
      }),
    ).toEqual(["High", "Low"]);
  });

  it("describe alerts, never incidents: a new project's alert states say what they are", () => {
    for (const row of states) {
      expect({ state: row.name, description: row.description }).toEqual({
        state: row.name,
        description: expect.stringContaining("alert"),
      });
      expect(row.description.toLowerCase()).not.toContain("incident");
    }
  });

  it("are the states page's table: name, order, flag and colour, in order", () => {
    const rows: Array<Array<string>> = tableRows(
      section(english(ALERT_STATES), "## The seeded states"),
    ).map(tableCells);

    expect(
      rows.map((cells: Array<string>): Array<string> => {
        return cells.slice(0, 4);
      }),
    ).toEqual(
      states.map((row: SeededRow): Array<string> => {
        return [
          `**${row.name}**`,
          `\`${row.order}\``,
          `\`${row.flag}\``,
          `\`${row.color}\``,
        ];
      }),
    );
  });

  it("are the severities table: name, order, colour and the seeded description", () => {
    const rows: Array<Array<string>> = tableRows(
      section(english(ALERT_STATES), "## The seeded severities"),
    ).map(tableCells);

    expect(rows).toEqual(
      severities.map((row: SeededRow): Array<string> => {
        return [
          `**${row.name}**`,
          `\`${row.order}\``,
          `\`${row.color}\``,
          row.description,
        ];
      }),
    );

    // Severities carry no flag.
    for (const row of severities) {
      expect(row.flag).toBeNull();
    }

    // Every translation keeps the seeded descriptions as a project stores them.
    expect(SEEDED_TEXT[ALERT_STATES]).toEqual(
      severities.map((row: SeededRow): string => {
        return row.description;
      }),
    );
  });

  it("are what the overview's comparison table starts alerts with", () => {
    const rows: Array<string> = tableRows(
      section(english(ALERTS_OVERVIEW), "## Alerts and incidents"),
    );

    expect(
      boldNames(rowStartingWith(rows, "**Starting states**")[1] || ""),
    ).toEqual(
      states.map((row: SeededRow): string => {
        return row.name;
      }),
    );
    expect(
      boldNames(rowStartingWith(rows, "**Starting severities**")[1] || ""),
    ).toEqual(
      severities.map((row: SeededRow): string => {
        return row.name;
      }),
    );
  });

  it("number new alerts and episodes with the prefixes the pages give", () => {
    const prefixes: Record<string, string> = {};

    for (const column of NUMBER_PREFIX_COLUMNS) {
      prefixes[column.column] = column.defaultForNewProjects;
    }

    expect(prefixes["alertNumberPrefix"]).toBe(ALERT_NUMBER_PREFIX);
    expect(prefixes["alertEpisodeNumberPrefix"]).toBe(
      ALERT_EPISODE_NUMBER_PREFIX,
    );
    expect(
      rowStartingWith(
        tableRows(section(english(ALERTS_OVERVIEW), "## Alerts and incidents")),
        "**Numbers in a new project**",
      )[1],
    ).toBe(
      `\`${ALERT_NUMBER_PREFIX}42\`, and \`${ALERT_EPISODE_NUMBER_PREFIX}42\` for episodes`,
    );
    expect(english(ALERT_SETTINGS)).toContain(
      `\`${ALERT_NUMBER_PREFIX}\` and \`${ALERT_EPISODE_NUMBER_PREFIX}\` in a new project`,
    );
  });
});

// ---- Where alerts come from, and creating one by hand ------------------------

describe("where alerts come from", () => {
  const sources: string = section(
    english(ALERTS_OVERVIEW),
    "## Where alerts come from",
  );

  it("names the monitor criteria's switch, and the alert form's fields and folds, as the criteria draw them", () => {
    const instance: string = readDashboardSource(
      "Components/Form/Monitor/MonitorCriteriaInstance.tsx",
    );
    const form: string = readDashboardSource(
      "Components/Form/Monitor/MonitorCriteriaAlertForm.tsx",
    );

    expect(instance).toContain('title="Actions"');
    expect(instance).toContain('title="When filters match, create an alert."');
    expect(sources).toContain(
      "Under a criteria's **Actions**, turn on **When filters match, create an alert.**",
    );

    for (const label of ["Alert Title", "Severity"]) {
      expect(form).toContain(`title="${label}"`);
    }

    for (const fold of ["Description", "Ownership & Labels", "On-Call"]) {
      expect({
        fold,
        folded: form.includes(`<FoldedSection\n        title="${fold}"`),
      }).toEqual({ fold, folded: true });
    }

    expect(form).toContain("title={MORE_FIELDS_SECTION_TITLE}");

    for (const label of [
      "Auto Resolve Alert",
      "Private Alert",
      "Remediation Notes",
    ]) {
      expect(form).toContain(`title="${label}"`);
    }

    expect(sources).toContain(
      "**Alert Title** and **Severity**, then, each folded, **Description**, **Ownership & Labels**, **On-Call** and **More fields**, which holds **Auto Resolve Alert**, **Private Alert** and **Remediation Notes**.",
    );
  });

  it("says a criteria keeps one open alert at a time, one per series, as the monitor's alerting dedupes", () => {
    const monitorAlert: string = readCommonSource(
      "Server/Utils/Monitor/MonitorAlert.ts",
    );

    expect(monitorAlert).toContain(
      "(alert.createdCriteriaId || undefined) ===",
    );
    expect(monitorAlert).toContain(
      "(alert.seriesFingerprint || undefined) === seriesFingerprint",
    );
    expect(sources).toContain(
      "A criteria keeps one open alert at a time, one per series on a monitor that groups by a field",
    );
  });

  it("names every other source that creates alerts", () => {
    for (const creator of [
      "App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
      "Common/Server/Services/NetworkSiteService.ts",
      "Common/Server/Utils/SecurityEvent/SecurityEventAlerting.ts",
      "Common/Server/Services/OnCallPageService.ts",
    ]) {
      expect({
        creator,
        creates: readPackageFile(creator).includes("AlertService.create("),
      }).toEqual({ creator, creates: true });
    }

    for (const link of [
      "(/docs/slo/burn-rate-alerts)",
      "(/docs/monitor/network-sites)",
      "(/docs/telemetry/security-events)",
      "(/docs/workspace-connections/slack#paging-someone-from-slack)",
      "(/docs/workflows/components#paging)",
    ]) {
      expect(sources).toContain(link);
    }
  });

  it("names the API resource and the workflow step the way the model and the builder name them", () => {
    const alertModel: string = readCommonSource(
      "Models/DatabaseModels/Alert.ts",
    );
    const workflowComponents: string = readCommonSource(
      "Types/Workflow/Components/BaseModel.ts",
    );

    expect(alertModel).toContain('@CrudApiEndpoint(new Route("/alert"))');
    expect(alertModel).toContain('singularName: "Alert"');
    expect(workflowComponents).toContain(
      "title: `Create One ${model.singularName}`",
    );
    expect(sources).toContain(
      "`/api/alert`, the `oneuptime_alert` Terraform resource, and a workflow's **Create One Alert** step.",
    );
  });

  it("lets a monitor's own Alerts tab open the form with the monitor picked", () => {
    expect(readDashboardSource("Pages/Monitor/View/Alerts.tsx")).toContain(
      "createFrom={{ kind: CreateFromRecordKind.Monitor, id: modelId }}",
    );
    // Issue #5341: a network device's Alerts tab picks the device.
    expect(
      readDashboardSource("Pages/NetworkDevice/View/Alerts.tsx"),
    ).toContain(
      "createFrom={{ kind: CreateFromRecordKind.NetworkDevice, id: modelId }}",
    );
    expect(sources).toContain(
      "or on the **Alerts** tab of a monitor, a host, a network device or another resource, which picks that resource for you.",
    );
  });
});

describe("creating an alert by hand", () => {
  const create: string = readDashboardSource("Pages/Alerts/Create.tsx");
  const steps: string = section(
    english(ALERTS_OVERVIEW),
    "## Create an alert by hand",
  );

  // The field that has this title, from its title up to the next field's.
  function field(title: string): string {
    const at: number = create.indexOf(`title: "${title}"`);

    expect({ field: title, found: at >= 0 }).toEqual({
      field: title,
      found: true,
    });

    const next: number = create.indexOf("field: {", at);

    return create.slice(at, next === -1 ? undefined : next);
  }

  it("names the form, its two steps and its button as the page draws them", () => {
    expect(create).toContain('title="Create New Alert"');
    expect(create).toContain('title: "Alert Details",');
    expect(create).toContain('id: "alert-details",');
    expect(create).toContain('title: "Resources & On-Call",');
    expect(create).toContain('id: "on-call",');
    expect(create).toContain('submitButtonText={"Create Alert"}');
    expect(readDashboardSource("Components/Alert/AlertsTable.tsx")).toContain(
      'title: "Create Alert"',
    );

    for (const name of [
      "Create Alert",
      "Create New Alert",
      "Alert Details",
      "Resources & On-Call",
    ]) {
      expect(steps).toContain(`**${name}**`);
    }
  });

  it("asks for a title and a severity, and folds the initial state, labels and privacy under More fields", () => {
    expect(field("Title")).toContain("required: true");
    expect(field("Alert Severity")).toContain("required: true");
    expect(field("Description")).toContain("required: false");

    for (const folded of ["Initial State", "Private Alert"]) {
      expect({
        field: folded,
        folded: field(folded).includes("collapsibleSection: advancedSection"),
      }).toEqual({ field: folded, folded: true });
    }

    const labels: string = create.slice(
      create.indexOf("getLabelsFormField<Alert>({"),
    );

    expect(labels.slice(0, 160)).toContain(
      "collapsibleSection: advancedSection",
    );
    expect(steps).toContain(
      "Fill in the **Title** and pick an **Alert Severity**; both are required.",
    );
    expect(steps).toContain(
      "Under **More fields**, folded, you can pick an **Initial State**, add **Labels**, or make it a **Private Alert**.",
    );
  });

  it("asks on the second step for the monitor, the other resources and the on-call policy", () => {
    for (const title of [
      "Monitor",
      "Other Affected Resources",
      "On-Call Policy",
    ]) {
      expect({
        title,
        step: field(title).includes('stepId: "on-call"'),
      }).toEqual({ title, step: true });
    }

    expect(steps).toContain(
      "Pick the **Monitor** it is about and any **Other Affected Resources**",
    );
    expect(steps).toContain("In **On-Call Policy**, pick the policies");
  });

  it("says an alert left without an Initial State starts in the created state, and one started later pages nobody", () => {
    expect(field("Initial State")).toContain(
      "Leave empty for the usual starting state. Pick a later state to record an alert that is already acknowledged or resolved. No one is paged for it.",
    );
    expect(english(ALERTS_OVERVIEW)).toContain(
      "Leave **Initial State** empty and the alert starts where every new alert does: your created state, **Identified** in a new project.",
    );
  });
});

// ---- What a new alert sets off ----------------------------------------------

/*
 * Where each step of AlertService.onCreateSuccess sits in its source: the
 * steps run one after another, in the order they are written.
 */
function onCreateSuccessSteps(service: string): string {
  const start: number = service.indexOf(
    "protected override async onCreateSuccess(",
  );

  expect(start).toBeGreaterThan(0);

  return service.slice(start, service.indexOf("\n  }\n", start));
}

function positionsIn(source: string, markers: Array<string>): Array<number> {
  return markers.map((marker: string): number => {
    const at: number = source.indexOf(marker);

    expect({ marker, found: at >= 0 }).toEqual({ marker, found: true });

    return at;
  });
}

function inOrder(positions: Array<number>): boolean {
  return positions.every((position: number, index: number): boolean => {
    return index === 0 || position > (positions[index - 1] as number);
  });
}

describe("what happens when an alert is created", () => {
  const service: string = readCommonSource("Server/Services/AlertService.ts");
  const steps: string = onCreateSuccessSteps(service);
  const page: string = english(ALERTS_OVERVIEW);
  const list: string = section(
    page,
    "## What happens when an alert is created",
  );

  it("runs the steps in the order the overview lists them", () => {
    expect(
      inOrder(
        positionsIn(steps, [
          "AlertPrivacyRuleEngineService.applyRulesToAlert",
          "this.handleAlertWorkspaceOperationsAsync",
          "this.createAlertFeedAsync",
          "AlertOwnerRuleEngineService.applyRulesToAlert",
          "AlertLabelRuleEngineService.applyRulesToAlert",
          "AlertOnCallRuleEngineService.applyRulesToAlert",
          "RunbookRuleEngineService.applyRulesToAlert",
          "this.executeAlertOnCallDutyPoliciesAsync",
          "AlertGroupingEngineService.processAlert",
          "this.refreshReminderSchedule",
          "AIAlertInvestigationRunner.investigateNewAlert",
          "AutoRemediationRuleEngineService.onAlertCreated",
        ]),
      ),
    ).toBe(true);

    expect(
      inOrder(
        positionsIn(list, [
          "**Privacy rules run first**",
          "**The feed and your chat tools hear of it.**",
          "**Owners and labels are added**",
          "**On-call rules add their policies**, then runbook rules",
          "**On-call policies run.**",
          "**Grouping rules put it into an episode**",
          "**Reminders are scheduled**",
        ]),
      ),
    ).toBe(true);
  });

  it("writes the Alert Created entry to the Alert Feed, and runs every policy at once, each settled on its own", () => {
    expect(service).toContain("AlertFeedEventType.AlertCreated");
    expect(readDashboardSource("Components/Alert/AlertFeed.tsx")).toContain(
      'title={"Alert Feed"}',
    );
    expect(service).toContain("await Promise.allSettled(policyPromises);");
    expect(list).toContain(
      "Every policy on the alert pages its people in parallel; one failing does not stop the others.",
    );
  });

  it("pages nobody for an alert created acknowledged, and skips what answers a live problem for one created resolved", () => {
    const created: string = section(
      page,
      "### Created already acknowledged or resolved",
    );

    // Only an alert that starts open pages its policies.
    expect(service).toContain(
      "if (!StartingStageUtil.pagesOnCall(startingStage)) {",
    );
    expect(service).toContain("OnCallNotRunOnCreate.createFeedItem");
    // An acknowledged one may join an open episode, never open one.
    expect(steps).toContain(
      "mayOpenEpisode: StartingStageUtil.pagesOnCall(startingStage),",
    );
    /*
     * A resolved one opens no channel, starts no runbook, is not grouped or
     * remediated, and has OneUptime AI check no open incident again.
     */
    expect(steps.split("if (!isOngoing) {").length - 1).toBe(4);
    expect(steps).toContain("await IncidentFollowUpCheck.onAlertOpened({");
    expect(steps).toContain(
      "if (createdItem.projectId && createdItem.id && isOngoing) {",
    );
    expect(steps).toContain("createdResolved: !isOngoing,");

    expect(created).toContain(
      "It can join an open episode, but never opens one",
    );
    expect(created).toContain(
      "it is not grouped into an episode, no runbook or auto-remediation acts on it, OneUptime AI does not investigate it, and no Slack or Microsoft Teams channel is created for it.",
    );
    expect(created).toContain(
      "(/docs/incidents/declaring-incidents#declared-already-acknowledged-or-resolved)",
    );
  });

  it("tells the owners from a job that runs every minute, falling back to the project's owners", () => {
    const job: string = readPackageFile(
      "App/FeatureSet/Workers/Jobs/AlertOwners/SendCreatedResourceNotification.ts",
    );

    expect(job).toContain("schedule: EVERY_MINUTE");
    expect(job).toContain("owners = await ProjectService.getOwners(");
    expect(page).toContain(
      "A background job tells the alert's owners within a minute",
    );
  });
});

// ---- Responding to an alert ---------------------------------------------------

describe("responding to an alert", () => {
  const page: string = english(ALERTS_OVERVIEW);
  const respond: string = section(page, "## Respond to an alert");
  const changeState: string = readDashboardSource(
    "Components/Alert/ChangeState.tsx",
  );

  it("names the header's buttons, its menu and the confirmation's note as the header draws them", () => {
    expect(changeState).toContain('label: "Acknowledge",');
    expect(changeState).toContain('label: "Resolve",');
    expect(
      readDashboardSource("Components/EventView/EventStatusPanel.tsx"),
    ).toContain('title={props.moreMenuTitle || "Change state to"}');
    expect(
      readDashboardSource("Components/EventView/StateChangeFormFields.ts"),
    ).toContain('"Add a private note"');
    expect(changeState).toContain("getDeclareIncidentFromAlertAction");

    for (const name of [
      "Acknowledge",
      "Resolve",
      "Change state to",
      "Declare Incident",
      "Add a private note",
    ]) {
      expect(respond).toContain(`**${name}**`);
    }
  });

  it("names the feed's Actions menu and what it runs", () => {
    const feed: string = readDashboardSource("Components/Alert/AlertFeed.tsx");

    expect(feed).toContain('text="Execute Runbook"');
    expect(feed).toContain('text="Execute On-Call Policy"');
    expect(
      readCommonSource("UI/Components/Feed/FeedActionsMenu.tsx"),
    ).toContain('translator.translateText("Actions")');
    expect(respond).toContain(
      "The **Actions** menu of the **Alert Feed** also runs a runbook with **Execute Runbook**, or pages more people with **Execute On-Call Policy**.",
    );
  });

  it("names the Linked Incidents page's buttons and the Settings page's switches", () => {
    const linked: string = readDashboardSource(
      "Pages/Alerts/View/Incidents.tsx",
    );
    const privacy: string = readDashboardSource(
      "Components/Alert/AlertPrivacySwitchCopy.ts",
    );
    const reminders: string = readDashboardSource(
      "Components/Reminders/RemindersSwitchCopy.ts",
    );
    const pages: string = section(page, "## What each page of an alert shows");

    expect(linked).toContain('title: "Link Incident"');
    expect(linked).toContain('title: "Declare Incident"');
    expect(privacy).toContain(
      'cardTitle: translationKey("Who can see this alert")',
    );
    expect(privacy).toContain('switchTitle: translationKey("Private Alert")');
    expect(privacy).toContain(
      'makePrivateConfirmTitle: translationKey("Make this alert private?")',
    );
    expect(reminders).toContain('cardTitle: translationKey("Reminders")');
    expect(reminders).toContain(
      'switchTitle: translationKey("Send reminders")',
    );

    expect(pages).toContain(
      "**Linked Incidents** — the incidents this alert is part of, with **Link Incident** and **Declare Incident**.",
    );
    expect(pages).toContain(
      "**Settings** — **Who can see this alert**, with the **Private Alert** switch, and **Reminders**, with **Send reminders**.",
    );
    expect(section(page, "## Private alerts")).toContain(
      "which asks **Make this alert private?** before it hides the alert.",
    );
  });

  it("says who a private alert is seen by, in the product's words", () => {
    const model: string = readCommonSource("Models/DatabaseModels/Alert.ts");

    expect(model).toContain(
      "If true, this alert is only visible to its owners (users in 'owner users' and members of 'owner teams'), project admins, and project owners.",
    );
    expect(section(page, "## Private alerts")).toContain(
      "A private alert is seen only by its owners, the owner users and the members of its owner teams, and by your project's admins and owners.",
    );
  });

  it('says an episode a private alert opens reads "Private alert" where it would show the alert\'s title', () => {
    const engine: string = readCommonSource(
      "Server/Services/AlertGroupingEngineService.ts",
    );

    expect(engine).toContain(
      'const PRIVATE_ALERT_TEMPLATE_VALUE: string = "Private alert";',
    );
    expect(section(page, "## Private alerts")).toContain(
      'it reads "Private alert".',
    );
    expect(section(english(ALERT_EPISODES), "## Episode titles")).toContain(
      '`{{alertTitle}}` and `{{alertDescription}}` read "Private alert"',
    );
  });
});

// ---- Who hears about an alert -------------------------------------------------

describe("who hears about an alert", () => {
  const page: string = english(ALERTS_OVERVIEW);
  const hears: string = section(page, "## Who hears about an alert");
  const settingsPage: string = readDashboardSource(
    "Pages/UserSettings/NotificationSettings.tsx",
  );
  const defaults: string = readCommonSource(
    "Server/Services/UserNotificationSettingService.ts",
  );

  // The events a member starts with, by email, from the method that adds them.
  function defaultEvents(methodName: string): Array<string> {
    const start: number = defaults.indexOf(`private async ${methodName}(`);

    expect(start).toBeGreaterThan(0);

    const body: string = defaults.slice(
      start,
      defaults.indexOf("\n  }\n", start),
    );

    return Array.from(
      body.matchAll(/NotificationSettingEventType\.(\w+)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
  }

  // How the Notification Settings page names an event.
  function eventLabel(eventKey: string): string {
    const at: number = settingsPage.indexOf(
      `[NotificationSettingEventType.${eventKey}]:`,
    );

    expect({ event: eventKey, found: at >= 0 }).toEqual({
      event: eventKey,
      found: true,
    });

    return settingsPage.slice(at).match(/label: "([^"]+)"/)?.[1] || "";
  }

  it("names the owners' events as the Notification Settings page does, and the three that are on by default", () => {
    const onByDefault: Array<string> = defaultEvents(
      "addAlertNotificationSettings",
    ).map(eventLabel);
    const offByDefault: Array<string> = [
      "SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION",
      "SEND_ALERT_OWNER_ADDED_NOTIFICATION",
    ].map(eventLabel);

    expect(onByDefault).toEqual([
      "Alert created",
      "Alert state changed",
      "Alert reminder",
    ]);
    expect(defaults).toContain("item.alertByEmail = true;");
    expect(hears).toContain(
      `**${onByDefault[0]}**, **${onByDefault[1]}** and **${onByDefault[2]}** are on by default, and **${offByDefault[0]}** and **${offByDefault[1]}** are off until someone turns them on.`,
    );
  });

  it("names the episode owners' three default events, as the episodes page does", () => {
    const onByDefault: Array<string> = defaultEvents(
      "addAlertEpisodeNotificationSettings",
    ).map(eventLabel);

    expect(onByDefault).toEqual([
      "Alert episode created",
      "Alert episode state changed",
      "Alert added to alert episode",
    ]);
    expect(english(ALERT_EPISODES)).toContain(
      `**${onByDefault[0]}**, **${onByDefault[1]}** and **${onByDefault[2]}** are on by email by default`,
    );
  });

  it("sends nothing without a setting, so an event no one turned on is not sent", () => {
    expect(defaults).toContain(
      "Every channel below is sent only through this setting row",
    );
  });

  it("finds the Alerts tab on both of a person's pages", () => {
    expect(settingsPage).toContain('name: "Alerts",');
    expect(
      readDashboardSource("Components/NotificationRule/OnCallRuleKinds.ts"),
    ).toContain('tabName: "Alerts",');
    expect(hears).toContain(
      "under **User Settings → On-Call Rules**, on the **Alerts** tab.",
    );
    expect(hears).toContain(
      "under **User Settings → Notification Settings**, on the **Alerts** tab",
    );
  });

  it("falls back to the project's owners in every owner job, as the page says", () => {
    for (const job of [
      "SendCreatedResourceNotification",
      "SendStateChangeNotification",
      "SendNotePostedNotification",
      "SendUnresolvedReminderNotification",
    ]) {
      expect({
        job,
        fallsBack: readPackageFile(
          `App/FeatureSet/Workers/Jobs/AlertOwners/${job}.ts`,
        ).includes("ProjectService.getOwners("),
      }).toEqual({ job, fallsBack: true });
    }

    expect(hears).toContain(
      "An alert with no owners notifies the project's owners instead.",
    );
  });

  it("acknowledges the alert, or the episode and its alerts, when someone answers their page", () => {
    const timeline: string = readCommonSource(
      "Server/Services/UserOnCallLogTimelineService.ts",
    );
    const episodeService: string = readCommonSource(
      "Server/Services/AlertEpisodeService.ts",
    );

    expect(timeline).toContain("await AlertService.acknowledgeAlert({");
    expect(timeline).toContain("await AlertEpisodeService.acknowledgeEpisode(");
    // Acknowledging an episode moves its alerts too, unless told not to.
    expect(episodeService).toContain(
      "acknowledgedByUserId?: ObjectID,\n    cascadeToAlerts: boolean = true,",
    );

    expect(hears).toContain("Answering the page acknowledges the alert");
    expect(english(ALERT_EPISODES)).toContain(
      "**Answering an episode's page** acknowledges the episode, and with it every alert in it.",
    );
  });
});

// ---- States and severities ---------------------------------------------------

describe("alert states and severities", () => {
  const page: string = english(ALERT_STATES);
  const copy: (typeof STATE_SETTINGS_COPY)[StateListType.AlertState] =
    STATE_SETTINGS_COPY[StateListType.AlertState];
  const severityCopy: (typeof STATE_SETTINGS_COPY)[StateListType.AlertSeverity] =
    STATE_SETTINGS_COPY[StateListType.AlertSeverity];

  // The project's seeded states, as the order rules read them.
  const seeded: Array<Record<string, unknown>> = [
    { _id: "identified", name: "Identified", order: 1, isCreatedState: true },
    {
      _id: "acknowledged",
      name: "Acknowledged",
      order: 2,
      isAcknowledgedState: true,
    },
    { _id: "resolved", name: "Resolved", order: 3, isResolvedState: true },
  ];

  it("names the settings pages' cards, and says what their order means in the page's words", () => {
    expect(copy.title).toBe("Alert States");
    expect(copy.description).toBe(
      "Alerts only ever move down this list. Drag a state to change where it sits. A new state is added just above the resolved state.",
    );
    expect(severityCopy.title).toBe("Alert Severities");
    expect(page).toContain("The **Alert States** card lists your states");
    expect(page).toContain("The **Alert Severities** card lists them");
    expect(page).toContain(
      "The new state is added just above the resolved state",
    );
  });

  it("names what a state counts as, as the Counts as column draws it", () => {
    expect(copy.countsAs?.title).toBe("Counts as");
    expect(copy.countsAs?.byBuiltIn).toEqual({
      isCreatedState: "Not acknowledged",
      isAcknowledgedState: "Acknowledged",
      isResolvedState: "Resolved",
    });
    expect(page).toContain(
      "above the acknowledged state an alert is **Not acknowledged**, from it down **Acknowledged**, and from the resolved state down **Resolved**.",
    );
  });

  it("adds a new state above the resolved state, keeps the built-in ones in order and never lets them be deleted", () => {
    const definition: (typeof STATE_LISTS)[StateListType.AlertState] =
      STATE_LISTS[StateListType.AlertState];

    expect(definition.insertAboveFlag).toBe("isResolvedState");
    expect(definition.keepsBuiltInOrder).toBe(true);
    expect(copy.deleteLockedReason).toBe(
      "Built-in states can be renamed, but not deleted.",
    );
    expect(page).toContain(
      "they keep their order, created before acknowledged before resolved, and they cannot be deleted",
    );
  });

  it("gives severities no built-in rows, and so no delete lock", () => {
    expect(STATE_LISTS[StateListType.AlertSeverity].builtIns).toEqual([]);
    expect(page).toContain(
      "Severities have no flags and no delete lock: any severity can be deleted, the seeded two included.",
    );
  });

  it("quotes the refusals of a backwards move and of a move to the same state, as the order rule words them", () => {
    const backwards: string | null = StateMoveUtil.getMoveRefusal({
      record: StateMoveRecord.Alert,
      from: seeded[2] as { _id: string; name: string; order: number },
      to: seeded[1] as { _id: string; name: string; order: number },
    });
    const same: string | null = StateMoveUtil.getMoveRefusal({
      record: StateMoveRecord.Alert,
      from: seeded[1] as { _id: string; name: string; order: number },
      to: seeded[1] as { _id: string; name: string; order: number },
    });
    const episodeBackwards: string | null = StateMoveUtil.getMoveRefusal({
      record: StateMoveRecord.AlertEpisode,
      from: seeded[2] as { _id: string; name: string; order: number },
      to: seeded[1] as { _id: string; name: string; order: number },
    });

    expect(page).toContain(`"${backwards}"`);
    expect(page).toContain(`"${same}"`);
    expect(episodeBackwards).toMatch(/^Episode cannot transition to /);
    expect(page).toContain('("Episode cannot transition to …")');
  });

  it("quotes the refusals of a second acknowledge, as the services word them", () => {
    const acknowledged: string | null =
      AcknowledgedStateUtil.getAcknowledgeRefusal({
        list: StateListType.AlertState,
        states: seeded,
        stateId: "acknowledged",
        subject: "Alert",
      });
    const resolved: string | null = AcknowledgedStateUtil.getAcknowledgeRefusal(
      {
        list: StateListType.AlertState,
        states: seeded,
        stateId: "resolved",
        subject: "Alert",
      },
    );

    expect(acknowledged).toBe("Alert is already acknowledged.");
    expect(resolved).toBe("Alert is already resolved.");
    expect(page).toContain(`"${acknowledged}" or "${resolved}"`);
    expect(readCommonSource("Server/Services/AlertService.ts")).toContain(
      'subject: "Alert",',
    );
  });

  it("names the header's dialogs and the bulk change as the dashboard draws them", () => {
    const changeState: string = readDashboardSource(
      "Components/Alert/ChangeState.tsx",
    );
    const alertsTable: string = readDashboardSource(
      "Components/Alert/AlertsTable.tsx",
    );
    const stateKinds: string = readDashboardSource(
      "Components/EventView/EventStateKinds.ts",
    );

    expect(changeState).toContain('translationKey("Acknowledge Alert")');
    expect(changeState).toContain('translationKey("Resolve Alert")');
    expect(changeState).toContain(
      'translator.translateTemplate("Mark Alert as {{state}}", {',
    );
    // The list's Change State, from the alerts' entry in the state engine.
    expect(stateKinds).toContain(
      '"Select the state to change alerts to. Alerts already at or past the selected state will be skipped.",',
    );
    expect(alertsTable).toContain("kind: EventStateKind.Alert,");
    expect(page).toContain(
      "**Acknowledge Alert**, **Resolve Alert** or **Mark Alert as {{state}}**",
    );
    // A row's ⋯ menu asks the header's question, and a selection the list's.
    expect(stateKinds).toContain(
      'rowTitle: translationKey("Acknowledge Alert"),',
    );
    expect(stateKinds).toContain('rowTitle: translationKey("Resolve Alert"),');
    expect(page).toContain(
      "| **List row** | The **⋯** menu on an alert's row in the alerts list: **Acknowledge**, **Resolve** and **Change State** | The header's confirmation, naming the alert.",
    );
    expect(page).toContain(
      "**Acknowledge**, **Resolve** or **Change State** on a selection in the alerts list",
    );
    expect(page).toContain("Alerts already at or past the state are skipped.");
  });

  it("offers Acknowledge and Resolve until the alert is acknowledged, then only Resolve, and neither once it is resolved", () => {
    const changeState: string = readDashboardSource(
      "Components/Alert/ChangeState.tsx",
    );
    const actions: string = changeState.slice(
      changeState.indexOf("const getActions"),
      changeState.indexOf("return actions;"),
    );

    expect(actions).toContain("if (isResolved) {\n        return [];");
    expect(actions).toContain("if (acknowledgedState && !isAcknowledged) {");
    expect(page).toContain(
      "The header offers **Acknowledge** and **Resolve** while the alert is not acknowledged yet, and only **Resolve** once it is. A resolved alert shows neither.",
    );
  });

  it("names the state timeline's card, columns and actions as the page draws them", () => {
    const timeline: string = readDashboardSource(
      "Pages/Alerts/View/StateTimeline.tsx",
    );
    const text: string = section(page, "## The state timeline");

    /*
     * The page opens on the timeline (ModelStatusTimeline): a band to scale
     * and every change under it, newest first - with Table, the switch in
     * the card's header, one click away.
     */
    expect(timeline).toContain("<ModelStatusTimeline<AlertStateTimeline>");
    // The card is named like the page and its menu entry: State Timeline.
    expect(timeline).toContain('title="State Timeline"');
    expect(timeline).not.toContain('"Status Timeline"');
    expect(timeline).toContain("rightElement: viewSwitch,");
    expect(
      readCommonSource("UI/Components/StatusTimeline/StatusTimelineView.tsx"),
    ).toContain('label: translationKey("Table"),');
    expect(
      readCommonSource("UI/Components/StatusTimeline/ModelStatusTimeline.tsx"),
    ).toContain("startsAt: SortOrder.Descending,");
    expect(text).toContain(
      "Its card draws them as a timeline: a band with each state as long as it lasted, and under it every change, newest first.",
    );
    expect(timeline).toContain('title: "State Timeline",');
    expect(timeline).toContain('title: "Alert Status",');
    expect(timeline).toContain('title: "View Cause",');
    expect(timeline).toContain('title: "View Logs",');
    expect(timeline).toContain(
      "getStateTimelineEndsAtColumn<AlertStateTimeline>()",
    );
    expect(timeline).toContain(
      "getStateTimelineDurationColumn<AlertStateTimeline>()",
    );
    expect(timeline).toContain("isEditable={false}");
    expect(text).toContain(
      "**Table**, in the card's header, lists them as rows instead, with **Alert Status**, **Starts At**, **Ends At** and **Duration**.",
    );
    // The only row is never deleted.
    expect(
      readCommonSource("Server/Services/AlertStateTimelineService.ts"),
    ).toContain("ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.Alert]");
    expect(text).toContain("and an alert always keeps at least one.");
  });

  it("says which plans add and change states and severities on OneUptime Cloud, as the models gate them", () => {
    function gate(model: string): string {
      const source: string = readCommonSource(
        `Models/DatabaseModels/${model}.ts`,
      );
      const start: number = source.indexOf("@TableBillingAccessControl({");

      expect({ model, gated: start >= 0 }).toEqual({ model, gated: true });

      return source.slice(start, source.indexOf("})", start));
    }

    for (const model of ["AlertState", "AlertSeverity"]) {
      expect(gate(model)).toContain("create: PlanType.Growth,");
      expect(gate(model)).toContain("update: PlanType.Growth,");
      expect(gate(model)).toContain("read: PlanType.Free,");
    }

    // A state you added can be deleted on every plan.
    expect(gate("AlertState")).toContain("delete: PlanType.Free,");

    for (const model of ["AlertNoteTemplate", "AlertCustomField"]) {
      expect(gate(model)).toContain("create: PlanType.Growth,");
      expect(gate(model)).toContain("read: PlanType.Growth,");
    }

    expect(page).toContain(
      "adding or changing alert states and severities takes the **Growth** plan or above. Every plan can read them, use them and delete a state you added.",
    );
    expect(english(ALERT_SETTINGS)).toContain(
      "On OneUptime Cloud, note templates and custom fields take the **Growth** plan or above.",
    );
  });

  it("keeps Active Alerts to the states above the resolved one, as the list and its badge query them", () => {
    const unresolved: string = readDashboardSource(
      "Pages/Alerts/Unresolved.tsx",
    );

    expect(unresolved).toContain('useUnresolvedStateIds("alert")');
    expect(readDashboardSource("Pages/Alerts/SideMenu.tsx")).toContain(
      'useUnresolvedStateIds("alert")',
    );
    expect(section(page, "## The Active Alerts list")).toContain(
      "holds every alert whose state sits above your resolved state",
    );
  });

  it("maps a monitor recommendation's Critical and Warning onto the first two severities", () => {
    const seeding: string = readCommonSource(
      "Server/Services/ProjectService.ts",
    );

    expect(seeding).toContain(
      "`MonitorRecommendationSeverityMapper` maps a recommendation's declared",
    );
    expect(seeding).toContain(
      "`Critical` onto rank 1 and `Warning` onto rank 2",
    );
    expect(page).toContain(
      "OneUptime maps it onto your first and second alert severity, which in a new project are **High** and **Low**.",
    );
  });
});

// ---- Episodes and grouping rules ---------------------------------------------

describe("alert episodes and grouping rules", () => {
  const page: string = english(ALERT_EPISODES);
  const engine: string = readCommonSource(
    "Server/Services/AlertGroupingEngineService.ts",
  );
  const rulesPage: string = readDashboardSource(
    "Pages/Alerts/Settings/AlertGroupingRules.tsx",
  );
  const KIND: GroupingRuleKind = GroupingRuleKind.Alert;

  it("lists the four templates with their names and time windows, in the order they are offered", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "### Start from a template"),
    ).map(tableCells);
    const windows: Record<number, string> = {
      10: "10 minutes",
      30: "30 minutes",
      60: "1 hour",
    };

    expect(
      rows.map((cells: Array<string>): Array<string> => {
        return [cells[0] as string, cells[2] as string];
      }),
    ).toEqual(
      GROUPING_RULE_TEMPLATES.map(
        (template: GroupingRuleTemplate): Array<string> => {
          return [
            `**${template.name[KIND]}**`,
            windows[template.timeWindowMinutes] || "",
          ];
        },
      ),
    );
  });

  it("names the template buttons and the custom rule's buttons as the page draws them", () => {
    const templates: string = section(page, "### Start from a template");
    const own: string = section(page, "### Create your own");

    expect(templates).toContain(
      `**${GROUPING_RULE_COPY.templatesModalTitle}** on the card opens them. **${GROUPING_RULE_COPY.addRule}** saves one`,
    );
    expect(own).toContain(
      `Click **${GROUPING_RULE_COPY.createCustomRule}** under the templates, or **Create Alert Grouping Rule** on the card`,
    );
    expect(own).toContain("Then click **Create Alert Grouping Rule**.");
    expect(
      readCommonSource("Models/DatabaseModels/AlertGroupingRule.ts"),
    ).toContain('singularName: "Alert Grouping Rule"');
  });

  it("asks the form's one question with its own answers, in order", () => {
    const own: string = section(page, "### Create your own");
    const answers: Array<string> = GROUPING_MODE_OPTIONS.map(
      (option: GroupingModeOption): string => {
        return option.title;
      },
    );

    expect(GROUPING_RULE_COPY.groupingStepTitle).toBe("Grouping");
    expect(GROUPING_RULE_COPY.modeFieldTitle[KIND]).toBe("Group alerts by");
    expect(own).toContain(
      `On the **${GROUPING_RULE_COPY.groupingStepTitle}** step, **${GROUPING_RULE_COPY.modeFieldTitle[KIND]}** asks one question: ${answers
        .slice(0, -1)
        .map((answer: string): string => {
          return `**${answer}**`;
        })
        .join(", ")} or **${answers[answers.length - 1]}**.`,
    );
  });

  it("starts a new rule's time window at the form's default, under the form's own words", () => {
    const own: string = section(page, "### Create your own");

    expect(DEFAULT_TIME_WINDOW_MINUTES).toBe(30);
    expect(own).toContain(
      `**${GROUPING_RULE_COPY.timeWindowTitle[KIND]}** is on, with a window of ${DEFAULT_TIME_WINDOW_MINUTES} minutes.`,
    );
  });

  it("names the Custom step's five switches as the form draws them, and the step after it", () => {
    const own: string = section(page, "### Create your own");
    const switches: Array<string> = [
      "Group By Monitor",
      "Group By Alert Severity",
      "Group By Alert Title",
      "Group By Alert Labels",
      "Group By Monitor Labels",
    ];

    expect(rulesPage).toContain(
      'title: "Group By",\n            id: "group-by"',
    );

    for (const title of switches) {
      expect(rulesPage).toContain(`title: "${title}",`);
    }

    expect(own).toContain(
      `adds a **Group By** step with five switches: ${switches
        .slice(0, -1)
        .map((title: string): string => {
          return `**${title}**`;
        })
        .join(", ")} and **${switches[switches.length - 1]}**.`,
    );
    expect(GROUPING_RULE_COPY.whichStepTitle[KIND]).toBe("Which Alerts");
    expect(own).toContain(`On **${GROUPING_RULE_COPY.whichStepTitle[KIND]}**,`);
  });

  it("folds everything else under More fields in the three groups the form draws, with their settings", () => {
    const table: Array<Array<string>> = tableRows(
      section(page, "## Create a grouping rule").split("Everything else")[1] ||
        "",
    ).map(tableCells);

    expect(
      table.map((cells: Array<string>): string => {
        return cells[0] as string;
      }),
    ).toEqual([
      "**On-Call & Ownership**",
      "**Episode Lifecycle**",
      "**Details**",
    ]);

    for (const group of [
      "On-Call & Ownership",
      "Episode Lifecycle",
      "Details",
    ]) {
      expect(rulesPage).toContain(`sectionTitle: "${group}"`);
    }

    expect(boldNames(table[0]?.[1] || "")).toEqual([
      "On-Call Duty Policies",
      GROUPING_RULE_COPY.episodeOwnersTitle,
    ]);
    expect(boldNames(table[1]?.[1] || "")).toEqual([
      GROUPING_RULE_COPY.reopenWindowTitle,
      GROUPING_RULE_COPY.resolveDelayTitle,
      GROUPING_RULE_COPY.inactivityTimeoutTitle,
    ]);
    expect(boldNames(table[2]?.[1] || "")).toEqual([
      "Description",
      "Episode Title Template",
      "Episode Description Template",
      "Episode Labels",
    ]);
  });

  it("lists exactly the template variables the engine fills, as the form offers them", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Episode titles"),
    ).map(tableCells);

    expect(
      rows.map((cells: Array<string>): string => {
        return cells[0] as string;
      }),
    ).toEqual(
      [
        ...ALERT_EPISODE_TEMPLATE_STATIC_VARIABLES,
        ...ALERT_EPISODE_TEMPLATE_DYNAMIC_VARIABLES,
      ].map((variable: { name: string }): string => {
        return `\`{{${variable.name}}}\``;
      }),
    );

    for (const variable of ALERT_EPISODE_TEMPLATE_STATIC_VARIABLES) {
      expect(engine).toContain(`\\{\\{${variable.name}\\}\\}`);
    }

    expect(engine).toContain('"{{alertCount}}"');
  });

  it("names an episode without a template after its monitor, or the alert title's first 50 characters", () => {
    expect(engine).toContain(
      "if (values.monitorName) {\n        return values.monitorName;",
    );
    expect(engine).toContain("return alert.title.substring(0, 50);");
    expect(section(page, "## Episode titles")).toContain(
      "an episode is named after the monitor of its first alert, or after the first 50 characters of the alert's title when it has no monitor.",
    );
  });

  it("checks the rules from the top of the list down, and takes the first that matches", () => {
    expect(engine).toContain("priority: SortOrder.Ascending,");
    expect(engine).toContain("// Find first matching rule");
    expect(rulesPage).toContain('dragDropIndexField="priority"');
    expect(GROUPING_RULE_COPY.cardDescription[KIND]).toContain(
      "Rules are checked from top to bottom and the first match wins",
    );
    expect(section(page, "## How grouping works")).toContain(
      "from the top of the list down, and the first rule that matches it decides its episode.",
    );
  });

  it("groups a rule with no group-by into one episode, and joins only within the time window when it is on", () => {
    expect(engine).toContain('return parts.join("|") || "default";');
    expect(engine).toContain(
      "query.lastAlertAddedAt = QueryHelper.greaterThanEqualTo(timeWindowCutoff);",
    );
    expect(section(page, "## How grouping works")).toContain(
      "A rule that groups by nothing puts every alert it matches into one episode.",
    );
  });

  it("joins an open episode first, then reopens one resolved within the window, then opens a new one", () => {
    expect(
      inOrder(
        positionsIn(engine, [
          "const existingEpisode: AlertEpisode | null",
          "if (options.mayOpenEpisode === false) {",
          "if (rule.enableReopenWindow) {",
          "const newEpisode: AlertEpisode | null = await this.createNewEpisode(",
        ]),
      ),
    ).toBe(true);
  });

  it("groups each alert once, right after its own on-call policies run", () => {
    const steps: string = onCreateSuccessSteps(
      readCommonSource("Server/Services/AlertService.ts"),
    );

    expect(
      inOrder(
        positionsIn(steps, [
          "this.executeAlertOnCallDutyPoliciesAsync",
          "AlertGroupingEngineService.processAlert",
        ]),
      ),
    ).toBe(true);
    // An alert already in an episode is not grouped again.
    expect(engine).toContain("if (alert.alertEpisodeId) {");
    expect(section(page, "## How grouping works")).toContain(
      "Grouping runs once for each new alert, right after its on-call policies run.",
    );
  });

  it("raises an episode's severity only, from the first alert's, by the severities' rank", () => {
    const episodeService: string = readCommonSource(
      "Server/Services/AlertEpisodeService.ts",
    );

    expect(engine).toContain(
      "newEpisode.alertSeverityId = alert.alertSeverityId;",
    );
    expect(engine).toContain("onlyIfHigher: true,");
    expect(episodeService).toContain("// Lower order = higher severity");
    expect(page).toContain(
      "It starts with its first alert's severity, and takes the severity of any more severe alert that joins it",
    );
  });

  it("moves an episode's alerts with its state, except those in that state or past it", () => {
    const timeline: string = readCommonSource(
      "Server/Services/AlertEpisodeStateTimelineService.ts",
    );
    const episodeService: string = readCommonSource(
      "Server/Services/AlertEpisodeService.ts",
    );

    expect(timeline).toContain(
      "AlertEpisodeService.cascadeStateToMemberAlerts({",
    );
    expect(episodeService).toContain("StateMoveUtil.isMoveAllowed({");
    expect(page).toContain(
      "every alert in it moves too, except an alert already in that state or past it.",
    );
  });

  it("resolves an episode once all its alerts are, after the rule's wait, every minute - without moving the alerts", () => {
    const autoResolve: string = readPackageFile(
      "App/FeatureSet/Workers/Jobs/AlertEpisode/AutoResolve.ts",
    );

    expect(autoResolve).toContain("schedule: EVERY_MINUTE,");
    expect(autoResolve).toContain(
      "false, // Don't cascade to alerts - they're already resolved",
    );
    expect(autoResolve).toContain(
      "enableResolveDelay && resolveDelayMinutes > 0",
    );
    expect(page).toContain(
      "**It resolves itself** once every alert in it is resolved. **Wait before resolving an episode** holds it open for that many minutes first",
    );
  });

  it("warns that resolving a quiet episode resolves the alerts still open in it", () => {
    const inactive: string = readPackageFile(
      "App/FeatureSet/Workers/Jobs/AlertEpisode/ResolveInactiveEpisodes.ts",
    );

    expect(inactive).toContain("schedule: EVERY_FIVE_MINUTE,");
    expect(inactive).toContain(
      "true, // Cascade to alerts - resolve all member alerts as well",
    );
    expect(page).toContain(
      "**Resolve quiet episodes** resolves an episode when no new alert has joined it for the minutes you set, and resolves every alert still open in it too.",
    );
  });

  it("reopens an episode as OneUptime's own move back up the list, without reopening its alerts", () => {
    const episodeService: string = readCommonSource(
      "Server/Services/AlertEpisodeService.ts",
    );
    const reopen: string = episodeService.slice(
      episodeService.indexOf("public async reopenEpisode("),
    );

    expect(reopen.slice(0, 1600)).toContain("isGroupingRuleReopen: true,");
    // A resolved alert may not move back up its list, so the cascade leaves it.
    expect(
      StateMoveUtil.getMoveRefusal({
        record: StateMoveRecord.Alert,
        from: { _id: "resolved", name: "Resolved", order: 3 },
        to: { _id: "identified", name: "Identified", order: 1 },
      }),
    ).not.toBeNull();
    expect(page).toContain(
      "It is the one move back up the list of states, and it does not reopen the episode's alerts.",
    );
  });

  it("runs a new episode's policies, and an alert's own, as the episode pages say", () => {
    const episodeService: string = readCommonSource(
      "Server/Services/AlertEpisodeService.ts",
    );
    const created: string = episodeService.slice(
      episodeService.indexOf("protected override async onCreateSuccess("),
    );

    expect(engine).toContain(
      "newEpisode.onCallDutyPolicies = onCallDutyPolicies;",
    );
    expect(
      inOrder(
        positionsIn(created, [
          "AlertEpisodeOnCallRuleEngineService.applyRulesToEpisode",
          "this.executeEpisodeOnCallDutyPoliciesAsync",
        ]),
      ),
    ).toBe(true);
    expect(page).toContain(
      "**A new episode** runs the rule's **On-Call Duty Policies**, plus those of any matching rule on the **Episode Rules** tab of **Alerts → Rules → On-Call Rules**.",
    );
  });

  it("names the episode create form, its steps and its buttons as the pages draw them", () => {
    const create: string = readDashboardSource(
      "Pages/Alerts/EpisodeCreate.tsx",
    );
    const table: string = readDashboardSource(
      "Components/AlertEpisode/AlertEpisodesTable.tsx",
    );
    const steps: string = section(page, "## Create an episode by hand");

    expect(create).toContain('title="Create New Alert Episode"');
    expect(create).toContain('title: "Episode Details",');
    expect(create).toContain('title: "On-Call & Owners",');
    expect(create).toContain('submitButtonText={"Create Episode"}');
    expect(table).toContain('title: "Create Episode",');
    expect(table).toContain('translator.translateText("Manual")');

    for (const name of [
      "Create Episode",
      "Create New Alert Episode",
      "Episode Details",
      "On-Call & Owners",
      "Member Alerts",
    ]) {
      expect(steps).toContain(`**${name}**`);
    }

    /*
     * Alerts are added several at a time, from the episode's Add Alerts
     * dialog, or an episode is started from the alerts list.
     */
    expect(
      readDashboardSource("Pages/Alerts/EpisodeView/Alerts.tsx"),
    ).toContain('title: "Add Alerts",');
    expect(
      readDashboardSource(
        "Components/EpisodeMembers/BulkAddToEpisodeActions.tsx",
      ),
    ).toContain('translationKey("Add to New Episode")');
    for (const name of [
      "Add Alerts",
      "Alerts",
      "Add to New Episode",
      "Bulk Actions",
    ]) {
      expect(steps).toContain(`**${name}**`);
    }
    expect(steps).not.toContain("one at a time");

    expect(page).toContain(
      "the list shows its **Grouping Rule** as **Manual**",
    );
  });

  it("names the episode header's menu as the header draws it", () => {
    expect(
      readDashboardSource("Components/AlertEpisode/ChangeState.tsx"),
    ).toContain('moreMenuTitle={translationKey("Move episode to")}');
    expect(page).toContain("**Move episode to** in the **⋯** menu");
  });
});

/*
 * The Dashboard used to carry its own manual about alert grouping (Alerts →
 * Episodes → Documentation), and one about incident grouping: they said
 * what these pages say, and drifted from them (single-brace template
 * variables, a default team or user nothing reads). They are gone - the
 * docs are the one place for it - and each episode list links here instead:
 * View Documentation, under its empty state and in its ⋯ menu.
 */
describe("the episode lists send readers to these pages", () => {
  const DOCS_CONTENT: string = path.resolve(
    __dirname,
    "../../../FeatureSet/Docs/Content",
  );

  // The docs path an episode list's View Documentation opens, by its constant.
  function docsPathOf(constant: string): string {
    const source: string = readDashboardSource(
      "Components/EpisodeView/EpisodeDocsLinks.ts",
    );
    const match: RegExpMatchArray | null = source.match(
      new RegExp(`${escapeRegExp(constant)}: string = "([^"]+)"`),
    );

    expect({ constant, found: Boolean(match) }).toEqual({
      constant,
      found: true,
    });

    return match ? (match[1] as string) : "";
  }

  it("draws no manual of its own about episodes", () => {
    for (const file of [
      "Pages/Alerts/EpisodeDocs.tsx",
      "Pages/Incidents/EpisodeDocs.tsx",
    ]) {
      expect({
        file,
        exists: fs.existsSync(path.join(DASHBOARD_SRC_DIR, file)),
      }).toEqual({ file, exists: false });
    }

    expect(sectionByTitle(alertsMenu(), "Episodes").items).toEqual([
      "All Episodes",
      "Active Episodes",
    ]);
  });

  it.each([
    [
      "Components/AlertEpisode/AlertEpisodesTable.tsx",
      "ALERT_EPISODES_DOCS_PATH",
      "/docs/alerts/episodes",
    ],
    [
      "Components/IncidentEpisode/IncidentEpisodesTable.tsx",
      "INCIDENT_EPISODES_DOCS_PATH",
      "/docs/incidents/episodes",
    ],
  ])(
    "%s links to %s, a docs page in every language",
    (table: string, constant: string, docsPath: string) => {
      expect(readDashboardSource(table)).toContain(
        `documentationLink={Route.fromString(${constant})}`,
      );
      expect(docsPathOf(constant)).toBe(docsPath);

      const page: string = docsPath.replace("/docs/", "");

      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({
          language,
          page,
          exists: fs.existsSync(
            path.join(DOCS_CONTENT, language, `${page}.md`),
          ),
        }).toEqual({ language, page, exists: true });
      }
    },
  );

  it("is the page this one is: Alerts → Episodes reads alerts/episodes", () => {
    expect(docsPathOf("ALERT_EPISODES_DOCS_PATH")).toBe(
      `/docs/${ALERT_EPISODES}`,
    );
  });
});

// ---- Rules and settings ---------------------------------------------------------

describe("alert rules and settings", () => {
  const page: string = english(ALERT_SETTINGS);
  const settingsDir: string = "Pages/Alerts/Settings";

  it("puts the On-Call, Owner, Label and Privacy rules on an Alert Rules tab and an Episode Rules tab", () => {
    for (const file of [
      "AlertOnCallRules",
      "AlertOwnerRules",
      "AlertLabelRules",
      "AlertPrivacyRules",
    ]) {
      const source: string = readDashboardSource(`${settingsDir}/${file}.tsx`);

      expect({
        file,
        alertTab: source.includes('name: "Alert Rules",'),
      }).toEqual({ file, alertTab: true });
      expect({
        file,
        episodeTab: source.includes('name: "Episode Rules",'),
      }).toEqual({ file, episodeTab: true });
    }

    expect(page).toContain(
      "**On-Call Rules**, **Owner Rules**, **Label Rules** and **Privacy Rules** have two tabs: **Alert Rules**, for alerts, and **Episode Rules**",
    );
  });

  /*
   * Making a rule wait for working hours: the page names the question, the
   * answer and the picker's fields as the form draws them, and says the
   * hours begin as Monday to Friday, 09:00 to 17:00, as the picker does.
   */
  it("makes a rule wait for working hours with the form's own words", () => {
    const steps: string = section(page, "## On-call rules");
    const form: string = readDashboardSource("Utils/Form/EventRuleForm.ts");
    const picker: string = readDashboardSource(
      "Components/OnCallRule/WorkingHoursPicker.tsx",
    );

    expect(steps).toContain(
      "answer **When should this rule page?** under **More fields** with **Only during working hours**",
    );
    expect(form).toContain('"When should this rule page?"');
    expect(form).toContain('"Only during working hours"');

    expect(steps).toContain(
      "The **Working Hours** start as Monday to Friday, 09:00 to 17:00, in your own time zone",
    );
    expect(steps).toContain(
      "another **Start Time** or **End Time**, or another **Timezone**",
    );
    expect(picker).toContain('translationKey("Start Time")');
    expect(picker).toContain('translationKey("End Time")');
    expect(form).toContain('title: "Timezone",');
    expect(form).toContain('title: "Working Hours",');
    expect(
      readCommonSource("Types/OnCallDutyPolicy/WorkingHours.ts"),
    ).toContain("export const DEFAULT_WORKDAY_START_HOUR: number = 9;");
  });

  it("walks the on-call rule's two steps with the form's own names, and starts a rule enabled", () => {
    const source: string = readDashboardSource(
      `${settingsDir}/AlertOnCallRules.tsx`,
    );
    const form: string = readDashboardSource("Utils/Form/EventRuleForm.ts");
    const steps: string = section(page, "## On-call rules");

    // Match first, then the policies the rule pages and its name.
    expect(source).toContain(
      "formSteps={getOnCallRuleFormSteps<AlertOnCallRule>()}",
    );
    expect(source).toContain(
      "...getOnCallRuleActionFields<AlertOnCallRule>(OnCallRuleRecord.Alert),",
    );
    expect(form).toContain('{ title: "Match", id: "match-criteria" },');
    expect(form).toContain('{ title: "On-Call Policies", id: "on-call" },');
    expect(form).toContain('title: "On-Call Duty Policies",');
    expect(form).toContain('allPicks: translationKey("Page {{policies}}"),');
    expect(form).toContain("doNotShowWhenCreating: true,");
    expect(
      readCommonSource("Models/DatabaseModels/AlertOnCallRule.ts"),
    ).toContain('singularName: "Alert On-Call Rule"');

    for (const name of [
      "Create Alert On-Call Rule",
      "Match",
      "On-Call Policies",
      "On-Call Duty Policies",
      "Name",
      "Description",
      "More fields",
    ]) {
      expect(steps).toContain(`**${name}**`);
    }

    expect(steps).toContain('such as "Page Platform on-call"');
    expect(steps).not.toContain("**Basic Info**");
  });

  it("names the conditions an alert rule can match on, as the rule forms list them", () => {
    const source: string = readDashboardSource(
      `${settingsDir}/AlertOnCallRules.tsx`,
    );
    const conditions: string = section(page, "### Conditions");
    const alertRules: string = source.slice(
      0,
      source.indexOf("const EpisodeRulesTable"),
    );

    for (const title of [
      "Monitors",
      "Alert Severities",
      "Alert Labels",
      "Monitor Labels",
      "Alert Title",
      "Alert Description",
      "Monitor Name",
      "Monitor Description",
    ]) {
      expect({
        title,
        offered: alertRules.includes(`title: "${title}",`),
      }).toEqual({ title, offered: true });
      expect(conditions).toContain(`**${title}**`);
    }
  });

  it("names the conditions' operators and how they combine, as the condition builder labels them", () => {
    const fields: string = readCommonSource(
      "UI/Components/RuleCriteria/RuleCriteriaFields.ts",
    );
    const conditions: string = section(page, "### Conditions");

    for (const operator of [
      "Has any of",
      "Has all of",
      "Has none of",
      "Contains",
      "Does not contain",
      "Equals",
      "Does not equal",
      "Starts with",
      "Ends with",
      "Matches pattern",
      "Does not match pattern",
      "Match all",
      "Match any",
    ]) {
      expect({ operator, labelled: fields.includes(`"${operator}"`) }).toEqual({
        operator,
        labelled: true,
      });
      expect(conditions).toContain(`**${operator}**`);
    }
  });

  it("walks the reminder rule's two steps and fields with the form's own names and defaults", () => {
    const source: string = readDashboardSource(
      `${settingsDir}/AlertReminderRules.tsx`,
    );
    const form: string = readDashboardSource("Utils/Form/EventRuleForm.ts");
    const model: string = readCommonSource(
      "Models/DatabaseModels/AlertReminderRule.ts",
    );
    const stopStates: string = readCommonSource(
      "Types/Reminder/ReminderStopState.ts",
    );
    const reminders: string = section(page, "## Reminder rules");

    expect(source).toContain(
      "formSteps={getReminderRuleFormSteps<AlertReminderRule>()}",
    );
    expect(source).toContain(
      '...getReminderRuleActionFields<AlertReminderRule>("alert"),',
    );

    for (const step of [
      '{ title: "Match", id: "match-criteria" },',
      '{ title: "Reminders", id: "reminder-settings" },',
    ]) {
      expect(form).toContain(step);
    }

    expect(form).toContain('"Remind every {{interval}} until resolved"');
    expect(form).toContain('title: "Reminder Interval (minutes)",');
    expect(form).toContain('title: "Stop Reminders When",');
    expect(stopStates).toContain('Acknowledged = "Acknowledged",');
    expect(stopStates).toContain('Resolved = "Resolved",');
    expect(model).toContain("defaultValue: ReminderStopState.Resolved,");
    expect(source).toContain('dragDropIndexField="order"');
    expect(
      readCommonSource("Models/DatabaseModels/AlertReminderRule.ts"),
    ).toContain('singularName: "Alert Reminder Rule"');

    expect(reminders).toContain(
      "set **Reminder Interval (minutes)**, how often owners are reminded, and **Stop Reminders When**: **Resolved**, the default, or **Acknowledged**.",
    );
    expect(reminders).toContain(
      "Each new alert gets the first rule that matches it",
    );
    expect(reminders).toContain(
      'such as "Remind every 30 minutes until resolved"',
    );
    expect(reminders).not.toContain("**Rule Info**");
  });

  it("matches every open alert again when a reminder rule is saved", () => {
    const service: string = readCommonSource(
      "Server/Services/AlertReminderRuleService.ts",
    );

    for (const hook of [
      "onCreateSuccess",
      "onUpdateSuccess",
      "onDeleteSuccess",
    ]) {
      const at: number = service.indexOf(`protected override async ${hook}(`);

      expect(at).toBeGreaterThan(0);
      expect(service.slice(at, at + 700)).toContain(
        "this.refreshSchedulesForOpenAlerts(",
      );
    }

    expect(page).toContain(
      "Reminder rules are the exception: saving one matches every open alert again.",
    );
  });

  it("names the note templates' card and fields, and says they fill in no variables", () => {
    const source: string = readDashboardSource(
      `${settingsDir}/AlertNoteTemplates.tsx`,
    );
    const notes: string = section(page, "### Note templates");

    expect(source).toContain('title: "Private Note Templates for Alerts",');
    expect(source).toContain('title: "Template Name",');
    expect(source).toContain('title: "Template Description",');
    expect(
      readDashboardSource("Components/NoteTemplate/NoteTemplateFormCopy.ts"),
    ).toContain('noteFieldTitle: "Note",');
    expect(
      readCommonSource("Models/DatabaseModels/AlertNoteTemplate.ts"),
    ).toContain('singularName: "Alert Note Template"');
    // Only incident note templates fill in variables.
    expect(
      fs.existsSync(
        path.join(
          PACKAGES_DIR,
          "Common/Utils/Incident/IncidentNoteTemplateVariables.ts",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          PACKAGES_DIR,
          "Common/Utils/Alert/AlertNoteTemplateVariables.ts",
        ),
      ),
    ).toBe(false);

    expect(notes).toContain(
      "The **Private Note Templates for Alerts** card lists them; **Create Alert Note Template** asks for a **Template Name**, a **Template Description** and the **Note**.",
    );
    expect(notes).toContain("Alert note templates are plain text");
  });

  it("names the number prefix dialog's fields as the page draws them", () => {
    const prefixes: string = readDashboardSource(
      "Components/NumberPrefix/NumberPrefixSettings.ts",
    );
    const alertPage: string = prefixes.slice(
      prefixes.indexOf("export const ALERT_NUMBER_PREFIXES"),
    );

    expect(alertPage).toContain('formTitle: "Alert Number Prefix",');
    expect(alertPage).toContain('formTitle: "Alert Episode Number Prefix",');
    expect(page).toContain(
      "**Update** opens **Alert Number Prefix** and **Alert Episode Number Prefix**",
    );
  });

  it("names the next number card and its fields as the page draws them, and links to the rules", () => {
    const nextNumbers: string = readDashboardSource(
      "Components/NextNumber/NextNumberSettings.ts",
    );
    const alertPage: string = nextNumbers.slice(
      nextNumbers.indexOf("export const ALERT_NEXT_NUMBERS"),
      nextNumbers.indexOf("export const SCHEDULED_MAINTENANCE_NEXT_NUMBERS"),
    );

    expect(nextNumbers).toContain(
      'export const NEXT_NUMBER_CARD_TITLE: string = translationKey("Next Number");',
    );
    expect(alertPage).toContain(
      'formTitle: translationKey("Next Alert Number"),',
    );
    expect(alertPage).toContain(
      'formTitle: translationKey("Next Alert Episode Number"),',
    );
    expect(page).toContain(
      "The **Next Number** card under it sets the number the next alert and the next episode get, to carry on from another tool's numbers: **Update** opens **Next Alert Number** and **Next Alert Episode Number**, each higher than the highest used so far.",
    );
    // The rules are the incidents' rules, on the page the paragraph links to.
    expect(page).toContain(
      "See [Next numbers](/docs/incidents/settings#next-numbers).",
    );
  });

  it("names the measurements' ready-made ones and their moments as the form offers them", () => {
    const moments: string = readCommonSource(
      "Utils/Measurement/MeasurementMoments.ts",
    );

    expect(moments).toContain('label: "The alert is created",');
    expect(moments).toContain('label: "The alert enters a state you pick",');
    expect(page).toContain("`oneuptime.alert.measurement.<key>`");
    expect(page).toContain(
      "such as when **The alert is created** and when it enters a state you pick",
    );
  });

  it("names the AI switches as the AI settings page draws them, and their defaults for new projects", () => {
    const copy: string = readDashboardSource(
      "Components/AISettings/ProjectAiSettingsCopy.ts",
    );
    const projectService: string = readCommonSource(
      "Server/Services/ProjectService.ts",
    );
    const newProjectDefaults: Array<string> = quotedListConstant(
      projectService,
      "NEW_PROJECT_AI_DEFAULT_COLUMNS",
    );

    expect(copy).toContain('title: translationKey("Investigate new alerts"),');
    expect(copy).toContain(
      'title: translationKey("Fix new alerts automatically"),',
    );
    expect(newProjectDefaults).toContain("enableAutomaticAlertInvestigation");
    expect(newProjectDefaults).not.toContain("enableAutomaticAlertRemediation");
    expect(page).toContain(
      "**Investigate new alerts**, on for new projects, and **Fix new alerts automatically**, off until you turn it on.",
    );
  });

  it("names the roles and the permissions the rules take, as the permissions describe them", () => {
    const permissions: string = readCommonSource("Types/Permission.ts");
    const who: string = section(page, "## Who can change these");

    expect(permissions).toContain('title: "Alert Admin",');
    expect(permissions).toContain(
      "Does everything Alert Member does, and also creates, changes and deletes alert severities and states. Alert rules, custom fields and measurements take Project Admin.",
    );
    expect(permissions).toContain('title: "Alert Member",');

    for (const model of [
      "AlertGroupingRule",
      "AlertOnCallRule",
      "AlertReminderRule",
      "AlertCustomField",
      "AlertMeasurement",
    ]) {
      const source: string = readCommonSource(
        `Models/DatabaseModels/${model}.ts`,
      );
      const create: string = source.slice(
        source.indexOf("@TableAccessControl({"),
        source.indexOf("read:", source.indexOf("@TableAccessControl({")),
      );

      expect({
        model,
        projectAdmin: create.includes("Permission.ProjectAdmin"),
        member: create.includes("Permission.ProjectMember"),
        alertMember: create.includes("Permission.AlertMember"),
      }).toEqual({
        model,
        projectAdmin: true,
        member: false,
        alertMember: false,
      });
    }

    expect(who).toContain(
      "Rules, custom fields and measurements need a Project Owner or Project Admin, or a custom role with that rule's own permission.",
    );
  });

  it("names the workflow components the builder makes, and leaves custom field definitions without triggers", () => {
    expect(readCommonSource("Models/DatabaseModels/Alert.ts")).toContain(
      "@EnableWorkflow({",
    );
    expect(
      readCommonSource("Models/DatabaseModels/AlertCustomField.ts"),
    ).not.toContain("@EnableWorkflow(");

    const components: string = readCommonSource(
      "Types/Workflow/Components/BaseModel.ts",
    );

    for (const verb of [
      "On Create",
      "On Update",
      "On Create or Update",
      "On Delete",
    ]) {
      expect(components).toContain(`${verb} \${model.singularName}`);
    }

    expect(components).toContain("`Update One ${model.singularName}`");
    expect(section(page, "## Workflows")).toContain(
      "Alert custom field definitions are the one exception: they have no workflow triggers.",
    );
  });

  it("links to the pages that cover the rule forms and running rules on what is there", () => {
    expect(page).toContain("(/docs/configuration/label-and-owner-rules)");
    expect(page).toContain("(/docs/configuration/run-rules-now)");
    expect(page).toContain("(/docs/runbooks/rules)");
    expect(readPage("en", "configuration/run-rules-now")).toContain(
      "- **Privacy Rules**, for incidents, alerts, incident episodes and alert episodes.",
    );
  });
});

/*
 * The readers above are what the tests lean on; a reader that found nothing
 * would make them pass for the wrong reason.
 */
describe("the readers", () => {
  it("read a section up to the next heading of its level, and fail on one the page lacks", () => {
    const markdown: string =
      "# T\n\n## A\n\none\n\n### B\n\ntwo\n\n## C\n\nthree\n";

    expect(section(markdown, "## A")).toContain("two");
    expect(section(markdown, "## A")).not.toContain("three");
    expect(section(markdown, "### B")).not.toContain("three");
  });

  it("read a menu table's sections and pages, leaving out what follows a ':'", () => {
    const table: string = [
      "| Section | Pages |",
      "| --- | --- |",
      "| **Basic** | **Overview**, **Owners** |",
      "| **Logs** | **AI Logs**: everything **AI** did |",
    ].join("\n");

    expect(menuTable(table)).toEqual([
      { title: "Basic", items: ["Overview", "Owners"] },
      { title: "Logs", items: ["AI Logs"] },
    ]);
  });

  it("read a section's fold from its own setting, or from its title", () => {
    expect(
      startsCollapsed(
        '{ title: "Rules", defaultCollapsed: true, items: [] }',
        "Rules",
      ),
    ).toBe(true);
    expect(
      startsCollapsed('{ title: "Episodes", items: [] }', "Episodes"),
    ).toBe(false);
    expect(
      sectionHead(
        '<SideMenuSection title="On Call" defaultCollapsed={true}>',
        "On Call",
      ),
    ).toContain("defaultCollapsed");
    expect(stringConstant('X: string = "y";', "X")).toBe("y");
  });

  it("tell steps that run in order from steps that do not", () => {
    expect(inOrder([1, 5, 9])).toBe(true);
    expect(inOrder([1, 9, 5])).toBe(false);
  });

  it("read the seeded rows of a project's states", () => {
    const rows: Array<SeededRow> = seededRows("addDefaultAlertState");

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        name: "Identified",
        order: 1,
        flag: "isCreatedState",
        color: "#fd625e",
      }),
    );
  });
});
