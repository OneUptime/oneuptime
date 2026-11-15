import fs from "fs";
import path from "path";

/*
 * THE SERVER'S LOCALE SET: WHICH WORDS IT HAS, AND WHERE THEY COME FROM.
 *
 * Common/Server/Locales holds the words the server writes in a reader's
 * language (Common/Server/Utils/ServerTranslation): a status page's
 * subscriber notifications and the messages about a subscription. Each file
 * maps a sentence's English to its wording in one language, as the
 * Dashboard's locale files do. Common/Server/Locales/README.md says how.
 *
 * en.json holds exactly the sentences the server's code and email templates
 * look up, read from them here:
 *
 *   - in TypeScript, a translationKey("...") marker, a translateText("..."),
 *     translateTemplate("...") call, and a translatePlural({ one: "...",
 *     other: "..." }) call, in double quotes or single ones;
 *   - in an email template, the email language helpers
 *     (Notification/Utils/EmailLanguage): t, tHtml, tt, ttHtml and tp.
 *
 * `npm run i18n:server-sync` (SyncServerLocales.ts) writes en.json from them
 * and gives every other language each new sentence in English, to be
 * translated - or, for a sentence the Dashboard writes too, the Dashboard's
 * wording of it (DASHBOARD_SHARED_TEXT_SOURCES);
 * Tests/Server/Locales/ServerLocales.test.ts holds the files to it. Pure
 * but for reading and writing the files, linear in what it reads.
 */

export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
);

export const SERVER_LOCALES_DIRECTORY: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Common",
  "Server",
  "Locales",
);

export const ENGLISH: string = "en";

// The languages every file mirrors en.json's keys for.
export const TRANSLATED_LANGUAGES: ReadonlyArray<string> = [
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

// Languages without a "one" form: their "_one" keys are never read.
export const LANGUAGES_WITHOUT_ONE_FORM: ReadonlyArray<string> = [
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
];

export const PLURAL_ONE_SUFFIX: string = "_one";

/*
 * SENTENCES THE SERVER AND THE DASHBOARD BOTH WRITE (#7247).
 *
 * Some of OneUptime's words become a record's own text once saved: a new
 * monitor's default criteria - each criteria's name and description, and
 * the title and description of the incident and alert it opens - and the
 * name a new status page starts with ("Acme Status"), which the project's
 * people then edit like anything they typed. The Dashboard writes them in
 * the language of the person making the record (Create Monitor, the
 * guided setups), and so does the server when it makes the record for a
 * person (Ask AI's set_up_website_monitoring and publish_status_page), so
 * the same answers make the same record in every language.
 *
 * The Dashboard's locale files are where these sentences are worded: the
 * Dashboard's i18n:extract finds them (these files are "keys" roots of its
 * extractor) and its translators word them. The server's files hold a copy
 * that is never worded by hand: npm run i18n:server-sync writes each
 * language's wording of every sentence these files look up from the
 * Dashboard's file of that language (withDashboardWordings), and
 * Tests/Server/Locales/ServerLocales.test.ts fails while a copy differs.
 * Paths from the repository's root, files only.
 */
export const DASHBOARD_SHARED_TEXT_SOURCES: ReadonlyArray<string> = [
  "packages/Common/Types/Monitor/MonitorCriteriaInstance.ts",
  "packages/Common/Utils/GuidedSetup/StatusPageRecords.ts",
];

export const DASHBOARD_LOCALES_DIRECTORY: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

/*
 * Where the server's words are looked up, as paths from the repository's
 * root: a directory is read with everything under it, a file on its own.
 * A new sender of words in a reader's language joins this list.
 */
export const SERVER_TEXT_SOURCES: ReadonlyArray<string> = [
  "packages/Common/Server/Utils/StatusPage",
  "packages/Common/Server/Services/StatusPageSubscriberService.ts",
  "packages/Common/Server/Services/ScheduledMaintenanceService.ts",
  "packages/Common/Server/API/StatusPageAPI.ts",
  "packages/Common/Types/StatusPage/StateChangeNoteMessage.ts",
  "packages/Common/Types/StatusPage/DefaultStatusNames.ts",
  "packages/Common/Utils/StatusPage/ReportText.ts",
  // A person's on-call page, in their own language (Types/UserLanguage).
  "packages/Common/Types/OnCallDutyPolicy/OnCallPageWords.ts",
  "packages/Common/Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout.ts",
  "packages/Common/Types/OnCallDutyPolicy/OnCallPersonPage.ts",
  "packages/Common/Types/OnCallDutyPolicy/OnCallObserverPage.ts",
  // A test page (OnCallTestPage), in the language of the person it pages.
  "packages/Common/Types/OnCallDutyPolicy/OnCallTestPageWords.ts",
  "packages/App/FeatureSet/Workers/Jobs",
  "packages/App/FeatureSet/Notification/Templates",
  // Sentences the Dashboard writes too, worded as it words them (above).
  ...DASHBOARD_SHARED_TEXT_SOURCES,
];

const SOURCE_EXTENSIONS: ReadonlyArray<string> = [".ts", ".hbs"];

export interface ServerTextKey {
  // The English the code looks up: the key.
  key: string;
  // A plural's "one" sentence, stored under the key plus "_one".
  one?: string | undefined;
  // Where it was found, from the repository's root.
  file: string;
}

export const listSourceFiles: () => Array<string> = (): Array<string> => {
  const files: Array<string> = [];

  const walk: (absolute: string) => void = (absolute: string): void => {
    const stat: fs.Stats = fs.statSync(absolute);

    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute).sort()) {
        if (entry === "node_modules") {
          continue;
        }

        walk(path.join(absolute, entry));
      }

      return;
    }

    if (SOURCE_EXTENSIONS.includes(path.extname(absolute))) {
      files.push(absolute);
    }
  };

  for (const source of SERVER_TEXT_SOURCES) {
    const absolute: string = path.join(REPOSITORY_ROOT, source);

    if (fs.existsSync(absolute)) {
      walk(absolute);
    }
  }

  return files;
};

// A string literal's text, its escapes read the way JavaScript reads them.
const STRING_LITERAL_BODY: string = '"((?:[^"\\\\\\n]|\\\\.)*)"';

/*
 * A TypeScript string literal in either quotes: Prettier writes a sentence
 * that has double quotes in it ('... does not contain "{{keyword}}"') in
 * single ones. Two groups: the double-quoted text, else the single-quoted.
 */
const TYPESCRIPT_STRING_LITERAL: string = `(?:${STRING_LITERAL_BODY}|'((?:[^'\\\\\\n]|\\\\.)*)')`;

const TYPESCRIPT_KEY_CALL: RegExp = new RegExp(
  `\\b(?:translationKey|translateText|translateTemplate)\\(\\s*${TYPESCRIPT_STRING_LITERAL}`,
  "g",
);

const TYPESCRIPT_PLURAL_CALL: RegExp = new RegExp(
  `\\btranslatePlural\\(\\s*\\{\\s*one:\\s*${TYPESCRIPT_STRING_LITERAL},\\s*other:\\s*${TYPESCRIPT_STRING_LITERAL}`,
  "g",
);

const TEMPLATE_KEY_CALL: RegExp = new RegExp(
  `[({]\\s*(?:t|tHtml|tt|ttHtml)\\s+${STRING_LITERAL_BODY}`,
  "g",
);

const TEMPLATE_PLURAL_CALL: RegExp = new RegExp(
  `[({]\\s*tp\\s+${STRING_LITERAL_BODY}\\s+${STRING_LITERAL_BODY}`,
  "g",
);

const readLiteral: (body: string) => string = (body: string): string => {
  return JSON.parse(`"${body}"`) as string;
};

/*
 * A single-quoted literal's text: its body written as a double-quoted one -
 * an escaped single quote is a plain one there, and a plain double quote an
 * escaped one - read as that is. One pass over the body.
 */
const readSingleQuotedLiteral: (body: string) => string = (
  body: string,
): string => {
  let doubleQuoted: string = "";

  for (let at: number = 0; at < body.length; at++) {
    const character: string = body[at]!;

    if (character === "\\") {
      const next: string = body[at + 1] || "";
      doubleQuoted += next === "'" ? "'" : `${character}${next}`;
      at++;
      continue;
    }

    doubleQuoted += character === '"' ? '\\"' : character;
  }

  return readLiteral(doubleQuoted);
};

/*
 * The text of the literal TYPESCRIPT_STRING_LITERAL matched, from its two
 * groups at `first`: the double-quoted one, else the single-quoted one.
 */
const readTypeScriptLiteral: (
  match: RegExpMatchArray,
  first: number,
) => string = (match: RegExpMatchArray, first: number): string => {
  const doubleQuoted: string | undefined = match[first];

  return doubleQuoted !== undefined
    ? readLiteral(doubleQuoted)
    : readSingleQuotedLiteral(match[first + 1] || "");
};

// The sentences one file looks up, in the order they appear.
export const findKeysInSource: (data: {
  text: string;
  file: string;
}) => Array<ServerTextKey> = (data: {
  text: string;
  file: string;
}): Array<ServerTextKey> => {
  const keys: Array<ServerTextKey> = [];
  const isTemplate: boolean = data.file.endsWith(".hbs");

  const keyCall: RegExp = isTemplate ? TEMPLATE_KEY_CALL : TYPESCRIPT_KEY_CALL;
  const pluralCall: RegExp = isTemplate
    ? TEMPLATE_PLURAL_CALL
    : TYPESCRIPT_PLURAL_CALL;

  for (const match of data.text.matchAll(keyCall)) {
    keys.push({
      key: isTemplate
        ? readLiteral(match[1] || "")
        : readTypeScriptLiteral(match, 1),
      file: data.file,
    });
  }

  for (const match of data.text.matchAll(pluralCall)) {
    keys.push({
      key: isTemplate
        ? readLiteral(match[2] || "")
        : readTypeScriptLiteral(match, 3),
      one: isTemplate
        ? readLiteral(match[1] || "")
        : readTypeScriptLiteral(match, 1),
      file: data.file,
    });
  }

  return keys;
};

// Every sentence the server's sources look up.
export const findServerTextKeys: () => Array<ServerTextKey> =
  (): Array<ServerTextKey> => {
    const keys: Array<ServerTextKey> = [];

    for (const file of listSourceFiles()) {
      keys.push(
        ...findKeysInSource({
          text: fs.readFileSync(file, "utf8"),
          file: path.relative(REPOSITORY_ROOT, file),
        }),
      );
    }

    return keys;
  };

export type LocaleDictionary = Record<string, string>;

/*
 * en.json as the sources make it: each sentence mapped to itself, a
 * plural's "one" form under its key plus "_one", sorted by key.
 */
export const buildEnglishLocale: (
  keys: ReadonlyArray<ServerTextKey>,
) => LocaleDictionary = (
  keys: ReadonlyArray<ServerTextKey>,
): LocaleDictionary => {
  const entries: Map<string, string> = new Map<string, string>();

  for (const key of keys) {
    if (!key.key) {
      continue;
    }

    entries.set(key.key, key.key);

    if (key.one !== undefined) {
      entries.set(`${key.key}${PLURAL_ONE_SUFFIX}`, key.one);
    }
  }

  const sorted: LocaleDictionary = {};

  for (const name of Array.from(entries.keys()).sort()) {
    sorted[name] = entries.get(name)!;
  }

  return sorted;
};

export const getLocalePath: (language: string) => string = (
  language: string,
): string => {
  return path.join(SERVER_LOCALES_DIRECTORY, `${language}.json`);
};

export const readLocale: (language: string) => LocaleDictionary = (
  language: string,
): LocaleDictionary => {
  const file: string = getLocalePath(language);

  if (!fs.existsSync(file)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(file, "utf8")) as LocaleDictionary;
};

// A locale file's text: two-space JSON with a trailing newline.
export const toLocaleText: (dictionary: LocaleDictionary) => string = (
  dictionary: LocaleDictionary,
): string => {
  return `${JSON.stringify(dictionary, null, 2)}\n`;
};

/*
 * A language's file as en.json's keys make it: its own wording of each
 * sentence it has one of, the English of each sentence it has not, in
 * en.json's order, and nothing en.json lacks.
 */
export const alignLocale: (data: {
  english: LocaleDictionary;
  locale: LocaleDictionary;
}) => LocaleDictionary = (data: {
  english: LocaleDictionary;
  locale: LocaleDictionary;
}): LocaleDictionary => {
  const aligned: LocaleDictionary = {};

  for (const key of Object.keys(data.english)) {
    const own: string | undefined = data.locale[key];

    aligned[key] =
      typeof own === "string" && own.length > 0 ? own : data.english[key]!;
  }

  return aligned;
};

/*
 * The keys of en.json the Dashboard words (DASHBOARD_SHARED_TEXT_SOURCES):
 * each sentence those files look up, and a plural's "_one" form - also
 * when a server-only file looks the same sentence up.
 */
export const getDashboardSharedKeys: (
  keys: ReadonlyArray<ServerTextKey>,
) => Set<string> = (keys: ReadonlyArray<ServerTextKey>): Set<string> => {
  const shared: Set<string> = new Set<string>();

  for (const key of keys) {
    if (!key.key || !DASHBOARD_SHARED_TEXT_SOURCES.includes(key.file)) {
      continue;
    }

    shared.add(key.key);

    if (key.one !== undefined) {
      shared.add(`${key.key}${PLURAL_ONE_SUFFIX}`);
    }
  }

  return shared;
};

// The Dashboard's locale file of `language`, or nothing when it has none.
export const readDashboardLocale: (language: string) => LocaleDictionary = (
  language: string,
): LocaleDictionary => {
  const file: string = path.join(
    DASHBOARD_LOCALES_DIRECTORY,
    `${language}.json`,
  );

  if (!fs.existsSync(file)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(file, "utf8")) as LocaleDictionary;
};

/*
 * A language's file with the Dashboard's wording of every shared sentence
 * (DASHBOARD_SHARED_TEXT_SOURCES): the Dashboard's, or the English while
 * the Dashboard has none yet - never a wording of the server's own, so the
 * two can never word a record's text apart.
 */
export const withDashboardWordings: (data: {
  english: LocaleDictionary;
  locale: LocaleDictionary;
  dashboard: LocaleDictionary;
  sharedKeys: ReadonlySet<string>;
}) => LocaleDictionary = (data: {
  english: LocaleDictionary;
  locale: LocaleDictionary;
  dashboard: LocaleDictionary;
  sharedKeys: ReadonlySet<string>;
}): LocaleDictionary => {
  const worded: LocaleDictionary = { ...data.locale };

  for (const key of data.sharedKeys) {
    const wording: string | undefined = Object.prototype.hasOwnProperty.call(
      data.dashboard,
      key,
    )
      ? data.dashboard[key]
      : undefined;

    worded[key] =
      typeof wording === "string" && wording.length > 0
        ? wording
        : data.english[key] || key;
  }

  return worded;
};

/*
 * Writes en.json from the sources and every other language aligned to it,
 * the sentences shared with the Dashboard worded as the Dashboard words
 * them. Returns the files that changed.
 */
export const syncServerLocales: () => Array<string> = (): Array<string> => {
  const keys: Array<ServerTextKey> = findServerTextKeys();
  const english: LocaleDictionary = buildEnglishLocale(keys);
  const sharedKeys: Set<string> = getDashboardSharedKeys(keys);
  const changed: Array<string> = [];

  const write: (language: string, dictionary: LocaleDictionary) => void = (
    language: string,
    dictionary: LocaleDictionary,
  ): void => {
    const file: string = getLocalePath(language);
    const text: string = toLocaleText(dictionary);
    const before: string | null = fs.existsSync(file)
      ? fs.readFileSync(file, "utf8")
      : null;

    if (before !== text) {
      fs.writeFileSync(file, text);
      changed.push(path.relative(REPOSITORY_ROOT, file));
    }
  };

  write(ENGLISH, english);

  for (const language of TRANSLATED_LANGUAGES) {
    write(
      language,
      alignLocale({
        english: english,
        locale: withDashboardWordings({
          english: english,
          locale: readLocale(language),
          dashboard: readDashboardLocale(language),
          sharedKeys: sharedKeys,
        }),
      }),
    );
  }

  return changed;
};
