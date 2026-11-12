import {
  ExtractedString,
  scanSourceRoots,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  LocaleProgress,
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "WHEN THIS GOES DOWN" READS IN THE READER'S LANGUAGE (#7078).
 *
 * The card a monitor's overview draws - what opens when it goes down, who it
 * emails, which owner rules and on-call rules add people, who is paged, the
 * status pages it shows on, and what would stop anybody being told (the
 * break messages, WhoIsToldBreakKind) - shipped worded in Arabic, German and
 * Persian only: the other fourteen languages held the English as a
 * placeholder, so a Danish reader read every sentence of it in English.
 *
 * Every string the card and its words (MonitorWhoIsToldCard,
 * WhoIsToldWords, WhoIsToldApi) draw, as `npm run i18n:extract` finds them,
 * is worded now in each of the sixteen languages besides English, as the
 * toolchain counts it (`npm run i18n:check`): a value of its own, or the same
 * English the language keeps on purpose (the same-as-English lists), or text
 * with no words, or a "one" form a language never reads. A translation keeps
 * every {{placeholder}} the English has, or the names it carries are lost.
 *
 * A word added to the card later is translated with it, or fails here.
 */

const WHO_IS_TOLD_DIRECTORY: string =
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview";

const WHO_IS_TOLD_ROOTS: Array<SourceRoot> = [
  "MonitorWhoIsToldCard.tsx",
  "WhoIsToldWords.ts",
  "WhoIsToldApi.ts",
].map((file: string): SourceRoot => {
  return { directory: `${WHO_IS_TOLD_DIRECTORY}/${file}`, kind: "ui" };
});

// Languages whose plurals have no "one" form: their "_one" key is never read.
const LANGUAGES_WITHOUT_ONE: ReadonlyArray<string> = [
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
];

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || [])
    .map((placeholder: string): string => {
      return placeholder.replace(/\s+/g, "");
    })
    .sort();
}

const ENGLISH: Record<string, unknown> = readLocale("en");
const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

interface WhoIsToldKey {
  key: string;
  file: string;
}

// Every key the card reads: each text, and a plural's "one" form.
function getWhoIsToldKeys(): Array<WhoIsToldKey> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(WHO_IS_TOLD_ROOTS).strings) {
    if (entry.nestedPath) {
      continue;
    }

    const found: ExtractedString = entry;

    if (!keys.has(found.text)) {
      keys.set(found.text, found.file);
    }

    if (found.pluralOne !== undefined && !keys.has(`${found.text}_one`)) {
      keys.set(`${found.text}_one`, found.file);
    }
  }

  return Array.from(keys.entries()).map(
    ([key, file]: [string, string]): WhoIsToldKey => {
      return { key, file };
    },
  );
}

const WHO_IS_TOLD_KEYS: Array<WhoIsToldKey> = getWhoIsToldKeys();

// Whether `language` words `key` its own way, as npm run i18n:check counts it.
function isWorded(data: {
  key: string;
  language: string;
  locale: Record<string, unknown>;
  sameAsEnglish: Set<string>;
}): boolean {
  const english: unknown = ENGLISH[data.key];
  const value: unknown = data.locale[data.key];

  if (typeof english !== "string" || typeof value !== "string") {
    return false;
  }

  if (!value.trim()) {
    return false;
  }

  if (value !== english) {
    return true;
  }

  if (
    data.key.endsWith("_one") &&
    LANGUAGES_WITHOUT_ONE.includes(data.language)
  ) {
    return true;
  }

  if (!LETTER.test(english.replace(PLACEHOLDER, ""))) {
    return true;
  }

  return GLOBAL_SAME_AS_ENGLISH.has(english) || data.sameAsEnglish.has(english);
}

function sameAsEnglishOf(language: string): Set<string> {
  const progress: LocaleProgress | undefined = readLocaleProgress(language);

  return new Set<string>(progress ? progress.sameAsEnglish : []);
}

// The keys `locale` leaves in English, as "key (file)".
function getUnworded(data: {
  language: string;
  locale: Record<string, unknown>;
}): Array<string> {
  const sameAsEnglish: Set<string> = sameAsEnglishOf(data.language);

  return WHO_IS_TOLD_KEYS.filter((entry: WhoIsToldKey): boolean => {
    return !isWorded({
      key: entry.key,
      language: data.language,
      locale: data.locale,
      sameAsEnglish,
    });
  }).map((entry: WhoIsToldKey): string => {
    return `${entry.key} (${path.basename(entry.file)})`;
  });
}

// The keys whose translation in `locale` does not keep the English placeholders.
function getPlaceholderMismatches(
  locale: Record<string, unknown>,
): Array<string> {
  return WHO_IS_TOLD_KEYS.filter((entry: WhoIsToldKey): boolean => {
    const english: unknown = ENGLISH[entry.key];
    const value: unknown = locale[entry.key];

    if (typeof english !== "string" || typeof value !== "string") {
      return false;
    }

    return (
      JSON.stringify(placeholders(value)) !==
      JSON.stringify(placeholders(english))
    );
  }).map((entry: WhoIsToldKey): string => {
    return entry.key;
  });
}

const KEYS: Set<string> = new Set<string>(
  WHO_IS_TOLD_KEYS.map((entry: WhoIsToldKey): string => {
    return entry.key;
  }),
);

// The words this follow-up added: owner rules (#7076) and status pages (#7077).
const NEW_KEYS: Array<string> = [
  "It emails the owners added by owner rules ({{names}}).",
  "It emails the owners added by owner rules.",
  "A status page you can't see",
];

describe("When this goes down's words in every language", () => {
  test("the card draws words, every one of them in English", () => {
    expect(WHO_IS_TOLD_KEYS.length).toBeGreaterThan(60);
    expect(
      WHO_IS_TOLD_KEYS.filter((entry: WhoIsToldKey): boolean => {
        return typeof ENGLISH[entry.key] !== "string";
      }),
    ).toEqual([]);

    for (const key of [
      // The chain's rows.
      "Opens",
      "Emails",
      "Owner Rules",
      "On-call rules",
      "Status pages",
      "A rule you can't see",
      // Its first words, and what would stop anybody being told.
      "It emails the project's owners ({{names}}).",
      ...NEW_KEYS,
    ]) {
      expect({ key, scanned: KEYS.has(key) }).toEqual({ key, scanned: true });
    }

    // Each key is an en.json key that reads as written.
    for (const key of NEW_KEYS) {
      expect(ENGLISH[key]).toBe(key);
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s words every one of them",
    (language: string) => {
      expect(getUnworded({ language, locale: readLocale(language) })).toEqual(
        [],
      );
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s keeps every placeholder a sentence carries",
    (language: string) => {
      expect(getPlaceholderMismatches(readLocale(language))).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s words the owner rule and status page words its own way",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const key of NEW_KEYS) {
        const value: unknown = locale[key];

        expect({ key, isString: typeof value === "string" }).toEqual({
          key,
          isString: true,
        });
        expect({ key, value }).not.toEqual({ key, value: key });
      }
    },
  );

  /*
   * The check catches what #7078 found: a language that holds the card's
   * English as a placeholder, or a translation that drops {{names}}.
   */
  test("a language holding the card's English as placeholders fails it", () => {
    const danish: Record<string, unknown> = readLocale("da");
    const placeholderCopy: Record<string, unknown> = { ...danish };

    for (const key of KEYS) {
      if (typeof ENGLISH[key] === "string") {
        placeholderCopy[key] = ENGLISH[key];
      }
    }

    const unworded: Array<string> = getUnworded({
      language: "da",
      locale: placeholderCopy,
    });

    expect(unworded.length).toBeGreaterThan(50);
    expect(unworded).toContain(
      "It emails the owners added by owner rules. (WhoIsToldWords.ts)",
    );
    expect(unworded).toContain(
      "A status page you can't see (MonitorWhoIsToldCard.tsx)",
    );

    // One key missing, or empty, fails it too.
    const missing: Record<string, unknown> = { ...danish };
    delete missing["Owner Rules"];
    missing["A status page you can't see"] = " ";

    expect(getUnworded({ language: "da", locale: missing }).sort()).toEqual([
      "A status page you can't see (MonitorWhoIsToldCard.tsx)",
      "Owner Rules (MonitorWhoIsToldCard.tsx)",
    ]);
  });

  test("a translation that drops the names it carries fails it", () => {
    const german: Record<string, unknown> = { ...readLocale("de") };

    german["It emails the owners added by owner rules ({{names}})."] =
      "Es sendet E-Mails an die Besitzer, die seine Besitzerregeln hinzufügen.";

    expect(getPlaceholderMismatches(german)).toEqual([
      "It emails the owners added by owner rules ({{names}}).",
    ]);
  });
});
