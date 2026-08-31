import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
  makeT,
} from "../../../FeatureSet/Docs/Utils/I18n";
import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  DEFAULT_FUTURE_DAYS,
  DEFAULT_PAST_DAYS,
  MAX_EVENTS,
  MAX_FUTURE_DAYS,
  MAX_GAP_EVENTS,
  MAX_PAST_DAYS,
  MIN_FUTURE_DAYS,
  PREVIOUS_TOKEN_GRACE_DAYS,
} from "Common/Types/OnCallDutyPolicy/CalendarFeedWindow";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Registration and drift checks for the "Calendar Feeds" docs page.
 *
 * The page is shipped in every docs language (the on-call docs are fully
 * mirrored, unlike most of the tree), is linked from the On Call nav group,
 * and repeats a number of facts that live in code: the feed URL shapes, the
 * environment variables, the window bounds, the Nginx access-log exemption
 * and the dashboard/mobile UI names. Each of those has a home in the source
 * tree; these tests read that home and fail when the docs and the code drift
 * apart, the same way PermissionsDocsPages.test.ts pins the permissions pages.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Locales",
);

const NAV_GROUP_TITLE: string = "On Call";
const PAGE_TITLE: string = "Calendar Feeds";
const PAGE_RELATIVE_PATH: string = "on-call/calendar-feeds";
const PAGE_URL: string = `/docs/${PAGE_RELATIVE_PATH}`;

const FENCE_LINE: RegExp = /^\s*```/;
const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const LEVEL_ONE_TITLE: RegExp = /^# \S/;
const QUOTED_FEED_VARIABLE: RegExp =
  /"((?:DISABLE_)?ON_CALL_CALENDAR_FEED[A-Z_]*)"/g;
const MODEL_MINUTES_CONSTANT: (name: string) => RegExp = (
  name: string,
): RegExp => {
  return new RegExp(
    `${name}:\\s*number\\s*=\\s*([0-9]+(?:\\s*\\*\\s*[0-9]+)*);`,
  );
};

/*
 * The model spells its bounds as arithmetic (`14 * 24 * 60`) so the intent
 * is readable; multiply the factors rather than pin the spelling.
 */
function evaluateProduct(expression: string): number {
  return expression
    .split("*")
    .map((factor: string): number => {
      return Number(factor.trim());
    })
    .reduce((product: number, factor: number): number => {
      return product * factor;
    }, 1);
}

interface LocaleFile {
  ui: { [key: string]: string };
  navGroups: { [key: string]: string };
  navLinks: { [key: string]: string };
}

function readPage(lang: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, `${PAGE_RELATIVE_PATH}.md`),
    "utf8",
  );
}

function readLocale(lang: string): LocaleFile {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8"),
  );
}

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/*
 * Heading outline of a page: the level of every heading outside a fenced
 * block, in order. Translations may change the words but not the shape.
 */
function headingOutline(markdown: string): Array<number> {
  const outline: Array<number> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const heading: RegExpMatchArray | null = line.match(/^(#{1,6})\s+\S/);
    if (heading && heading[1]) {
      outline.push(heading[1].length);
    }
  }

  return outline;
}

function countFences(markdown: string): number {
  return markdown.split("\n").filter((line: string): boolean => {
    return FENCE_LINE.test(line);
  }).length;
}

function readSourceTree(relativeDir: string): string {
  const absolute: string = path.join(REPO_ROOT, relativeDir);
  const chunks: Array<string> = [];

  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (SOURCE_FILE.test(entry.name)) {
        chunks.push(fs.readFileSync(full, "utf8"));
      }
    }
  };

  walk(absolute);
  return chunks.join("\n");
}

const onCallGroup: NavGroup = DocsNav.find((item: NavGroup): boolean => {
  return item.title === NAV_GROUP_TITLE;
})!;

/*
 * Strings the feed itself emits, plus routes, headers and variable names.
 * They are quoted verbatim on every translated page so a reader can match
 * what the docs say against what their calendar app shows.
 */
const LITERALS_ON_EVERY_PAGE: Array<string> = [
  "On-call · <Schedule>",
  "<Name> · On-call · <Schedule>",
  "(covering for <Name>)",
  "No coverage · <Schedule>",
  "On-call · <Schedule> · <Policy> (covering for <Name>)",
  "Past shifts reflect the current rotation, not who was actually paged",
  "/api/on-call-calendar/user/<token>/shifts.ics",
  "/api/on-call-calendar/schedule/<token>/schedule.ics",
  "/api/on-call-calendar/project/<token>/project.ics",
  "?schedule=<id>",
  "?nocache=1",
  "X-PUBLISHED-TTL:PT1H",
  "REFRESH-INTERVAL",
  "TRANSP:TRANSPARENT",
  "X-WR-CALDESC",
  "Warning: 110",
  "Retry-After: 3600",
  "Cache-Control: private",
  "X-Robots-Tag: noindex",
  "ENCRYPTION_SECRET",
  "TRUSTED_PROXY_HOPS",
  "HTTP_PROTOCOL",
  "DISABLE_ON_CALL_CALENDAR_FEED",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW",
  "onCallCalendarFeed.disabled",
  "onCallCalendarFeed.rateLimit.windowSeconds",
  "onCallCalendarFeed.rateLimit.perTokenPerWindow",
  "onCallCalendarFeed.rateLimit.perIpPerWindow",
  "worker.enabled: true",
  "location ~ ^/api/on-call-calendar/(user|schedule|project)/",
  "access_log off;",
  "Nginx/default.conf.template",
  "oncall_calendar_render_duration_ms",
  "configuration.md#on-call-calendar-feeds",
  "configuration.md#trusted-proxies",
  "/docs/self-hosted/private-network-access",
  "webcals://",
  "curl -I",
];

/*
 * Dashboard copy the page quotes as bold UI names. Each must exist in the
 * dashboard source so a rename in the UI fails here rather than leaving the
 * docs pointing at a control that no longer exists.
 */
const DASHBOARD_UI_NAMES: Array<string> = [
  "Calendar Feed",
  "Calendar Feeds",
  "Generate calendar link",
  "Subscribe to your on-call shifts",
  "Google Calendar",
  "Apple / other apps",
  "Copy webcal link",
  "Include shifts I cover for others",
  "Days of past shifts",
  "Days ahead",
  "Upcoming shifts",
  "Get cover",
  "Remind me before shifts",
  "Regenerate link",
  "Only my shifts on this schedule",
  "Add your shifts to your calendar",
  "Subscribe to this schedule",
  "Everyone's shifts on this schedule (shared team link)",
  "Everyone's shifts in this project (shared link)",
  "Publish shared link",
  "Show coverage gaps",
  "Minimum gap to show (minutes)",
  "Regenerate when someone leaves the project",
  "Before my on-call shift starts",
  "My upcoming on-call shift is reassigned",
];

const MOBILE_UI_NAMES: Array<string> = [
  "Add shifts to my calendar",
  "Calendar feed",
  "Open in Calendar",
  "Share link",
  "Copy https link",
  "Your shifts",
  "Get cover",
];

describe("Calendar Feeds docs page", () => {
  describe("navigation", () => {
    it("is linked from the On Call group", () => {
      expect(onCallGroup).toBeDefined();

      const link: NavLink | undefined = onCallGroup.links.find(
        (item: NavLink): boolean => {
          return item.url === PAGE_URL;
        },
      );

      expect(link).toBeDefined();
      expect(link!.title).toBe(PAGE_TITLE);
    });

    it("is listed exactly once across the whole nav", () => {
      const occurrences: number = DocsNav.flatMap((group: NavGroup) => {
        return group.links;
      }).filter((link: NavLink): boolean => {
        return link.url === PAGE_URL;
      }).length;

      expect(occurrences).toBe(1);
    });

    it("resolves to a file on disk in the default language", () => {
      const file: string = path.join(
        CONTENT_DIR,
        DEFAULT_DOCS_LANGUAGE,
        `${PAGE_RELATIVE_PATH}.md`,
      );

      expect(fs.existsSync(file)).toBe(true);
    });

    it("has a translated nav title in every language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const locale: LocaleFile = readLocale(lang);
        const title: string | undefined = locale.navLinks[PAGE_TITLE];

        expect(typeof title).toBe("string");
        expect(title!.trim().length).toBeGreaterThan(0);

        if (lang !== DEFAULT_DOCS_LANGUAGE) {
          // The raw English key in a non-English locale means nobody translated it.
          expect(title).not.toBe(PAGE_TITLE);
        }
      }
    });

    it("localizes the link title and prefixes the URL with the language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const localized: ReturnType<typeof getLocalizedNav> =
          getLocalizedNav(lang);
        const t: ReturnType<typeof makeT> = makeT(lang);

        const group: { title: string; links: Array<NavLink> } | undefined =
          localized.find((item: { title: string }): boolean => {
            return item.title === t(`navGroups.${NAV_GROUP_TITLE}`);
          });

        expect(group).toBeDefined();

        // localizeDocsUrl prefixes every language, the default one included.
        const expectedUrl: string = `/docs/${lang}/${PAGE_RELATIVE_PATH}`;

        const link: NavLink | undefined = group!.links.find(
          (item: NavLink): boolean => {
            return item.url === expectedUrl;
          },
        );

        expect(link).toBeDefined();
        expect(link!.title).toBe(t(`navLinks.${PAGE_TITLE}`));
      }
    });

    it("is the docs page the dashboard's calendar-feed links open", () => {
      const source: string = readRepoFile(
        "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil.ts",
      );
      const match: RegExpMatchArray | null = source.match(
        /CALENDAR_FEED_DOCS_PATH:\s*string\s*=\s*"([^"]+)"/,
      );

      expect(match).not.toBeNull();
      expect(`/docs${match![1]}`).toBe(PAGE_URL);
    });
  });

  describe("translations", () => {
    it("exists in every supported language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const file: string = path.join(
          CONTENT_DIR,
          lang,
          `${PAGE_RELATIVE_PATH}.md`,
        );

        expect({ lang, exists: fs.existsSync(file) }).toEqual({
          lang,
          exists: true,
        });
      }
    });

    it("keeps the on-call docs fully mirrored across languages", () => {
      const english: Array<string> = fs
        .readdirSync(path.join(CONTENT_DIR, DEFAULT_DOCS_LANGUAGE, "on-call"))
        .sort();

      expect(english).toContain("calendar-feeds.md");

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const files: Array<string> = fs
          .readdirSync(path.join(CONTENT_DIR, lang, "on-call"))
          .sort();

        expect({ lang, files }).toEqual({ lang, files: english });
      }
    });

    it("starts every translation with a level-one title", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const firstLine: string = readPage(lang).split("\n")[0] || "";

        expect({ lang, ok: LEVEL_ONE_TITLE.test(firstLine) }).toEqual({
          lang,
          ok: true,
        });
      }
    });

    it("keeps the English heading outline in every translation", () => {
      const english: Array<number> = headingOutline(
        readPage(DEFAULT_DOCS_LANGUAGE),
      );

      expect(english.length).toBeGreaterThan(15);

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({ lang, outline: headingOutline(readPage(lang)) }).toEqual({
          lang,
          outline: english,
        });
      }
    });

    it("keeps the same code samples in every translation", () => {
      const english: number = countFences(readPage(DEFAULT_DOCS_LANGUAGE));

      expect(english).toBeGreaterThan(0);
      expect(english % 2).toBe(0);

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({ lang, fences: countFences(readPage(lang)) }).toEqual({
          lang,
          fences: english,
        });
      }
    });

    it("quotes the feed's literal strings, routes and variables verbatim in every translation", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const page: string = readPage(lang);
        const missing: Array<string> = LITERALS_ON_EVERY_PAGE.filter(
          (literal: string): boolean => {
            return !page.includes(literal);
          },
        );

        expect({ lang, missing }).toEqual({ lang, missing: [] });
      }
    });

    it("uses no in-page anchors, so translated headings cannot break links", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({ lang, anchors: readPage(lang).match(/\]\(#/g) }).toEqual({
          lang,
          anchors: null,
        });
      }
    });

    it("links only to docs pages that exist in the default language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const links: Array<string> = Array.from(
          readPage(lang).matchAll(/\]\(\/docs\/([^)#?]+)/g),
        ).map((match: RegExpMatchArray): string => {
          return match[1] || "";
        });

        expect(links.length).toBeGreaterThan(0);

        for (const link of links) {
          const file: string = path.join(
            CONTENT_DIR,
            DEFAULT_DOCS_LANGUAGE,
            `${link}.md`,
          );
          expect({ lang, link, exists: fs.existsSync(file) }).toEqual({
            lang,
            link,
            exists: true,
          });
        }
      }
    });
  });

  describe("facts that live in code", () => {
    const english: string = readPage(DEFAULT_DOCS_LANGUAGE);

    it("documents every calendar-feed environment variable the server reads", () => {
      const environmentConfig: string = readRepoFile(
        "Common/Server/EnvironmentConfig.ts",
      );
      /*
       * The kill switch is read straight off process.env; the three limits go
       * through a parsing helper that takes the name as a string. Either way
       * the name appears quoted exactly once per variable.
       */
      const variables: Array<string> = Array.from(
        new Set(
          Array.from(environmentConfig.matchAll(QUOTED_FEED_VARIABLE)).map(
            (match: RegExpMatchArray): string => {
              return match[1] || "";
            },
          ),
        ),
      ).sort();

      expect(variables).toEqual([
        "DISABLE_ON_CALL_CALENDAR_FEED",
        "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW",
        "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW",
        "ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS",
      ]);

      for (const variable of variables) {
        expect(english).toContain(`\`${variable}\``);
      }
    });

    it("documents the Helm values the chart exposes for the feature", () => {
      const values: string = readRepoFile(
        "HelmChart/Public/oneuptime/values.yaml",
      );

      expect(values).toContain("onCallCalendarFeed:");

      for (const helmValue of [
        "onCallCalendarFeed.disabled",
        "onCallCalendarFeed.rateLimit.windowSeconds",
        "onCallCalendarFeed.rateLimit.perTokenPerWindow",
        "onCallCalendarFeed.rateLimit.perIpPerWindow",
      ]) {
        expect(english).toContain(`\`${helmValue}\``);

        const leaf: string = helmValue.split(".").pop() || "";
        expect(values).toMatch(new RegExp(`^\\s+${leaf}:`, "m"));
      }
    });

    it("links to Helm configuration headings that exist", () => {
      const configuration: string = readRepoFile(
        "HelmChart/Public/oneuptime/docs/configuration.md",
      );
      const headingSlugs: Set<string> = new Set(
        Array.from(configuration.matchAll(/^#{1,6}\s+(.*)$/gm)).map(
          (match: RegExpMatchArray): string => {
            return slugify((match[1] || "").trim());
          },
        ),
      );

      const anchors: Array<string> = Array.from(
        english.matchAll(/docs\/configuration\.md#([a-z0-9-]+)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] || "";
      });

      expect(anchors).toEqual(
        expect.arrayContaining(["on-call-calendar-feeds", "trusted-proxies"]),
      );

      for (const anchor of anchors) {
        expect({ anchor, known: headingSlugs.has(anchor) }).toEqual({
          anchor,
          known: true,
        });
      }
    });

    it("quotes the Nginx access-log exemption that the shipped template contains", () => {
      const template: string = readRepoFile("Nginx/default.conf.template");
      const location: string =
        "location ~ ^/api/on-call-calendar/(user|schedule|project)/";

      expect(template).toContain(location);
      expect(template).toContain("access_log off;");
      expect(english).toContain(location);
    });

    it("states the window bounds from CalendarFeedWindow", () => {
      expect(english).toContain(
        `(default ${DEFAULT_PAST_DAYS}, at most ${MAX_PAST_DAYS})`,
      );
      expect(english).toContain(
        `(default ${DEFAULT_FUTURE_DAYS}, between ${MIN_FUTURE_DAYS} and ${MAX_FUTURE_DAYS})`,
      );
      expect(english).toContain(`${MAX_EVENTS.toLocaleString("en-US")} events`);
      expect(english).toContain(`at most ${MAX_GAP_EVENTS} gap events`);
      expect(english).toContain(`${PREVIOUS_TOKEN_GRACE_DAYS} days`);
    });

    it("states the reminder lead-time bounds from the model", () => {
      const model: string = readRepoFile(
        "Common/Models/DatabaseModels/UserOnCallShiftReminder.ts",
      );
      const min: RegExpMatchArray | null = model.match(
        MODEL_MINUTES_CONSTANT("MIN_MINUTES_BEFORE_SHIFT"),
      );
      const max: RegExpMatchArray | null = model.match(
        MODEL_MINUTES_CONSTANT("MAX_MINUTES_BEFORE_SHIFT"),
      );

      expect(min).not.toBeNull();
      expect(max).not.toBeNull();

      const minMinutes: number = evaluateProduct(min![1] || "");
      const maxDays: number = evaluateProduct(max![1] || "") / (24 * 60);

      expect(Number.isInteger(maxDays)).toBe(true);
      expect(english).toContain(
        `between ${minMinutes} minutes and ${maxDays} days`,
      );
    });

    it("names dashboard controls exactly as the dashboard does", () => {
      const dashboard: string = [
        readSourceTree("App/FeatureSet/Dashboard/src/Components/OnCallPolicy"),
        readSourceTree("App/FeatureSet/Dashboard/src/Pages/UserSettings"),
        readSourceTree("App/FeatureSet/Dashboard/src/Pages/OnCallDuty"),
        readSourceTree("App/FeatureSet/Dashboard/src/Pages/Global"),
      ].join("\n");

      for (const name of DASHBOARD_UI_NAMES) {
        expect({ name, inDashboard: dashboard.includes(`"${name}"`) }).toEqual({
          name,
          inDashboard: true,
        });
        expect({ name, inDocs: english.includes(`**${name}**`) }).toEqual({
          name,
          inDocs: true,
        });
      }
    });

    it("names mobile controls exactly as the mobile app does", () => {
      const mobile: string = readSourceTree("MobileApp/src");

      for (const name of MOBILE_UI_NAMES) {
        expect({ name, inMobile: mobile.includes(name) }).toEqual({
          name,
          inMobile: true,
        });
        expect({ name, inDocs: english.includes(`**${name}**`) }).toEqual({
          name,
          inDocs: true,
        });
      }
    });

    it("keeps the personal, schedule and project feed routes in step with the API", () => {
      const api: string = readRepoFile(
        "Common/Server/API/OnCallCalendarAPI.ts",
      );

      for (const route of [
        "/user/:token/shifts.ics",
        "/schedule/:token/schedule.ics",
        "/project/:token/project.ics",
      ]) {
        expect(api).toContain(route);
        expect(english).toContain(
          `/api/on-call-calendar${route.replace(":token", "<token>")}`,
        );
      }
    });
  });
});
