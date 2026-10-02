import {
  AlignedLocale,
  alignLocale,
  compareKeys,
  getLeafId,
  getLeaves,
  getPlaceholders,
  getPluralBases,
  getPluralCategories,
  getValueAt,
  hasConflictMarkers,
  insertEnglishKeys,
  insertNestedEnglishKeys,
  LocaleTree,
  mergeLocaleTrees,
  parseConflictSide,
  parseLocaleText,
  PLURAL_CATEGORIES,
  readLocaleFile,
  ReadLocaleResult,
  resolveConflictedLocaleText,
  serializeLocale,
  splitConflictSides,
  StageReader,
  TRANSLATED_LOCALES,
  updateEnglishPluralForms,
  writeLocaleFile,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "Common/Types/Dashboard/DashboardLanguage";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * How the Dashboard's locale files are read, written, lined up with en.json
 * and put back together after a merge conflict. The ordering rules are what
 * let several branches add strings at once and still merge cleanly, so they
 * are pinned closely: the result must depend only on the files and the set of
 * new keys, never on the order anything was found in.
 */

describe("plural categories", () => {
  test("cover every Dashboard language", () => {
    expect(Object.keys(PLURAL_CATEGORIES).sort()).toEqual(
      [...SUPPORTED_DASHBOARD_LANGUAGE_CODES].sort(),
    );
  });

  /*
   * Written out so the files this tool writes never depend on the ICU build
   * of whoever runs it; this fails if Intl ever disagrees.
   */
  test.each(SUPPORTED_DASHBOARD_LANGUAGE_CODES)(
    "%s matches Intl.PluralRules",
    (code: string) => {
      const categories: Array<string> = [
        ...new Intl.PluralRules(code).resolvedOptions().pluralCategories,
      ];
      const order: Array<string> = [
        "zero",
        "one",
        "two",
        "few",
        "many",
        "other",
      ];

      expect(getPluralCategories(code)).toEqual(
        categories.sort((a: string, b: string): number => {
          return order.indexOf(a) - order.indexOf(b);
        }),
      );
    },
  );

  test("an unknown code has English's two forms", () => {
    expect(getPluralCategories("xx")).toEqual(["one", "other"]);
  });

  test("every language but English is translated", () => {
    expect(TRANSLATED_LOCALES).not.toContain("en");
    expect(TRANSLATED_LOCALES.length).toBe(
      SUPPORTED_DASHBOARD_LANGUAGE_CODES.length - 1,
    );
  });
});

describe("reading and writing", () => {
  test("serializes as two-space JSON with a trailing newline", () => {
    expect(serializeLocale({ a: "A", n: { b: "B" } })).toBe(
      '{\n  "a": "A",\n  "n": {\n    "b": "B"\n  }\n}\n',
    );
  });

  test("parses only a JSON object", () => {
    expect(parseLocaleText('{"a":"A"}')).toEqual({ a: "A" });
    expect(() => {
      return parseLocaleText("[]");
    }).toThrow();
    expect(() => {
      return parseLocaleText("not json");
    }).toThrow();
  });

  test("lists every leaf in file order with an id for nested ones", () => {
    const tree: LocaleTree = {
      navbar: { items: { formsTitle: "Forms" } },
      "Loading...": "Loading...",
    };

    expect(getLeaves(tree)).toEqual([
      { path: ["navbar", "items", "formsTitle"], value: "Forms" },
      { path: ["Loading..."], value: "Loading..." },
    ]);
    expect(getLeafId(["navbar", "items", "formsTitle"])).toBe(
      "navbar › items › formsTitle",
    );
    expect(getLeafId(["Loading..."])).toBe("Loading...");
    expect(getValueAt(tree, ["navbar", "items", "formsTitle"])).toBe("Forms");
    expect(getValueAt(tree, ["navbar", "missing"])).toBeUndefined();
    expect(getValueAt(tree, ["Loading...", "deeper"])).toBeUndefined();
  });

  test("reads placeholder names, sorted and distinct", () => {
    expect(
      getPlaceholders("{{b}} and {{ a }} then {{b}} - {{incident.title}}"),
    ).toEqual(["a", "b", "incident.title"]);
    expect(getPlaceholders("none here")).toEqual([]);
  });

  test("a plural base is a flat key with a _one sibling", () => {
    expect(
      getPluralBases({
        "{{count}} rows": "{{count}} rows",
        "{{count}} rows_one": "{{count}} row",
        Save_one: "orphan",
        nested: { x_one: "y" },
      }),
    ).toEqual(["{{count}} rows"]);
  });

  test("compares keys by code unit, the same everywhere", () => {
    const keys: Array<string> = ["b", "B", "a", "Ä", "_x", "A"];

    expect([...keys].sort(compareKeys)).toEqual([
      "A",
      "B",
      "_x",
      "a",
      "b",
      "Ä",
    ]);
    expect(compareKeys("a", "a")).toBe(0);
  });
});

describe("adding keys to en.json", () => {
  const ENGLISH: LocaleTree = {
    common: { save: "Save" },
    Monitors: "Monitors",
    Delete: "Delete",
    Incidents: "Incidents",
  };

  test("keeps every existing key where it is", () => {
    const { tree } = insertEnglishKeys(ENGLISH, { Create: "Create" });
    const keys: Array<string> = Object.keys(tree);

    expect(
      keys.filter((key: string): boolean => {
        return key !== "Create";
      }),
    ).toEqual(Object.keys(ENGLISH));
  });

  /*
   * Features keep their keys together in en.json, and their tests pin those
   * blocks, so a new key never lands inside one: it goes at the end.
   */
  test("puts new keys at the end of the file, in sorted order", () => {
    const { tree, added } = insertEnglishKeys(ENGLISH, {
      Deploy: "Deploy",
      "Monitors list": "Monitors list",
      "A first": "A first",
    });

    expect(Object.keys(tree)).toEqual([
      "common",
      "Monitors",
      "Delete",
      "Incidents",
      "A first",
      "Deploy",
      "Monitors list",
    ]);
    expect(added).toEqual(["A first", "Deploy", "Monitors list"]);
  });

  test("a file with no flat keys takes them after its objects", () => {
    const { tree } = insertEnglishKeys(
      { common: { save: "Save" } },
      { Zebra: "Zebra", Apple: "Apple" },
    );

    expect(Object.keys(tree)).toEqual(["common", "Apple", "Zebra"]);
  });

  test("never changes or repeats a key that exists", () => {
    const { tree, added } = insertEnglishKeys(ENGLISH, {
      Monitors: "Changed?",
    });

    expect(added).toEqual([]);
    expect(tree).toBe(ENGLISH);
  });

  test("the result does not depend on the order keys were found in", () => {
    const additions: Array<string> = [
      "Zone",
      "Alpha",
      "Monitor states",
      "Delete everything",
      "Incidents archived",
      "Beta",
    ];
    const serialize: (order: Array<string>) => string = (
      order: Array<string>,
    ): string => {
      const record: Record<string, string> = {};

      for (const key of order) {
        record[key] = key;
      }

      return serializeLocale(insertEnglishKeys(ENGLISH, record).tree);
    };

    const expected: string = serialize(additions);

    expect(serialize([...additions].reverse())).toBe(expected);
    expect(serialize([...additions].sort())).toBe(expected);
  });

  test("adding the same keys twice changes nothing the second time", () => {
    const once: LocaleTree = insertEnglishKeys(ENGLISH, {
      Alpha: "Alpha",
      Zulu: "Zulu",
    }).tree;
    const twice: { tree: LocaleTree; added: Array<string> } = insertEnglishKeys(
      once,
      { Alpha: "Alpha", Zulu: "Zulu" },
    );

    expect(twice.added).toEqual([]);
    expect(serializeLocale(twice.tree)).toBe(serializeLocale(once));
  });

  /*
   * Two branches that both add keys meet at the end of the file, which git
   * reports as a conflict; merging the two sides gives the same file one
   * extraction over both branches would have written.
   */
  test("keys added on two branches merge into what a run over both writes", () => {
    const ours: LocaleTree = insertEnglishKeys(ENGLISH, {
      "Monitors view": "Monitors view",
      Zone: "Zone",
    }).tree;
    const theirs: LocaleTree = insertEnglishKeys(ENGLISH, {
      Disable: "Disable",
      Alpha: "Alpha",
    }).tree;
    const both: string = serializeLocale(
      insertEnglishKeys(ENGLISH, {
        "Monitors view": "Monitors view",
        Zone: "Zone",
        Disable: "Disable",
        Alpha: "Alpha",
      }).tree,
    );

    expect(
      serializeLocale(
        mergeLocaleTrees({ ours: ours, theirs: theirs, base: ENGLISH }),
      ),
    ).toBe(both);
    // Whichever branch is merged into which.
    expect(
      serializeLocale(
        mergeLocaleTrees({ ours: theirs, theirs: ours, base: ENGLISH }),
      ),
    ).toBe(both);
  });
});

describe("plural forms in en.json", () => {
  test("the one form follows the source when its English changes", () => {
    const english: LocaleTree = {
      "{{count}} rows": "{{count}} rows",
      "{{count}} rows_one": "{{count}} row",
    };

    expect(
      updateEnglishPluralForms(english, {
        "{{count}} rows": "{{count}} rows",
        "{{count}} rows_one": "one row ({{count}})",
        "{{count}} cells_one": "{{count}} cell",
      }),
    ).toEqual(["{{count}} rows_one"]);
    expect(english["{{count}} rows_one"]).toBe("one row ({{count}})");
    expect(english["{{count}} cells_one"]).toBeUndefined();
  });
});

describe("adding nested keys", () => {
  const ENGLISH: LocaleTree = {
    common: { save: "Save", cancel: "Cancel" },
    navbar: { items: { formsTitle: "Forms" } },
    Monitors: "Monitors",
  };

  test("a new object goes after the last object, before the flat keys", () => {
    const { tree, added } = insertNestedEnglishKeys(ENGLISH, [
      { path: ["commandPalette", "actions", "logOut"], value: "Log out" },
      { path: ["commandPalette", "actions", "askAi"], value: "Ask AI" },
    ]);

    expect(Object.keys(tree)).toEqual([
      "common",
      "navbar",
      "commandPalette",
      "Monitors",
    ]);
    expect(tree["commandPalette"]).toEqual({
      actions: { askAi: "Ask AI", logOut: "Log out" },
    });
    expect(added).toEqual([
      "commandPalette.actions.askAi",
      "commandPalette.actions.logOut",
    ]);
  });

  test("a new key in an object goes after the key that sorts before it", () => {
    const { tree } = insertNestedEnglishKeys(ENGLISH, [
      { path: ["common", "close"], value: "Close" },
      { path: ["common", "apply"], value: "Apply" },
    ]);

    expect(Object.keys(tree["common"] as LocaleTree)).toEqual([
      "apply",
      "save",
      "cancel",
      "close",
    ]);
  });

  test("never changes an entry that exists", () => {
    const { tree, added } = insertNestedEnglishKeys(ENGLISH, [
      { path: ["common", "save"], value: "Store" },
    ]);

    expect(added).toEqual([]);
    expect(getValueAt(tree, ["common", "save"])).toBe("Save");
  });

  test("reports a path that runs through a string", () => {
    const { clashes, added } = insertNestedEnglishKeys(ENGLISH, [
      { path: ["Monitors", "title"], value: "Monitors" },
    ]);

    expect(clashes).toEqual(["Monitors.title"]);
    expect(added).toEqual([]);
  });
});

describe("lining a locale up with en.json", () => {
  const ENGLISH: LocaleTree = {
    navbar: { items: { formsTitle: "Forms", runbooksTitle: "Runbooks" } },
    Save: "Save",
    "{{count}} rows": "{{count}} rows",
    "{{count}} rows_one": "{{count}} row",
    Delete: "Delete",
  };

  test("mirrors en.json's order, keeps translations and adds English placeholders", () => {
    const aligned: AlignedLocale = alignLocale(ENGLISH, {
      Delete: "Löschen",
      navbar: {
        items: { runbooksTitle: "Runbooks", formsTitle: "Formulare" },
      },
      Save: "Speichern",
    });

    expect(serializeLocale(aligned.tree)).toBe(
      serializeLocale({
        navbar: {
          items: { formsTitle: "Formulare", runbooksTitle: "Runbooks" },
        },
        Save: "Speichern",
        "{{count}} rows": "{{count}} rows",
        "{{count}} rows_one": "{{count}} row",
        Delete: "Löschen",
      }),
    );
    expect(aligned.placeholdersAdded).toEqual([
      "{{count}} rows",
      "{{count}} rows_one",
    ]);
    expect(aligned.removed).toEqual([]);
  });

  /*
   * A locale holds exactly en.json's keys: the general form and the "_one"
   * form of a count-dependent sentence, whatever forms its language has.
   */
  test("adds no plural forms beyond en.json's", () => {
    expect(
      Object.keys(alignLocale(ENGLISH, {}).tree).filter((key: string) => {
        return key.includes("rows");
      }),
    ).toEqual(["{{count}} rows", "{{count}} rows_one"]);
  });

  test("drops what en.json does not have, and says so", () => {
    const aligned: AlignedLocale = alignLocale(ENGLISH, {
      Save: "Speichern",
      Gone: "Weg",
      navbar: { items: { oldTitle: "Alt" } },
      "{{count}} rows_few": "строки",
    });

    expect(aligned.removed).toEqual([
      "navbar › items › oldTitle",
      "Gone",
      "{{count}} rows_few",
    ]);
    expect(getValueAt(aligned.tree, ["Gone"])).toBeUndefined();
    expect(getValueAt(aligned.tree, ["{{count}} rows_few"])).toBeUndefined();
  });

  test("an object where en.json has a string becomes the English placeholder", () => {
    const aligned: AlignedLocale = alignLocale(ENGLISH, {
      Save: { nested: "?" },
    } as unknown as LocaleTree);

    expect(aligned.tree["Save"]).toBe("Save");
    expect(aligned.placeholdersAdded).toContain("Save");
  });

  test("lining up twice changes nothing the second time", () => {
    const once: LocaleTree = alignLocale(ENGLISH, { Save: "Speichern" }).tree;

    expect(serializeLocale(alignLocale(ENGLISH, once).tree)).toBe(
      serializeLocale(once),
    );
    expect(alignLocale(ENGLISH, once).placeholdersAdded).toEqual([]);
  });
});

const CONFLICTED: string = [
  "{",
  '  "Alpha": "Alpha DE",',
  "<<<<<<< HEAD",
  '  "Beta": "Beta DE",',
  '  "Delta": "Delta",',
  "=======",
  '  "Beta": "Beta",',
  '  "Gamma": "Gamma DE",',
  ">>>>>>> origin/master",
  '  "Omega": "Omega DE"',
  "}",
  "",
].join("\n");

describe("merge conflicts", () => {
  test("recognizes conflict markers", () => {
    expect(hasConflictMarkers(CONFLICTED)).toBe(true);
    expect(hasConflictMarkers('{\n  "a": "<<<<<<< not a marker"\n}\n')).toBe(
      false,
    );
  });

  test("splits a conflicted file into its two sides", () => {
    const sides: { ours: string; theirs: string } =
      splitConflictSides(CONFLICTED);

    expect(parseLocaleText(sides.ours)).toEqual({
      Alpha: "Alpha DE",
      Beta: "Beta DE",
      Delta: "Delta",
      Omega: "Omega DE",
    });
    expect(parseLocaleText(sides.theirs)).toEqual({
      Alpha: "Alpha DE",
      Beta: "Beta",
      Gamma: "Gamma DE",
      Omega: "Omega DE",
    });
  });

  test("drops the common ancestor of a diff3-style conflict", () => {
    const sides: { ours: string; theirs: string } = splitConflictSides(
      [
        "{",
        "<<<<<<< ours",
        '  "A": "1",',
        "||||||| base",
        '  "A": "0",',
        "=======",
        '  "A": "2",',
        ">>>>>>> theirs",
        '  "B": "B"',
        "}",
      ].join("\n"),
    );

    expect(parseLocaleText(sides.ours)).toEqual({ A: "1", B: "B" });
    expect(parseLocaleText(sides.theirs)).toEqual({ A: "2", B: "B" });
  });

  test("repairs the commas one side of a hunk leaves behind", () => {
    expect(
      parseConflictSide(["{", '  "A": "1"', '  "B": "2",', "}"].join("\n")),
    ).toEqual({ A: "1", B: "2" });
    expect(
      parseConflictSide(
        ["{", '  "A": { "x": "1" }', '  "B": "2"', "}"].join("\n"),
      ),
    ).toEqual({ A: { x: "1" }, B: "2" });
  });

  test("a two-way merge keeps every key and prefers a translation over English", () => {
    const english: LocaleTree = {
      Alpha: "Alpha",
      Beta: "Beta",
      Gamma: "Gamma",
      Delta: "Delta",
      Omega: "Omega",
    };
    const sides: { ours: string; theirs: string } =
      splitConflictSides(CONFLICTED);
    const merged: LocaleTree = mergeLocaleTrees({
      ours: parseConflictSide(sides.ours),
      theirs: parseConflictSide(sides.theirs),
      english: english,
    });

    expect(merged).toEqual({
      Alpha: "Alpha DE",
      Beta: "Beta DE",
      Delta: "Delta",
      Gamma: "Gamma DE",
      Omega: "Omega DE",
    });
    expect(Object.keys(merged)).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Gamma",
      "Omega",
    ]);
  });

  test("with the common ancestor, a one-sided change or deletion wins", () => {
    const base: LocaleTree = { A: "a", B: "b", C: "c", D: "d" };
    const ours: LocaleTree = { A: "a2", B: "b", D: "d" };
    const theirs: LocaleTree = { A: "a", B: "b3", C: "c", D: "d", E: "e" };

    expect(mergeLocaleTrees({ ours, theirs, base })).toEqual({
      A: "a2",
      B: "b3",
      D: "d",
      E: "e",
    });
  });

  test("a key deleted on one side but changed on the other is kept", () => {
    const base: LocaleTree = { A: "a" };

    expect(
      mergeLocaleTrees({ ours: {}, theirs: { A: "changed" }, base }),
    ).toEqual({ A: "changed" });
  });

  test("merges nested objects key by key", () => {
    expect(
      mergeLocaleTrees({
        ours: { navbar: { a: "A", b: "B" } },
        theirs: { navbar: { b: "B", c: "C" } },
        base: { navbar: { b: "B" } },
      }),
    ).toEqual({ navbar: { a: "A", b: "B", c: "C" } });
  });

  test("both changed the same value: the translation wins, then ours", () => {
    const english: LocaleTree = { A: "Alpha" };

    expect(
      mergeLocaleTrees({
        ours: { A: "Alpha" },
        theirs: { A: "Alfa" },
        base: { A: "Alfa?" },
        english,
      }),
    ).toEqual({ A: "Alfa" });
    expect(
      mergeLocaleTrees({
        ours: { A: "Alpha 1" },
        theirs: { A: "Alpha 2" },
        base: { A: "Alpha 0" },
        english,
      }),
    ).toEqual({ A: "Alpha 1" });
  });

  test("uses git's stages of the file while the merge is in progress", () => {
    const stages: Record<number, string> = {
      1: serializeLocale({ A: "a", B: "b" }),
      2: serializeLocale({ A: "a", B: "b", C: "c" }),
      3: serializeLocale({ B: "b", D: "d" }),
    };
    const readStage: StageReader = (
      _filePath: string,
      stage: 1 | 2 | 3,
    ): string | undefined => {
      return stages[stage];
    };

    expect(
      resolveConflictedLocaleText({
        filePath: "/x/de.json",
        text: CONFLICTED,
        readStage: readStage,
      }),
    ).toEqual({ B: "b", C: "c", D: "d" });
  });

  test("falls back to the markers in the file when git has no stages", () => {
    const resolved: LocaleTree = resolveConflictedLocaleText({
      filePath: "/x/de.json",
      text: CONFLICTED,
      readStage: (): undefined => {
        return undefined;
      },
    });

    expect(Object.keys(resolved)).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Gamma",
      "Omega",
    ]);
  });
});

describe("locale files on disk", () => {
  let directory: string = "";

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-locales-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("reads a clean file as it is", () => {
    fs.writeFileSync(
      path.join(directory, "de.json"),
      serializeLocale({ Save: "Speichern" }),
    );

    const result: ReadLocaleResult = readLocaleFile("de", {
      directory: directory,
    });

    expect(result).toEqual({
      tree: { Save: "Speichern" },
      hadConflicts: false,
    });
  });

  test("reads a conflicted file as the merge of both sides", () => {
    fs.writeFileSync(path.join(directory, "de.json"), CONFLICTED);

    const result: ReadLocaleResult = readLocaleFile("de", {
      directory: directory,
      readStage: (): undefined => {
        return undefined;
      },
    });

    expect(result.hadConflicts).toBe(true);
    expect(result.tree["Gamma"]).toBe("Gamma DE");
  });

  test("writes only when the text changes", () => {
    expect(writeLocaleFile("de", { Save: "Speichern" }, directory)).toBe(true);

    const first: number = fs.statSync(path.join(directory, "de.json")).mtimeMs;

    expect(writeLocaleFile("de", { Save: "Speichern" }, directory)).toBe(false);
    expect(fs.statSync(path.join(directory, "de.json")).mtimeMs).toBe(first);
    expect(fs.readFileSync(path.join(directory, "de.json"), "utf8")).toBe(
      serializeLocale({ Save: "Speichern" }),
    );
  });
});
