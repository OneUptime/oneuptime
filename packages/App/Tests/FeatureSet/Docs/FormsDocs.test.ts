/*
 * The On Submit page's rows and settings are read from the dashboard's own
 * modules, which load the dashboard's API clients for the lists they fetch.
 * Nothing here fetches anything, so the clients are empty stand-ins.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/UI/Utils/Project", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return { __esModule: true, default: {} };
});
jest.mock(
  "../../../FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderData",
  () => {
    return { __esModule: true, loadFormRecordOptions: jest.fn() };
  },
);

import FormMessage from "../../../FeatureSet/Accounts/src/Utils/FormMessage";
import FormsCopy, {
  FORM_QUESTION_TYPE_TEXT,
} from "../../../FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import {
  FormMappingRow,
  getFormMappingRows,
} from "../../../FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormMappingRows";
import {
  getFormSettingsFields,
  getFormSettingsSteps,
} from "../../../FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormSettingsEditor";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, {
  LocalizedNavGroup,
  LocalizedNavLink,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import Form from "Common/Models/DatabaseModels/Form";
import FormSubmission from "Common/Models/DatabaseModels/FormSubmission";
import {
  FORM_FOREIGN_PAGE_MESSAGE,
  FORM_SUBMISSION_BODY_MESSAGE,
} from "Common/Server/API/FormAPI";
import {
  FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
  FORM_READ_RATE_LIMIT_MESSAGE,
  FORM_SUBMIT_RATE_LIMIT_MESSAGE,
  FORM_TOTAL_RATE_LIMIT_MESSAGE,
} from "Common/Server/Middleware/FormRateLimit";
import {
  FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  FORM_NOT_AVAILABLE_MESSAGE,
} from "Common/Server/Services/FormService";
import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  FormNoteAnswerFormat,
  getFormSubmissionNote,
} from "Common/Server/Utils/Form/FormSubmissionNote";
import { FORM_NO_SEVERITY_MESSAGE } from "Common/Server/Utils/Form/IncidentFormTarget";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  FORM_MAX_FIELDS,
  FORM_QUESTION_MAX_OPTIONS,
  FORM_QUESTION_TYPES,
  FORM_SUBMITTER_EMAIL_MAX_LENGTH,
  FORM_SUBMITTER_NAME_MAX_LENGTH,
  FORM_TEXT_ANSWER_MAX_LENGTH,
  FormField,
  FormFieldSource,
  getDefaultFormFields,
} from "Common/Types/Form/FormField";
import {
  FORM_FAVICON_NOT_FOUND_MESSAGE,
  FORM_FAVICON_TOO_LARGE_MESSAGE,
  FORM_FAVICON_TYPE_MESSAGE,
  FORM_LOGO_NOT_FOUND_MESSAGE,
  FORM_LOGO_TOO_LARGE_MESSAGE,
  FORM_LOGO_TYPE_MESSAGE,
} from "Common/Types/Form/FormBranding";
import { validateFormIpAllowlist } from "Common/Types/Form/FormIpAllowlist";
import {
  FORM_MULTI_SELECT_MAX_CHOICES,
  FORM_PAGE_HEADER,
  FORM_PAGE_HEADER_VALUE,
} from "Common/Types/Form/FormPublic";
import {
  FORM_DESCRIPTION_MAX_LENGTH,
  FORM_INCIDENT_TITLE_MAX_LENGTH,
  FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH,
  FormTargetFieldDefinition,
  getFormTargetFields,
} from "Common/Types/Form/FormTargetCatalog";
import FormTargetType from "Common/Types/Form/FormTargetType";
import { convertLegacyIncidentForm } from "Common/Types/Form/LegacyIncidentFormConversion";
import { JSONObject } from "Common/Types/JSON";
import Permission, {
  PermissionGroup,
  PermissionHelper,
} from "Common/Types/Permission";
import {
  neutralizeChatControlSequences,
  neutralizeUntrustedMarkdown,
  neutralizeUntrustedPlainText,
} from "Common/Utils/Markdown/UntrustedMarkdown";
import Field from "Common/UI/Components/Forms/Types/Field";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Forms docs - Forms Overview, Building a Form, What a Submission
 * Creates and Sharing & Security - against the product they describe.
 *
 * Markdown is not compiled, so nothing else notices when the nav loses a
 * page, a page links to an anchor that moved, or a name, a sentence or a
 * number the docs quote drifts from the code. Everything the pages state
 * that lives in code is read from it: the nav and its translations; the
 * answer types and each target's fields; every limit an answer is held to;
 * every sentence a refusal is worded with, from the server and the public
 * page; the rate limiter's environment variables and their defaults; the
 * header the public page reads a form with; the API routes; the permissions
 * and who has them; the plans; the On Submit page's rows and the steps of
 * its settings; the private note a submission leaves; what happens to text
 * a submitter writes; and what the upgrade made of an incident form.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const DOCS_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs");
const CONTENT_DIR: string = path.join(DOCS_DIR, "Content");
const NAV_PARTIAL_FILE: string = path.join(DOCS_DIR, "Views/Partials/Nav.ejs");
const RATE_LIMIT_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Middleware/FormRateLimit.ts",
);
const FORM_API_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/API/FormAPI.ts",
);
const FORM_SERVICE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Services/FormService.ts",
);
const FORM_MAPPING_CARD_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormMappingCard.tsx",
);
const ACCOUNTS_ENGLISH_LOCALE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Accounts/src/Locales/en.json",
);

const OVERVIEW_PAGE: string = "forms/index";
const BUILDING_PAGE: string = "forms/building";
const ON_SUBMIT_PAGE: string = "forms/on-submit";
const SHARING_PAGE: string = "forms/sharing-and-security";

const FORMS_PAGES: ReadonlyArray<string> = [
  OVERVIEW_PAGE,
  BUILDING_PAGE,
  ON_SUBMIT_PAGE,
  SHARING_PAGE,
];

// The nav, in order: each page's link title is its page title.
const NAV_LINKS: ReadonlyArray<NavLink> = [
  { title: "Forms Overview", url: `/docs/${OVERVIEW_PAGE}` },
  { title: "Building a Form", url: `/docs/${BUILDING_PAGE}` },
  { title: "What a Submission Creates", url: `/docs/${ON_SUBMIT_PAGE}` },
  { title: "Sharing & Security", url: `/docs/${SHARING_PAGE}` },
];

// The incident pages and the status page guide that send readers to Forms.
const PAGES_LINKING_TO_FORMS: ReadonlyArray<string> = [
  "incidents/index",
  "incidents/declaring-incidents",
  "incidents/settings",
  "incidents/notes-owners-and-feed",
  "status-pages/one-status-page-per-audience",
];

// `fa` is the only other language these pages are translated into.
const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

const FENCE_LINE: RegExp = /^\s*```/;
// Forms listed right after Incident Templates, in either language's comma.
const FORMS_AFTER_TEMPLATES: RegExp =
  /\*\*Incident Templates\*\*[,،] \*\*Forms\*\*/;
const ANY_HEADING: RegExp = /^(#{1,6}) (.*)$/;
const RIGHT_TO_LEFT_MARK: RegExp = /^‏/;

interface MarkdownParts {
  prose: Array<string>;
  codeBlocks: Array<string>;
}

interface Heading {
  level: number;
  text: string;
  slug: string;
}

interface DocsLink {
  page: string;
  anchor: string | undefined;
}

function pageFile(language: string, relative: string): string {
  return path.join(CONTENT_DIR, language, `${relative}.md`);
}

function readPage(relative: string, language: string = "en"): string {
  return fs.readFileSync(pageFile(language, relative), "utf8");
}

function readSource(file: string): string {
  return fs.readFileSync(file, "utf8");
}

// Prose lines and fenced code blocks, kept apart so nothing is read out of a fence.
function splitMarkdown(markdown: string): MarkdownParts {
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
}

// Every heading outside a fence, with the id the docs renderer gives it.
function headingsOf(markdown: string): Array<Heading> {
  const headings: Array<Heading> = [];

  for (const line of splitMarkdown(markdown).prose) {
    const match: RegExpMatchArray | null = line.match(ANY_HEADING);

    if (match) {
      const text: string = (match[2] as string).trim();

      headings.push({
        level: (match[1] as string).length,
        text: text,
        slug: slugify(text),
      });
    }
  }

  return headings;
}

/*
 * The markdown under a heading of this level and text, down to the next
 * heading of the same or a higher level (so an H2's section includes its
 * H3s). A `#` inside a fence is not a heading.
 */
function sectionOf(
  markdown: string,
  level: number,
  headingText: string,
): string {
  const lines: Array<string> = markdown.split("\n");
  let start: number = -1;
  let inFence: boolean = false;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const match: RegExpMatchArray | null = line.match(ANY_HEADING);

    if (!match) {
      continue;
    }

    const lineLevel: number = (match[1] as string).length;
    const text: string = (match[2] as string)
      .replace(RIGHT_TO_LEFT_MARK, "")
      .trim();

    if (start === -1) {
      if (lineLevel === level && text === headingText) {
        start = index;
      }
      continue;
    }

    if (lineLevel <= level) {
      return lines.slice(start + 1, index).join("\n");
    }
  }

  expect({ heading: headingText, found: start !== -1 }).toEqual({
    heading: headingText,
    found: true,
  });

  return lines.slice(start + 1).join("\n");
}

// Every **bold** span in the prose: how the docs name what is on screen.
function boldText(markdown: string): Set<string> {
  const prose: string = splitMarkdown(markdown).prose.join("\n");

  return new Set<string>(
    Array.from(prose.matchAll(/\*\*([^*\n]+)\*\*/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
}

// Every `inline code` span in the prose.
function inlineCode(markdown: string): Set<string> {
  const prose: string = splitMarkdown(markdown).prose.join("\n");

  return new Set<string>(
    Array.from(prose.matchAll(/`([^`\n]+)`/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
}

// Every /docs/ link, split into the page and its #anchor, if any.
function docsLinks(markdown: string): Array<DocsLink> {
  return Array.from(
    markdown.matchAll(/\]\(\/docs\/([^)#\s]+)(?:#([^)\s]*))?\)/g),
  ).map((match: RegExpMatchArray): DocsLink => {
    return { page: match[1] as string, anchor: match[2] };
  });
}

// Every in-page `](#anchor)` link target, in order.
function inPageLinks(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(/\]\(#([^)\s]+)\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function titleOf(markdown: string): string {
  const firstLine: string = markdown.split("\n")[0] || "";

  expect(firstLine.startsWith("# ")).toBe(true);

  return firstLine.slice(2).trim();
}

// The table rows of some prose, without the header and the divider.
function tableBody(markdown: string): Array<Array<string>> {
  return splitMarkdown(markdown)
    .prose.filter((line: string): boolean => {
      return line.trim().startsWith("|");
    })
    .slice(2)
    .map((row: string): Array<string> => {
      return row
        .split("|")
        .slice(1, -1)
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

// The first table of a section, as rows of cells.
function firstTable(section: string): Array<Array<string>> {
  const lines: Array<string> = splitMarkdown(section).prose;
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim().startsWith("|");
  });

  expect(start).toBeGreaterThan(-1);

  let end: number = start;

  while (end < lines.length && (lines[end] as string).trim().startsWith("|")) {
    end++;
  }

  return tableBody(lines.slice(start, end).join("\n"));
}

// "**Owner Users**, **Owner Teams**" -> ["Owner Users", "Owner Teams"].
function boldNamesIn(cell: string): Array<string> {
  return Array.from(cell.matchAll(/\*\*([^*]+)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// "20,000" -> 20000, and every other whole number in some text.
function numbersIn(text: string): Array<number> {
  return Array.from(text.replace(/(\d),(?=\d{3})/g, "$1").matchAll(/\d+/g)).map(
    (match: RegExpMatchArray): number => {
      return parseInt(match[0], 10);
    },
  );
}

function formsGroup(): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === "Forms";
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
}

function allContentFiles(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      return entry.isDirectory() ? allContentFiles(full) : [full];
    });
}

describe("Forms docs", () => {
  describe("navigation", () => {
    it("has a Forms section after Runbooks and before Workflows, as the product menu has Forms after Runbooks", () => {
      const titles: Array<string> = DocsNav.map((group: NavGroup): string => {
        return group.title;
      });
      const forms: number = titles.indexOf("Forms");

      expect(forms).toBeGreaterThan(-1);
      expect(titles[forms - 1]).toBe("Runbooks");
      expect(titles[forms + 1]).toBe("Workflows");
      expect(formsGroup().links).toEqual(NAV_LINKS);
    });

    it("titles each page as the nav does", () => {
      for (const link of NAV_LINKS) {
        const page: string = link.url.replace("/docs/", "");

        expect({ page: page, title: titleOf(readPage(page)) }).toEqual({
          page: page,
          title: link.title,
        });
      }
    });

    it("no longer has an Incident Forms page, in the nav or in any language", () => {
      const urls: Array<string> = DocsNav.flatMap(
        (group: NavGroup): Array<string> => {
          return group.links.map((link: NavLink): string => {
            return link.url;
          });
        },
      );
      const titles: Array<string> = DocsNav.flatMap(
        (group: NavGroup): Array<string> => {
          return group.links.map((link: NavLink): string => {
            return link.title;
          });
        },
      );

      expect(urls).not.toContain("/docs/incidents/forms");
      expect(titles).not.toContain("Incident Forms");

      for (const language of fs.readdirSync(CONTENT_DIR)) {
        expect(fs.existsSync(pageFile(language, "incidents/forms"))).toBe(
          false,
        );
      }
    });

    it("leaves no page in any language linking to the old page", () => {
      const stale: Array<string> = allContentFiles(CONTENT_DIR)
        .filter((file: string): boolean => {
          return file.endsWith(".md");
        })
        .filter((file: string): boolean => {
          return readSource(file).includes("/docs/incidents/forms");
        })
        .map((file: string): string => {
          return path.relative(CONTENT_DIR, file);
        });

      expect(stale).toEqual([]);
    });

    it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
      "has the section and its four pages in %s",
      (language: string) => {
        const group: LocalizedNavGroup | undefined = getLocalizedNav(
          language,
        ).find((item: LocalizedNavGroup): boolean => {
          return item.key === "Forms";
        });

        expect(group).toBeDefined();
        expect(
          (group as LocalizedNavGroup).title.trim().length,
        ).toBeGreaterThan(0);
        expect(
          (group as LocalizedNavGroup).links.map(
            (link: LocalizedNavLink): string => {
              return link.url;
            },
          ),
        ).toEqual(
          NAV_LINKS.map((link: NavLink): string => {
            return link.url.replace("/docs/", `/docs/${language}/`);
          }),
        );

        for (const [index, link] of (
          group as LocalizedNavGroup
        ).links.entries()) {
          expect(link.title.trim().length).toBeGreaterThan(0);

          // A missing translation falls back to its key, "navLinks.…".
          expect(link.title).not.toContain("navLinks.");

          if (language !== "en") {
            expect([language, link.title]).not.toEqual([
              language,
              NAV_LINKS[index]!.title,
            ]);
          }
        }

        expect((group as LocalizedNavGroup).title).not.toContain("navGroups.");
      },
    );

    it("has an icon in the docs menu", () => {
      expect(readSource(NAV_PARTIAL_FILE)).toMatch(/'Forms':\s*'<path /);
    });
  });

  describe("the pages", () => {
    it.each(FORMS_PAGES)(
      "%s renders as the docs route renders it",
      async (page: string) => {
        const markdown: string = readPage(page);
        const html: string = await DocsRender.render(
          DocsPlaceholders.render(
            markdown.split("\n").slice(1).join("\n"),
            "en",
          ),
        );

        expect(html.length).toBeGreaterThan(1000);

        // Every section heading is drawn, with the id its links use.
        for (const heading of headingsOf(markdown).slice(1)) {
          expect(html).toContain(`id="${heading.slug}"`);
        }
      },
    );

    it("resolve every link and anchor they use, and so do the pages that link to them", () => {
      const pages: Array<[string, string]> = [
        ...FORMS_PAGES.map((page: string): [string, string] => {
          return [page, "en"];
        }),
        ...PAGES_LINKING_TO_FORMS.flatMap(
          (page: string): Array<[string, string]> => {
            return LANGUAGES.map((language: string): [string, string] => {
              return [page, language];
            });
          },
        ),
      ];

      for (const [page, language] of pages) {
        const markdown: string = readPage(page, language);
        const own: Array<string> = headingsOf(markdown).map(
          (heading: Heading): string => {
            return heading.slug;
          },
        );

        for (const anchor of inPageLinks(markdown)) {
          expect({
            page,
            language,
            anchor,
            found: own.includes(anchor),
          }).toEqual({ page, language, anchor, found: true });
        }

        for (const link of docsLinks(markdown)) {
          expect({
            page,
            language,
            link: link.page,
            exists: fs.existsSync(pageFile("en", link.page)),
          }).toEqual({ page, language, link: link.page, exists: true });

          if (!link.anchor) {
            continue;
          }

          // A page that is not translated is served in English.
          const targetLanguage: string = fs.existsSync(
            pageFile(language, link.page),
          )
            ? language
            : "en";
          const slugs: Array<string> = headingsOf(
            readPage(link.page, targetLanguage),
          ).map((heading: Heading): string => {
            return heading.slug;
          });

          expect({
            page,
            language,
            link: `${link.page}#${link.anchor}`,
            found: slugs.includes(link.anchor),
          }).toEqual({
            page,
            language,
            link: `${link.page}#${link.anchor}`,
            found: true,
          });
        }
      }
    });

    it("link each other, and the incident pages link the overview", () => {
      for (const page of FORMS_PAGES) {
        const linked: Array<string> = docsLinks(readPage(page)).map(
          (link: DocsLink): string => {
            return link.page;
          },
        );

        for (const other of FORMS_PAGES) {
          if (other !== page && other !== OVERVIEW_PAGE) {
            expect({ page, other, linked: linked.includes(other) }).toEqual({
              page,
              other,
              linked: true,
            });
          }
        }
      }

      for (const language of LANGUAGES) {
        for (const page of [
          "incidents/index",
          "incidents/declaring-incidents",
          "incidents/settings",
        ]) {
          expect({
            language,
            page,
            linksToForms: docsLinks(readPage(page, language)).some(
              (link: DocsLink): boolean => {
                return link.page === OVERVIEW_PAGE;
              },
            ),
          }).toEqual({ language, page, linksToForms: true });
        }
      }
    });

    it("no longer list Forms with the incident settings, in every language", () => {
      for (const language of LANGUAGES) {
        const settings: string = readPage("incidents/settings", language);
        const overview: string = readPage("incidents/index", language);

        expect({
          language,
          settingsRow: settings.includes("| **Forms**"),
          overviewRow: FORMS_AFTER_TEMPLATES.test(overview),
        }).toEqual({ language, settingsRow: false, overviewRow: false });
      }

      // Only the overview's note on the upgrade still names the old place.
      const naming: Array<string> = allContentFiles(CONTENT_DIR)
        .filter((file: string): boolean => {
          return (
            file.endsWith(".md") &&
            readSource(file).includes("Incidents → Settings → Forms")
          );
        })
        .map((file: string): string => {
          return path.relative(CONTENT_DIR, file);
        });

      expect(naming).toEqual([path.join("en", `${OVERVIEW_PAGE}.md`)]);
    });
  });

  describe("what the pages say, against the product", () => {
    it("list the answer types the palette offers, as the palette words them", () => {
      const rows: Array<Array<string>> = firstTable(
        sectionOf(readPage(BUILDING_PAGE), 3, "Questions of the form's own"),
      );

      expect(
        rows.map((row: Array<string>): Array<string> => {
          return [row[0] as string, row[1] as string];
        }),
      ).toEqual(
        FORM_QUESTION_TYPES.map((type: CustomFieldType): Array<string> => {
          return [
            `**${FORM_QUESTION_TYPE_TEXT[type].title}**`,
            FORM_QUESTION_TYPE_TEXT[type].description,
          ];
        }),
      );

      // And the API's spelling of the same types.
      const apiRow: string =
        tableBody(
          sectionOf(readPage(OVERVIEW_PAGE), 2, "Forms through the API"),
        ).find((row: Array<string>): boolean => {
          return row[0] === "`Question`";
        })?.[1] || "";

      for (const type of FORM_QUESTION_TYPES) {
        expect(apiRow).toContain(`\`${type}\``);
      }
    });

    it("list each target's fields, as the palette names them, in its order", () => {
      const building: string = readPage(BUILDING_PAGE);
      const section: string = sectionOf(
        building,
        3,
        "Fields of what the form creates",
      );
      const tables: Array<Array<Array<string>>> = section
        .split(/\n\s*\n/)
        .filter((block: string): boolean => {
          return block.trim().startsWith("|");
        })
        .map((block: string): Array<Array<string>> => {
          return tableBody(block);
        });

      expect(tables).toHaveLength(2);

      for (const [index, targetType] of [
        FormTargetType.Incident,
        FormTargetType.ScheduledMaintenance,
      ].entries()) {
        expect(
          (tables[index] as Array<Array<string>>).map(
            (row: Array<string>): string => {
              return row[0] as string;
            },
          ),
        ).toEqual(
          getFormTargetFields(targetType).map(
            (field: FormTargetFieldDefinition): string => {
              return `**${field.title}**`;
            },
          ),
        );
      }

      // The API names the same fields by their keys.
      const apiRow: string =
        tableBody(
          sectionOf(readPage(OVERVIEW_PAGE), 2, "Forms through the API"),
        ).find((row: Array<string>): boolean => {
          return row[0] === "`TargetField`";
        })?.[1] || "";
      const [incidentPart, maintenancePart] = apiRow.split(" for an incident;");

      expect(
        Array.from((incidentPart || "").matchAll(/`([a-zA-Z]+)`/g))
          .map((match: RegExpMatchArray): string => {
            return match[1] as string;
          })
          .filter((key: string): boolean => {
            return key !== "targetField";
          }),
      ).toEqual(
        getFormTargetFields(FormTargetType.Incident).map(
          (field: FormTargetFieldDefinition): string => {
            return field.key;
          },
        ),
      );
      expect(
        Array.from(
          (maintenancePart || "")
            .split(" for a maintenance event.")[0]!
            .matchAll(/`([a-zA-Z]+)`/g),
        ).map((match: RegExpMatchArray): string => {
          return match[1] as string;
        }),
      ).toEqual(
        getFormTargetFields(FormTargetType.ScheduledMaintenance).map(
          (field: FormTargetFieldDefinition): string => {
            return field.key;
          },
        ),
      );
    });

    it("hold answers to the limits the code holds them to", () => {
      const building: string = readPage(BUILDING_PAGE);
      const limits: Array<Array<string>> = firstTable(
        sectionOf(building, 2, "Size limits"),
      );
      const limitOf: (answer: string) => Array<number> = (
        answer: string,
      ): Array<number> => {
        const row: Array<string> | undefined = limits.find(
          (cells: Array<string>): boolean => {
            return cells[0] === answer;
          },
        );

        expect({ answer, found: Boolean(row) }).toEqual({
          answer,
          found: true,
        });

        return numbersIn((row as Array<string>)[1] as string);
      };

      expect(limitOf("An incident's **Title**")).toEqual([
        FORM_INCIDENT_TITLE_MAX_LENGTH,
      ]);
      expect(limitOf("A maintenance event's **Title**")).toEqual([
        FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH,
      ]);
      expect(limitOf("**Description**")).toEqual([FORM_DESCRIPTION_MAX_LENGTH]);
      expect(limitOf("Any other text answer")).toEqual([
        FORM_TEXT_ANSWER_MAX_LENGTH,
      ]);
      expect(limitOf("A multi-select answer")).toEqual([
        FORM_MULTI_SELECT_MAX_CHOICES,
      ]);
      expect(limitOf("**Your Name**, **Your Email**")).toEqual([
        FORM_SUBMITTER_NAME_MAX_LENGTH,
      ]);
      expect(FORM_SUBMITTER_EMAIL_MAX_LENGTH).toBe(
        FORM_SUBMITTER_NAME_MAX_LENGTH,
      );

      // The same numbers where the fields are listed.
      const fields: string = sectionOf(
        building,
        3,
        "Fields of what the form creates",
      );

      expect(fields).toContain(
        `One line, up to ${FORM_INCIDENT_TITLE_MAX_LENGTH} characters.`,
      );
      expect(fields).toContain(
        `One line, up to ${FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH} characters.`,
      );
      expect(numbersIn(fields)).toContain(FORM_DESCRIPTION_MAX_LENGTH);

      // How many questions a form, and options a question, may have.
      expect(building).toContain(
        `A form can have up to ${FORM_MAX_FIELDS} questions.`,
      );
      expect(building).toContain(
        `between one and ${FORM_QUESTION_MAX_OPTIONS} of them`,
      );
      expect(sectionOf(building, 3, "Submitter")).toContain(
        `Name and email are up to ${FORM_SUBMITTER_NAME_MAX_LENGTH} characters each.`,
      );
    });

    it("start a new form with the questions the code starts it with", () => {
      const section: string = sectionOf(
        readPage(BUILDING_PAGE),
        2,
        "A new form's questions",
      );
      const describe: (fields: Array<FormField>) => Array<string> = (
        fields: Array<FormField>,
      ): Array<string> => {
        return fields.map((field: FormField): string => {
          return `${field.label}${field.isRequired ? " (required)" : ""}`;
        });
      };

      expect(describe(getDefaultFormFields(FormTargetType.Incident))).toEqual([
        "Title (required)",
        "Description",
        "Your Name (required)",
        "Your Email (required)",
      ]);
      expect(
        describe(getDefaultFormFields(FormTargetType.ScheduledMaintenance)),
      ).toEqual([
        "Title (required)",
        "Description",
        "Starts At (required)",
        "Ends At (required)",
        "Your Name (required)",
        "Your Email (required)",
      ]);

      for (const name of [
        "Title",
        "Description",
        "Starts At",
        "Ends At",
        "Your Name",
        "Your Email",
      ]) {
        expect(boldText(section).has(name)).toBe(true);
      }

      expect(section).toContain("the **Title**, required;");
      expect(section).toContain("**Your Name** and **Your Email**, required");
    });

    it("list how a submission becomes an incident, row for row as the On Submit page does", () => {
      const rows: Array<FormMappingRow> = getFormMappingRows({
        targetType: FormTargetType.Incident,
        fields: getDefaultFormFields(FormTargetType.Incident),
        settings: {} as never,
        reference: { lists: {}, templateIdsWithSeverity: [] },
        customFields: [],
      });
      const documented: Array<string> = firstTable(
        sectionOf(
          readPage(ON_SUBMIT_PAGE),
          2,
          "How a submission becomes an incident",
        ),
      ).flatMap((row: Array<string>): Array<string> => {
        return boldNamesIn(row[0] as string);
      });

      expect(documented).toEqual(
        rows.map((row: FormMappingRow): string => {
          return row.title;
        }),
      );
    });

    it("list how a submission becomes a maintenance event, row for row as the On Submit page does", () => {
      const rows: Array<FormMappingRow> = getFormMappingRows({
        targetType: FormTargetType.ScheduledMaintenance,
        fields: getDefaultFormFields(FormTargetType.ScheduledMaintenance),
        settings: {} as never,
        reference: { lists: {}, templateIdsWithSeverity: [] },
        customFields: [],
      });
      const documented: Array<string> = firstTable(
        sectionOf(
          readPage(ON_SUBMIT_PAGE),
          2,
          "How a submission becomes a scheduled maintenance event",
        ),
      ).flatMap((row: Array<string>): Array<string> => {
        return boldNamesIn(row[0] as string);
      });

      expect(documented).toEqual(
        rows.map((row: FormMappingRow): string => {
          return row.title;
        }),
      );

      // Neither switch is on unless the settings say so.
      const table: Array<Array<string>> = firstTable(
        sectionOf(
          readPage(ON_SUBMIT_PAGE),
          2,
          "How a submission becomes a scheduled maintenance event",
        ),
      );

      for (const name of [
        FormsCopy.showOnStatusPages,
        FormsCopy.notifySubscribers,
      ]) {
        const row: Array<string> | undefined = table.find(
          (cells: Array<string>): boolean => {
            return cells[0] === `**${name}**`;
          },
        );

        expect(row?.[1]).toContain(
          `**${FormsCopy.no}** unless the settings turn it on.`,
        );
      }
    });

    it("walk the settings' steps and fields as the dialog does, for both kinds of form", () => {
      const table: Array<Array<string>> = firstTable(
        sectionOf(readPage(ON_SUBMIT_PAGE), 2, "The On Submit settings"),
      );
      const reference: {
        lists: Record<string, unknown>;
        templateIdsWithSeverity: Array<string>;
      } = {
        lists: {},
        templateIdsWithSeverity: [],
      };

      for (const [column, targetType] of [
        [1, FormTargetType.Incident],
        [2, FormTargetType.ScheduledMaintenance],
      ] as Array<[number, FormTargetType]>) {
        const steps: Array<{ id: string; title: string }> =
          getFormSettingsSteps(targetType);
        const fields: Array<Field<JSONObject>> = getFormSettingsFields({
          targetType,
          reference: reference as never,
        });

        const documented: Array<[string, Array<string>]> = table
          .filter((row: Array<string>): boolean => {
            return row[column] !== "—";
          })
          .map((row: Array<string>): [string, Array<string>] => {
            return [
              boldNamesIn(row[0] as string)[0] as string,
              boldNamesIn(row[column] as string),
            ];
          });

        expect(documented).toEqual(
          steps.map(
            (step: { id: string; title: string }): [string, Array<string>] => {
              return [
                step.title,
                fields
                  .filter((field: Field<JSONObject>): boolean => {
                    return field.stepId === step.id;
                  })
                  .map((field: Field<JSONObject>): string => {
                    return field.title as string;
                  }),
              ];
            },
          ),
        );
      }

      // Saved with the button the page names.
      expect(readSource(FORM_MAPPING_CARD_FILE)).toContain(
        "submitButtonText={FormsCopy.saveChanges}",
      );
      // On the last step only, and the step list opens any step.
      expect(
        sectionOf(readPage(ON_SUBMIT_PAGE), 2, "The On Submit settings"),
      ).toContain(`**${FormsCopy.saveChanges}** is on the last step`);
      expect(readSource(FORM_MAPPING_CARD_FILE)).toContain(
        "allowAnyStepNavigation: true,",
      );
    });

    it("quote the refusals word for word, as the server and the public page word them", () => {
      const pages: string = FORMS_PAGES.map((page: string): string => {
        return readPage(page);
      }).join("\n");
      const quoted: Array<string> = [
        FORM_NOT_AVAILABLE_MESSAGE,
        FORM_NETWORK_NOT_ALLOWED_MESSAGE,
        FORM_READ_RATE_LIMIT_MESSAGE,
        FORM_SUBMIT_RATE_LIMIT_MESSAGE,
        FORM_TOTAL_RATE_LIMIT_MESSAGE,
        FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
        FORM_NO_SEVERITY_MESSAGE,
        FormMessage.CaptchaFailed,
        FORM_FOREIGN_PAGE_MESSAGE,
        FORM_SUBMISSION_BODY_MESSAGE,
        // Saving a logo or favicon the public page could not draw (Branding).
        FORM_LOGO_TYPE_MESSAGE,
        FORM_LOGO_TOO_LARGE_MESSAGE,
        FORM_LOGO_NOT_FOUND_MESSAGE,
        FORM_FAVICON_TYPE_MESSAGE,
        FORM_FAVICON_TOO_LARGE_MESSAGE,
        FORM_FAVICON_NOT_FOUND_MESSAGE,
      ];

      for (const sentence of quoted) {
        expect({ sentence, quoted: pages.includes(`"${sentence}"`) }).toEqual({
          sentence,
          quoted: true,
        });
      }

      // What a submitter sees is the page's own copy of the server's words.
      for (const sentence of quoted.slice(0, 8)) {
        expect(Object.values(FormMessage)).toContain(sentence);
      }

      // Nothing else is quoted as a sentence the product says.
      let rest: string = pages;

      for (const sentence of [
        ...quoted,
        ...THANK_YOU_LINES(),
        "Submitted anonymously through the form **Report a Problem**.",
        "incident created",
      ]) {
        rest = rest.split(`"${sentence}"`).join("");
      }

      const strays: Array<string> = Array.from(
        splitMarkdown(rest)
          .prose.join("\n")
          .matchAll(/"([A-Z][^"\n]{12,}[.!?])"/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(strays).toEqual([]);
    });

    it("quote the public page's thank-you lines as its locale has them", () => {
      for (const line of THANK_YOU_LINES()) {
        expect(readPage(BUILDING_PAGE)).toContain(`"${line}"`);
      }

      expect(readPage(SHARING_PAGE)).toContain(`"${THANK_YOU_LINES()[0]}"`);
    });

    it("list the rate limiter's environment variables, with its defaults, and the names it still reads", () => {
      const source: string = readSource(RATE_LIMIT_FILE);
      const settings: Array<{ name: string; defaultValue: number }> =
        Array.from(
          source.matchAll(
            /parsePositiveIntFromEnv\(\s*"([A-Z0-9_]+)",\s*([\d\s*]+?)\s*,?\s*\)/g,
          ),
        ).map(
          (match: RegExpMatchArray): { name: string; defaultValue: number } => {
            return {
              name: `FORM_${match[1] as string}`,
              defaultValue: (match[2] as string)
                .split("*")
                .reduce((product: number, factor: string): number => {
                  return product * parseInt(factor.trim(), 10);
                }, 1),
            };
          },
        );

      // Every setting is read: a default written some other way fails here.
      expect(settings).toHaveLength(
        (source.match(/parsePositiveIntFromEnv\(\s*"/g) || []).length,
      );
      expect(settings.length).toBe(8);
      expect(source).toContain("process.env[`FORM_${name}`]");
      expect(source).toContain("process.env[`INCIDENT_FORM_${name}`]");

      const rows: Array<Array<string>> = firstTable(
        sectionOf(readPage(SHARING_PAGE), 3, "Rate limits"),
      );

      expect(
        rows.map(
          (row: Array<string>): { name: string; defaultValue: number } => {
            return {
              name: (row[0] as string).replace(/`/g, ""),
              defaultValue: parseInt((row[1] as string).replace(/`/g, ""), 10),
            };
          },
        ),
      ).toEqual(settings);

      const section: string = sectionOf(
        readPage(SHARING_PAGE),
        3,
        "Rate limits",
      );

      expect(section).toContain(
        "with `INCIDENT_FORM_` in front instead of `FORM_`",
      );
      expect(section).toContain("the new name wins when both are set");
    });

    it("name the page's own header, and the API routes, as the code spells them", () => {
      const overview: string = readPage(OVERVIEW_PAGE);
      const sharing: string = readPage(SHARING_PAGE);
      const header: string = Array.from(inlineCode(sharing)).find(
        (code: string): boolean => {
          return code.toLowerCase().startsWith(FORM_PAGE_HEADER);
        },
      ) as string;

      expect(header.toLowerCase()).toBe(
        `${FORM_PAGE_HEADER}: ${FORM_PAGE_HEADER_VALUE}`,
      );

      expect(new Form().getCrudApiPath()?.toString()).toBe("/form");
      expect(new FormSubmission().getCrudApiPath()?.toString()).toBe(
        "/form-submission",
      );
      expect(inlineCode(overview).has("/api/form")).toBe(true);
      expect(inlineCode(overview).has("/api/form-submission")).toBe(true);

      const api: string = readSource(FORM_API_FILE);

      expect(api).toContain("?.toString()}/public/:shareKey`,");
      expect(api).toContain("?.toString()}/public/:shareKey/submit`,");
      expect(inlineCode(overview).has("GET /api/form/public/<shareKey>")).toBe(
        true,
      );
      expect(
        inlineCode(overview).has("POST /api/form/public/<shareKey>/submit"),
      ).toBe(true);
    });

    it("list the permissions under their catalogue names, with who has them as the models say", () => {
      const rows: Array<Array<string>> = firstTable(
        sectionOf(readPage(OVERVIEW_PAGE), 2, "Permissions"),
      );
      const ownersAndAdmins: string = "Project Owner, Project Admin";
      const expected: Array<[Permission, Array<Permission>]> = [
        [Permission.CreateForm, new Form().getCreatePermissions()],
        [Permission.EditForm, new Form().getUpdatePermissions()],
        [Permission.DeleteForm, new Form().getDeletePermissions()],
        [Permission.ReadForm, new Form().getReadPermissions()],
        [
          Permission.ReadFormSubmission,
          new FormSubmission().getReadPermissions(),
        ],
        [
          Permission.DeleteFormSubmission,
          new FormSubmission().getDeletePermissions(),
        ],
      ];

      expect(
        rows.map((row: Array<string>): string => {
          return row[0] as string;
        }),
      ).toEqual(
        expected.map(
          ([permission]: [Permission, Array<Permission>]): string => {
            return `**${PermissionHelper.getTitle(permission)}**`;
          },
        ),
      );

      for (const [index, [permission, holders]] of expected.entries()) {
        const who: string = (rows[index] as Array<string>)[2] as string;

        // Every row's own permission grants it, and owners and admins have it.
        expect(holders).toContain(permission);
        expect(holders).toContain(Permission.ProjectOwner);
        expect(holders).toContain(Permission.ProjectAdmin);

        if (permission === Permission.ReadForm) {
          for (const role of [
            Permission.ProjectMember,
            Permission.Viewer,
            Permission.IncidentMember,
            Permission.ScheduledMaintenanceMember,
          ]) {
            expect(holders).toContain(role);
          }

          expect(who).toContain("Project Member, Viewer");
          expect(who).toContain("the incident and scheduled maintenance roles");
          continue;
        }

        // Nobody else has it by default.
        expect([permission, who]).toEqual([permission, ownersAndAdmins]);
        expect(
          holders.filter((holder: Permission): boolean => {
            return (
              holder !== permission &&
              holder !== Permission.ProjectOwner &&
              holder !== Permission.ProjectAdmin
            );
          }),
        ).toEqual([]);
      }

      // The group the reference lists them under.
      expect(PermissionGroup.Form).toBe("Form");
      expect(sectionOf(readPage(OVERVIEW_PAGE), 2, "Permissions")).toContain(
        "They are in the **Form** group of the",
      );
    });

    it("name the plans the billing rules name", () => {
      const form: Form = new Form();

      for (const plan of [
        form.getCreateBillingPlan(),
        form.getReadBillingPlan(),
        form.getUpdateBillingPlan(),
        form.getDeleteBillingPlan(),
      ]) {
        expect(plan).toBe(PlanType.Growth);
      }

      expect(form.getColumnBillingAccessControl("ipWhitelist")?.update).toBe(
        PlanType.Scale,
      );
      expect(readSource(FORM_SERVICE_FILE)).toMatch(
        /isFeatureAccessibleOnCurrentPlan\(\s*PlanType\.Growth,/,
      );

      const plan: string = sectionOf(readPage(OVERVIEW_PAGE), 2, "Plan");

      expect(plan).toContain(`**${PlanType.Growth}** plan or above`);
      expect(plan).toContain(`**IP Allowlist** needs **${PlanType.Scale}**`);
      expect(sectionOf(readPage(SHARING_PAGE), 3, "IP allowlist")).toContain(
        `needs the **${PlanType.Scale}** plan`,
      );
    });

    it("offer IP allowlist entries the save-time check accepts, and show refused the ones it refuses", () => {
      const section: string = sectionOf(
        readPage(SHARING_PAGE),
        3,
        "IP allowlist",
      );
      const code: Set<string> = inlineCode(section);

      for (const accepted of ["203.0.113.7", "2001:db8::7", "10.0.0.0/8"]) {
        expect(code.has(accepted)).toBe(true);
        expect([accepted, validateFormIpAllowlist(accepted)]).toEqual([
          accepted,
          null,
        ]);
      }

      expect(code.has("::ffff:203.0.113.7")).toBe(true);
      expect(validateFormIpAllowlist("::ffff:203.0.113.7")).not.toBeNull();
      expect(section).toContain("IPv6 ranges are not supported");
      expect(validateFormIpAllowlist("2001:db8::/32")).toContain(
        "only IPv4 ranges are supported",
      );
    });

    it("show the private note the server writes, word for word", () => {
      const section: string = sectionOf(
        readPage(ON_SUBMIT_PAGE),
        2,
        "The private note",
      );
      const quote: string = section
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith(">");
        })
        .map((line: string): string => {
          return line.replace(/^> ?/, "");
        })
        .join("\n")
        // A hard break, written the way that survives an editor: a backslash.
        .replace(/\\\n/g, "  \n");

      expect(quote).toBe(
        getFormSubmissionNote({
          formName: "Report a Problem",
          submitterName: "Ada Lovelace",
          submitterEmail: "ada@example.com",
          answers: [
            {
              label: "Which office are you in?",
              displayValue: "Berlin",
              format: FormNoteAnswerFormat.SingleLine,
            },
          ],
        }),
      );

      expect(section).toContain(
        `"${getFormSubmissionNote({ formName: "Report a Problem" })}"`,
      );
    });

    it("say what happens to text a submitter writes, as the server does it", async () => {
      const section: string = sectionOf(
        readPage(ON_SUBMIT_PAGE),
        2,
        "Text a submitter writes",
      );

      // Mentions get an invisible character after the bracket.
      for (const mention of ["<!channel>", "<!here>", "<@U0123ABC>"]) {
        expect(section).toContain(mention.replace(/[<>]/g, "\\$&"));
        expect(neutralizeChatControlSequences(mention)).toBe(
          `<⁠${mention.slice(1)}`,
        );
      }

      // Images become links to the same address.
      const image: string = "![status](https://example.com/status.png)";
      const html: string = await DocsRender.render(
        neutralizeUntrustedMarkdown(image),
      );

      expect(html).not.toContain("<img");
      expect(html).toContain('href="https://example.com/status.png"');
      expect(await DocsRender.render(image)).toContain("<img");

      // Diagrams become code.
      const diagram: string = neutralizeUntrustedMarkdown(
        "```mermaid\ngraph TD; A-->B\n```",
      );

      expect(diagram).not.toMatch(/```\s*mermaid/);
      expect(section).toContain("`mermaid`");

      // The title is plain text: image syntax in it loads nothing.
      expect(neutralizeUntrustedPlainText(image)).not.toBe(image);
      expect(neutralizeUntrustedPlainText(image).replace(/⁠/g, "")).toBe(image);
      expect(section).toContain(
        "The invisible characters count towards the title's limit.",
      );
    });

    it("say what a custom field copied from a monitor does, as its question card says", () => {
      // The card's note, and the docs, describe the same rule.
      expect(FormsCopy.copiedFromMonitor).toContain(
        "that value replaces the answer",
      );
      expect(sectionOf(readPage(BUILDING_PAGE), 3, "Custom fields")).toContain(
        "A custom field that copies its value from a monitor custom field says so on its card: when the incident or event has monitors that agree on a value for it, that value replaces the submitter's answer.",
      );

      for (const heading of [
        "How a submission becomes an incident",
        "How a submission becomes a scheduled maintenance event",
      ]) {
        const row: Array<string> | undefined = firstTable(
          sectionOf(readPage(ON_SUBMIT_PAGE), 2, heading),
        ).find((cells: Array<string>): boolean => {
          return cells[0] === "**Custom Fields**";
        });

        expect(row?.[1]).toContain(
          "unless the field copies its value from a monitor custom field",
        );
      }
    });

    it("name the workflow components the model gets", () => {
      expect(new Form().enableWorkflowOn).toEqual(
        expect.objectContaining({ create: true, update: true }),
      );

      const names: Set<string> = boldText(readPage(OVERVIEW_PAGE));

      expect(names.has("On Create Form")).toBe(true);
      expect(names.has("On Update Form")).toBe(true);
    });

    it("describe what the upgrade made of an incident form as the conversion does it", () => {
      const severityId: string = "a0000000-0000-4000-8000-000000000001";
      const templateId: string = "a0000000-0000-4000-8000-000000000002";
      let id: number = 0;
      const generateId: () => string = (): string => {
        id++;
        return `q${id}`;
      };

      const reporting: Array<FormField> = convertLegacyIncidentForm({
        form: {
          name: "Report",
          descriptionSetting: "Hidden",
          allowReporterToChooseSeverity: true,
          incidentSeverityId: severityId,
          incidentTemplateId: templateId,
          isReporterDetailsRequired: false,
        },
        customFields: [],
        generateId,
      }).fields;

      expect(
        reporting.map((field: FormField): string => {
          return `${field.label}${field.isRequired ? " (required)" : ""}`;
        }),
      ).toEqual(["Title (required)", "Severity", "Your Name", "Your Email"]);

      const named: { fields: Array<FormField>; targetSettings: JSONObject } =
        convertLegacyIncidentForm({
          form: {
            name: "Report",
            descriptionSetting: "Required",
            incidentSeverityId: severityId,
            incidentTemplateId: templateId,
            isReporterDetailsRequired: true,
          },
          customFields: [],
          generateId,
        }) as unknown as {
          fields: Array<FormField>;
          targetSettings: JSONObject;
        };

      expect(
        named.fields
          .filter((field: FormField): boolean => {
            return field.source === FormFieldSource.Submitter;
          })
          .map((field: FormField): boolean => {
            return Boolean(field.isRequired);
          }),
      ).toEqual([true, true]);
      expect(named.targetSettings).toEqual(
        expect.objectContaining({
          incidentSeverityId: severityId,
          incidentTemplateId: templateId,
        }),
      );

      const note: string = sectionOf(
        readPage(OVERVIEW_PAGE),
        2,
        "Where your incident forms went",
      );

      expect(note).toContain("the description unless it was hidden");
      expect(note).toContain("the severity when the submitter could choose it");
      expect(note).toContain(
        "required unless the form let people report anonymously",
      );
      expect(note).toContain(
        "Its severity and incident template became its **On Submit** defaults.",
      );
      expect(note).toContain("`/accounts/incident-form/<share-key>`");
    });
  });
});

/*
 * The public page's thank-you lines, from its English locale: the heading,
 * and the reference line with the number the docs show.
 */
function THANK_YOU_LINES(): Array<string> {
  const locale: JSONObject = JSON.parse(
    fs.readFileSync(ACCOUNTS_ENGLISH_LOCALE_FILE, "utf8"),
  ) as JSONObject;
  const copy: JSONObject = locale["form"] as JSONObject;

  return [
    copy["successTitle"] as string,
    (copy["reference"] as string).replace("{{reference}}", "INC-42"),
  ];
}
