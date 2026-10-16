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
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { escapeRegExp } from "./DocsTranslationChecks";
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
        { section: "Notifications", page: "Notification Settings" },
        { section: "Workspace", page: "Video Calls" },
      ]),
    );
    expect(
      FOLDED_PAGES.map((folded: FoldedPage): string => {
        return folded.page;
      }),
    ).not.toEqual(
      expect.arrayContaining(["Project", "Labels", "Import from another tool"]),
    );
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
    ["en", "Open **Project Settings** > **Import from another tool**."],
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
        "Project Settings > Import from another tool",
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
