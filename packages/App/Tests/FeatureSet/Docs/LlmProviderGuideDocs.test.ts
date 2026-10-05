import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LlmType from "Common/Types/LLM/LlmType";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import API from "Common/Utils/API";
import LLMService from "Common/Server/Utils/LLM/LLMService";
import { startEachTestOnSelfHostedEgressPolicy } from "Common/Tests/Server/Utils/EgressPolicyEnvironment";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
 * same GLOBAL_LLM_PROVIDER_* variables and examples, the provider types the
 * startup sync accepts, the provider form's fields under the names the
 * dashboard gives them in that language, and the models OneUptime itself
 * asks for when a provider's Model Name is left blank.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const DASHBOARD_LOCALES_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

const PAGE: string = "ai/llm-provider.md";

// Registers the global provider from the GLOBAL_LLM_PROVIDER_* variables.
const STARTUP_SYNC: string =
  "App/FeatureSet/Workers/StartupMigrations/SeedGlobalLlmProviderFromEnv.ts";

// The form Project Settings > AI > LLM Providers creates a provider with.
const PROVIDER_FORM: string =
  "App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviders.tsx";

// The guides quote the dashboard in English in these languages.
const ENGLISH_LABEL_LANGUAGES: Array<string> = ["en", "fa"];

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

// What the dashboard draws for a label in that language.
function dashboardLabel(language: string, english: string): string {
  if (ENGLISH_LABEL_LANGUAGES.includes(language)) {
    return english;
  }

  const translations: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_LOCALES_DIR, `${language}.json`),
      "utf8",
    ),
  );
  const label: unknown = translations[english];

  return typeof label === "string" ? label : english;
}

// One field of the provider form, from its key to the next field's.
function formField(field: string): string {
  const form: string = fs.readFileSync(
    path.join(PACKAGES_ROOT, PROVIDER_FORM),
    "utf8",
  );
  const start: number = form.search(
    new RegExp(`field: \\{\\s*${field}: true,`),
  );

  if (start === -1) {
    return "";
  }

  const next: number = form.indexOf("field: {", start + 1);

  return form.slice(start, next === -1 ? undefined : next);
}

function formFieldTitle(field: string): string {
  return formField(field).match(/title: "([^"]+)"/)?.[1] || "";
}

function hasBulletFor(markdown: string, label: string): boolean {
  return markdown.split("\n").some((line: string): boolean => {
    return line.startsWith(`- **${label}**`);
  });
}

/*
 * A heading's section: the heading line and everything under it, up to the
 * next heading of the same level or higher.
 */
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  if (start === -1) {
    return "";
  }

  const level: number = heading.indexOf(" ");
  let end: number = start + 1;
  let inFence: boolean = false;

  for (; end < lines.length; end++) {
    if (FENCE.test(lines[end]!)) {
      inFence = !inFence;
      continue;
    }

    const next: RegExpMatchArray | null = inFence
      ? null
      : lines[end]!.match(/^(#{1,6}) /);

    if (next && next[1]!.length <= level) {
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

// The models a provider's section lists, in order.
function listedModels(markdown: string, provider: string): Array<string> {
  return [
    ...sectionOf(markdown, `### ${provider}`).matchAll(/^ {3}- `([^`]+)` /gm),
  ].map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
}

// The model a provider section's example configuration uses.
function exampleModel(markdown: string, provider: string): string {
  const example: Array<string> = fencedLines(
    sectionOf(markdown, `### ${provider}`),
  );

  return example[example.length - 1]?.split(": ")[1] || "";
}

// The model LLMService asks a provider for, given this provider config.
async function modelRequestedBy(
  llmProviderConfig: {
    llmType: LlmType;
    apiKey: string;
    baseUrl: string;
  },
  reply: JSONObject,
): Promise<string> {
  const post: ReturnType<typeof jest.spyOn> = jest
    .spyOn(API, "post")
    .mockResolvedValue({
      jsonData: reply,
    } as unknown as HTTPResponse<JSONObject>) as ReturnType<typeof jest.spyOn>;

  await LLMService.getCompletion({
    llmProviderConfig,
    messages: [{ role: "user", content: "which incidents are active?" }],
  });

  const request: { data: JSONObject } = post.mock.calls[0]![0] as {
    data: JSONObject;
  };

  return request.data["model"] as string;
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

describe("every LLM provider guide calls the provider field what the form calls it", () => {
  const fieldTitle: string = formFieldTitle("llmType");

  /*
   * The form's field was called LLM Type, and the guides went on using that
   * name, in every spelling their languages gave it, after it was renamed.
   */
  const OLD_NAMES: Array<string> = [
    "LLM Type",
    "LLM-Typ",
    "LLM-type",
    "Tipo de LLM",
    "Tipo LLM",
    "Type de LLM",
    "LLM タイプ",
    "LLM の種類",
    "LLM 유형",
    "LLM 类型",
    "типа LLM",
  ];

  test("the form's provider type field is titled LLM Provider", () => {
    expect(fieldTitle).toBe("LLM Provider");
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s lists the field under the dashboard's name for it",
    (language: string) => {
      const label: string = dashboardLabel(language, fieldTitle);

      expect({ label, listed: hasBulletFor(readPage(language), label) }).toEqual(
        { label, listed: true },
      );
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s keys the provider of every example by that name",
    (language: string) => {
      const keys: Array<string> = [];

      for (const line of fencedLines(readPage(language))) {
        const provider: RegExpMatchArray | null = line.match(
          /^(.+): (OpenAI|Anthropic|Ollama|OpenAI Compatible)$/,
        );

        if (provider) {
          keys.push(provider[1]!);
        }
      }

      // OpenAI, Anthropic, Ollama, OpenAI Compatible, in-cluster vLLM.
      expect(keys).toHaveLength(5);

      for (const key of keys) {
        expect([fieldTitle, dashboardLabel(language, fieldTitle)]).toContain(
          key,
        );
      }
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s no longer calls it LLM Type",
    (language: string) => {
      const markdown: string = readPage(language).toLowerCase();

      expect(
        OLD_NAMES.filter((name: string): boolean => {
          return markdown.includes(name.toLowerCase());
        }),
      ).toEqual([]);
    },
  );
});

describe("every LLM provider guide says what is under More fields", () => {
  test("the form folds Set as Default and Additional Parameters under More fields", () => {
    expect(formFieldTitle("isDefault")).toBe("Set as Default");
    expect(formFieldTitle("additionalParams")).toBe("Additional Parameters");

    for (const field of ["isDefault", "additionalParams"]) {
      expect(formField(field)).toContain(
        "collapsibleSection: advancedSection",
      );
    }
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s names the fold and both fields as the dashboard draws them",
    (language: string) => {
      const fold: string = dashboardLabel(language, MORE_FIELDS_SECTION_TITLE);
      const bullet: string | undefined = readPage(language)
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith(`- **${fold}**`);
        });

      expect({ fold, bullet }).toEqual({ fold, bullet: expect.any(String) });

      for (const field of ["isDefault", "additionalParams"]) {
        expect(bullet).toContain(
          `**${dashboardLabel(language, formFieldTitle(field))}**`,
        );
      }

      expect(bullet).toContain('`{"temperature": 0.2}`');
    },
  );
});

describe("every LLM provider guide recommends the models OneUptime defaults to", () => {
  startEachTestOnSelfHostedEgressPolicy();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Model ids and names the guides used to recommend, long since retired,
   * matched in any case: "gpt-4o", "Production GPT-4", "Claude 3 Opus".
   */
  const RETIRED_MODELS: Array<string> = [
    "gpt-4",
    "gpt-3.5",
    "claude-3",
    "claude 3",
    "llama 2",
    "codellama",
  ];

  test("with Model Name left blank, OpenAI and Anthropic are asked for the model the English page recommends first", async () => {
    const english: string = readPage("en");

    // A private address, which a self-hosted install reaches.
    expect(
      await modelRequestedBy(
        {
          llmType: LlmType.OpenAI,
          apiKey: "sk-test",
          baseUrl: "http://10.0.0.12:8000/v1",
        },
        { choices: [{ message: { content: "OK" }, finish_reason: "stop" }] },
      ),
    ).toBe(listedModels(english, "OpenAI")[0]);

    jest.restoreAllMocks();

    expect(
      await modelRequestedBy(
        {
          llmType: LlmType.Anthropic,
          apiKey: "sk-ant-test",
          baseUrl: "http://10.0.0.12:8000/v1",
        },
        { content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" },
      ),
    ).toBe(listedModels(english, "Anthropic")[0]);
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s lists the English page's models, and configures its example with the first",
    (language: string) => {
      const markdown: string = readPage(language);

      for (const provider of ["OpenAI", "Anthropic"]) {
        const listed: Array<string> = listedModels(markdown, provider);

        expect({ provider, listed }).toEqual({
          provider,
          listed: listedModels(readPage("en"), provider),
        });
        expect({ provider, example: exampleModel(markdown, provider) }).toEqual(
          { provider, example: listed[0] },
        );
      }

      expect(listedModels(markdown, "OpenAI")).toEqual([
        "gpt-5.1",
        "gpt-5.1-mini",
      ]);
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s gives the English page's Model Name examples",
    (language: string) => {
      const examplesIn: (markdown: string, label: string) => Array<string> = (
        markdown: string,
        label: string,
      ): Array<string> => {
        const bullet: string =
          markdown.split("\n").find((line: string): boolean => {
            return line.startsWith(`- **${label}**`);
          }) || "";

        return [...bullet.matchAll(/`([^`]+)`/g)].map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        );
      };

      expect(
        examplesIn(
          readPage(language),
          dashboardLabel(language, formFieldTitle("modelName")),
        ),
      ).toEqual(examplesIn(readPage("en"), formFieldTitle("modelName")));
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s names no retired model",
    (language: string) => {
      const markdown: string = readPage(language).toLowerCase();

      expect(
        RETIRED_MODELS.filter((model: string): boolean => {
          return markdown.includes(model);
        }),
      ).toEqual([]);
    },
  );
});
