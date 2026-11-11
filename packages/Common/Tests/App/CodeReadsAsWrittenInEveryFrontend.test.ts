import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import type { i18n as I18nInstance, TOptions } from "i18next";
import type { SpyInstance } from "jest-mock";
import { setCodeApartInSentence } from "../../Types/CodeInSentence";

/*
 * EVERY FRONTEND SETS CODE APART IN ITS ARABIC AND PERSIAN SENTENCES.
 *
 * The Dashboard, Accounts, status pages, the admin dashboard and public
 * dashboards each start their own i18next. Each registers the
 * code-reads-as-written post-processor and turns it on
 * (Common/UI/Utils/CodeReadsAsWritten), and each leaves the isolates' marks
 * out of what a reader copies. Each frontend's real i18n module is loaded
 * here as the browser loads it, in a fresh module registry: every sentence
 * of its Arabic and Persian locale files that names code comes out of t()
 * set apart, exactly as Common/Types/CodeInSentence sets it apart.
 *
 * The rules that set it apart load only for a language read from the
 * right. The Dashboard, Accounts and status pages fetch them with an Arabic
 * or Persian locale file, so a page in any other language never loads
 * them; the admin dashboard and public dashboards bundle every language's
 * words, and the rules with them.
 */

const FEATURE_SET_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);

const FRONTENDS: Array<string> = [
  "Dashboard",
  "Accounts",
  "StatusPage",
  "AdminDashboard",
  "PublicDashboard",
];

const RIGHT_TO_LEFT: Array<string> = ["ar", "fa"];

// The frontends that bundle every language's words, and the rules with them.
const BUNDLES_EVERY_LANGUAGE: Array<string> = [
  "AdminDashboard",
  "PublicDashboard",
];

type LocaleTree = { [key: string]: string | LocaleTree };

interface Leaf {
  // The keys down to it.
  path: Array<string>;
  text: string;
}

const leavesOf: (tree: LocaleTree, at?: Array<string>) => Array<Leaf> = (
  tree: LocaleTree,
  at: Array<string> = [],
): Array<Leaf> => {
  return Object.entries(tree).flatMap(
    ([key, value]: [string, string | LocaleTree]): Array<Leaf> => {
      return typeof value === "string"
        ? [{ path: [...at, key], text: value }]
        : leavesOf(value, [...at, key]);
    },
  );
};

const readLocale: (frontend: string, language: string) => LocaleTree = (
  frontend: string,
  language: string,
): LocaleTree => {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        FEATURE_SET_DIR,
        frontend,
        "src",
        "Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as LocaleTree;
};

const whenInitialized: (i18n: I18nInstance) => Promise<void> = async (
  i18n: I18nInstance,
): Promise<void> => {
  if (i18n.isInitialized) {
    return;
  }

  await new Promise<void>((resolve: () => void) => {
    i18n.on("initialized", () => {
      resolve();
    });
  });
};

interface LoadedFrontend {
  i18n: I18nInstance;
  // The events it listens for on the page as it loads.
  listensFor: Array<string>;
}

// A frontend's i18n module, loaded fresh, with the i18next it starts.
const loadFrontend: (frontend: string) => Promise<LoadedFrontend> = async (
  frontend: string,
): Promise<LoadedFrontend> => {
  window.localStorage.clear();

  const listen: SpyInstance<Document["addEventListener"]> = jest.spyOn(
    document,
    "addEventListener",
  );
  let i18n: I18nInstance | null = null;
  let listensFor: Array<string> = [];

  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const module: { default?: I18nInstance } = require(
        path.join(FEATURE_SET_DIR, frontend, "src", "Utils", "i18n.ts"),
      ) as { default?: I18nInstance };
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const i18next: { default?: I18nInstance } = require("i18next") as {
        default?: I18nInstance;
      };

      // A public dashboard starts i18next's own instance (VisitorLanguage).
      i18n =
        module.default ??
        i18next.default ??
        (i18next as unknown as I18nInstance);
    });

    listensFor = listen.mock.calls.map(
      (call: Parameters<Document["addEventListener"]>): string => {
        return call[0];
      },
    );
  } finally {
    listen.mockRestore();
  }

  await whenInitialized(i18n as unknown as I18nInstance);

  return { i18n: i18n as unknown as I18nInstance, listensFor };
};

afterEach(() => {
  window.localStorage.clear();
});

describe.each(FRONTENDS)("%s", (frontend: string) => {
  test("hands every Arabic and Persian sentence that names code to the page set apart", async () => {
    const { i18n } = await loadFrontend(frontend);
    const wrong: Array<string> = [];
    let setApart: number = 0;

    await i18n.loadLanguages(RIGHT_TO_LEFT);

    for (const language of RIGHT_TO_LEFT) {
      for (const leaf of leavesOf(readLocale(frontend, language))) {
        const shown: string = setCodeApartInSentence(leaf.text, language);

        if (shown === leaf.text) {
          continue;
        }

        setApart += 1;

        // A flat key is the English sentence itself, dots and colons and all.
        const options: TOptions =
          leaf.path.length === 1
            ? { lng: language, keySeparator: false, nsSeparator: false }
            : { lng: language, nsSeparator: false };
        const handed: string = i18n.t(leaf.path.join("."), options) as string;

        if (handed !== shown) {
          wrong.push(`${language} ${leaf.path.join(" > ")}: ${handed}`);
        }
      }
    }

    expect(wrong).toEqual([]);

    /*
     * A frontend whose Arabic and Persian name no code yet is asked a
     * sentence that does, as the next text added to it may.
     */
    if (setApart === 0) {
      for (const language of RIGHT_TO_LEFT) {
        i18n.addResourceBundle(
          language,
          "translation",
          { probe: "أضف --help إلى أي أمر." },
          true,
          true,
        );

        expect(
          i18n.t("probe", { lng: language, nsSeparator: false }) as string,
        ).toBe(setCodeApartInSentence("أضف --help إلى أي أمر.", language));
      }
    }

    // English is handed over as it is.
    i18n.addResourceBundle(
      "en",
      "translation",
      { englishProbe: "Add --help to any command." },
      true,
      true,
    );
    expect(i18n.t("englishProbe", { lng: "en" }) as string).toBe(
      "Add --help to any command.",
    );
  });

  test("loads the rules that set code apart for no language read from the left", async () => {
    const { i18n } = await loadFrontend(frontend);
    const probe: string = "أضف --help إلى أي أمر.";

    // A page in a language read from the left, with its words loaded.
    await i18n.loadLanguages(["de", "ja"]);
    i18n.addResourceBundle("ar", "translation", { probe }, true, true);

    const handed: string = i18n.t("probe", {
      lng: "ar",
      nsSeparator: false,
    }) as string;

    if (BUNDLES_EVERY_LANGUAGE.includes(frontend)) {
      // Bundled with every language's words: there from the first sentence.
      expect(handed).toBe(setCodeApartInSentence(probe, "ar"));
    } else {
      // Not loaded: an Arabic sentence asked for now goes out as written.
      expect(handed).toBe(probe);
    }
  });

  test("leaves the isolates' marks out of what is copied", async () => {
    const { listensFor } = await loadFrontend(frontend);

    expect(listensFor).toContain("copy");
  });
});

describe("the Arabic and Persian sentences that name code", () => {
  // Hundreds in the Dashboard, a few in the smaller frontends.
  test("are many, so the frontends are asked about real ones", () => {
    const counts: Record<string, number> = {};

    for (const frontend of FRONTENDS) {
      counts[frontend] = 0;

      for (const language of RIGHT_TO_LEFT) {
        for (const leaf of leavesOf(readLocale(frontend, language))) {
          if (setCodeApartInSentence(leaf.text, language) !== leaf.text) {
            counts[frontend] = (counts[frontend] as number) + 1;
          }
        }
      }
    }

    expect(counts["Dashboard"]).toBeGreaterThan(500);
    expect(counts["AdminDashboard"]).toBeGreaterThan(0);
    expect(counts["StatusPage"]).toBeGreaterThan(0);
  });
});
