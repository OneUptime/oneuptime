import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every translation key the Enterprise UI uses exists in the English locale of
 * the frontend that bundles it.
 *
 * ee/Dashboard and ee/AdminDashboard are compiled into the Dashboard and Admin
 * Dashboard bundles and translate through those frontends' i18n instances,
 * whose resources are packages/App/FeatureSet/<Frontend>/src/Locales/*.json.
 * Neither frontend installs a missing-key handler, so a key that is in no
 * locale renders as the raw key string ("pages.enterpriseLicenseView.
 * offlineTokenCardTitle") in the Enterprise image. `npm run i18n:validate`
 * only checks the locale files against each other, never against the code,
 * and the ee UI tests mock t() as the identity - so nothing else notices.
 *
 * Lives in the server jest project because it only reads files.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

interface UiArea {
  name: string;
  sourceDirectory: string;
  englishLocale: string;
}

const UI_AREAS: Array<UiArea> = [
  {
    name: "Dashboard",
    sourceDirectory: path.join(EE_DIR, "Dashboard"),
    englishLocale: path.join(
      REPOSITORY_ROOT,
      "packages",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Locales",
      "en.json",
    ),
  },
  {
    name: "AdminDashboard",
    sourceDirectory: path.join(EE_DIR, "AdminDashboard"),
    englishLocale: path.join(
      REPOSITORY_ROOT,
      "packages",
      "App",
      "FeatureSet",
      "AdminDashboard",
      "src",
      "Locales",
      "en.json",
    ),
  },
];

const SOURCE_FILE: RegExp = /\.tsx?$/;

// t("key"), t('key'), t(`key`) - also when the key is on the next line.
const TRANSLATION_CALL: RegExp = /\bt\(\s*(["'`])([^"'`$\n]+)\1/g;

const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...listSourceFiles(fullPath));
      }

      continue;
    }

    if (SOURCE_FILE.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
};

const findTranslationKeys: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const keys: Array<string> = [];

  for (const match of source.matchAll(TRANSLATION_CALL)) {
    keys.push(match[2] as string);
  }

  return keys;
};

type LocaleTree = { [key: string]: string | LocaleTree };

const hasKey: (tree: LocaleTree, key: string) => boolean = (
  tree: LocaleTree,
  key: string,
): boolean => {
  let node: string | LocaleTree | undefined = tree;

  for (const segment of key.split(".")) {
    if (typeof node !== "object" || node === null || !(segment in node)) {
      return false;
    }

    node = (node as LocaleTree)[segment];
  }

  return typeof node === "string";
};

describe("the Enterprise UI's translation keys", () => {
  test("the key finder sees single, double and back quotes and wrapped calls", () => {
    expect(
      findTranslationKeys(
        [
          't("a.b")',
          "t('c.d')",
          "t(`e.f`)",
          't(\n  "g.h",\n)',
          "t(`skipped.${dynamic}`)",
          'format("not.a.call")',
        ].join("\n"),
      ),
    ).toEqual(["a.b", "c.d", "e.f", "g.h"]);
  });

  test("a key that is in no locale is reported (negative control)", () => {
    const locale: LocaleTree = { pages: { known: "Known" } };

    expect(hasKey(locale, "pages.known")).toBe(true);
    expect(hasKey(locale, "pages.missing")).toBe(false);
    // A branch is not a string: "pages" alone would render "[object Object]".
    expect(hasKey(locale, "pages")).toBe(false);
  });

  test.each(UI_AREAS)(
    "every key used by ee/$name is in the $name English locale",
    (area: UiArea) => {
      const locale: LocaleTree = JSON.parse(
        fs.readFileSync(area.englishLocale, "utf8"),
      ) as LocaleTree;

      const files: Array<string> = listSourceFiles(area.sourceDirectory);

      // An empty scan would pass vacuously.
      expect(files.length).toBeGreaterThan(0);

      const missing: Array<string> = [];

      for (const file of files) {
        for (const key of findTranslationKeys(fs.readFileSync(file, "utf8"))) {
          if (!hasKey(locale, key)) {
            missing.push(`${path.relative(EE_DIR, file)}: ${key}`);
          }
        }
      }

      expect(missing).toEqual([]);
    },
  );

  /*
   * ee/Dashboard happens to translate nothing yet; the Admin Dashboard screens
   * do. Across both, the scan must see keys, or it proves nothing.
   */
  test("the scan sees the keys the Enterprise UI uses", () => {
    const keys: Array<string> = UI_AREAS.flatMap(
      (area: UiArea): Array<string> => {
        return listSourceFiles(area.sourceDirectory).flatMap(
          (file: string): Array<string> => {
            return findTranslationKeys(fs.readFileSync(file, "utf8"));
          },
        );
      },
    );

    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain("pages.enterpriseLicenseView.offlineTokenCardTitle");
  });
});
