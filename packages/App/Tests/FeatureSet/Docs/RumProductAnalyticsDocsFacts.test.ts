/*
 * Issue #6444: what the Product Analytics page (rum/product-analytics) says
 * about an application's Users and Sessions pages, and (part two) about the
 * events and metrics a page sends and the Events, Funnels and User Retention
 * pages that read them, held to the code that sends, draws and counts them. RumDocsTranslations holds every translation to the
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
import {
  PRODUCT_ANALYTICS_DERIVED_METRICS,
  PRODUCT_ANALYTICS_DEVICE_TYPE_ATTRIBUTE,
  PRODUCT_ANALYTICS_EVENT_NAME_ATTRIBUTE,
  PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
  PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS,
  PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH,
  PRODUCT_ANALYTICS_MAX_ITEMS_PER_PROJECT_PER_MINUTE,
  PRODUCT_ANALYTICS_MAX_METRIC_NAME_LENGTH,
  PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
  PRODUCT_ANALYTICS_PROPERTY_LIMITS,
  PRODUCT_ANALYTICS_RESERVED_METRIC_PREFIX,
  PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS,
  ProductAnalyticsDerivedMetric,
  isProductAnalyticsMetricName,
  normalizeProductAnalyticsUserPropertyKeys,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import {
  PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS,
  PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS,
  PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS,
  PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS,
  PRODUCT_ANALYTICS_RETENTION_MAX_COHORTS,
  ProductAnalyticsRetentionPeriod,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import { PRODUCT_ANALYTICS_SOURCE_PERSON_KEY_SQL } from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import { PRODUCT_ANALYTICS_EVENT_TTL } from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
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
  // Part two: the events and metrics a page sends, and the pages that read them.
  eventsPage: `${DASHBOARD}/Pages/Rum/View/ProductAnalyticsEvents.tsx`,
  funnelsPage: `${DASHBOARD}/Pages/Rum/View/ProductAnalyticsFunnels.tsx`,
  retentionPage: `${DASHBOARD}/Pages/Rum/View/ProductAnalyticsRetention.tsx`,
  eventsFormat: `${DASHBOARD}/Components/ProductAnalytics/ProductAnalyticsEventsFormat.ts`,
  eventsGate: `${DASHBOARD}/Components/ProductAnalytics/ProductAnalyticsEventsGate.tsx`,
  segmentBar: `${DASHBOARD}/Components/ProductAnalytics/ProductAnalyticsSegmentBar.tsx`,
  switchCopy: `${DASHBOARD}/Components/ProductAnalytics/ProductAnalyticsEventsSwitchCopy.ts`,
  recorderIndex: "packages/App/FeatureSet/BrowserRecorder/src/Index.ts",
  rumApplication: "packages/Common/Models/DatabaseModels/RumApplication.ts",
  rumApplicationService:
    "packages/Common/Server/Services/RumApplicationService.ts",
  billing: "packages/Common/Server/Services/TelemetryUsageBillingService.ts",
  eventReads:
    "packages/Common/Server/Utils/RumProductAnalytics/RumProductAnalyticsEventReadService.ts",
  mobileRecorder: "packages/App/FeatureSet/MobileRecorder/src",
};

// A bold span: **Active users**.
const BOLD: RegExp = /\*\*([^*]+)\*\*/g;
// A tile's or a column's title in a page's source: title: "Active users",
const TITLE: RegExp = /title: "([^"]+)"/g;
// A Permission.ts entry: the enum member, then its title.
const PERMISSION_TITLE: RegExp =
  /permission: Permission\.(\w+),\s*title: "([^"]+)"/g;
// A label a source looks up in the Dashboard locale: translationKey("By day").
const TRANSLATION_KEY: RegExp = /translationKey\("([^"]+)"\)/g;
// A TypeScript source file.
const SOURCE_FILE: RegExp = /\.tsx?$/;

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

  it("names the side menu section and its pages as SideMenu.tsx draws them", () => {
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

  it("counts the sessions Session Replay records on Users and Sessions, as both pages say", () => {
    for (const page of ["usersPage", "sessionsPage"]) {
      expect(source(page)).toContain(
        "counted from the sessions Session Replay records.",
      );
    }

    expect(counted).toContain(
      "**Users** and **Sessions** count the sessions Session Replay records",
    );
    expect(counted).toContain(
      "**Events**, **Funnels** and **User Retention** count people the same way, from the events the recorder sends from every session, recorded or not",
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

    expect(people).toContain('translationKey("People")');
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

describe("Product Analytics: the events and metrics a page sends", () => {
  const send: string = section("## Send events and metrics");
  const calls: Array<Array<string>> = (
    tables(send).find((table: Array<Array<string>>): boolean => {
      return table[0]?.[0] === "Call";
    }) || []
  ).slice(1);

  it("names the switch and its page as the Dashboard titles them, on for a new application only", () => {
    const column: string = between(
      source("rumApplication"),
      'title: "Enable Product Analytics Events",',
      "public isProductAnalyticsEnabled",
    );

    expect(source("switchCopy")).toContain(
      'switchTitle: translationKey("Send product analytics events"),',
    );
    expect(source("sideMenu")).toContain('title: "Analytics Settings",');
    // Every application that exists keeps it off; one created now starts with it on.
    expect(column).toContain("defaultValue: false,");
    expect(source("rumApplicationService")).toContain(
      "if (data.isProductAnalyticsEnabled === undefined) {\n      data.isProductAnalyticsEnabled = true;\n    }",
    );
    expect(send).toContain(
      "Events are sent while **Send product analytics events** is on, on the application's **Analytics Settings** page. It starts on for a new application, and off for an application created before it existed, so turn it on there.",
    );
  });

  it("says the React Native recorder sends no events, for as long as it sends none", () => {
    const directory: string = path.join(
      REPO_DIR,
      SOURCES["mobileRecorder"] as string,
    );
    const sending: Array<string> = fs
      .readdirSync(directory)
      .filter((file: string): boolean => {
        return (
          SOURCE_FILE.test(file) &&
          fs
            .readFileSync(path.join(directory, file), "utf8")
            .includes("/session-replay/v1/events")
        );
      });

    expect(sending).toEqual([]);
    expect(send).toContain("the React Native recorder sends none yet.");
  });

  it("shows the two calls the Events page shows while it has none", () => {
    const fence: string = (
      scanMarkdown(send).fences.find((candidate: { lang: string }): boolean => {
        return candidate.lang === "js";
      }) as { code: string }
    ).code.trim();

    expect(fence.split("\n")).toHaveLength(2);
    expect(source("eventsGate")).toContain(
      `{\`${fence.split("\n").join("\\n")}\`}`,
    );
  });

  it("gives track() and metric() the caps the recorder and the server both apply", () => {
    expect(PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH).toBe(64);
    expect(PRODUCT_ANALYTICS_PROPERTY_LIMITS).toEqual({
      maxKeys: 20,
      maxKeyLength: 40,
      maxValueLength: 200,
    });
    expect(PRODUCT_ANALYTICS_MAX_METRIC_NAME_LENGTH).toBe(100);
    expect(PRODUCT_ANALYTICS_RESERVED_METRIC_PREFIX).toBe("oneuptime.");

    // The name rule the row states, case by case.
    expect(isProductAnalyticsMetricName("cart.value")).toBe(true);
    expect(isProductAnalyticsMetricName("checkout/step-2_total")).toBe(true);
    expect(isProductAnalyticsMetricName("a".repeat(100))).toBe(true);
    expect(isProductAnalyticsMetricName("a".repeat(101))).toBe(false);
    expect(isProductAnalyticsMetricName("2fa.sent")).toBe(false);
    expect(isProductAnalyticsMetricName("cart value")).toBe(false);
    expect(isProductAnalyticsMetricName("oneuptime.cart")).toBe(false);
    expect(isProductAnalyticsMetricName("OneUptime.cart")).toBe(false);

    expect(
      calls.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      "`track(name, properties?)`",
      "`metric(name, value, attributes?)`",
    ]);
    expect(calls[0]?.[1]).toContain(
      `\`name\` ≤ ${PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH} chars; ≤ ${PRODUCT_ANALYTICS_PROPERTY_LIMITS.maxKeys} properties of string, number or boolean values, key ≤ ${PRODUCT_ANALYTICS_PROPERTY_LIMITS.maxKeyLength} chars, value ≤ ${PRODUCT_ANALYTICS_PROPERTY_LIMITS.maxValueLength} chars.`,
    );
    expect(calls[1]?.[1]).toContain(
      `\`name\` ≤ ${PRODUCT_ANALYTICS_MAX_METRIC_NAME_LENGTH} chars of letters, digits, \`_\`, \`.\`, \`-\` and \`/\`, starting with a letter and not with \`${PRODUCT_ANALYTICS_RESERVED_METRIC_PREFIX}\`; \`value\` a finite number;`,
    );
  });

  it("names the queue entries the recorder applies", () => {
    const index: string = source("recorderIndex");

    expect(index).toContain('command === "track" && typeof first === "string"');
    expect(index).toContain(
      'command === "metric" && typeof first === "string"',
    );
    expect(send).toContain(
      'as `["track", name, properties]` and `["metric", name, value, attributes]`',
    );
  });

  it("states how the recorder batches and holds events, and the project's allowance, as the constants say", () => {
    expect(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS).toBe(5 * 1000);
    expect(PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS).toBe(3 * 24 * 60 * 60 * 1000);
    expect(PRODUCT_ANALYTICS_MAX_ITEMS_PER_PROJECT_PER_MINUTE).toBe(60000);
    expect(PRODUCT_ANALYTICS_MAX_PENDING_EVENTS).toBe(500);
    expect(send).toContain("every 5 seconds and when the tab is hidden");
    expect(send).toContain("more than 3 days after it happened is dropped");
    expect(send).toContain(
      "a project may send 60,000 events and metric points a minute, all its applications together",
    );
    expect(send).toContain(
      "events wait for `grantConsent()`, at most 500 of them, and `revokeConsent()` drops them.",
    );
  });

  it("keeps only the trait keys listed, at most as many as identify() takes", () => {
    const keys: Array<string> = Array.from(
      { length: 30 },
      (_value: unknown, index: number): string => {
        return `trait${index}`;
      },
    );

    expect(PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS.maxKeys).toBe(20);
    expect(normalizeProductAnalyticsUserPropertyKeys(keys)).toHaveLength(20);
    expect(source("switchCopy")).toContain(
      'propertiesCardTitle: translationKey("User Properties for Analytics"),',
    );
    expect(section("### User properties")).toContain(
      'list `identify()` trait keys under **User Properties for Analytics** on **Analytics Settings**, such as `["plan", "role"]`, at most 20, matched as written.',
    );
  });
});

describe("Product Analytics: the Events page", () => {
  const events: string = section("## Events");

  it("names the page's cards, chart and tiles as it titles them", () => {
    const page: string = source("eventsPage");
    const tiles: Array<string> = allMatches(
      between(
        page,
        "export function buildProductAnalyticsEventTiles(",
        "\n}\n",
      ),
      TITLE,
    );

    expect(page).toContain('title="Events"');
    expect(page).toContain('title="All events"');
    expect(page).toContain('title="Events and users"');
    expect(tiles).toEqual(["Events", "Users", "Sessions"]);
    expect(events).toContain(
      "- The tiles count the event's **Events**, with how many each person did on average, its **Users** and its **Sessions**.",
    );
    expect(events).toContain(
      "- **Events and users** charts each day's count of the event, and of the people who did it that day.",
    );
    expect(source("eventsFormat")).toContain(
      'export const SESSION_STARTED: string = translationKey("Session started");',
    );
    expect(events).toContain(
      "The picker also lists **Session started** and each page viewed, and **All events**, below,",
    );
  });

  it("opens on your app's most frequent event, else the most viewed page", () => {
    const pick: string = between(
      source("eventsFormat"),
      "export function pickDefaultProductAnalyticsEvent(",
      "\n}\n",
    );

    expect(pick).toContain(
      "ProductAnalyticsEventKind.Custom,\n    ProductAnalyticsEventKind.Page,",
    );
    expect(events).toContain(
      "your app's most frequent event until you pick another, or the most viewed page while it sends none.",
    );
  });

  it("breaks an event down by the fields the picker names, in its order", () => {
    const fields: Array<string> = allMatches(
      between(
        source("eventsFormat"),
        "export const PRODUCT_ANALYTICS_EVENT_FIELD_LABELS",
        "};",
      ),
      TRANSLATION_KEY,
    ).map((label: string): string => {
      return label.toLowerCase();
    });

    expect(fields).toHaveLength(8);
    expect(events).toContain(
      `**Breakdown** ranks the event by ${listedWith(fields, "or")}, with each value's events, users and share.`,
    );
  });

  it("holds a segment to the filters the server takes, all of them matched exactly", () => {
    expect(PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS).toBe(5);
    expect(source("segmentBar")).toContain('title="Add filter"');
    expect(source("segmentBar")).toContain(
      '{translator.translateText("Segment")}',
    );
    expect(events).toContain(
      `**Segment** narrows the page to the events whose fields hold the values you choose: **Add filter**, then a field and a value, matched exactly. A segment holds at most ${PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS} filters, and an event must match them all.`,
    );
  });
});

describe("Product Analytics: the Funnels and User Retention pages", () => {
  const funnels: string = section("## Funnels");
  const retention: string = section("## User Retention");

  it("takes 2 to 6 steps, and the windows the server allows as the picker names them", () => {
    const windows: Array<string> = allMatches(
      between(
        source("eventsFormat"),
        "export const PRODUCT_ANALYTICS_FUNNEL_WINDOW_LABELS",
        "};",
      ),
      TRANSLATION_KEY,
    );

    expect(windows).toHaveLength(PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS.length);
    expect(funnels).toContain(
      `**Funnels** follows people through ${PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS} to ${PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS} steps in order`,
    );
    expect(funnels).toContain(
      `all within the time you pick from their first step: ${listedWith(
        windows.map((label: string): string => {
          return `**${label}**`;
        }),
        "or",
      )}.`,
    );
    expect(source("funnelsPage")).toContain('title="Add step"');
    expect(source("funnelsPage")).toContain(
      '{translator.translateText("Conversion")}',
    );
  });

  it("counts a person once, by the try that got furthest", () => {
    expect(source("eventReads")).toContain(
      "arrayMax(paLevels) AS paLevel, indexOf(paLevels, paLevel) AS paBest",
    );
    expect(funnels).toContain(
      "Someone who tried more than once counts once, by the try that got furthest.",
    );
  });

  it("segments a funnel and a retention table by what every event carries and user properties", () => {
    const people: string = between(
      source("funnelsPage"),
      "export function toProductAnalyticsPersonProperties(",
      "\n}\n",
    );

    expect(people).toContain(
      "{ propertyKeys: [], userPropertyKeys: properties.userPropertyKeys }",
    );
    expect(source("retentionPage")).toContain(
      'import { toProductAnalyticsPersonProperties } from "./ProductAnalyticsFunnels";',
    );
    expect(funnels).toContain(
      "The segment of a funnel, and of a retention table, takes the fields every event carries and user properties, not an event's own properties",
    );
  });

  it("names the retention picks and periods as the page draws them, and the cohorts one table holds", () => {
    const page: string = source("retentionPage");
    const periods: Array<string> = allMatches(
      between(
        source("eventsFormat"),
        "export const PRODUCT_ANALYTICS_RETENTION_PERIOD_LABELS",
        "};",
      ),
      TRANSLATION_KEY,
    );

    for (const label of ["People who did", "And came back to do", "Cohorts"]) {
      expect(page).toContain(`{translator.translateText("${label}")}`);
    }

    expect(periods).toEqual(["By day", "By week", "By month"]);
    expect(PRODUCT_ANALYTICS_RETENTION_MAX_COHORTS).toEqual({
      [ProductAnalyticsRetentionPeriod.Day]: 32,
      [ProductAnalyticsRetentionPeriod.Week]: 26,
      [ProductAnalyticsRetentionPeriod.Month]: 13,
    });
    expect(retention).toContain(
      "first did one event, **People who did**, and shows what share of each group did another, **And came back to do**, in that period and each one after it.",
    );
    expect(retention).toContain(
      "**Cohorts** sets the period: **By day**, **By week** or **By month**. When the range holds more periods than one table shows, 32 days, 26 weeks or 13 months, the page makes the cohorts longer and says so.",
    );
  });

  it("starts both retention events at a session's start", () => {
    const format: string = source("eventsFormat");

    expect(format).toContain(
      "startEvent:\n      decodeProductAnalyticsEvent(params.get(keys.start)) ||\n      SESSION_START_EVENT,",
    );
    expect(format).toContain(
      "returnEvent:\n      decodeProductAnalyticsEvent(params.get(keys.return)) ||\n      SESSION_START_EVENT,",
    );
    expect(retention).toContain(
      "Both are **Session started** until you pick others.",
    );
  });
});

describe("Product Analytics: dashboards, alerts, retention and access for events", () => {
  const dashboards: string = section("## Dashboards and alerts");
  const metrics: Array<Array<string>> = (
    tables(dashboards).find((table: Array<Array<string>>): boolean => {
      return table[0]?.[0] === "Metric";
    }) || []
  ).slice(1);

  it("lists the three counts the event pipeline writes, and the attribute each is split by", () => {
    expect(PRODUCT_ANALYTICS_DERIVED_METRICS).toEqual([
      ProductAnalyticsDerivedMetric.Events,
      ProductAnalyticsDerivedMetric.Sessions,
      ProductAnalyticsDerivedMetric.PageViews,
    ]);
    expect(
      metrics.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      PRODUCT_ANALYTICS_DERIVED_METRICS.map((name: string): string => {
        return `\`${name}\``;
      }),
    );
    expect(
      metrics.map((row: Array<string>): string => {
        return row[2] as string;
      }),
    ).toEqual([
      `\`${PRODUCT_ANALYTICS_EVENT_NAME_ATTRIBUTE}\``,
      `\`${PRODUCT_ANALYTICS_DEVICE_TYPE_ATTRIBUTE}\``,
      `\`${PRODUCT_ANALYTICS_DEVICE_TYPE_ATTRIBUTE}\``,
    ]);
  });

  it("leaves the counts out of billing, and bills a page's own metric() points", () => {
    expect(
      between(
        source("billing"),
        "export const TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES",
        "];",
      ),
    ).toContain("...PRODUCT_ANALYTICS_DERIVED_METRICS,");
    expect(dashboards).toContain(
      "These three are not billed, and `metric()` refuses a name that starts with `oneuptime.`",
    );
    expect(dashboards).toContain(
      "Your `metric()` points are kept and billed as the application's other metrics are.",
    );
  });

  it("points at the application's Metrics page, as All events does", () => {
    const gate: string = source("eventsGate");

    expect(gate).toContain('{translator.translateText("Open Metrics")}');
    expect(gate).toContain("RouteMap[PageMap.RUM_APPLICATION_VIEW_METRICS]");
    expect(dashboards).toContain(
      "**Open Metrics**, under **All events**, opens the page.",
    );
  });

  it("keeps events as long as the numbers, and keeps only the listed traits", () => {
    const privacy: string = section("## Privacy and retention");

    expect(PRODUCT_ANALYTICS_EVENT_TTL).toBe(
      `toStartOfMonth(time) + INTERVAL ${PRODUCT_ANALYTICS_RETENTION_MONTHS} MONTH DELETE`,
    );
    expect(privacy).toContain("Events are kept the same way.");
    expect(privacy).toContain(
      "never the reference or an IP address, and of the traits only the user properties you list.",
    );
    expect(privacy).toContain(
      "An erasure request removes the matching numbers and events here too",
    );
  });

  it("reads events under the session list's permissions, and turns them on under the application's", () => {
    const who: string = section("## Who can see it");
    const api: string = source("telemetryApi");
    const model: string = source("rumApplication");
    const updateOf: (block: string) => string = (block: string): string => {
      return between(block, "update: [", "]");
    };
    const events: string = updateOf(
      between(
        model,
        "Product analytics events (issue #6444, part two).",
        "public isProductAnalyticsEnabled",
      ),
    );
    const traits: string = updateOf(
      between(
        model,
        "The identify() traits product analytics keeps on each event",
        "public productAnalyticsUserPropertyKeys",
      ),
    );
    const titles: Map<string, string> = new Map<string, string>(
      Array.from(source("permissions").matchAll(PERMISSION_TITLE)).map(
        (match: RegExpMatchArray): [string, string] => {
          return [match[1] as string, match[2] as string];
        },
      ),
    );

    for (const route of [
      "event-names",
      "event-trend",
      "event-breakdown",
      "event-properties",
      "funnel",
      "retention",
    ]) {
      expect(api).toContain(
        `router.post(\n  "/telemetry/rum/product-analytics/${route}",\n  ...requireSessionReplayListAccess,`,
      );
    }

    for (const permission of [
      "ProjectOwner",
      "ProjectAdmin",
      "ProjectMember",
      "EditRumApplication",
    ]) {
      expect(events).toContain(`Permission.${permission},`);
    }

    for (const permission of [
      "ProjectOwner",
      "ProjectAdmin",
      "EditRumApplication",
    ]) {
      expect(traits).toContain(`Permission.${permission},`);
    }

    expect(traits).not.toContain("Permission.ProjectMember,");
    expect(who).toContain(
      "Reading these pages takes what reading the session list takes",
    );
    expect(who).toContain(
      `Turning the events on or off takes \`EditRumApplication\` (_${titles.get("EditRumApplication")}_) or a project owner's, admin's or member's role. Listing user properties takes \`EditRumApplication\` or an owner's or admin's role`,
    );
  });
});
