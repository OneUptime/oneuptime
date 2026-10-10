import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import ColumnLength from "Common/Types/Database/ColumnLength";
import EgressGuardException, {
  EgressFailureReason,
} from "Common/Types/Exception/EgressGuardException";
import { JSONObject } from "Common/Types/JSON";
import LlmType from "Common/Types/LLM/LlmType";
import { PermissionHelper } from "Common/Types/Permission";
import API from "Common/Utils/API";
import LlmProviderEndpoint from "Common/Utils/LLM/LlmProviderEndpoint";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import LLMService, {
  LLMCompletionResponse,
  LLMProviderConfig,
} from "Common/Server/Utils/LLM/LLMService";
import logger from "Common/Server/Utils/Logger";
import stubLLMEgressGuard from "Common/Tests/Server/Utils/AI/StubLLMEgressGuard";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4476: the Microsoft Foundry (Azure AI Foundry) guide, in every docs
 * language, held to the product it describes.
 *
 * The page is a promise about LLMService and the provider forms: which Base
 * URL reaches which endpoint, which headers go out, what OneUptime reads from
 * an answer, what the errors say, which variables register a global provider
 * and what the forms are called. Every one of those is checked here against
 * the code, so the page fails the build the day the product moves away from
 * it. The translations are held to the English page's facts: the same Base
 * URL table, examples and variables, OneUptime's own messages quoted the
 * way the product writes them, and the Dashboard's names as each language's
 * Dashboard draws them.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_ROOT, "..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const DOCS_LOCALES_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Locales",
);

const PAGE: string = "ai/microsoft-foundry.md";
const PAGE_URL: string = "/docs/ai/microsoft-foundry";
const LLM_PROVIDER_PAGE: string = "ai/llm-provider.md";

const FOUNDRY_LABEL: string = "Azure OpenAI / Microsoft Foundry";
const V1_BASE_URL: string = "https://contoso-ai.openai.azure.com/openai/v1";
const CLAUDE_BASE_URL: string =
  "https://contoso-ai.services.ai.azure.com/anthropic";
const DEPLOYMENT: string = "gpt-5.1";

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const FENCE: RegExp = /^\s*```(.*)$/;
const INLINE_CODE: RegExp = /`([^`]+)`/g;
const GLOBAL_PROVIDER_SETTING: RegExp = /^GLOBAL_LLM_PROVIDER_[A-Z_]+=/;

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: { load: (text: string) => unknown } = require(
  path.join(PACKAGES_ROOT, "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

function readPage(language: string, page: string = PAGE): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relativePath), "utf8");
}

interface Fence {
  lang: string;
  body: string;
}

function fencesOf(markdown: string): Array<Fence> {
  const fences: Array<Fence> = [];
  let open: Fence | null = null;
  const body: Array<string> = [];

  for (const line of markdown.split("\n")) {
    const fence: RegExpMatchArray | null = line.match(FENCE);

    if (fence) {
      if (!open) {
        open = { lang: fence[1]!.trim().split(" ")[0] || "", body: "" };
        body.length = 0;
      } else {
        open.body = body.join("\n");
        fences.push(open);
        open = null;
      }
      continue;
    }

    if (open) {
      body.push(line);
    }
  }

  return fences;
}

/*
 * The lines of a section: from its heading to the next heading of the same
 * level or higher, fenced lines skipped over.
 */
function sectionLines(markdown: string, headingIndex: number): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const headings: Array<number> = [];
  let inFence: boolean = false;

  lines.forEach((line: string, index: number) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return;
    }

    if (!inFence && line.startsWith("## ")) {
      headings.push(index);
    }
  });

  const start: number = headings[headingIndex]!;
  const end: number = headings[headingIndex + 1] ?? lines.length;

  return lines.slice(start, end);
}

// The h2 sections of the page, by position: translations keep the order.
interface Sections {
  howItWorks: number;
  beforeYouBegin: number;
  setUp: number;
  connect: number;
  baseUrlFormats: number;
  selfHosted: number;
  network: number;
  dataProcessed: number;
  example: number;
  entra: number;
  troubleshooting: number;
  nextSteps: number;
}

const SECTION: Sections = {
  howItWorks: 0,
  beforeYouBegin: 1,
  setUp: 2,
  connect: 3,
  baseUrlFormats: 4,
  selfHosted: 5,
  network: 6,
  dataProcessed: 7,
  example: 8,
  entra: 9,
  troubleshooting: 10,
  nextSteps: 11,
};

// A table's rule under its header: "| --- | --- |".
const TABLE_RULE: RegExp = /^\|\s*-/;

// The rows of every table in some lines, each as its cells.
function tableRows(lines: Array<string>): Array<Array<string>> {
  return lines
    .filter((line: string): boolean => {
      return line.startsWith("|") && !TABLE_RULE.test(line);
    })
    .map((line: string): Array<string> => {
      return line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

function codeOf(cell: string): Array<string> {
  return [...cell.matchAll(INLINE_CODE)].map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// The Base URL table: each Base URL and where the page says it goes.
function baseUrlTable(markdown: string): Array<[string, string]> {
  return tableRows(sectionLines(markdown, SECTION.baseUrlFormats))
    .slice(1)
    .map((cells: Array<string>): [string, string] => {
      return [codeOf(cells[0]!)[0]!, codeOf(cells[1]!)[0]!];
    });
}

// The titles of the :::details blocks under Troubleshooting.
function troubleshootingTitles(markdown: string): Array<string> {
  return sectionLines(markdown, SECTION.troubleshooting)
    .filter((line: string): boolean => {
      return line.startsWith(":::details ");
    })
    .map((line: string): string => {
      return line.slice(":::details ".length).trim();
    });
}

// The quoted message a troubleshooting title starts with, if it quotes one.
function quotedMessages(title: string): Array<string> {
  return [...title.matchAll(/"([^"]+)"/g)].map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// A quote with "..." for the parts that vary, as a pattern.
function quotePattern(quote: string): RegExp {
  const escaped: string = quote
    .split("...")
    .map((part: string): string => {
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("[\\s\\S]*");

  return new RegExp(escaped);
}

type PostSpy = ReturnType<typeof jest.spyOn>;

interface Sent {
  url: string;
  data: JSONObject;
  headers: Record<string, string>;
}

function reply(
  ...replies: Array<HTTPResponse<JSONObject> | HTTPErrorResponse>
): PostSpy {
  const spy: PostSpy = jest.spyOn(API, "post") as PostSpy;

  for (const answer of replies) {
    spy.mockResolvedValueOnce(answer as never);
  }

  return spy;
}

function sent(spy: PostSpy, index: number = 0): Sent {
  const call: { url: URL; data: JSONObject; headers: Record<string, string> } =
    spy.mock.calls[index]![0] as {
      url: URL;
      data: JSONObject;
      headers: Record<string, string>;
    };

  return { url: call.url.toString(), data: call.data, headers: call.headers };
}

function foundry(
  baseUrl: string,
  modelName: string = DEPLOYMENT,
): LLMProviderConfig {
  return {
    llmType: LlmType.AzureOpenAI,
    apiKey: "azure-key",
    baseUrl: baseUrl,
    modelName: modelName,
  };
}

const OPENAI_OK: JSONObject = {
  choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
};

const ANTHROPIC_OK: JSONObject = {
  content: [{ type: "text", text: "OK" }],
  stop_reason: "end_turn",
};

async function complete(
  config: LLMProviderConfig,
): Promise<LLMCompletionResponse> {
  return LLMService.getCompletion({
    llmProviderConfig: config,
    messages: [{ role: "user", content: "Reply with the word: OK" }],
  });
}

async function failureOf(
  config: LLMProviderConfig,
  answer: HTTPErrorResponse,
): Promise<string> {
  reply(answer);

  try {
    await complete(config);
  } catch (error) {
    return (error as Error).message;
  }

  throw new Error("The completion was expected to fail.");
}

beforeEach(() => {
  stubLLMEgressGuard();
  LLMService.clearRequestAdaptationCache();
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Microsoft Foundry page is in every language, under AI", () => {
  test("every docs language is checked", () => {
    expect(SUPPORTED_DOCS_LANGUAGE_CODES).toHaveLength(17);
  });

  test("the AI group lists it right after LLM Providers", () => {
    const group: NavGroup | undefined = DocsNav.find((item: NavGroup) => {
      return item.title === "AI";
    });
    const urls: Array<string> = (group?.links || []).map((link: NavLink) => {
      return link.url;
    });

    expect(urls.indexOf(PAGE_URL)).toBe(
      urls.indexOf("/docs/ai/llm-provider") + 1,
    );
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s has the page, and a sidebar title for it",
    (language: string) => {
      expect(fs.existsSync(path.join(CONTENT_DIR, language, PAGE))).toBe(true);

      const locale: { navLinks: Record<string, string> } = JSON.parse(
        fs.readFileSync(
          path.join(DOCS_LOCALES_DIR, `${language}.json`),
          "utf8",
        ),
      );

      expect(locale.navLinks["Microsoft Foundry"]).toBe("Microsoft Foundry");
    },
  );
});

describe("the Base URL table is where LLMService sends each request", () => {
  const english: Array<[string, string]> = baseUrlTable(readPage("en"));

  test("the English table has every shape the page describes", () => {
    expect(english).toHaveLength(5);
  });

  test.each(english)(
    "%s goes to %s",
    async (baseUrl: string, requestUrl: string) => {
      const usesClaude: boolean =
        LlmProviderEndpoint.isAnthropicApiBaseUrl(baseUrl);

      expect(
        usesClaude
          ? LlmProviderEndpoint.resolveAnthropicMessagesUrl(baseUrl)
          : LlmProviderEndpoint.resolveAzureOpenAI(baseUrl).requestUrl,
      ).toBe(requestUrl);

      const spy: PostSpy = reply({
        jsonData: usesClaude ? ANTHROPIC_OK : OPENAI_OK,
      } as unknown as HTTPResponse<JSONObject>);

      await complete(foundry(baseUrl));

      expect(sent(spy).url).toBe(requestUrl);
    },
  );

  test("a deployment URL is sent with the default api-version the page names", () => {
    expect(LlmProviderEndpoint.AZURE_OPENAI_DEFAULT_API_VERSION).toBe(
      "2024-10-21",
    );

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({
        language,
        named: readPage(language).includes("`api-version=2024-10-21`"),
      }).toEqual({ language, named: true });
    }
  });

  test.each(TRANSLATIONS)("%s has the English table", (language: string) => {
    expect(baseUrlTable(readPage(language))).toEqual(english);
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s says the Base URL holds as many characters as its column",
    (language: string) => {
      expect(ColumnLength.ShortURL).toBe(100);
      expect(
        sectionLines(readPage(language), SECTION.baseUrlFormats).join("\n"),
      ).toContain(String(ColumnLength.ShortURL));
    },
  );
});

describe("the page's table of APIs is what one provider type calls", () => {
  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s: the first two Base URLs reach the v1 API, the third Claude's",
    async (language: string) => {
      const rows: Array<Array<string>> = tableRows(
        sectionLines(readPage(language), SECTION.howItWorks),
      ).slice(1);
      const baseUrls: Array<string> = rows.map((cells: Array<string>) => {
        return codeOf(cells[2]!)[0]!;
      });

      expect(baseUrls).toEqual([
        V1_BASE_URL,
        "https://contoso-ai.services.ai.azure.com/openai/v1",
        CLAUDE_BASE_URL,
      ]);
      expect(
        LlmProviderEndpoint.resolveAzureOpenAI(baseUrls[0]!).usesV1Api,
      ).toBe(true);
      expect(
        LlmProviderEndpoint.resolveAzureOpenAI(baseUrls[1]!).usesV1Api,
      ).toBe(true);
      expect(LlmProviderEndpoint.isAnthropicApiBaseUrl(baseUrls[2]!)).toBe(
        true,
      );
    },
  );

  test("one Azure provider with Claude's Base URL speaks the Anthropic wire", async () => {
    const spy: PostSpy = reply({
      jsonData: ANTHROPIC_OK,
    } as unknown as HTTPResponse<JSONObject>);

    const response: LLMCompletionResponse = await complete(
      foundry(CLAUDE_BASE_URL, "claude-sonnet-5-5"),
    );

    expect(sent(spy).headers["anthropic-version"]).toBe("2023-06-01");
    expect(response.content).toBe("OK");
  });
});

describe("the page names the forms as the Dashboard draws them", () => {
  const PROVIDER_FORM: string =
    "App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviders.tsx";

  // A field's title in the provider form, from its key to the next field's.
  function formFieldTitle(field: string): string {
    const form: string = readSource(PROVIDER_FORM);
    const start: number = form.search(
      new RegExp(`field: \\{\\s*${field}: true,`),
    );
    const next: number = form.indexOf("field: {", start + 1);

    return (
      form
        .slice(start, next === -1 ? undefined : next)
        .match(/title: "([^"]+)"/)?.[1] || ""
    );
  }

  test("the English page's Provider Settings table names the form's fields", () => {
    const fields: Array<string> = tableRows(
      sectionLines(readPage("en"), SECTION.connect),
    )
      .slice(1)
      .map((cells: Array<string>) => {
        return cells[0]!.replace(/\*\*/g, "");
      });

    expect(fields).toEqual([
      formFieldTitle("llmType"),
      formFieldTitle("apiKey"),
      formFieldTitle("modelName"),
      formFieldTitle("baseUrl"),
    ]);
  });

  test("the provider's label is the dropdown's", () => {
    const options: string = readSource(
      "Common/UI/Utils/LlmTypeDropdownOptions.ts",
    );

    expect(options).toMatch(
      new RegExp(
        `label: "${FOUNDRY_LABEL.replace("/", "\\/")}",\\s*value: LlmType\\.AzureOpenAI,`,
      ),
    );
  });

  const LABELS: Array<string> = [
    "Project Settings",
    "AI",
    "LLM Providers",
    "Create LLM Provider",
    "Basic Info",
    "Name",
    "Description",
    "Next",
    "LLM Provider",
    "API Key",
    "Model Name",
    "Base URL",
    "More fields",
    "Set as Default",
    "Test",
    "AI Logs",
    "Additional Parameters",
  ];

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s names each of them in bold, in its Dashboard's words",
    (language: string) => {
      const markdown: string = readPage(language);

      for (const english of LABELS) {
        const label: string = drawnDashboardLabel(language, english);

        expect({
          english,
          label,
          named: markdown.includes(`**${label}**`),
        }).toEqual({ english, label, named: true });
      }

      const way: string = ["Project Settings", "AI", "LLM Providers"]
        .map((english: string): string => {
          return `**${drawnDashboardLabel(language, english)}**`;
        })
        .join(" > ");

      expect(markdown).toContain(way);
      expect(markdown).toContain(`**${FOUNDRY_LABEL}**`);
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s keys its example provider by the form's labels, and it works",
    async (language: string) => {
      const example: Fence | undefined = fencesOf(readPage(language)).find(
        (fence: Fence) => {
          return fence.lang === "text";
        },
      );
      const entries: Array<[string, string]> = (example?.body || "")
        .split("\n")
        .map((line: string): [string, string] => {
          const at: number = line.indexOf(": ");
          return [line.slice(0, at), line.slice(at + 2)];
        });

      expect(
        entries.map((entry: [string, string]) => {
          return entry[0];
        }),
      ).toEqual(
        ["Name", "LLM Provider", "API Key", "Model Name", "Base URL"].map(
          (english: string): string => {
            return drawnDashboardLabel(language, english);
          },
        ),
      );

      const values: Array<string> = entries.map((entry: [string, string]) => {
        return entry[1];
      });

      expect(values[1]).toBe(FOUNDRY_LABEL);
      expect(values[3]).toBe(DEPLOYMENT);
      expect(values[4]).toBe(V1_BASE_URL);

      const spy: PostSpy = reply({
        jsonData: OPENAI_OK,
      } as unknown as HTTPResponse<JSONObject>);

      await complete(foundry(values[4]!, values[3]!));

      expect(sent(spy).url).toBe(`${V1_BASE_URL}/chat/completions`);
      expect(sent(spy).data["model"]).toBe(DEPLOYMENT);
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s lists who may add a provider as the model does",
    (language: string) => {
      const titles: Array<string> = PermissionHelper.getPermissionTitles(
        new LlmProvider().getCreatePermissions(),
      );

      expect(titles).toEqual([
        "Project Owner",
        "Project Admin",
        "Project Member",
        "Settings Admin",
        "Settings Member",
        "Create LLM",
      ]);

      const markdown: string = sectionLines(
        readPage(language),
        SECTION.beforeYouBegin,
      ).join("\n");

      for (const title of titles) {
        expect({ title, named: markdown.includes(`**${title}**`) }).toEqual({
          title,
          named: true,
        });
      }
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s quotes the Test button's verdict as the API words it",
    (language: string) => {
      const verdict: string =
        "Connection successful. The LLM provider responded to a test prompt and used tool calling.";

      expect(readSource("Common/Server/API/LlmProviderAPI.ts")).toContain(
        `"${verdict}"`,
      );
      expect(readPage(language)).toContain(`"${verdict}"`);
    },
  );
});

describe("the self-hosted variables are the startup sync's", () => {
  const STARTUP_SYNC: string =
    "App/FeatureSet/Workers/StartupMigrations/SeedGlobalLlmProviderFromEnv.ts";

  function settingsIn(markdown: string): Array<string> {
    return fencesOf(markdown)
      .filter((fence: Fence) => {
        return fence.lang === "bash";
      })
      .flatMap((fence: Fence) => {
        return fence.body.split("\n");
      })
      .filter((line: string) => {
        return GLOBAL_PROVIDER_SETTING.test(line);
      });
  }

  const english: Array<string> = settingsIn(readPage("en"));

  test("the English example sets the five variables the sync reads, for an Azure provider", () => {
    const sync: string = readSource(STARTUP_SYNC);
    const names: Array<string> = english.map((line: string) => {
      return line.slice(0, line.indexOf("="));
    });

    expect(names).toEqual([
      "GLOBAL_LLM_PROVIDER_TYPE",
      "GLOBAL_LLM_PROVIDER_NAME",
      "GLOBAL_LLM_PROVIDER_BASE_URL",
      "GLOBAL_LLM_PROVIDER_MODEL_NAME",
      "GLOBAL_LLM_PROVIDER_API_KEY",
    ]);

    for (const name of names) {
      expect(sync).toContain(`process.env["${name}"]`);
    }

    expect(english[0]).toBe(`GLOBAL_LLM_PROVIDER_TYPE=${LlmType.AzureOpenAI}`);
    expect(english[2]).toBe(`GLOBAL_LLM_PROVIDER_BASE_URL=${V1_BASE_URL}`);
    expect(english[3]).toBe(`GLOBAL_LLM_PROVIDER_MODEL_NAME=${DEPLOYMENT}`);
  });

  test("the Base URL in the example fits the column the sync writes it to", () => {
    expect(V1_BASE_URL.length).toBeLessThanOrEqual(ColumnLength.ShortURL);
    expect(readSource(STARTUP_SYNC)).toContain(
      "baseUrl.length > ColumnLength.ShortURL",
    );
  });

  test.each(TRANSLATIONS)(
    "%s sets them exactly as the English example does",
    (language: string) => {
      expect(settingsIn(readPage(language))).toEqual(english);
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s's Helm values pass the same variables through the chart-wide extraEnv",
    (language: string) => {
      const values: Fence | undefined = fencesOf(readPage(language)).find(
        (fence: Fence) => {
          return fence.lang === "yaml";
        },
      );
      const parsed: {
        extraEnv: Array<{
          name: string;
          value?: string;
          valueFrom?: { secretKeyRef: { name: string; key: string } };
        }>;
      } = jsYaml.load(values?.body || "") as never;

      const plain: Array<string> = parsed.extraEnv
        .filter((entry: { value?: string }) => {
          return entry.value !== undefined;
        })
        .map((entry: { name: string; value?: string }) => {
          return `${entry.name}=${entry.value}`;
        });

      expect(plain).toEqual(english.slice(0, 4));
      expect(parsed.extraEnv[4]).toEqual({
        name: "GLOBAL_LLM_PROVIDER_API_KEY",
        valueFrom: { secretKeyRef: { name: "azure-foundry", key: "api-key" } },
      });
    },
  );

  test("the chart has a chart-wide extraEnv every OneUptime service reads", () => {
    const values: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "HelmChart/Public/oneuptime/values.yaml"),
      "utf8",
    );

    expect(values).toMatch(/^extraEnv: \[\]$/m);

    for (const template of ["app.yaml", "worker.yaml", "migrate-job.yaml"]) {
      expect({
        template,
        reads: fs
          .readFileSync(
            path.join(
              REPOSITORY_ROOT,
              "HelmChart/Public/oneuptime/templates",
              template,
            ),
            "utf8",
          )
          .includes("$.Values.extraEnv"),
      }).toEqual({ template, reads: true });
    }
  });

  test("Docker Compose passes every one of them to the app", () => {
    const compose: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "docker-compose.base.yml"),
      "utf8",
    );

    for (const line of english) {
      const name: string = line.slice(0, line.indexOf("="));

      expect(compose).toContain(`${name}: \${${name}}`);
    }
  });

  test("the Docker Compose command is the one the install guide starts OneUptime with", () => {
    const command: string =
      "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)";

    expect(readPage("en", "installation/docker-compose.md")).toContain(command);

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({ language, has: readPage(language).includes(command) }).toEqual({
        language,
        has: true,
      });
    }
  });
});

describe("the example request and response are LLMService's", () => {
  interface Curl {
    url: string;
    headers: Record<string, string>;
    body: JSONObject;
  }

  function curlsOf(markdown: string): Array<Curl> {
    return fencesOf(markdown)
      .filter((fence: Fence) => {
        return fence.lang === "bash" && fence.body.startsWith("curl ");
      })
      .map((fence: Fence): Curl => {
        const headers: Record<string, string> = {};

        for (const match of fence.body.matchAll(/-H "([^:]+): ([^"]+)"/g)) {
          headers[match[1]!.toLowerCase()] = match[2]!;
        }

        return {
          url: fence.body.match(/^curl (\S+)/)![1]!,
          headers: headers,
          body: JSON.parse(fence.body.match(/-d '([\s\S]*)'/)![1]!),
        };
      });
  }

  function answersOf(markdown: string): Array<JSONObject> {
    return fencesOf(markdown)
      .filter((fence: Fence) => {
        return fence.lang === "json";
      })
      .map((fence: Fence): JSONObject => {
        return JSON.parse(fence.body) as JSONObject;
      });
  }

  const curls: Array<Curl> = curlsOf(readPage("en"));
  const answers: Array<JSONObject> = answersOf(readPage("en"));

  test("the page shows a request and an answer for each API", () => {
    expect(curls).toHaveLength(2);
    expect(answers).toHaveLength(2);
  });

  test("the v1 request goes where, and with what, LLMService sends one", async () => {
    const spy: PostSpy = reply({
      jsonData: answers[0]!,
    } as unknown as HTTPResponse<JSONObject>);

    const response: LLMCompletionResponse = await complete(
      foundry(V1_BASE_URL, curls[0]!.body["model"] as string),
    );
    const request: Sent = sent(spy);

    expect(curls[0]!.url).toBe(request.url);
    expect(Object.keys(curls[0]!.headers).sort()).toEqual(
      Object.keys(request.headers)
        .map((name: string) => {
          return name.toLowerCase();
        })
        .sort(),
    );
    expect(request.data["model"]).toBe(curls[0]!.body["model"]);
    expect(request.data["messages"]).toEqual(curls[0]!.body["messages"]);

    // And the answer shown is one OneUptime reads.
    expect(response).toEqual({
      content: "OK",
      toolCalls: undefined,
      stopReason: "stop",
      usage: {
        promptTokens: 12,
        completionTokens: 2,
        totalTokens: 14,
        cachedInputTokens: undefined,
      },
    });
  });

  test("the Anthropic request goes where, and with what, LLMService sends one", async () => {
    const spy: PostSpy = reply({
      jsonData: answers[1]!,
    } as unknown as HTTPResponse<JSONObject>);

    const response: LLMCompletionResponse = await complete(
      foundry(CLAUDE_BASE_URL, curls[1]!.body["model"] as string),
    );
    const request: Sent = sent(spy);

    expect(curls[1]!.url).toBe(request.url);
    expect(curls[1]!.headers).toEqual(
      Object.fromEntries(
        Object.entries(request.headers).map(
          ([name, value]: [string, string]) => {
            return [
              name.toLowerCase(),
              name === "x-api-key" ? "$AZURE_API_KEY" : value,
            ];
          },
        ),
      ),
    );
    expect(request.data["model"]).toBe(curls[1]!.body["model"]);
    expect(response.content).toBe("OK");
    expect(response.stopReason).toBe("stop");
  });

  test.each(TRANSLATIONS)(
    "%s shows the same requests and answers",
    (language: string) => {
      expect(curlsOf(readPage(language))).toEqual(curls);
      expect(answersOf(readPage(language))).toEqual(answers);
    },
  );
});

describe("the troubleshooting quotes what OneUptime says", () => {
  const V1: LLMProviderConfig = foundry(V1_BASE_URL, "gpt-5-1-prod");
  const DEPLOYMENT_URL: LLMProviderConfig = foundry(
    "https://contoso-ai.openai.azure.com/openai/deployments/o3-mini",
    "o3-mini",
  );

  function azureError(
    statusCode: number,
    error: JSONObject,
  ): HTTPErrorResponse {
    return new HTTPErrorResponse(statusCode, { error: error }, {});
  }

  async function guardRefusal(reason: EgressFailureReason): Promise<string> {
    jest
      .spyOn(DataSourceEgressGuard, "assertUrlAllowedAndPin")
      .mockRejectedValue(new EgressGuardException("refused", reason) as never);

    try {
      await complete(V1);
    } catch (error) {
      return (error as Error).message;
    }

    throw new Error("The completion was expected to fail.");
  }

  // What OneUptime says for each quote, worked out by making it say it.
  const SAYS: Record<string, () => Promise<string>> = {
    "Azure did not accept the API key": (): Promise<string> => {
      return failureOf(
        V1,
        azureError(401, { code: "401", message: "Access denied" }),
      );
    },
    "Key-based authentication is turned off for this resource":
      (): Promise<string> => {
        return failureOf(
          V1,
          azureError(403, {
            code: "AuthenticationTypeDisabled",
            message: "Key based authentication is disabled for this resource.",
          }),
        );
      },
    "Azure refused the request": (): Promise<string> => {
      return failureOf(
        V1,
        azureError(403, {
          code: "403",
          message: "Access denied due to Virtual Network/Firewall rules.",
        }),
      );
    },
    "This resource has no deployment named ...": (): Promise<string> => {
      return failureOf(
        V1,
        azureError(404, {
          code: "DeploymentNotFound",
          message: "The API deployment for this resource does not exist.",
        }),
      );
    },
    "Azure found nothing at this address": (): Promise<string> => {
      return failureOf(
        V1,
        azureError(404, { code: "404", message: "Resource not found" }),
      );
    },
    "This model needs api-version ... or later": (): Promise<string> => {
      return failureOf(
        DEPLOYMENT_URL,
        azureError(400, {
          code: "BadRequest",
          message:
            "Model {modelName} is enabled only for api versions 2024-12-01-preview and later",
        }),
      );
    },
    "Azure's v1 API takes no dated api-version": (): Promise<string> => {
      return failureOf(
        foundry(`${V1_BASE_URL}?api-version=2024-10-21`),
        azureError(400, {
          code: "BadRequest",
          message: "API version not supported",
        }),
      );
    },
    "...could not be reached": (): Promise<string> => {
      return guardRefusal(EgressFailureReason.Unreachable);
    },
    "...host name could not be resolved": (): Promise<string> => {
      return guardRefusal(EgressFailureReason.ResolutionFailed);
    },
  };

  const VALIDATION_TEMPLATE: string =
    "{{field}} cannot be more than {{maxLength}} characters.";

  // The length message, as the Base URL field shows it in that language.
  function lengthMessage(language: string): string {
    return drawnDashboardLabel(language, VALIDATION_TEMPLATE)
      .replace("{{field}}", drawnDashboardLabel(language, "Base URL"))
      .replace("{{maxLength}}", String(ColumnLength.ShortURL));
  }

  test("the forms build the length message from the template the page fills in", () => {
    expect(readSource("Common/UI/Components/Forms/Validation.ts")).toContain(
      `"${VALIDATION_TEMPLATE}"`,
    );
    expect(lengthMessage("en")).toBe(
      "Base URL cannot be more than 100 characters.",
    );
  });

  test("every English quote is something OneUptime says", async () => {
    const quotes: Array<string> = troubleshootingTitles(readPage("en")).flatMap(
      quotedMessages,
    );

    expect(quotes).toEqual([
      ...Object.keys(SAYS).slice(0, 7),
      lengthMessage("en"),
      ...Object.keys(SAYS).slice(7),
    ]);

    for (const quote of Object.keys(SAYS)) {
      jest.restoreAllMocks();
      stubLLMEgressGuard();
      jest.spyOn(logger, "error").mockImplementation((): void => {});
      LLMService.clearRequestAdaptationCache();

      const message: string = await SAYS[quote]!();

      expect({
        quote,
        said: quotePattern(quote).test(message),
        message,
      }).toEqual({ quote, said: true, message });
    }
  });

  test.each(TRANSLATIONS)(
    "%s quotes OneUptime's messages as written, and the field's in its own words",
    (language: string) => {
      const english: Array<string> = troubleshootingTitles(
        readPage("en"),
      ).flatMap(quotedMessages);
      const translated: Array<string> = troubleshootingTitles(
        readPage(language),
      ).flatMap(quotedMessages);

      expect(translated).toEqual(
        english.map((quote: string): string => {
          return quote === lengthMessage("en")
            ? lengthMessage(language)
            : quote;
        }),
      );
    },
  );

  test("AI Logs keeps the first 490 characters of an error, as the page says", () => {
    expect(readSource("Common/Server/Services/AIService.ts")).toContain(
      "logEntry.statusMessage = errorMessage.substring(0, 490);",
    );

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({
        language,
        says: sectionLines(readPage(language), SECTION.troubleshooting)
          .join("\n")
          .includes("490"),
      }).toEqual({ language, says: true });
    }
  });

  test("AI features try ten times within about five minutes", () => {
    expect(LLMService.DEFAULT_REQUEST_ATTEMPTS).toBe(10);
    expect(readSource("Common/Server/Utils/LLM/LLMService.ts")).toContain(
      "DEFAULT_RETRY_DEADLINE_IN_MS: number = 5 * 60 * 1000;",
    );
  });
});

describe("the page's account of the network is the egress guard's", () => {
  test("DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES is the switch the guard reads", () => {
    expect(
      readSource("Common/Server/Utils/DataSource/EgressGuard.ts"),
    ).toContain(
      'process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] === "true"',
    );

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({
        language,
        names: readPage(language).includes(
          "`DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`",
        ),
      }).toEqual({ language, names: true });
    }
  });

  test("a Global LLM Provider reaches a private endpoint even where project providers may not", async () => {
    process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] = "true";

    try {
      jest.restoreAllMocks();
      jest.spyOn(logger, "error").mockImplementation((): void => {});
      const guard: ReturnType<typeof jest.spyOn> = jest.spyOn(
        DataSourceEgressGuard,
        "assertUrlAllowedAndPin",
      );
      guard.mockResolvedValue({
        url: new globalThis.URL(`${V1_BASE_URL}/chat/completions`),
        addresses: [{ address: "10.0.0.12", family: 4 }],
        httpAgent: undefined as never,
        httpsAgent: undefined as never,
      } as never);
      reply({ jsonData: OPENAI_OK } as unknown as HTTPResponse<JSONObject>);

      await complete({ ...foundry(V1_BASE_URL), isGlobalProvider: true });

      // The global provider asks the guard to allow private addresses.
      expect(guard.mock.calls[0]![1]).toEqual(
        expect.objectContaining({ blockPrivateAddresses: false }),
      );
    } finally {
      delete process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"];
    }
  });
});

describe("the LLM provider guide sends Azure readers to this page", () => {
  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)("%s", (language: string) => {
    const markdown: string = readPage(language, LLM_PROVIDER_PAGE);
    const lines: Array<string> = markdown.split("\n");
    const ollama: number = lines.findIndex((line: string) => {
      return line.startsWith("### Ollama");
    });

    // The provider's row, the field's list, a section and two links.
    expect(markdown).toContain(`| **${FOUNDRY_LABEL}** |`);
    expect(lines[ollama - 4]!.startsWith("### Azure OpenAI")).toBe(true);
    expect(lines[ollama - 2]).toContain(`](${PAGE_URL})`);
    expect(markdown.split(`](${PAGE_URL})`).length - 1).toBe(2);
    expect(markdown).toContain(V1_BASE_URL);
  });
});
