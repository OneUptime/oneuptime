import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LlmType from "Common/Types/LLM/LlmType";
import API from "Common/Utils/API";
import DataSourceEgressGuard, {
  AddressVerdict,
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import LLMService from "Common/Server/Utils/LLM/LLMService";
import logger from "Common/Server/Utils/Logger";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { startEachTestOnSelfHostedEgressPolicy } from "Common/Tests/Server/Utils/EgressPolicyEnvironment";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import dns from "dns";
import fs from "fs";
import net from "net";
import path from "path";

/*
 * The LLM provider guides, against the egress guard every LLM request goes
 * through (LLMService.buildGuardedRequestOptions), in every docs language.
 *
 * The guide told self-hosters to enter http://localhost:11434 as Ollama's
 * Base URL, and the provider forms and config.example.env suggested the same.
 * That can never work: the guard refuses loopback in every deployment, and
 * inside Docker Compose or Kubernetes localhost is the OneUptime container
 * anyway. These hold every Base URL the guides, the forms and
 * config.example.env suggest to what the guard lets through on a self-hosted
 * install; hold the guide's account of the policy, the refusals it quotes,
 * and the private addresses it says a Global LLM Provider still reaches, to
 * the guard and LLMService; and hold its in-cluster vLLM URL and num_ctx
 * advice to the Helm chart and the Ollama request that make them true, and
 * the context window errors it quotes to what LLMService reports.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_ROOT, "..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const CHART_DIR: string = path.join(
  REPOSITORY_ROOT,
  "HelmChart/Public/oneuptime",
);

const LLM_PROVIDER_PAGE: string = "ai/llm-provider.md";
const AI_AGENT_PAGE: string = "ai/ai-agent.md";

// The forms whose Base URL field shows a placeholder.
const BASE_URL_FORMS: Array<string> = [
  "App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviders.tsx",
  "App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviderView.tsx",
  "App/FeatureSet/AdminDashboard/src/Pages/Settings/LlmProviders/Index.tsx",
];

// Where the Admin Dashboard lists Global LLM Providers, and its labels.
const ADMIN_LLM_PROVIDERS_PAGE: string =
  "App/FeatureSet/AdminDashboard/src/Pages/Settings/LlmProviders/Index.tsx";
const ADMIN_DASHBOARD_LOCALES_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/AdminDashboard/src/Locales",
);

// The guides quote the dashboards in English in these languages.
const ENGLISH_LABEL_LANGUAGES: Array<string> = ["en", "fa"];

/*
 * The Additional Parameters every language's guide shows for Ollama: the
 * num_ctx LLMService's context window error recommends.
 */
const NUM_CTX_EXAMPLE: string = `{ "options": { "num_ctx": ${LLMService.RECOMMENDED_OLLAMA_NUM_CTX} } }`;

/*
 * The context window errors, as the guides quote them: OneUptime's own, and
 * the two Ollama sends that it explains. In English in every language, like
 * the refusals below, because that is what the dashboard shows.
 */
const CONTEXT_WINDOW_ERROR: string = LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR;
const OLLAMA_NO_USER_QUERY: string = "no user query found in messages";
const OLLAMA_PROMPT_TOO_LONG: string =
  "the prompt is longer than the context length currently available to the model";

/*
 * The tails of LLMService's refusals, as the guides quote them. The guides
 * quote them in English in every language, because that is what the
 * dashboard shows.
 */
const ADDRESS_REFUSAL: string =
  "points to an address OneUptime is not allowed to connect to";
const UNREACHABLE_REFUSAL: string = "could not be reached";

const LOOPBACK_HOST_NAME: RegExp = /^localhost$|\.localhost$/i;

/*
 * js-yaml is loaded from Common/node_modules, the way
 * OpenTelemetryCollectorExampleDocs.test.ts loads it: Common declares js-yaml
 * 4, App declares no YAML parser.
 */
interface JsYamlModule {
  load: (text: string) => unknown;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: JsYamlModule = require(
  path.join(PACKAGES_ROOT, "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

function readPage(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

// What the Admin Dashboard draws for a label, by its key, in that language.
function adminDashboardLabel(language: string, key: string): string {
  const locale: string = ENGLISH_LABEL_LANGUAGES.includes(language)
    ? "en"
    : language;
  let label: unknown = JSON.parse(
    fs.readFileSync(
      path.join(ADMIN_DASHBOARD_LOCALES_DIR, `${locale}.json`),
      "utf8",
    ),
  );

  for (const part of key.split(".")) {
    label = (label as JSONObject | undefined)?.[part];
  }

  return typeof label === "string" ? label : "";
}

/*
 * The host of every http(s) URL in a piece of text, markdown link targets
 * excepted: a link is where the page sends the reader, not an address for
 * OneUptime to dial. The guides name the refused addresses without a scheme
 * (`127.0.0.1`), so naming them is not suggesting them.
 */
function suggestedHosts(text: string): Array<string> {
  const withoutLinkTargets: string = text.replace(/\]\([^)]*\)/g, "]");
  const hosts: Array<string> = [];

  for (const match of withoutLinkTargets.matchAll(
    /https?:\/\/(\[[^\]]*\]|[^/:\s`"')]+)/g,
  )) {
    hosts.push(match[1]!);
  }

  return hosts;
}

// Why the guard would refuse this host on a self-hosted install, if it would.
function selfHostedRefusal(host: string): string | undefined {
  const bareHost: string = host.replace(/^\[|\]$/g, "");

  if (net.isIP(bareHost) !== 0) {
    const verdict: AddressVerdict = DataSourceEgressGuard.checkAddress(
      bareHost,
      { blockPrivateAddresses: false },
    );

    return verdict.blocked ? `${bareHost}: ${verdict.reason}` : undefined;
  }

  return LOOPBACK_HOST_NAME.test(bareHost)
    ? `${bareHost}: loopback host name`
    : undefined;
}

function refusedHosts(text: string): Array<string> {
  return suggestedHosts(text)
    .map(selfHostedRefusal)
    .filter((refusal: string | undefined): refusal is string => {
      return refusal !== undefined;
    });
}

// An address inside a CIDR range the guide names, e.g. 10.0.0.1 for 10.0.0.0/8.
function addressInside(range: string): string {
  const base: string = range.split("/")[0]!;

  return net.isIPv6(base) ? `${base}1` : base.replace(/\.0$/, ".1");
}

function mockOllamaReply(): ReturnType<typeof jest.spyOn> {
  return jest.spyOn(API, "post").mockResolvedValue({
    jsonData: { message: { content: "OK" } },
  } as unknown as HTTPResponse<JSONObject>) as ReturnType<typeof jest.spyOn>;
}

function mockOpenAICompatibleReply(): ReturnType<typeof jest.spyOn> {
  return jest.spyOn(API, "post").mockResolvedValue({
    jsonData: {
      choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
    },
  } as unknown as HTTPResponse<JSONObject>) as ReturnType<typeof jest.spyOn>;
}

function refuseEveryRequest(): ReturnType<typeof jest.spyOn> {
  return jest.spyOn(API, "post").mockImplementation(() => {
    throw new Error("No request may leave for a refused Base URL.");
  }) as ReturnType<typeof jest.spyOn>;
}

describe("every Base URL the LLM guides suggest is one the guard lets through on a self-hosted install", () => {
  for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
    for (const page of [LLM_PROVIDER_PAGE, AI_AGENT_PAGE]) {
      test(`${language}/${page}`, () => {
        const markdown: string = readPage(language, page);

        expect(markdown).toContain("http://ollama:11434");
        expect(suggestedHosts(markdown).length).toBeGreaterThan(0);
        expect(refusedHosts(markdown)).toEqual([]);
      });
    }
  }
});

describe("no other Base URL hint suggests a refused address", () => {
  test.each(BASE_URL_FORMS)(
    "the Base URL placeholder in %s",
    (form: string) => {
      const source: string = fs.readFileSync(
        path.join(PACKAGES_ROOT, form),
        "utf8",
      );
      const field: RegExpMatchArray | null = source.match(
        /title:\s*"Base URL",[\s\S]*?placeholder:\s*"([^"]*)"/,
      );

      expect(field).not.toBeNull();
      expect(suggestedHosts(field![1]!)).toHaveLength(1);
      expect(refusedHosts(field![1]!)).toEqual([]);
    },
  );

  test("the GLOBAL_LLM_PROVIDER_* block of config.example.env", () => {
    const example: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "config.example.env"),
      "utf8",
    );
    const block: string = example.slice(
      example.indexOf("# Global LLM Provider"),
      example.indexOf("GLOBAL_LLM_PROVIDER_API_KEY="),
    );

    expect(block).toContain("GLOBAL_LLM_PROVIDER_BASE_URL=");
    expect(suggestedHosts(block).length).toBeGreaterThan(0);
    expect(refusedHosts(block)).toEqual([]);
  });
});

describe("the guide's account of the egress policy is the guard's", () => {
  startEachTestOnSelfHostedEgressPolicy();

  test("loopback, unspecified and cloud metadata addresses are refused on a self-hosted install too", async () => {
    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(false);

    for (const address of ["127.0.0.1", "::1", "0.0.0.0", "169.254.169.254"]) {
      expect(DataSourceEgressGuard.checkAddress(address).blocked).toBe(true);
    }

    const resolveToLoopback: () => Promise<
      Array<ResolvedAddress>
    > = (): Promise<Array<ResolvedAddress>> => {
      return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
    };

    await expect(
      DataSourceEgressGuard.assertUrlAllowed("http://localhost:11434", {
        resolveFunction: resolveToLoopback,
        targetLabel: "LLM provider",
      }),
    ).rejects.toThrow("not allowed");
  });

  test("every private range the guide names is reachable self-hosted and refused once private addresses are blocked", () => {
    const ranges: Array<string> = [
      ...readPage("en", LLM_PROVIDER_PAGE).matchAll(/`([0-9a-f.:]+\/\d+)`/g),
    ].map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(ranges).toEqual([
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "100.64.0.0/10",
      "fc00::/7",
    ]);

    for (const range of ranges) {
      const address: string = addressInside(range);

      expect(
        DataSourceEgressGuard.checkAddress(address, {
          blockPrivateAddresses: false,
        }).blocked,
      ).toBe(false);

      const blockedVerdict: AddressVerdict = DataSourceEgressGuard.checkAddress(
        address,
        { blockPrivateAddresses: true },
      );

      expect(blockedVerdict.blocked).toBe(true);
      expect(blockedVerdict.isPrivateNetwork).toBe(true);
    }
  });

  test("DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true blocks private addresses, as OneUptime Cloud does", () => {
    process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] = "true";
    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(true);

    delete process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"];
    process.env["BILLING_ENABLED"] = "true";
    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(true);
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s names the ranges, the switch and OLLAMA_HOST",
    (language: string) => {
      const markdown: string = readPage(language, LLM_PROVIDER_PAGE);

      for (const fact of [
        "`10.0.0.0/8`",
        "`172.16.0.0/12`",
        "`192.168.0.0/16`",
        "`100.64.0.0/10`",
        "`fc00::/7`",
        "`DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`",
        "`OLLAMA_HOST=0.0.0.0:11434`",
        "`/api/chat`",
      ]) {
        expect(markdown).toContain(fact);
      }
    },
  );
});

/*
 * BILLING_ENABLED and DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES refuse private
 * addresses only to the providers projects configure. LLMService exempts a
 * Global LLM Provider no project owns, whose Base URL an administrator set
 * (LLMServiceGlobalProviderEgress.test.ts pins that for every wire format).
 * The guide says so where it names the switch, and sends anyone who wires the
 * Helm chart's vLLM up by hand to the Admin Dashboard when either switch is
 * on: the vLLM Service's name resolves to a private ClusterIP.
 */
describe("the guide's account of the Global LLM Provider exemption is LLMService's", () => {
  startEachTestOnSelfHostedEgressPolicy();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const PRIVATE_ADDRESS_SWITCHES: Array<string> = [
    "BILLING_ENABLED",
    "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES",
  ];

  // The guide's in-cluster vLLM example, and a ClusterIP its Service name resolves to.
  const IN_CLUSTER_VLLM_BASE_URL: string =
    "http://oneuptime-vllm.default.svc.cluster.local:8000/v1";
  const VLLM_CLUSTER_IP: string = "10.96.14.21";

  function completeWith(
    baseUrl: string,
    isGlobalProvider: boolean,
  ): Promise<unknown> {
    return LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.OpenAICompatible,
        baseUrl: baseUrl,
        modelName: "Qwen/Qwen2.5-1.5B-Instruct",
        isGlobalProvider: isGlobalProvider,
      },
      messages: [{ role: "user", content: "hi" }],
    });
  }

  function resolveToClusterIp(): void {
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: VLLM_CLUSTER_IP, family: 4 }] as never);
  }

  // From the manual vLLM steps to the end of their section.
  function manualVllmSteps(markdown: string): string {
    const start: number = markdown.indexOf(
      "`vllm.globalProvider.enabled: false`",
    );
    const end: number = markdown.indexOf("\n## ", start);

    return start === -1
      ? ""
      : markdown.slice(start, end === -1 ? undefined : end);
  }

  test("the guide's in-cluster vLLM example is the one held here", () => {
    expect(readPage("en", LLM_PROVIDER_PAGE)).toContain(
      `Base URL: ${IN_CLUSTER_VLLM_BASE_URL}\n`,
    );
  });

  test.each(PRIVATE_ADDRESS_SWITCHES)(
    "with %s=true, a project's own provider cannot reach the in-cluster vLLM",
    async (variable: string) => {
      process.env[variable] = "true";
      resolveToClusterIp();
      const post: ReturnType<typeof jest.spyOn> = refuseEveryRequest();

      await expect(
        completeWith(IN_CLUSTER_VLLM_BASE_URL, false),
      ).rejects.toThrow(UNREACHABLE_REFUSAL);

      expect(post).not.toHaveBeenCalled();
    },
  );

  test.each(PRIVATE_ADDRESS_SWITCHES)(
    "with %s=true, a Global LLM Provider reaches the in-cluster vLLM",
    async (variable: string) => {
      process.env[variable] = "true";
      resolveToClusterIp();
      const post: ReturnType<typeof jest.spyOn> = mockOpenAICompatibleReply();

      await completeWith(IN_CLUSTER_VLLM_BASE_URL, true);

      expect(post).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["http://127.0.0.1:8000/v1", "http://169.254.169.254/v1"])(
    "a Global LLM Provider is refused %s all the same",
    async (baseUrl: string) => {
      const post: ReturnType<typeof jest.spyOn> = refuseEveryRequest();

      await expect(completeWith(baseUrl, true)).rejects.toThrow(
        ADDRESS_REFUSAL,
      );

      expect(post).not.toHaveBeenCalled();
    },
  );

  test("the chart's outboundConnections.blockPrivateNetwork sets DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES", () => {
    const helpers: string = fs.readFileSync(
      path.join(CHART_DIR, "templates/_helpers.tpl"),
      "utf8",
    );

    expect(helpers).toMatch(
      /- name: DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES\n\s*value: .*\(\$\.Values\.outboundConnections\)\.blockPrivateNetwork\b/,
    );
  });

  test("the Admin Dashboard creates Global LLM Providers under Settings > Global LLM Providers", () => {
    const page: string = fs.readFileSync(
      path.join(PACKAGES_ROOT, ADMIN_LLM_PROVIDERS_PAGE),
      "utf8",
    );
    const settings: number = page.indexOf('t("breadcrumbs.settings")');

    expect(settings).toBeGreaterThan(-1);
    expect(page.indexOf('t("breadcrumbs.globalLlmProviders")')).toBeGreaterThan(
      settings,
    );
    expect(page).toContain("item.isGlobalLlm = true;");
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s says so where it names the switch, and in the manual vLLM steps",
    (language: string) => {
      const markdown: string = readPage(language, LLM_PROVIDER_PAGE);
      const switchParagraphs: Array<string> = markdown
        .split("\n")
        .filter((line: string): boolean => {
          return (
            line.includes("`DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`") &&
            line.includes("`fc00::/7`")
          );
        });
      const globalProvidersPage: string = [
        adminDashboardLabel(language, "breadcrumbs.settings"),
        adminDashboardLabel(language, "breadcrumbs.globalLlmProviders"),
      ]
        .map((label: string): string => {
          return `**${label}**`;
        })
        .join(" > ");
      const steps: string = manualVllmSteps(markdown);

      expect(switchParagraphs).toHaveLength(1);
      expect(switchParagraphs[0]).toContain("`GLOBAL_LLM_PROVIDER_*`");

      for (const fact of [
        "`DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`",
        "`outboundConnections.blockPrivateNetwork: true`",
        globalProvidersPage,
      ]) {
        expect({ fact, inSteps: steps.includes(fact) }).toEqual({
          fact,
          inSteps: true,
        });
      }
    },
  );
});

describe("the refusals the guide quotes are the ones an LLM request raises", () => {
  startEachTestOnSelfHostedEgressPolicy();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a loopback Base URL", async () => {
    const post: ReturnType<typeof jest.spyOn> = refuseEveryRequest();

    await expect(
      LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.Ollama,
          baseUrl: "http://127.0.0.1:11434",
          modelName: "llama3.1",
        },
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(ADDRESS_REFUSAL);

    expect(post).not.toHaveBeenCalled();
  });

  test("on OneUptime Cloud, a host name that resolves to a private address", async () => {
    process.env["BILLING_ENABLED"] = "true";
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "10.0.0.12", family: 4 }] as never);
    const post: ReturnType<typeof jest.spyOn> = refuseEveryRequest();

    await expect(
      LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.Ollama,
          baseUrl: "http://ollama:11434",
          modelName: "llama3.1",
        },
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(UNREACHABLE_REFUSAL);

    expect(post).not.toHaveBeenCalled();
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s quotes both",
    (language: string) => {
      const markdown: string = readPage(language, LLM_PROVIDER_PAGE);

      expect(markdown).toContain(`"…${ADDRESS_REFUSAL}"`);
      expect(markdown).toContain(`"…${UNREACHABLE_REFUSAL}"`);
    },
  );
});

describe("the num_ctx advice is what LLMService sends to Ollama", () => {
  startEachTestOnSelfHostedEgressPolicy();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s shows the same Additional Parameters",
    (language: string) => {
      const markdown: string = readPage(language, LLM_PROVIDER_PAGE);

      expect(markdown).toContain(NUM_CTX_EXAMPLE);
      expect(markdown).toContain("`OLLAMA_CONTEXT_LENGTH`");
    },
  );

  test("those Additional Parameters raise num_ctx and keep the other Ollama options", async () => {
    const post: ReturnType<typeof jest.spyOn> = mockOllamaReply();

    // A private address, which a self-hosted install reaches.
    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.Ollama,
        baseUrl: "http://10.0.0.12:11434",
        modelName: "llama3.1",
      },
      messages: [{ role: "user", content: "which incidents are active?" }],
      maxTokens: 512,
      additionalParams: JSON.parse(NUM_CTX_EXAMPLE) as JSONObject,
    });

    const request: { url: { toString: () => string }; data: JSONObject } = post
      .mock.calls[0]![0] as {
      url: { toString: () => string };
      data: JSONObject;
    };
    const options: JSONObject = request.data["options"] as JSONObject;

    expect(request.url.toString()).toBe("http://10.0.0.12:11434/api/chat");
    expect(options["num_ctx"]).toBe(LLMService.RECOMMENDED_OLLAMA_NUM_CTX);
    expect(options["temperature"]).toBeDefined();
    expect(options["num_predict"]).toBe(512);
  });
});

describe("the context window errors every guide quotes are the ones OneUptime reports", () => {
  startEachTestOnSelfHostedEgressPolicy();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // What an agent conversation gets back once Ollama has dropped its question.
  async function ollamaContextWindowError(
    providerError: string,
  ): Promise<string> {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(500, { error: providerError }, {}),
      );
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    try {
      await LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.Ollama,
          baseUrl: "http://10.0.0.12:11434",
          modelName: "qwen3.8",
        },
        messages: [
          { role: "system", content: "You are OneUptime AI." },
          { role: "user", content: "Investigate the incident." },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call_1", name: "query_logs", arguments: {} }],
          },
          { role: "tool", toolCallId: "call_1", content: "log lines" },
        ],
        requestRetries: 0,
      });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    throw new Error("Expected Ollama's refusal to fail the request.");
  }

  test.each([OLLAMA_NO_USER_QUERY, OLLAMA_PROMPT_TOO_LONG])(
    "Ollama's %p is reported with the quoted error and the guide's fix",
    async (providerError: string) => {
      const message: string = await ollamaContextWindowError(providerError);

      expect(message).toContain(`: ${CONTEXT_WINDOW_ERROR}`);
      expect(message).toContain(providerError);
      expect(message).toContain('"num_ctx" under "options"');
      expect(message).toContain(
        `to ${LLMService.RECOMMENDED_OLLAMA_NUM_CTX} or more`,
      );
      expect(message).toContain("OLLAMA_CONTEXT_LENGTH");
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s quotes OneUptime's error and both of Ollama's",
    (language: string) => {
      const markdown: string = readPage(language, LLM_PROVIDER_PAGE);

      expect(markdown).toContain(`"…${CONTEXT_WINDOW_ERROR}"`);
      expect(markdown).toContain(`"${OLLAMA_NO_USER_QUERY}"`);
      expect(markdown).toContain(`"${OLLAMA_PROMPT_TOO_LONG}"`);
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s no longer recommends the num_ctx that was too small for an investigation",
    (language: string) => {
      expect(readPage(language, LLM_PROVIDER_PAGE)).not.toContain("16384");
    },
  );
});

describe("every in-page link in the LLM provider guides reaches a heading", () => {
  const FENCE_LINE: RegExp = /^\s*```/;

  function headingSlugs(markdown: string): Set<string> {
    const slugs: Set<string> = new Set<string>();
    let inFence: boolean = false;

    for (const line of markdown.split("\n")) {
      if (FENCE_LINE.test(line)) {
        inFence = !inFence;
        continue;
      }

      const heading: RegExpMatchArray | null = inFence
        ? null
        : line.match(/^#{1,6}\s+(.*)$/);

      if (heading && heading[1]) {
        slugs.add(slugify(heading[1].trim()));
      }
    }

    return slugs;
  }

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)("%s", (language: string) => {
    const markdown: string = readPage(language, LLM_PROVIDER_PAGE);
    const slugs: Set<string> = headingSlugs(markdown);
    const anchors: Array<string> = [
      ...markdown.matchAll(/\]\(#([^)]+)\)/g),
    ].map((match: RegExpMatchArray): string => {
      return decodeURIComponent(match[1]!);
    });

    expect(anchors.length).toBeGreaterThan(0);

    for (const anchor of anchors) {
      expect({ anchor, known: slugs.has(anchor) }).toEqual({
        anchor,
        known: true,
      });
    }
  });
});

describe("the in-cluster vLLM Base URL in every language is the one the Helm chart registers", () => {
  const helpers: string = fs.readFileSync(
    path.join(CHART_DIR, "templates/_helpers.tpl"),
    "utf8",
  );
  const values: {
    global: { clusterDomain: string };
    vllm: { ports: { http: number } };
  } = jsYaml.load(
    fs.readFileSync(path.join(CHART_DIR, "values.yaml"), "utf8"),
  ) as { global: { clusterDomain: string }; vllm: { ports: { http: number } } };

  const template: RegExpMatchArray | null = helpers.match(
    /- name: GLOBAL_LLM_PROVIDER_BASE_URL\n\s*value: (.+)/,
  );

  // What the chart registers, with the release and namespace left as the guide writes them.
  const registeredBaseUrl: string = (template?.[1] || "")
    .replace("{{ $.Release.Name }}", "<release>")
    .replace("{{ $.Release.Namespace }}", "<namespace>")
    .replace("{{ $.Values.global.clusterDomain }}", values.global.clusterDomain)
    .replace("{{ $.Values.vllm.ports.http }}", String(values.vllm.ports.http));

  test("the chart registers vLLM as an OpenAI-compatible provider at its Service DNS name", () => {
    expect(template).not.toBeNull();
    expect(registeredBaseUrl).toBe(
      "http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1",
    );
    expect(helpers).toContain(
      `- name: GLOBAL_LLM_PROVIDER_TYPE\n  value: "${LlmType.OpenAICompatible}"`,
    );
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)("%s", (language: string) => {
    expect(readPage(language, LLM_PROVIDER_PAGE)).toContain(registeredBaseUrl);
  });
});
