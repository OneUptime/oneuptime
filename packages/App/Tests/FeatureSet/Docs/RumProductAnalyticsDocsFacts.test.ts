/*
 * Issue #6444: what the Product Analytics page (rum/product-analytics) says
 * about an application's Users and Sessions pages, held to the code that
 * draws and counts them. RumDocsTranslations holds every translation to the
 * English page, line for line, with each Dashboard label as that language's
 * Dashboard draws it.
 *
 * App tests read no React module, so the Dashboard's words are read from its
 * source files as text; the counting rules are imported from Common.
 */

import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { cardLines } from "./DocsTranslationChecks";
import { sectionInLanguage } from "./NetworkDocsLabels";
import {
  PRODUCT_ANALYTICS,
  RUM_ANALYTICS_PAGES,
  RUM_PAGES,
  RumDocsPageEntry,
} from "./RumDocsPages";
import {
  DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS,
  PRODUCT_ANALYTICS_DIMENSIONS,
  PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS,
  PRODUCT_ANALYTICS_MONTHLY_WINDOW_DAYS,
  PRODUCT_ANALYTICS_RETENTION_MONTHS,
  PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS,
  PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE,
  PRODUCT_ANALYTICS_WEEKLY_WINDOW_DAYS,
  ProductAnalyticsDimension,
  ProductAnalyticsSessionLengthBucket,
} from "Common/Types/Rum/ProductAnalytics";
import { DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS } from "Common/Types/Rum/SessionReplay";
import { PRODUCT_ANALYTICS_SOURCE_PERSON_KEY_SQL } from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const SOURCES: Record<string, string> = {
  sideMenu: `${DASHBOARD}/Pages/Rum/View/SideMenu.tsx`,
  usersPage: `${DASHBOARD}/Pages/Rum/View/ProductAnalyticsUsers.tsx`,
  sessionsPage: `${DASHBOARD}/Pages/Rum/View/ProductAnalyticsSessions.tsx`,
  personPage: `${DASHBOARD}/Pages/Rum/View/ProductAnalyticsPerson.tsx`,
  peopleCard: `${DASHBOARD}/Components/ProductAnalytics/ProductAnalyticsPeopleCard.tsx`,
  format: `${DASHBOARD}/Components/ProductAnalytics/ProductAnalyticsFormat.ts`,
  telemetryApi: "packages/Common/Server/API/TelemetryAPI.ts",
  permissions: "packages/Common/Types/Permission.ts",
};

// A bold span: **Active users**.
const BOLD: RegExp = /\*\*([^*]+)\*\*/g;
// A tile's or a column's title in a page's source: title: "Active users",
const TITLE: RegExp = /title: "([^"]+)"/g;
// A Permission.ts entry: the enum member, then its title.
const PERMISSION_TITLE: RegExp =
  /permission: Permission\.(\w+),\s*title: "([^"]+)"/g;

function source(name: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8");
}

function englishPage(): string {
  return readPage("en", PRODUCT_ANALYTICS);
}

function section(heading: string): string {
  return sectionInLanguage("en", PRODUCT_ANALYTICS, heading);
}

function allMatches(text: string, pattern: RegExp): Array<string> {
  return Array.from(text.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The text of a source between two markers, both of which must be there.
function between(text: string, start: string, end: string): string {
  const from: number = text.indexOf(start);

  expect({ start, found: from >= 0 }).toEqual({ start, found: true });

  const to: number = text.indexOf(end, from + start.length);

  expect({ end, found: to >= 0 }).toEqual({ end, found: true });

  return text.slice(from, to);
}

// The line of a section that starts with this text.
function lineStartingWith(text: string, start: string): string {
  const lines: Array<string> = text.split("\n").filter((line: string) => {
    return line.startsWith(start);
  });

  expect({ start, lines: lines.length }).toEqual({ start, lines: 1 });

  return lines[0] as string;
}

// The words of a list as a sentence writes it: "a, b, c or d".
function listedWith(words: Array<string>, last: string): string {
  return `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;
}

function rumGroup(): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (candidate: NavGroup): boolean => {
      return candidate.title === "Real User Monitoring";
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
}

describe("Product Analytics: its place in the docs", () => {
  it("is the RUM group's fifth link, after Core Web Vitals and before Managing Applications", () => {
    const links: Array<NavLink> = rumGroup().links;
    const urls: Array<string> = links.map((link: NavLink): string => {
      return link.url;
    });
    const at: number = urls.indexOf(`/docs/${PRODUCT_ANALYTICS}`);

    expect(at).toBe(4);
    expect(urls[at - 1]).toBe("/docs/rum/web-vitals");
    expect(urls[at + 1]).toBe("/docs/rum/applications");
    expect(links[at]?.title).toBe("Product Analytics");
    expect(
      RUM_PAGES.map((entry: RumDocsPageEntry): string => {
        return `/docs/${entry.page}`;
      }),
    ).toEqual(urls);
  });

  it.each(RUM_ANALYTICS_PAGES)(
    "$page is titled as its nav link, opens with cards to its sections and ends on Next steps",
    (entry: RumDocsPageEntry) => {
      const markdown: string = englishPage();
      const headings: Array<string> = scanMarkdown(markdown).headings.map(
        (heading: { text: string }): string => {
          return heading.text;
        },
      );

      expect(markdown.split("\n")[0]).toBe(`# ${entry.navTitle}`);
      /*
       * Users and Sessions, and since the Events, Funnels and User Retention
       * pages (cc9dc46fc1c) the sections on sending events and reading them.
       */
      expect(
        cardLines(markdown.slice(0, markdown.indexOf("\n## "))).length,
      ).toBe(6);
      expect(headings[headings.length - 1]).toBe("Next steps");
      // The title, then the sections the opening cards point at, and more.
      expect(headings).toEqual([
        entry.navTitle,
        "How people are counted",
        "Users",
        "Sessions",
        "Send events and metrics",
        "User properties",
        "Events",
        "Funnels",
        "User Retention",
        "Dashboards and alerts",
        "Privacy and retention",
        "Who can see it",
        "Next steps",
      ]);
    },
  );
});

describe("Product Analytics: where it lives and what it counts", () => {
  const counted: string = section("## How people are counted");

  it("names the side menu section and its pages as SideMenu.tsx draws them, in its order", () => {
    const menu: string = between(
      source("sideMenu"),
      '<SideMenuSection title="Product Analytics">',
      "</SideMenuSection>",
    );
    const pages: Array<string> = allMatches(menu, TITLE);

    expect(pages).toEqual([
      "Users",
      "Sessions",
      "Events",
      "Funnels",
      "User Retention",
      "User Flows",
      "Analytics Settings",
    ]);
    expect(counted).toContain(
      `An application's side menu has a **Product Analytics** section: ${listedWith(
        pages.map((page: string): string => {
          return `**${page}**`;
        }),
        "and",
      )}.`,
    );
  });

  it("counts the sessions Session Replay records, as both pages say", () => {
    for (const page of ["usersPage", "sessionsPage"]) {
      expect(source(page)).toContain(
        "counted from the sessions Session Replay records.",
      );
    }

    expect(counted).toContain(
      "**Users** and **Sessions** count the sessions Session Replay records",
    );
  });

  it("files a session under its signed-in user, else its browser's visitor, else nobody, as the diagram draws it", () => {
    expect(PRODUCT_ANALYTICS_SOURCE_PERSON_KEY_SQL).toMatch(
      /^if\(identifiedUserKey != '', concat\('u:', identifiedUserKey\), if\(visitorId != '', concat\('v:', visitorId\), ''\)\)$/,
    );

    const diagram: string = scanMarkdown(englishPage()).fences.find(
      (fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      },
    )?.code as string;

    expect(diagram).toContain('named -->|"yes"| user["That signed-in user"]');
    expect(diagram).toContain(
      'visitor -->|"yes"| browser["That browser\'s<br/>anonymous visitor"]',
    );
    expect(diagram).toContain(
      'visitor -->|"no"| nobody["A session,<br/>but nobody"]',
    );
    expect(counted).toContain("counts as a session but not as a person.");
  });

  it("counts days in the reader's time zone", () => {
    expect(source("format")).toContain(
      "export function getProductAnalyticsTimeZone(",
    );
    expect(englishPage()).toContain("Days are counted in your own time zone.");
  });
});

describe("Product Analytics: the Users page", () => {
  const users: string = section("## Users");
  const rows: Array<Array<string>> = (
    tables(users).find((table: Array<Array<string>>): boolean => {
      return table[0]?.[0] === "Tile";
    }) || []
  ).slice(1);

  it("lists the page's tiles, in the order it draws them", () => {
    const tilesSource: string = between(
      source("usersPage"),
      "return [",
      "];\n}",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      allMatches(tilesSource, TITLE).map((title: string): string => {
        return `**${title}**`;
      }),
    );
    expect(rows).toHaveLength(6);
  });

  it("gives the dormant tile its default and the other windows the People filter offers", () => {
    const others: Array<number> =
      PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS.filter(
        (days: number): boolean => {
          return days !== DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS;
        },
      );

    expect(DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS).toBe(30);
    expect(rows[5]?.[1]).toBe(
      `People who came before but not in the last ${DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS} days, or the ${listedWith(
        others.map(String),
        "or",
      )} days you choose.`,
    );
  });

  it("counts total users over the months the numbers are kept", () => {
    expect(rows[4]?.[1]).toBe(
      `Everyone the application has seen in the last ${PRODUCT_ANALYTICS_RETENTION_MONTHS} months.`,
    );
    expect(source("usersPage")).toContain('sublabel: "In the last 13 months",');
  });

  it("names the two charts and the windows the active-users chart counts over", () => {
    const page: string = source("usersPage");

    expect(page).toContain('title="Active users"');
    expect(page).toContain('title="New and returning users"');
    expect(users).toContain(
      `**Active users** charts, for each day, the people who came that day, in the ${PRODUCT_ANALYTICS_WEEKLY_WINDOW_DAYS} days up to it and in the ${PRODUCT_ANALYTICS_MONTHLY_WINDOW_DAYS} days up to it, and **New and returning users** splits each day's people in two.`,
    );
  });

  it("says the first three tiles compare with the period before, as only they do", () => {
    const tilesSource: string = between(
      source("usersPage"),
      "return [",
      "];\n}",
    );
    const tiles: Array<string> = tilesSource.split("\n    {\n").slice(1);
    const comparing: Array<string> = tiles
      .filter((tile: string): boolean => {
        return tile.includes("sublabel: change(");
      })
      .map((tile: string): string => {
        return allMatches(tile, TITLE)[0] as string;
      });

    expect(comparing).toEqual(["Active users", "New users", "Returning users"]);
    expect(users).toContain(
      "The first three also say how they changed on the period before the range.",
    );
  });

  it("names People, its filter, and a person's Watch link and kept history", () => {
    const people: string = source("peopleCard");
    const person: string = source("personPage");

    // Its title is a constant: the card draws it with a search and without.
    expect(people).toContain(
      'const PEOPLE_CARD_TITLE: string = translationKey("People");',
    );
    expect(people).toContain("title={PEOPLE_CARD_TITLE}");
    expect(source("format")).toContain(
      '[ProductAnalyticsPeopleFilter.Anonymous]:\n    translationKey("Anonymous visitors"),',
    );
    expect(source("format")).toContain(
      '[ProductAnalyticsPeopleFilter.All]: translationKey("Everyone"),',
    );
    expect(person).toContain('{translator.translateText("Watch")}');
    expect(person).toContain(
      '{translator.translateText("Recording no longer kept")}',
    );
    expect(person).toContain(
      'description="Every session of theirs the last 13 months hold, newest first."',
    );
    expect(lineStartingWith(users, "**People**")).toBe(
      "**People** lists everyone the tiles count, one row per person, most recently seen first, and its filter shows one tile's people, the anonymous visitors, or everyone. Open a person for their first and last visit and every session of theirs from the last 13 months, with **Watch** on each one whose recording is still kept.",
    );
  });
});

describe("Product Analytics: the Sessions page", () => {
  const sessions: string = section("## Sessions");

  it("lists the page's tiles, in the order it draws them", () => {
    const tilesSource: string = between(
      source("sessionsPage"),
      "return [",
      "];\n}",
    );
    const tiles: Array<string> = allMatches(tilesSource, TITLE);
    const named: string = lineStartingWith(sessions, "**Sessions** counts");

    expect(tiles).toHaveLength(6);
    expect(named).toContain(
      `the sessions that started in the range: ${listedWith(
        tiles.map((tile: string): string => {
          return `**${tile}**`;
        }),
        "and",
      )}.`,
    );
  });

  it("names the three cards under the tiles as the page titles them", () => {
    const page: string = source("sessionsPage");
    const cards: Array<string> = sessions
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- **");
      })
      .map((line: string): string => {
        return allMatches(line, BOLD)[0] as string;
      });

    expect(cards).toEqual([
      "Sessions by device",
      "Session length",
      "Breakdown",
    ]);

    for (const card of cards) {
      expect(page).toContain(`title="${card}"`);
    }
  });

  it("counts a mobile session as a tablet's from the shorter side the tables use", () => {
    expect(PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE).toBe(600);
    expect(sessions).toContain(
      `A mobile app's session on a screen whose shorter side is ${PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE} points or more counts as a tablet's.`,
    );
  });

  it("sorts finished sessions into the length buckets, from the first to the open last one", () => {
    const first: ProductAnalyticsSessionLengthBucket =
      PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS[0] as ProductAnalyticsSessionLengthBucket;
    const last: ProductAnalyticsSessionLengthBucket =
      PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS[
        PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.length - 1
      ] as ProductAnalyticsSessionLengthBucket;

    expect(first).toEqual(
      expect.objectContaining({ fromMs: 0, toMs: 10 * 1000 }),
    );
    expect(last).toEqual(
      expect.objectContaining({ fromMs: 30 * 60 * 1000, toMs: null }),
    );
    expect(sessions).toContain(
      "from under 10 seconds to over 30 minutes. A session that is still recording has no length yet.",
    );
  });

  it("ranks the breakdown by the dimensions the server reads, as the picker names them", () => {
    const labels: string = between(
      source("format"),
      "export const PRODUCT_ANALYTICS_DIMENSION_LABELS",
      "};",
    );
    const named: Array<string> = PRODUCT_ANALYTICS_DIMENSIONS.map(
      (dimension: ProductAnalyticsDimension): string => {
        const key: string = Object.keys(ProductAnalyticsDimension).find(
          (name: string): boolean => {
            return (
              (ProductAnalyticsDimension as Record<string, string>)[name] ===
              dimension
            );
          },
        ) as string;
        const match: RegExpMatchArray | null = labels.match(
          new RegExp(
            `\\[ProductAnalyticsDimension\\.${key}\\]:\\s*translationKey\\("([^"]+)"\\)`,
          ),
        );

        expect({ dimension, labelled: Boolean(match) }).toEqual({
          dimension,
          labelled: true,
        });

        return ((match as RegExpMatchArray)[1] as string).toLowerCase();
      },
    );

    expect(sessions).toContain(
      `**Breakdown** ranks users and sessions by ${listedWith(named, "or")}, most users first.`,
    );
  });
});

describe("Product Analytics: privacy, retention and who can see it", () => {
  const privacy: string = section("## Privacy and retention");
  const who: string = section("## Who can see it");

  it("keeps a month's numbers until the first day of the 13th month after it, apart from the recordings' retention", () => {
    expect(PRODUCT_ANALYTICS_RETENTION_MONTHS).toBe(13);
    expect(DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS).toBe(7);
    expect(privacy).toContain(
      `- **${PRODUCT_ANALYTICS_RETENTION_MONTHS} months.** A month's numbers are removed on the first day of the ${PRODUCT_ANALYTICS_RETENTION_MONTHS}th month after it, so the last ${PRODUCT_ANALYTICS_RETENTION_MONTHS - 1} full months are always there, whatever the recordings' own retention (${DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS} days by default).`,
    );
    expect(englishPage()).toContain(
      `it keeps its numbers for ${PRODUCT_ANALYTICS_RETENTION_MONTHS} months`,
    );
  });

  it("names a nameless row as the Dashboard does", () => {
    const format: string = source("format");

    expect(format).toContain(
      'export const SIGNED_IN_USER: string = translationKey("Signed-in user");',
    );
    expect(format).toContain(
      'export const ANONYMOUS_VISITOR: string = translationKey("Anonymous visitor");',
    );
    expect(privacy).toContain(
      "otherwise it reads **Signed-in user** or **Anonymous visitor** and the start of the id.",
    );
  });

  it("reads under the session list's permissions, and names under the identity ones", () => {
    const api: string = source("telemetryApi");
    const list: string = between(
      api,
      "const SESSION_REPLAY_LIST_PERMISSIONS: Array<Permission> = [",
      "];",
    );
    const identity: string = between(
      api,
      "const SESSION_REPLAY_IDENTITY_PERMISSIONS: Array<Permission> = [",
      "];",
    );
    const titles: Map<string, string> = new Map<string, string>(
      Array.from(source("permissions").matchAll(PERMISSION_TITLE)).map(
        (match: RegExpMatchArray): [string, string] => {
          return [match[1] as string, match[2] as string];
        },
      ),
    );

    for (const route of ["summary", "trend", "breakdown", "people", "person"]) {
      expect(api).toContain(
        `router.post(\n  "/telemetry/rum/product-analytics/${route}",\n  ...requireSessionReplayListAccess,`,
      );
    }

    expect(list).toContain("Permission.ReadRumSessionReplay,");
    expect(list).toContain("Permission.ReadRumSessionReplayPayload,");
    expect(identity).toContain("Permission.ReadRumSessionReplayPayload,");
    expect(identity).not.toContain("Permission.ReadRumSessionReplay,");

    expect(who).toContain(
      `\`ReadRumSessionReplay\` (_${titles.get("ReadRumSessionReplay")}_) or \`ReadRumSessionReplayPayload\` (_${titles.get("ReadRumSessionReplayPayload")}_), which project owners and admins hold.`,
    );
    expect(who).toContain(
      "(/docs/telemetry/session-replay#who-can-watch-a-recording)",
    );
  });
});
