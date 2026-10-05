import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LlmType from "Common/Types/LLM/LlmType";
import API from "Common/Utils/API";
import LLMService from "Common/Server/Utils/LLM/LLMService";
import { startEachTestOnSelfHostedEgressPolicy } from "Common/Tests/Server/Utils/EgressPolicyEnvironment";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import dns from "dns";
import fs from "fs";
import path from "path";

/*
 * The private network access guide's "Other outbound connections" section,
 * against LLMService, in every language the guide is written in.
 *
 * The section lists LLM providers among the connections
 * DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES refuses the private tier for, and that
 * switch is always on with BILLING_ENABLED=true. LLMService exempts a Global
 * LLM Provider no project owns, whose Base URL an administrator set
 * (LLMServiceGlobalProviderEgress.test.ts pins that for every wire format), so
 * the Helm chart's bundled vLLM keeps working with either switch on. The guide
 * says so right after the switch. These hold that paragraph to the switch it
 * qualifies, to the places it says a Global LLM Provider is configured, and to
 * what LLMService lets through and refuses.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_ROOT, "..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const CHART_HELPERS: string = path.join(
  REPOSITORY_ROOT,
  "HelmChart/Public/oneuptime/templates/_helpers.tpl",
);

const PRIVATE_NETWORK_ACCESS_PAGE: string =
  "self-hosted/private-network-access.md";

// Where GLOBAL_LLM_PROVIDER_* become a provider at startup.
const GLOBAL_LLM_PROVIDER_SEED: string =
  "App/FeatureSet/Workers/StartupMigrations/SeedGlobalLlmProviderFromEnv.ts";

// Where the Admin Dashboard lists Global LLM Providers, and its labels.
const ADMIN_LLM_PROVIDERS_PAGE: string =
  "App/FeatureSet/AdminDashboard/src/Pages/Settings/LlmProviders/Index.tsx";
const ADMIN_DASHBOARD_LOCALES_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/AdminDashboard/src/Locales",
);

// The guide quotes the dashboards in English in these languages.
const ENGLISH_LABEL_LANGUAGES: Array<string> = ["en", "fa"];

// How each language's guide names the ranges that stay refused.
const STILL_REFUSED: Record<string, string> = {
  en: "loopback and link-local",
  fa: "بازگشتی و محلی-پیوند",
};

// The switch, as the guide sets it in config.env and in the Helm values.
const SWITCH_IN_CONFIG_ENV: string =
  "```\nDATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true\n```";
const SWITCH_IN_HELM_VALUES: string =
  "outboundConnections:\n  blockPrivateNetwork: true\n";

// The two settings that refuse private addresses, as the guard reads them.
const PRIVATE_ADDRESS_SWITCHES: Array<string> = [
  "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES",
  "BILLING_ENABLED",
];

// The chart's bundled vLLM, and a ClusterIP its Service name resolves to.
const BUNDLED_VLLM_BASE_URL: string =
  "http://oneuptime-vllm.oneuptime.svc.cluster.local:8000/v1";
const VLLM_CLUSTER_IP: string = "10.96.14.21";

// Loopback and link-local, the cloud metadata endpoint among them.
const LOOPBACK_AND_LINK_LOCAL_BASE_URLS: Array<string> = [
  "http://127.0.0.1:8000/v1",
  "http://[::1]:8000/v1",
  "http://169.254.169.254/v1",
  "http://[fe80::1]:8000/v1",
];

// The tails of LLMService's refusals.
const ADDRESS_REFUSAL: string =
  "points to an address OneUptime is not allowed to connect to";
const UNREACHABLE_REFUSAL: string = "could not be reached";

const LANGUAGES_WITH_PAGE: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return fs.existsSync(
      path.join(CONTENT_DIR, language, PRIVATE_NETWORK_ACCESS_PAGE),
    );
  },
);

function readPage(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, PRIVATE_NETWORK_ACCESS_PAGE),
    "utf8",
  );
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relativePath), "utf8");
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

describe("the guide says, right after the switch, that a Global LLM Provider is exempt", () => {
  test("every language the guide is written in says how it names loopback and link-local", () => {
    expect(LANGUAGES_WITH_PAGE).toEqual(Object.keys(STILL_REFUSED));
  });

  test.each(LANGUAGES_WITH_PAGE)("%s", (language: string) => {
    const markdown: string = readPage(language);
    const paragraphs: Array<string> = markdown
      .split("\n")
      .filter((line: string): boolean => {
        return line.includes("`GLOBAL_LLM_PROVIDER_*`");
      });
    const globalProvidersPage: string = [
      adminDashboardLabel(language, "breadcrumbs.settings"),
      adminDashboardLabel(language, "breadcrumbs.globalLlmProviders"),
    ]
      .map((label: string): string => {
        return `**${label}**`;
      })
      .join(" > ");

    expect(paragraphs).toHaveLength(1);

    const paragraph: string = paragraphs[0]!;

    for (const fact of [
      "`vllm.globalProvider`",
      adminDashboardLabel(language, "breadcrumbs.adminDashboard"),
      globalProvidersPage,
      STILL_REFUSED[language]!,
    ]) {
      expect({ fact, inParagraph: paragraph.includes(fact) }).toEqual({
        fact,
        inParagraph: true,
      });
    }

    // Between the switch's config.env line and its Helm values.
    const at: number = markdown.indexOf(paragraph);

    expect(markdown.indexOf(SWITCH_IN_CONFIG_ENV)).toBeGreaterThan(-1);
    expect(markdown.indexOf(SWITCH_IN_CONFIG_ENV)).toBeLessThan(at);
    expect(markdown.indexOf(SWITCH_IN_HELM_VALUES)).toBeGreaterThan(at);
  });
});

describe("what the paragraph says is what LLMService does", () => {
  startEachTestOnSelfHostedEgressPolicy();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(PRIVATE_ADDRESS_SWITCHES)(
    "with %s=true, a project's own provider cannot reach the bundled vLLM",
    async (variable: string) => {
      process.env[variable] = "true";
      resolveToClusterIp();
      const post: ReturnType<typeof jest.spyOn> = refuseEveryRequest();

      await expect(completeWith(BUNDLED_VLLM_BASE_URL, false)).rejects.toThrow(
        UNREACHABLE_REFUSAL,
      );

      expect(post).not.toHaveBeenCalled();
    },
  );

  test.each(PRIVATE_ADDRESS_SWITCHES)(
    "with %s=true, a Global LLM Provider still reaches it",
    async (variable: string) => {
      process.env[variable] = "true";
      resolveToClusterIp();
      const post: ReturnType<typeof jest.spyOn> = mockOpenAICompatibleReply();

      await completeWith(BUNDLED_VLLM_BASE_URL, true);

      expect(post).toHaveBeenCalledTimes(1);

      const request: { url: { toString: () => string } } = post.mock
        .calls[0]![0] as { url: { toString: () => string } };

      expect(request.url.toString()).toBe(
        `${BUNDLED_VLLM_BASE_URL}/chat/completions`,
      );
    },
  );

  test.each(LOOPBACK_AND_LINK_LOCAL_BASE_URLS)(
    "with the switch on, a Global LLM Provider is refused %s all the same",
    async (baseUrl: string) => {
      process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] = "true";
      const post: ReturnType<typeof jest.spyOn> = refuseEveryRequest();

      await expect(completeWith(baseUrl, true)).rejects.toThrow(
        ADDRESS_REFUSAL,
      );

      expect(post).not.toHaveBeenCalled();
    },
  );
});

describe("the places the paragraph names configure a Global LLM Provider no project owns", () => {
  test("the Helm chart's vllm.globalProvider registers the bundled vLLM through GLOBAL_LLM_PROVIDER_*", () => {
    expect(fs.readFileSync(CHART_HELPERS, "utf8")).toMatch(
      /\{\{- if and \$\.Values\.vllm\.enabled \$\.Values\.vllm\.globalProvider\.enabled \}\}\n- name: GLOBAL_LLM_PROVIDER_NAME\n/,
    );
  });

  test("GLOBAL_LLM_PROVIDER_* seed a global provider without a project", () => {
    const seed: string = readSource(GLOBAL_LLM_PROVIDER_SEED);

    expect(seed).toContain('process.env["GLOBAL_LLM_PROVIDER_TYPE"]');
    expect(seed).toContain("provider.isGlobalLlm = true;");
    expect(seed).not.toMatch(/projectId\s*[:=]/);
  });

  test("the Admin Dashboard adds one under Settings > Global LLM Providers, without a project", () => {
    const page: string = readSource(ADMIN_LLM_PROVIDERS_PAGE);
    const breadcrumbs: Array<number> = [
      'title: t("breadcrumbs.adminDashboard")',
      'title: t("breadcrumbs.settings")',
      'title: t("breadcrumbs.globalLlmProviders")',
    ].map((breadcrumb: string): number => {
      return page.indexOf(breadcrumb);
    });

    expect(breadcrumbs[0]).toBeGreaterThan(-1);
    expect(breadcrumbs[1]).toBeGreaterThan(breadcrumbs[0]!);
    expect(breadcrumbs[2]).toBeGreaterThan(breadcrumbs[1]!);
    expect(page).toContain("item.isGlobalLlm = true;");
    expect(page).not.toMatch(/item\.projectId\s*=/);
  });
});
