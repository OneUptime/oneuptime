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
import StatusPageDisplaySettingsCopy, {
  DISPLAY_SECTIONS,
  DisplaySectionDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
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
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { scanMarkdown } from "./DocsContentSupport";
import {
  dashboardLabel,
  dashboardLocale,
  drawnActionLabel,
} from "./DocsDashboardLabels";
import { PATH_SEPARATOR } from "./DocsPageShape";
import { comparableFence } from "./DocsTranslationChecks";
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
 * to status pages; or when a translated guide falls behind the English one.
 * Each test reads the source of truth - the nav and its translations, the
 * shared copy constants the dashboard renders, the models, the side menus and
 * the API - and checks the shipped pages still tell the same story.
 *
 * Every language names the Dashboard as that language's Dashboard draws it:
 * the guide and the status page overview with drawnActionLabel, Persian
 * included, as StatusPageDocsTranslations holds them; the incident pages with
 * dashboardLabel, which keeps Persian in English, as IncidentDocsTranslations
 * holds them (DocsDashboardLabels).
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

// Every docs language ships the guide, in its own words.
const TRANSLATED_LANGUAGES: ReadonlyArray<string> =
  SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
    return language !== DEFAULT_DOCS_LANGUAGE;
  });
const ALL_LANGUAGES: ReadonlyArray<string> = [
  DEFAULT_DOCS_LANGUAGE,
  ...TRANSLATED_LANGUAGES,
];

/*
 * The letters of the languages that are not written in Latin letters: every
 * sentence of such a translation has one. A sentence of a translation in
 * Latin letters is told from an English leftover by differing from the
 * English sentence on its line instead.
 */
const SCRIPT_LETTERS: Readonly<Record<string, RegExp>> = {
  fa: /[؀-ۿ]/,
  hi: /[ऀ-ॿ]/,
  ja: /[぀-ヿ一-鿿]/,
  ko: /[가-힯]/,
  ru: /[Ѐ-ӿ]/,
  "zh-CN": /[一-鿿]/,
  "zh-TW": /[一-鿿]/,
};

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
// The heading that starts each step of the guide's :::steps block.
const STEP_HEADING: RegExp = /^### /;
const LATIN_LETTER: RegExp = /[A-Za-z]/;
// A table row, the quoted summary, a component's line or a tab: not a sentence.
const NOT_A_SENTENCE: RegExp = /^(?:\||>|:::|@tab\b)/;

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

type DrawnFunction = (language: string, english: string) => string;

/*
 * A string the Dashboard looks up whole, by its English text, before it
 * fills its placeholders (SubscriberAudienceText's `translate`): the locale's
 * wording, or the English where the locale has none.
 */
const lookedUp: DrawnFunction = (language: string, english: string): string => {
  const value: unknown = dashboardLocale(language)[english];

  return typeof value === "string" && value.trim() ? value : english;
};

type MenuPathFunction = (
  language: string,
  segments: ReadonlyArray<string>,
  draw?: DrawnFunction,
) => string;

// A menu path as a page in this language writes it: each label drawn, one bold span.
const menuPath: MenuPathFunction = (
  language: string,
  segments: ReadonlyArray<string>,
  draw: DrawnFunction = drawnActionLabel,
): string => {
  return `**${segments
    .map((segment: string): string => {
      return draw(language, segment);
    })
    .join(PATH_SEPARATOR)}**`;
};

type EscapeRegexFunction = (text: string) => string;

const escapeRegex: EscapeRegexFunction = (text: string): string => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

type StepsOfFunction = (markdown: string) => Array<string>;

// Each step of the page's :::steps block: its heading and the text under it.
const stepsOf: StepsOfFunction = (markdown: string): Array<string> => {
  const steps: Array<string> = [];
  let inSteps: boolean = false;

  for (const line of splitMarkdown(markdown).prose) {
    if (line.trim() === ":::steps") {
      inSteps = true;
      continue;
    }

    if (!inSteps) {
      continue;
    }

    if (line.trim() === ":::") {
      break;
    }

    if (STEP_HEADING.test(line)) {
      steps.push(line);
    } else if (steps.length > 0) {
      steps[steps.length - 1] += `\n${line}`;
    }
  }

  return steps;
};

type HiddenPagesQuotesFunction = (language: string) => Array<string>;

/*
 * The "more status pages you do not have access to" count, as a page quotes
 * it: the Dashboard's words with the number left out, or written "…" where
 * the language puts it inside the phrase.
 */
const hiddenPagesQuotes: HiddenPagesQuotesFunction = (
  language: string,
): Array<string> => {
  const words: string = lookedUp(
    language,
    IncidentStatusPageScopeCopy.audienceHiddenPages,
  );

  return [
    words.replace(/\s*\{\{number\}\}\s*/, " ").trim(),
    words.replace("{{number}}", "…"),
  ];
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
      const english: Array<string> = readPage(GUIDE_PAGE).split("\n");

      for (const language of TRANSLATED_LANGUAGES) {
        expect(fs.existsSync(pageFile(language, GUIDE_PAGE))).toBe(true);

        const translated: string = readPage(GUIDE_PAGE, language);
        const lines: Array<string> = translated.split("\n");
        const letters: RegExp | undefined = SCRIPT_LETTERS[language];

        // Line for line beside the English page (StatusPageDocsTranslations).
        expect(lines).toHaveLength(english.length);
        expect(titleOf(translated)).not.toBe(GUIDE_TITLE);

        /*
         * Every sentence is in the reader's language, not an English
         * leftover: its line differs from the English page's, and in a
         * language with letters of its own, it has some. Code, tables, the
         * quoted summary and the lines of components are not sentences.
         */
        const leftovers: Array<string> = [];
        let inFence: boolean = false;

        lines.forEach((line: string, index: number): void => {
          if (FENCE_LINE.test(line)) {
            inFence = !inFence;
            return;
          }

          const text: string = line.trim();
          const englishText: string = (english[index] || "").trim();

          if (
            inFence ||
            !LATIN_LETTER.test(englishText) ||
            NOT_A_SENTENCE.test(text)
          ) {
            return;
          }

          if (
            text === englishText ||
            (letters !== undefined && !letters.test(text))
          ) {
            leftovers.push(text);
          }
        });

        expect({ language: language, leftovers: leftovers }).toEqual({
          language: language,
          leftovers: [],
        });
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

    it("keeps every code identifier and code block intact, and builds the diagram the same way", () => {
      const english: string = readPage(GUIDE_PAGE);
      const englishFences: Array<string> =
        scanMarkdown(english).fences.map(comparableFence);

      expect(englishFences.length).toBeGreaterThan(1);

      for (const language of TRANSLATED_LANGUAGES) {
        const translated: string = readPage(GUIDE_PAGE, language);

        expect(Array.from(inlineCode(translated)).sort()).toEqual(
          Array.from(inlineCode(english)).sort(),
        );

        // Code exactly; the diagram by its nodes and arrows, its labels translated.
        expect({
          language: language,
          fences: scanMarkdown(translated).fences.map(comparableFence),
        }).toEqual({ language: language, fences: englishFences });
      }
    });

    it("leaves in English only on-screen names the English page quotes too", () => {
      const english: Set<string> = boldText(readPage(GUIDE_PAGE));

      for (const language of Object.keys(SCRIPT_LETTERS)) {
        /*
         * A translation names the screen as its Dashboard draws it, and the
         * Dashboard draws some names in English: a product name, or a label
         * its locale has no wording for. So a bold span with none of the
         * language's letters must be one the English page quotes: a typo in
         * a button name, or one the English page has since renamed, fails
         * here. (In a language written in Latin letters an English name
         * cannot be told apart by its letters; StatusPageDocsTranslations
         * holds every language's names to its Dashboard.)
         */
        const letters: RegExp = SCRIPT_LETTERS[language] as RegExp;
        const untranslated: Array<string> = Array.from(
          boldText(readPage(GUIDE_PAGE, language)),
        ).filter((name: string): boolean => {
          return !letters.test(name);
        });

        expect(untranslated.length).toBeGreaterThan(0);

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
          const drawn: string = drawnActionLabel(language, name);

          expect({ language: language, drawn: drawn, quoted: true }).toEqual({
            language: language,
            drawn: drawn,
            quoted: names.has(drawn),
          });
        }
      }
    });

    it("has every screen name in the Dashboard's locale, so every language draws it", () => {
      for (const name of SCREEN_NAMES) {
        expect({ name: name, inLocale: true }).toEqual({
          name: name,
          inLocale: typeof dashboardLocale("en")[name] === "string",
        });
      }
    });

    it("titles the scoped-only switch like the StatusPage column behind it", () => {
      expect(
        new StatusPage().getTableColumnMetadata("onlyShowScopedIncidents")
          .title,
      ).toBe(IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle);
    });

    it("quotes the audience summary in the form the dashboard builds it, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        /*
         * The headline, then one list item per page, each string looked up
         * in the language before its placeholders are filled in
         * (SubscriberAudienceText).
         */
        const pageLine: (name: string, emails: number) => string = (
          name: string,
          emails: number,
        ): string => {
          return formatScopeText(
            lookedUp(
              language,
              IncidentStatusPageScopeCopy.audiencePageWithCounts,
            ),
            {
              name: name,
              counts: formatScopeText(
                lookedUp(
                  language,
                  IncidentStatusPageScopeCopy.audienceEmailCount,
                ),
                { number: emails },
              ),
            },
          );
        };

        const example: string = [
          `> ${lookedUp(language, IncidentStatusPageScopeCopy.audienceWillNotify)}`,
          ">",
          `> - ${pageLine("Site 03", 41)}`,
          `> - ${pageLine("Site 07", 18)}`,
        ].join("\n");
        const guide: string = readPage(GUIDE_PAGE, language);

        expect({
          language: language,
          example: guide.includes(example),
        }).toEqual({ language: language, example: true });
        expect(
          boldText(guide).has(
            lookedUp(language, IncidentStatusPageScopeCopy.audienceNotNotified),
          ),
        ).toBe(true);

        /*
         * The "more status pages you do not have access to" wording, too, in
         * both places the guide quotes it.
         */
        const quoted: number = Math.max(
          ...hiddenPagesQuotes(language).map((quote: string): number => {
            return guide.toLowerCase().split(quote.toLowerCase()).length - 1;
          }),
        );

        expect({ language: language, quoted: quoted }).toEqual({
          language: language,
          quoted: 2,
        });
      }
    });

    it("reads the summary's words from the Dashboard's locale, so every language draws them", () => {
      for (const english of [
        IncidentStatusPageScopeCopy.audienceWillNotify,
        IncidentStatusPageScopeCopy.audiencePageWithCounts,
        IncidentStatusPageScopeCopy.audienceEmailCount,
        IncidentStatusPageScopeCopy.audienceNotNotified,
        IncidentStatusPageScopeCopy.audienceHiddenPages,
      ]) {
        expect(dashboardLocale("en")[english]).toBe(english);
      }

      // The English quote is the Dashboard's with the number left out.
      expect(hiddenPagesQuotes("en")[0]).toBe(
        "more status pages you do not have access to",
      );
      expect(hiddenPagesQuotes("ja")[1]).toContain("…");
    });

    /*
     * "No status page subscribers will be notified: no monitors are
     * attached" is gone from under Notify Status Page Subscribers. The
     * summary shows nothing when nobody will be told, and warns only when
     * the status page scope is why; picking pages with no monitor is warned
     * about under the picker. The guides must not promise the old notices.
     */
    it("says the summary shows nothing when nobody will be told, and warns only about the status page scope", () => {
      const english: string = readPage(GUIDE_PAGE);

      expect(english).toContain(
        "When nobody will be told, the summary shows nothing: the incident has no monitors, no status page lists them, the pages have no subscribers yet, **Notify Status Page Subscribers** is off, or the incident is private.",
      );
      expect(english).toContain(
        "It warns only when the status page scope is the reason, and names the pages it leaves out",
      );
      expect(english).toContain(
        "- when a picked page lists none of the incident's monitors, or no monitor is attached at all.",
      );
      expect(english).toContain(
        "**Notify Status Page Subscribers** reads **Yes** or **No** like every other box",
      );
      expect(english).toContain(
        "Both confirmations list the pages it would reach now, or say that it would reach nobody;",
      );
      expect(english).not.toContain(
        "When nothing will be sent at all, it says why instead",
      );

      const persian: string = readPage(GUIDE_PAGE, "fa");

      expect(persian).toContain(
        "وقتی کسی خبردار نخواهد شد، خلاصه چیزی نشان نمی‌دهد",
      );
      expect(persian).toContain("یا اصلاً هیچ مانیتوری پیوست نشده باشد");
      expect(persian).toContain("یا می‌گویند که به هیچ‌کس نمی‌رسد");
      expect(persian).not.toContain(
        "وقتی اصلاً چیزی فرستاده نخواهد شد، به‌جایش دلیل را می‌گوید",
      );

      for (const language of ALL_LANGUAGES) {
        for (const page of [
          GUIDE_PAGE,
          "incidents/declaring-incidents",
          "incidents/notes-owners-and-feed",
        ]) {
          expect(readPage(page, language)).not.toMatch(
            /no monitors are attached/i,
          );
        }
      }
    });

    it("says the same on the declaring and notes pages, in every language", () => {
      expect(readPage("incidents/declaring-incidents")).toContain(
        "When nobody will be told (no monitor is attached, no status page lists the monitors, or the pages have no subscribers yet) it shows nothing, and it warns only when the incident's status page scope is the reason.",
      );
      expect(readPage("incidents/declaring-incidents", "fa")).toContain(
        "وقتی کسی خبردار نخواهد شد (هیچ مانیتوری پیوست نشده",
      );
      expect(readPage("incidents/notes-owners-and-feed")).toContain(
        "When nobody will be told it shows nothing, unless the incident is hidden from status pages or its status page scope is the reason.",
      );
      expect(readPage("incidents/notes-owners-and-feed", "fa")).toContain(
        "وقتی کسی خبردار نخواهد شد چیزی نشان نمی‌دهد",
      );
    });

    /*
     * The More step went: the notify box, and the audience under it, sit
     * right below the picker on Resources Affected, and Private Incident and
     * Change Monitor Status to are folded under More fields on their steps.
     */
    it("puts the picker and the notify box with its audience on the declare form's Resources Affected step", () => {
      const source: string = readDashboardSource("Pages/Incidents/Create.tsx");

      expect(source).toMatch(
        /statusPages:\s*true,\s*},\s*title:\s*IncidentStatusPageScopeCopy\.pickerTitle,\s*stepId:\s*"resources-affected"/,
      );
      expect(source).toMatch(
        /title:\s*"Resources Affected",\s*id:\s*"resources-affected"/,
      );
      expect(source).toMatch(
        /title:\s*"Notify Status Page Subscribers",\s*stepId:\s*"resources-affected"/,
      );
      expect(source).not.toMatch(/id:\s*"more"/);
      expect(source).toContain("SubscriberAudienceSummary");

      for (const language of ALL_LANGUAGES) {
        const guide: string = readPage(GUIDE_PAGE, language);
        const names: Set<string> = boldText(guide);

        expect(guide).toContain(
          menuPath(language, [
            "Incidents",
            "All Incidents",
            "Declare Incident",
          ]),
        );

        for (const name of [
          "Resources Affected",
          "Incident Details",
          MORE_FIELDS_SECTION_TITLE,
          "Labels",
          "Change Monitor Status to",
          "Private Incident",
          "Notify Status Page Subscribers",
          "Create from Template",
          "Public Notes",
        ]) {
          const drawn: string = drawnActionLabel(language, name);

          expect({ language: language, drawn: drawn, quoted: true }).toEqual({
            language: language,
            drawn: drawn,
            quoted: names.has(drawn),
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
        const draw: (english: string) => string = (english: string): string => {
          return escapeRegex(drawnActionLabel(language, english));
        };

        expect(guide).toContain(menuPath(language, ["Advanced", "Settings"]));
        expect(guide).toContain(
          menuPath(language, ["Resources", "Monitor Rules"]),
        );
        expect({
          language: language,
          // The status page's own name is the reader's word for "your page".
          found: new RegExp(
            `\\*\\*${draw("Status Pages")}${PATH_SEPARATOR}[^*→\\n]+${PATH_SEPARATOR}${draw("Advanced")}${PATH_SEPARATOR}${draw("Advanced Settings")}\\*\\*`,
          ).test(guide),
        }).toEqual({ language: language, found: true });
      }
    });

    /*
     * Advanced Settings is one "What your status page shows" card now, with
     * no Edit button: the scoped-only switch is in its incidents row, under
     * Show Incidents, and saves as it is flipped.
     */
    it("finds the scoped-only switch in the What your status page shows card of Advanced Settings, under Show Incidents", () => {
      expect(
        readDashboardSource("Pages/StatusPages/View/StatusPageSettings.tsx"),
      ).toContain("<StatusPageDisplaySettingsCard statusPageId={modelId} />");

      const incidents: DisplaySectionDefinition = DISPLAY_SECTIONS.find(
        (section: DisplaySectionDefinition) => {
          return section.id === "incidents";
        },
      )!;

      expect(incidents.show?.title).toBe("Show Incidents");
      expect(
        incidents.options.map((option: { title: string }) => {
          return option.title;
        }),
      ).toContain(IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle);

      const englishSteps: Array<string> = stepsOf(readPage(GUIDE_PAGE));

      expect(englishSteps[2]).toMatch(
        /^### Turn on Only Show Incidents Scoped to This Page\n/,
      );

      for (const language of ALL_LANGUAGES) {
        const guide: string = readPage(GUIDE_PAGE, language);
        const names: Set<string> = boldText(guide);
        const cardTitle: string = drawnActionLabel(
          language,
          StatusPageDisplaySettingsCopy.cardTitle,
        );

        expect(names.has(cardTitle)).toBe(true);
        expect(names.has(drawnActionLabel(language, "Show Incidents"))).toBe(
          true,
        );

        // The third step turns the switch on, and sends nobody through an Edit dialog.
        const steps: Array<string> = stepsOf(guide);
        const step: string = steps[2] || "";

        expect(steps).toHaveLength(englishSteps.length);
        expect(step).toContain(`**${cardTitle}**`);
        expect(step).not.toContain("Edit Settings");
        expect(step).not.toContain(drawnActionLabel(language, "Edit Settings"));
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

        expect(names.has(drawnActionLabel(language, "Add in Bulk"))).toBe(true);
        expect(names.has(drawnActionLabel(language, "Email Subscribers"))).toBe(
          true,
        );
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

        for (const label of [
          SubscriberNotificationResendCopy.incidentCreatedRetryToAllStatusPagesLabel,
          SubscriberNotificationResendCopy.resendToAllStatusPagesButton,
          SubscriberNotificationResendCopy.resendButton,
        ]) {
          const drawn: string = drawnActionLabel(language, label);

          expect({ language: language, drawn: drawn, quoted: true }).toEqual({
            language: language,
            drawn: drawn,
            quoted: names.has(drawn),
          });
        }

        const notes: Set<string> = boldText(
          readPage("incidents/notes-owners-and-feed", language),
        );

        for (const label of [
          SubscriberNotificationResendCopy.resendNoteNotificationButton,
          SubscriberNotificationResendCopy.retryNoteNotificationButton,
        ]) {
          const named: string = dashboardLabel(language, label);

          expect({ language: language, named: named, quoted: true }).toEqual({
            language: language,
            named: named,
            quoted: notes.has(named),
          });
        }
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

        for (const label of [
          IncidentCreatedRenotify.formFieldTitle,
          IncidentCreatedRenotify.hiddenFromStatusPagesLabel,
        ]) {
          const named: string = dashboardLabel(language, label);

          expect({ language: language, named: named, quoted: true }).toEqual({
            language: language,
            named: named,
            quoted: names.has(named),
          });
        }
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

    /*
     * The dashboard no longer explains an empty status page picker (its "No
     * status pages to pick from ... Ask a project admin." banner was removed
     * at the maintainer's request), so the guide must not say it does. It is
     * where the explanation lives now.
     */
    it("says an empty picker means no read access, without promising the picker says so", () => {
      expect(Object.keys(IncidentStatusPageScopeCopy)).not.toContain(
        "pickerNoAccessHint",
      );

      const english: string = readPage(GUIDE_PAGE, "en");

      expect(english.split("Without it the picker is empty").length - 1).toBe(
        2,
      );
      expect(english).not.toContain("and says why");
      expect(english).not.toContain("The picker says so");

      const persian: string = readPage(GUIDE_PAGE, "fa");

      expect(persian.split("بدون آن انتخابگر خالی است").length - 1).toBe(2);
      expect(persian).not.toContain("و می‌گوید چرا");
      expect(persian).not.toContain(
        "وقتی انتخابگر چیزی برای فهرست کردن نداشته باشد",
      );
    });

    it("lets the roles that declare, edit or post a public note see the audience", () => {
      /*
       * IncidentSubscriberAudienceBuilder.PERMISSIONS is what the audience
       * endpoint and the notification preview both check against.
       */
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
          boldText(readPage(GUIDE_PAGE, language)).has(
            drawnActionLabel(language, "Status Pages"),
          ),
        ).toBe(true);
      }
    });

    it("names the per-send feed entry as the incident feed labels it", () => {
      const label: string = getFeedEventTypeLabel(
        IncidentFeedEventType.SubscriberNotificationSent,
      );

      for (const language of ALL_LANGUAGES) {
        const names: Set<string> = boldText(readPage(GUIDE_PAGE, language));

        expect(names.has(drawnActionLabel(language, label))).toBe(true);
        expect(names.has(drawnActionLabel(language, "More Information"))).toBe(
          true,
        );
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
              `| **${dashboardLabel(language, IncidentStatusPageScopeCopy.pickerTitle)}**`,
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

        // The switch's name, then its column in parentheses, full-width ones in CJK.
        const switchName: string = escapeRegex(
          drawnActionLabel(
            language,
            IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle,
          ),
        );

        expect({
          language: language,
          named: new RegExp(
            `\\*\\*${switchName}\\*\\* ?[(（]\`onlyShowScopedIncidents\`[)）]`,
          ).test(overview),
        }).toEqual({ language: language, named: true });

        // Listed right after the other incident switch on the same card.
        const lines: Array<string> = overview.split("\n");
        const labelsLine: number = lines.findIndex((line: string): boolean => {
          return line.includes("`showIncidentLabelsOnStatusPage`");
        });

        expect(labelsLine).toBeGreaterThan(0);
        expect(lines[labelsLine + 1]).toContain("`onlyShowScopedIncidents`");
      }
    });
  });
});
