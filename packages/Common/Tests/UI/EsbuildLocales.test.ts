import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createRuntimeLocalesPlugin,
  getRuntimeLocale,
  isLocaleTree,
  RUNTIME_LOCALES_PLUGIN_NAME,
  RuntimeLocalesPluginOptions,
  RuntimeLocaleTree,
  withoutFallbackEntries,
  withoutIdentityEntries,
} from "../../UI/esbuild-locales";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "../../Types/Dashboard/DashboardLanguage";

/*
 * What the Dashboard bundles of its locale files (UI/esbuild-locales.js).
 *
 * src/Locales/en.json holds every Dashboard string, nearly all of them
 * "text": "text", and is in the entry chunk; every other locale is a lazy
 * chunk with an English placeholder for each string it has not translated.
 * The plugin ships en.json without the entries that map to themselves and
 * every other locale without the strings equal to the English, since the
 * lookup renders the same English without them (Tests/App/Dashboard/
 * DashboardRuntimeLocales proves that against i18next).
 *
 * The transforms run here in-process. The plugin runs in a node SUBPROCESS,
 * the way the build loads it: esbuild refuses to load under Common's jsdom
 * test environment (see EsbuildConfig.test.ts). The builds use the real
 * createConfig and load the output as ES modules, the way a browser does,
 * and the last block builds the real locale files with the Dashboard's own
 * esbuild.config.js.
 */

const UI_DIR: string = path.resolve(__dirname, "..", "..", "UI");
const ESBUILD_CONFIG: string = path.join(UI_DIR, "esbuild-config.js");
const ESBUILD_LOCALES: string = path.join(UI_DIR, "esbuild-locales.js");
const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const DASHBOARD_DIR: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
);
const DASHBOARD_LOCALES: string = path.join(DASHBOARD_DIR, "src", "Locales");

// A build in a child process, and loading what it wrote, takes a while.
const BUILD_TIMEOUT_MS: number = 5 * 60 * 1000;

const LAZY_CODES: Array<string> = SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter(
  (code: string): boolean => {
    return code !== DEFAULT_DASHBOARD_LANGUAGE;
  },
);

const temporaryRoots: Array<string> = [];

afterAll(() => {
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop() as string, {
      recursive: true,
      force: true,
    });
  }
});

function makeTempDir(prefix: string): string {
  // realpath: macOS-style /tmp symlinks must not make paths compare unequal.
  const root: string = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  temporaryRoots.push(root);
  return root;
}

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeJson(filePath: string, value: unknown): void {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

type ChildEnvironment = Record<string, string>;

function childEnvironment(
  overrides: Record<string, string | null>,
): ChildEnvironment {
  const environment: ChildEnvironment = {};

  for (const key of Object.keys(process.env)) {
    const value: string | undefined = process.env[key];

    if (typeof value === "string") {
      environment[key] = value;
    }
  }

  for (const key of [
    "ONEUPTIME_EDITION",
    "ONEUPTIME_EE_DIR",
    "NODE_ENV",
    "analyze",
  ]) {
    delete environment[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete environment[key];
    } else {
      environment[key] = value;
    }
  }

  return environment;
}

// The child prints one JSON line last; anything a config logs comes before.
function runNode(data: {
  script: string;
  cwd: string;
  env?: Record<string, string | null>;
  preload?: string;
}): unknown {
  const output: string = childProcess
    .execFileSync(
      process.execPath,
      [...(data.preload ? ["-r", data.preload] : []), "-e", data.script],
      {
        cwd: data.cwd,
        encoding: "utf8",
        env: childEnvironment(data.env || {}),
        maxBuffer: 256 * 1024 * 1024,
      },
    )
    .trim();
  const lines: Array<string> = output.split("\n");

  return JSON.parse(lines[lines.length - 1] as string);
}

// Deep-frozen, so a transform that writes to its input throws.
function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      frozen(child);
    }

    Object.freeze(value);
  }

  return value;
}

// The paths at which two trees differ, for a readable failure.
function treeDifferences(
  actual: unknown,
  expected: unknown,
  prefix: string = "",
): Array<string> {
  if (!isLocaleTree(actual) || !isLocaleTree(expected)) {
    return actual === expected
      ? []
      : [`${prefix || "(root)"}: ${JSON.stringify(actual)}`];
  }

  const differences: Array<string> = [];
  const actualKeys: Array<string> = Object.keys(actual);
  const expectedKeys: Array<string> = Object.keys(expected);

  for (const key of expectedKeys) {
    const childPath: string = prefix ? `${prefix} › ${key}` : key;

    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      differences.push(`${childPath}: missing`);
    } else {
      differences.push(
        ...treeDifferences(actual[key], expected[key], childPath),
      );
    }
  }

  for (const key of actualKeys) {
    if (!Object.prototype.hasOwnProperty.call(expected, key)) {
      differences.push(`${prefix ? `${prefix} › ` : ""}${key}: unexpected`);
    }
  }

  if (
    differences.length === 0 &&
    actualKeys.join("\u0000") !== expectedKeys.join("\u0000")
  ) {
    differences.push(`${prefix || "(root)"}: keys out of order`);
  }

  return differences;
}

describe("withoutIdentityEntries: what en.json ships", () => {
  test("drops every flat entry whose value is its own key", () => {
    const english: RuntimeLocaleTree = frozen({
      Save: "Save",
      "Loading...": "Loading...",
      "Note: this cannot be undone.": "Note: this cannot be undone.",
      "Delete {{itemName}}": "Delete {{itemName}}",
      "{{count}} monitors": "{{count}} monitors",
      μs: "μs",
      "← Back": "← Back",
      "📢 Announcement Updated: {{announcementTitle}}":
        "📢 Announcement Updated: {{announcementTitle}}",
    });

    expect(withoutIdentityEntries(english)).toEqual({});
  });

  test("keeps nested objects whole, a leaf that reads like its key included", () => {
    /*
     * t("common.save") answers a missing entry with "common.save", not with
     * the text, so nothing under a nested key may go.
     */
    const english: RuntimeLocaleTree = frozen({
      common: { save: "Save", Cancel: "Cancel" },
      navbar: { items: { formsTitle: "Forms", Forms: "Forms" } },
      Save: "Save",
    });

    expect(withoutIdentityEntries(english)).toEqual({
      common: { save: "Save", Cancel: "Cancel" },
      navbar: { items: { formsTitle: "Forms", Forms: "Forms" } },
    });
  });

  test("keeps plural _one forms and every value that differs from its key", () => {
    const english: RuntimeLocaleTree = frozen({
      "{{count}} monitors": "{{count}} monitors",
      "{{count}} monitors_one": "{{count}} monitor",
      "{{count}} {{itemsName}} Selected": "{{count}} {{itemsName}} Selected",
      "{{count}} {{itemsName}} Selected_one": "{{count}} {{itemName}} Selected",
      legacyTitle: "Legacy title",
      "Save ": "Save",
      save: "Save",
    });

    expect(withoutIdentityEntries(english)).toEqual({
      "{{count}} monitors_one": "{{count}} monitor",
      "{{count}} {{itemsName}} Selected_one": "{{count}} {{itemName}} Selected",
      legacyTitle: "Legacy title",
      "Save ": "Save",
      save: "Save",
    });
  });

  test("keeps every {{placeholder}} and the order of what it keeps", () => {
    const english: RuntimeLocaleTree = frozen({
      zeta: "Zeta {{value}}",
      Save: "Save",
      "{{field}} is between {{start}} and {{end}}_one":
        "{{field}} is between {{start}} and {{end}}",
      alpha: { "{{count}} rows": "{{count}} rows" },
    });

    const shipped: RuntimeLocaleTree = withoutIdentityEntries(english);

    expect(Object.keys(shipped)).toEqual([
      "zeta",
      "{{field}} is between {{start}} and {{end}}_one",
      "alpha",
    ]);
    expect(shipped["zeta"]).toBe("Zeta {{value}}");
    expect(shipped["{{field}} is between {{start}} and {{end}}_one"]).toBe(
      "{{field}} is between {{start}} and {{end}}",
    );
    expect(shipped["alpha"]).toEqual({ "{{count}} rows": "{{count}} rows" });
  });

  test("leaves its input as it was and returns a new object", () => {
    const english: RuntimeLocaleTree = frozen({
      Save: "Save",
      common: { save: "Save" },
    });

    const shipped: RuntimeLocaleTree = withoutIdentityEntries(english);

    expect(shipped).not.toBe(english);
    expect(english).toEqual({ Save: "Save", common: { save: "Save" } });
  });

  test("an empty file ships empty", () => {
    expect(withoutIdentityEntries({})).toEqual({});
  });
});

describe("withoutFallbackEntries: what every other locale ships", () => {
  const english: RuntimeLocaleTree = frozen({
    common: { save: "Save", cancel: "Cancel" },
    navbar: { items: { formsTitle: "Forms", homeTitle: "Home" } },
    Save: "Save",
    Status: "Status",
    "Delete {{itemName}}": "Delete {{itemName}}",
    "{{count}} monitors": "{{count}} monitors",
    "{{count}} monitors_one": "{{count}} monitor",
  });

  test("drops the English placeholders and keeps the translations", () => {
    const german: RuntimeLocaleTree = frozen({
      common: { save: "Speichern", cancel: "Cancel" },
      navbar: { items: { formsTitle: "Forms", homeTitle: "Home" } },
      Save: "Speichern",
      Status: "Status",
      "Delete {{itemName}}": "Delete {{itemName}}",
      "{{count}} monitors": "{{count}} Monitore",
      "{{count}} monitors_one": "{{count}} Monitor",
    });

    expect(withoutFallbackEntries(german, english)).toEqual({
      common: { save: "Speichern" },
      Save: "Speichern",
      "{{count}} monitors": "{{count}} Monitore",
      "{{count}} monitors_one": "{{count}} Monitor",
    });
  });

  test("a _one form still in English goes, as a translated one stays", () => {
    // Japanese has no "one" form: its _one keys keep the English sentence.
    const japanese: RuntimeLocaleTree = frozen({
      "{{count}} monitors": "{{count}} 件のモニター",
      "{{count}} monitors_one": "{{count}} monitor",
    });

    expect(withoutFallbackEntries(japanese, english)).toEqual({
      "{{count}} monitors": "{{count}} 件のモニター",
    });
  });

  test("a value equal to its key but not to the English stays", () => {
    // "_one" holds a sentence of its own; its key is not its English.
    const odd: RuntimeLocaleTree = frozen({
      "{{count}} monitors_one": "{{count}} monitors_one",
    });

    expect(withoutFallbackEntries(odd, english)).toEqual({
      "{{count}} monitors_one": "{{count}} monitors_one",
    });
  });

  test("drops a nested object once every leaf in it is English", () => {
    const partly: RuntimeLocaleTree = frozen({
      common: { save: "Save", cancel: "Cancel" },
      navbar: { items: { formsTitle: "Formulare", homeTitle: "Home" } },
    });

    expect(withoutFallbackEntries(partly, english)).toEqual({
      navbar: { items: { formsTitle: "Formulare" } },
    });
  });

  test("keeps what the fallback lacks, or has in another shape", () => {
    const other: RuntimeLocaleTree = frozen({
      "Only here": "Nur hier",
      Save: { nested: "Save" },
      common: "Save",
      navbar: { items: { newTitle: "Neu" } },
    });

    expect(withoutFallbackEntries(other, english)).toEqual({
      "Only here": "Nur hier",
      Save: { nested: "Save" },
      common: "Save",
      navbar: { items: { newTitle: "Neu" } },
    });
  });

  test("compares exactly: case, spaces and Unicode form all count", () => {
    const close: RuntimeLocaleTree = frozen({
      Save: "save",
      Status: "Status ",
      "Delete {{itemName}}": "Delete {{ itemName }}",
      common: { save: "Savé", cancel: "Cancel" },
    });
    const fallback: RuntimeLocaleTree = frozen({
      ...english,
      common: { save: "Savé", cancel: "Cancel" },
    });

    expect(withoutFallbackEntries(close, fallback)).toEqual({
      Save: "save",
      Status: "Status ",
      "Delete {{itemName}}": "Delete {{ itemName }}",
      common: { save: "Savé" },
    });
  });

  test("keeps every {{placeholder}} of a translation where the locale put it", () => {
    const german: RuntimeLocaleTree = frozen({
      "Delete {{itemName}}": "{{itemName}} löschen",
      "{{count}} monitors": "Monitore: {{count}}",
    });

    expect(withoutFallbackEntries(german, english)).toEqual({
      "Delete {{itemName}}": "{{itemName}} löschen",
      "{{count}} monitors": "Monitore: {{count}}",
    });
  });

  test("leaves both inputs as they were", () => {
    const german: RuntimeLocaleTree = frozen({
      common: { save: "Speichern", cancel: "Cancel" },
      Save: "Save",
    });

    withoutFallbackEntries(german, english);

    expect(german).toEqual({
      common: { save: "Speichern", cancel: "Cancel" },
      Save: "Save",
    });
    expect(english["Save"]).toBe("Save");
  });

  test("without a fallback, every string stays and only empty objects go", () => {
    expect(
      withoutFallbackEntries(
        frozen({ Save: "Save", empty: {}, common: { save: "Save" } }),
        undefined,
      ),
    ).toEqual({ Save: "Save", common: { save: "Save" } });
  });
});

describe("getRuntimeLocale", () => {
  const english: RuntimeLocaleTree = frozen({
    Save: "Save",
    "{{count}} rows_one": "{{count}} row",
  });

  test("ships the fallback language without its identity entries", () => {
    expect(
      getRuntimeLocale({
        language: "en",
        fallbackLanguage: "en",
        locale: english,
      }),
    ).toEqual({ "{{count}} rows_one": "{{count}} row" });
  });

  test("ships another language without what the fallback reads the same", () => {
    expect(
      getRuntimeLocale({
        language: "de",
        fallbackLanguage: "en",
        locale: frozen({
          Save: "Speichern",
          "{{count}} rows_one": "{{count}} row",
        }),
        fallback: english,
      }),
    ).toEqual({ Save: "Speichern" });
  });

  test("refuses to ship another language without the fallback to compare with", () => {
    expect(() => {
      return getRuntimeLocale({
        language: "de",
        fallbackLanguage: "en",
        locale: { Save: "Speichern" },
      });
    }).toThrow("the en locale is needed to ship de");
  });

  test("refuses a locale that is not a JSON object", () => {
    expect(() => {
      return getRuntimeLocale({
        language: "de",
        fallbackLanguage: "en",
        locale: ["Save"] as unknown as RuntimeLocaleTree,
        fallback: english,
      });
    }).toThrow("the de locale is not a JSON object");
  });
});

describe("createRuntimeLocalesPlugin", () => {
  test("is an esbuild plugin named for what it does", () => {
    const plugin: { name: string; setup: unknown } = createRuntimeLocalesPlugin(
      {
        localesDirectory: DASHBOARD_LOCALES,
        fallbackLanguage: "en",
      },
    );

    expect(plugin.name).toBe(RUNTIME_LOCALES_PLUGIN_NAME);
    expect(typeof plugin.setup).toBe("function");
    // esbuild rejects a plugin object with any other property.
    expect(Object.keys(plugin).sort()).toEqual(["name", "setup"]);
  });

  test.each([
    [{ fallbackLanguage: "en" }, '"localesDirectory" is required'],
    [
      { localesDirectory: " ", fallbackLanguage: "en" },
      '"localesDirectory" is required',
    ],
    [
      { localesDirectory: "src/Locales", fallbackLanguage: "en" },
      '"localesDirectory" must be absolute (got "src/Locales")',
    ],
    [{ localesDirectory: DASHBOARD_LOCALES }, '"fallbackLanguage" is required'],
    [
      { localesDirectory: DASHBOARD_LOCALES, fallbackLanguage: "" },
      '"fallbackLanguage" is required',
    ],
  ])("refuses the options %j", (options: unknown, message: string) => {
    expect(() => {
      return createRuntimeLocalesPlugin(options as RuntimeLocalesPluginOptions);
    }).toThrow(message);
  });
});

/*
 * A fixture laid out like the Dashboard: src/Locales/<code>.json, English
 * imported statically and the rest through a template-literal dynamic import,
 * plus JSON the plugin must leave alone.
 */
const FIXTURE_ENGLISH: RuntimeLocaleTree = {
  common: { save: "Save", Cancel: "Cancel" },
  menu: { title: "Shared Menu Sentinel" },
  Save: "Save",
  "Loading...": "Loading...",
  "Delete {{itemName}}": "Delete {{itemName}}",
  "{{count}} monitors": "{{count}} monitors",
  "{{count}} monitors_one": "{{count}} monitor",
  legacyTitle: "Legacy Title Sentinel",
  IDENTITY_SENTINEL: "IDENTITY_SENTINEL",
};

const FIXTURE_GERMAN: RuntimeLocaleTree = {
  common: { save: "Speichern", Cancel: "Cancel" },
  menu: { title: "Shared Menu Sentinel" },
  Save: "Speichern",
  "Loading...": "Loading...",
  "Delete {{itemName}}": "{{itemName}} löschen",
  "{{count}} monitors": "{{count}} Monitore",
  "{{count}} monitors_one": "{{count}} monitor",
  legacyTitle: "Legacy Title Sentinel",
  IDENTITY_SENTINEL: "IDENTITY_SENTINEL",
};

const FIXTURE_JAPANESE: RuntimeLocaleTree = {
  common: { save: "Save", Cancel: "Cancel" },
  menu: { title: "Shared Menu Sentinel" },
  Save: "保存",
  "Loading...": "Loading...",
  "Delete {{itemName}}": "Delete {{itemName}}",
  "{{count}} monitors": "{{count}} monitors",
  "{{count}} monitors_one": "{{count}} monitor",
  legacyTitle: "Legacy Title Sentinel",
  IDENTITY_SENTINEL: "IDENTITY_SENTINEL",
};

interface Fixture {
  root: string;
  localesDirectory: string;
  entry: string;
  outdir: string;
}

function makeFixture(): Fixture {
  const root: string = makeTempDir("oneuptime-runtime-locales-");
  const src: string = path.join(root, "src");
  const localesDirectory: string = path.join(src, "Locales");

  writeJson(path.join(localesDirectory, "en.json"), FIXTURE_ENGLISH);
  writeJson(path.join(localesDirectory, "de.json"), FIXTURE_GERMAN);
  writeJson(path.join(localesDirectory, "ja.json"), FIXTURE_JAPANESE);
  writeFile(path.join(localesDirectory, "README.md"), "# Not a locale\n");

  // Shaped like a locale, but not in the locales directory.
  writeJson(path.join(src, "Data", "settings.json"), {
    Save: "Save",
    KEEP_SENTINEL: "KEEP_SENTINEL",
  });
  writeJson(path.join(src, "Other", "Locales", "en.json"), {
    Save: "Save",
    OTHER_SENTINEL: "OTHER_SENTINEL",
  });

  writeFile(
    path.join(src, "Utils", "Loader.ts"),
    `
    export const load = async (code: string): Promise<unknown> => {
      const imported: { default?: unknown } = await import(
        \`../Locales/\${code}.json\`
      );
      return imported.default;
    };
    `,
  );

  writeFile(
    path.join(src, "Index.ts"),
    `
    import en from "./Locales/en.json";
    import settings from "./Data/settings.json";
    import otherEnglish from "./Other/Locales/en.json";
    export { load } from "./Utils/Loader";
    export const english: unknown = en;
    export const data: unknown = settings;
    export const other: unknown = otherEnglish;
    `,
  );

  return {
    root,
    localesDirectory,
    entry: path.join(src, "Index.ts"),
    outdir: path.join(root, "out"),
  };
}

interface OutputShape {
  file: string;
  // The outputs it imports statically.
  imports: Array<string>;
  // Locale code -> bytes of that file in this output.
  locales: Record<string, number>;
}

interface OutputSummary extends OutputShape {
  text: string;
}

interface FixtureBuild {
  ok: boolean;
  error: string;
  english: unknown;
  lazy: Record<string, unknown>;
  data: unknown;
  other: unknown;
  outputs: Array<OutputSummary>;
}

/*
 * Summarizes a metafile's JS outputs in the child: the src/Locales files
 * each one carries, its static imports and its text.
 */
const SUMMARIZE_OUTPUTS: string = `
  function summarize(metafile, workingDir) {
    return Object.keys(metafile.outputs).filter(function (output) {
      return output.endsWith(".js");
    }).map(function (output) {
      const details = metafile.outputs[output];
      const locales = {};
      for (const input of Object.keys(details.inputs)) {
        const match = /(?:^|\\/)src\\/Locales\\/([^/]+)\\.json$/.exec(input);
        if (match) {
          locales[match[1]] = details.inputs[input].bytesInOutput;
        }
      }
      return {
        file: path.basename(output),
        imports: (details.imports || []).filter(function (item) {
          return item.kind === "import-statement";
        }).map(function (item) {
          return path.basename(item.path);
        }),
        locales: locales,
        text: fs.readFileSync(path.resolve(workingDir, output), "utf8"),
      };
    });
  }
`;

function buildFixture(
  fixture: Fixture,
  env: Record<string, string | null> = { NODE_ENV: "production" },
): FixtureBuild {
  const script: string = `
    const fs = require("fs");
    const path = require("path");
    const url = require("url");
    const { createConfig } = require(${JSON.stringify(ESBUILD_CONFIG)});
    const { createRuntimeLocalesPlugin } = require(${JSON.stringify(ESBUILD_LOCALES)});
    const esbuild = require(require.resolve("esbuild", {
      paths: [${JSON.stringify(UI_DIR)}],
    }));
    ${SUMMARIZE_OUTPUTS}

    (async function () {
      const outdir = ${JSON.stringify(fixture.outdir)};
      const config = createConfig({
        serviceName: "Fixture",
        publicPath: "/fixture/dist/",
        entryPoint: ${JSON.stringify(fixture.entry)},
        outdir: outdir,
        additionalPlugins: [
          createRuntimeLocalesPlugin({
            localesDirectory: ${JSON.stringify(fixture.localesDirectory)},
            fallbackLanguage: "en",
          }),
        ],
      });
      config.metafile = true;
      config.logLevel = "silent";
      // Chunks import each other through publicPath; relative, node finds them.
      delete config.publicPath;

      let result;
      try {
        result = await esbuild.build(config);
      } catch (error) {
        console.log(JSON.stringify({
          ok: false,
          error: String((error && error.message) || error),
        }));
        return;
      }

      // Load the bundle the way a browser would: as ES modules.
      fs.writeFileSync(path.join(outdir, "package.json"), '{"type":"module"}');
      const bundle = await import(url.pathToFileURL(path.join(outdir, "Index.js")).href);
      const lazy = {};
      for (const code of ["de", "ja"]) {
        lazy[code] = await bundle.load(code);
      }

      console.log(JSON.stringify({
        ok: true,
        error: "",
        english: bundle.english,
        lazy: lazy,
        data: bundle.data,
        other: bundle.other,
        outputs: summarize(result.metafile, process.cwd()),
      }));
    })();
  `;

  return runNode({ script, cwd: fixture.root, env }) as FixtureBuild;
}

function outputWithLocale<T extends OutputShape>(
  outputs: Array<T>,
  code: string,
): T {
  const found: Array<T> = outputs.filter((output: T): boolean => {
    return output.locales[code] !== undefined;
  });

  expect([code, found.length]).toEqual([code, 1]);

  return found[0] as T;
}

/*
 * What a page load downloads: the entry output (`entryFile`) and every output
 * it imports statically, transitively. Dynamic imports are not followed -
 * they are what keeps a chunk out of the first load. (In the metafile each
 * lazy chunk is an entry point of its own, so the entry goes by its name.)
 */
function entryClosure<T extends OutputShape>(
  outputs: Array<T>,
  entryFile: string,
): Array<T> {
  const byFile: Map<string, T> = new Map<string, T>(
    outputs.map((output: T): [string, T] => {
      return [output.file, output];
    }),
  );
  const closure: Map<string, T> = new Map<string, T>();
  const visit: (output: T | undefined) => void = (
    output: T | undefined,
  ): void => {
    if (!output || closure.has(output.file)) {
      return;
    }

    closure.set(output.file, output);

    for (const imported of output.imports) {
      visit(byFile.get(imported));
    }
  };

  expect([entryFile, byFile.has(entryFile)]).toEqual([entryFile, true]);
  visit(byFile.get(entryFile));

  return Array.from(closure.values());
}

function localesIn<T extends OutputShape>(outputs: Array<T>): Array<string> {
  return outputs.flatMap((output: T): Array<string> => {
    return Object.keys(output.locales);
  });
}

describe("bundling a fixture for real", () => {
  let production: FixtureBuild;

  beforeAll(() => {
    production = buildFixture(makeFixture());
  }, BUILD_TIMEOUT_MS);

  test("English ships without its identity entries", () => {
    expect([production.ok, production.error]).toEqual([true, ""]);
    expect(production.english).toEqual({
      common: { save: "Save", Cancel: "Cancel" },
      menu: { title: "Shared Menu Sentinel" },
      "{{count}} monitors_one": "{{count}} monitor",
      legacyTitle: "Legacy Title Sentinel",
    });
  });

  test("the lazy chunks ship only what differs from the English", () => {
    expect(production.lazy["de"]).toEqual({
      common: { save: "Speichern" },
      Save: "Speichern",
      "Delete {{itemName}}": "{{itemName}} löschen",
      "{{count}} monitors": "{{count}} Monitore",
    });
    expect(production.lazy["ja"]).toEqual({ Save: "保存" });
  });

  test("what it drops is nowhere in the bundle", () => {
    const text: string = production.outputs
      .map((output: OutputSummary): string => {
        return output.text;
      })
      .join("\n");

    expect(text).not.toContain("IDENTITY_SENTINEL");

    for (const code of ["de", "ja"]) {
      const chunk: string = outputWithLocale(production.outputs, code).text;

      expect([code, chunk.includes("Shared Menu Sentinel")]).toEqual([
        code,
        false,
      ]);
      expect([code, chunk.includes("Legacy Title Sentinel")]).toEqual([
        code,
        false,
      ]);
    }
  });

  test("other JSON, a Locales directory elsewhere included, is left to esbuild", () => {
    expect(production.data).toEqual({
      Save: "Save",
      KEEP_SENTINEL: "KEEP_SENTINEL",
    });
    expect(production.other).toEqual({
      Save: "Save",
      OTHER_SENTINEL: "OTHER_SENTINEL",
    });
  });

  test("English is in the entry bundle and every other locale in a chunk of its own", () => {
    const closure: Array<OutputSummary> = entryClosure(
      production.outputs,
      "Index.js",
    );

    expect(localesIn(closure)).toEqual(["en"]);

    for (const code of ["de", "ja"]) {
      const chunk: OutputSummary = outputWithLocale(production.outputs, code);

      expect([code, closure.includes(chunk)]).toEqual([code, false]);
      expect([code, Object.keys(chunk.locales)]).toEqual([code, [code]]);
    }
  });

  test(
    "a development build ships the same",
    () => {
      const development: FixtureBuild = buildFixture(makeFixture(), {});

      expect([development.ok, development.error]).toEqual([true, ""]);
      expect(development.english).toEqual(production.english);
      expect(development.lazy).toEqual(production.lazy);
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "a locale that is not JSON fails the build and names the file",
    () => {
      const fixture: Fixture = makeFixture();
      const germanPath: string = path.join(fixture.localesDirectory, "de.json");

      writeFile(
        germanPath,
        '{\n<<<<<<< HEAD\n  "Save": "Speichern"\n=======\n  "Save": "Sichern"\n>>>>>>> other\n}\n',
      );

      const result: FixtureBuild = buildFixture(fixture);

      expect(result.ok).toBe(false);
      expect(result.error).toContain(RUNTIME_LOCALES_PLUGIN_NAME);
      expect(result.error).toContain(`${germanPath} is not valid JSON`);
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "a locale that is not a JSON object fails the build",
    () => {
      const fixture: Fixture = makeFixture();

      writeFile(path.join(fixture.localesDirectory, "ja.json"), '["Save"]\n');

      const result: FixtureBuild = buildFixture(fixture);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("must hold a JSON object of translations");
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "a broken English file fails the build of the other locales too",
    () => {
      const fixture: Fixture = makeFixture();

      writeFile(path.join(fixture.localesDirectory, "en.json"), "{ nope\n");

      const result: FixtureBuild = buildFixture(fixture);

      expect(result.ok).toBe(false);
      expect(result.error).toContain(
        `${path.join(fixture.localesDirectory, "en.json")} is not valid JSON`,
      );
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "a locales directory that is not there fails the build",
    () => {
      const fixture: Fixture = makeFixture();

      fs.rmSync(fixture.localesDirectory, { recursive: true, force: true });

      const result: FixtureBuild = buildFixture(fixture);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("ENOENT");
    },
    BUILD_TIMEOUT_MS,
  );
});

describe("rebuilding in watch mode", () => {
  interface Rebuilds {
    ok: boolean;
    error: string;
    germanChunks: Array<string>;
  }

  /*
   * One esbuild context rebuilt three times: as is, unchanged, and after
   * en.json's menu title changed - the German placeholder then no longer
   * reads the same as the English, so it must ship.
   */
  function rebuild(fixture: Fixture): Rebuilds {
    const englishPath: string = path.join(fixture.localesDirectory, "en.json");
    const changedEnglish: RuntimeLocaleTree = {
      ...FIXTURE_ENGLISH,
      menu: { title: "English Menu Title" },
    };

    const script: string = `
      const fs = require("fs");
      const path = require("path");
      const { createConfig } = require(${JSON.stringify(ESBUILD_CONFIG)});
      const { createRuntimeLocalesPlugin } = require(${JSON.stringify(ESBUILD_LOCALES)});
      const esbuild = require(require.resolve("esbuild", {
        paths: [${JSON.stringify(UI_DIR)}],
      }));
      ${SUMMARIZE_OUTPUTS}

      function germanChunk(result) {
        return summarize(result.metafile, process.cwd()).filter(function (output) {
          return output.locales.de !== undefined;
        })[0].text;
      }

      (async function () {
        const config = createConfig({
          serviceName: "Fixture",
          publicPath: "/fixture/dist/",
          entryPoint: ${JSON.stringify(fixture.entry)},
          outdir: ${JSON.stringify(fixture.outdir)},
          additionalPlugins: [
            createRuntimeLocalesPlugin({
              localesDirectory: ${JSON.stringify(fixture.localesDirectory)},
              fallbackLanguage: "en",
            }),
          ],
        });
        config.metafile = true;
        config.logLevel = "silent";
        delete config.publicPath;

        const context = await esbuild.context(config);
        const germanChunks = [];
        try {
          germanChunks.push(germanChunk(await context.rebuild()));
          germanChunks.push(germanChunk(await context.rebuild()));
          fs.writeFileSync(
            ${JSON.stringify(englishPath)},
            ${JSON.stringify(JSON.stringify(changedEnglish, null, 2))},
          );
          germanChunks.push(germanChunk(await context.rebuild()));
        } catch (error) {
          console.log(JSON.stringify({ ok: false, error: String(error), germanChunks: [] }));
          return;
        } finally {
          await context.dispose();
        }

        console.log(JSON.stringify({ ok: true, error: "", germanChunks: germanChunks }));
      })();
    `;

    return runNode({
      script,
      cwd: fixture.root,
      env: { NODE_ENV: "production" },
    }) as Rebuilds;
  }

  test(
    "an unchanged rebuild ships the same, and a changed fallback re-ships the locales",
    () => {
      const result: Rebuilds = rebuild(makeFixture());

      expect([result.ok, result.error]).toEqual([true, ""]);
      expect(result.germanChunks).toHaveLength(3);

      const [first, unchanged, afterChange] = result.germanChunks as [
        string,
        string,
        string,
      ];

      expect(first).not.toContain("Shared Menu Sentinel");
      expect(unchanged).toBe(first);
      expect(afterChange).toContain("Shared Menu Sentinel");
      expect(afterChange).toContain("Speichern");
    },
    BUILD_TIMEOUT_MS,
  );
});

describe("the Dashboard's own build", () => {
  interface DashboardOutput extends OutputShape {
    bytes: number;
  }

  interface DashboardBuild {
    plugins: Array<string>;
    outputs: Array<DashboardOutput>;
  }

  /*
   * en.json's share of the entry bundle. It ships its nested keys and plural
   * "_one" forms only - about 10 KB, against 1.8 MB for the whole file. A
   * build that ships the identity entries again lands far above this.
   */
  const ENGLISH_ENTRY_BUDGET_BYTES: number = 32 * 1024;

  // What esbuild names the output of an entry point read from stdin.
  const STDIN_ENTRY: string = "stdin.js";

  let built: DashboardBuild;
  let runtime: Record<string, RuntimeLocaleTree> = {};

  const readSourceLocale: (code: string) => RuntimeLocaleTree = (
    code: string,
  ): RuntimeLocaleTree => {
    return JSON.parse(
      fs.readFileSync(path.join(DASHBOARD_LOCALES, `${code}.json`), "utf8"),
    ) as RuntimeLocaleTree;
  };

  /*
   * Runs the shipped esbuild.config.js with build() swapped for a probe
   * (preloaded into the same module instance, as EsbuildEnterpriseAlias does),
   * then builds the real locale files with the config it produced: English
   * imported the way Utils/i18n.ts does, every other locale through the real
   * Utils/I18nLocaleLoader. NODE_PATH lets "Common/..." resolve where the
   * Dashboard is not installed (the Common Test CI job installs Common alone).
   */
  beforeAll(() => {
    const probeDir: string = makeTempDir("oneuptime-dashboard-locales-");
    const preload: string = path.join(probeDir, "probe.js");
    const outdir: string = path.join(probeDir, "out");
    const runtimePath: string = path.join(probeDir, "runtime.json");

    writeFile(
      preload,
      `
      const config = require(${JSON.stringify(ESBUILD_CONFIG)});
      globalThis.__dashboardBuilds = [];
      config.build = function (built) {
        globalThis.__dashboardBuilds.push(built);
      };
      config.watch = config.build;
      `,
    );

    const entry: string = `
      import en from "../Locales/en.json";
      export { loadLocaleResource } from "./I18nLocaleLoader";
      export const english: unknown = en;
    `;

    const script: string = `
      require(${JSON.stringify(path.join(DASHBOARD_DIR, "esbuild.config.js"))});
      const fs = require("fs");
      const path = require("path");
      const url = require("url");
      const esbuild = require(require.resolve("esbuild", {
        paths: [${JSON.stringify(UI_DIR)}],
      }));
      ${SUMMARIZE_OUTPUTS}

      (async function () {
        const config = globalThis.__dashboardBuilds[0];
        const outdir = ${JSON.stringify(outdir)};
        const build = Object.assign({}, config, {
          stdin: {
            contents: ${JSON.stringify(entry)},
            resolveDir: ${JSON.stringify(path.join(DASHBOARD_DIR, "src", "Utils"))},
            sourcefile: "LocaleProbe.ts",
            loader: "ts",
          },
          // The real Common, since the Dashboard may not be installed.
          alias: Object.assign({}, config.alias, {
            Common: ${JSON.stringify(path.join(PACKAGES_DIR, "Common"))},
          }),
          outdir: outdir,
          metafile: true,
          logLevel: "silent",
        });
        delete build.entryPoints;
        // Chunks import each other through publicPath; relative, node finds them.
        delete build.publicPath;

        const result = await esbuild.build(build);
        fs.writeFileSync(path.join(outdir, "package.json"), '{"type":"module"}');
        const bundle = await import(url.pathToFileURL(path.join(outdir, "stdin.js")).href);

        const runtime = { en: bundle.english };
        for (const code of ${JSON.stringify(LAZY_CODES)}) {
          runtime[code] = await bundle.loadLocaleResource(code);
        }
        fs.writeFileSync(${JSON.stringify(runtimePath)}, JSON.stringify(runtime));

        console.log(JSON.stringify({
          plugins: config.plugins.map(function (plugin) { return plugin.name; }),
          outputs: summarize(result.metafile, process.cwd()).map(function (output) {
            const bytes = Buffer.byteLength(output.text);
            delete output.text;
            output.bytes = bytes;
            return output;
          }),
        }));
      })().catch(function (error) {
        console.error(error);
        process.exit(1);
      });
    `;

    built = runNode({
      script,
      cwd: DASHBOARD_DIR,
      env: {
        NODE_ENV: "production",
        ONEUPTIME_EDITION: "community",
        NODE_PATH: PACKAGES_DIR,
      },
      preload,
    }) as DashboardBuild;

    runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8")) as Record<
      string,
      RuntimeLocaleTree
    >;
  }, BUILD_TIMEOUT_MS);

  test("the config the Dashboard builds with carries the plugin", () => {
    expect(built.plugins).toContain(RUNTIME_LOCALES_PLUGIN_NAME);
  });

  test("English ships exactly what getRuntimeLocale() keeps of en.json", () => {
    const english: RuntimeLocaleTree = readSourceLocale(
      DEFAULT_DASHBOARD_LANGUAGE,
    );

    expect(
      treeDifferences(
        runtime[DEFAULT_DASHBOARD_LANGUAGE],
        withoutIdentityEntries(english),
      ),
    ).toEqual([]);
    // The nested keys components read with t("a.b") are all there.
    expect(Object.keys(runtime[DEFAULT_DASHBOARD_LANGUAGE] || {})).toEqual(
      expect.arrayContaining(["navbar", "commandPalette", "eventItem"]),
    );
  });

  test.each(LAZY_CODES)(
    "%s ships its translations and nothing the English already says",
    (code: string) => {
      const expected: RuntimeLocaleTree = withoutFallbackEntries(
        readSourceLocale(code),
        readSourceLocale(DEFAULT_DASHBOARD_LANGUAGE),
      );

      expect(treeDifferences(runtime[code], expected)).toEqual([]);
      expect(Object.keys(expected).length).toBeGreaterThan(0);
    },
  );

  test("en.json's share of the entry bundle stays within its budget", () => {
    const englishBytes: number = entryClosure(
      built.outputs,
      STDIN_ENTRY,
    ).reduce((total: number, output: DashboardOutput): number => {
      return total + (output.locales[DEFAULT_DASHBOARD_LANGUAGE] || 0);
    }, 0);
    const sourceBytes: number = fs.statSync(
      path.join(DASHBOARD_LOCALES, `${DEFAULT_DASHBOARD_LANGUAGE}.json`),
    ).size;

    expect(englishBytes).toBeGreaterThan(0);
    expect(englishBytes).toBeLessThanOrEqual(ENGLISH_ENTRY_BUDGET_BYTES);
    expect(englishBytes).toBeLessThan(sourceBytes / 50);
  });

  test("no other locale is in the entry bundle, and each is a chunk of its own", () => {
    const closure: Array<DashboardOutput> = entryClosure(
      built.outputs,
      STDIN_ENTRY,
    );

    expect(localesIn(closure)).toEqual([DEFAULT_DASHBOARD_LANGUAGE]);

    for (const code of LAZY_CODES) {
      const chunk: DashboardOutput = outputWithLocale(built.outputs, code);

      expect([code, Object.keys(chunk.locales)]).toEqual([code, [code]]);
      expect([code, closure.includes(chunk)]).toEqual([code, false]);
    }
  });
});
