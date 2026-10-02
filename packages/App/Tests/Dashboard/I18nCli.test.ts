import {
  CheckResult,
  ExtractSummary,
  getCheckResult,
  getHardcodedGroup,
  getHardcodedStrings,
  I18nContext,
  main,
  parseArguments,
  runApply,
  runBaseline,
  runCheck,
  runExport,
  runExtract,
  runHardcoded,
} from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import {
  LocaleTree,
  serializeLocale,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  readLocaleProgress,
  serializeLocaleProgress,
  serializeSameAsEnglish,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The npm run i18n:* commands, end to end, against a throwaway repository:
 * a few source files, an en.json, two locales (German and Russian, which has
 * more plural forms) and their tracking files.
 */

let repository: string = "";
let output: Array<string> = [];

const localesDirectory: () => string = (): string => {
  return path.join(repository, "Locales");
};

const trackingDirectory: () => string = (): string => {
  return path.join(repository, "i18n");
};

const context: () => I18nContext = (): I18nContext => {
  return {
    repositoryRoot: repository,
    localesDirectory: localesDirectory(),
    trackingDirectory: trackingDirectory(),
    sourceRoots: [
      { directory: "src", kind: "ui" },
      { directory: "models", kind: "models" },
    ],
    locales: ["de", "ru"],
    readStage: (): undefined => {
      return undefined;
    },
    write: (text: string): void => {
      output.push(text);
    },
  };
};

const write: (relativePath: string, content: string) => void = (
  relativePath: string,
  content: string,
): void => {
  const filePath: string = path.join(repository, relativePath);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

const read: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(repository, relativePath), "utf8");
};

const readJson: (relativePath: string) => LocaleTree = (
  relativePath: string,
): LocaleTree => {
  return JSON.parse(read(relativePath)) as LocaleTree;
};

const printed: () => string = (): string => {
  return output.join("");
};

beforeEach(() => {
  repository = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-cli-"));
  output = [];

  write(
    "src/Pages/Monitors.tsx",
    `
      const ROWS = { one: "{{count}} monitor", other: "{{count}} monitors" };
      export default () => {
        return (
          <Card title="Monitors" description="Every monitor in the project.">
            <p>No monitors yet.</p>
            <button title="Refresh">{translateString("Refresh now")}</button>
            <span>{t("commandPalette.actions.logOut", "Log out")}</span>
          </Card>
        );
      };
    `,
  );
  write(
    "models/Monitor.ts",
    `@TableMetadata({ singularName: "Monitor", pluralName: "Monitors" }) class Monitor {
      @TableColumn({ title: "Monitor Type", description: "Not for the dashboard" })
      public monitorType?: string = undefined;
    }`,
  );
  write(
    "Locales/en.json",
    serializeLocale({ common: { save: "Save" }, Monitors: "Monitors" }),
  );
  write(
    "Locales/de.json",
    serializeLocale({ common: { save: "Speichern" }, Monitors: "Monitore" }),
  );
  write(
    "Locales/ru.json",
    serializeLocale({ common: { save: "Сохранить" }, Monitors: "Мониторы" }),
  );
  write("i18n/SameAsEnglish.json", serializeSameAsEnglish(["OneUptime"]));
});

afterEach(() => {
  fs.rmSync(repository, { recursive: true, force: true });
});

describe("i18n:extract", () => {
  test("adds the new strings to en.json and English placeholders to every locale", () => {
    const summary: ExtractSummary = runExtract(context());
    const english: LocaleTree = readJson("Locales/en.json");

    expect(english).toEqual({
      common: { save: "Save" },
      commandPalette: { actions: { logOut: "Log out" } },
      "Every monitor in the project.": "Every monitor in the project.",
      Monitor: "Monitor",
      "Monitor Type": "Monitor Type",
      Monitors: "Monitors",
      "No monitors yet.": "No monitors yet.",
      Refresh: "Refresh",
      "Refresh now": "Refresh now",
      "{{count}} monitors": "{{count}} monitors",
      "{{count}} monitors_one": "{{count}} monitor",
    });
    expect(Object.keys(english)).toEqual([
      "common",
      "commandPalette",
      "Every monitor in the project.",
      "Monitor",
      "Monitor Type",
      "Monitors",
      "No monitors yet.",
      "Refresh",
      "Refresh now",
      "{{count}} monitors",
      "{{count}} monitors_one",
    ]);
    expect(summary.addedKeys.length).toBe(8);
    expect(summary.addedNestedKeys).toEqual(["commandPalette.actions.logOut"]);

    // German keeps its translations and gains placeholders, in en.json's order.
    const german: LocaleTree = readJson("Locales/de.json");

    expect(Object.keys(german)).toEqual(Object.keys(english));
    expect(german["Monitors"]).toBe("Monitore");
    expect(german["Refresh now"]).toBe("Refresh now");

    // Russian also gets its few and many forms.
    expect(Object.keys(readJson("Locales/ru.json")).slice(-4)).toEqual([
      "{{count}} monitors",
      "{{count}} monitors_one",
      "{{count}} monitors_few",
      "{{count}} monitors_many",
    ]);
    expect(printed()).toContain("en.json: 8 new keys, 1 new nested keys");
  });

  test("running it again changes nothing", () => {
    runExtract(context());

    const before: Array<string> = ["en", "de", "ru"].map((code: string) => {
      return read(`Locales/${code}.json`);
    });

    output = [];

    const summary: ExtractSummary = runExtract(context());

    expect(summary.addedKeys).toEqual([]);
    expect(summary.changedFiles).toEqual([]);
    expect(printed()).toContain("Every locale file was already up to date.");
    expect(
      ["en", "de", "ru"].map((code: string) => {
        return read(`Locales/${code}.json`);
      }),
    ).toEqual(before);
  });

  test("a dry run writes nothing", () => {
    const before: string = read("Locales/en.json");
    const summary: ExtractSummary = runExtract(context(), { dryRun: true });

    expect(summary.addedKeys.length).toBe(8);
    expect(read("Locales/en.json")).toBe(before);
    expect(printed()).toContain("Dry run: nothing written.");
  });

  test("puts a locale file git could not merge back together", () => {
    runExtract(context());

    const german: string = read("Locales/de.json");
    const conflicted: string = german.replace(
      '  "Refresh now": "Refresh now",\n',
      [
        "<<<<<<< HEAD",
        '  "Refresh now": "Jetzt aktualisieren",',
        "=======",
        '  "Refresh now": "Refresh now",',
        '  "Stale": "Gone from en.json",',
        ">>>>>>> origin/master",
        "",
      ].join("\n"),
    );

    write("Locales/de.json", conflicted);
    output = [];

    const summary: ExtractSummary = runExtract(context());

    expect(summary.resolvedConflicts).toEqual(["de.json"]);
    expect(readJson("Locales/de.json")["Refresh now"]).toBe(
      "Jetzt aktualisieren",
    );
    expect(readJson("Locales/de.json")["Stale"]).toBeUndefined();
    expect(summary.removedKeys["de"]).toEqual(["Stale"]);
    expect(printed()).toContain("Merged both sides of: de.json.");
  });

  test("reports a nested key that no call gives English for", () => {
    write("src/Pages/Nav.tsx", `const a = t("navbar.items.unknownTitle");`);

    const summary: ExtractSummary = runExtract(context());

    expect(summary.undefinedNestedKeys).toEqual([
      expect.objectContaining({ path: ["navbar", "items", "unknownTitle"] }),
    ]);
    expect(printed()).toContain(
      "Undefined nested key navbar.items.unknownTitle at src/Pages/Nav.tsx:1",
    );
  });
});

describe("i18n:check", () => {
  beforeEach(() => {
    runExtract(context());
    output = [];
  });

  test("reports each locale and passes a sound tree", () => {
    const result: CheckResult = getCheckResult(context());

    expect(result.exitCode).toBe(0);
    expect(
      result.locales.map((locale: CheckResult["locales"][number]) => {
        return [
          locale.status.locale,
          locale.status.keys,
          locale.status.untranslated.length,
          locale.baselineRegression,
        ];
      }),
    ).toEqual([
      // 11 keys in en.json; German translated two of them.
      ["de", 11, 9, undefined],
      // The same 11, and a few and a many form of the plural.
      ["ru", 13, 11, undefined],
    ]);

    expect(runCheck(context())).toBe(0);
    expect(printed()).toContain("Every locale file is sound");
    expect(printed()).toContain("none recorded");
  });

  test("lists the untranslated keys, for one locale", () => {
    expect(runCheck(context(), { locales: ["de"], list: true })).toBe(0);
    expect(printed()).toContain("de\tRefresh now");
    expect(printed()).not.toContain("ru\t");
  });

  test("prints JSON for scripts", () => {
    runCheck(context(), { json: true, list: true });

    const report: {
      locales: Array<{ locale: string; untranslatedKeys: Array<unknown> }>;
      exitCode: number;
    } = JSON.parse(printed());

    expect(report.exitCode).toBe(0);
    expect(report.locales[0]?.locale).toBe("de");
    expect(report.locales[0]?.untranslatedKeys.length).toBe(9);
  });

  test("fails on a broken placeholder or a file out of order", () => {
    const german: LocaleTree = readJson("Locales/de.json");

    german["{{count}} monitors"] = "Monitore";
    write("Locales/de.json", serializeLocale(german));

    expect(getCheckResult(context()).exitCode).toBe(1);
    expect(runCheck(context())).toBe(1);
    expect(printed()).toContain('de: placeholders "{{count}} monitors"');
  });

  test("fails when a translation was lost against the baseline", () => {
    expect(runBaseline(context())).toBe(0);

    const german: LocaleTree = readJson("Locales/de.json");

    german["Monitors"] = "Monitors";
    write("Locales/de.json", serializeLocale(german));

    const result: CheckResult = getCheckResult(context());

    expect(result.exitCode).toBe(1);
    expect(result.locales[0]?.baselineRegression).toBe(1);
  });

  test("fails on a file that is not JSON", () => {
    write("Locales/ru.json", "{ not json");

    const result: CheckResult = getCheckResult(context());

    expect(result.exitCode).toBe(1);
    expect(result.locales[1]?.status.problems[0]?.detail).toContain(
      "not valid JSON",
    );
  });
});

describe("i18n:export and i18n:apply", () => {
  beforeEach(() => {
    runExtract(context());
    output = [];
  });

  test("exports what is left to translate, in pages", () => {
    const out: string = path.join(repository, "de-untranslated.json");

    expect(
      runExport(context(), { locale: "de", limit: 3, offset: 1, out: out }),
    ).toBe(0);

    const exported: Record<string, string> = JSON.parse(
      fs.readFileSync(out, "utf8"),
    );

    expect(Object.keys(exported).length).toBe(3);
    expect(printed()).toContain("Wrote 3 of 9 untranslated de strings");

    output = [];
    runExport(context(), { locale: "de" });

    expect(Object.keys(JSON.parse(printed())).length).toBe(9);
  });

  test("applies translations, checking each one", () => {
    const file: string = path.join(repository, "de-translations.json");

    fs.writeFileSync(
      file,
      JSON.stringify({
        "Refresh now": "Jetzt aktualisieren",
        "{{count}} monitors": "{{count}} Monitore",
        "{{count}} monitors_one": "{{count}} Monitor",
        "commandPalette › actions › logOut": "Abmelden",
        Refresh: "Refresh",
        "No such key": "Kein Schlüssel",
        "Every monitor in the project.": "{{oops}} Monitor",
        Monitor: "",
      }),
    );

    const result: ReturnType<typeof runApply> = runApply(context(), {
      locale: "de",
      file: file,
    });

    expect(result.applied).toBe(4);
    expect(
      result.rejected.map((rejection: { key: string }) => {
        return rejection.key;
      }),
    ).toEqual([
      "Refresh",
      "No such key",
      "Every monitor in the project.",
      "Monitor",
    ]);
    expect(result.exitCode).toBe(1);

    const german: LocaleTree = readJson("Locales/de.json");

    expect(german["Refresh now"]).toBe("Jetzt aktualisieren");
    expect(german["{{count}} monitors_one"]).toBe("{{count}} Monitor");
    expect(
      (german["commandPalette"] as Record<string, Record<string, string>>)[
        "actions"
      ]?.["logOut"],
    ).toBe("Abmelden");
    // Still canonical and still sound.
    expect(getCheckResult(context(), { locales: ["de"] }).exitCode).toBe(0);
  });

  test("records a value that reads the same in the language", () => {
    const file: string = path.join(repository, "de-same.json");

    fs.writeFileSync(file, JSON.stringify({ Refresh: "Refresh" }));

    const result: ReturnType<typeof runApply> = runApply(context(), {
      locale: "de",
      file: file,
      sameAsEnglish: true,
    });

    expect(result.recordedSameAsEnglish).toBe(1);
    expect(
      readLocaleProgress("de", path.join(trackingDirectory(), "Progress"))
        ?.sameAsEnglish,
    ).toEqual(["Refresh"]);
    expect(
      getCheckResult(context(), {
        locales: ["de"],
      }).locales[0]?.status.untranslated.map((entry: { key: string }) => {
        return entry.key;
      }),
    ).not.toContain("Refresh");
  });

  test("refuses a locale it does not know", () => {
    expect(() => {
      return runApply(context(), { locale: "xx", file: "none.json" });
    }).toThrow('Unknown locale "xx"');
  });
});

describe("i18n:baseline", () => {
  beforeEach(() => {
    runExtract(context());
    output = [];
  });

  test("records each locale's keys and untranslated count", () => {
    expect(runBaseline(context())).toBe(0);
    expect(read("i18n/Progress/de.json")).toBe(
      serializeLocaleProgress({
        baseline: { keys: 11, untranslated: 9 },
        sameAsEnglish: [],
      }),
    );
    expect(printed()).toContain("de: baseline 9 untranslated of 11 keys.");
  });

  test("keeps a locale's same-as-English list", () => {
    write(
      "i18n/Progress/de.json",
      serializeLocaleProgress({
        baseline: { keys: 0, untranslated: 0 },
        sameAsEnglish: ["Refresh"],
      }),
    );

    runBaseline(context(), { locales: ["de"] });

    expect(
      readLocaleProgress("de", path.join(trackingDirectory(), "Progress")),
    ).toEqual({
      baseline: { keys: 11, untranslated: 8 },
      sameAsEnglish: ["Refresh"],
    });
  });

  test("will not record lost translations unless forced", () => {
    runBaseline(context());

    const german: LocaleTree = readJson("Locales/de.json");

    german["Monitors"] = "Monitors";
    write("Locales/de.json", serializeLocale(german));
    output = [];

    expect(runBaseline(context(), { locales: ["de"] })).toBe(1);
    expect(printed()).toContain("1 translations were lost");
    expect(runBaseline(context(), { locales: ["de"], force: true })).toBe(0);
  });

  test("will not record a broken file", () => {
    const german: LocaleTree = readJson("Locales/de.json");

    delete german["Refresh"];
    write("Locales/de.json", serializeLocale(german));

    expect(runBaseline(context(), { locales: ["de"] })).toBe(1);
    expect(printed()).toContain("fix its 1 problems first");
  });
});

describe("i18n:hardcoded", () => {
  test("lists the strings not looked up at run time", () => {
    expect(runHardcoded(context())).toBe(0);
    expect(printed()).toContain(
      "src/Pages/Monitors.tsx:6\tjsx-text\tNo monitors yet.",
    );
    expect(printed()).toContain("html-attribute\tRefresh");
  });

  test("narrows to a directory and sums it up", () => {
    write("src/Other/Page.tsx", `const a = <p>Elsewhere</p>;`);

    expect(
      getHardcodedStrings(context(), { directory: "src/Pages" }).every(
        (entry: { file: string }) => {
          return entry.file.startsWith("src/Pages/");
        },
      ),
    ).toBe(true);

    runHardcoded(context(), { summary: true });

    expect(printed()).toContain("src/Pages");
    expect(printed()).toContain("src/Other");
  });

  test("groups the Dashboard two levels below src", () => {
    expect(
      getHardcodedGroup(
        "packages/App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index.tsx",
      ),
    ).toBe("Pages/Ceph");
    expect(
      getHardcodedGroup("packages/App/FeatureSet/Dashboard/src/App.tsx"),
    ).toBe("App.tsx");
    expect(
      getHardcodedGroup(
        "packages/Common/UI/Components/Forms/Fields/FormField.tsx",
      ),
    ).toBe("packages/Common/UI/Components/Forms");
  });
});

describe("the command line", () => {
  test("parses commands and flags", () => {
    const parsed: ReturnType<typeof parseArguments> = parseArguments([
      "check",
      "--locale",
      "de,ru",
      "--list",
      "--limit=5",
    ]);

    expect(parsed.command).toBe("check");
    expect(parsed.flags.get("locale")).toEqual(["de,ru"]);
    expect(parsed.flags.get("list")).toEqual(["true"]);
    expect(parsed.flags.get("limit")).toEqual(["5"]);
  });

  test("runs a command and returns its exit code", () => {
    expect(main(["extract", "--dry-run"], context())).toBe(0);
    expect(main(["check", "--locale", "de"], context())).toBe(0);

    write("Locales/de.json", serializeLocale({ Monitors: "Monitore" }));

    expect(main(["check", "--locale", "de"], context())).toBe(1);
  });

  test("rejects an unknown locale and an incomplete export or apply", () => {
    expect(main(["check", "--locale", "xx"], context())).toBe(2);
    expect(main(["export"], context())).toBe(2);
    expect(main(["apply", "--locale", "de"], context())).toBe(2);
  });

  test("prints its usage for help or an unknown command", () => {
    expect(main([], context())).toBe(0);
    expect(main(["help"], context())).toBe(0);
    expect(main(["translate-everything"], context())).toBe(2);
    expect(printed()).toContain("i18n:extract");
  });
});
