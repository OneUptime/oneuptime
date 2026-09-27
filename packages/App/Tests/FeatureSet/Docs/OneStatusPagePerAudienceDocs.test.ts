import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
  makeT,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, {
  LocalizedNavGroup,
  LocalizedNavLink,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import IncidentStatusPageScopeCopy, {
  formatScopeText,
} from "../../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import Incident from "Common/Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import slugify from "Common/Server/Types/MarkdownSlugify";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import IncidentCreatedRenotify from "Common/Types/StatusPage/IncidentCreatedRenotify";
import IncidentCreatedResend from "Common/Types/StatusPage/IncidentCreatedResend";
import SubscriberNotificationResendCopy from "../../../FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationResendCopy";
import IncidentScopeAddedPagesNotification from "Common/Types/StatusPage/IncidentScopeAddedPagesNotification";
import IncidentSubscriberAudience from "Common/Types/StatusPage/IncidentSubscriberAudience";
import { getFeedEventTypeLabel } from "Common/UI/Components/Feed/FeedOptions";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "One Status Page per Audience" guide, and the incident and status page
 * pages that say who an incident notifies, against the feature they describe.
 *
 * Markdown is not compiled, so nothing else notices when the dashboard renames
 * the status page picker, the scoped-only switch, the Status Page Scope card
 * or the added-pages checkbox; when the miscDataProps keys, the audience
 * endpoint or its channel names change; when a role gains or loses read access
 * to status pages; or when the Persian guide falls behind the English one.
 * Each test reads the source of truth - the nav and its translations, the
 * shared copy constants the dashboard renders, the models, the side menus and
 * the API - and checks the shipped pages still tell the same story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const LOCALES_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Locales");
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src",
);

const GUIDE_PAGE: string = "status-pages/one-status-page-per-audience";
const GUIDE_TITLE: string = "One Status Page per Audience";
const GUIDE_URL: string = `/docs/${GUIDE_PAGE}`;
const NAV_GROUP_TITLE: string = "Status Pages";

/*
 * `fa` is the only translated corpus (every other language falls back to the
 * English page at request time), so it is the only one that ships the guide.
 */
const TRANSLATED_LANGUAGES: ReadonlyArray<string> = ["fa"];
const ALL_LANGUAGES: ReadonlyArray<string> = ["en", ...TRANSLATED_LANGUAGES];

/*
 * The existing pages that describe who hears about an incident. Each one
 * must send readers on to the guide, in every language.
 */
const PAGES_THAT_LINK_TO_THE_GUIDE: ReadonlyArray<string> = [
  "incidents/index",
  "incidents/declaring-incidents",
  "incidents/states-and-severities",
  "incidents/notes-owners-and-feed",
  "incidents/settings",
  "status-pages/index",
  "status-pages/subscribers",
  "status-pages/resources-and-groups",
  "status-pages/public-api",
];

// The model columns the guide names in code, and the model each is on.
const DOCUMENTED_COLUMNS: ReadonlyArray<{
  column: string;
  model: string;
  columns: Array<string>;
}> = [
  {
    column: "statusPages",
    model: "Incident",
    columns: new Incident().getTableColumns().columns,
  },
  {
    column: "isScopedToStatusPages",
    model: "Incident",
    columns: new Incident().getTableColumns().columns,
  },
  {
    column: "statusPagesNotifiedOnCreation",
    model: "Incident",
    columns: new Incident().getTableColumns().columns,
  },
  {
    column: "onlyShowScopedIncidents",
    model: "StatusPage",
    columns: new StatusPage().getTableColumns().columns,
  },
];

const FENCE_LINE: RegExp = /^\s*```/;
// An H2 or H3 heading: the ones in-page links point at.
const SECTION_HEADING: RegExp = /^#{2,3} /;
// A heading of any level.
const ANY_HEADING: RegExp = /^#{1,6} /;
// Arabic-script letters, which every Persian sentence contains.
const PERSIAN_LETTER: RegExp = /[؀-ۿ]/;

type PageFileFunction = (language: string, relative: string) => string;

const pageFile: PageFileFunction = (
  language: string,
  relative: string,
): string => {
  return path.join(CONTENT_DIR, language, `${relative}.md`);
};

type ReadPageFunction = (relative: string, language?: string) => string;

const readPage: ReadPageFunction = (
  relative: string,
  language: string = "en",
): string => {
  return fs.readFileSync(pageFile(language, relative), "utf8");
};

type ReadSourceFunction = (relative: string) => string;

const readDashboardSource: ReadSourceFunction = (relative: string): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
};

type SplitMarkdownFunction = (markdown: string) => {
  prose: Array<string>;
  codeBlocks: Array<string>;
};

// Prose lines and fenced code blocks, kept apart so nothing is read out of a fence.
const splitMarkdown: SplitMarkdownFunction = (
  markdown: string,
): { prose: Array<string>; codeBlocks: Array<string> } => {
  const prose: Array<string> = [];
  const codeBlocks: Array<string> = [];
  let current: Array<string> | null = null;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (current) {
        codeBlocks.push(current.join("\n"));
        current = null;
      } else {
        current = [];
      }
      continue;
    }

    if (current) {
      current.push(line);
    } else {
      prose.push(line);
    }
  }

  return { prose: prose, codeBlocks: codeBlocks };
};

type TitleOfFunction = (markdown: string) => string;

const titleOf: TitleOfFunction = (markdown: string): string => {
  const firstLine: string = markdown.split("\n")[0] || "";

  expect(firstLine.startsWith("# ")).toBe(true);

  return firstLine.slice(2).trim();
};

type HeadingSlugsFunction = (markdown: string) => Array<string>;

// The anchor of every H2 and H3, in order.
const headingSlugs: HeadingSlugsFunction = (
  markdown: string,
): Array<string> => {
  return splitMarkdown(markdown)
    .prose.filter((line: string): boolean => {
      return SECTION_HEADING.test(line);
    })
    .map((line: string): string => {
      return slugify(line.replace(/^#+ /, "").trim());
    });
};

type HeadingLevelsFunction = (markdown: string) => Array<number>;

const headingLevels: HeadingLevelsFunction = (
  markdown: string,
): Array<number> => {
  return splitMarkdown(markdown)
    .prose.filter((line: string): boolean => {
      return ANY_HEADING.test(line);
    })
    .map((line: string): number => {
      return (line.match(/^#+/)?.[0] || "").length;
    });
};

type InlineCodeFunction = (markdown: string) => Set<string>;

const inlineCode: InlineCodeFunction = (markdown: string): Set<string> => {
  const prose: string = splitMarkdown(markdown).prose.join("\n");

  return new Set<string>(
    Array.from(prose.matchAll(/`([^`\n]+)`/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

type BoldTextFunction = (markdown: string) => Set<string>;

// Every **bold** span in the prose: how the docs name what is on screen.
const boldText: BoldTextFunction = (markdown: string): Set<string> => {
  const prose: string = splitMarkdown(markdown).prose.join("\n");

  return new Set<string>(
    Array.from(prose.matchAll(/\*\*([^*\n]+)\*\*/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

type DocsLinksFunction = (markdown: string) => Set<string>;

// Every /docs/ link target, without its #anchor.
const docsLinks: DocsLinksFunction = (markdown: string): Set<string> => {
  return new Set<string>(
    Array.from(markdown.matchAll(/\]\((\/docs\/[^)#\s]+)(?:#[^)\s]*)?\)/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

type InPageLinksFunction = (markdown: string) => Array<string>;

// Every in-page `](#anchor)` link target, in order.
const inPageLinks: InPageLinksFunction = (markdown: string): Array<string> => {
  return Array.from(markdown.matchAll(/\]\(#([^)\s]+)\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
};

type StatusPagesGroupFunction = () => NavGroup;

const statusPagesGroup: StatusPagesGroupFunction = (): NavGroup => {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === NAV_GROUP_TITLE;
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
};

interface DocsLocale {
  navLinks: { [key: string]: string };
}

type ReadLocaleFunction = (language: string) => DocsLocale;

const readLocale: ReadLocaleFunction = (language: string): DocsLocale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as DocsLocale;
};

interface SideMenuPage {
  section: string;
  title: string;
}

type SideMenuPagesFunction = (relative: string) => Array<SideMenuPage>;

/*
 * Every side-menu link title with the section it sits in, read from source:
 * the menus are React components that a plain-node test must not import.
 * A title picked by a ternary counts under both of its options.
 */
const sideMenuPages: SideMenuPagesFunction = (
  relative: string,
): Array<SideMenuPage> => {
  const source: string = readDashboardSource(relative);
  const pages: Array<SideMenuPage> = [];

  for (const chunk of source.split(/<SideMenuSection\s+title="/).slice(1)) {
    const section: string = chunk.slice(0, chunk.indexOf('"'));

    for (const match of chunk.matchAll(
      /title:\s*(?:[^,]*?\?\s*)?"([^"]+)"(?:\s*:\s*"([^"]+)")?/g,
    )) {
      pages.push({ section: section, title: match[1] as string });

      if (match[2]) {
        pages.push({ section: section, title: match[2] as string });
      }
    }
  }

  return pages;
};

type ExpectMenuPathFunction = (data: {
  menu: string;
  section: string;
  title: string;
}) => void;

// The side menu puts `title` in `section`, as the docs' "A → B" paths say.
const expectMenuPath: ExpectMenuPathFunction = (data: {
  menu: string;
  section: string;
  title: string;
}): void => {
  expect(
    sideMenuPages(data.menu).some((page: SideMenuPage): boolean => {
      return page.section === data.section && page.title === data.title;
    }),
  ).toBe(true);
};

describe("One Status Page per Audience docs", () => {
  describe("navigation", () => {
    it("lists the guide in the Status Pages group, right after Subscribers & Announcements", () => {
      const links: Array<NavLink> = statusPagesGroup().links;
      const index: number = links.findIndex((link: NavLink): boolean => {
        return link.url === GUIDE_URL;
      });

      expect(index).toBeGreaterThan(0);
      expect(links[index]?.title).toBe(GUIDE_TITLE);
      expect(links[index - 1]?.url).toBe("/docs/status-pages/subscribers");

      // One entry, not a stray duplicate in another group.
      expect(
        DocsNav.flatMap((group: NavGroup): Array<NavLink> => {
          return group.links;
        }).filter((link: NavLink): boolean => {
          return link.url === GUIDE_URL;
        }),
      ).toHaveLength(1);
    });

    it("has an English page titled like its nav entry", () => {
      expect(fs.existsSync(pageFile("en", GUIDE_PAGE))).toBe(true);
      expect(titleOf(readPage(GUIDE_PAGE))).toBe(GUIDE_TITLE);
    });

    it("ships a real translation of the guide", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        expect(fs.existsSync(pageFile(language, GUIDE_PAGE))).toBe(true);

        const translated: string = readPage(GUIDE_PAGE, language);

        expect(PERSIAN_LETTER.test(titleOf(translated))).toBe(true);

        // Every prose paragraph is in Persian, not an English leftover.
        const paragraphs: Array<string> = splitMarkdown(translated)
          .prose.join("\n")
          .split(/\n\s*\n/)
          .map((paragraph: string): string => {
            return paragraph.trim();
          })
          .filter((paragraph: string): boolean => {
            return (
              paragraph.length > 0 &&
              !paragraph.startsWith("|") &&
              !paragraph.startsWith(">")
            );
          });

        for (const paragraph of paragraphs) {
          expect({
            paragraph: paragraph.slice(0, 80),
            persian: PERSIAN_LETTER.test(paragraph),
          }).toEqual({ paragraph: paragraph.slice(0, 80), persian: true });
        }
      }
    });

    it("has a translated nav title in every docs language", () => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const title: string | undefined =
          readLocale(language).navLinks[GUIDE_TITLE];

        expect({
          language: language,
          hasTitle: typeof title === "string" && title.trim().length > 0,
          english: title === GUIDE_TITLE,
        }).toEqual({
          language: language,
          hasTitle: true,
          // The raw English title in another language means nobody translated it.
          english: language === DEFAULT_DOCS_LANGUAGE,
        });
      }
    });

    it("titles the translated nav link like the translated page", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        expect(readLocale(language).navLinks[GUIDE_TITLE]).toBe(
          titleOf(readPage(GUIDE_PAGE, language)),
        );
      }
    });

    it("shows the translated title in every language's nav, linking to that language's page", () => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const group: LocalizedNavGroup | undefined = getLocalizedNav(
          language,
        ).find((item: LocalizedNavGroup): boolean => {
          return item.key === NAV_GROUP_TITLE;
        });

        const link: LocalizedNavLink | undefined = group?.links.find(
          (item: LocalizedNavLink): boolean => {
            return item.url === `/docs/${language}/${GUIDE_PAGE}`;
          },
        );

        expect({ language: language, title: link?.title }).toEqual({
          language: language,
          title: makeT(language)(`navLinks.${GUIDE_TITLE}`),
        });
      }
    });
  });

  describe("links", () => {
    it("points every /docs link on the guide and the pages that link to it at a page that exists", () => {
      for (const language of ALL_LANGUAGES) {
        for (const page of [GUIDE_PAGE, ...PAGES_THAT_LINK_TO_THE_GUIDE]) {
          for (const link of docsLinks(readPage(page, language))) {
            const relative: string = link.slice("/docs/".length);

            expect({
              language: language,
              page: page,
              link: link,
              exists: fs.existsSync(pageFile("en", relative)),
            }).toEqual({
              language: language,
              page: page,
              link: link,
              exists: true,
            });
          }
        }
      }
    });

    it("links every page that says who an incident notifies to the guide, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        for (const page of PAGES_THAT_LINK_TO_THE_GUIDE) {
          expect({
            language: language,
            page: page,
            linksToGuide: docsLinks(readPage(page, language)).has(GUIDE_URL),
          }).toEqual({ language: language, page: page, linksToGuide: true });
        }
      }
    });

    it("keeps the same docs links in the translation", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        expect(
          Array.from(docsLinks(readPage(GUIDE_PAGE, language))).sort(),
        ).toEqual(Array.from(docsLinks(readPage(GUIDE_PAGE))).sort());
      }
    });

    it("points every in-page link at a heading on the page, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(GUIDE_PAGE, language);
        const slugs: Array<string> = headingSlugs(markdown);

        expect(inPageLinks(markdown).length).toBeGreaterThan(0);

        for (const anchor of inPageLinks(markdown)) {
          expect({ language: language, anchor: anchor, found: true }).toEqual({
            language: language,
            anchor: anchor,
            found: slugs.includes(anchor),
          });
        }
      }
    });

    it("keeps every in-page link in the translation, pointing at the translated heading", () => {
      const english: string = readPage(GUIDE_PAGE);
      const englishHeadings: Array<string> = headingSlugs(english);

      for (const language of TRANSLATED_LANGUAGES) {
        const translated: string = readPage(GUIDE_PAGE, language);
        const translatedHeadings: Array<string> = headingSlugs(translated);

        expect(inPageLinks(translated)).toEqual(
          inPageLinks(english).map((anchor: string): string => {
            return translatedHeadings[englishHeadings.indexOf(anchor)] || "";
          }),
        );
      }
    });
  });

  describe("translation", () => {
    it("mirrors the English heading structure", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        expect(headingLevels(readPage(GUIDE_PAGE, language))).toEqual(
          headingLevels(readPage(GUIDE_PAGE)),
        );
      }
    });

    it("keeps every code identifier and code block intact", () => {
      const english: string = readPage(GUIDE_PAGE);

      for (const language of TRANSLATED_LANGUAGES) {
        const translated: string = readPage(GUIDE_PAGE, language);

        expect(Array.from(inlineCode(translated)).sort()).toEqual(
          Array.from(inlineCode(english)).sort(),
        );
        expect(splitMarkdown(translated).codeBlocks).toEqual(
          splitMarkdown(english).codeBlocks,
        );
      }
    });

    it("quotes only on-screen names the English page quotes too", () => {
      const english: Set<string> = boldText(readPage(GUIDE_PAGE));

      for (const language of TRANSLATED_LANGUAGES) {
        /*
         * The translation keeps screen names in English, as the dashboard
         * shows them, and translates everything else. So any bold span it
         * leaves in English must be one the English page quotes: a typo in a
         * button name, or one the English page has since renamed, fails here.
         */
        const untranslated: Array<string> = Array.from(
          boldText(readPage(GUIDE_PAGE, language)),
        ).filter((name: string): boolean => {
          return !PERSIAN_LETTER.test(name);
        });

        expect(untranslated.length).toBeGreaterThan(10);

        for (const name of untranslated) {
          expect({ language: language, name: name, inEnglish: true }).toEqual({
            language: language,
            name: name,
            inEnglish: english.has(name),
          });
        }
      }
    });
  });

  describe("the dashboard", () => {
    // The names each language's guide must quote exactly as the screen shows them.
    const SCREEN_NAMES: ReadonlyArray<string> = [
      IncidentStatusPageScopeCopy.pickerTitle,
      IncidentStatusPageScopeCopy.pickerPlaceholder,
      IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle,
      IncidentStatusPageScopeCopy.settingsCardTitle,
      IncidentStatusPageScopeCopy.settingsEditButton,
      IncidentStatusPageScopeCopy.overviewFieldTitle,
      IncidentStatusPageScopeCopy.overviewEditLink,
      IncidentStatusPageScopeCopy.tableFilterLabel,
      IncidentScopeAddedPagesNotification.formFieldTitle,
    ];

    it("names the picker, the switch, the card and the checkbox as the dashboard does, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const names: Set<string> = boldText(readPage(GUIDE_PAGE, language));

        for (const name of SCREEN_NAMES) {
          expect({ language: language, name: name, quoted: true }).toEqual({
            language: language,
            name: name,
            quoted: names.has(name),
          });
        }
      }
    });

    it("titles the scoped-only switch like the StatusPage column behind it", () => {
      expect(
        new StatusPage().getTableColumnMetadata("onlyShowScopedIncidents")
          .title,
      ).toBe(IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle);
    });

    it("quotes the audience summary in the form the dashboard builds it", () => {
      // The headline, then one list item per page (SubscriberAudienceSummary).
      const pageLine: (name: string, emails: number) => string = (
        name: string,
        emails: number,
      ): string => {
        return formatScopeText(
          IncidentStatusPageScopeCopy.audiencePageWithCounts,
          {
            name: name,
            counts: formatScopeText(
              IncidentStatusPageScopeCopy.audienceEmailCount,
              { number: emails },
            ),
          },
        );
      };

      const example: string = [
        `> ${IncidentStatusPageScopeCopy.audienceWillNotify}`,
        ">",
        `> - ${pageLine("Site 03", 41)}`,
        `> - ${pageLine("Site 07", 18)}`,
      ].join("\n");

      for (const language of ALL_LANGUAGES) {
        const guide: string = readPage(GUIDE_PAGE, language);

        expect(guide).toContain(example);
        expect(
          boldText(guide).has(IncidentStatusPageScopeCopy.audienceNotNotified),
        ).toBe(true);
      }

      // The "more status pages you do not have access to" wording, too.
      expect(readPage(GUIDE_PAGE)).toContain(
        formatScopeText(IncidentStatusPageScopeCopy.audienceHiddenPages, {
          number: "N",
        }).replace(/^N /, ""),
      );
    });

    it("puts the picker on the declare form's Resources Affected step, and the summary on its More step", () => {
      const source: string = readDashboardSource("Pages/Incidents/Create.tsx");

      expect(source).toMatch(
        /statusPages:\s*true,\s*},\s*title:\s*IncidentStatusPageScopeCopy\.pickerTitle,\s*stepId:\s*"resources-affected"/,
      );
      expect(source).toMatch(
        /title:\s*"Resources Affected",\s*id:\s*"resources-affected"/,
      );
      expect(source).toMatch(/title:\s*"More",\s*id:\s*"more"/);
      expect(source).toContain("SubscriberAudienceSummary");

      for (const language of ALL_LANGUAGES) {
        const guide: string = readPage(GUIDE_PAGE, language);
        const names: Set<string> = boldText(guide);

        expect(guide).toContain(
          "**Incidents → All Incidents → Declare Incident**",
        );

        for (const name of [
          "Resources Affected",
          "More",
          "Labels",
          "Change Monitor Status to",
          "Private Incident",
          "Notify Status Page Subscribers",
          "Create from Template",
          "Public Notes",
        ]) {
          expect({ language: language, name: name, quoted: true }).toEqual({
            language: language,
            name: name,
            quoted: names.has(name),
          });
        }
      }
    });

    it("sends readers to the side-menu items the menus really have", () => {
      expectMenuPath({
        menu: "Pages/Incidents/View/SideMenu.tsx",
        section: "Advanced",
        title: "Settings",
      });
      expectMenuPath({
        menu: "Pages/Incidents/View/SideMenu.tsx",
        section: "Notes",
        title: "Public Notes",
      });
      expectMenuPath({
        menu: "Pages/StatusPages/View/SideMenu.tsx",
        section: "Advanced",
        title: "Advanced Settings",
      });
      expectMenuPath({
        menu: "Pages/StatusPages/View/SideMenu.tsx",
        section: "Resources",
        title: "Monitor Rules",
      });
      expectMenuPath({
        menu: "Pages/StatusPages/View/SideMenu.tsx",
        section: "Subscribers",
        title: "Email Subscribers",
      });

      for (const language of ALL_LANGUAGES) {
        const guide: string = readPage(GUIDE_PAGE, language);

        expect(guide).toContain("**Advanced → Settings**");
        expect(guide).toContain("**Resources → Monitor Rules**");
        expect(guide).toMatch(
          /\*\*Status Pages → [^*]+ → Advanced → Advanced Settings\*\*/,
        );
      }
    });

    it("finds the scoped-only switch on the Incident Settings card of Advanced Settings", () => {
      const source: string = readDashboardSource(
        "Pages/StatusPages/View/StatusPageSettings.tsx",
      );

      expect(source).toMatch(/title:\s*"Incident Settings"/);
      expect(source).toMatch(/editButtonText="Edit Settings"/);
      expect(source).toContain(
        "IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle",
      );

      for (const language of ALL_LANGUAGES) {
        const names: Set<string> = boldText(readPage(GUIDE_PAGE, language));

        expect(names.has("Incident Settings")).toBe(true);
        expect(names.has("Edit Settings")).toBe(true);
      }
    });

    it("finds the Status Page Scope card on the incident's Settings page and on incident templates", () => {
      for (const relative of [
        "Pages/Incidents/View/Settings.tsx",
        "Pages/Incidents/Settings/IncidentTemplatesView.tsx",
      ]) {
        const source: string = readDashboardSource(relative);

        expect(source).toContain(
          "title: IncidentStatusPageScopeCopy.settingsCardTitle",
        );
        expect(source).toContain(
          "editButtonText={IncidentStatusPageScopeCopy.settingsEditButton}",
        );
      }

      expect(
        readDashboardSource("Pages/Incidents/Settings/IncidentTemplates.tsx"),
      ).toMatch(
        /statusPages:\s*true,\s*},\s*title:\s*IncidentStatusPageScopeCopy\.pickerTitle,\s*stepId:\s*"resources-affected"/,
      );
    });

    it("names Add in Bulk, on Email Subscribers, as the subscriber list shows it", () => {
      expect(
        readDashboardSource("Pages/StatusPages/View/EmailSubscribers.tsx"),
      ).toMatch(/title:\s*"Add in Bulk"/);

      for (const language of ALL_LANGUAGES) {
        const names: Set<string> = boldText(readPage(GUIDE_PAGE, language));

        expect(names.has("Add in Bulk")).toBe(true);
      }
    });
  });

  describe("the API", () => {
    it("names only real Incident and StatusPage columns", () => {
      for (const language of ALL_LANGUAGES) {
        const code: Set<string> = inlineCode(readPage(GUIDE_PAGE, language));

        for (const documented of DOCUMENTED_COLUMNS) {
          expect({
            language: language,
            column: documented.column,
            quoted: code.has(documented.column),
            onModel: documented.columns.includes(documented.column),
          }).toEqual({
            language: language,
            column: documented.column,
            quoted: true,
            onModel: true,
          });
        }
      }
    });

    it("keeps the derived scope columns out of the API reference, and the list in it", () => {
      const incident: Incident = new Incident();

      expect(
        incident.getTableColumnMetadata("statusPages")
          .hideColumnInDocumentation,
      ).toBeFalsy();
      expect(
        new IncidentTemplate().getTableColumnMetadata("statusPages")
          .hideColumnInDocumentation,
      ).toBeFalsy();

      for (const column of [
        "isScopedToStatusPages",
        "statusPagesNotifiedOnCreation",
      ]) {
        const metadata: ReturnType<Incident["getTableColumnMetadata"]> =
          incident.getTableColumnMetadata(column);

        expect({ column: column, hidden: true, computed: true }).toEqual({
          column: column,
          hidden: metadata.hideColumnInDocumentation,
          computed: metadata.computed,
        });
      }
    });

    it("sends the added-pages request under the miscDataProps key the server reads", () => {
      for (const language of ALL_LANGUAGES) {
        expect(readPage(GUIDE_PAGE, language)).toContain(
          `"miscDataProps": {"${IncidentScopeAddedPagesNotification.miscDataKey}": true}`,
        );
      }
    });

    it("sends the resend-to-every-page request under the miscDataProps key the server reads", () => {
      for (const language of ALL_LANGUAGES) {
        expect(readPage(GUIDE_PAGE, language)).toContain(
          `"miscDataProps": {"${IncidentCreatedResend.miscDataKey}": true}`,
        );
      }
    });

    it("names the resend controls as the dashboard labels them", () => {
      for (const language of ALL_LANGUAGES) {
        const names: Set<string> = boldText(readPage(GUIDE_PAGE, language));

        expect(
          names.has(
            SubscriberNotificationResendCopy.incidentCreatedRetryToAllStatusPagesLabel,
          ),
        ).toBe(true);
        expect(
          names.has(
            SubscriberNotificationResendCopy.resendToAllStatusPagesButton,
          ),
        ).toBe(true);
        expect(names.has(SubscriberNotificationResendCopy.resendButton)).toBe(
          true,
        );

        const notes: Set<string> = boldText(
          readPage("incidents/notes-owners-and-feed", language),
        );

        expect(
          notes.has(
            SubscriberNotificationResendCopy.resendNoteNotificationButton,
          ),
        ).toBe(true);
        expect(
          notes.has(
            SubscriberNotificationResendCopy.retryNoteNotificationButton,
          ),
        ).toBe(true);
      }
    });

    it("sends the publish request under the miscDataProps key the server reads", () => {
      for (const language of ALL_LANGUAGES) {
        expect(readPage("incidents/declaring-incidents", language)).toContain(
          `"miscDataProps": {"${IncidentCreatedRenotify.miscDataKey}": true}`,
        );

        const names: Set<string> = boldText(
          readPage("incidents/declaring-incidents", language),
        );

        expect(names.has(IncidentCreatedRenotify.formFieldTitle)).toBe(true);
        expect(
          names.has(IncidentCreatedRenotify.hiddenFromStatusPagesLabel),
        ).toBe(true);
      }
    });

    it("calls the audience endpoint on its real route, with its real channel names", () => {
      const route: string = `/api${IncidentSubscriberAudience.apiPath}`;
      const channels: Array<string> = Object.keys(
        IncidentSubscriberAudience.getEmptyCounts(),
      );
      const answer: string = JSON.stringify(
        IncidentSubscriberAudience.toJSON({
          hasMonitors: true,
          isScoped: true,
          isHiddenFromStatusPages: false,
          statusPages: [],
          hiddenStatusPageCount: 0,
          excludedStatusPages: [],
          selectedStatusPagesNotListingMonitors: [],
        }),
      );

      expect(answer).toContain('"hiddenStatusPageCount"');

      for (const language of ALL_LANGUAGES) {
        const guide: string = readPage(GUIDE_PAGE, language);
        const code: Set<string> = inlineCode(guide);
        const curl: string | undefined = splitMarkdown(guide).codeBlocks.find(
          (block: string): boolean => {
            return block.includes(route);
          },
        );

        expect(curl).toBeDefined();
        expect(curl).toContain(`https://oneuptime.com${route}`);
        expect(curl).toContain('"monitorIds"');
        expect(curl).toContain('"statusPageIds"');
        expect(guide).toContain('{"incidentId": "<incident-id>"}');
        expect(code.has("hiddenStatusPageCount")).toBe(true);

        for (const channel of channels) {
          expect({
            language: language,
            channel: channel,
            quoted: true,
          }).toEqual({
            language: language,
            channel: channel,
            quoted: code.has(channel),
          });
        }
      }
    });

    it("documents the request keys the audience endpoint parses", () => {
      const source: string = fs.readFileSync(
        path.join(REPO_ROOT, "Common/Server/API/IncidentAPI.ts"),
        "utf8",
      );

      for (const key of ["incidentId", "monitorIds", "statusPageIds"]) {
        expect(source).toContain(`body["${key}"]`);
      }
    });
  });

  describe("claims", () => {
    it("says incident roles cannot read status pages and Status Page Viewer can", () => {
      const readers: Array<Permission> = new StatusPage().getReadPermissions();

      expect(readers).toContain(Permission.StatusPageViewer);

      for (const incidentRole of [
        Permission.IncidentAdmin,
        Permission.IncidentMember,
        Permission.IncidentViewer,
      ]) {
        expect({ role: incidentRole, reads: false }).toEqual({
          role: incidentRole,
          reads: readers.includes(incidentRole),
        });
      }

      for (const language of ALL_LANGUAGES) {
        expect(
          boldText(readPage(GUIDE_PAGE, language)).has(
            PermissionHelper.getTitle(Permission.StatusPageViewer),
          ),
        ).toBe(true);
      }
    });

    it("lets the roles that declare, edit or post a public note see the audience", () => {
      /*
       * IncidentAPI's SUBSCRIBER_AUDIENCE_PERMISSIONS is the builder's list,
       * which the notification preview checks against too.
       */
      const api: string = fs.readFileSync(
        path.join(REPO_ROOT, "Common/Server/API/IncidentAPI.ts"),
        "utf8",
      );
      expect(api).toMatch(
        /SUBSCRIBER_AUDIENCE_PERMISSIONS[^=]*=\s*IncidentSubscriberAudienceBuilder\.PERMISSIONS;/,
      );

      const source: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "Common/Server/Utils/StatusPage/IncidentSubscriberAudienceBuilder.ts",
        ),
        "utf8",
      );
      const list: string =
        source.match(/PERMISSIONS[^=]*=\s*\[([\s\S]*?)\];/)?.[1] || "";

      for (const permission of [
        "CreateProjectIncident",
        "EditProjectIncident",
        "CreateIncidentPublicNote",
      ]) {
        expect(list).toContain(`Permission.${permission}`);
      }
    });

    it("contrasts incidents with scheduled maintenance's own Status Pages list", () => {
      expect(
        new ScheduledMaintenance().getTableColumnMetadata("statusPages").title,
      ).toBe("Status Pages");

      for (const language of ALL_LANGUAGES) {
        expect(
          boldText(readPage(GUIDE_PAGE, language)).has("Status Pages"),
        ).toBe(true);
      }
    });

    it("names the per-send feed entry as the incident feed labels it", () => {
      const label: string = getFeedEventTypeLabel(
        IncidentFeedEventType.SubscriberNotificationSent,
      );

      for (const language of ALL_LANGUAGES) {
        const names: Set<string> = boldText(readPage(GUIDE_PAGE, language));

        expect(names.has(label)).toBe(true);
        expect(names.has("More Information")).toBe(true);
      }
    });

    it("lists the status page field on the declare page's template table, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const rows: Array<string> = readPage(
          "incidents/declaring-incidents",
          language,
        )
          .split("\n")
          .filter((line: string): boolean => {
            return line.startsWith(
              `| **${IncidentStatusPageScopeCopy.pickerTitle}**`,
            );
          });

        expect({ language: language, rows: rows.length }).toEqual({
          language: language,
          rows: 1,
        });
      }
    });

    it("documents the scoped-only switch next to the other incident switches, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const overview: string = readPage("status-pages/index", language);

        expect(overview).toContain(
          `**${IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle}** (\`onlyShowScopedIncidents\`)`,
        );

        // Listed right after the other incident switch on the same card.
        const lines: Array<string> = overview.split("\n");
        const labelsLine: number = lines.findIndex((line: string): boolean => {
          return line.includes("(`showIncidentLabelsOnStatusPage`)");
        });

        expect(lines[labelsLine + 1]).toContain("(`onlyShowScopedIncidents`)");
      }
    });
  });
});
