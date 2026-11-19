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
import {
  DOCS_LANGUAGES,
  listPages,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
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
import RumProductAnalyticsSavedView from "Common/Models/DatabaseModels/RumProductAnalyticsSavedView";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX } from "Common/Types/Rum/ProductAnalyticsSavedViews";
import {
  WIDGET_CATALOG,
  WidgetCatalogCategory,
  WidgetCatalogItem,
} from "../../../FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import { isPublicDashboardUndrawnWidgetType } from "Common/Types/Dashboard/PublicDashboardServedSettings";
import { PRODUCT_ANALYTICS_EVENTS_PATH } from "Common/Types/Rum/ProductAnalyticsEvents";
import { drawnActionLabel } from "./DocsDashboardLabels";
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
  retentionTable: `${DASHBOARD}/Components/ProductAnalytics/ProductAnalyticsRetentionTable.tsx`,
  savedViews: `${DASHBOARD}/Components/ProductAnalytics/ProductAnalyticsSavedViews.ts`,
  savedViewsDropdown:
    "packages/Common/UI/Components/TelemetryViewer/components/SavedViewsDropdown.tsx",
  widgetFrame: `${DASHBOARD}/Components/Dashboard/Components/DashboardProductAnalyticsWidget.tsx`,
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

/*
 * Issue #7319: names the docs gave a permission that no roles screen lists,
 * "the identity permission" in each language's words, and the Dashboard's
 * own retired names for it (SessionReplayPermissionNames). The grant is
 * Watch Session Replays.
 */
const MADE_UP_PERMISSION_NAMES: Record<string, ReadonlyArray<string>> = {
  en: ["identity permission"],
  da: ["identitetstilladelse", "tilladelsen til slutbrugeridentitet"],
  de: ["Identitätsberechtigung", "Berechtigung für Endbenutzeridentitäten"],
  es: ["permiso de identidad"],
  fa: ["مجوز هویتی", "دسترسی هویت"],
  fr: ["permission d'identité", "autorisation d'identité"],
  hi: ["पहचान की अनुमति", "पहचान अनुमति"],
  it: [
    "permesso di identità",
    "autorizzazione per l'identità",
    "autorizzazione all'identità",
  ],
  ja: ["身元の権限", "身元に関する権限"],
  ko: ["신원 권한"],
  nl: [
    "identiteitsrechten",
    "machtiging voor identiteit",
    "machtiging voor eindgebruikersidentiteit",
  ],
  no: ["identitetstillatelse", "tillatelsen for sluttbrukeridentitet"],
  pt: ["permissão de identidade"],
  ru: ["разрешение на идентичность", "право на просмотр личности"],
  sv: ["identitetsbehörighet", "behörigheten för slutanvändaridentitet"],
  "zh-CN": ["身份权限"],
  "zh-TW": ["身分權限"],
};

// Each made-up name a page's text gives, in its language.
function madeUpPermissionNamesIn(
  language: string,
  text: string,
): Array<string> {
  const lower: string = text.toLowerCase();

  return (MADE_UP_PERMISSION_NAMES[language] || []).filter(
    (name: string): boolean => {
      return lower.includes(name.toLowerCase());
    },
  );
}

// The clause of the sentence each language's page held before #7319.
const RETIRED_SENTENCES: Record<string, string> = {
  en: "takes the identity permission described in [Who can watch a recording]",
  da: "kræver den identitetstilladelse, som [Hvem kan se en optagelse] beskriver.",
  de: "erfordert die Identitätsberechtigung, die [Wer eine Aufzeichnung ansehen kann] beschreibt.",
  es: "requiere el permiso de identidad que se describe en [Quién puede ver una grabación]",
  fa: "به مجوز هویتی نیاز دارد که در [چه کسی می‌تواند ضبطی را تماشا کند] توضیح داده شده است.",
  fr: "demande la permission d'identité décrite dans [Qui peut regarder un enregistrement]",
  hi: "[रिकॉर्डिंग कौन देख सकता है] में बताई गई पहचान की अनुमति चाहिए।",
  it: "richiede il permesso di identità descritto in [Chi può guardare una registrazione]",
  ja: "[録画を視聴できるユーザー] で説明している身元の権限が必要です。",
  ko: "[녹화를 시청할 수 있는 사람]에 설명된 신원 권한이 필요합니다.",
  nl: "vraagt de identiteitsrechten die [Wie een opname kan bekijken] beschrijft.",
  no: "krever identitetstillatelsen som [Hvem kan se et opptak] beskriver.",
  pt: "exige a permissão de identidade descrita em [Quem pode assistir a uma gravação]",
  ru: "нужно разрешение на идентичность, описанное в разделе [Кто может смотреть запись]",
  sv: "kräver den identitetsbehörighet som [Vem kan titta på en inspelning] beskriver.",
  "zh-CN": "需要 [谁可以观看录制] 中所述的身份权限。",
  "zh-TW": "需要 [誰可以觀看錄製] 中所述的身分權限。",
};

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
  it("is the RUM group's sixth link, after Core Web Vitals and before Managing Applications", () => {
    const links: Array<NavLink> = rumGroup().links;
    const urls: Array<string> = links.map((link: NavLink): string => {
      return link.url;
    });
    const at: number = urls.indexOf(`/docs/${PRODUCT_ANALYTICS}`);

    // Right after the five setup pages, Android Setup (#9533) among them.
    expect(at).toBe(5);
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
        "Saved funnels and retention tables",
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
      `Everyone the application has seen in the months it keeps its numbers, ${PRODUCT_ANALYTICS_RETENTION_MONTHS} by default.`,
    );
    // The tile says the application's own months (#6626), 13 by default.
    expect(source("usersPage")).toContain(
      'other: "In the last {{count}} months",',
    );
    expect(source("usersPage")).toContain(
      "const retentionMonths: number = readProductAnalyticsRetentionMonths(summary);",
    );
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
      '"Every session of theirs the last {{count}} months hold, newest first.",',
    );
    expect(lineStartingWith(users, "**People**")).toBe(
      "**People** lists everyone the tiles count, one row per person, most recently seen first, and its filter shows one tile's people, the anonymous visitors, or everyone. Open a person for their first and last visit and every session of theirs from the months the numbers are kept, with **Watch** on each one whose recording is still kept.",
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
      `\`ReadRumSessionReplay\` (_${titles.get("ReadRumSessionReplay")}_) or \`ReadRumSessionReplayPayload\` (_${titles.get("ReadRumSessionReplayPayload")}_), which Project Owners and Project Admins hold.`,
    );
    expect(who).toContain(
      "(/docs/telemetry/session-replay#who-can-watch-a-recording)",
    );
  });

  /*
   * Issue #7319: the page named "the identity permission", which no roles
   * screen lists. Seeing who a signed-in user is takes Watch Session
   * Replays (SESSION_REPLAY_IDENTITY_PERMISSIONS), which the sentence names
   * by its catalogue title, in English in every language, as the roles
   * screen and the Dashboard's Session Replay lines write it.
   */
  it("names the grant that shows who a signed-in user is by its catalogue title, in every language", () => {
    const watch: string = PermissionHelper.getTitle(
      Permission.ReadRumSessionReplayPayload,
    );
    const list: string = PermissionHelper.getTitle(
      Permission.ReadRumSessionReplay,
    );

    expect(watch).toBe("Watch Session Replays");
    expect(who).toContain(
      `Seeing who a signed-in user is, and searching people by name, takes \`ReadRumSessionReplayPayload\` (_${watch}_), as [Who can watch a recording](/docs/telemetry/session-replay#who-can-watch-a-recording) describes.`,
    );

    for (const language of DOCS_LANGUAGES) {
      const lines: Array<string> = sectionInLanguage(
        language,
        PRODUCT_ANALYTICS,
        "## Who can see it",
      )
        .split("\n")
        .filter((candidate: string): boolean => {
          return candidate.includes("`ReadRumSessionReplay`");
        });

      expect({ language, lines: lines.length }).toEqual({ language, lines: 1 });

      const line: string = lines[0] as string;

      // Read with either grant; who someone is, with Watch alone.
      expect({
        language,
        list: line.split(`\`ReadRumSessionReplay\` (_${list}_)`).length - 1,
        watch:
          line.split(`\`ReadRumSessionReplayPayload\` (_${watch}_)`).length - 1,
        link: line.includes("(/docs/telemetry/session-replay#"),
      }).toEqual({ language, list: 1, watch: 2, link: true });
    }
  });

  it("no docs page, in any language, names a permission no role lists", () => {
    expect(Object.keys(MADE_UP_PERMISSION_NAMES).sort()).toEqual(
      [...DOCS_LANGUAGES].sort(),
    );

    for (const language of DOCS_LANGUAGES) {
      const found: Array<string> = [];

      for (const page of listPages(language)) {
        found.push(
          ...madeUpPermissionNamesIn(language, readPage(language, page)).map(
            (name: string): string => {
              return `${page}: ${name}`;
            },
          ),
        );
      }

      expect({ language, found }).toEqual({ language, found: [] });
    }
  });

  it("the check finds the name the page used to give, in each language", () => {
    for (const [language, sentence] of Object.entries(RETIRED_SENTENCES)) {
      expect({
        language,
        found: madeUpPermissionNamesIn(language, sentence).length > 0,
      }).toEqual({ language, found: true });
    }
  });
});

/*
 * Issue #6632 and issue #6630: the All cohorts row over the retention
 * table, and the funnels and retention tables a team saves, opens again
 * and shows on a dashboard.
 */
describe("Product Analytics: All cohorts, and saved funnels and retention tables", () => {
  const retention: string = section("## User Retention");
  const saved: string = section("## Saved funnels and retention tables");
  const dashboards: string = section("## Dashboards and alerts");
  const who: string = section("## Who can see it");

  it("draws All cohorts above the cohorts once two hold anyone, as the table does", () => {
    const table: string = source("retentionTable");

    expect(table).toContain(
      'export const ALL_COHORTS: string = translationKey("All cohorts");',
    );
    expect(table).toContain(
      "export const RETENTION_AVERAGE_MIN_COHORTS: number = 2;",
    );
    expect(retention).toContain(
      "**All cohorts**, above them, counts the cohorts as one: in each period, the people who came back over the people of the cohorts that have reached it",
    );
    expect(retention).toContain("It shows once two cohorts hold anyone.");
  });

  it("names each kind's list and save button as the pages draw them, and the most an application keeps", () => {
    const words: string = source("savedViews");

    for (const word of [
      'list: translationKey("Saved funnels"),',
      'create: translationKey("+ Save funnel"),',
      'list: translationKey("Saved retention tables"),',
      'create: translationKey("+ Save retention table"),',
    ]) {
      expect(words).toContain(word);
    }

    expect(PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX).toBe(100);
    expect(saved).toContain(
      "**Saved funnels**, on the **Funnels** page, and **Saved retention tables**, on **User Retention**, list what your team saved for the application",
    );
    expect(saved).toContain(
      `- **+ Save funnel** or **+ Save retention table** saves what the page shows, under a name. An application keeps at most ${PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX} of each.`,
    );
  });

  it("keeps no time range, as the save dialog says", () => {
    // Both kinds' dialogs.
    expect(
      source("savedViews").split(
        "to open again here or show on a dashboard. The time range is not saved.",
      ),
    ).toHaveLength(3);
    expect(saved).toContain(
      "Neither keeps the time range: the page keeps its own, and a dashboard reads its own.",
    );
  });

  it("names the list's own actions as the saved views list draws them", () => {
    const dropdown: string = source("savedViewsDropdown");

    for (const action of ["Update", "Edit", "Delete", "Clear view"]) {
      expect(dropdown).toContain(`translator.translateText("${action}")`);
      expect(saved).toContain(`**${action}**`);
    }

    expect(source("savedViews")).toContain(
      'translationKey("{{name}} (changed)")',
    );
    expect(saved).toContain(
      "Once you change what it shows, its name says so, and **Update** saves the change.",
    );
  });

  it("puts one on a dashboard with the Product Analytics group's widgets, which open it on its page", () => {
    const group: WidgetCatalogCategory | undefined = WIDGET_CATALOG.find(
      (category: WidgetCatalogCategory): boolean => {
        return category.name === "Product Analytics";
      },
    );

    expect(
      group?.items.map((item: WidgetCatalogItem): string => {
        return item.label;
      }),
    ).toEqual(["Funnel", "User Retention"]);

    for (const open of ["Open in Funnels", "Open in User Retention"]) {
      expect(source("widgetFrame")).toContain(
        `open: translationKey("${open}"),`,
      );
    }

    expect(dashboards).toContain(
      "the **Funnel** and **User Retention** widgets, in the widget catalog's **Product Analytics** group, show one in the dashboard's time range, and **Open in Funnels** or **Open in User Retention** opens it on its page",
    );
    expect(dashboards).toContain(
      "(/docs/dashboards/widgets#product-analytics)",
    );
  });

  it("keeps them under the permissions these pages are read with", () => {
    const list: Array<string> = allMatches(
      between(
        source("telemetryApi"),
        "const SESSION_REPLAY_LIST_PERMISSIONS: Array<Permission> = [",
        "];",
      ),
      /Permission\.(\w+)/g,
    ).sort();
    const model: RumProductAnalyticsSavedView =
      new RumProductAnalyticsSavedView();

    for (const permissions of [
      model.readRecordPermissions,
      model.createRecordPermissions,
      model.updateRecordPermissions,
      model.deleteRecordPermissions,
    ]) {
      expect(
        permissions
          .map((permission: Permission): string => {
            return permission.toString();
          })
          .sort(),
      ).toEqual(list);
    }

    expect(who).toContain(
      "Saving, renaming and deleting saved funnels and retention tables takes the same permissions as reading these pages, and a dashboard widget shows one only to a reader who holds them.",
    );
  });

  /*
   * Issue #6717: a public dashboard never draws a saved funnel's or
   * retention table's numbers - they count an application's end users -
   * and the page says so where it puts them on a dashboard.
   */
  it("says a public dashboard shows only the widgets' titles, as it serves them", () => {
    for (const componentType of [
      DashboardComponentType.ProductAnalyticsFunnel,
      DashboardComponentType.ProductAnalyticsRetention,
    ]) {
      expect(isPublicDashboardUndrawnWidgetType(componentType)).toBe(true);
    }

    expect(dashboards).toContain(
      "A public dashboard shows only their titles, never their numbers: those count your application's end users.",
    );
  });
});

/*
 * Issue #6719: an erasure request removes a person's sessions, numbers and
 * events, but not what the team saved - a saved funnel's or retention
 * table's name and segment are the team's own writing - and the Privacy
 * section says so, in every language, beside the erasure it qualifies.
 */
describe("Product Analytics: what an erasure leaves of saved funnels and retention tables", () => {
  const ERASED: string = "- **Erased on request.**";
  const SENTENCE: string =
    "It does not change **Saved funnels** or **Saved retention tables**: their names and segments are your team's own writing, as a dashboard's title is, so do not save a segment that names a person.";

  function erasedLineIndex(): number {
    const lines: Array<string> = englishPage().split("\n");
    const indexes: Array<number> = lines
      .map((line: string, index: number): number => {
        return line.startsWith(ERASED) ? index : -1;
      })
      .filter((index: number): boolean => {
        return index >= 0;
      });

    expect(indexes).toHaveLength(1);

    return indexes[0] as number;
  }

  it("says it in the Privacy section's erasure bullet", () => {
    const privacy: string = section("## Privacy and retention");
    const bullet: string = lineStartingWith(privacy, ERASED);

    expect(bullet.endsWith(SENTENCE)).toBe(true);
    // The erasure itself still comes first.
    expect(bullet.indexOf("An erasure request removes")).toBeLessThan(
      bullet.indexOf(SENTENCE),
    );
  });

  it("the erasure job reads and edits no saved view: what the page says is what it does", () => {
    const job: string = fs.readFileSync(
      path.join(
        REPO_DIR,
        "packages/App/FeatureSet/Workers/Jobs/Rum/ProcessSessionErasureRequests.ts",
      ),
      "utf8",
    );
    const erasure: string = fs.readFileSync(
      path.join(
        REPO_DIR,
        "packages/Common/Server/Utils/RumProductAnalytics/RumProductAnalyticsErasure.ts",
      ),
      "utf8",
    );

    for (const source of [job, erasure]) {
      expect(source).not.toMatch(/SavedView/);
    }
  });

  it.each(DOCS_LANGUAGES)(
    "%s says it on the line the English says it, naming both lists as its Dashboard draws them",
    (language: string) => {
      const line: string =
        readPage(language, PRODUCT_ANALYTICS).split("\n")[erasedLineIndex()] ||
        "";

      expect({
        language,
        bullet: line.startsWith("- **"),
        erasureCount: line.includes("`productAnalyticsRowsDeleted`"),
        funnels: line.includes(
          `**${drawnActionLabel(language, "Saved funnels")}**`,
        ),
        tables: line.includes(
          `**${drawnActionLabel(language, "Saved retention tables")}**`,
        ),
      }).toEqual({
        language,
        bullet: true,
        erasureCount: true,
        funnels: true,
        tables: true,
      });
    },
  );
});

/*
 * Issue #6629: the React Native recorder sends product analytics events and
 * metric() points, as the browser recorder does, so the page no longer says
 * it sends none - and what it says it sends, the recorder's source does.
 */
describe("Product Analytics: events from a React Native app", () => {
  const MOBILE: string = "packages/App/FeatureSet/MobileRecorder/src";
  const send: string = section("## Send events and metrics");

  function mobileSource(file: string): string {
    return fs.readFileSync(path.join(REPO_DIR, MOBILE, file), "utf8");
  }

  it("posts to the events route the browser recorder posts to", () => {
    expect(mobileSource("ProductAnalyticsContract.ts")).toContain(
      `export const PRODUCT_ANALYTICS_EVENTS_PATH: string =\n  "${PRODUCT_ANALYTICS_EVENTS_PATH}";`,
    );
    expect(mobileSource("MobileReplayRecorder.ts")).toContain(
      "url: `${options.host}${PRODUCT_ANALYTICS_EVENTS_PATH}`,",
    );
  });

  it("says the React Native recorder sends them, and no longer that it sends none", () => {
    expect(englishPage()).not.toContain("sends none yet");
    expect(send).toContain(
      "Session Replay must be on for the application too, as its recorder sends the events, from a web page and from a React Native app alike.",
    );

    /*
     * Every translation says what a React Native app sends on the line the
     * English says it, with the call it names.
     */
    const lines: Array<string> = englishPage().split("\n");
    const sends: number = lines.findIndex((line: string): boolean => {
      return line.startsWith("Each session the browser recorder runs in");
    });

    expect(lines[sends]).toContain("`setRoute()`");

    for (const language of DOCS_LANGUAGES) {
      const line: string =
        readPage(language, PRODUCT_ANALYTICS).split("\n")[sends] || "";

      expect({
        language,
        // German joins it into one word with its noun: "React-Native-App".
        reactNative:
          line.includes("React Native") || line.includes("React-Native"),
        setRoute: line.includes("`setRoute()`"),
      }).toEqual({ language, reactNative: true, setRoute: true });
    }
  });

  it("names a screen setRoute() is given as a page view, as the recorder files it", () => {
    const recorder: string = mobileSource("MobileReplayRecorder.ts");
    const setRoute: string = between(
      recorder,
      "public async setRoute(route: string): Promise<void> {",
      "/*\n     * Paused for idle",
    );

    expect(setRoute).toContain("this.analytics?.page(sanitizeRoute(route));");
    expect(send).toContain(
      "A React Native app sends its session's start and each screen it passes to `setRoute()` as a page view.",
    );
  });

  it("sends metric() from the React Native recorder too, masked as its text is", () => {
    const recorder: string = mobileSource("MobileReplayRecorder.ts");

    expect(recorder).toContain("public metric(");
    // Masked whatever the policy's mode, but the readable event properties (#7501).
    expect(recorder).toContain(
      "return maskStringMapValues(\n            sanitizeEventProperties(value),\n            this.readableEventPropertyKeys(),\n          );",
    );
    /* Said after Mask all text, tags and readable event properties, which it is the mobile form of. */
    expect(
      lineStartingWith(send, "- **Masked as the recording is.**"),
    ).toContain(
      "A React Native app's values are masked the same way, as its SDK masks all text: only a short code under one of those keys is sent as written. A page is sent as its path",
    );
    expect(lineStartingWith(send, "- **In small batches**")).toContain(
      "every 5 seconds and when the tab is hidden or the app goes to the background.",
    );
  });
});
