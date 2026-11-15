// UX rule: Docs/ux/README.md#in-every-language
import { afterAll, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import type { i18n as I18nInstance } from "i18next";
import path from "path";
import { makeT as makeApiReferenceT } from "../../../App/FeatureSet/APIReference/Utils/I18n";
import { makeT as makeDocsT } from "../../../App/FeatureSet/Docs/Utils/I18n";
import { getServerTranslator } from "../../Server/Utils/ServerTranslation";
import { HtmlMarkupReplacer, replaceHtmlMarkup } from "../../Types/HtmlMarkup";
import {
  NoBreakLocaleTree,
  withNoBreakSpacesInLocale,
} from "../../Types/NoBreakSpaces";
import { Translator } from "../../Types/Translator";
import { dashboardTranslator } from "../Helpers/DashboardLocales";

/*
 * EVERY FRENCH TEXT ONEUPTIME DRAWS KEEPS ITS MARKS WITH ITS WORDS (#8032).
 *
 * French writes a space before » ? ! : and ; and after «, and every French
 * locale file writes a plain one there (DashboardFrenchPunctuation keeps
 * them so). A line may break at a plain space, so a narrow page started a
 * line with "»", "?" or ":". The product draws each of those spaces as a
 * no-break one (Common/Types/NoBreakSpaces): the Translator, every
 * frontend's i18next as it loads a locale, the server, and the docs.
 *
 * This holds every French locale file the product draws to it, every text
 * in each, the way that product draws it:
 *
 *   - the files: each one there is, so a new frontend's French is drawn
 *     the same way before this passes (FRENCH_LOCALES);
 *   - the texts: each of its own wordings, drawn, has no space a line
 *     breaks at before a French mark or after «;
 *   - the frontends: each one's real i18n module, switched to French, hands
 *     i18next its words set, and each module goes through the setting.
 *
 * The check that finds a space a line breaks at is written here, apart
 * from the code that sets them, so it cannot agree with a mistake there.
 */

const PACKAGES: string = path.resolve(__dirname, "../../..");
const FEATURE_SETS: string = path.join(PACKAGES, "App", "FeatureSet");

// A space a line may break at: the space and the fixed-width ones.
const BREAKING: string = "[\\u0020\\u2000-\\u2006\\u2008-\\u200A\\u205F]";

/*
 * A French mark a line could start with: one that ends a clause after a
 * word (a letter, a digit, a closing bracket or quote, a placeholder,
 * Markdown's emphasis), after a space a line breaks at.
 */
const MARK_AFTER_A_BREAK: RegExp = new RegExp(
  `[\\p{L}\\p{N}»)\\]}*_]${BREAKING}+[?!:;](?=$|\\s|[»”"')\\]*_<.…?!])`,
  "gu",
);

// A guillemet a line could start or end with.
const GUILLEMET_BESIDE_A_BREAK: RegExp = new RegExp(
  `\\S${BREAKING}+[»›]|[«‹]${BREAKING}+\\S`,
  "gu",
);

// What i18next reads in a key as a path: a key with one is looked up flat.
const KEY_SEPARATORS: RegExp = /[.:]/;

/*
 * What a text holds as it is written: code, and an HTML tag. Each is read
 * as one "`", code first (a tag inside it is code), then each tag through
 * the shared walk (replaceHtmlMarkup), which reads a "<" as a browser
 * does: "« < 15 s »" is text, its spaces read too.
 */
const CODE_SPAN: RegExp = /`[^`]*`/g;

const AS_WRITTEN_MARK: HtmlMarkupReplacer = (): string => {
  return "`";
};

// Where `text` lets a line break beside a French mark: each spot, quoted.
function frenchBreaksIn(text: string): Array<string> {
  const prose: string = replaceHtmlMarkup(
    text.replace(CODE_SPAN, "`"),
    AS_WRITTEN_MARK,
    { lessThanAsText: true },
  );

  return [
    ...(prose.match(MARK_AFTER_A_BREAK) || []),
    ...(prose.match(GUILLEMET_BESIDE_A_BREAK) || []),
  ];
}

type LocaleTree = { [key: string]: unknown };

function readJson(file: string): LocaleTree {
  return JSON.parse(fs.readFileSync(file, "utf8")) as LocaleTree;
}

// Every string of a locale, by its path: [path, text].
function leavesOf(
  tree: LocaleTree,
  prefix: Array<string> = [],
): Array<[Array<string>, string]> {
  const found: Array<[Array<string>, string]> = [];

  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") {
      found.push([[...prefix, key], value]);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      found.push(...leavesOf(value as LocaleTree, [...prefix, key]));
    }
  }

  return found;
}

// The English at `at` in `english`, or undefined.
function englishAt(english: LocaleTree, at: Array<string>): string | undefined {
  let node: unknown = english;

  for (const key of at) {
    if (!node || typeof node !== "object") {
      return undefined;
    }

    node = (node as LocaleTree)[key];
  }

  return typeof node === "string" ? node : undefined;
}

// A French entry that is the language's own: not English left in the file.
function isOwnWording(
  english: LocaleTree,
  at: Array<string>,
  french: string,
): boolean {
  const key: string = at[at.length - 1] as string;
  const englishText: string | undefined = englishAt(english, at);

  return french !== key && french !== englishText;
}

interface FrenchLocale {
  // Where it lives, from packages/.
  file: string;
  // Each own wording of the file as the product draws it.
  draw: (at: Array<string>, french: string) => string;
}

// A frontend that hands i18next its locale set by withNoBreakSpacesInLocale.
function drawnByI18next(localesDirectory: string): FrenchLocale["draw"] {
  const english: LocaleTree = readJson(path.join(localesDirectory, "en.json"));
  const set: LocaleTree = withNoBreakSpacesInLocale({
    locale: readJson(path.join(localesDirectory, "fr.json")),
    language: "fr",
    english: english as NoBreakLocaleTree,
  });

  return (at: Array<string>): string => {
    return englishAt(set, at) as string;
  };
}

const SERVER_FRENCH: Translator = getServerTranslator("fr");
const DASHBOARD_FRENCH: Translator = dashboardTranslator("fr");
const DOCS_FRENCH: (key: string) => string = makeDocsT("fr");
const API_REFERENCE_FRENCH: (key: string) => string = makeApiReferenceT("fr");

const DASHBOARD_LOCALES: string = path.join(
  FEATURE_SETS,
  "Dashboard",
  "src",
  "Locales",
);

const dashboardShipped: FrenchLocale["draw"] =
  drawnByI18next(DASHBOARD_LOCALES);

/*
 * Every French locale file the product draws, and how it draws it. A file
 * that is not listed fails the first test below: draw its French the same
 * way (withNoBreakSpacesInLocale, or the Translator), then list it.
 */
const FRENCH_LOCALES: ReadonlyArray<FrenchLocale> = [
  {
    // Drawn by i18next as it ships, and by the Translator: both are held.
    file: "App/FeatureSet/Dashboard/src/Locales/fr.json",
    draw: (at: Array<string>, french: string): string => {
      const shipped: string = dashboardShipped(at, french);
      const translated: string | undefined =
        at.length === 1
          ? DASHBOARD_FRENCH.translateText(at[0] as string)
          : undefined;

      return translated === undefined || translated === at[0]
        ? shipped
        : `${shipped}\n${translated}`;
    },
  },
  {
    file: "App/FeatureSet/AdminDashboard/src/Locales/fr.json",
    draw: drawnByI18next(
      path.join(FEATURE_SETS, "AdminDashboard", "src", "Locales"),
    ),
  },
  {
    file: "App/FeatureSet/Accounts/src/Locales/fr.json",
    draw: drawnByI18next(path.join(FEATURE_SETS, "Accounts", "src", "Locales")),
  },
  {
    file: "App/FeatureSet/StatusPage/src/Locales/fr.json",
    draw: drawnByI18next(
      path.join(FEATURE_SETS, "StatusPage", "src", "Locales"),
    ),
  },
  {
    file: "App/FeatureSet/PublicDashboard/src/Locales/fr.json",
    draw: drawnByI18next(
      path.join(FEATURE_SETS, "PublicDashboard", "src", "Locales"),
    ),
  },
  {
    file: "App/FeatureSet/Docs/Locales/fr.json",
    draw: (at: Array<string>): string => {
      return DOCS_FRENCH(at.join("."));
    },
  },
  {
    file: "App/FeatureSet/APIReference/Locales/fr.json",
    draw: (at: Array<string>): string => {
      return API_REFERENCE_FRENCH(at.join("."));
    },
  },
  {
    file: "Common/Server/Locales/fr.json",
    draw: (at: Array<string>): string => {
      return SERVER_FRENCH.translateText(at[0] as string) as string;
    },
  },
];

// Every French locale file under the product's packages, from packages/.
function findFrenchLocaleFiles(): Array<string> {
  const found: Array<string> = [];

  for (const featureSet of fs.readdirSync(FEATURE_SETS)) {
    for (const where of [["src", "Locales"], ["Locales"]]) {
      const file: string = path.join(
        FEATURE_SETS,
        featureSet,
        ...where,
        "fr.json",
      );

      if (fs.existsSync(file)) {
        found.push(path.relative(PACKAGES, file));
      }
    }
  }

  const server: string = path.join(
    PACKAGES,
    "Common",
    "Server",
    "Locales",
    "fr.json",
  );

  if (fs.existsSync(server)) {
    found.push(path.relative(PACKAGES, server));
  }

  return found.map((file: string): string => {
    return file.split(path.sep).join("/");
  });
}

describe("every French text OneUptime draws keeps its marks with its words", () => {
  test("every French locale file is listed with the way it is drawn", () => {
    expect(findFrenchLocaleFiles().sort()).toEqual(
      FRENCH_LOCALES.map((locale: FrenchLocale): string => {
        return locale.file;
      }).sort(),
    );
  });

  test.each(
    FRENCH_LOCALES.map((locale: FrenchLocale): [string, FrenchLocale] => {
      return [locale.file, locale];
    }),
  )(
    "%s: no French mark beside a space a line breaks at",
    (_file: string, locale: FrenchLocale) => {
      const directory: string = path.dirname(path.join(PACKAGES, locale.file));
      const english: LocaleTree = readJson(path.join(directory, "en.json"));
      const french: LocaleTree = readJson(path.join(PACKAGES, locale.file));
      let checked: number = 0;
      const breaks: Array<string> = [];

      for (const [at, text] of leavesOf(french)) {
        if (
          !isOwnWording(english, at, text) ||
          frenchBreaksIn(text).length === 0
        ) {
          continue;
        }

        checked++;

        for (const spot of frenchBreaksIn(locale.draw(at, text))) {
          breaks.push(`${at.join(" > ")}: "${spot}"`);
        }
      }

      // The file has spaces to set, as French writes them.
      expect(checked).toBeGreaterThan(0);
      expect(breaks).toEqual([]);
    },
  );
});

describe("the check finds a French mark a line could start with (control)", () => {
  test("a plain space before each mark, and inside guillemets", () => {
    expect(frenchBreaksIn("Archiver 3 flux de travail ?")).toEqual(["l ?"]);
    expect(frenchBreaksIn("Copié !")).toEqual(["é !"]);
    expect(frenchBreaksIn("Étape {{n}} : {{f}}")).toEqual(["} :"]);
    expect(frenchBreaksIn("un ; deux")).toEqual(["n ;"]);
    expect(frenchBreaksIn("la liste « Flux de travail » et")).toEqual([
      "« F",
      "l »",
    ]);
  });

  test("a no-break space, a mark that is no French punctuation, and code are fine", () => {
    expect(frenchBreaksIn("Archiver 3 flux de travail\u202F?")).toEqual([]);
    expect(frenchBreaksIn("«\u00A0Flux\u00A0»\u00A0:")).toEqual([]);
    expect(frenchBreaksIn("MR !{{number}}")).toEqual([]);
    expect(frenchBreaksIn("Lancez `a ? b : c`")).toEqual([]);
  });
});

/*
 * THE FRONTENDS' OWN I18N MODULES.
 *
 * Each is loaded as the browser loads it, in a fresh module registry, and
 * switched to French: a sentence a component reads with t() comes out with
 * its no-break spaces.
 */

interface Frontend {
  name: string;
  i18nModule: string;
  locales: string;
}

const FRONTENDS: ReadonlyArray<Frontend> = [
  "Dashboard",
  "AdminDashboard",
  "Accounts",
  "StatusPage",
  "PublicDashboard",
].map((name: string): Frontend => {
  return {
    name,
    i18nModule: path.join(FEATURE_SETS, name, "src", "Utils", "i18n.ts"),
    locales: path.join(FEATURE_SETS, name, "src", "Locales"),
  };
});

const setBrowserLanguages: (languages: Array<string>) => void = (
  languages: Array<string>,
): void => {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    get: (): Array<string> => {
      return languages;
    },
  });
};

// The frontend's real i18n module's instance, in French.
async function loadInFrench(frontend: Frontend): Promise<I18nInstance> {
  window.localStorage.clear();
  setBrowserLanguages(["fr-FR", "fr"]);

  let i18n: I18nInstance | null = null;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    require(frontend.i18nModule);
    const i18next: {
      default?: I18nInstance;
    } & I18nInstance = require("i18next");
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

    i18n = i18next.default || i18next;
  });

  const instance: I18nInstance = i18n!;

  if (!instance.isInitialized) {
    await new Promise<void>((resolve: () => void) => {
      instance.on("initialized", () => {
        resolve();
      });
    });
  }

  if (instance.language !== "fr") {
    await instance.changeLanguage("fr");
  }

  return instance;
}

// A flat French entry of the frontend's with a space to set: [key, French].
function someFrenchToSet(frontend: Frontend): [string, string] {
  const english: LocaleTree = readJson(path.join(frontend.locales, "en.json"));
  const french: LocaleTree = readJson(path.join(frontend.locales, "fr.json"));
  const found: [Array<string>, string] | undefined = leavesOf(french).find(
    ([at, text]: [Array<string>, string]): boolean => {
      return (
        at.length === 1 &&
        !KEY_SEPARATORS.test(at[0] as string) &&
        isOwnWording(english, at, text) &&
        frenchBreaksIn(text).length > 0
      );
    },
  );

  expect({ frontend: frontend.name, found: Boolean(found) }).toEqual({
    frontend: frontend.name,
    found: true,
  });

  return [found![0][0] as string, found![1]];
}

describe("each frontend's i18n module hands i18next its French set", () => {
  afterAll(() => {
    setBrowserLanguages(["en-US"]);
    window.localStorage.clear();
  });

  test.each(
    FRONTENDS.map((frontend: Frontend): [string, Frontend] => {
      return [frontend.name, frontend];
    }),
  )(
    "%s: t() reads a French sentence with its no-break spaces",
    async (_name: string, frontend: Frontend) => {
      const [key, written] = someFrenchToSet(frontend);
      const i18n: I18nInstance = await loadInFrench(frontend);
      const drawn: unknown = i18n.t(key, {
        keySeparator: false,
        nsSeparator: false,
        defaultValue: key,
      });

      expect(i18n.language).toBe("fr");
      // The sentence is French's, as its file words it, its spaces held.
      expect(String(drawn).replace(/[\u00A0\u202F]/g, " ")).toBe(written);
      expect(frenchBreaksIn(String(drawn))).toEqual([]);
    },
  );

  test("every frontend's i18n module sets its locales, or hands them to what does", () => {
    const modules: Array<string> = fs
      .readdirSync(FEATURE_SETS)
      .map((name: string): string => {
        return path.join(FEATURE_SETS, name, "src", "Utils", "i18n.ts");
      })
      .filter((file: string): boolean => {
        return fs.existsSync(file);
      });

    expect(modules.length).toBeGreaterThanOrEqual(FRONTENDS.length);

    for (const file of modules) {
      const source: string = fs.readFileSync(file, "utf8");

      expect({
        file: path.relative(PACKAGES, file),
        sets:
          source.includes("withNoBreakSpacesInLocale(") ||
          source.includes("startVisitorTranslation("),
      }).toEqual({ file: path.relative(PACKAGES, file), sets: true });
    }

    // What the public dashboards hand their locales to sets them too.
    expect(
      fs.readFileSync(
        path.join(PACKAGES, "Common", "UI", "Utils", "VisitorLanguage.ts"),
        "utf8",
      ),
    ).toContain("withNoBreakSpacesInLocale(");
  });
});
