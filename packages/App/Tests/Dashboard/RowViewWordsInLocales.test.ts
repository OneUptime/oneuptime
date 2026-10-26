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

/*
 * A list that draws its own View of a record - an incident's linked alerts,
 * an episode's member incidents: the eye icon, "View <Kind>" - says View on
 * the row as every model table's own View does (rowButtonTitle), named by
 * its whole title. Its rows read "View Incident" beside lists that read
 * "View".
 */
const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

// The object literal a `title:` is in: from its "{" to the matching "}".
function enclosingObject(text: string, index: number): string {
  let depth: number = 0;
  let start: number = index;

  for (; start >= 0; start--) {
    const character: string = text[start]!;

    if (character === "}") {
      depth++;
    } else if (character === "{") {
      if (depth === 0) {
        break;
      }
      depth--;
    }
  }

  depth = 0;

  for (let end: number = start; end < text.length; end++) {
    const character: string = text[end]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return text.slice(start, end + 1);
      }
    }
  }

  return text.slice(start);
}

const VIEW_ACTION_TITLE: RegExp = /title: "(View [A-Z][^"]*)"/g;

interface RecordViewAction {
  place: string;
  object: string;
}

function recordViewActions(): Array<RecordViewAction> {
  const found: Array<RecordViewAction> = [];

  for (const file of sourceFiles(DASHBOARD_SRC)) {
    const text: string = fs.readFileSync(file, "utf8");

    for (const match of text.matchAll(VIEW_ACTION_TITLE)) {
      const object: string = enclosingObject(text, match.index!);

      // A row's action that opens a record: the eye, and an onClick.
      if (object.includes("icon: IconProp.Eye") && object.includes("onClick")) {
        found.push({
          place: `${path.relative(DASHBOARD_SRC, file)}: ${match[1]!}`,
          object: object,
        });
      }
    }
  }

  return found;
}

describe("a list's own View of a record", () => {
  const actions: Array<RecordViewAction> = recordViewActions();

  test("there are such lists: an incident's alerts, an alert's incidents and each episode's members", () => {
    expect(
      actions.map((action: RecordViewAction): string => {
        return action.place;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Pages/Incidents/View/Alerts.tsx: View Alert",
        "Pages/Alerts/View/Incidents.tsx: View Incident",
        "Pages/Incidents/EpisodeView/Incidents.tsx: View Incident",
        "Pages/Alerts/EpisodeView/Alerts.tsx: View Alert",
      ]),
    );
  });

  test("each says View on the row, as a model table's own View does", () => {
    const without: Array<string> = actions
      .filter((action: RecordViewAction): boolean => {
        return !action.object.includes('rowButtonTitle: "View"');
      })
      .map((action: RecordViewAction): string => {
        return action.place;
      });

    expect(without).toEqual([]);
  });
});
