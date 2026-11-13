import {
  ExtractedString,
  HardcodedString,
  SourceKind,
  SourceScanResult,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * SESSION REPLAY READS IN THE READER'S LANGUAGE (issue #6369).
 *
 * Session Replay's screens were mostly English in twelve of the sixteen
 * languages and partly English in French, and Arabic had almost none of
 * them: the player's header, controls, timeline and stage overlays, the
 * events rail and its detail, the correlation panel, the recording health
 * page and card, the installation test, targeted capture, the setup guide,
 * the session and users lists, and the replay settings. Their own sentences
 * were glued from pieces or written into the markup unlooked-up, so routing
 * them through the locales came first.
 *
 * Every string those screens draw is a string of the files below, as the
 * extractor reads them: every file of Components/SessionReplay (the folder
 * is read, so a new file is covered the day it lands), the Session Replay
 * pages of a RUM application, the helpers they share and the recording
 * health copy in Common. Each is a key of the English locale, and is worded
 * in all seventeen languages - a plural's "one" form too, in a language
 * that has one - or the same as English on purpose. A worded string keeps
 * what a reader types or reads as written: its placeholders, code and
 * calls, attribute and setting names, selectors, paths and headers, HTTP
 * codes, product, browser and protocol names, units and every number, the
 * key of a keyboard shortcut, a leading space the code puts after other
 * text; and it ends as the English ends. A string added without its
 * translations fails here, and so does a sentence written into the markup
 * again.
 *
 * The events rail's own sentences (Components/SessionReplay/Rail) were the
 * one exception to "nothing drawn as written" until #6658 routed them: the
 * rail keeps one string as written, the "x" between a viewport's width and
 * height (1440x900), which reads the same in every language.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const DASHBOARD: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard",
);
const SOURCE: string = "packages/App/FeatureSet/Dashboard/src";
const SESSION_REPLAY: string = `${SOURCE}/Components/SessionReplay`;
const RAIL: string = `${SESSION_REPLAY}/Rail/`;

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
const REPLAY_PAGE_FILE: RegExp = /^SessionReplay.*\.tsx$/;
const STARTS_LOWER_CASE: RegExp = /^[a-z]/;

function filesUnder(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(path.join(REPOSITORY_ROOT, directory), {
    withFileTypes: true,
  })) {
    const relative: string = `${directory}/${entry.name}`;

    if (entry.isDirectory()) {
      found.push(...filesUnder(relative));
    } else if (
      TYPESCRIPT_FILE.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(relative);
    }
  }

  return found.sort();
}

// The pages of a RUM application that are Session Replay's.
const REPLAY_PAGES: ReadonlyArray<string> = fs
  .readdirSync(path.join(REPOSITORY_ROOT, `${SOURCE}/Pages/Rum/View`))
  .filter((name: string): boolean => {
    return REPLAY_PAGE_FILE.test(name);
  })
  .sort()
  .map((name: string): string => {
    return `${SOURCE}/Pages/Rum/View/${name}`;
  });

const UI_FILES: ReadonlyArray<string> = [
  ...filesUnder(SESSION_REPLAY),
  ...REPLAY_PAGES,
  `${SOURCE}/Pages/Rum/Settings/SessionReplay.tsx`,
  `${SOURCE}/Utils/ReplayCorrelation.ts`,
  `${SOURCE}/Utils/SessionReplayLayout.ts`,
  `${SOURCE}/Utils/RumSessionLookup.ts`,
];

/*
 * Why recordings are missing and the ages, durations and counts its copy
 * writes: the file marks its words, its reason codes stay as written.
 */
const KEYS_FILES: ReadonlyArray<string> = [
  "packages/Common/Utils/SessionReplay/SessionReplayHealth.ts",
];

/*
 * What the rail still draws as written: the "x" of a viewport's size
 * (1440x900). A sentence written into the rail again fails here.
 */
const RAIL_AS_WRITTEN: ReadonlyArray<string> = ["x"];

const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
  "ar",
];

// Languages with no "one" form never show a "_one" key.
const WITHOUT_ONE: ReadonlySet<string> = new Set<string>([
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
]);

type Locale = Record<string, unknown>;

function localeOf(language: string): Locale {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, `src/Locales/${language}.json`),
      "utf8",
    ),
  ) as Locale;
}

const ENGLISH: Locale = localeOf("en");

const LOCALES: ReadonlyMap<string, Locale> = new Map<string, Locale>(
  LANGUAGES.map((language: string): [string, Locale] => {
    return [language, localeOf(language)];
  }),
);

function wordsOf(language: string): Locale {
  return LOCALES.get(language) as Locale;
}

function scanOf(file: string, kind: SourceKind): SourceScanResult {
  return scanSourceText(
    file,
    fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
    { kind },
  );
}

const SCANS: ReadonlyMap<string, SourceScanResult> = new Map<
  string,
  SourceScanResult
>([
  ...UI_FILES.map((file: string): [string, SourceScanResult] => {
    return [file, scanOf(file, "ui")];
  }),
  ...KEYS_FILES.map((file: string): [string, SourceScanResult] => {
    return [file, scanOf(file, "keys")];
  }),
]);

/*
 * A key and the English it holds: a plural's general sentence is its own
 * key, and its "one" sentence is stored under the key plus "_one".
 */
interface Entry {
  key: string;
  english: string;
  isOneForm: boolean;
}

const ENTRIES: Array<Entry> = (() => {
  const byKey: Map<string, Entry> = new Map<string, Entry>();

  for (const scan of SCANS.values()) {
    for (const extracted of scan.strings as Array<ExtractedString>) {
      byKey.set(extracted.text, {
        key: extracted.text,
        english: extracted.text,
        isOneForm: false,
      });

      if (extracted.pluralOne !== undefined) {
        byKey.set(`${extracted.text}_one`, {
          key: `${extracted.text}_one`,
          english: extracted.pluralOne,
          isOneForm: true,
        });
      }
    }
  }

  return Array.from(byKey.values()).sort((a: Entry, b: Entry): number => {
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
})();

function entriesShownIn(language: string): Array<Entry> {
  return ENTRIES.filter((entry: Entry): boolean => {
    return !(entry.isOneForm && WITHOUT_ONE.has(language));
  });
}

const PLACEHOLDER: RegExp = /\{\{\s*\w+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

function hasNoLetters(text: string): boolean {
  return !LETTER.test(text.replace(PLACEHOLDER, ""));
}

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

function sameAsEnglishOf(language: string): Set<string> {
  return new Set<string>([
    ...GLOBAL_SAME_AS_ENGLISH,
    ...(readLocaleProgress(language)?.sameAsEnglish || []),
  ]);
}

/*
 * What a string names that a reader types, pastes or reads as written, in
 * every language: a dotted name or call (OneUptimeReplay.identify(),
 * service.name), a setting (sample_rate), an identifier (maskAllInputs), an
 * attribute or a CSP directive (data-oneuptime-mask, script-src), a token
 * with digits in it (h1), a path (/orders/*), code in backticks, a CSS
 * selector (.quantity-stepper), an HTTP status (429, 5xx), the products,
 * browsers, protocols and formats the screens name, and a shortcut's key.
 */
const DOTTED: RegExp =
  /(?<![\w.])[a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_*]+)+(?:\(\))?/g;
const CALL: RegExp = /\b[A-Za-z_][A-Za-z0-9_.]*\(\)/g;
const SNAKE_CASE: RegExp = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g;
const CAMEL_CASE: RegExp = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
const CODE_LIKE_KEBAB: RegExp =
  /\b[a-z]+(?:-[a-z]+)*-(?:src|ancestors|uri|action)\b|\bdata-[a-z-]+\b|\bx-[a-z-]+\b/g;
const LETTERS_AND_DIGITS: RegExp = /\b[A-Za-z]+\d+[A-Za-z0-9]*\b/g;
const PATH_LIKE: RegExp = /(?<!\w)\/[\w/:*.-]*[\w*]/g;
const CODE_SPAN: RegExp = /`([^`]+)`/g;
const SELECTOR: RegExp = /(?<!\w)[.#][a-z][a-z0-9_-]*(?:[-_][a-z0-9]+)+/g;
const SHORTCUT_KEY: RegExp = /\((?:Shift\+)?([A-Z0-9?])\)|\+([A-Z])\b/g;
const NOT_TOKENS: ReadonlySet<string> = new Set<string>(["e.g", "i.e", "etc"]);

const NAMES: ReadonlyArray<string> = [
  "OneUptime",
  "OneUptimeReplay",
  "OpenTelemetry",
  "rrweb",
  "React Native",
  "React",
  "WebView",
  "JavaScript",
  "TypeScript",
  "Next.js",
  "Vue",
  "Angular",
  "Svelte",
  "Datadog",
  "New Relic",
  "Chrome",
  "Firefox",
  "Safari",
  "Mobile Safari",
  "Edge",
  "iOS",
  "Android",
  "macOS",
  "Windows",
  "Linux",
  "HTTP",
  "HTTPS",
  "https",
  "CSP",
  "Content-Security-Policy",
  "CORS",
  "DNS",
  "HMAC",
  "PNG",
  "JSON",
  "W3C",
  "URL",
  "URLs",
  "DOM",
  "SDK",
  "SDKs",
  "API",
  "APIs",
  "RUM",
  "AbortController",
  "Do Not Track",
  "Global Privacy Control",
  "SPA",
  "LCP",
  "INP",
  "CLS",
  "FCP",
  "TTFB",
  "CDN",
  "GB",
  "MB",
  "KB",
  "gzip",
  "keepalive",
  "WebSocket",
  "iframe",
  "iframes",
  "Shadow DOM",
  "WebGL",
  "CSS",
  "HTML",
  "XHR",
  "sendBeacon",
  "traceparent",
  "tracestate",
];

/*
 * The established ways a language writes a name or a unit inside its own
 * sentences: French "Go" and Russian "ГБ" for GB, Persian "نشانی" for a
 * URL, Japanese katakana for a keepalive request. Every other language
 * keeps them as written.
 */
const WORDED_NAMES: Readonly<
  Record<string, Readonly<Record<string, ReadonlyArray<string>>>>
> = {
  fr: { GB: ["Go"], MB: ["Mo"], KB: ["Ko"] },
  ru: { GB: ["ГБ"], MB: ["МБ"], KB: ["КБ"] },
  fa: {
    GB: ["گیگابایت"],
    MB: ["مگابایت"],
    KB: ["کیلوبایت"],
    URL: ["نشانی"],
    URLs: ["نشانی"],
    JavaScript: ["جاوااسکریپت"],
  },
  ja: { keepalive: ["キープアライブ"] },
};

function formsIn(language: string, token: AsWrittenToken): Array<string> {
  const forms: Array<string> = [...token.forms];

  for (const form of token.forms) {
    // German joins a name into a compound with hyphens: "React-Native-Recorder".
    if (form.includes(" ")) {
      forms.push(form.split(" ").join("-"));
    }

    // A sentence may start with it: "Iframe ...", a German noun: "Keepalive".
    if (STARTS_LOWER_CASE.test(form)) {
      forms.push(form.charAt(0).toUpperCase() + form.slice(1));
    }
  }

  forms.push(...(WORDED_NAMES[language]?.[token.token] || []));

  return forms;
}

// A plural English name a translation may keep in its singular.
const MAY_DROP_PLURAL_S: ReadonlySet<string> = new Set<string>([
  "SDKs",
  "APIs",
  "URLs",
  "iframes",
]);

// A name standing as a word of its own: not part of a longer word or name.
const NAME_PATTERNS: ReadonlyArray<[string, RegExp]> = NAMES.map(
  (name: string): [string, RegExp] => {
    return [name, new RegExp(`(?<![\\w.])${escapeRegExp(name)}(?!\\w)`)];
  },
);

interface AsWrittenToken {
  token: string;
  forms: Array<string>;
}

function asWrittenIn(english: string): Array<AsWrittenToken> {
  const text: string = english.replace(PLACEHOLDER, " ");
  const tokens: Map<string, Array<string>> = new Map<string, Array<string>>();

  for (const pattern of [
    DOTTED,
    CALL,
    SNAKE_CASE,
    LETTERS_AND_DIGITS,
    PATH_LIKE,
    CODE_LIKE_KEBAB,
    SELECTOR,
  ]) {
    for (const match of text.match(pattern) || []) {
      if (!NOT_TOKENS.has(match)) {
        tokens.set(match, [match]);
      }
    }
  }

  for (const match of text.matchAll(CODE_SPAN)) {
    tokens.set(match[1] as string, [match[1] as string]);
  }

  for (const match of text.match(CAMEL_CASE) || []) {
    tokens.set(
      match,
      match.endsWith("s") ? [match, match.slice(0, -1)] : [match],
    );
  }

  for (const [name, pattern] of NAME_PATTERNS) {
    if (!pattern.test(text)) {
      continue;
    }

    const forms: Array<string> = [name];

    if (MAY_DROP_PLURAL_S.has(name)) {
      forms.push(name.slice(0, -1));
    }

    if (name === "https") {
      forms.push("HTTPS");
    }

    tokens.set(name, forms);
  }

  for (const match of text.matchAll(SHORTCUT_KEY)) {
    const key: string = (match[1] || match[2]) as string;
    tokens.set(`(${key})`, [key]);
  }

  return Array.from(tokens.entries()).map(
    ([token, forms]: [string, Array<string>]): AsWrittenToken => {
      return { token, forms };
    },
  );
}

/*
 * The numbers a string says, as one language or another writes them:
 * Persian and Hindi digits read as 0-9, a thousands separator dropped and
 * a decimal comma read as a point. An ordinal may be worded instead.
 */
const DIGITS_OF_OTHER_SCRIPTS: ReadonlyArray<string> = [
  "۰۱۲۳۴۵۶۷۸۹",
  "٠١٢٣٤٥٦٧٨٩",
  "०१२३४५६७८९",
];

function withLatinDigits(text: string): string {
  let result: string = text;

  for (const digits of DIGITS_OF_OTHER_SCRIPTS) {
    for (let digit: number = 0; digit < 10; digit++) {
      result = result.split(digits[digit] as string).join(String(digit));
    }
  }

  return result;
}

/*
 * A thousands separator: a comma, a point, a space - plain, no-break (U+00A0),
 * narrow no-break (U+202F) or thin (U+2009) - or an apostrophe.
 */
const THOUSANDS_SEPARATOR: RegExp = new RegExp(
  "(?<=\\d)[,.\\u00a0\\u202f\\u2009 '\\u2019](?=\\d{3}(?!\\d))",
  "g",
);

function numbersIn(text: string): Array<string> {
  const plain: string = withLatinDigits(text.replace(PLACEHOLDER, " "))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .replace(/\b\d+(?:st|nd|rd|th)\b/g, " ")
    .replace(THOUSANDS_SEPARATOR, "");

  return (plain.match(/\d+(?:[.,]\d+)?/g) || []).map(
    (number: string): string => {
      return number.replace(",", ".");
    },
  );
}

function withoutTrailingZeros(number: string): string {
  return number.includes(".") ? number.replace(/\.?0+$/, "") : number;
}

function saysNumber(numbers: Array<string>, number: string): boolean {
  const wanted: string = withoutTrailingZeros(number);

  return numbers.some((said: string): boolean => {
    return withoutTrailingZeros(said) === wanted;
  });
}

/*
 * How each language ends a sentence that ends with a full stop: its own
 * mark, or a point after Latin text.
 */
const FULL_STOPS: Readonly<Record<string, ReadonlyArray<string>>> = {
  ja: ["。", "."],
  "zh-CN": ["。", "."],
  "zh-TW": ["。", "."],
  hi: ["।", "."],
};

function endsAsTheEnglish(
  english: string,
  worded: string,
  language: string,
): boolean {
  const englishEnd: string = english.trimEnd();
  const wordedEnd: string = worded.trimEnd();

  if (englishEnd.endsWith("…")) {
    return wordedEnd.endsWith("…");
  }

  if (englishEnd.endsWith("...")) {
    return wordedEnd.endsWith("...") || wordedEnd.endsWith("…");
  }

  if (englishEnd.endsWith(":")) {
    return wordedEnd.endsWith(":") || wordedEnd.endsWith("：");
  }

  if (englishEnd.endsWith("?")) {
    return ["?", "？", "؟"].some((mark: string): boolean => {
      return wordedEnd.endsWith(mark);
    });
  }

  if (englishEnd.endsWith(".")) {
    /*
     * "..., such as /checkout/error." may end on its example, as Japanese
     * and Korean set one apart: "例: /checkout/error".
     */
    const example: RegExpMatchArray | null = englishEnd.match(
      /(?:^|\s)([/#.][^\s]*[\w*])\.$/,
    );

    if (example && wordedEnd.endsWith(example[1] as string)) {
      return true;
    }

    return (FULL_STOPS[language] || ["."]).some((stop: string): boolean => {
      return wordedEnd.endsWith(stop);
    });
  }

  return true;
}

const DIGITS_ARABIC_DOES_NOT_WRITE: RegExp = /[٠-٩۰-۹]/;

describe("Session Replay's words", () => {
  test("the extractor reads every file of the screens, and every string they draw", () => {
    expect(UI_FILES.length).toBeGreaterThan(90);
    expect(ENTRIES.length).toBeGreaterThan(1500);

    const texts: Set<string> = new Set<string>(
      ENTRIES.map((entry: Entry): string => {
        return entry.key;
      }),
    );

    for (const text of [
      // The player's header, controls and stage.
      "Copy link to this moment",
      "Skipped {{duration}}: recording paused while the page was idle",
      // The recording health page.
      "ingest is switched off on this deployment",
      // The health copy's ages, read from its keys.
      "{{count}}s ago",
      // A count, worded whole in both its forms.
      "Could not fetch footage after {{count}} attempts ({{reason}}).",
      "Could not fetch footage after {{count}} attempts ({{reason}}).",
    ]) {
      expect({ text, read: texts.has(text) }).toEqual({ text, read: true });
    }

    expect(
      ENTRIES.filter((entry: Entry): boolean => {
        return entry.isOneForm;
      }).length,
    ).toBeGreaterThan(40);
  });

  test("draw nothing as written, except the rail's viewport size", () => {
    const inRail: Array<string> = [];

    for (const [file, scan] of SCANS) {
      const hardcoded: Array<HardcodedString> = scan.hardcoded;

      if (file.startsWith(RAIL)) {
        inRail.push(
          ...hardcoded.map((entry: HardcodedString): string => {
            return entry.text;
          }),
        );
        continue;
      }

      expect({ file, hardcoded }).toEqual({ file, hardcoded: [] });
    }

    expect(inRail).toEqual(RAIL_AS_WRITTEN);
  });

  test("are every one a key of the English locale", () => {
    for (const entry of ENTRIES) {
      if (entry.isOneForm) {
        expect({ key: entry.key, one: ENGLISH[entry.key] }).toEqual({
          key: entry.key,
          one: entry.english,
        });
        continue;
      }

      expect({ key: entry.key, english: ENGLISH[entry.key] }).toEqual({
        key: entry.key,
        english: entry.key,
      });
    }
  });

  test.each(LANGUAGES)(
    "%s words every one of them, or keeps it as English on purpose",
    (language: string) => {
      const words: Locale = wordsOf(language);
      const sameAsEnglish: Set<string> = sameAsEnglishOf(language);
      const english: Array<string> = entriesShownIn(language)
        .filter((entry: Entry): boolean => {
          const worded: unknown = words[entry.key];

          if (typeof worded !== "string") {
            return true;
          }

          return (
            worded === entry.english &&
            !hasNoLetters(entry.english) &&
            !sameAsEnglish.has(entry.english)
          );
        })
        .map((entry: Entry): string => {
          return entry.key;
        });

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );

  test.each(LANGUAGES)("%s keeps every placeholder", (language: string) => {
    const words: Locale = wordsOf(language);

    for (const entry of entriesShownIn(language)) {
      expect({
        language,
        key: entry.key,
        placeholders: placeholdersOf(String(words[entry.key])),
      }).toEqual({
        language,
        key: entry.key,
        placeholders: placeholdersOf(entry.english),
      });
    }
  });

  test.each(LANGUAGES)(
    "%s keeps the code, names, selectors, paths, codes and keys a string names as written",
    (language: string) => {
      const words: Locale = wordsOf(language);
      let checked: number = 0;

      for (const entry of entriesShownIn(language)) {
        const worded: string = String(words[entry.key]);
        const tokens: Array<AsWrittenToken> = asWrittenIn(entry.english);
        checked += tokens.length;

        const missing: Array<string> = tokens
          .filter((token: AsWrittenToken): boolean => {
            return !formsIn(language, token).some((form: string): boolean => {
              return worded.includes(form);
            });
          })
          .map((token: AsWrittenToken): string => {
            return token.token;
          });

        expect({ language, key: entry.key, missing }).toEqual({
          language,
          key: entry.key,
          missing: [],
        });
      }

      // OneUptimeReplay.identify(), rrweb, script-src, 429, JSON, ...
      expect(checked).toBeGreaterThan(250);
    },
  );

  test.each(LANGUAGES)(
    "%s says every number a string says, and keeps its % sign",
    (language: string) => {
      const words: Locale = wordsOf(language);

      for (const entry of entriesShownIn(language)) {
        const worded: string = String(words[entry.key]);
        const said: Array<string> = numbersIn(worded);
        const missing: Array<string> = numbersIn(entry.english).filter(
          (number: string): boolean => {
            return !saysNumber(said, number);
          },
        );

        expect({ language, key: entry.key, missing }).toEqual({
          language,
          key: entry.key,
          missing: [],
        });

        if (entry.english.includes("%")) {
          expect({
            language,
            key: entry.key,
            percent: worded.replace(/٪/g, "%").includes("%"),
          }).toEqual({ language, key: entry.key, percent: true });
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s ends a string as the English does, and keeps the space the code puts it after",
    (language: string) => {
      const words: Locale = wordsOf(language);

      for (const entry of entriesShownIn(language)) {
        const worded: string = String(words[entry.key]);

        expect({
          language,
          key: entry.key,
          ending: endsAsTheEnglish(entry.english, worded, language),
          leadingSpace: entry.english.startsWith(" ")
            ? worded.startsWith(" ")
            : true,
        }).toEqual({
          language,
          key: entry.key,
          ending: true,
          leadingSpace: true,
        });
      }
    },
  );

  test("Arabic writes Latin digits, as ARABIC.md chooses", () => {
    const words: Locale = wordsOf("ar");

    for (const entry of entriesShownIn("ar")) {
      expect({
        key: entry.key,
        otherDigits: DIGITS_ARABIC_DOES_NOT_WRITE.test(
          String(words[entry.key]),
        ),
      }).toEqual({ key: entry.key, otherDigits: false });
    }
  });
});

describe("the checks Session Replay's words are held to", () => {
  /*
   * The rules above are this suite's own, so they are proven here on
   * strings that break them: a check that passes everything would let a
   * string through English, or without its code, in silence.
   */
  test("names as written: calls, settings, attributes, selectors, paths, codes, products and shortcut keys", () => {
    const tokens: Array<string> = asWrittenIn(
      "Call `OneUptimeReplay.identify()` with maskAllInputs and sample_rate, add data-oneuptime-mask and script-src to .quantity-stepper on /orders/*, retry a 429 in Chrome with rrweb (Shift+E).",
    ).map((token: AsWrittenToken): string => {
      return token.token;
    });

    for (const token of [
      "OneUptimeReplay.identify()",
      "maskAllInputs",
      "sample_rate",
      "data-oneuptime-mask",
      "script-src",
      ".quantity-stepper",
      "/orders/*",
      "Chrome",
      "rrweb",
      "(E)",
    ]) {
      expect({ token, found: tokens.includes(token) }).toEqual({
        token,
        found: true,
      });
    }

    // Placeholders, "e.g." and words that only contain a name are not names.
    expect(
      asWrittenIn("Seek to {{time}} e.g. Reactivity, Chromebook.").map(
        (token: AsWrittenToken): string => {
          return token.token;
        },
      ),
    ).toEqual([]);

    // A plural name may read singular.
    expect(asWrittenIn("the SDKs")).toEqual([
      { token: "SDKs", forms: ["SDKs", "SDK"] },
    ]);
  });

  test("the forms a language may write a name in, and only those", () => {
    const reactNative: AsWrittenToken = {
      token: "React Native",
      forms: ["React Native"],
    };
    const iframe: AsWrittenToken = { token: "iframe", forms: ["iframe"] };
    const gigabytes: AsWrittenToken = { token: "GB", forms: ["GB"] };

    expect(formsIn("de", reactNative)).toContain("React-Native");
    expect(formsIn("es", iframe)).toContain("Iframe");
    expect(formsIn("fr", gigabytes)).toContain("Go");
    expect(formsIn("ru", gigabytes)).toContain("ГБ");
    // German keeps GB: no other language's word is accepted.
    expect(formsIn("de", gigabytes)).toEqual(["GB"]);
  });

  test("numbers: every script's digits, separators and decimal commas, never a placeholder's", () => {
    expect(numbersIn("after 3 attempts, 1,000 chunks, {{count}} more")).toEqual(
      ["3", "1000"],
    );
    expect(numbersIn("nach 3 Versuchen, 1.000 Stücke, 0,5 s")).toEqual([
      "3",
      "1000",
      "0.5",
    ]);
    expect(numbersIn("پس از ۳ تلاش، ۲٫۵ ثانیه")).toEqual(["3", "2.5"]);
    expect(saysNumber(["429"], "429")).toBe(true);
    expect(saysNumber(["42"], "429")).toBe(false);
  });

  test("endings: a full stop as each language writes one, a question, a colon, an ellipsis", () => {
    expect(endsAsTheEnglish("Done.", "Fertig.", "de")).toBe(true);
    expect(endsAsTheEnglish("Done.", "完了。", "ja")).toBe(true);
    expect(endsAsTheEnglish("Done.", "完了", "ja")).toBe(false);
    expect(endsAsTheEnglish("Done.", "हो गया।", "hi")).toBe(true);
    expect(endsAsTheEnglish("Retry?", "إعادة المحاولة؟", "ar")).toBe(true);
    expect(endsAsTheEnglish("Loading…", "Laden", "de")).toBe(false);
    expect(endsAsTheEnglish("Pages:", "ページ：", "ja")).toBe(true);
    expect(endsAsTheEnglish("Copy link", "Link kopieren", "de")).toBe(true);
    // Ending on the example the English ends with, as Japanese sets it apart.
    expect(
      endsAsTheEnglish(
        "Enter the page's path, such as /checkout/error.",
        "ページのパスを入力してください。例: /checkout/error",
        "ja",
      ),
    ).toBe(true);
    expect(
      endsAsTheEnglish(
        "Enter the page's path, such as /checkout/error.",
        "ページのパスを入力してください。例: /checkout",
        "ja",
      ),
    ).toBe(false);
  });

  test("a string the language left English is caught, unless it has no letters", () => {
    expect(hasNoLetters("Copy link")).toBe(false);
    expect(hasNoLetters("{{count}} / {{total}}")).toBe(true);
    expect(hasNoLetters("{{seconds}}s")).toBe(false);
  });
});
