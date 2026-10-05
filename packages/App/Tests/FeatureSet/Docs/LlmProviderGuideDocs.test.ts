import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import LlmType from "Common/Types/LLM/LlmType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The LLM provider guide, in every docs language, against the English page
 * and the product.
 *
 * Fifteen of the sixteen translations fell behind the English page and
 * nobody noticed, because nobody on the team reads most of those languages.
 * So this reads every copy and holds it to what can be checked without
 * reading it: the English page's sections in the English page's order, the
 * same GLOBAL_LLM_PROVIDER_* variables and examples, and the provider types
 * the startup sync accepts.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);

const PAGE: string = "ai/llm-provider.md";

// Registers the global provider from the GLOBAL_LLM_PROVIDER_* variables.
const STARTUP_SYNC: string =
  "App/FeatureSet/Workers/StartupMigrations/SeedGlobalLlmProviderFromEnv.ts";

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const GLOBAL_PROVIDER_VARIABLE: RegExp = /GLOBAL_LLM_PROVIDER_[A-Z_]+/g;

const FENCE: RegExp = /^\s*```(.*)$/;

function readPage(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, PAGE), "utf8");
}

interface Outline {
  headingLevels: Array<number>;
  fences: Array<string>;
}

/*
 * The page's skeleton: the level of each heading, in order, and the info
 * string of each fenced block. A "#" inside a fence is a shell comment, not
 * a heading.
 */
function outlineOf(markdown: string): Outline {
  const outline: Outline = { headingLevels: [], fences: [] };
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    const fence: RegExpMatchArray | null = line.match(FENCE);

    if (fence) {
      if (!inFence) {
        outline.fences.push(fence[1]!.trim());
      }

      inFence = !inFence;
      continue;
    }

    const heading: RegExpMatchArray | null = inFence
      ? null
      : line.match(/^(#{1,6}) /);

    if (heading) {
      outline.headingLevels.push(heading[1]!.length);
    }
  }

  return outline;
}

function fencedLines(markdown: string): Array<string> {
  const lines: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      lines.push(line.trim());
    }
  }

  return lines;
}

function globalProviderVariablesIn(markdown: string): Array<string> {
  return [...new Set(markdown.match(GLOBAL_PROVIDER_VARIABLE) || [])].sort();
}

// The cells after the variable's own, in the table row that documents it.
function tableRowOf(markdown: string, variable: string): string | undefined {
  return markdown
    .split("\n")
    .find((line: string): boolean => {
      return new RegExp(`^\\|\\s*\`${variable}\`\\s*\\|`).test(line);
    })
    ?.replace(new RegExp(`^\\|\\s*\`${variable}\`\\s*\\|`), "");
}

describe("every translation of the LLM provider guide has the English page's sections", () => {
  test("every docs language is checked", () => {
    expect(SUPPORTED_DOCS_LANGUAGE_CODES).toHaveLength(17);
    expect(TRANSLATIONS).toHaveLength(16);
  });

  test.each(TRANSLATIONS)("%s", (language: string) => {
    expect(outlineOf(readPage(language))).toEqual(outlineOf(readPage("en")));
  });
});

describe("every LLM provider guide documents the GLOBAL_LLM_PROVIDER_* variables", () => {
  const englishVariables: Array<string> = globalProviderVariablesIn(
    readPage("en"),
  );

  test("the English page documents only variables the startup sync reads", () => {
    const startupSync: string = fs.readFileSync(
      path.join(PACKAGES_ROOT, STARTUP_SYNC),
      "utf8",
    );

    expect(englishVariables).toEqual([
      "GLOBAL_LLM_PROVIDER_API_KEY",
      "GLOBAL_LLM_PROVIDER_BASE_URL",
      "GLOBAL_LLM_PROVIDER_MODEL_NAME",
      "GLOBAL_LLM_PROVIDER_NAME",
      "GLOBAL_LLM_PROVIDER_TYPE",
    ]);

    for (const variable of englishVariables) {
      expect(startupSync).toContain(`process.env["${variable}"]`);
    }
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s gives each variable a row of its own",
    (language: string) => {
      const markdown: string = readPage(language);

      expect(globalProviderVariablesIn(markdown)).toEqual(englishVariables);

      for (const variable of englishVariables) {
        expect({ variable, row: tableRowOf(markdown, variable) }).toEqual({
          variable,
          row: expect.any(String),
        });
      }
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s lists every provider type GLOBAL_LLM_PROVIDER_TYPE takes, and no other",
    (language: string) => {
      const row: string =
        tableRowOf(readPage(language), "GLOBAL_LLM_PROVIDER_TYPE") || "";
      const listed: Array<string> = [...row.matchAll(/`([^`]+)`/g)].map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );

      expect(listed).toEqual(Object.values(LlmType));
    },
  );

  test.each(TRANSLATIONS)(
    "%s sets the variables exactly as the English examples do",
    (language: string) => {
      const settingsIn: (markdown: string) => Array<string> = (
        markdown: string,
      ): Array<string> => {
        return fencedLines(markdown).filter((line: string): boolean => {
          return (/^GLOBAL_LLM_PROVIDER_[A-Z_]+=/).test(line);
        });
      };

      expect(settingsIn(readPage(language))).toEqual(
        settingsIn(readPage("en")),
      );
    },
  );
});
