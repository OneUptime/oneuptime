import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import {
  AI_PROVIDER,
  describeText,
  LLM_PROVIDERS_PAGE,
  sourceFiles,
  WrittenText,
  writtenTexts,
} from "./LlmProviderNameScan";

/*
 * THE DASHBOARD NAMES THE LLM PROVIDERS SETTING BY ITS NAME (#7156).
 *
 * The page where a project sets up the model OneUptime AI runs on is
 * Project Settings → AI → LLM Providers. The AI card and the AI settings
 * pages call it an "LLM provider", and the server's messages do too
 * (packages/Common/Tests/Server/Utils/AI/LlmProviderNameGuard.test.ts). The
 * Dashboard still said "AI provider" in the run failure words, Ask AI's
 * provider picker, the AI agent pages' missing-provider step and a refused
 * AI fix's Try again - some of them as "Add an AI provider in Project
 * Settings > AI > LLM Providers" in one breath - so a reader looked for a
 * setting that has no such name.
 *
 * Held three ways:
 *
 *   1. The files those words live in write no "AI provider" at all.
 *   2. No Dashboard text that names the LLM Providers page says "AI
 *      provider".
 *   3. The English keys that still say "AI provider" are the ones where it
 *      means the vendor's own account or service - LLM observability's
 *      connected accounts, Data Security's flows and checks - and a new one
 *      is added here only after someone decided it is not the setting.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const EN_LOCALE: string = path.join(DASHBOARD_SRC, "Locales/en.json");

// The files whose words send people to LLM Providers (#7156).
const PROVIDER_WORD_FILES: ReadonlyArray<string> = [
  "Components/AI/AiRunFailureWords.ts",
  "Components/AI/AiRunFailureNotice.tsx",
  "Components/AIChat/ProviderPicker.tsx",
  "Components/ResourceAiAgent/ResourceAiAgentStatus.ts",
  "Pages/Kubernetes/Utils/KubernetesAiAgentStatus.ts",
  "Components/AutoRemediation/RemediationStepCopy.ts",
];

/*
 * The English keys where "AI provider" is the vendor - OpenAI, Anthropic,
 * Azure and the rest - not the setting: an account OneUptime reads usage
 * from, or a service a customer's app sends data to.
 */
const VENDOR_MEANING_KEYS: ReadonlyArray<string> = [
  "AI Provider",
  "Connections of AI / LLM observability to AI provider accounts (usage and cost) and to company AI tools (conversations), read on a schedule without any code.",
  "Cursor's Admin API gives usage and cost by person, not conversations, so Cursor is connected with your AI provider accounts.",
  "Sensitive data is being sent to an AI provider",
  "Sensitive data that reaches AI providers, or stores kept for AI.",
  "Sent to AI Providers",
  "Services whose prompts can carry this data to an AI provider. Confirmed when a scan found it in their AI conversations.",
  "The services that read this store, where they send its data - other stores, outside hosts and AI providers - and the stores that hold copies of it.",
  "Your AI provider accounts",
];

function readEnglishKeys(): Array<string> {
  return Object.keys(
    JSON.parse(fs.readFileSync(EN_LOCALE, "utf8")) as Record<string, string>,
  );
}

describe("the Dashboard says LLM provider for the LLM Providers setting", () => {
  test.each(PROVIDER_WORD_FILES)("%s writes no AI provider", (file: string) => {
    const saysAiProvider: Array<string> = writtenTexts(
      file,
      fs.readFileSync(path.join(DASHBOARD_SRC, file), "utf8"),
    )
      .filter((found: WrittenText): boolean => {
        return AI_PROVIDER.test(found.text);
      })
      .map(describeText);

    expect(saysAiProvider).toEqual([]);
  });

  test("no Dashboard text that names the LLM Providers page says AI provider", () => {
    const named: Array<WrittenText> = [];

    for (const file of sourceFiles(DASHBOARD_SRC)) {
      // The locales are read as keys below, in every language's words.
      if (file.includes(`${path.sep}Locales${path.sep}`)) {
        continue;
      }

      named.push(
        ...writtenTexts(
          path.relative(DASHBOARD_SRC, file),
          fs.readFileSync(file, "utf8"),
        ).filter((found: WrittenText): boolean => {
          return LLM_PROVIDERS_PAGE.test(found.text);
        }),
      );
    }

    // The sweep reads the texts it is meant to: the page is named often.
    expect(named.length).toBeGreaterThan(5);
    expect(
      named
        .filter((found: WrittenText): boolean => {
          return AI_PROVIDER.test(found.text);
        })
        .map(describeText),
    ).toEqual([]);
  });

  test("no English key that names the LLM Providers page says AI provider", () => {
    const keys: Array<string> = readEnglishKeys().filter(
      (key: string): boolean => {
        return LLM_PROVIDERS_PAGE.test(key);
      },
    );

    expect(keys.length).toBeGreaterThan(5);
    expect(
      keys.filter((key: string): boolean => {
        return AI_PROVIDER.test(key);
      }),
    ).toEqual([]);
  });

  test("the English keys that say AI provider all mean the vendor, not the setting", () => {
    expect(
      readEnglishKeys()
        .filter((key: string): boolean => {
          return AI_PROVIDER.test(key);
        })
        .sort(),
    ).toEqual([...VENDOR_MEANING_KEYS].sort());
  });

  test("the words #7156 changed are keys, in the setting's name", () => {
    const keys: Set<string> = new Set(readEnglishKeys());

    for (const key of [
      "There is no LLM provider to use.",
      "Add an LLM provider in Project Settings > AI > LLM Providers, then try again.",
      "Choose LLM provider",
      "LLM provider",
      "No LLM providers configured yet. Add one in Project Settings → AI → LLM Providers.",
      "Add an LLM provider for this project, or use OneUptime AI credits.",
      "This project has no LLM provider to work out a fix with. Add one in Project Settings > AI > LLM Providers, then try again.",
    ]) {
      expect({ key, isKey: keys.has(key) }).toEqual({ key, isKey: true });
    }
  });
});

describe("the reading itself", () => {
  test("reads strings, template text and JSX text, and leaves out comments and log lines", () => {
    const texts: Array<string> = writtenTexts(
      "Example.tsx",
      [
        "// No AI provider here: a comment.",
        "/* Nor an AI provider here. */",
        'const title: string = "No LLM provider was available";',
        "const kind: string = 'alert';",
        "const step: string = `Review the ${kind} AI provider settings`;",
        "console.error(`no AI provider for ${kind}`);",
        "const view: JSX.Element = <p>Choose an AI-provider</p>;",
      ].join("\n"),
    ).map((found: WrittenText): string => {
      return found.text;
    });

    expect(texts).toEqual([
      "No LLM provider was available",
      "alert",
      "Review the",
      "AI provider settings",
      "Choose an AI-provider",
    ]);
  });

  test("names the line a text is on", () => {
    expect(
      writtenTexts("Example.ts", '\n\nconst a: string = "AI provider";'),
    ).toEqual([{ file: "Example.ts", line: 3, text: "AI provider" }]);
  });

  test("knows the page by every separator the Dashboard writes", () => {
    for (const text of [
      "Project Settings → AI → LLM Providers",
      "Project Settings > AI > LLM Providers",
      "Settings › AI › LLM Providers",
      "Project Settings -> AI -> LLM Providers",
      "Project Settings &gt; AI &gt; LLM Providers",
    ]) {
      expect({ text, names: LLM_PROVIDERS_PAGE.test(text) }).toEqual({
        text,
        names: true,
      });
    }

    expect(LLM_PROVIDERS_PAGE.test("LLM Providers")).toBe(false);
  });

  test("every file it reads is there", () => {
    for (const file of PROVIDER_WORD_FILES) {
      expect({
        file,
        exists: fs.existsSync(path.join(DASHBOARD_SRC, file)),
      }).toEqual({ file, exists: true });
    }
  });
});
