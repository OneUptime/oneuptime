import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import {
  DATA_SECURITY_AI_FEATURES,
  DataSecurityAiFeatureInfo,
  NEVER_SENT_TO_ONEUPTIME_AI,
} from "Common/Types/DataSecurity/DataSecurityAiFeatures";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * OneUptime AI in Data Security (data-security/ai, #10365), held to the
 * product it describes: what no feature ever sends and what each sends is
 * the catalog's (Types/DataSecurity/DataSecurityAiFeatures), in its order,
 * with which run on their own; the Settings page it sends people to is
 * where the Dashboard's menu has it, with the card names it draws; what
 * the AI Logs keep of a failed call is what the catalog says each
 * feature's calls keep; and the eval it tells operators to run is the
 * repository's own command. A change to any of them fails here until the
 * page says so. The translations' shape is DataSecurityDocsFacts'.
 */

const PAGE: string = "data-security/ai";

// packages/App/Tests/FeatureSet/Docs -> the repository's root.
const REPO_DIR: string = path.resolve(__dirname, "..", "..", "..", "..", "..");
const LINE_BREAK: RegExp = /\n/;

function englishPage(): string {
  return readPage("en", PAGE);
}

function source(relative: string): string {
  return fs.readFileSync(path.join(REPO_DIR, relative), "utf8");
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

// The first letter in lower case: a list item continues the sentence before it.
function midSentence(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

describe("what OneUptime AI sees", () => {
  const sees: string = section(englishPage(), "What OneUptime AI sees");

  it("says each thing no feature ever sends, as the catalog lists them", () => {
    // An example of a masked value is code on the page: `j***@e******.com`.
    const said: string = flat(sees).replace(/`/g, "");

    for (const item of NEVER_SENT_TO_ONEUPTIME_AI) {
      expect({ item, said: said.includes(midSentence(item)) }).toEqual({
        item,
        said: true,
      });
    }
  });

  it("has a row for each feature, in the catalog's order, named as the Dashboard names it", () => {
    const table: Array<Array<string>> = tables(sees)[0]!;
    const names: Array<string> = table.slice(1).map((row: Array<string>) => {
      return row[0]!.replace(/\*\*/g, "");
    });

    expect(names).toEqual(
      DATA_SECURITY_AI_FEATURES.map((info: DataSecurityAiFeatureInfo) => {
        return info.title;
      }),
    );
  });

  it("says what each feature sends, as the catalog says it", () => {
    const table: Array<Array<string>> = tables(sees)[0]!;

    DATA_SECURITY_AI_FEATURES.forEach(
      (info: DataSecurityAiFeatureInfo, index: number): void => {
        const sends: string = flat(table[index + 1]![1]!).toLowerCase();

        for (const item of info.sends) {
          // Each sentence of the catalog, give or take its joining words.
          const words: Array<string> = item
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((word: string): boolean => {
              return word.length > 4;
            });

          for (const word of words) {
            expect({
              feature: info.feature,
              word,
              said: sends.includes(word),
            }).toEqual({ feature: info.feature, word, said: true });
          }
        }
      },
    );
  });

  it("says which features run on their own: only those the catalog says do", () => {
    const table: Array<Array<string>> = tables(sees)[0]!;

    DATA_SECURITY_AI_FEATURES.forEach(
      (info: DataSecurityAiFeatureInfo, index: number): void => {
        const runsOnItsOwn: string = table[index + 1]![2]!;

        expect({
          feature: info.feature,
          yes: runsOnItsOwn.startsWith("Yes"),
        }).toEqual({ feature: info.feature, yes: info.runsOnItsOwn });
      },
    );
  });

  it("names the features that read the team's AI context: the analysis, on request and of new issues, and Ask AI, not the field suggestions", () => {
    // Both analyses are written in one place, the team's notes first (#10369).
    expect(
      source(
        "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityIssueAnalysis.ts",
      ),
    ).toContain("await AiContextReader.read({");
    expect(
      source("packages/Common/Server/Utils/AI/Chat/ChatAgentRunner.ts"),
    ).toContain("AiContextReader");
    expect(
      source("packages/Common/Server/Utils/AI/DataSecurity/FieldSuggestion.ts"),
    ).not.toContain("AiContext");
    expect(flat(sees)).toContain(
      "**Analysis on request**, **Analysis of new issues** and **Ask AI** also read your team's [AI context](/docs/ai/ai-context) first, when it has one",
    );
    // The AI context's own page lists Explain with AI among what reads it.
    expect(
      tables(readPage("en", "ai/ai-context"))
        .flat()
        .map((row: Array<string>): string => {
          return row.join(" | ");
        }),
    ).toContain(
      "Explain with AI, on a data security issue | The project's notes",
    );
  });

  it("names the features whose failed calls still keep a provider's error, and only them", () => {
    const kept: string = flat(section(englishPage(), "What is kept"));
    const keeping: Array<string> = DATA_SECURITY_AI_FEATURES.filter(
      (info: DataSecurityAiFeatureInfo): boolean => {
        return info.keepsProviderErrors;
      },
    ).map((info: DataSecurityAiFeatureInfo): string => {
      return info.title;
    });

    expect(keeping).toEqual(["Fix with AI", "Ask AI"]);
    expect(kept).toContain(
      "The coding agent behind Fix with AI and Ask AI's chat still keep a failed call's provider error in its row.",
    );
    expect(kept).toContain(
      "the analysis and the field suggestions keep no word of the provider's error",
    );
  });
});

describe("see it for yourself", () => {
  const see: string = flat(section(englishPage(), "See it for yourself"));

  it("sends people to the Settings page the Dashboard's menu has, by its name", () => {
    const menu: string = source(
      "packages/App/FeatureSet/Dashboard/src/Utils/DataSecurityNavigation.ts",
    );

    expect(menu).toContain("page: PageMap.DATA_SECURITY_SETTINGS_AI,");
    expect(menu).toContain('title: "OneUptime AI",');
    expect(see).toContain("**Data Security → Settings → OneUptime AI**");
  });

  it("names its two cards as the page draws them", () => {
    const page: string = source(
      "packages/App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/AI.tsx",
    );

    for (const card of ["What OneUptime AI Sees", "Show an Example"]) {
      expect(page).toContain(`translationKey("${card}")`);
      expect(see).toContain(`**${card}**`);
    }
  });

  it("says where it is linked from: the LLM Providers page", () => {
    expect(
      source(
        "packages/App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviders.tsx",
      ),
    ).toContain("PageMap.DATA_SECURITY_SETTINGS_AI");
    expect(see).toContain(
      "**Project Settings → AI → LLM Providers** links to it",
    );
  });
});

describe("your own model, and how it is measured", () => {
  it("names the self-hosted kinds of provider the product has", () => {
    const model: string = flat(section(englishPage(), "Your own model"));
    const types: string = source("packages/Common/Types/LLM/LlmType.ts");

    expect(types).toContain('Ollama = "Ollama"');
    expect(types).toContain('OpenAICompatible = "OpenAICompatible"');
    expect(model).toContain("Ollama, vLLM, or any OpenAI-compatible endpoint");
    expect(model).toContain("the Helm chart's bundled vLLM");
    expect(source("HelmChart/Public/oneuptime/values.yaml")).toMatch(/^vllm:/m);
  });

  it("gives operators the repository's own eval command, with the key where the eval reads it", () => {
    const measured: string = section(englishPage(), "How it is measured");
    const scripts: Record<string, string> = (
      JSON.parse(source("package.json")) as { scripts: Record<string, string> }
    ).scripts;

    expect(scripts["ai-data-security-eval"]).toBeDefined();
    expect(measured).toContain("npm run ai-data-security-eval --");
    expect(measured).toContain("AI_EVAL_LLM_API_KEY");
    expect(
      source("packages/Common/Server/Utils/AI/Eval/EvalCommandLine.ts"),
    ).toContain(
      'export const MODEL_API_KEY_ENV: string = "AI_EVAL_LLM_API_KEY";',
    );
  });
});
