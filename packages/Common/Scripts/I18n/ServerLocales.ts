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
 *     other: "..." }) call;
 *   - in an email template, the email language helpers
 *     (Notification/Utils/EmailLanguage): t, tHtml, tt, ttHtml and tp.
 *
 * `npm run i18n:server-sync` (SyncServerLocales.ts) writes en.json from them
 * and gives every other language each new sentence in English, to be
 * translated; Tests/Server/Locales/ServerLocales.test.ts holds the files to
 * it. Pure but for reading and writing the files, linear in what it reads.
 */

export const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

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
  "packages/App/FeatureSet/Workers/Jobs",
  "packages/App/FeatureSet/Notification/Templates",
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

const TYPESCRIPT_KEY_CALL: RegExp = new RegExp(
  `\\b(?:translationKey|translateText|translateTemplate)\\(\\s*${STRING_LITERAL_BODY}`,
  "g",
);

const TYPESCRIPT_PLURAL_CALL: RegExp = new RegExp(
  `\\btranslatePlural\\(\\s*\\{\\s*one:\\s*${STRING_LITERAL_BODY},\\s*other:\\s*${STRING_LITERAL_BODY}`,
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
    keys.push({ key: readLiteral(match[1] || ""), file: data.file });
  }

  for (const match of data.text.matchAll(pluralCall)) {
    keys.push({
      key: readLiteral(match[2] || ""),
      one: readLiteral(match[1] || ""),
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
 * Writes en.json from the sources and every other language aligned to it.
 * Returns the files that changed.
 */
export const syncServerLocales: () => Array<string> = (): Array<string> => {
  const english: LocaleDictionary = buildEnglishLocale(findServerTextKeys());
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
      alignLocale({ english: english, locale: readLocale(language) }),
    );
  }

  return changed;
};
