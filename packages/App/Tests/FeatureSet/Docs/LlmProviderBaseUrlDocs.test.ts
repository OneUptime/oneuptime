import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LlmType from "Common/Types/LLM/LlmType";
import API from "Common/Utils/API";
import DataSourceEgressGuard, {
  AddressVerdict,
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import LLMService from "Common/Server/Utils/LLM/LLMService";
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
 * install; hold the guide's account of the policy, and the refusals it
 * quotes, to the guard and LLMService; and hold its in-cluster vLLM URL and
 * num_ctx advice to the Helm chart and the Ollama request that make them
 * true.
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

// The Additional Parameters every language's guide shows for Ollama.
const NUM_CTX_EXAMPLE: string = '{ "options": { "num_ctx": 16384 } }';

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
    expect(options["num_ctx"]).toBe(16384);
    expect(options["temperature"]).toBeDefined();
    expect(options["num_predict"]).toBe(512);
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
