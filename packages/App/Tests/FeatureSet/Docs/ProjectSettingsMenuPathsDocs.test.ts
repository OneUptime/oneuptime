import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  PROJECT_SETTINGS,
  SettingsMenu,
  SettingsMenuSection,
  WrittenPath,
  pathsThrough,
  projectSettingsMenu,
  readableText,
} from "../../Dashboard/SettingsMenuPaths";
import { DocsLink, scanMarkdown } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { escapeRegExp } from "./DocsTranslationChecks";
import { getToolImportSourceDefinition } from "Common/Types/ToolImport/ToolImportCatalog";
import ToolImportSource, {
  AllToolImportSources,
} from "Common/Types/ToolImport/ToolImportSource";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DOCS SEND READERS DOWN PROJECT SETTINGS' REAL MENU, IN EVERY LANGUAGE.
 *
 * Project Settings' side menu folds every section but Basic: a page in one -
 * Billing, Usage History, AI Features, Domains, API Keys - is not on screen
 * until its section is opened, so a path to it names the section ("Project
 * Settings → Billing and Invoices → Billing"). The product's own texts are
 * held to that (ProjectSettingsMenuPathsInProductText); the docs pages wrote
 * "**Project Settings → AI Features**", "**Project Settings** > **Billing**"
 * and "**Project Settings → Domains**" in every language. Markdown is not
 * compiled, so these hold every page, in every language, to the menu as it
 * is drawn, as OnCallDutyMenuPathsDocs does for On-Call Duty:
 *
 *   - every path written with the English names ("Project Settings → AI →
 *     AI Features", "**Project Settings** > **Advanced** > **API Keys**")
 *     walks the menu;
 *   - no page goes from Project Settings straight to a page of a folded
 *     section in the words its language's Dashboard draws them.
 *
 * Each language's own words are matched as written, not as whole words, so
 * the check holds for languages without spaces between words too.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const MENU: SettingsMenu = projectSettingsMenu();

const BASIC: string = "Basic";
const ADVANCED: string = "Advanced";

/*
 * Importing from another tool is done once, when a project starts, so it
 * waits in Advanced ("This should be in the advanced section in the side
 * menu.", the maintainer), where Basic held it before.
 */
const IMPORT_PAGE: string = "Import from another tool";

// The menu map of Project Settings, and where its rows send a reader.
const PROJECT_SETTINGS_PAGE: string = "configuration/project-settings.md";
const MOVING_GUIDE: string = "/docs/moving-to-oneuptime/opsgenie";

/*
 * The one path the docs quote that the menu does not have, on purpose: the
 * upgrade notes say that a Runner image older than the release that moved
 * Runners into Runbooks still prints "Project Settings > Runners" in its
 * logs, so a reader can recognize the message.
 */
const QUOTED_OLD_PATHS: ReadonlyArray<{ page: string; problem: string }> = [
  {
    page: "installation/upgrading.md",
    problem: 'names no section or page of Project Settings: "Runners',
  },
];

interface DocsPage {
  language: string;
  // The page's path under its language's folder.
  page: string;
  text: string;
}

function markdownFilesUnder(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...markdownFilesUnder(entryPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function pagesOf(language: string): Array<DocsPage> {
  const root: string = path.join(CONTENT_DIR, language);

  return markdownFilesUnder(root).map((file: string): DocsPage => {
    return {
      language,
      page: path.relative(root, file),
      text: fs.readFileSync(file, "utf8"),
    };
  });
}

// A page of a section that starts folded: the section must come first.
interface FoldedPage {
  section: string;
  page: string;
}

const FOLDED_PAGES: ReadonlyArray<FoldedPage> = MENU.sections
  .filter((menuSection: SettingsMenuSection): boolean => {
    return menuSection.folded;
  })
  .flatMap((menuSection: SettingsMenuSection): Array<FoldedPage> => {
    return menuSection.items
      .filter((item: string): boolean => {
        return item !== menuSection.title;
      })
      .map((item: string): FoldedPage => {
        return { section: menuSection.title, page: item };
      });
  });

// Every title of the menu: a page's name can begin another's ("Billing").
const MENU_TITLES: ReadonlyArray<string> = MENU.sections.flatMap(
  (menuSection: SettingsMenuSection): Array<string> => {
    return [menuSection.title, ...menuSection.items];
  },
);

/*
 * Where a text goes from Project Settings straight to a page of a folded
 * section, in the words a language's Dashboard draws them, with what it
 * should name in between. A page's name that begins a longer title of the
 * menu there ("Billing" of "Billing and Invoices") is that title, not the
 * page.
 */
function foldedSectionsLeftOut(text: string, language: string): Array<string> {
  const readable: string = readableText(text);
  const menuName: string = drawnDashboardLabel(language, PROJECT_SETTINGS);
  const leftOut: Array<string> = [];

  for (const folded of FOLDED_PAGES) {
    const page: string = drawnDashboardLabel(language, folded.page);
    const longer: Array<string> = MENU_TITLES.map((title: string): string => {
      return drawnDashboardLabel(language, title);
    }).filter((title: string): boolean => {
      return title !== page && title.startsWith(page);
    });
    const pattern: RegExp = new RegExp(
      `${escapeRegExp(menuName)}\\s*(?:->|>|→|←)\\s*${escapeRegExp(page)}`,
      "gu",
    );

    for (const match of Array.from(readable.matchAll(pattern))) {
      const pageAt: number = (match.index || 0) + match[0].length - page.length;
      const isLonger: boolean = longer.some((title: string): boolean => {
        return readable.startsWith(title, pageAt);
      });

      if (!isLonger) {
        leftOut.push(
          `"${match[0]}" leaves out ${drawnDashboardLabel(language, folded.section)}, the folded section it is in`,
        );
      }
    }
  }

  return leftOut;
}

const PAGES: ReadonlyArray<DocsPage> = SUPPORTED_DOCS_LANGUAGE_CODES.flatMap(
  (language: string): Array<DocsPage> => {
    return pagesOf(language);
  },
);

describe("the checks themselves", () => {
  it("knows the pages of Project Settings' folded sections, and not Basic's", () => {
    expect(FOLDED_PAGES).toEqual(
      expect.arrayContaining([
        { section: "Billing and Invoices", page: "Billing" },
        { section: "Billing and Invoices", page: "Usage History" },
        { section: "AI", page: "AI Features" },
        { section: "Advanced", page: "Domains" },
        { section: "Advanced", page: "API Keys" },
        { section: "Advanced", page: IMPORT_PAGE },
        { section: "Notifications", page: "Notification Settings" },
        { section: "Workspace", page: "Video Calls" },
      ]),
    );

    const foldedPages: Array<string> = FOLDED_PAGES.map(
      (folded: FoldedPage): string => {
        return folded.page;
      },
    );

    // Basic starts open, and holds the project itself and its labels only.
    expect(foldedPages).not.toContain("Project");
    expect(foldedPages).not.toContain("Labels");
    expect(
      MENU.sections.find((menuSection: SettingsMenuSection): boolean => {
        return menuSection.title === BASIC;
      }),
    ).toEqual({ title: BASIC, items: ["Project", "Labels"], folded: false });
  });

  it.each([
    [
      "en",
      "Add one under **Project Settings** > **Billing** before you import.",
    ],
    ["en", "The limits are on **Project Settings → AI Features**, folded."],
    ["de", "Siehe **Projekteinstellungen → KI-Funktionen**."],
    ["da", "Tilføj en under **Projektindstillinger** > **Fakturering**."],
    ["ja", "**プロジェクト設定 → ドメイン** で確認済みのドメイン"],
    // No space before the next word, as Japanese and Chinese often write it.
    ["zh-CN", "请在“项目设置 → 使用历史”中查看"],
    ["fa", "در **تنظیمات پروژه ← دامنه‌ها** تأیید شده"],
    // The import, as the guides wrote it while it was in Basic.
    [
      "en",
      "In OneUptime, go to **Project Settings** > **Import from another tool** and select **Opsgenie**.",
    ],
    [
      "de",
      "**Projekteinstellungen → Aus einem anderen Tool importieren** liest Ihre Einrichtung.",
    ],
    [
      "ja",
      "OneUptime で **プロジェクト設定** > **別のツールからインポート** を開き",
    ],
    ["ko", "**프로젝트 설정 → 다른 도구에서 가져오기**는 다른 도구의 설정을"],
  ])(
    "flags a %s path that leaves the folded section out: %s",
    (language: string, text: string) => {
      expect(foldedSectionsLeftOut(text, language)).toHaveLength(1);
    },
  );

  it.each([
    [
      "en",
      "Add one under **Project Settings** > **Billing and Invoices** > **Billing** before you import.",
    ],
    // The section itself begins with the page's name: that is no page.
    ["en", "See **Project Settings → Billing and Invoices** for every page."],
    ["de", "Siehe **Projekteinstellungen → KI → KI-Funktionen**."],
    [
      "da",
      "Tilføj en under **Projektindstillinger** > **Fakturering og fakturaer** > **Fakturering**.",
    ],
    ["ja", "**プロジェクト設定 → 詳細 → ドメイン** で確認済みのドメイン"],
    // A page of the open Basic section needs nothing in between.
    ["en", "Open **Project Settings** > **Labels**."],
    [
      "en",
      "In OneUptime, go to **Project Settings** > **Advanced** > **Import from another tool** and select **Opsgenie**.",
    ],
    [
      "ja",
      "OneUptime で **プロジェクト設定** > **詳細** > **別のツールからインポート** を開き",
    ],
    [
      "ko",
      "**프로젝트 설정 → 고급 → 다른 도구에서 가져오기**는 다른 도구의 설정을",
    ],
  ])(
    "follows a %s path that names it: %s",
    (language: string, text: string) => {
      expect(foldedSectionsLeftOut(text, language)).toEqual([]);
    },
  );
});

describe("every docs page sends readers down Project Settings' real menu", () => {
  it("is checked in every docs language", () => {
    expect(SUPPORTED_DOCS_LANGUAGE_CODES).toHaveLength(17);
    expect(
      PAGES.filter((page: DocsPage): boolean => {
        return page.language === "en";
      }).length,
    ).toBeGreaterThan(100);
  });

  it("finds the English pages' Project Settings paths to check", () => {
    const english: Array<WrittenPath> = PAGES.filter(
      (page: DocsPage): boolean => {
        return page.language === "en";
      },
    ).flatMap((page: DocsPage): Array<WrittenPath> => {
      return pathsThrough(page.text, MENU);
    });

    expect(english.length).toBeGreaterThan(200);
    expect(
      english.map((written: WrittenPath): string => {
        return [written.menu, ...written.steps].join(" > ");
      }),
    ).toEqual(
      expect.arrayContaining([
        "Project Settings > Billing and Invoices > Billing",
        "Project Settings > Billing and Invoices > Usage History",
        "Project Settings > AI > AI Features",
        "Project Settings > Advanced > Domains",
        "Project Settings > Advanced > API Keys",
        "Project Settings > Telemetry & APM > Ingestion Keys",
        "Project Settings > Workspace > Slack",
        "Project Settings > Advanced > Import from another tool",
      ]),
    );
  });

  it.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: every path written with the English names walks the menu",
    (language: string) => {
      const problems: Array<string> = PAGES.filter(
        (page: DocsPage): boolean => {
          return page.language === language;
        },
      ).flatMap((page: DocsPage): Array<string> => {
        return pathsThrough(page.text, MENU).flatMap(
          (written: WrittenPath): Array<string> => {
            return written.problems
              .filter((problem: string): boolean => {
                return !QUOTED_OLD_PATHS.some(
                  (quoted: { page: string; problem: string }): boolean => {
                    return (
                      quoted.page === page.page &&
                      problem.startsWith(quoted.problem)
                    );
                  },
                );
              })
              .map((problem: string): string => {
                return `${page.page}: "${written.text}" ${problem}`;
              });
          },
        );
      });

      expect(problems).toEqual([]);
    },
  );

  it("quotes the old Runner log path only in the upgrade notes, in every language", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const quoting: Array<string> = PAGES.filter((page: DocsPage): boolean => {
        return (
          page.language === language &&
          pathsThrough(page.text, MENU).some(
            (written: WrittenPath): boolean => {
              return written.problems.some((problem: string): boolean => {
                return problem.startsWith(QUOTED_OLD_PATHS[0]!.problem);
              });
            },
          )
        );
      }).map((page: DocsPage): string => {
        return page.page;
      });

      expect({ language, quoting }).toEqual({
        language,
        quoting: ["installation/upgrading.md"],
      });
    }
  });

  it.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: no path goes from Project Settings straight to a page of a folded section, as its Dashboard draws them",
    (language: string) => {
      const leftOut: Array<string> = PAGES.filter((page: DocsPage): boolean => {
        return page.language === language;
      }).flatMap((page: DocsPage): Array<string> => {
        return foldedSectionsLeftOut(page.text, language).map(
          (problem: string): string => {
            return `${page.page}: ${problem}`;
          },
        );
      });

      expect(leftOut).toEqual([]);
    },
  );

  it.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: the import guides send a payment method to Billing and Invoices, Billing",
    (language: string) => {
      const page: string = fs.readFileSync(
        path.join(CONTENT_DIR, language, "moving-to-oneuptime", "pingdom.md"),
        "utf8",
      );
      const steps: Array<string> = [
        PROJECT_SETTINGS,
        "Billing and Invoices",
        "Billing",
      ].map((english: string): string => {
        return `**${drawnDashboardLabel(language, english)}**`;
      });

      expect(page).toContain(steps.join(" > "));
    },
  );
});

describe("the docs find Import from another tool in Advanced, in every language", () => {
  const languages: Array<[string]> = SUPPORTED_DOCS_LANGUAGE_CODES.map(
    (language: string): [string] => {
      return [language];
    },
  );

  // Every tool's moving guide, from the catalog: a tool added later is checked too.
  const GUIDES: Array<string> = AllToolImportSources.map(
    (source: ToolImportSource): string => {
      return getToolImportSourceDefinition(source).docsPath.replace(
        "/docs/",
        "",
      );
    },
  );

  function readContent(language: string, page: string): string {
    return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
  }

  // The row of the map that starts with a section, as the language draws it.
  function mapRow(language: string, section: string): string {
    const start: string = `| **${drawnDashboardLabel(language, section)}** |`;
    const rows: Array<string> = readContent(language, PROJECT_SETTINGS_PAGE)
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith(start);
      });

    expect({ language, section, rows: rows.length }).toEqual({
      language,
      section,
      rows: 1,
    });

    return rows[0] as string;
  }

  function linkTargets(markdown: string): Array<string> {
    return scanMarkdown(markdown).links.map((link: DocsLink): string => {
      return link.target;
    });
  }

  it("has a guide for every tool to check", () => {
    expect(GUIDES.length).toBeGreaterThanOrEqual(11);
    expect(GUIDES).toContain(MOVING_GUIDE.replace("/docs/", ""));
  });

  it.each(languages)(
    "%s: every moving guide opens the import page through Advanced, each step as its Dashboard draws it",
    (language: string) => {
      const steps: string = [PROJECT_SETTINGS, ADVANCED, IMPORT_PAGE]
        .map((english: string): string => {
          return `**${drawnDashboardLabel(language, english)}**`;
        })
        .join(" > ");

      for (const guide of GUIDES) {
        expect({
          language,
          guide,
          opens: readContent(language, `${guide}.md`).includes(steps),
        }).toEqual({ language, guide, opens: true });
      }
    },
  );

  it.each(languages)(
    "%s: no page puts Import from another tool under Basic any more",
    (language: string) => {
      // Read as the reader sees it: readableText drops the bold markers.
      const underBasic: RegExp = new RegExp(
        `${escapeRegExp(drawnDashboardLabel(language, BASIC))}\\s*(?:->|>|→|←|›)\\s*${escapeRegExp(drawnDashboardLabel(language, IMPORT_PAGE))}`,
        "u",
      );

      expect(
        PAGES.filter((page: DocsPage): boolean => {
          return (
            page.language === language &&
            underBasic.test(readableText(page.text))
          );
        }).map((page: DocsPage): string => {
          return page.page;
        }),
      ).toEqual([]);
    },
  );

  it.each(languages)(
    "%s: the map of Project Settings lists it, and the moving guides, in Advanced's row and not in Basic's",
    (language: string) => {
      const entry: string = `**${drawnDashboardLabel(language, IMPORT_PAGE)}**`;
      const basic: string = mapRow(language, BASIC);
      const advanced: string = mapRow(language, ADVANCED);

      expect({
        language,
        inBasic: basic.includes(entry),
        inAdvanced: advanced.includes(entry),
      }).toEqual({ language, inBasic: false, inAdvanced: true });
      expect(linkTargets(basic)).not.toContain(MOVING_GUIDE);
      expect(linkTargets(advanced)).toContain(MOVING_GUIDE);
      // Last, as the side menu lists it: nothing bold follows it in its cell.
      expect(advanced.split(" | ")[1]?.endsWith(entry)).toBe(true);
    },
  );
});
