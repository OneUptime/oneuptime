import {
  makeT,
  TranslateFn,
} from "../../../FeatureSet/APIReference/Utils/I18n";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The templates ask for strings by dot-path, so a typo in a key is invisible
 * until the page renders the key itself back at the reader. And a locale that
 * has fallen behind English silently serves English - fine as a fallback, not
 * fine as something nobody notices for a year.
 */

const REFERENCE_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "APIReference",
);
const LOCALES_ROOT: string = path.join(REFERENCE_ROOT, "Locales");
const VIEWS_ROOT: string = path.join(REFERENCE_ROOT, "views");

interface LocaleFile {
  code: string;
  ui: Record<string, string>;
  pages: Record<string, Record<string, string>>;
}

function readLocales(): Array<LocaleFile> {
  return fs
    .readdirSync(LOCALES_ROOT)
    .filter((name: string) => {
      return name.endsWith(".json");
    })
    .map((name: string) => {
      const parsed: {
        ui: Record<string, string>;
        pages: Record<string, Record<string, string>>;
      } = JSON.parse(fs.readFileSync(path.join(LOCALES_ROOT, name), "utf8"));

      return {
        code: name.replace(/\.json$/, ""),
        ui: parsed.ui,
        pages: parsed.pages,
      };
    });
}

function collectTemplateFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTemplateFiles(absolute));
    } else if (entry.name.endsWith(".ejs")) {
      files.push(absolute);
    }
  }

  return files;
}

/** Every literal key the templates pass to t(), with the file it came from. */
function keysUsedByTemplates(): Array<{ file: string; key: string }> {
  const used: Array<{ file: string; key: string }> = [];

  for (const file of collectTemplateFiles(VIEWS_ROOT)) {
    const contents: string = fs.readFileSync(file, "utf8");

    /*
     * Whole literals only. One table builds its key by concatenation
     * (`t('pages.masterAdminApis.' + endpoint.key + 'Desc')`), and the prefix
     * on its own is not a key.
     */
    for (const match of contents.matchAll(/\bt\(\s*'([^']+)'\s*[),]/g)) {
      used.push({ file: path.relative(VIEWS_ROOT, file), key: match[1]! });
    }
  }

  return used;
}

const LOCALES: Array<LocaleFile> = readLocales();
const ENGLISH: LocaleFile = LOCALES.find((locale: LocaleFile) => {
  return locale.code === "en";
})!;

describe("locale files", () => {
  it("has the sixteen languages the reference is offered in", () => {
    expect(LOCALES).toHaveLength(16);
    expect(ENGLISH).toBeDefined();
  });

  it.each(
    LOCALES.map((locale: LocaleFile) => {
      return [locale.code, locale] as [string, LocaleFile];
    }),
  )("%s has every ui key English has", (_code: string, locale: LocaleFile) => {
    const missing: Array<string> = Object.keys(ENGLISH.ui).filter(
      (key: string) => {
        return !(key in locale.ui);
      },
    );

    expect(missing).toEqual([]);
  });

  it.each(
    LOCALES.map((locale: LocaleFile) => {
      return [locale.code, locale] as [string, LocaleFile];
    }),
  )("%s has no ui key English lacks", (_code: string, locale: LocaleFile) => {
    /* A key only one locale has is a key nothing reads. */
    const extra: Array<string> = Object.keys(locale.ui).filter(
      (key: string) => {
        return !(key in ENGLISH.ui);
      },
    );

    expect(extra).toEqual([]);
  });

  it.each(
    LOCALES.map((locale: LocaleFile) => {
      return [locale.code, locale] as [string, LocaleFile];
    }),
  )("%s leaves no string empty", (_code: string, locale: LocaleFile) => {
    const blank: Array<string> = Object.entries(locale.ui)
      .filter(([, value]: [string, string]) => {
        return typeof value !== "string" || value.trim() === "";
      })
      .map(([key]: [string, string]) => {
        return key;
      });

    expect(blank).toEqual([]);
  });

  it("translates the strings the new chrome introduced", () => {
    /*
     * The lookup falls back to English for a missing key, so an untranslated
     * locale renders but reads half-English. These are the keys the redesign
     * added.
     */
    const introduced: Array<string> = [
      "skipToContent",
      "searchPlaceholder",
      "onThisPage",
      "backToTop",
      "previousPage",
      "nextPage",
      "themeLight",
      "themeDark",
      "themeSystem",
    ];

    for (const locale of LOCALES) {
      if (locale.code === "en") {
        continue;
      }

      for (const key of introduced) {
        expect([locale.code, key, locale.ui[key] !== undefined]).toEqual([
          locale.code,
          key,
          true,
        ]);
      }
    }
  });
});

describe("keys the templates ask for", () => {
  const used: Array<{ file: string; key: string }> = keysUsedByTemplates();

  it("finds them at all", () => {
    expect(used.length).toBeGreaterThan(40);
  });

  it("resolves every one against English", () => {
    const translate: TranslateFn = makeT("en");

    const unresolved: Array<string> = used
      .filter(({ key }: { key: string }) => {
        /* A missing key falls all the way through to the key itself. */
        return translate(key) === key;
      })
      .map(({ file, key }: { file: string; key: string }) => {
        return `${file}: ${key}`;
      });

    expect(unresolved).toEqual([]);
  });

  it("uses every ui key it defines", () => {
    /*
     * The other direction: a key nothing renders is dead weight in sixteen
     * files. Keys read from TypeScript rather than a template are listed here.
     */
    const usedFromCode: Array<string> = [
      "ui.introductionLink",
      "ui.authenticationLink",
      "ui.paginationLink",
      "ui.permissionsLink",
      "ui.dataTypesLink",
      "ui.errorsLink",
      "ui.openApiSpecLink",
      "ui.masterAdminApisLink",
      "ui.guides",
      "ui.resources",
      "ui.dataTypes",
      "ui.pageNotFoundMetaTitle",
      "ui.pageNotFoundMetaDescription",
    ];

    const usedKeys: Set<string> = new Set<string>([
      ...used.map(({ key }: { key: string }) => {
        return key;
      }),
      ...usedFromCode,
    ]);

    const unused: Array<string> = Object.keys(ENGLISH.ui).filter(
      (key: string) => {
        return !usedKeys.has(`ui.${key}`);
      },
    );

    expect(unused).toEqual([]);
  });
});
