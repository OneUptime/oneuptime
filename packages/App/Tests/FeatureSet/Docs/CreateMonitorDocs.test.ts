import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
} from "../../../FeatureSet/Docs/Utils/I18n";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Creating a Monitor" docs page against the form it describes.
 *
 * The maintainer called Create Monitor "extremely confusing". It now asks
 * what to monitor first - six common types, the rest behind More monitor
 * types or the search box, a picked type shrunk to one line with Change -
 * then the name, folds the description and labels, folds the default
 * criteria and says nothing is missing until Next. This page says so, in
 * every language, with the words that language's dashboard shows.
 *
 * Markdown is not compiled, so nothing else notices when a step is renamed,
 * the common types change, the interval default moves or the picker's
 * button is reworded. These tests read the sources of truth - the nav, the
 * Create Monitor page and its picker helper, the monitor type catalog, the
 * interval options, the dashboard's locale files - and hold every language's
 * page to them.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DOCS_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Locales",
);

const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const NAV_GROUP_TITLE: string = "Monitor";
const PAGE_TITLE: string = "Creating a Monitor";
const PAGE_RELATIVE_PATH: string = "monitor/create-monitor";
const PAGE_URL: string = `/docs/${PAGE_RELATIVE_PATH}`;

const CREATE_PAGE_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/Create.tsx";
const TYPE_FIELD_FILE: string =
  "App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorTypeFormField.ts";
const INTERVAL_OPTIONS_FILE: string =
  "App/FeatureSet/Dashboard/src/Utils/MonitorIntervalDropdownOptions.ts";
const INTERVAL_DEFAULT_FILE: string =
  "App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitoringIntervalDefault.ts";

// Create Monitor's steps, in order: the page's first three sections.
const STEP_TITLES: Array<string> = [
  "Monitor Info",
  "Criteria",
  "Probes & Interval",
];

const LAST_SECTION: string = "Starting from a template or a link";

/*
 * The words every language's page names, bold, as that language's dashboard
 * shows them.
 */
const UI_WORDS: Array<string> = [
  "Create Monitor",
  "Monitor Type",
  "More monitor types",
  "Change",
  "Name",
  "Description",
  "Labels",
  MORE_FIELDS_SECTION_TITLE,
  "Test Monitor",
  "Monitor Criteria",
  "Add Criteria",
  "Next",
  "Probes",
  "Monitoring Interval",
  "Every 5 Minutes",
];

// The search words every page offers as examples.
const SEARCH_EXAMPLES: Array<string> = ["k8s", "postgres", "heartbeat", "tls"];

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readPage(lang: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, `${PAGE_RELATIVE_PATH}.md`),
    "utf8",
  );
}

function readDocsLocale(lang: string): { navLinks: Record<string, string> } {
  return JSON.parse(
    fs.readFileSync(path.join(DOCS_LOCALES_DIR, `${lang}.json`), "utf8"),
  );
}

// The words a language's dashboard shows: English where it has none.
function readDashboardLocale(lang: string): Record<string, string> {
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`), "utf8"),
  );

  return new Proxy(locale, {
    get: (target: Record<string, string>, key: string): string => {
      return target[key] || key;
    },
  });
}

// The page's "## " sections, by heading, with their text.
function sections(markdown: string): Array<{ heading: string; body: string }> {
  const found: Array<{ heading: string; body: string }> = [];

  for (const part of markdown.split(/^## /m).slice(1)) {
    const newline: number = part.indexOf("\n");

    found.push({
      heading: part.slice(0, newline).trim(),
      body: part.slice(newline + 1),
    });
  }

  return found;
}

function monitorGroup(): NavGroup {
  const group: NavGroup | undefined = DocsNav.find((candidate: NavGroup) => {
    return candidate.title === NAV_GROUP_TITLE;
  });

  if (!group) {
    throw new Error("No Monitor nav group");
  }

  return group;
}

// Every type the picker offers, by its title.
const OFFERED_TYPES: Array<MonitorType> =
  MonitorTypeHelper.getMonitorTypeCategories().flatMap(
    (category: MonitorTypeCategory): Array<MonitorType> => {
      return category.monitorTypes;
    },
  );

// The types that end on Probes & Interval: the ones probes check.
const PROBE_CHECKED_TITLES: Array<string> = OFFERED_TYPES.filter(
  (type: MonitorType): boolean => {
    return MonitorTypeHelper.doesMonitorTypeHaveInterval(type);
  },
).map((type: MonitorType): string => {
  return MonitorTypeHelper.getTitle(type);
});

const ENGLISH: string = readPage("en");

describe("the Creating a Monitor docs page", () => {
  describe("in the nav", () => {
    it("is the first link of the Monitor group", () => {
      const links: Array<NavLink> = monitorGroup().links;

      expect(links[0]).toEqual({ title: PAGE_TITLE, url: PAGE_URL });
      expect(links[1]?.title).toBe("Monitor Templates");
      expect(
        DocsNav.flatMap((group: NavGroup) => {
          return group.links;
        }).filter((link: NavLink): boolean => {
          return link.url === PAGE_URL;
        }),
      ).toHaveLength(1);
    });

    it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
      "is named in %s, and the page is titled as its link",
      (lang: string) => {
        const title: string | undefined =
          readDocsLocale(lang).navLinks[PAGE_TITLE];

        expect(typeof title).toBe("string");
        expect(title!.trim().length).toBeGreaterThan(0);

        if (lang !== "en") {
          expect(title).not.toBe(PAGE_TITLE);
        }

        const localized: Array<string> = getLocalizedNav(lang).flatMap(
          (group: { links: Array<{ title: string; url: string }> }) => {
            return group.links
              .filter((link: { url: string }): boolean => {
                return link.url.endsWith(PAGE_RELATIVE_PATH);
              })
              .map((link: { title: string }): string => {
                return link.title;
              });
          },
        );

        expect(localized).toEqual([title]);
        expect(readPage(lang).split("\n")[0]).toBe(`# ${title}`);
      },
    );
  });

  describe("in English", () => {
    const pageSections: Array<{ heading: string; body: string }> =
      sections(ENGLISH);

    it("walks Create Monitor's steps, in order, then templates and links", () => {
      expect(
        pageSections.map((section: { heading: string }): string => {
          return section.heading;
        }),
      ).toEqual([...STEP_TITLES, LAST_SECTION]);
    });

    it("names the steps as the form does", () => {
      const create: string = readRepoFile(CREATE_PAGE_FILE);
      const positions: Array<number> = STEP_TITLES.map(
        (title: string): number => {
          return create.indexOf(`title: "${title}",`);
        },
      );

      for (const position of positions) {
        expect(position).toBeGreaterThan(-1);
      }

      // In the order the form declares them.
      expect(
        [...positions].sort((a: number, b: number) => {
          return a - b;
        }),
      ).toEqual(positions);
    });

    it("lists the six common types first, in the picker's order", () => {
      const first: string = pageSections[0]!.body;
      const titles: Array<string> =
        MonitorTypeHelper.getCommonMonitorTypes().map(
          (type: MonitorType): string => {
            return MonitorTypeHelper.getTitle(type);
          },
        );

      expect(titles).toEqual([
        "Website",
        "API",
        "Ping",
        "Port",
        "SSL Certificate",
        "Incoming Request",
      ]);

      const positions: Array<number> = titles.map((title: string): number => {
        return first.indexOf(`**${title}**`);
      });

      for (const position of positions) {
        expect(position).toBeGreaterThan(-1);
      }

      expect(
        [...positions].sort((a: number, b: number) => {
          return a - b;
        }),
      ).toEqual(positions);
    });

    it("names the picker's More button, Change and Escape as the picker does", () => {
      const first: string = pageSections[0]!.body;
      const helper: string = readRepoFile(TYPE_FIELD_FILE);

      expect(helper).toMatch(/translationKey\("More monitor types"\)/);
      expect(first).toContain("**More monitor types**");
      expect(first).toContain("**Change**");
      expect(first).toContain("**Escape**");
      expect(first).toContain("**Enter**");
    });

    /*
     * The page promises the search understands these words: each must be a
     * keyword of a type the picker offers, or the promise is broken.
     */
    it("offers only search words the catalog knows", () => {
      const keywords: Array<string> = OFFERED_TYPES.flatMap(
        (type: MonitorType): Array<string> => {
          return MonitorTypeHelper.getKeywords(type);
        },
      );

      for (const word of SEARCH_EXAMPLES) {
        expect(ENGLISH).toContain(`\`${word}\``);
        expect(keywords).toContain(word);
      }
    });

    it("says Manual is under Other, and is created from Monitor Info", () => {
      const other: MonitorTypeCategory | undefined =
        MonitorTypeHelper.getMonitorTypeCategories().find(
          (category: MonitorTypeCategory): boolean => {
            return category.label === "Other";
          },
        );

      expect(other?.monitorTypes).toEqual([MonitorType.Manual]);

      const first: string = pageSections[0]!.body;
      expect(first).toContain(
        "**Manual**, a monitor whose status you set yourself, is under **Other**.",
      );
      expect(first).toContain(
        "A **Manual** monitor needs nothing more, so **Create Monitor** is on this step.",
      );
    });

    it("names the fields of Monitor Info, the folded ones under More fields", () => {
      const first: string = pageSections[0]!.body;

      for (const title of ["Name", "Description", "Labels"]) {
        expect(first).toContain(`**${title}**`);
      }

      expect(first).toContain(
        `**Description** and **Labels** are optional and wait under **${MORE_FIELDS_SECTION_TITLE}**.`,
      );
    });

    it("says the default criteria start folded, and nothing is missing until Next", () => {
      const criteria: string = pageSections[1]!.body;

      expect(criteria).toContain("**Test Monitor**");
      expect(criteria).toContain("**Monitor Criteria**");
      expect(criteria).toContain("each folded to one line");
      expect(criteria).toContain("**Add Criteria**");
      expect(criteria).toContain(
        "Nothing on this step is marked as missing until you click **Next**.",
      );
    });

    it("lists exactly the types that end on Probes & Interval", () => {
      const probes: string = pageSections[2]!.body;
      const listed: string = probes.slice(
        probes.indexOf("end with this step: ") + "end with this step: ".length,
        probes.indexOf(". **Probes**"),
      );
      const names: Array<string> = listed
        .replace(" and ", ", ")
        .split(", ")
        .map((name: string): string => {
          return name.trim();
        });

      expect([...names].sort()).toEqual([...PROBE_CHECKED_TITLES].sort());
    });

    it("gives the interval default the form starts on", () => {
      const probes: string = pageSections[2]!.body;
      const options: string = readRepoFile(INTERVAL_OPTIONS_FILE);
      const defaults: string = readRepoFile(INTERVAL_DEFAULT_FILE);

      expect(defaults).toContain(
        'DEFAULT_MONITORING_INTERVAL: string = "*/5 * * * *"',
      );
      expect(options).toMatch(
        /value: "\*\/5 \* \* \* \*",\s*label: "Every 5 Minutes"/,
      );
      expect(probes).toContain("**Every 5 Minutes**");
      expect(probes).toContain("**Monitoring Interval**");
    });
  });

  describe.each(SUPPORTED_DOCS_LANGUAGE_CODES)("in %s", (lang: string) => {
    const page: string = readPage(lang);
    const dashboard: Record<string, string> = readDashboardLocale(lang);
    const pageSections: Array<{ heading: string; body: string }> =
      sections(page);

    it("walks the steps under the names that language's dashboard gives them", () => {
      expect(pageSections).toHaveLength(4);
      expect(
        pageSections.slice(0, 3).map((section: { heading: string }) => {
          return section.heading;
        }),
      ).toEqual(
        STEP_TITLES.map((title: string): string => {
          return dashboard[title]!;
        }),
      );
    });

    it("names the form's buttons and fields as that language's dashboard does", () => {
      for (const word of UI_WORDS) {
        expect({
          word,
          found: page.includes(`**${dashboard[word]!}**`),
        }).toEqual({ word, found: true });
      }
    });

    it("offers the same search words, and links to monitor templates", () => {
      for (const word of SEARCH_EXAMPLES) {
        expect(page).toContain(`\`${word}\``);
      }

      expect(page).toContain("](/docs/monitor/monitor-templates)");
    });

    /*
     * As that language's type picker draws them: the picker translates each
     * type's title (CardSelect), English where the locale has no key.
     */
    it("lists the types that end on Probes & Interval, as that language's picker names them", () => {
      const probes: string = pageSections[2]!.body;

      for (const title of PROBE_CHECKED_TITLES) {
        const drawn: string = dashboard[title]!;

        expect({ title, drawn, found: probes.includes(drawn) }).toEqual({
          title,
          drawn,
          found: true,
        });
      }
    });
  });
});
