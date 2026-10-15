import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  ON_CALL_DUTY,
  SettingsMenu,
  SettingsMenuSection,
  WrittenPath,
  onCallDutyMenu,
  pathsThrough,
  readableText,
} from "../../Dashboard/SettingsMenuPaths";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { escapeRegExp } from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DOCS SEND READERS DOWN ON-CALL DUTY'S REAL MENU, IN EVERY LANGUAGE.
 *
 * On-Call Duty's side menu folds its Advanced section (User Overrides,
 * Execution Logs, Archived Policies), Reports, Workspace, Settings and
 * Developer: a page in one is not on screen until its section is opened, so
 * a path to it names the section. The On-Call Schedules page told readers a
 * skip "is listed under On-Call Duty > User Overrides", without Advanced, in
 * all seventeen languages. Markdown is not compiled, so these hold every
 * page, in every language, to the menu as it is drawn - as the product's own
 * texts are held (OnCallDutyMenuPathsInProductText):
 *
 *   - every path written with the English names ("On-Call Duty → Advanced →
 *     User Overrides", "**On-Call Duty** > **Readiness**") walks the menu;
 *   - no page goes from On-Call Duty straight to a page of a folded section
 *     in the words its language's Dashboard draws them.
 *
 * Each language's own words are matched as written, not as whole words, so
 * the check holds for languages without spaces between words too.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const MENU: SettingsMenu = onCallDutyMenu();

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

/*
 * Where a text goes from On-Call Duty straight to a page of a folded
 * section, in the words a language's Dashboard draws them, with what it
 * should name in between.
 */
function foldedSectionsLeftOut(text: string, language: string): Array<string> {
  const readable: string = readableText(text);
  const menuName: string = drawnDashboardLabel(language, ON_CALL_DUTY);
  const leftOut: Array<string> = [];

  for (const folded of FOLDED_PAGES) {
    const pattern: RegExp = new RegExp(
      `${escapeRegExp(menuName)}\\s*(?:->|>|→)\\s*${escapeRegExp(
        drawnDashboardLabel(language, folded.page),
      )}`,
      "u",
    );
    const match: RegExpExecArray | null = pattern.exec(readable);

    if (match) {
      leftOut.push(
        `"${match[0]}" leaves out ${drawnDashboardLabel(language, folded.section)}, the folded section it is in`,
      );
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
  it("knows the pages of On-Call Duty's folded sections", () => {
    expect(FOLDED_PAGES).toEqual(
      expect.arrayContaining([
        { section: "Advanced", page: "User Overrides" },
        { section: "Advanced", page: "Execution Logs" },
        { section: "Advanced", page: "Archived Policies" },
        { section: "Reports", page: "User On Call Time" },
        { section: "Settings", page: "Custom Fields" },
      ]),
    );
    // The open sections' pages are not among them.
    expect(
      FOLDED_PAGES.map((folded: FoldedPage): string => {
        return folded.page;
      }),
    ).not.toEqual(
      expect.arrayContaining([
        "On-Call Policies",
        "Readiness",
        "Calendar Feeds",
      ]),
    );
  });

  it.each([
    ["en", "It is listed under **On-Call Duty** > **User Overrides**."],
    ["da", "Det står under **Vagtordning** > **Brugertilsidesættelser**."],
    ["ja", "**オンコール** > **ユーザーオーバーライド** に一覧表示され"],
    // No space before the next word, as Japanese and Chinese often write it.
    ["ja", "オンコール > ユーザーオーバーライドで削除してください。"],
    ["zh-CN", "它列在 **值班** > **用户覆盖** 下"],
    ["fa", "در **کشیک آنکال** > **جایگزینی‌های کاربر** فهرست می‌شود"],
    ["de", "Siehe **Bereitschaftsdienst → Ausführungsprotokolle**."],
  ])(
    "flags a %s path that leaves the folded section out: %s",
    (language: string, text: string) => {
      expect(foldedSectionsLeftOut(text, language)).toHaveLength(1);
    },
  );

  it.each([
    [
      "da",
      "Det står under **Vagtordning** > **Avanceret** > **Brugertilsidesættelser**.",
    ],
    [
      "ja",
      "**オンコール** > **詳細** > **ユーザーオーバーライド** に一覧表示され",
    ],
    ["zh-CN", "它列在 **值班** > **高级** > **用户覆盖** 下"],
    // A page of an open section needs nothing in between.
    ["de", "Öffnen Sie **Bereitschaftsdienst** > **Bereitschaftspläne**."],
  ])(
    "follows a %s path that names it: %s",
    (language: string, text: string) => {
      expect(foldedSectionsLeftOut(text, language)).toEqual([]);
    },
  );
});

describe("every docs page sends readers down On-Call Duty's real menu", () => {
  it("is checked in every docs language", () => {
    expect(SUPPORTED_DOCS_LANGUAGE_CODES).toHaveLength(17);
    expect(
      PAGES.filter((page: DocsPage): boolean => {
        return page.language === "en";
      }).length,
    ).toBeGreaterThan(100);
  });

  it("finds the English pages' On-Call Duty paths to check", () => {
    const english: Array<WrittenPath> = PAGES.filter(
      (page: DocsPage): boolean => {
        return page.language === "en";
      },
    ).flatMap((page: DocsPage): Array<WrittenPath> => {
      return pathsThrough(page.text, MENU);
    });

    // The On Call pages, the import guides, the chat pages.
    expect(english.length).toBeGreaterThan(20);
    expect(
      english.map((written: WrittenPath): string => {
        return [written.menu, ...written.steps].join(" > ");
      }),
    ).toEqual(
      expect.arrayContaining([
        "On-Call Duty > Advanced > User Overrides",
        "On-Call Duty > Advanced > Execution Logs",
        "On-Call Duty > Advanced > Archived Policies",
        "On-Call Duty > Reports > User On Call Time",
        "On-Call Duty > Readiness",
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
            return written.problems.map((problem: string): string => {
              return `${page.page}: "${written.text}" ${problem}`;
            });
          },
        );
      });

      expect(problems).toEqual([]);
    },
  );

  it.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: no path goes from On-Call Duty straight to a page of a folded section, as its Dashboard draws them",
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
    "%s: the schedules page lists a skip under On-Call Duty, Advanced, User Overrides",
    (language: string) => {
      const page: string = fs.readFileSync(
        path.join(CONTENT_DIR, language, "on-call", "schedules.md"),
        "utf8",
      );
      const steps: Array<string> = [
        ON_CALL_DUTY,
        "Advanced",
        "User Overrides",
      ].map((english: string): string => {
        return `**${drawnDashboardLabel(language, english)}**`;
      });

      expect(page).toContain(steps.join(" > "));
    },
  );
});
