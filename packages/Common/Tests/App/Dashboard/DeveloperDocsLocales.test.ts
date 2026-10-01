import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEVELOPER_DOCS_GUIDE_COPY,
  DEVELOPER_DOCS_LEARN_MORE_LABEL,
  DEVELOPER_DOCS_NOT_FOUND_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
  DeveloperDocsPageType,
  DeveloperDocsScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";

/*
 * Every word the Developer pages show through the translation helpers (the
 * menu section and its entries, the card's title and description, the
 * page's own labels) is in all seventeen Dashboard locales. A missing key
 * silently shows English, so this is the only thing that would notice.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .sort();

function readLocale(file: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, string>;
}

// Names that stay as they are in every language.
const UNTRANSLATED: ReadonlyArray<string> = ["Terraform", "API"];

const STRINGS: Array<string> = Array.from(
  new Set<string>([
    DEVELOPER_DOCS_SECTION_TITLE,
    ...DEVELOPER_DOCS_PAGES.map((page: DeveloperDocsPageDefinition): string => {
      return page.title;
    }),
    ...Object.values(DeveloperDocsPageType).flatMap(
      (page: DeveloperDocsPageType): Array<string> => {
        return Object.values(DeveloperDocsScope).flatMap(
          (scope: DeveloperDocsScope): Array<string> => {
            return [
              DEVELOPER_DOCS_GUIDE_COPY[page][scope].title,
              DEVELOPER_DOCS_GUIDE_COPY[page][scope].description,
            ];
          },
        );
      },
    ),
    DEVELOPER_DOCS_LEARN_MORE_LABEL,
    DEVELOPER_DOCS_NOT_FOUND_MESSAGE,
  ]),
);

describe("the Developer pages' words are in every Dashboard locale", () => {
  test("there are seventeen locales", () => {
    expect(LOCALE_FILES).toHaveLength(17);
  });

  test.each(STRINGS)("%s", (text: string) => {
    expect(readLocale("en.json")[text]).toBe(text);

    for (const file of LOCALE_FILES) {
      const translated: string | undefined = readLocale(file)[text];

      expect({
        file,
        present: Boolean(translated && translated.trim()),
      }).toEqual({ file, present: true });

      if (file !== "en.json" && !UNTRANSLATED.includes(text)) {
        expect({ file, translated: translated !== text }).toEqual({
          file,
          translated: true,
        });
      }
    }
  });

  test("a translated sentence keeps the product names it mentions", () => {
    for (const text of STRINGS) {
      for (const name of [
        "OneUptime",
        "Terraform",
        "Claude",
        "GitHub Copilot",
        "Cursor",
      ]) {
        if (!text.includes(name)) {
          continue;
        }

        for (const file of LOCALE_FILES) {
          expect({
            file,
            name,
            kept: readLocale(file)[text]?.includes(name),
          }).toEqual({ file, name, kept: true });
        }
      }
    }
  });
});
