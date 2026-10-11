import SubscriberChannelsCopy, {
  SUBSCRIBER_CHANNELS,
  SubscriberChannelDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelsCopy";
import {
  DISPLAY_DAYS,
  DISPLAY_SWITCHES,
  DisplayDaysDefinition,
  DisplaySwitchDefinition,
  MAX_UPTIME_HISTORY_DAYS,
  parseDisplayDays,
} from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import CacheGenerations from "Common/Server/Infrastructure/CacheGenerations";
import StatusPageOverviewCache from "Common/Server/Utils/StatusPage/StatusPageOverviewCache";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import ColumnBillingAccessControl from "Common/Types/BaseDatabase/ColumnBillingAccessControl";
import { getColumnBillingAccessControlForAllColumns } from "Common/Types/Database/AccessControl/ColumnBillingAccessControl";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import Dictionary from "Common/Types/Dictionary";
import { MASTER_PASSWORD_COOKIE_MAX_AGE_IN_DAYS } from "Common/Types/StatusPage/MasterPassword";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import { SECTION_TITLES_COLLAPSED_BY_DEFAULT } from "Common/UI/Components/SideMenu/SideMenuSectionState";
import { readPage } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { boldSpans, prose } from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English Status Pages Overview and Subscribers & Announcements
 * pages say about the product, held to the code that makes it true (docs
 * task 18b).
 *
 * Markdown is not compiled, so nothing else notices when a status page
 * menu gains or loses a page, the create form asks for more, a default or a
 * plan moves, a visitor route is added, the feed or the badge changes its
 * shape, or the subscribe forms change what they ask. Each test reads the
 * source of truth - the StatusPage and StatusPageSubscriber models, the
 * dashboard's pages and copy modules, the status page app's routes, nav and
 * locale, and the server's API and caches - and checks the page still says
 * what it does. The translations are held to these English pages by
 * StatusPageDocsTranslations; One Status Page per Audience is held to the
 * feature by OneStatusPagePerAudienceDocs.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const OVERVIEW: string = "status-pages/index";
const SUBSCRIBERS: string = "status-pages/subscribers";

const DASHBOARD: string = "App/FeatureSet/Dashboard/src";
const STATUS_PAGES_LIST: string = `${DASHBOARD}/Pages/StatusPages/StatusPages.tsx`;
const STATUS_PAGES_MENU: string = `${DASHBOARD}/Pages/StatusPages/SideMenu.tsx`;
const STATUS_PAGE_MENU: string = `${DASHBOARD}/Pages/StatusPages/View/SideMenu.tsx`;
const STATUS_PAGE_OVERVIEW: string = `${DASHBOARD}/Pages/StatusPages/View/Index.tsx`;
const STATUS_PAGE_PREVIEW_LINK: string = `${DASHBOARD}/Pages/StatusPages/View/StatusPagePreviewLink.tsx`;
const STATUS_PAGE_GROUPS: string = `${DASHBOARD}/Pages/StatusPages/View/Groups.tsx`;
const EMBEDDED_STATUS: string = `${DASHBOARD}/Pages/StatusPages/View/EmbeddedStatus.tsx`;
const SUBSCRIBER_SETTINGS: string = `${DASHBOARD}/Pages/StatusPages/View/SubscriberSettings.tsx`;
const EMAIL_SUBSCRIBERS: string = `${DASHBOARD}/Pages/StatusPages/View/EmailSubscribers.tsx`;

const STATUS_PAGE_APP: string = "App/FeatureSet/StatusPage/src";
const VISITOR_ROUTES: string = `${STATUS_PAGE_APP}/Utils/RouteMap.ts`;
const VISITOR_NAV: string = `${STATUS_PAGE_APP}/Components/NavBar/NavBar.tsx`;
const VISITOR_LOCALE: string = `${STATUS_PAGE_APP}/Locales/en.json`;
const RSS_FEED: string = `${STATUS_PAGE_APP}/Server/API/RSS.ts`;

const STATUS_PAGE_API: string = "Common/Server/API/StatusPageAPI.ts";
const SUBSCRIBER_SERVICE: string =
  "Common/Server/Services/StatusPageSubscriberService.ts";

/*
 * The status page app's routes the overview does not list, and why. Every
 * other route it serves, outside the dashboard's preview, is on the page.
 */
const UNLISTED_VISITOR_ROUTES: Record<string, string> = {
  "/logout": "The Log Out item of a private page's nav bar, named there.",
  "/forgot-password":
    "Part of the private users' own forgot-password flow, named under Private users.",
  "/reset-password/:token":
    "Part of the private users' own reset-password flow, named under Private users.",
  "/forbidden":
    "Where a visitor who may not see a page lands; not a page of its own.",
  "status-page/not-found":
    "Where an address that is no status page lands; not a page of its own.",
};

const NUMBER_WORDS: ReadonlyArray<string> = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

interface MenuSection {
  title: string;
  items: Array<string>;
  collapsed: boolean;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

// The text of a "## " or "### " section, up to the next heading of its level or above.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading: heading, found: start >= 0 }).toEqual({
    heading: heading,
    found: true,
  });

  const level: number = heading.indexOf(" ");
  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#{1,6}) /);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

// "**A**", "**A** and **B**", "**A**, **B** and **C**": a list as the pages write one.
function boldList(names: ReadonlyArray<string>): string {
  const bold: Array<string> = names.map((name: string): string => {
    return `**${name}**`;
  });

  if (bold.length <= 1) {
    return bold.join("");
  }

  return `${bold.slice(0, -1).join(", ")} and ${bold[bold.length - 1]}`;
}

function isCollapsedByDefault(title: string): boolean {
  return SECTION_TITLES_COLLAPSED_BY_DEFAULT.includes(title);
}

/*
 * A status page's own side menu, read from source (the menus are React
 * components a plain-node test must not render): each <SideMenuSection> with
 * the titles of its links, the Developer section the menu adds where it
 * calls getDeveloperSideMenuSection, and whether the section starts folded.
 * A title picked by a ternary counts as its first option, the one the docs
 * name.
 */
function statusPageMenu(): Array<MenuSection> {
  const source: string = readSource(STATUS_PAGE_MENU);
  const marks: Array<{ at: number; section?: MenuSection; item?: string }> = [];

  for (const match of source.matchAll(
    /<SideMenuSection\s+title="([^"]+)"([^>]*)>/g,
  )) {
    const title: string = match[1] as string;
    const explicit: RegExpMatchArray | null = (match[2] as string).match(
      /defaultCollapsed=\{(true|false)\}/,
    );

    marks.push({
      at: match.index as number,
      section: {
        title: title,
        items: [],
        collapsed: explicit
          ? explicit[1] === "true"
          : isCollapsedByDefault(title),
      },
    });
  }

  for (const match of source.matchAll(/getDeveloperSideMenuSection\(/g)) {
    marks.push({
      at: match.index as number,
      section: {
        title: DEVELOPER_DOCS_SECTION_TITLE,
        items: DEVELOPER_DOCS_PAGES.map(
          (page: DeveloperDocsPageDefinition): string => {
            return page.title;
          },
        ),
        collapsed: isCollapsedByDefault(DEVELOPER_DOCS_SECTION_TITLE),
      },
    });
  }

  for (const match of source.matchAll(
    /title:\s*(?:[\w?.]+\s*\?\s*)?"([^"]+)"/g,
  )) {
    marks.push({ at: match.index as number, item: match[1] as string });
  }

  const sections: Array<MenuSection> = [];

  for (const mark of marks.sort(
    (
      a: { at: number; section?: MenuSection; item?: string },
      b: { at: number; section?: MenuSection; item?: string },
    ): number => {
      return a.at - b.at;
    },
  )) {
    if (mark.section) {
      sections.push(mark.section);
    } else if (mark.item) {
      sections[sections.length - 1]?.items.push(mark.item);
    }
  }

  return sections;
}

/*
 * The Status Pages product menu: a `sections` array, each section's title
 * indented less than its links' titles.
 */
function statusPagesMenu(): Array<MenuSection> {
  const source: string = readSource(STATUS_PAGES_MENU);
  const lines: Array<RegExpMatchArray> = source
    .split("\n")
    .map((line: string): RegExpMatchArray | null => {
      return line.match(/^(\s*)title: "([^"]+)",$/);
    })
    .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
      return match !== null;
    });
  const sectionIndent: number = Math.min(
    ...lines.map((match: RegExpMatchArray): number => {
      return (match[1] as string).length;
    }),
  );
  const sections: Array<MenuSection> = [];

  for (const match of lines) {
    const title: string = match[2] as string;

    if ((match[1] as string).length === sectionIndent) {
      const block: string = source.slice(source.indexOf(`title: "${title}",`));
      const explicit: RegExpMatchArray | null = block
        .slice(0, block.indexOf("items:"))
        .match(/defaultCollapsed: (true|false)/);

      sections.push({
        title: title,
        items: [],
        collapsed: explicit
          ? explicit[1] === "true"
          : isCollapsedByDefault(title),
      });
      continue;
    }

    sections[sections.length - 1]?.items.push(title);
  }

  return sections;
}

// The status page app's routes, outside the dashboard's preview.
function visitorRoutes(): Array<string> {
  return Array.from(
    readSource(VISITOR_ROUTES).matchAll(/new Route\(\s*`([^`]+)`\s*,?\s*\)/g),
  )
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    })
    .filter((route: string): boolean => {
      return !route.startsWith("/status-page/");
    });
}

function codeSpans(text: string): Array<string> {
  return Array.from(prose(text).matchAll(/`([^`\n]+)`/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function statusPageDefault(column: string): unknown {
  return new StatusPage().getTableColumnMetadata(column).defaultValue;
}

function subscriberColumn(column: string): {
  title: string;
  defaultValue: unknown;
} {
  const metadata: TableColumnMetadata =
    new StatusPageSubscriber().getTableColumnMetadata(column);

  expect({ column: column, titled: Boolean(metadata.title) }).toEqual({
    column: column,
    titled: true,
  });

  return {
    title: metadata.title as string,
    defaultValue: metadata.defaultValue,
  };
}

// The plan a status page column needs on OneUptime Cloud, or null when it needs none.
function planOf(column: string): PlanType | null {
  const plans: Dictionary<ColumnBillingAccessControl> =
    getColumnBillingAccessControlForAllColumns(new StatusPage());
  const plan: ColumnBillingAccessControl | undefined = plans[column];

  if (!plan) {
    return null;
  }

  // A plan is sold for creating and changing the column alike.
  expect({ column: column, create: plan.create }).toEqual({
    column: column,
    create: plan.update,
  });

  return plan.update;
}

describe("the Status Pages Overview: creating a status page", () => {
  const page: string = englishPage(OVERVIEW);
  const list: string = readSource(STATUS_PAGES_LIST);
  const formFields: string = list.slice(
    list.indexOf("formFields={["),
    list.indexOf("saveFilterProps="),
  );

  it("asks only for Name, at least two characters, and an optional Description", () => {
    expect(
      Array.from(formFields.matchAll(/title: "([^"]+)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual(["Name", "Description"]);
    expect(formFields).toMatch(
      /title: "Name",[\s\S]*?required: true,[\s\S]*?minLength: 2,/,
    );
    expect(formFields).toMatch(/title: "Description",[\s\S]*?required: false/);
    expect(page).toContain(
      "In the **Create New Status Page** modal, fill in **Name** (required, at least two characters) and, optionally, **Description**, then click **Create Status Page**.",
    );
    expect(page).toContain(
      "A new status page only asks for **Name** and **Description**.",
    );
  });

  it("lists the columns and filters the Status Pages table has", () => {
    const titles: (marker: string, end: string) => Array<string> = (
      marker: string,
      end: string,
    ): Array<string> => {
      const block: string = list.slice(
        list.indexOf(marker),
        list.indexOf(end, list.indexOf(marker)),
      );

      return Array.from(block.matchAll(/title: "([^"]+)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      );
    };

    const columns: Array<string> = titles(
      "columns={[",
      "{labelBulkActionModals}",
    );
    const filters: Array<string> = titles("filters={[", "columns={[");

    expect(columns).toEqual(["Name", "Description", "Labels", "Owners"]);
    expect(filters).toEqual(["Status Page ID", "Name", "Description"]);
    expect(page).toContain(
      `The list you land back on shows ${boldList(columns)}, and can be filtered by ${boldList(filters)}.`,
    );
  });

  it("lands on the Overview screen, with the preview link and the details card that edits what was just set", () => {
    const overview: string = readSource(STATUS_PAGE_OVERVIEW);
    const details: string = overview.slice(
      overview.indexOf('title: "Status Page Details"'),
      overview.indexOf("modelDetailProps="),
    );

    expect(readSource(STATUS_PAGE_PREVIEW_LINK)).toContain(
      "title={`Status Page Preview URL`}",
    );
    expect(details).toContain("name: true");
    expect(details).toContain("description: true");
    expect(details).toContain("getLabelsFormField<StatusPage>()");
    expect(overview).toContain("<OverviewCustomFields");
    expect(page).toContain(
      "Open the new page and you land on its **Overview** screen, which carries two cards: **Status Page Preview URL** with a link to the page itself, and **Status Page Details** where you can edit the name, description and labels you just set. Once the project has status page custom fields, a **Custom Fields** card follows them.",
    );
  });
});

describe("the Status Pages Overview: where everything lives", () => {
  const page: string = englishPage(OVERVIEW);
  const where: string = sectionOf(page, "## Where everything lives");

  it("maps every section of a status page's side menu, with its pages, in the menu's order", () => {
    const menu: Array<MenuSection> = statusPageMenu();
    const rows: Array<Array<string>> = (
      tables(where)[0] as Array<Array<string>>
    ).slice(1);

    expect(
      rows.map((cells: Array<string>): string => {
        return (cells[0] as string).replace(/\*\*/g, "");
      }),
    ).toEqual(
      menu.map((section: MenuSection): string => {
        return section.title;
      }),
    );

    for (const section of menu) {
      const row: Array<string> = rows.find((cells: Array<string>): boolean => {
        return cells[0] === `**${section.title}**`;
      }) as Array<string>;

      expect({
        section: section.title,
        pages: boldSpans(row[1] as string),
      }).toEqual({ section: section.title, pages: section.items });
    }

    expect(where).toContain(
      `its own left side menu is grouped into ${NUMBER_WORDS[menu.length]} sections.`,
    );
  });

  it("opens only Basic and Resources at first", () => {
    expect(
      statusPageMenu()
        .filter((section: MenuSection): boolean => {
          return !section.collapsed;
        })
        .map((section: MenuSection): string => {
          return section.title;
        }),
    ).toEqual(["Basic", "Resources"]);
    expect(where).toContain(
      "Only **Basic** and **Resources**, what the page shows, start open. Every other section starts collapsed",
    );
  });

  it("names Resources Monitors without monitor groups, and sends the old groups address to Resources", () => {
    expect(readSource(STATUS_PAGE_MENU)).toMatch(
      /title: project\?\.isFeatureFlagMonitorGroupsEnabled\s*\?\s*"Resources"\s*:\s*"Monitors"/,
    );
    expect(readSource(STATUS_PAGE_GROUPS)).toMatch(
      /RouteMap\[PageMap\.STATUS_PAGE_VIEW_RESOURCES\][\s\S]*<Navigate to=\{resourcesRoute\.toString\(\)\} replace=\{true\} \/>/,
    );
    expect(where).toContain(
      "The **Resources** item is only labeled **Resources** when the project has monitor groups enabled. Otherwise it reads **Monitors**.",
    );
    expect(where).toContain(
      "the old `/groups` route now redirects to the resources screen.",
    );
  });

  it("lists the Status Pages menu's own sections, and which start folded", () => {
    const menu: Array<MenuSection> = statusPagesMenu();
    const byTitle: (title: string) => MenuSection = (
      title: string,
    ): MenuSection => {
      const section: MenuSection | undefined = menu.find(
        (candidate: MenuSection): boolean => {
          return candidate.title === title;
        },
      );

      expect({ title: title, found: Boolean(section) }).toEqual({
        title: title,
        found: true,
      });

      return section as MenuSection;
    };

    expect(
      menu.map((section: MenuSection): string => {
        return section.title;
      }),
    ).toEqual(["Status Pages", "More", "Settings", "Advanced"]);

    const statusPages: MenuSection = byTitle("Status Pages");
    const more: MenuSection = byTitle("More");
    const settings: MenuSection = byTitle("Settings");
    const advanced: MenuSection = byTitle("Advanced");

    expect([statusPages.collapsed, more.collapsed]).toEqual([false, false]);
    expect([settings.collapsed, advanced.collapsed]).toEqual([true, true]);
    expect(where).toContain(
      `the **Status Pages** section itself lists ${boldList(statusPages.items)}, and a **More** section holds ${boldList(more.items)}.`,
    );
    expect(where).toContain(
      `A collapsed **Settings** section holds ${boldList(settings.items)}, which are project-wide`,
    );
    expect(where).toContain(
      `A collapsed **Advanced** section holds ${boldList(advanced.items)}:`,
    );
  });
});

describe("the Status Pages Overview: what visitors see", () => {
  const page: string = englishPage(OVERVIEW);
  const visitors: string = sectionOf(page, "## What visitors see");

  it("lists every route the status page app serves, but the ones it says why it leaves out", () => {
    const routes: Array<string> = visitorRoutes();
    const routeList: string = visitors.slice(
      0,
      visitors.indexOf("The top nav bar"),
    );

    expect(routes).toContain("/");
    expect(codeSpans(routeList).sort()).toEqual(
      routes
        .filter((route: string): boolean => {
          return UNLISTED_VISITOR_ROUTES[route] === undefined;
        })
        .sort(),
    );

    // Each route left out is still one the app serves.
    for (const route of Object.keys(UNLISTED_VISITOR_ROUTES)) {
      expect({ route: route, served: routes.includes(route) }).toEqual({
        route: route,
        served: true,
      });
    }
  });

  it("shows Overview always, a list's item while its switch is on, Subscribe with a channel, and Log Out on a private page", () => {
    const nav: string = readSource(VISITOR_NAV);
    const items: string = nav.slice(nav.indexOf("const navItems"));
    const always: string = items.slice(
      0,
      items.indexOf('id: "overview-nav-bar-item"'),
    );

    expect(always).not.toMatch(/\bif \(/);

    for (const [condition, item] of [
      ["props.showIncidentsOnStatusPage", "incidents-nav-bar-item"],
      ["props.showAnnouncementsOnStatusPage", "announcements-nav-bar-item"],
      [
        "props.showScheduledMaintenanceEventsOnStatusPage",
        "scheduled-events-nav-bar-item",
      ],
      ["props.isPrivateStatusPage", "logout-nav-bar-item"],
    ] as Array<[string, string]>) {
      expect(items).toMatch(
        new RegExp(
          `if \\(${condition.replace(/\./g, "\\.")}\\) \\{\\s*addNavItem\\(\\{\\s*id: "${item}"`,
        ),
      );
    }

    const subscribe: string = items.slice(
      items.indexOf("props.showSubscriberPageOnStatusPage &&"),
      items.indexOf('id: "subscribe-nav-bar-item"'),
    );

    for (const channel of SUBSCRIBER_CHANNELS) {
      const column: string = channel.column.replace(
        "enableSmsSubscribers",
        "enableSMSSubscribers",
      );

      expect({ column: column, gates: subscribe.includes(column) }).toEqual({
        column: column,
        gates: true,
      });
    }

    expect(visitors).toContain(
      "The top nav bar always shows **Overview**; the rest appear only when enabled. **Incidents**, **Announcements** and **Scheduled Events** each need their toggle on; **Subscribe** needs both **Show Subscriber Page** and at least one subscriber channel enabled. A private page also gets a **Log Out** item.",
    );
  });

  it("serves an overview at most 15 seconds old, and takes off what is hidden within a second", () => {
    expect(StatusPageOverviewCache.TTL_MS).toBe(15 * 1000);
    expect(StatusPageOverviewCache.SHARED_GENERATION_READ_TTL_MS).toBe(
      CacheGenerations.SHARED_READ_TTL_MS,
    );
    expect(CacheGenerations.SHARED_READ_TTL_MS).toBe(1000);
    expect(visitors).toContain(
      "The overview a visitor is shown is at most 15 seconds old, and anything you take off the page leaves it within a second",
    );
    expect(visitors).toContain(
      "Other edits, such as a new title, show within those 15 seconds.",
    );
  });
});

describe("the Status Pages Overview: choosing what shows on the page", () => {
  const page: string = englishPage(OVERVIEW);
  const card: string = sectionOf(page, "## Choosing what shows on the page");

  it("names every switch of the card by its title and its column", () => {
    for (const definition of DISPLAY_SWITCHES) {
      expect({
        title: definition.title,
        named: card.includes(`**${definition.title}**`),
        column: card.includes(`\`${definition.column}\``),
      }).toEqual({ title: definition.title, named: true, column: true });
    }
  });

  it("gives each switch the default a new status page has", () => {
    for (const definition of DISPLAY_SWITCHES) {
      const stored: boolean = statusPageDefault(definition.column) === true;
      // An inverted switch is on while its column is off.
      const isOn: boolean = definition.isInverted ? !stored : stored;
      // The first "on/off by default" after the switch's name, on its line.
      const said: RegExpMatchArray | null = card.match(
        new RegExp(
          `\\*\\*${definition.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*[^\\n]*?\\b(on|off) by default`,
        ),
      );

      expect({ title: definition.title, said: said?.[1] }).toEqual({
        title: definition.title,
        said: isOn ? "on" : "off",
      });
    }
  });

  it("gives each list's history its column's default, and holds the uptime history to 1 through 90 days", () => {
    for (const days of DISPLAY_DAYS) {
      const value: unknown = statusPageDefault(days.column);

      if (days.column === "showUptimeHistoryInDays") {
        continue;
      }

      expect(value).toBe(14);
      expect(card).toContain(`(\`${days.column}\`, default 14)`);
    }

    const uptime: DisplayDaysDefinition | undefined = DISPLAY_DAYS.find(
      (days: DisplayDaysDefinition): boolean => {
        return days.column === "showUptimeHistoryInDays";
      },
    );

    expect(uptime?.maxDays).toBe(MAX_UPTIME_HISTORY_DAYS);
    expect(statusPageDefault("showUptimeHistoryInDays")).toBe(
      MAX_UPTIME_HISTORY_DAYS,
    );
    expect(parseDisplayDays("1", MAX_UPTIME_HISTORY_DAYS).isValid).toBe(true);
    expect(
      parseDisplayDays(String(MAX_UPTIME_HISTORY_DAYS), MAX_UPTIME_HISTORY_DAYS)
        .isValid,
    ).toBe(true);
    expect(parseDisplayDays("0", MAX_UPTIME_HISTORY_DAYS).isValid).toBe(false);
    expect(
      parseDisplayDays(
        String(MAX_UPTIME_HISTORY_DAYS + 1),
        MAX_UPTIME_HISTORY_DAYS,
      ).isValid,
    ).toBe(false);
    expect(card).toContain(
      `Defaults to ${MAX_UPTIME_HISTORY_DAYS} and must be between 1 and ${MAX_UPTIME_HISTORY_DAYS}.`,
    );
  });

  it("offers the four precisions, two decimals by default", () => {
    const percents: Array<string> = Object.values(UptimePrecision).map(
      (precision: string): string => {
        return precision.split(" ")[0] as string;
      },
    );

    expect(statusPageDefault("overallUptimePercentPrecision")).toBe(
      UptimePrecision.TWO_DECIMAL,
    );

    const isDefault: (percent: string) => boolean = (
      percent: string,
    ): boolean => {
      return UptimePrecision.TWO_DECIMAL.startsWith(`${percent} `);
    };
    const listed: Array<string> = percents.map((percent: string): string => {
      return `\`${percent}\`${isDefault(percent) ? " (the default)" : ""}`;
    });

    expect(card).toContain(
      `${listed.slice(0, -1).join(", ")} or ${listed[listed.length - 1]}`,
    );
  });

  it("says which settings need Growth, which need Scale, and which no plan", () => {
    const growth: Array<string> = [
      "showIncidentsOnStatusPage",
      "showEpisodesOnStatusPage",
      "showAnnouncementsOnStatusPage",
      "showScheduledMaintenanceEventsOnStatusPage",
      "showIncidentLabelsOnStatusPage",
      "showEpisodeLabelsOnStatusPage",
      "showScheduledEventLabelsOnStatusPage",
      "showEpisodeHistoryInDays",
    ];
    const scale: Array<string> = [
      "showOverallUptimePercentOnStatusPage",
      "hidePoweredByOneUptimeBranding",
    ];
    const anyPlan: Array<string> = [
      "showIncidentHistoryInDays",
      "showAnnouncementHistoryInDays",
      "showScheduledEventHistoryInDays",
      "showUptimeHistoryInDays",
      "overallUptimePercentPrecision",
      "downtimeMonitorStatuses",
      "onlyShowScopedIncidents",
    ];

    // Every setting of the card is in one of the three lists.
    expect(
      [
        ...DISPLAY_SWITCHES.map((definition: DisplaySwitchDefinition) => {
          return definition.column;
        }),
        ...DISPLAY_DAYS.map((days: DisplayDaysDefinition) => {
          return days.column;
        }),
        "overallUptimePercentPrecision",
        "downtimeMonitorStatuses",
      ].sort(),
    ).toEqual([...growth, ...scale, ...anyPlan].sort());

    for (const [columns, plan] of [
      [growth, PlanType.Growth],
      [scale, PlanType.Scale],
      [anyPlan, null],
    ] as Array<[Array<string>, PlanType | null]>) {
      for (const column of columns) {
        expect({ column: column, plan: planOf(column) }).toEqual({
          column: column,
          plan: plan,
        });
      }
    }

    expect(card).toContain(
      'The four list switches, the three labels switches and the episodes\' history need **Growth**; showing the overall uptime percent and hiding the "Powered by OneUptime" line need **Scale**. The other history windows, **Uptime History**, **Precision**, **Counts as downtime** and **Only Show Incidents Scoped to This Page** can be changed on every plan',
    );
  });
});

describe("the Status Pages Overview: the password, the badge, the feed and archiving", () => {
  const page: string = englishPage(OVERVIEW);

  it("lets visitors who entered an old password keep the page for as long as its cookie lasts", () => {
    expect(MASTER_PASSWORD_COOKIE_MAX_AGE_IN_DAYS).toBe(7);
    expect(page).toContain(
      `people who entered the old one can keep viewing the page for up to ${MASTER_PASSWORD_COOKIE_MAX_AGE_IN_DAYS} days.`,
    );
  });

  it("serves the badge on its route, with its token, from the Embedded Status screen", () => {
    const api: string = readSource(STATUS_PAGE_API);
    const screen: string = readSource(EMBEDDED_STATUS);

    expect(new StatusPage().getCrudApiPath()?.toString()).toBe("/status-page");
    expect(api).toContain("?.toString()}/badge/:statusPageId`");
    expect(api).toContain(
      'const token: string = req.query["token"] as string;',
    );
    expect(api).toContain("enableEmbeddedOverallStatus: true,");
    expect(api).toContain("embeddedOverallStatusToken: token,");

    for (const name of [
      'title="Enable Embedded Status Badge"',
      'title="Security Token"',
      'title: "Regenerate Token"',
      'title="Badge Preview"',
    ]) {
      expect({ name: name, found: screen.includes(name) }).toEqual({
        name: name,
        found: true,
      });
    }

    expect(statusPageDefault("enableEmbeddedOverallStatus")).toBe(false);
    expect(page).toContain(
      "turn on **Enable Embedded Status Badge** (`enableEmbeddedOverallStatus`, off by default), then click **Regenerate Token** on the **Security Token** card to give the badge its token (`embeddedOverallStatusToken`). The badge is served from `/api/status-page/badge/<status-page-id>?token=<token>`, and the screen shows it under **Badge Preview**",
    );
  });

  it("titles the feed after the page's title, or its name, and prefixes its items", () => {
    const feed: string = readSource(RSS_FEED);

    expect(feed).toContain("<title>${XML.escape(title)} Updates</title>");
    expect(readSource(STATUS_PAGE_API)).toContain(
      "title: statusPage.pageTitle || statusPage.name,",
    );

    for (const prefix of [
      "Incident: ",
      "Announcement: ",
      "Scheduled Maintenance: ",
    ]) {
      expect({
        prefix: prefix,
        found: feed.includes(`title: \`${prefix}\${`),
      }).toEqual({ prefix: prefix, found: true });
    }

    expect(page).toContain(
      'Every status page serves `/rss` — a feed titled "{page title} Updates", with the page\'s **Page Title** from **Branding**, or its name when it has none, and whose items are prefixed `Incident: `, `Announcement: ` and `Scheduled Maintenance: `.',
    );
  });

  it("answers an archived page as one that does not exist", () => {
    expect(readSource(STATUS_PAGE_API)).toMatch(
      /if \(!statusPage \|\| statusPage\.isArchived\) \{\s*return Response\.sendErrorResponse\(\s*req,\s*res,\s*new NotFoundException\("Status Page not found"\),/,
    );
    expect(page).toContain(
      'all answer as if the page did not exist ("Status Page not found")',
    );
  });
});

describe("Subscribers & Announcements: channels and signing up", () => {
  const page: string = englishPage(SUBSCRIBERS);
  const channels: string = sectionOf(page, "## Subscription channels");

  it("gives the Subscribe page's switch and each channel's its column and default, in the Channels card's order", () => {
    const switches: Array<{ title: string; column: string }> = [
      {
        title: SubscriberChannelsCopy.subscribePageTitle,
        column: "showSubscriberPageOnStatusPage",
      },
      ...SUBSCRIBER_CHANNELS.map(
        (
          channel: SubscriberChannelDefinition,
        ): {
          title: string;
          column: string;
        } => {
          return { title: channel.title, column: channel.column };
        },
      ),
    ];
    const bullets: Array<string> = channels
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- **");
      });

    expect(bullets).toHaveLength(switches.length);

    switches.forEach(
      (entry: { title: string; column: string }, index: number): void => {
        const isOn: boolean = statusPageDefault(entry.column) === true;

        expect({
          title: entry.title,
          bullet: (bullets[index] as string).startsWith(
            `- **${entry.title}** (\`${entry.column}\`) — ${isOn ? "on" : "off"} by default.`,
          ),
        }).toEqual({ title: entry.title, bullet: true });
      },
    );

    expect(channels).toContain(
      `the **${SubscriberChannelsCopy.cardTitle}** card at **Status Pages → your page → Subscribers → Subscriber Settings**`,
    );
    expect(page).toContain(
      `A status page supports ${NUMBER_WORDS[SUBSCRIBER_CHANNELS.length]} channels.`,
    );
  });

  it("names the plan each channel's switch needs", () => {
    const plans: Record<string, PlanType | null> = {};

    for (const column of [
      "showSubscriberPageOnStatusPage",
      ...SUBSCRIBER_CHANNELS.map((channel: SubscriberChannelDefinition) => {
        return channel.column;
      }),
    ]) {
      plans[column] = planOf(column);
    }

    expect(plans).toEqual({
      showSubscriberPageOnStatusPage: PlanType.Growth,
      enableEmailSubscribers: null,
      enableSmsSubscribers: PlanType.Growth,
      enableSlackSubscribers: PlanType.Scale,
      enableMicrosoftTeamsSubscribers: PlanType.Scale,
      enableWebhookSubscribers: PlanType.Scale,
    });
    expect(channels).toContain(
      "**Growth** for **SMS** and **Show Subscriber Page**, **Scale** for **Slack**, **Microsoft Teams** and **Webhook**.",
    );
  });

  it("quotes the Subscribe page's placeholders as visitors see them", () => {
    const subscribe: Record<string, Record<string, string>> = (
      JSON.parse(readSource(VISITOR_LOCALE)) as {
        subscribe: Record<string, Record<string, string>>;
      }
    ).subscribe;
    const table: string = sectionOf(
      page,
      "## What a visitor sees on the Subscribe page",
    );

    for (const placeholder of [
      subscribe["email"]?.["placeholder"],
      subscribe["sms"]?.["placeholder"],
      subscribe["slack"]?.["webhookUrlPlaceholder"],
      subscribe["microsoftTeams"]?.["webhookUrlPlaceholder"],
      subscribe["webhook"]?.["webhookUrlPlaceholder"],
    ] as Array<string>) {
      expect({
        placeholder: placeholder,
        quoted: table.includes(`with the placeholder \`${placeholder}\``),
      }).toEqual({ placeholder: placeholder, quoted: true });
    }
  });

  it("names the two choices of Advanced Subscriber Settings by their titles, columns and defaults", () => {
    const settings: string = readSource(SUBSCRIBER_SETTINGS);
    const choosing: string = sectionOf(
      page,
      "## Letting subscribers choose resources and event types",
    );

    expect(settings).toContain('title: "Advanced Subscriber Settings"');

    for (const [title, column] of [
      [
        "Allow Subscribers to Choose Resources",
        "allowSubscribersToChooseResources",
      ],
      [
        "Allow Subscribers to Choose Event Types",
        "allowSubscribersToChooseEventTypes",
      ],
    ] as Array<[string, string]>) {
      expect(settings).toContain(`title: "${title}"`);
      expect(statusPageDefault(column)).toBe(false);
      expect(choosing).toContain(
        `- **${title}** (\`${column}\`) — off by default.`,
      );
    }

    expect(settings).toContain('title: "Subscriber Timezones"');
    expect(choosing).toContain(
      "The same card also carries **Subscriber Timezones**.",
    );
  });

  it("names the event types a subscriber chooses among", () => {
    const types: Array<string> = Object.values(StatusPageEventType);

    expect(page).toContain(
      `The event types are ${types
        .slice(0, -1)
        .map((type: string): string => {
          return `\`${type}\``;
        })
        .join(", ")} and \`${types[types.length - 1]}\`.`,
    );
  });

  it("gives the subscriber record's choices their titles and defaults", () => {
    for (const column of [
      "isSubscribedToAllResources",
      "isSubscribedToAllEventTypes",
    ]) {
      const { title, defaultValue } = subscriberColumn(column);

      expect(defaultValue).toBe(true);
      expect(page).toContain(
        `**${title}** (\`${column}\`, default ${String(defaultValue)})`,
      );
    }

    for (const [column, defaultValue] of [
      ["sendYouHaveSubscribedMessage", true],
      ["isUnsubscribed", false],
    ] as Array<[string, boolean]>) {
      const metadata: { title: string; defaultValue: unknown } =
        subscriberColumn(column);

      expect(metadata.defaultValue).toBe(defaultValue);
      expect(page).toContain(
        `**${metadata.title}** (\`${column}\`, default ${String(defaultValue)})`,
      );
    }
  });
});

describe("Subscribers & Announcements: confirming an email address", () => {
  const page: string = englishPage(SUBSCRIBERS);
  const optIn: string = sectionOf(page, "## Email double opt-in");
  const service: string = readSource(SUBSCRIBER_SERVICE);

  it("makes a six-figure confirmation token, and sends the link the page shows", () => {
    expect(service).toMatch(
      /subscriptionConfirmationToken = NumberUtil\.getRandomNumber\(\s*100000,\s*999999,\s*\)\.toString\(\);/,
    );
    expect(service).toContain(
      "`/confirm-subscription/${data.statusPageSubscriberId.toString()}?verification-token=${data.confirmationToken}`",
    );
    expect(optIn).toContain(
      `a six-digit **${subscriberColumn("subscriptionConfirmationToken").title}** is generated.`,
    );
    expect(optIn).toContain(
      "`{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`",
    );
  });

  it("confirms email subscribers only, and lets the team skip it", () => {
    expect(service).toMatch(
      /if \(isEmailSubscriber && !isSubscriptionConfirmed\) \{\s*data\.data\.isSubscriptionConfirmed = false;\s*\} else \{\s*data\.data\.isSubscriptionConfirmed = true;/,
    );
    expect(readSource(EMAIL_SUBSCRIBERS)).toMatch(
      /field: \{\s*isSubscriptionConfirmed: true,?\s*\},?\s*(?:stepId: "subscriber-info",\s*)?title: "Do not send confirmation link",[\s\S]*?defaultValue: true,/,
    );
    expect(optIn).toContain(
      `**${subscriberColumn("isSubscriptionConfirmed").title}** (\`isSubscriptionConfirmed\`) is forced to \`false\``,
    );
    expect(optIn).toContain(
      "**Do not send confirmation link** is on by default there.",
    );
  });

  it("sends only to confirmed subscribers who have not unsubscribed", () => {
    expect(service).toMatch(
      /isUnsubscribed: false,\s*isSubscriptionConfirmed: true,/,
    );
    expect(optIn).toContain(
      "The query that fetches subscribers for a notification filters on `isUnsubscribed: false` and `isSubscriptionConfirmed: true`.",
    );
  });
});
