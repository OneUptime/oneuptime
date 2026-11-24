// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AUTHENTICATOR_APP_LANGUAGES,
  AUTHENTICATOR_APP_WORDS,
  AuthenticatorAppWord,
} from "Common/Tests/Helpers/AuthenticatorAppWords";

/*
 * THE AUTHENTICATOR APP HAS ONE NAME IN EACH LANGUAGE (#10915).
 *
 * Someone made to set up two-factor authentication at sign-in, in Hindi,
 * picked "प्रमाणीकरण ऐप", was asked for the code from the "प्रमाणक ऐप",
 * and then managed their "ऑथेंटिकेटर ऐप" in the Dashboard: three names for
 * the one app, on the pages of one flow. Danish, Portuguese and Persian
 * said two or three words too, and German and Spanish a second one in a
 * few sentences. Each language now says the word its Dashboard's
 * Authenticator apps card says (Common/Tests/Helpers/AuthenticatorAppWords),
 * and this holds every place that names the app to it:
 *
 *   - every string of the sign-in pages (Accounts), the Dashboard, the
 *     Admin Dashboard and the server's messages whose English names an
 *     "authenticator app" says the language's word, in whatever form its
 *     sentence needs;
 *   - no string of those says a word the language dropped for it, whatever
 *     its English says ("Lost access to your authenticator?" named the app
 *     autentifikator-app in Danish);
 *   - every docs line whose English line names an authenticator app says
 *     the word, and no docs page says a dropped one.
 *
 * A string or a docs line still in English is the i18n ratchet's business,
 * not this guard's: it names no app another way. A phrase whose dropped
 * word means something else is listed in KEPT_PHRASES with why.
 *
 * A failure names the app and the key, or the page and the line, and what
 * it says: write the language's word there, in the form the sentence needs.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const FEATURE_SETS: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet",
);
const DOCS_CONTENT: string = path.join(FEATURE_SETS, "Docs/Content");

// Every place a word of OneUptime's names the app, by who reads it.
const LOCALE_DIRECTORIES: Readonly<Record<string, string>> = {
  "Sign-in pages": path.join(FEATURE_SETS, "Accounts/src/Locales"),
  Dashboard: path.join(FEATURE_SETS, "Dashboard/src/Locales"),
  "Admin Dashboard": path.join(FEATURE_SETS, "AdminDashboard/src/Locales"),
  Server: path.join(REPOSITORY_ROOT, "packages/Common/Server/Locales"),
};

// What names the app in English.
const NAMES_THE_APP: RegExp = /authenticator apps?/i;

/*
 * Phrases whose dropped word means something else, taken out of a text
 * before it is read: one per language, with why.
 */
const KEPT_PHRASES: Readonly<
  Record<string, ReadonlyArray<{ phrase: RegExp; why: string }>>
> = {
  fa: [
    {
      phrase: /برنامه احراز هویت می‌کند/g,
      why: "a GitHub App's private key lets OneUptime authenticate as the app: احراز هویت کردن is the verb there, not the app's name",
    },
  ],
};

type LocaleTree = { [key: string]: string | LocaleTree };

interface LocaleEntry {
  key: string;
  english: string;
  value: string | undefined;
}

function readTree(file: string): LocaleTree {
  return JSON.parse(fs.readFileSync(file, "utf8")) as LocaleTree;
}

function valueAt(tree: LocaleTree, keys: Array<string>): string | undefined {
  let node: string | LocaleTree | undefined = tree;

  for (const key of keys) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = node[key];
  }

  return typeof node === "string" ? node : undefined;
}

// Every text of an app's English file, flat or nested, and the language's.
function entriesOf(directory: string, language: string): Array<LocaleEntry> {
  const english: LocaleTree = readTree(path.join(directory, "en.json"));
  const translated: LocaleTree = readTree(
    path.join(directory, `${language}.json`),
  );
  const entries: Array<LocaleEntry> = [];

  const walk: (node: LocaleTree, keys: Array<string>) => void = (
    node: LocaleTree,
    keys: Array<string>,
  ): void => {
    for (const [key, child] of Object.entries(node)) {
      if (typeof child === "string") {
        entries.push({
          key: [...keys, key].join(" > "),
          english: child,
          value: valueAt(translated, [...keys, key]),
        });
      } else {
        walk(child, [...keys, key]);
      }
    }
  };

  walk(english, []);

  return entries;
}

// Every text of a language's file, whatever its English says.
function textsOf(file: string): Array<{ key: string; text: string }> {
  const texts: Array<{ key: string; text: string }> = [];

  const walk: (node: LocaleTree, keys: Array<string>) => void = (
    node: LocaleTree,
    keys: Array<string>,
  ): void => {
    for (const [key, child] of Object.entries(node)) {
      if (typeof child === "string") {
        texts.push({ key: [...keys, key].join(" > "), text: child });
      } else {
        walk(child, [...keys, key]);
      }
    }
  };

  walk(readTree(file), []);

  return texts;
}

function withoutKeptPhrases(language: string, text: string): string {
  let words: string = text;

  for (const kept of KEPT_PHRASES[language] || []) {
    words = words.replace(kept.phrase, " ");
  }

  return words;
}

// The docs pages, by their path under a language's folder.
function docsPagesOf(language: string): Array<string> {
  const root: string = path.join(DOCS_CONTENT, language);
  const pages: Array<string> = [];

  if (!fs.existsSync(root)) {
    return pages;
  }

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.name.endsWith(".md")) {
        pages.push(path.relative(root, entryPath));
      }
    }
  };

  walk(root);

  return pages.sort();
}

function linesOf(language: string, page: string): Array<string> {
  return fs
    .readFileSync(path.join(DOCS_CONTENT, language, page), "utf8")
    .split("\n");
}

function wordOf(language: string): AuthenticatorAppWord {
  return AUTHENTICATOR_APP_WORDS[language] as AuthenticatorAppWord;
}

describe("the authenticator app's one word, in every app's words", () => {
  test.each(AUTHENTICATOR_APP_LANGUAGES)(
    "%s: every string that names an authenticator app says the language's word",
    (language: string) => {
      const word: RegExp = wordOf(language).word;
      const others: Array<string> = [];
      let named: number = 0;

      for (const [app, directory] of Object.entries(LOCALE_DIRECTORIES)) {
        for (const entry of entriesOf(directory, language)) {
          if (!NAMES_THE_APP.test(entry.english)) {
            continue;
          }

          named++;

          // Still in English: the i18n ratchet's, and no other name.
          if (!entry.value || entry.value === entry.english) {
            continue;
          }

          if (!word.test(entry.value)) {
            others.push(`${app}: ${entry.key} => ${entry.value}`);
          }
        }
      }

      // The scan reads the strings #10915 found: some sixty of them.
      expect(named).toBeGreaterThan(50);
      expect(others).toEqual([]);
    },
  );

  test.each(
    AUTHENTICATOR_APP_LANGUAGES.filter((language: string): boolean => {
      return Boolean(wordOf(language).dropped);
    }),
  )("%s: no string of any app says a word it dropped", (language: string) => {
    const dropped: RegExp = wordOf(language).dropped as RegExp;
    const sightings: Array<string> = [];

    for (const [app, directory] of Object.entries(LOCALE_DIRECTORIES)) {
      for (const entry of textsOf(path.join(directory, `${language}.json`))) {
        const says: RegExpMatchArray | null = withoutKeptPhrases(
          language,
          entry.text,
        ).match(dropped);

        if (says) {
          sightings.push(`${app}: ${entry.key} says ${says[0]}`);
        }
      }
    }

    expect(sightings).toEqual([]);
  });
});

describe("the authenticator app's one word, in the docs", () => {
  const DOCS_LANGUAGES: Array<string> = AUTHENTICATOR_APP_LANGUAGES.filter(
    (language: string): boolean => {
      return fs.existsSync(path.join(DOCS_CONTENT, language));
    },
  );

  test("the docs of every language but Arabic are read", () => {
    expect(DOCS_LANGUAGES).toHaveLength(AUTHENTICATOR_APP_LANGUAGES.length - 1);
    expect(DOCS_LANGUAGES).not.toContain("ar");
  });

  test.each(DOCS_LANGUAGES)(
    "%s: every translated line whose English line names an authenticator app says the word",
    (language: string) => {
      const word: RegExp = wordOf(language).word;
      const others: Array<string> = [];
      let named: number = 0;

      for (const page of docsPagesOf("en")) {
        if (!fs.existsSync(path.join(DOCS_CONTENT, language, page))) {
          continue;
        }

        const englishLines: Array<string> = linesOf("en", page);
        const lines: Array<string> = linesOf(language, page);

        // A page translated line for line; others are read for dropped words.
        if (englishLines.length !== lines.length) {
          continue;
        }

        for (let index: number = 0; index < englishLines.length; index++) {
          const englishLine: string = englishLines[index] || "";
          const line: string = lines[index] || "";

          if (!NAMES_THE_APP.test(englishLine) || line === englishLine) {
            continue;
          }

          named++;

          if (!word.test(line)) {
            others.push(`${page}:${index + 1} => ${line.slice(0, 160)}`);
          }
        }
      }

      // Your Account, SSO, the mobile apps, Monitor Secrets name it.
      expect(named).toBeGreaterThan(10);
      expect(others).toEqual([]);
    },
  );

  test.each(
    DOCS_LANGUAGES.filter((language: string): boolean => {
      return Boolean(wordOf(language).dropped);
    }),
  )("%s: no docs page says a word it dropped", (language: string) => {
    const dropped: RegExp = wordOf(language).dropped as RegExp;
    const sightings: Array<string> = [];

    for (const page of docsPagesOf(language)) {
      linesOf(language, page).forEach((line: string, index: number): void => {
        const says: RegExpMatchArray | null = withoutKeptPhrases(
          language,
          line,
        ).match(dropped);

        if (says) {
          sightings.push(`${page}:${index + 1} says ${says[0]}`);
        }
      });
    }

    expect(sightings).toEqual([]);
  });
});

/*
 * The table against the words it is for: each language's word is the one
 * its Dashboard's Authenticator apps card says, and each dropped word is a
 * word it once said, so a pattern that matched nothing would not pass.
 */
describe("the words the guard holds the apps to", () => {
  const dashboard: (language: string) => LocaleTree = (
    language: string,
  ): LocaleTree => {
    return readTree(
      path.join(LOCALE_DIRECTORIES["Dashboard"] as string, `${language}.json`),
    );
  };

  test.each(AUTHENTICATOR_APP_LANGUAGES)(
    "%s: the word is the Dashboard's Authenticator apps card's",
    (language: string) => {
      const card: string | undefined = valueAt(dashboard(language), [
        "Authenticator apps",
      ]);

      expect(card).toBeDefined();
      expect(card).not.toBe("Authenticator apps");
      expect(card).toMatch(wordOf(language).word);
    },
  );

  test.each([
    ["da", "Mistet adgangen til din autentifikator-app?"],
    ["hi", "अपने प्रमाणक ऐप में दर्ज करें।"],
    ["hi", "प्रमाणीकरण ऐप"],
    ["pt", "Adicionar à aplicação de autenticação"],
    ["pt", "Digite o código do seu aplicativo autenticador"],
    ["pt", "configurar um aplicativo de autenticação"],
    ["fa", "برنامهٔ احراز هویت"],
    ["fa", "برنامه‌های احراز هویت"],
    ["fa", "برنامه احراز هویتم را گم کرده‌ام"],
    ["de", "Ihre Authentifizierungs-Apps und Sicherheitsschlüssel"],
    ["es", "Introduce un nombre para tu app de autenticación."],
  ])("%s: %p is a dropped word", (language: string, text: string) => {
    expect(text).toMatch(wordOf(language).dropped as RegExp);
    expect(text).not.toMatch(wordOf(language).word);
  });

  test.each([
    ["es", "Aplicaciones de autenticación"],
    ["pt", "Seus apps autenticadores e chaves de segurança"],
    ["fa", "اپلیکیشن‌های احراز هویت"],
  ])(
    "%s: %p says the word, and no dropped one",
    (language: string, text: string) => {
      expect(text).toMatch(wordOf(language).word);
      expect(text).not.toMatch(wordOf(language).dropped as RegExp);
    },
  );

  test("a kept phrase is only the verb: the app's name is still read", () => {
    expect(
      withoutKeptPhrases(
        "fa",
        "OneUptime با آن به‌عنوان برنامه احراز هویت می‌کند.",
      ),
    ).not.toMatch(wordOf("fa").dropped as RegExp);
    expect(
      withoutKeptPhrases("fa", "کدی از برنامهٔ احراز هویت وارد کنید."),
    ).toMatch(wordOf("fa").dropped as RegExp);
  });
});
