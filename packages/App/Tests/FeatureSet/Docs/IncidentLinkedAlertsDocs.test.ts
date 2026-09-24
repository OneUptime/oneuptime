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
import Alert from "Common/Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentAlert from "Common/Models/DatabaseModels/IncidentAlert";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import Project from "Common/Models/DatabaseModels/Project";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { UniqueColumnsTogetherMetadata } from "Common/Types/Database/UniqueColumnsTogether";
import {
  INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
  MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
} from "Common/Types/Incident/IncidentAlertLink";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import {
  FEED_OPTIONS_TEXT,
  getFeedEventTypeLabel,
} from "Common/UI/Components/Feed/FeedOptions";
import { INCIDENT_PREFILL_RESOURCE_KEYS } from "Common/Utils/Incident/IncidentFromAlerts";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident docs against the alert linking feature they describe.
 *
 * Markdown is not compiled, so nothing else notices when the side menus
 * rename the Linked Alerts / Linked Incidents pages or their buttons, the
 * link cap or the miscDataProps key changes, a role gains or loses the
 * Incident Alert permissions or read access to the other side, a project
 * switch is renamed, a feed event type is added without the feed page
 * listing it, the declare prefill carries a new kind of resource, or the
 * Persian pages fall behind the English ones. Each test reads the source of
 * truth - the nav and its translations, the side menus and link pages, the
 * shared constants, the model's access lists, the Project columns, the feed
 * enums and entry wording - and checks the shipped pages still tell the same
 * story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const LOCALES_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Locales");

// The dashboard's two link pages, the alerts table's bulk actions and the link dialog they share.
const INCIDENT_LINKED_ALERTS_PAGE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/View/Alerts.tsx",
);
const ALERT_LINKED_INCIDENTS_PAGE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Alerts/View/Incidents.tsx",
);
const BULK_LINK_ACTIONS_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/Alert/BulkIncidentLinkActions.tsx",
);
const LINK_HELPERS_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/IncidentAlert/IncidentAlertLink.ts",
);
const LINK_DIALOG_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/IncidentAlert/LinkIncidentAlertModal.tsx",
);

// Writes the link feed entries and the one "Declared from N alerts" entry.
const INCIDENT_ALERT_SERVICE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Services/IncidentAlertService.ts",
);

const INCIDENT_SIDE_MENU_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/View/SideMenu.tsx",
);
const ALERT_SIDE_MENU_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Alerts/View/SideMenu.tsx",
);
const INCIDENTS_SIDE_MENU_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/SideMenu.tsx",
);
const INCIDENT_MORE_SETTINGS_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentMoreSettings.tsx",
);

// Where both pages tell readers to find the switches.
const MORE_SETTINGS_PATH: string = "**Incidents → Settings → More Settings**";

const NAV_GROUP_TITLE: string = "Incidents";

const OVERVIEW_PAGE: string = "incidents/index";
const DECLARING_PAGE: string = "incidents/declaring-incidents";
const FEED_PAGE: string = "incidents/notes-owners-and-feed";
const LINKED_ALERTS_PAGE: string = "incidents/linked-alerts";
const SETTINGS_PAGE: string = "incidents/settings";

const LINKED_ALERTS_TITLE: string = "Linked Alerts";
const LINKED_ALERTS_URL: string = `/docs/${LINKED_ALERTS_PAGE}`;

interface ExpectedPage {
  title: string;
  page: string;
}

/*
 * Reading order: what an incident is, how one starts, how it moves, what gets
 * written on it, which alerts belong to it, then how to configure it all.
 */
const EXPECTED_PAGES: ReadonlyArray<ExpectedPage> = [
  { title: "Incidents Overview", page: OVERVIEW_PAGE },
  { title: "Declaring an Incident", page: DECLARING_PAGE },
  {
    title: "Incident States & Severities",
    page: "incidents/states-and-severities",
  },
  { title: "Incident Notes, Owners & Feed", page: FEED_PAGE },
  { title: LINKED_ALERTS_TITLE, page: LINKED_ALERTS_PAGE },
  { title: "Incident Settings & Automation", page: SETTINGS_PAGE },
];

// The existing incident pages that must point readers at the new one.
const PAGES_THAT_LINK_TO_LINKED_ALERTS: ReadonlyArray<string> = [
  OVERVIEW_PAGE,
  DECLARING_PAGE,
  FEED_PAGE,
  SETTINGS_PAGE,
];

/*
 * Every language directory that ships the incident pages. `fa` is the only
 * translated corpus (every other language falls back to English per page at
 * request time), so a new translation only has to be added here.
 */
const TRANSLATED_LANGUAGES: ReadonlyArray<string> = ["fa"];
const ALL_LANGUAGES: ReadonlyArray<string> = ["en", ...TRANSLATED_LANGUAGES];

const LINK_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.CreateIncidentAlert,
  Permission.ReadIncidentAlert,
  Permission.EditIncidentAlert,
  Permission.DeleteIncidentAlert,
];

const LINK_SWITCH_COLUMNS: ReadonlyArray<string> = [
  "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
  "resolveLinkedAlertsWhenIncidentResolved",
];

const LINK_FEED_EVENT_TYPES: ReadonlyArray<string> = [
  IncidentFeedEventType.AlertLinked,
  IncidentFeedEventType.AlertUnlinked,
  AlertFeedEventType.LinkedToIncident,
  AlertFeedEventType.UnlinkedFromIncident,
];

/*
 * How the Resources Affected row names each resource list the declare prefill
 * copies from the alerts (INCIDENT_PREFILL_RESOURCE_KEYS), after "monitor".
 * A key missing here fails the prefill test until the docs name it too.
 */
const PREFILL_RESOURCE_NAMES: Record<string, string> = {
  hosts: "host",
  kubernetesClusters: "Kubernetes cluster",
  dockerHosts: "Docker host",
  podmanHosts: "Podman host",
  services: "service",
};

// How each language refers to the bulk unlink action, given its verb.
const BULK_ACTION_PHRASE: Record<string, (verb: string) => string> = {
  en: (verb: string): string => {
    return `bulk **${verb}** action`;
  },
  fa: (verb: string): string => {
    return `کنش انبوه **${verb}**`;
  },
};

// The word each language uses for an incident's owners.
const OWNERS_WORD: Record<string, string> = {
  en: "owners",
  fa: "مالکان",
};

const FENCE_LINE: RegExp = /^\s*```/;
// An H2 or H3 heading: the ones in-page links point at.
const SECTION_HEADING: RegExp = /^#{2,3} /;
// A link dialog option as the docs show one, such as "ALT-63: Checkout API is offline".
const OPTION_LABEL_EXAMPLE: RegExp = /^[A-Z]+-\d+: \S/;
// Arabic-script letters, which every Persian sentence contains.
const PERSIAN_LETTER: RegExp = /[؀-ۿ]/;
const PERSIAN_DIGITS: ReadonlyArray<string> = [
  "۰",
  "۱",
  "۲",
  "۳",
  "۴",
  "۵",
  "۶",
  "۷",
  "۸",
  "۹",
];

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

type SplitMarkdownFunction = (markdown: string) => {
  prose: Array<string>;
  codeBlocks: Array<string>;
};

// Prose lines and fenced code blocks, kept apart so headings and inline code are never read out of a fence.
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

type HeadingCountsFunction = (markdown: string) => {
  h2: number;
  h3: number;
};

const headingCounts: HeadingCountsFunction = (
  markdown: string,
): { h2: number; h3: number } => {
  const prose: Array<string> = splitMarkdown(markdown).prose;

  return {
    h2: prose.filter((line: string): boolean => {
      return line.startsWith("## ");
    }).length,
    h3: prose.filter((line: string): boolean => {
      return line.startsWith("### ");
    }).length,
  };
};

type TitleOfFunction = (markdown: string) => string;

const titleOf: TitleOfFunction = (markdown: string): string => {
  const firstLine: string = markdown.split("\n")[0] || "";

  expect(firstLine.startsWith("# ")).toBe(true);

  return firstLine.slice(2).trim();
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

type IncidentsGroupFunction = () => NavGroup;

const incidentsGroup: IncidentsGroupFunction = (): NavGroup => {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === NAV_GROUP_TITLE;
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
};

type EscapeRegExpFunction = (text: string) => string;

const escapeRegExp: EscapeRegExpFunction = (text: string): string => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

type TableRowStartingWithFunction = (
  markdown: string,
  firstCell: string,
) => string | undefined;

const tableRowStartingWith: TableRowStartingWithFunction = (
  markdown: string,
  firstCell: string,
): string | undefined => {
  return markdown.split("\n").find((line: string): boolean => {
    return new RegExp(`^\\|\\s*${escapeRegExp(firstCell)}\\s*\\|`).test(line);
  });
};

type TableCellsFunction = (row: string) => Array<string>;

// The cells of a markdown table row, trimmed, without the empty outer ones.
const tableCells: TableCellsFunction = (row: string): Array<string> => {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
};

type ToPersianDigitsFunction = (value: number) => string;

const toPersianDigits: ToPersianDigitsFunction = (value: number): string => {
  return value
    .toString()
    .split("")
    .map((digit: string): string => {
      return PERSIAN_DIGITS[Number(digit)] as string;
    })
    .join("");
};

interface SideMenuPage {
  section: string;
  title: string;
}

type SideMenuPagesFunction = (file: string) => Array<SideMenuPage>;

/*
 * Every side-menu link title with the section it sits in, read from source:
 * the menus are React components that a plain-node test must not import.
 */
const sideMenuPages: SideMenuPagesFunction = (
  file: string,
): Array<SideMenuPage> => {
  const source: string = fs.readFileSync(file, "utf8");
  const pages: Array<SideMenuPage> = [];

  for (const chunk of source.split(/<SideMenuSection\s+title="/).slice(1)) {
    const section: string = chunk.slice(0, chunk.indexOf('"'));

    for (const match of chunk.matchAll(/title:\s*"([^"]+)"/g)) {
      pages.push({ section: section, title: match[1] as string });
    }
  }

  return pages;
};

type SideMenuPageTitledFunction = (
  file: string,
  title: string,
) => SideMenuPage | undefined;

const sideMenuPageTitled: SideMenuPageTitledFunction = (
  file: string,
  title: string,
): SideMenuPage | undefined => {
  return sideMenuPages(file).find((candidate: SideMenuPage): boolean => {
    return candidate.title === title;
  });
};

type RoleTitlesFunction = (permissions: Array<Permission>) => Array<string>;

// The roles in an access list, as the docs name them: everything but the link's own granular permissions.
const roleTitles: RoleTitlesFunction = (
  permissions: Array<Permission>,
): Array<string> => {
  return permissions
    .filter((permission: Permission): boolean => {
      return !LINK_PERMISSIONS.includes(permission);
    })
    .map((permission: Permission): string => {
      return PermissionHelper.getTitle(permission);
    })
    .sort();
};

type ListedRolesFunction = (cell: string) => Array<string>;

const listedRoles: ListedRolesFunction = (cell: string): Array<string> => {
  return cell
    .split(",")
    .map((role: string): string => {
      return role.trim();
    })
    .sort();
};

type ReadSourceFunction = (file: string) => string;

const readSource: ReadSourceFunction = (file: string): string => {
  return fs.readFileSync(file, "utf8");
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

type ReadAccessToAddFunction = (
  readPermissions: Array<Permission>,
) => Array<string>;

/*
 * The read access somebody who may link but cannot read this side has to be
 * given: the side's read permissions that do not already let you link.
 */
const readAccessToAdd: ReadAccessToAddFunction = (
  readPermissions: Array<Permission>,
): Array<string> => {
  const linkers: Array<Permission> = new IncidentAlert().getCreatePermissions();

  return Array.from(
    new Set<string>(
      readPermissions
        .filter((permission: Permission): boolean => {
          return !linkers.includes(permission);
        })
        .map((permission: Permission): string => {
          return PermissionHelper.getTitle(permission);
        }),
    ),
  ).sort();
};

type PermissionTitlesInFunction = (
  line: string,
  titles: Array<string>,
) => Array<string>;

/*
 * Which of `titles` a line names, as whole words. Longer titles are matched
 * first and blanked out, so "Viewer" is not also found inside "Alert Viewer".
 */
const permissionTitlesIn: PermissionTitlesInFunction = (
  line: string,
  titles: Array<string>,
): Array<string> => {
  let rest: string = line;
  const found: Array<string> = [];

  const longestFirst: Array<string> = [...titles].sort(
    (a: string, b: string): number => {
      return b.length - a.length;
    },
  );

  for (const title of longestFirst) {
    const pattern: RegExp = new RegExp(
      `(^|[^A-Za-z])${escapeRegExp(title)}(?![A-Za-z])`,
      "g",
    );

    if (pattern.test(rest)) {
      found.push(title);
      rest = rest.replace(pattern, "$1 ");
    }
  }

  return found.sort();
};

type QuotedNameFunction = (sourceSnippet: string) => string;

// The first double-quoted string in a source snippet: `title: "Link Alert"` -> "Link Alert".
const quotedName: QuotedNameFunction = (sourceSnippet: string): string => {
  return sourceSnippet.match(/"([^"]+)"/)?.[1] || "";
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

describe("Incident Linked Alerts docs", () => {
  describe("navigation", () => {
    it("lists the incident pages in reading order, with Linked Alerts after the feed page", () => {
      expect(
        incidentsGroup().links.map((link: NavLink): NavLink => {
          return { title: link.title, url: link.url };
        }),
      ).toEqual(
        EXPECTED_PAGES.map((expected: ExpectedPage): NavLink => {
          return { title: expected.title, url: `/docs/${expected.page}` };
        }),
      );
    });

    it("has an English page for every link, and titles the new page like its nav entry", () => {
      for (const expected of EXPECTED_PAGES) {
        expect({
          page: expected.page,
          exists: fs.existsSync(pageFile("en", expected.page)),
        }).toEqual({ page: expected.page, exists: true });
      }

      expect(titleOf(readPage(LINKED_ALERTS_PAGE))).toBe(LINKED_ALERTS_TITLE);
    });

    it("ships a real translation of every incident page", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const expected of EXPECTED_PAGES) {
          expect({
            language: language,
            page: expected.page,
            exists: fs.existsSync(pageFile(language, expected.page)),
          }).toEqual({
            language: language,
            page: expected.page,
            exists: true,
          });

          const translated: string = readPage(expected.page, language);

          expect(PERSIAN_LETTER.test(titleOf(translated))).toBe(true);
          expect(translated).not.toEqual(readPage(expected.page));
        }
      }
    });

    it("has a nav title for every incident page in every docs language, with Linked Alerts translated", () => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const navLinks: { [key: string]: string } =
          readLocale(language).navLinks;

        for (const expected of EXPECTED_PAGES) {
          const title: string | undefined = navLinks[expected.title];

          expect({
            language: language,
            page: expected.title,
            hasTitle: typeof title === "string" && title.trim().length > 0,
          }).toEqual({
            language: language,
            page: expected.title,
            hasTitle: true,
          });
        }

        // The raw English title in another language means nobody translated it.
        expect({
          language: language,
          english: navLinks[LINKED_ALERTS_TITLE] === LINKED_ALERTS_TITLE,
        }).toEqual({
          language: language,
          english: language === DEFAULT_DOCS_LANGUAGE,
        });
      }
    });

    it("titles the translated nav link like the translated page", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        expect(readLocale(language).navLinks[LINKED_ALERTS_TITLE]).toBe(
          titleOf(readPage(LINKED_ALERTS_PAGE, language)),
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

        expect(group).toBeDefined();

        const link: LocalizedNavLink | undefined = group?.links.find(
          (item: LocalizedNavLink): boolean => {
            return item.url === `/docs/${language}/${LINKED_ALERTS_PAGE}`;
          },
        );

        expect({ language: language, title: link?.title }).toEqual({
          language: language,
          title: readLocale(language).navLinks[LINKED_ALERTS_TITLE],
        });
        expect(link?.title).toBe(
          makeT(language)(`navLinks.${LINKED_ALERTS_TITLE}`),
        );
      }
    });
  });

  describe("links", () => {
    it("points every /docs link on the incident pages, in every language, at a page that exists", () => {
      for (const language of ALL_LANGUAGES) {
        for (const expected of EXPECTED_PAGES) {
          for (const link of docsLinks(readPage(expected.page, language))) {
            const relative: string = link.slice("/docs/".length);

            expect({
              language: language,
              page: expected.page,
              link: link,
              exists: fs.existsSync(pageFile("en", relative)),
            }).toEqual({
              language: language,
              page: expected.page,
              link: link,
              exists: true,
            });
          }
        }
      }
    });

    it("links the overview, declaring, feed and settings pages to Linked Alerts, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        for (const page of PAGES_THAT_LINK_TO_LINKED_ALERTS) {
          expect({
            language: language,
            page: page,
            linksToLinkedAlerts: docsLinks(readPage(page, language)).has(
              LINKED_ALERTS_URL,
            ),
          }).toEqual({
            language: language,
            page: page,
            linksToLinkedAlerts: true,
          });
        }
      }
    });

    it("keeps the same docs links in the Linked Alerts translation", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        expect({
          language: language,
          links: Array.from(
            docsLinks(readPage(LINKED_ALERTS_PAGE, language)),
          ).sort(),
        }).toEqual({
          language: language,
          links: Array.from(docsLinks(readPage(LINKED_ALERTS_PAGE))).sort(),
        });
      }
    });

    it("keeps every in-page link of Linked Alerts in the translation, pointing at the translated heading", () => {
      const english: string = readPage(LINKED_ALERTS_PAGE);
      const englishHeadings: Array<string> = splitMarkdown(english)
        .prose.filter((line: string): boolean => {
          return SECTION_HEADING.test(line);
        })
        .map((line: string): string => {
          return slugify(line.replace(/^#+ /, "").trim());
        });

      for (const language of TRANSLATED_LANGUAGES) {
        const translated: string = readPage(LINKED_ALERTS_PAGE, language);
        const translatedHeadings: Array<string> = splitMarkdown(translated)
          .prose.filter((line: string): boolean => {
            return SECTION_HEADING.test(line);
          })
          .map((line: string): string => {
            return slugify(line.replace(/^#+ /, "").trim());
          });

        /*
         * Headings mirror each other one for one, so the n-th in-page link
         * in the translation must target the translation of the heading the
         * n-th English link targets.
         */
        expect({
          language: language,
          links: inPageLinks(translated),
        }).toEqual({
          language: language,
          links: inPageLinks(english).map((anchor: string): string => {
            return translatedHeadings[englishHeadings.indexOf(anchor)] || "";
          }),
        });
      }
    });
  });

  describe("translations", () => {
    it("mirror the English heading structure on every incident page", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const expected of EXPECTED_PAGES) {
          expect({
            language: language,
            page: expected.page,
            headings: headingCounts(readPage(expected.page, language)),
          }).toEqual({
            language: language,
            page: expected.page,
            headings: headingCounts(readPage(expected.page)),
          });
        }
      }
    });

    it("keep every English code identifier and code block of Linked Alerts intact", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        const english: string = readPage(LINKED_ALERTS_PAGE);
        const translated: string = readPage(LINKED_ALERTS_PAGE, language);
        const translatedCode: Set<string> = inlineCode(translated);

        for (const identifier of inlineCode(english)) {
          expect({
            language: language,
            identifier: identifier,
            present: translatedCode.has(identifier),
          }).toEqual({
            language: language,
            identifier: identifier,
            present: true,
          });
        }

        expect(splitMarkdown(translated).codeBlocks).toEqual(
          splitMarkdown(english).codeBlocks,
        );
      }
    });
  });

  describe("side menus", () => {
    /*
     * Where the dashboard puts the two pages. Read once here and pinned by the
     * first test, so a renamed or moved page fails there with a clear diff.
     */
    const incidentPage: SideMenuPage = sideMenuPageTitled(
      INCIDENT_SIDE_MENU_FILE,
      LINKED_ALERTS_TITLE,
    ) || { section: "", title: LINKED_ALERTS_TITLE };
    const alertPage: SideMenuPage = sideMenuPageTitled(
      ALERT_SIDE_MENU_FILE,
      "Linked Incidents",
    ) || { section: "", title: "Linked Incidents" };

    it("reads the incident and alert side-menu pages", () => {
      expect(incidentPage).toEqual({
        section: "Investigation",
        title: LINKED_ALERTS_TITLE,
      });
      expect(alertPage).toEqual({
        section: "Basic",
        title: "Linked Incidents",
      });
    });

    it("names both pages and their side-menu sections the way the menus do, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);

        for (const page of [incidentPage, alertPage]) {
          expect({
            language: language,
            page: page.title,
            named: markdown.includes(`**${page.title}**`),
            sectionNamed: markdown.includes(`**${page.section}**`),
          }).toEqual({
            language: language,
            page: page.title,
            named: true,
            sectionNamed: true,
          });
        }
      }
    });

    it("lists the incident's Linked Alerts page on the overview, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(OVERVIEW_PAGE, language);

        expect({
          language: language,
          incidentPage: markdown.includes(`- **${incidentPage.title}** — `),
          alertPage: markdown.includes(`**${alertPage.title}**`),
        }).toEqual({ language: language, incidentPage: true, alertPage: true });
      }
    });
  });

  describe("Linked Alerts", () => {
    const markdown: string = readPage(LINKED_ALERTS_PAGE);
    const crudApiPath: string =
      new IncidentAlert().getCrudApiPath()?.toString() || "";

    it("states the per-action alert cap the dashboard and server enforce, in every language", () => {
      expect(MAX_ALERTS_PER_INCIDENT_LINK_ACTION).toBeGreaterThan(0);

      expect(markdown).toContain(`**${MAX_ALERTS_PER_INCIDENT_LINK_ACTION}**`);

      for (const language of TRANSLATED_LANGUAGES) {
        expect(readPage(LINKED_ALERTS_PAGE, language)).toContain(
          `**${toPersianDigits(MAX_ALERTS_PER_INCIDENT_LINK_ACTION)}**`,
        );
      }
    });

    it("sends the alert ids under the miscDataProps key the server reads", () => {
      const declareExample: string | undefined = splitMarkdown(
        markdown,
      ).codeBlocks.find((block: string): boolean => {
        return block.includes("https://oneuptime.com/api/incident \\");
      });

      expect(declareExample).toBeDefined();
      expect(declareExample).toContain('"miscDataProps": {');
      expect(declareExample).toContain(
        `"${INCIDENT_ALERT_IDS_TO_LINK_KEY}": [`,
      );
      expect(inlineCode(markdown).has(INCIDENT_ALERT_IDS_TO_LINK_KEY)).toBe(
        true,
      );
    });

    it("uses the link model's real API route in the prose and every example", () => {
      expect(crudApiPath).toBe("/incident-alert");
      expect(inlineCode(markdown).has(`/api${crudApiPath}`)).toBe(true);

      const linkExamples: Array<string> = splitMarkdown(
        markdown,
      ).codeBlocks.filter((block: string): boolean => {
        return block.includes("/api/incident-");
      });

      expect(linkExamples.length).toBeGreaterThanOrEqual(3);

      for (const example of linkExamples) {
        expect(example).toContain(`https://oneuptime.com/api${crudApiPath}`);
      }
    });

    it("names the generated workflow triggers after the model's singular name", () => {
      const singularName: string = new IncidentAlert().singularName || "";

      expect(singularName).toBe("Incident Alert");
      expect(markdown).toContain(`**On Create ${singularName}**`);
      expect(markdown).toContain(`**On Delete ${singularName}**`);
    });

    it("documents every Incident Alert permission, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const translated: string = readPage(LINKED_ALERTS_PAGE, language);

        for (const permission of LINK_PERMISSIONS) {
          const title: string = PermissionHelper.getTitle(permission);

          expect({
            language: language,
            permission: title,
            documented: Boolean(
              tableRowStartingWith(translated, `**${title}**`),
            ),
          }).toEqual({
            language: language,
            permission: title,
            documented: true,
          });
        }
      }
    });

    it("lists exactly the roles the link model grants create, edit and delete to", () => {
      const model: IncidentAlert = new IncidentAlert();
      const cases: Array<{ permission: Permission; roles: Array<string> }> = [
        {
          permission: Permission.CreateIncidentAlert,
          roles: roleTitles(model.getCreatePermissions()),
        },
        {
          permission: Permission.EditIncidentAlert,
          roles: roleTitles(model.getUpdatePermissions()),
        },
        {
          permission: Permission.DeleteIncidentAlert,
          roles: roleTitles(model.getDeletePermissions()),
        },
      ];

      for (const testCase of cases) {
        const title: string = PermissionHelper.getTitle(testCase.permission);
        const row: string | undefined = tableRowStartingWith(
          markdown,
          `**${title}**`,
        );

        expect(row).toBeDefined();

        expect({
          permission: title,
          roles: listedRoles(tableCells(row as string)[2] || ""),
        }).toEqual({ permission: title, roles: testCase.roles });
      }
    });

    it("lists the extra read-only roles the link model grants read to", () => {
      const model: IncidentAlert = new IncidentAlert();
      const createRoles: Array<string> = roleTitles(
        model.getCreatePermissions(),
      );
      const readRoles: Array<string> = roleTitles(model.getReadPermissions());

      // "All of the above" only holds while every role that can link can also read.
      for (const role of createRoles) {
        expect(readRoles).toContain(role);
      }

      const readRow: string = tableRowStartingWith(
        markdown,
        `**${PermissionHelper.getTitle(Permission.ReadIncidentAlert)}**`,
      ) as string;
      const rolesCell: string = tableCells(readRow)[2] || "";

      expect(rolesCell.startsWith("All of the above")).toBe(true);

      const readOnlyRoles: Array<string> = readRoles.filter(
        (role: string): boolean => {
          return !createRoles.includes(role);
        },
      );

      expect(readOnlyRoles.length).toBeGreaterThan(0);

      for (const role of readOnlyRoles) {
        expect({ role: role, listed: rolesCell.includes(role) }).toEqual({
          role: role,
          listed: true,
        });
      }
    });

    it("names the feed entries as the feed's filter labels them, with their event types, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const translated: string = readPage(LINKED_ALERTS_PAGE, language);

        for (const eventType of LINK_FEED_EVENT_TYPES) {
          const entry: string = `**${getFeedEventTypeLabel(eventType)}** (\`${eventType}\`)`;

          expect({
            language: language,
            eventType: eventType,
            documented: translated.includes(entry),
          }).toEqual({
            language: language,
            eventType: eventType,
            documented: true,
          });
        }

        expect(translated).toContain(`**${FEED_OPTIONS_TEXT.triggerLabel}**`);
      }
    });

    it("quotes the message a duplicate link is refused with, in every language", () => {
      // The model's unique-together check answers with the shared message (and so does the unique index).
      expect(
        new IncidentAlert()
          .getUniqueColumnsTogether()
          .map((constraint: UniqueColumnsTogetherMetadata): string => {
            return constraint.errorMessage;
          }),
      ).toContain(INCIDENT_ALERT_ALREADY_LINKED_MESSAGE);

      for (const language of ALL_LANGUAGES) {
        expect({
          language: language,
          quoted: readPage(LINKED_ALERTS_PAGE, language).includes(
            INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
          ),
        }).toEqual({ language: language, quoted: true });
      }
    });

    it("names the link pages' buttons, dialogs and row actions as the dashboard does, in every language", () => {
      const cases: Array<{ file: string; snippet: string }> = [
        {
          file: INCIDENT_LINKED_ALERTS_PAGE_FILE,
          snippet: 'title: "Link Alert"',
        },
        {
          file: INCIDENT_LINKED_ALERTS_PAGE_FILE,
          snippet: 'submitButtonText="Link Alert"',
        },
        {
          file: INCIDENT_LINKED_ALERTS_PAGE_FILE,
          snippet: 'fieldTitle="Alert"',
        },
        {
          file: INCIDENT_LINKED_ALERTS_PAGE_FILE,
          snippet: 'title: "View Alert"',
        },
        {
          file: INCIDENT_LINKED_ALERTS_PAGE_FILE,
          snippet: 'deleteButtonText="Unlink"',
        },
        {
          file: ALERT_LINKED_INCIDENTS_PAGE_FILE,
          snippet: 'title: "Link Incident"',
        },
        {
          file: ALERT_LINKED_INCIDENTS_PAGE_FILE,
          snippet: 'title: "Declare Incident"',
        },
        {
          file: ALERT_LINKED_INCIDENTS_PAGE_FILE,
          snippet: 'title: "View Incident"',
        },
        {
          file: ALERT_LINKED_INCIDENTS_PAGE_FILE,
          snippet: 'deleteButtonText="Unlink"',
        },
        {
          file: BULK_LINK_ACTIONS_FILE,
          snippet: 'LINK_TO_INCIDENT_ACTION_TITLE: string = "Link to Incident"',
        },
        {
          file: BULK_LINK_ACTIONS_FILE,
          snippet: 'DECLARE_INCIDENT_ACTION_TITLE: string = "Declare Incident"',
        },
        { file: BULK_LINK_ACTIONS_FILE, snippet: 'fieldTitle="Incident"' },
        {
          file: BULK_LINK_ACTIONS_FILE,
          snippet: 'submitButtonText="Link Alerts"',
        },
      ];

      for (const testCase of cases) {
        expect({
          file: path.basename(testCase.file),
          snippet: testCase.snippet,
          inSource: readSource(testCase.file).includes(testCase.snippet),
        }).toEqual({
          file: path.basename(testCase.file),
          snippet: testCase.snippet,
          inSource: true,
        });

        const name: string = quotedName(testCase.snippet);

        for (const language of ALL_LANGUAGES) {
          expect({
            language: language,
            name: name,
            named: readPage(LINKED_ALERTS_PAGE, language).includes(
              `**${name}**`,
            ),
          }).toEqual({ language: language, name: name, named: true });
        }
      }
    });

    it("calls bulk unlinking by the verb both link pages give it, never Delete, in every language", () => {
      const verbs: Array<string> = [
        INCIDENT_LINKED_ALERTS_PAGE_FILE,
        ALERT_LINKED_INCIDENTS_PAGE_FILE,
      ].map((file: string): string => {
        return readSource(file).match(/deleteVerb:\s*"([^"]+)"/)?.[1] || "";
      });

      const verb: string = verbs[0] || "";

      expect(verb.length).toBeGreaterThan(0);
      expect(verbs).toEqual([verb, verb]);

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const phrase: string = (
          BULK_ACTION_PHRASE[language] as (verb: string) => string
        )(verb);

        expect({
          language: language,
          bulkActionNamed: markdown.includes(phrase),
          deleteNamed: markdown.includes("**Delete**"),
        }).toEqual({
          language: language,
          bulkActionNamed: true,
          deleteNamed: false,
        });
      }

      expect(readPage(LINKED_ALERTS_PAGE)).not.toContain("Despite its name");
    });

    it("describes the link dialogs' options the way the dialogs build them", () => {
      const helpers: string = readSource(LINK_HELPERS_FILE);

      // Recent records first, each labelled "<number>: <title>".
      expect(helpers).toMatch(/createdAt:\s*SortOrder\.Descending/);
      expect(helpers).toMatch(/`\$\{number\}: \$\{title\}`/);

      // Typing searches every record by its title on the server.
      expect(readSource(LINK_DIALOG_FILE)).toMatch(/labelField:\s*"title"/);

      const markdown: string = readPage(LINKED_ALERTS_PAGE);
      const examples: Array<string> = Array.from(inlineCode(markdown)).filter(
        (code: string): boolean => {
          return OPTION_LABEL_EXAMPLE.test(code);
        },
      );

      // One example on each side: an alert label and an incident label.
      expect(
        examples
          .map((example: string): string => {
            return example.split("-")[0] as string;
          })
          .sort(),
      ).toEqual(["ALT", "INC"]);

      expect(markdown).toContain("searches every alert by title");
      expect(markdown).toContain("typing searches every incident by title");
    });

    it("says which read access alert and incident roles also need to link, in every language", () => {
      const linkers: Array<Permission> =
        new IncidentAlert().getCreatePermissions();
      const incidentReads: Array<Permission> =
        new Incident().getReadPermissions();
      const alertReads: Array<Permission> = new Alert().getReadPermissions();

      // Why the page says so: the alert roles that may link cannot read incidents, and the reverse.
      for (const role of [Permission.AlertAdmin, Permission.AlertMember]) {
        expect({ role: role, links: linkers.includes(role) }).toEqual({
          role: role,
          links: true,
        });
        expect({
          role: role,
          readsIncidents: incidentReads.includes(role),
        }).toEqual({ role: role, readsIncidents: false });
      }

      for (const role of [
        Permission.IncidentAdmin,
        Permission.IncidentMember,
      ]) {
        expect({ role: role, links: linkers.includes(role) }).toEqual({
          role: role,
          links: true,
        });
        expect({ role: role, readsAlerts: alertReads.includes(role) }).toEqual({
          role: role,
          readsAlerts: false,
        });
      }

      const incidentReadToAdd: Array<string> = readAccessToAdd(incidentReads);
      const alertReadToAdd: Array<string> = readAccessToAdd(alertReads);
      const candidates: Array<string> = Array.from(
        new Set<string>([...incidentReadToAdd, ...alertReadToAdd]),
      );

      const byKey: (lists: Array<Array<string>>) => Array<string> = (
        lists: Array<Array<string>>,
      ): Array<string> => {
        return lists
          .map((list: Array<string>): string => {
            return list.join(", ");
          })
          .sort();
      };

      for (const language of ALL_LANGUAGES) {
        // The two bullets that say what to add, and no other bullet naming a read permission.
        const listed: Array<Array<string>> = splitMarkdown(
          readPage(LINKED_ALERTS_PAGE, language),
        )
          .prose.filter((line: string): boolean => {
            return line.startsWith("- ");
          })
          .map((line: string): Array<string> => {
            return permissionTitlesIn(line, candidates);
          })
          .filter((titles: Array<string>): boolean => {
            return titles.length > 0;
          });

        expect({ language: language, listed: byKey(listed) }).toEqual({
          language: language,
          listed: byKey([incidentReadToAdd, alertReadToAdd]),
        });
      }

      expect(readPage(LINKED_ALERTS_PAGE)).not.toContain(
        "without being given incident roles",
      );
    });

    it("names exactly the affected resources a declared incident is prefilled with", () => {
      for (const key of INCIDENT_PREFILL_RESOURCE_KEYS) {
        expect({
          key: key,
          named: Boolean(PREFILL_RESOURCE_NAMES[key]),
        }).toEqual({ key: key, named: true });
      }

      const names: Array<string> = [
        "monitor",
        ...INCIDENT_PREFILL_RESOURCE_KEYS.map((key: string): string => {
          return PREFILL_RESOURCE_NAMES[key] as string;
        }),
      ];

      const englishRow: string =
        tableRowStartingWith(
          readPage(LINKED_ALERTS_PAGE),
          "**Resources Affected**",
        ) || "";

      expect(tableCells(englishRow)[1]).toContain(
        `Every ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} of the selected alerts, combined.`,
      );
      expect(tableCells(englishRow)[1]).toContain("are not copied");

      // Product names stay in English in every translation.
      const productNames: Array<string> = names.flatMap(
        (name: string): Array<string> => {
          return name.match(/\b[A-Z][A-Za-z]+\b/g) || [];
        },
      );

      expect(productNames.length).toBeGreaterThan(0);

      for (const language of TRANSLATED_LANGUAGES) {
        const row: string =
          tableRowStartingWith(
            readPage(LINKED_ALERTS_PAGE, language),
            "**Resources Affected**",
          ) || "";

        for (const productName of productNames) {
          expect({
            language: language,
            productName: productName,
            named: (tableCells(row)[1] || "").includes(productName),
          }).toEqual({
            language: language,
            productName: productName,
            named: true,
          });
        }
      }
    });

    it("says a private declared incident takes the alerts' owners, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const row: string =
          tableRowStartingWith(
            readPage(LINKED_ALERTS_PAGE, language),
            "**Private Incident**",
          ) || "";

        expect({
          language: language,
          ownersMentioned: row.includes(OWNERS_WORD[language] as string),
        }).toEqual({ language: language, ownersMentioned: true });
      }

      expect(readPage(LINKED_ALERTS_PAGE)).toContain(
        "are added as owners of the incident, without being notified",
      );
    });

    it("quotes the private-title and declared-from-alerts wording the feed entries use, in every language", () => {
      const service: string = readSource(INCIDENT_ALERT_SERVICE_FILE);

      // A private end is named "(private alert)" / "(private incident)", without its title.
      expect(service).toMatch(/\(private \$\{data\.privateNoun\}\)/);
      expect(service).toMatch(/privateNoun:\s*"alert"/);
      expect(service).toMatch(/privateNoun:\s*"incident"/);

      // The one entry for an incident declared from alerts, an Alert Linked entry.
      expect(service).toMatch(/Declared from \$\{alerts\.length\} \$\{noun\}:/);
      expect(service).toMatch(
        /createDeclaredFromAlertsFeedItem[\s\S]*?incidentFeedEventType:\s*IncidentFeedEventType\.AlertLinked/,
      );

      const incidentCreated: string = getFeedEventTypeLabel(
        IncidentFeedEventType.IncidentCreated,
      );

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);

        for (const phrase of [
          "(private alert)",
          "(private incident)",
          "Declared from 3 alerts:",
          `**${incidentCreated}**`,
          `**${getFeedEventTypeLabel(IncidentFeedEventType.AlertLinked)}**`,
        ]) {
          expect({
            language: language,
            phrase: phrase,
            quoted: markdown.includes(phrase),
          }).toEqual({ language: language, phrase: phrase, quoted: true });
        }
      }
    });
  });

  describe("linked alert switches", () => {
    const project: Project = new Project();

    it("are the opt-in Project columns the docs describe", () => {
      for (const column of LINK_SWITCH_COLUMNS) {
        expect({
          column: column,
          defaultValue: project.getTableColumnMetadata(column).defaultValue,
        }).toEqual({ column: column, defaultValue: false });
      }

      expect(readPage(LINKED_ALERTS_PAGE)).toContain(
        "Both are off by default.",
      );
      expect(readPage(SETTINGS_PAGE)).toContain("Both are off by default");
    });

    it("are named by their real titles on Linked Alerts and Settings, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        for (const page of [LINKED_ALERTS_PAGE, SETTINGS_PAGE]) {
          const translated: string = readPage(page, language);

          for (const column of LINK_SWITCH_COLUMNS) {
            const title: string =
              project.getTableColumnMetadata(column).title || "";

            expect(title.length).toBeGreaterThan(0);

            expect({
              language: language,
              page: page,
              column: column,
              named: translated.includes(`- **${title}** — `),
            }).toEqual({
              language: language,
              page: page,
              column: column,
              named: true,
            });
          }
        }
      }
    });

    it("sit on a card of their own on More Settings, where the docs send readers, in every language", () => {
      const cards: Array<string> = fs
        .readFileSync(INCIDENT_MORE_SETTINGS_FILE, "utf8")
        .split("<CardModelDetail")
        .slice(1);

      const switchCards: Array<string> = cards.filter(
        (card: string): boolean => {
          return LINK_SWITCH_COLUMNS.some((column: string): boolean => {
            return card.includes(`${column}:`);
          });
        },
      );

      // One card, holding both switches and nothing else it could overwrite on Update.
      expect(switchCards).toHaveLength(1);

      const card: string = switchCards[0] as string;

      for (const column of LINK_SWITCH_COLUMNS) {
        expect(card).toContain(`${column}:`);
      }

      expect(card).not.toContain("NumberPrefix");

      const cardTitle: string | undefined = card.match(
        /cardProps=\{\{\s*title:\s*"([^"]+)"/,
      )?.[1];

      expect(cardTitle).toBeDefined();

      // The page holding the card is the one the Incidents side menu calls More Settings.
      expect(fs.readFileSync(INCIDENTS_SIDE_MENU_FILE, "utf8")).toMatch(
        /title:\s*"More Settings",\s*to:\s*RouteUtil\.populateRouteParams\(\s*RouteMap\[PageMap\.INCIDENTS_SETTINGS_MORE\]/,
      );

      const cardReference: Record<string, string> = {
        en: `**${cardTitle}** card`,
        fa: `کارت **${cardTitle}**`,
      };

      for (const language of ALL_LANGUAGES) {
        for (const page of [LINKED_ALERTS_PAGE, SETTINGS_PAGE]) {
          const translated: string = readPage(page, language);

          expect({
            language: language,
            page: page,
            path: translated.includes(MORE_SETTINGS_PATH),
            card: translated.includes(cardReference[language] as string),
          }).toEqual({
            language: language,
            page: page,
            path: true,
            card: true,
          });
        }
      }
    });
  });

  describe("who moves a linked alert", () => {
    const WHO_MOVES_HEADING: string = "Who moves a linked alert";

    it("is a real gap between linking and editing alerts", () => {
      const alertEditors: Array<Permission> =
        new Alert().getUpdatePermissions();

      /*
       * Roles that may link an alert but not edit it. While there are any,
       * the switches let somebody move an alert they could not move
       * themselves, which is what the page has to spell out.
       */
      const linkButNotEdit: Array<Permission> = new IncidentAlert()
        .getCreatePermissions()
        .filter((permission: Permission): boolean => {
          return (
            !LINK_PERMISSIONS.includes(permission) &&
            !alertEditors.includes(permission)
          );
        });

      expect(linkButNotEdit.length).toBeGreaterThan(0);
    });

    it("is explained under the switches and linked from the permissions, in every language", () => {
      const english: string = readPage(LINKED_ALERTS_PAGE);
      const englishHeadings: Array<string> = splitMarkdown(
        english,
      ).prose.filter((line: string): boolean => {
        return line.startsWith("### ");
      });
      const index: number = englishHeadings.indexOf(`### ${WHO_MOVES_HEADING}`);

      expect(index).toBeGreaterThanOrEqual(0);

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const heading: string =
          splitMarkdown(markdown)
            .prose.filter((line: string): boolean => {
              return line.startsWith("### ");
            })
            [index]?.slice(4)
            .trim() || "";

        expect({
          language: language,
          linked: inPageLinks(markdown).includes(slugify(heading)),
        }).toEqual({ language: language, linked: true });
      }

      // The switches' own page points at it too.
      expect(readPage(SETTINGS_PAGE)).toContain(
        "without needing permission to edit alerts",
      );
      expect(english).toContain("Leave them off if alert states should only");
    });
  });

  describe("Incident Notes, Owners & Feed", () => {
    it("lists every incident feed event type, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const documented: Set<string> = inlineCode(
          readPage(FEED_PAGE, language),
        );

        for (const eventType of Object.values(IncidentFeedEventType)) {
          expect({
            language: language,
            eventType: eventType,
            documented: documented.has(eventType),
          }).toEqual({
            language: language,
            eventType: eventType,
            documented: true,
          });
        }
      }
    });

    it("mentions the alert-side link entries, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const documented: Set<string> = inlineCode(
          readPage(FEED_PAGE, language),
        );

        for (const eventType of [
          AlertFeedEventType.LinkedToIncident,
          AlertFeedEventType.UnlinkedFromIncident,
        ]) {
          expect({
            language: language,
            eventType: eventType,
            documented: documented.has(eventType),
          }).toEqual({
            language: language,
            eventType: eventType,
            documented: true,
          });
        }
      }
    });
  });
});
