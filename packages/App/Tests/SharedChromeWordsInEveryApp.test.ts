import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  ACCOUNTS_LANGUAGES,
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
  STATUS_PAGE_LANGUAGES,
} from "Common/Tests/Helpers/TranslatedLanguages";

/*
 * THE PAGE'S OWN WORDS, IN EVERY LANGUAGE OF EVERY APP THAT DRAWS THEM
 * (#7339).
 *
 * A few words are drawn by the page's shared parts themselves, on almost
 * every page, whatever the page around them says:
 *
 *   - "Click to reveal" on a secret behind HiddenText (an API key, a
 *     token, the license key);
 *   - "Click to copy" on an ID's pill (ObjectIDView);
 *   - the side menu's name, "Main navigation", which a screen reader says
 *     as it reaches the menu, and on a phone the menu's "Navigate to"
 *     above the page it names (or "Navigation" where it names none);
 *   - the breadcrumbs' name, "Breadcrumb", which a screen reader says on
 *     every page that has a trail;
 *   - the skip link, "Skip to main content" (MasterPage), the first thing a
 *     keyboard reaches;
 *   - and, once a person clicks, what the reveal button and the ID pill say
 *     next: the secret's "Copy" and "Hide", and "Copied!" or "Copy failed".
 *
 * They were English in pages otherwise in the reader's language: the first
 * three in eleven of the Dashboard's and the Admin Dashboard's languages,
 * the breadcrumbs' name in German, Spanish and Italian, the skip link in
 * French too - "Breadcrumb" on every German Admin Dashboard page - and the
 * Status Page, which draws the same side menu and breadcrumbs, had none of
 * them in its locales at all.
 *
 * So, for every app OneUptime ships a locale for:
 *
 *   - the Dashboard and the Admin Dashboard draw every one of these parts;
 *     the other apps draw whichever of them their bundle reaches, followed
 *     from the app's entry (src/Index.tsx) through every import the build
 *     keeps;
 *   - each word a part an app draws says is an entry of all of that app's
 *     locales, worded otherwise than English in every language but where
 *     the language writes it as English does (German "Navigation");
 *   - each app words it as the same language's Dashboard does: one page of
 *     the Admin Dashboard or a status page names its menu and its trail as
 *     the Dashboard does.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../..");
const FEATURE_SET: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet",
);
const COMMON: string = path.join(REPOSITORY_ROOT, "packages/Common");
const COMPONENTS: string = path.join(COMMON, "UI/Components");
const ENTERPRISE: string = path.join(REPOSITORY_ROOT, "ee");

type App =
  | "Dashboard"
  | "AdminDashboard"
  | "StatusPage"
  | "Accounts"
  | "PublicDashboard";

type Locale = Record<string, unknown>;

interface ChromePart {
  // The part's file, under Common/UI/Components.
  file: string;
  // What it is, for a failure's message.
  what: string;
  // The words it draws, each looked up by its English.
  words: ReadonlyArray<string>;
  /*
   * The words it draws once a person clicks it, which the dashboards and
   * the sign-in pages already had among their own.
   */
  afterAClick: ReadonlyArray<string>;
}

const CHROME_PARTS: ReadonlyArray<ChromePart> = [
  {
    file: "HiddenText/HiddenText.tsx",
    what: "a secret's reveal button",
    words: ["Click to reveal"],
    afterAClick: ["Copy", "Copied!", "Copy failed", "Hide"],
  },
  {
    file: "ObjectID/ObjectIDView.tsx",
    what: "an ID pill's tooltip",
    words: ["Click to copy"],
    afterAClick: ["Copied!", "Copy failed"],
  },
  {
    file: "SideMenu/SideMenu.tsx",
    what: "the side menu's name and its phone summary",
    words: ["Main navigation", "Navigate to", "Navigation"],
    afterAClick: [],
  },
  {
    file: "Breadcrumbs/Breadcrumbs.tsx",
    what: "the breadcrumbs' name",
    words: ["Breadcrumb"],
    afterAClick: [],
  },
  {
    file: "MasterPage/MasterPage.tsx",
    what: "the skip link",
    words: ["Skip to main content"],
    afterAClick: [],
  },
];

// Every word a part draws, the ones after a click among them, once each.
function everyWordOf(parts: ReadonlyArray<ChromePart>): Array<string> {
  return Array.from(
    new Set<string>(
      parts.flatMap((part: ChromePart): ReadonlyArray<string> => {
        return [...part.words, ...part.afterAClick];
      }),
    ),
  );
}

const EVERY_WORD: ReadonlyArray<string> = everyWordOf(CHROME_PARTS);

/*
 * The words a language writes as English does: "Navigation" is German,
 * Danish and French for navigation.
 */
const SAME_AS_ENGLISH: Record<string, ReadonlyArray<string>> = {
  da: ["Navigation"],
  de: ["Navigation"],
  fr: ["Navigation"],
};

// Each app's locales, by language (English aside).
function localeLanguages(app: App): ReadonlyArray<string> {
  return fs
    .readdirSync(path.join(FEATURE_SET, app, "src/Locales"))
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    })
    .sort();
}

const APP_LANGUAGES: Record<App, ReadonlyArray<string>> = {
  Dashboard: DASHBOARD_LANGUAGES,
  AdminDashboard: ADMIN_DASHBOARD_LANGUAGES,
  StatusPage: STATUS_PAGE_LANGUAGES,
  Accounts: ACCOUNTS_LANGUAGES,
  PublicDashboard: localeLanguages("PublicDashboard"),
};

const APPS: ReadonlyArray<App> = Object.keys(APP_LANGUAGES) as Array<App>;

// The apps whose pages are drawn with every part: their menus, their trails.
const DRAW_EVERY_PART: ReadonlyArray<App> = ["Dashboard", "AdminDashboard"];

const localeCache: Map<string, Locale> = new Map<string, Locale>();

function readLocale(app: App, language: string): Locale {
  const file: string = path.join(
    FEATURE_SET,
    app,
    "src/Locales",
    `${language}.json`,
  );
  const cached: Locale | undefined = localeCache.get(file);

  if (cached) {
    return cached;
  }

  const locale: Locale = JSON.parse(fs.readFileSync(file, "utf8")) as Locale;

  localeCache.set(file, locale);

  return locale;
}

/*
 * The words of `words` a locale leaves out or says in English, each with
 * why: missing, or English in a language that words it otherwise.
 */
function wordsLeftInEnglish(
  locale: Locale,
  words: ReadonlyArray<string>,
  language: string,
): Array<string> {
  const keptAsEnglish: ReadonlyArray<string> = SAME_AS_ENGLISH[language] || [];

  return words
    .filter((word: string): boolean => {
      const worded: unknown = locale[word];

      return (
        typeof worded !== "string" ||
        worded.trim().length === 0 ||
        (worded === word && !keptAsEnglish.includes(word))
      );
    })
    .map((word: string): string => {
      const worded: unknown = locale[word];

      return typeof worded === "string" && worded.trim().length > 0
        ? `${word} (in English)`
        : `${word} (missing)`;
    });
}

/*
 * THE WALK: the source files an app's bundle holds, from its entry through
 * every import the build keeps (as AdminImportedCommonStringsLocales walks
 * the Admin Dashboard's).
 */

const SOURCE_FILE: RegExp = /\.tsx?$/;

/*
 * Loaded only to rebuild what the API sends (JSONFunctions): every type the
 * server can send, none of which these apps draw through it.
 */
const JSON_TYPES_DICTIONARY: string = path.join(
  COMMON,
  "Types/SerializableObjectDictionary.ts",
);

// The Enterprise plugin and the app's own source, as ee/ imports it.
const ENTERPRISE_ALIASES: Partial<
  Record<App, { plugin: string; source: string; folder: string }>
> = {
  Dashboard: {
    plugin: "@oneuptime/ee-dashboard",
    source: "@oneuptime/dashboard/",
    folder: "Dashboard",
  },
  AdminDashboard: {
    plugin: "@oneuptime/ee-admin-dashboard",
    source: "@oneuptime/admin-dashboard/",
    folder: "AdminDashboard",
  },
};

function resolveSpecifier(
  app: App,
  fromFile: string,
  specifier: string,
): string | undefined {
  const appSource: string = path.join(FEATURE_SET, app, "src");
  const enterprise:
    | { plugin: string; source: string; folder: string }
    | undefined = ENTERPRISE_ALIASES[app];
  let base: string;

  if (enterprise && specifier === enterprise.plugin) {
    const plugin: string = path.join(ENTERPRISE, enterprise.folder, "Index");

    base = fs.existsSync(`${plugin}.tsx`)
      ? plugin
      : path.join(appSource, "Enterprise/CommunityPlugins");
  } else if (enterprise && specifier.startsWith(enterprise.source)) {
    base = path.join(appSource, specifier.slice(enterprise.source.length));
  } else if (specifier.startsWith("Common/")) {
    base = path.join(COMMON, specifier.slice("Common/".length));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    // A package: none of these parts.
    return undefined;
  }

  return [
    `${base}.tsx`,
    `${base}.ts`,
    base,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ].find((candidate: string): boolean => {
    return (
      SOURCE_FILE.test(candidate) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    );
  });
}

/*
 * The modules a file loads once built: TypeScript's emit drops an import
 * used only for its types, as esbuild does.
 */
function valueImportsOf(fileName: string, text: string): Array<string> {
  const built: string = ts.transpileModule(text, {
    fileName: fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2017,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      experimentalDecorators: true,
    },
  }).outputText;

  return ts
    .preProcessFile(built, true, true)
    .importedFiles.map((imported: ts.FileReference): string => {
      return imported.fileName;
    });
}

const bundleCache: Map<App, Set<string>> = new Map<App, Set<string>>();

function walkBundle(app: App): Set<string> {
  const cached: Set<string> | undefined = bundleCache.get(app);

  if (cached) {
    return cached;
  }

  const entry: string = path.join(FEATURE_SET, app, "src/Index.tsx");
  const reached: Set<string> = new Set<string>([entry]);
  const queue: Array<string> = [entry];

  while (queue.length > 0) {
    const file: string = queue.shift() as string;

    if (file === JSON_TYPES_DICTIONARY) {
      continue;
    }

    for (const specifier of valueImportsOf(
      file,
      fs.readFileSync(file, "utf8"),
    )) {
      const target: string | undefined = resolveSpecifier(app, file, specifier);

      if (target && !reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }

  bundleCache.set(app, reached);

  return reached;
}

// The parts an app draws.
function partsDrawnBy(app: App): Array<ChromePart> {
  if (DRAW_EVERY_PART.includes(app)) {
    return [...CHROME_PARTS];
  }

  const bundle: Set<string> = walkBundle(app);

  return CHROME_PARTS.filter((part: ChromePart): boolean => {
    return bundle.has(path.join(COMPONENTS, part.file));
  });
}

// Every word the parts an app draws say, the ones after a click among them.
function wordsDrawnBy(app: App): Array<string> {
  return everyWordOf(partsDrawnBy(app));
}

// The words the parts an app draws say before anyone clicks.
function chromeWordsDrawnBy(app: App): Array<string> {
  return partsDrawnBy(app).flatMap(
    (part: ChromePart): ReadonlyArray<string> => {
      return part.words;
    },
  );
}

const CASES: Array<[App, string]> = APPS.flatMap(
  (app: App): Array<[App, string]> => {
    return APP_LANGUAGES[app].map((language: string): [App, string] => {
      return [app, language];
    });
  },
);

describe("the page's shared words", () => {
  test.each(
    CHROME_PARTS.map((part: ChromePart): [string, ChromePart] => {
      return [part.file, part];
    }),
  )("%s still draws its words", (_file: string, part: ChromePart) => {
    const source: string = fs.readFileSync(
      path.join(COMPONENTS, part.file),
      "utf8",
    );

    for (const word of [...part.words, ...part.afterAClick]) {
      expect({
        part: part.what,
        word,
        drawn: source.includes(`"${word}"`),
      }).toEqual({ part: part.what, word, drawn: true });
    }
  });

  test("the walk follows the Status Page into the side menu and the breadcrumbs", () => {
    const bundle: Set<string> = walkBundle("StatusPage");

    // Many: a walk that stopped at the entry would draw nothing.
    expect(bundle.size).toBeGreaterThan(300);
    expect(
      partsDrawnBy("StatusPage").map((part: ChromePart): string => {
        return part.file;
      }),
    ).toEqual(
      expect.arrayContaining([
        "SideMenu/SideMenu.tsx",
        "Breadcrumbs/Breadcrumbs.tsx",
      ]),
    );
  });

  test("the walk drops an import used only for its types, as the build does", () => {
    expect(
      valueImportsOf(
        "Page.tsx",
        [
          'import SideMenu, { ComponentProps } from "Common/UI/Components/SideMenu/SideMenu";',
          'import Breadcrumbs from "Common/UI/Components/Breadcrumbs/Breadcrumbs";',
          "export type Props = ComponentProps;",
          "export const page: unknown = Breadcrumbs;",
        ].join("\n"),
      ),
    ).toEqual(["Common/UI/Components/Breadcrumbs/Breadcrumbs"]);
  });

  test.each(APPS)(
    "%s's English has each word it draws, as written",
    (app: App) => {
      const english: Locale = readLocale(app, "en");

      for (const word of wordsDrawnBy(app)) {
        expect({ app, word, english: english[word] }).toEqual({
          app,
          word,
          english: word,
        });
      }
    },
  );

  test.each(CASES)("%s says them in %s", (app: App, language: string) => {
    expect({
      app,
      language,
      leftInEnglish: wordsLeftInEnglish(
        readLocale(app, language),
        wordsDrawnBy(app),
        language,
      ),
    }).toEqual({ app, language, leftInEnglish: [] });
  });

  test.each(
    CASES.filter(([app]: [App, string]): boolean => {
      return app !== "Dashboard";
    }),
  )(
    "%s words them in %s as the Dashboard does",
    (app: App, language: string) => {
      const dashboard: Locale = readLocale("Dashboard", language);
      const locale: Locale = readLocale(app, language);
      const apart: Array<string> = wordsDrawnBy(app).filter(
        (word: string): boolean => {
          return locale[word] !== dashboard[word];
        },
      );

      expect({ app, language, apart }).toEqual({ app, language, apart: [] });
    },
  );

  test("each word a language keeps in English is still English there, and drawn", () => {
    for (const [language, words] of Object.entries(SAME_AS_ENGLISH)) {
      for (const word of words) {
        expect(EVERY_WORD).toContain(word);
        expect({
          language,
          word,
          worded: readLocale("Dashboard", language)[word],
        }).toEqual({ language, word, worded: word });
      }
    }
  });

  test.each(
    APPS.filter((app: App): boolean => {
      return !DRAW_EVERY_PART.includes(app);
    }),
  )(
    "%s keeps them together, at one place in every locale, before its markdownCallouts block",
    (app: App) => {
      const englishKeys: Array<string> = Object.keys(readLocale(app, "en"));
      const words: Array<string> = chromeWordsDrawnBy(app);
      const first: number = englishKeys.indexOf(words[0] as string);

      // Side by side, in the parts' order.
      expect(englishKeys.slice(first, first + words.length)).toEqual(words);

      for (const language of ["en", ...APP_LANGUAGES[app]]) {
        const keys: Array<string> = Object.keys(readLocale(app, language));
        const callouts: number = keys.indexOf("markdownCallouts");
        const misplaced: Array<string> = words.filter(
          (word: string): boolean => {
            return (
              keys.indexOf(word) !== englishKeys.indexOf(word) ||
              (callouts >= 0 && keys.indexOf(word) > callouts)
            );
          },
        );

        expect({ app, language, misplaced }).toEqual({
          app,
          language,
          misplaced: [],
        });
      }
    },
  );

  /*
   * A form's summary step draws its values with Detail, which draws a
   * hidden value with HiddenText and an ID with ObjectIDView: every app
   * with a form holds them, and says their words, though no field of the
   * sign-in pages, a status page or a public dashboard draws one today.
   */
  test.each(["Accounts", "PublicDashboard", "StatusPage"] as Array<App>)(
    "%s's forms hold the reveal button and the ID pill",
    (app: App) => {
      const bundle: Set<string> = walkBundle(app);

      for (const file of [
        "Forms/BasicForm.tsx",
        "Detail/Detail.tsx",
        "HiddenText/HiddenText.tsx",
        "ObjectID/ObjectIDView.tsx",
      ]) {
        expect({
          app,
          file,
          held: bundle.has(path.join(COMPONENTS, file)),
        }).toEqual({ app, file, held: true });
      }
    },
  );

  test("the check finds a word left out or left in English, and keeps one a language writes as English (negative control)", () => {
    const planted: Locale = {
      "Click to reveal": "Zum Anzeigen klicken",
      "Click to copy": "Click to copy",
      "Main navigation": "",
      Navigation: "Navigation",
      Breadcrumb: "Navigationspfad",
    };
    const words: Array<string> = [
      "Click to reveal",
      "Click to copy",
      "Main navigation",
      "Navigation",
      "Breadcrumb",
      "Skip to main content",
    ];

    expect(wordsLeftInEnglish(planted, words, "de")).toEqual([
      "Click to copy (in English)",
      "Main navigation (missing)",
      "Skip to main content (missing)",
    ]);
    // Italian words Navigation (Navigazione): English there is left over.
    expect(wordsLeftInEnglish(planted, words, "it")).toContain(
      "Navigation (in English)",
    );
  });
});
