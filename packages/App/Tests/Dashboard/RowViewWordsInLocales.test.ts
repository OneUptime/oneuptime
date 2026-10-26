import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { isShortTitleInName } from "Common/UI/Components/Button/ShortButtonWords";

/*
 * A table row's View shows the locale's word for "View" and is named by
 * its whole title, "View Incident" (BaseModelTable's View action, its
 * rowButtonTitle). A speech control user says the word they see, so the
 * name must hold it (WCAG 2.5.3, Label in Name); where it does not, the
 * row shows the whole title instead (ShortButtonWords), and the table is as
 * wide as before. German showed "Ansehen" beside names that said "...
 * anzeigen", Portuguese "Visualizar" beside "Ver ...": every German and
 * Portuguese row said its whole title. Both now say the verb their names
 * use.
 *
 * Every locale's "View {{itemName}}" - the title of a View whose
 * "View <Name>" has no translation of its own - and every "View <Name>"
 * it has must hold its "View".
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const readLocale: (file: string) => Record<string, unknown> = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
};

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string) => {
    return file.endsWith(".json");
  })
  .sort();

const EN: Record<string, unknown> = readLocale("en.json");

/*
 * "View <Name>" phrases that are not a row's View: what kind of view
 * something is, and buttons of their own that show their whole title.
 */
const NOT_A_ROWS_VIEW: Array<string> = [
  "View Mode",
  "View Type",
  "View Chart",
  "View Playbooks",
  "View Unassigned Cases",
];

const VIEW_NAME_PATTERN: RegExp = /^View [A-Z][A-Za-z0-9 &-]*$/;

const VIEW_NAMES: Array<string> = Object.keys(EN).filter((key: string) => {
  return VIEW_NAME_PATTERN.test(key) && !NOT_A_ROWS_VIEW.includes(key);
});

describe("a row's View in every language", () => {
  test("there are 17 languages, and the names a row's View may have", () => {
    expect(LOCALE_FILES.length).toBe(17);
    expect(VIEW_NAMES).toEqual(
      expect.arrayContaining([
        "View Incident",
        "View Alert",
        "View Monitor",
        "View Status Page",
        "View Team",
        "View Runner",
        "View Rule",
      ]),
    );
    // The phrases left out are still phrases of the product.
    for (const phrase of NOT_A_ROWS_VIEW) {
      expect(EN[phrase]).toBe(phrase);
    }
  });

  for (const file of LOCALE_FILES) {
    test(`${file}: its View is in "View {{itemName}}" and in each "View <Name>" it translates`, () => {
      const locale: Record<string, unknown> = readLocale(file);
      const view: unknown = locale["View"];

      expect(typeof view).toBe("string");
      expect(
        isShortTitleInName({
          title: locale["View {{itemName}}"] as string,
          shortTitle: view as string,
        }),
      ).toBe(true);

      const without: Array<string> = VIEW_NAMES.filter((key: string) => {
        const title: unknown = locale[key];

        /*
         * A name still in English waits for its translation; until then
         * the row says it whole, which holds whatever it says.
         */
        const isAwaitingTranslation: boolean =
          file !== "en.json" && title === key;

        return (
          typeof title === "string" &&
          !isAwaitingTranslation &&
          !isShortTitleInName({
            title: title,
            shortTitle: view as string,
          })
        );
      }).map((key: string) => {
        return `${key} -> ${locale[key] as string}`;
      });

      expect(without).toEqual([]);
    });
  }

  test("German says Anzeigen, the verb of its names; Portuguese says Ver", () => {
    const german: Record<string, unknown> = readLocale("de.json");
    const portuguese: Record<string, unknown> = readLocale("pt.json");

    expect(german["View"]).toBe("Anzeigen");
    expect(german["View Incident"]).toBe("Vorfall anzeigen");
    expect(german["View {{itemName}}"]).toBe("{{itemName}} anzeigen");
    expect(portuguese["View"]).toBe("Ver");
    expect(portuguese["View Incident"]).toBe("Ver incidente");
    expect(portuguese["View {{itemName}}"]).toBe("Ver {{itemName}}");
  });
});
