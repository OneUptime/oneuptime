import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import {
  AI_PROVIDER,
  describeText,
  sourceFiles,
  WrittenText,
  writtenTexts,
} from "../Dashboard/LlmProviderNameScan";

/*
 * THE ADMIN DASHBOARD NAMES THE LLM PROVIDERS SETTING BY ITS NAME (#7356).
 *
 * The Admin Dashboard sets up OneUptime AI's models on Settings → Global
 * LLM Providers (/admin/settings/llm-providers). Since #7156 the Dashboard
 * and the server call that setting an "LLM provider"
 * (LlmProviderNameInDashboard, LlmProviderNameGuard), but the Admin
 * Dashboard's Server setup checklist still titled its step "AI provider",
 * said "Not set up: add an AI provider ..." and offered "Add an AI
 * provider" - a button that opens Global LLM Providers, where no setting is
 * called that.
 *
 * The Admin Dashboard has no other meaning for the words (the Dashboard's
 * vendor accounts and Data Security flows are not in it), so it says "AI
 * provider" nowhere:
 *
 *   1. no text its source writes (strings, template text, JSX text) - the
 *      Server setup checklist's catalogue in Common, whose titles and lines
 *      it draws, included;
 *   2. no English word of its locale, key or value;
 *   3. and the checklist's step is worded "LLM provider", with its line and
 *      its button, which still opens Global LLM Providers.
 */

const APP_ROOT: string = path.resolve(__dirname, "../..");

const ADMIN_SRC: string = path.join(APP_ROOT, "FeatureSet/AdminDashboard/src");

const ADMIN_EN_LOCALE: string = path.join(ADMIN_SRC, "Locales/en.json");

// The catalogue the checklist draws its titles and lines from.
const SERVER_SETUP_CATALOGUE: string = path.resolve(
  APP_ROOT,
  "../Common/Types/ServerSetup/ServerSetupChecklist.ts",
);

const ADMIN_CHECKLIST: string = path.join(
  ADMIN_SRC,
  "Components/ServerSetup/ServerSetupChecklist.tsx",
);

// The Enterprise Edition's Admin pages, when ee/ is here (CI removes it).
const EE_ADMIN_SRC: string = path.resolve(APP_ROOT, "../../ee/AdminDashboard");

// The step's words (#7356): its title, its not-set-up line and its button.
const LLM_PROVIDER_STEP_WORDS: ReadonlyArray<string> = [
  "LLM provider",
  "Not set up: add an LLM provider so projects can use OneUptime AI.",
  "Add an LLM provider",
];

// What the step said before.
const AI_PROVIDER_STEP_WORDS: ReadonlyArray<string> = [
  "AI provider",
  "Not set up: add an AI provider so projects can use OneUptime AI.",
  "Add an AI provider",
];

/*
 * An id written in a file - ServerSetupCheckId.AiProvider is "ai-provider",
 * stored in admins' choices - is no word anybody reads.
 */
const KEBAB_CASE_ID: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

interface LocaleWord {
  path: string;
  text: string;
}

// Every key and every value of a locale, nested sections included.
function localeWords(value: unknown, at: string = ""): Array<LocaleWord> {
  if (typeof value === "string") {
    return [{ path: at, text: value }];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, inner]: [string, unknown]): Array<LocaleWord> => {
      const keyPath: string = at ? `${at} > ${key}` : key;

      return [{ path: keyPath, text: key }, ...localeWords(inner, keyPath)];
    },
  );
}

function readAdminEnglish(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(ADMIN_EN_LOCALE, "utf8")) as Record<
    string,
    unknown
  >;
}

function textsOf(files: Array<string>): Array<WrittenText> {
  return files.flatMap((file: string): Array<WrittenText> => {
    return writtenTexts(
      path.relative(APP_ROOT, file),
      fs.readFileSync(file, "utf8"),
    );
  });
}

function saysAiProvider(texts: Array<WrittenText>): Array<string> {
  return texts
    .filter((found: WrittenText): boolean => {
      return AI_PROVIDER.test(found.text) && !KEBAB_CASE_ID.test(found.text);
    })
    .map(describeText);
}

describe("the Admin Dashboard says LLM provider for the LLM Providers setting", () => {
  test("the Server setup checklist and its catalogue write no AI provider", () => {
    const texts: Array<WrittenText> = textsOf([
      ADMIN_CHECKLIST,
      SERVER_SETUP_CATALOGUE,
    ]);

    // The reading finds the step's words, so an empty answer means something.
    expect(
      texts
        .map((found: WrittenText): string => {
          return found.text;
        })
        .filter((text: string): boolean => {
          return LLM_PROVIDER_STEP_WORDS.includes(text);
        })
        .sort(),
    ).toEqual([...LLM_PROVIDER_STEP_WORDS].sort());
    expect(saysAiProvider(texts)).toEqual([]);
  });

  test("no text the Admin Dashboard's source writes says AI provider", () => {
    const files: Array<string> = sourceFiles(ADMIN_SRC).filter(
      (file: string): boolean => {
        // The locales are read below, as keys and values.
        return !file.includes(`${path.sep}Locales${path.sep}`);
      },
    );

    // The sweep reads the pages it is meant to: there are many.
    expect(files.length).toBeGreaterThan(50);
    expect(saysAiProvider(textsOf(files))).toEqual([]);
  });

  test("no text of the Enterprise Edition's Admin pages says AI provider, when they are here", () => {
    if (!fs.existsSync(EE_ADMIN_SRC)) {
      return;
    }

    expect(saysAiProvider(textsOf(sourceFiles(EE_ADMIN_SRC)))).toEqual([]);
  });

  test("no English key or value of the Admin Dashboard says AI provider", () => {
    const words: Array<LocaleWord> = localeWords(readAdminEnglish());

    expect(words.length).toBeGreaterThan(1000);
    expect(
      words
        .filter((word: LocaleWord): boolean => {
          return AI_PROVIDER.test(word.text);
        })
        .map((word: LocaleWord): string => {
          return `${word.path}: ${word.text}`;
        }),
    ).toEqual([]);
  });

  test("the step's new words are English keys, and its old ones are gone", () => {
    const english: Record<string, unknown> = readAdminEnglish();

    for (const word of LLM_PROVIDER_STEP_WORDS) {
      expect({ word, value: english[word] }).toEqual({ word, value: word });
    }

    for (const word of AI_PROVIDER_STEP_WORDS) {
      expect({ word, value: english[word] }).toEqual({
        word,
        value: undefined,
      });
    }
  });

  test("the step's button still opens Global LLM Providers, and its id is unchanged", () => {
    const catalogue: string = fs.readFileSync(SERVER_SETUP_CATALOGUE, "utf8");
    const checklist: string = fs.readFileSync(ADMIN_CHECKLIST, "utf8");

    // Stored in admins' choices and used as a key: never renamed.
    expect(catalogue).toContain('AiProvider = "ai-provider",');
    expect(catalogue).toContain(
      'llmProviders: "/admin/settings/llm-providers"',
    );
    expect(checklist).toContain('addLlmProvider: "Add an LLM provider",');
    expect(checklist).toContain("route(PageMap.SETTINGS_LLM_PROVIDERS)");
  });
});

describe("the reading of a source file", () => {
  test("an id is no word: ai-provider is left out, every sentence is read", () => {
    expect(
      saysAiProvider(
        writtenTexts(
          "Example.ts",
          [
            'const id: string = "ai-provider";',
            'const title: string = "AI provider";',
            'const line: string = "Not set up: add an AI-provider.";',
            'const ok: string = "Add an LLM provider";',
          ].join("\n"),
        ),
      ),
    ).toEqual([
      "Example.ts:2: AI provider",
      "Example.ts:3: Not set up: add an AI-provider.",
    ]);
  });
});

describe("the reading of a locale", () => {
  test("reads every key and value, nested sections included", () => {
    expect(
      localeWords({
        "AI provider": "KI-Anbieter",
        pages: { settings: { title: "Global LLM Providers" } },
      }),
    ).toEqual([
      { path: "AI provider", text: "AI provider" },
      { path: "AI provider", text: "KI-Anbieter" },
      { path: "pages", text: "pages" },
      { path: "pages > settings", text: "settings" },
      { path: "pages > settings > title", text: "title" },
      { path: "pages > settings > title", text: "Global LLM Providers" },
    ]);
  });

  test("finds AI provider in a key and in a value", () => {
    const found: Array<LocaleWord> = localeWords({
      "Add an AI provider": "Add an LLM provider",
      section: { line: "Not set up: add an AI-provider." },
    }).filter((word: LocaleWord): boolean => {
      return AI_PROVIDER.test(word.text);
    });

    expect(
      found.map((word: LocaleWord): string => {
        return word.path;
      }),
    ).toEqual(["Add an AI provider", "section > line"]);
  });
});
