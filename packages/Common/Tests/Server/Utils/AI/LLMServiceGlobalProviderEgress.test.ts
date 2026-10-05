import API, { RequestOptions } from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LlmLogStatus from "../../../../Types/LlmLogStatus";
import ObjectID from "../../../../Types/ObjectID";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../../Types/Exception/EgressGuardException";
import LLMService, {
  LLMCompletionResponse,
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import LlmLogService from "../../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../Server/Services/ProjectService";
import LlmLog from "../../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../Models/DatabaseModels/Project";
import { startEachTestOnSelfHostedEgressPolicy } from "../EgressPolicyEnvironment";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";

/*
 * The Helm chart's bundled vLLM, as the chart registers it: a Global LLM
 * Provider of type OpenAICompatible at the vLLM Service's cluster DNS name
 * (oneuptime.env.globalLlmProvider in templates/_helpers.tpl). That name
 * resolves to the Service's ClusterIP, which is a private address.
 *
 * The egress guard refuses private addresses wherever
 * shouldBlockPrivateAddresses() is true: BILLING_ENABLED=true, or
 * DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true (outboundConnections.
 * blockPrivateNetwork in the chart). That refusal exists because a project
 * member can repoint a project's provider at the internal network. Nobody in a
 * project can choose where a global provider points, so a global provider no
 * project owns is exempt — and the chart's promise that the bundled vLLM
 * serves every project holds on a billing-enabled install too.
 *
 * What this pins, on both sides of that line:
 *  - a global provider reaches a private address under either switch, still
 *    pinned to the address that was checked and with redirects refused;
 *  - a project-owned provider at the very same address is still refused, and
 *    so is a global row that a project owns;
 *  - the exemption is the private tier only: loopback, link-local, cloud
 *    metadata and the rest of the always-refused ranges stay refused for a
 *    global provider too.
 *
 * DNS is mocked so the ClusterIP is deterministic and nothing leaves the
 * machine.
 */

// What the chart renders for release "oneuptime" in namespace "oneuptime".
const BUNDLED_VLLM_BASE_URL: string =
  "http://oneuptime-vllm.oneuptime.svc.cluster.local:8000/v1";
const BUNDLED_VLLM_HOST: string = "oneuptime-vllm.oneuptime.svc.cluster.local";

// A ClusterIP in the kubeadm default Service range, 10.96.0.0/12.
const VLLM_CLUSTER_IP: string = "10.96.14.21";

const VLLM_MODEL: string = "Qwen/Qwen2.5-1.5B-Instruct";

const UNREACHABLE_REFUSAL: string =
  "OpenAICompatible API request failed: the LLM provider could not be reached.";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

// The two switches that refuse private addresses, as the guard reads them.
const PRIVATE_BLOCKING_POLICIES: Array<[string, string]> = [
  ["billing.enabled", "BILLING_ENABLED"],
  [
    "outboundConnections.blockPrivateNetwork",
    "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES",
  ],
];

/*
 * An in-cluster endpoint for each wire format, so every call site of the
 * guard is held to the policy: the OpenAI wire (OpenAI-compatible and Azure),
 * Anthropic and Ollama each validate their own request URL.
 */
const IN_CLUSTER_PROVIDERS: Array<[string, LLMProviderConfig]> = [
  [
    "OpenAI-compatible (the bundled vLLM)",
    {
      llmType: LlmType.OpenAICompatible,
      baseUrl: BUNDLED_VLLM_BASE_URL,
      modelName: VLLM_MODEL,
    },
  ],
  [
    "Azure OpenAI",
    {
      llmType: LlmType.AzureOpenAI,
      apiKey: "azure-key",
      baseUrl:
        "http://azure-gateway.oneuptime.svc.cluster.local/openai/deployments/gpt-4o",
      modelName: "gpt-4o",
    },
  ],
  [
    "Anthropic",
    {
      llmType: LlmType.Anthropic,
      apiKey: "anthropic-key",
      baseUrl: "http://anthropic-gateway.oneuptime.svc.cluster.local/v1",
      modelName: "claude-sonnet-5",
    },
  ],
  [
    "Ollama",
    {
      llmType: LlmType.Ollama,
      baseUrl: "http://ollama.oneuptime.svc.cluster.local:11434",
      modelName: "llama3.1",
    },
  ],
];

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

type PinnedLookup = (
  hostname: string,
  lookupOptions: { all?: boolean },
  callback: (error: Error | null, address: string) => void,
) => void;

let lookupSpy: LookupSpy;
let postSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;

  // Every Service name in the cluster answers with its ClusterIP.
  lookupSpy.mockImplementation((hostname: string) => {
    if (hostname.endsWith(".svc.cluster.local")) {
      return Promise.resolve([{ address: VLLM_CLUSTER_IP, family: 4 }]);
    }

    return Promise.reject(new Error(`unexpected lookup of ${hostname}`));
  });

  // A body each wire format can parse: OpenAI, Anthropic and Ollama.
  postSpy = jest.spyOn(API, "post").mockResolvedValue({
    jsonData: {
      choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      content: [{ type: "text", text: "OK" }],
      message: { content: "OK" },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  } as unknown as HTTPResponse<JSONObject>) as ReturnType<typeof jest.spyOn>;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function complete(config: LLMProviderConfig): Promise<LLMCompletionResponse> {
  return LLMService.getCompletion({
    llmProviderConfig: config,
    messages: [{ role: "user", content: "hi" }],
    requestRetries: 0,
  });
}

// The bundled vLLM as the seeded global provider: keyless, like the chart's default.
function bundledVllm(isGlobalProvider?: boolean): LLMProviderConfig {
  return {
    llmType: LlmType.OpenAICompatible,
    baseUrl: BUNDLED_VLLM_BASE_URL,
    modelName: VLLM_MODEL,
    ...(isGlobalProvider === undefined ? {} : { isGlobalProvider }),
  };
}

function lastPostOptions(): RequestOptions {
  const call: Array<unknown> = postSpy.mock.calls[
    postSpy.mock.calls.length - 1
  ]! as Array<unknown>;

  return (call[0] as { options: RequestOptions }).options;
}

// The address the request's socket dials, read off its pinned agent.
function dialedAddress(
  options: RequestOptions,
  hostname: string,
): Promise<string> {
  const lookup: PinnedLookup = (
    options.httpAgent as unknown as { options: { lookup: PinnedLookup } }
  ).options.lookup;

  return new Promise((resolve: (address: string) => void) => {
    lookup(
      hostname,
      { all: false },
      (_error: Error | null, address: string) => {
        resolve(address);
      },
    );
  });
}

async function refusal(call: Promise<unknown>): Promise<EgressGuardException> {
  const error: unknown = await call.then(
    () => {
      throw new Error("Expected the request to be refused.");
    },
    (thrown: unknown) => {
      return thrown;
    },
  );

  expect(error).toBeInstanceOf(EgressGuardException);

  return error as EgressGuardException;
}

async function expectUnreachableRefusal(call: Promise<unknown>): Promise<void> {
  const error: EgressGuardException = await refusal(call);

  expect(error.reason).toBe(EgressFailureReason.Unreachable);
  expect(error.message).toBe(UNREACHABLE_REFUSAL);
}

describe("a global LLM provider where private addresses are refused", () => {
  startEachTestOnSelfHostedEgressPolicy();

  describe.each(PRIVATE_BLOCKING_POLICIES)(
    "with %s",
    (_switch: string, variable: string) => {
      beforeEach(() => {
        process.env[variable] = "true";
      });

      test("reaches the bundled vLLM at its ClusterIP", async () => {
        const completion: LLMCompletionResponse = await complete(
          bundledVllm(true),
        );

        expect(completion.content).toBe("OK");
        expect(postSpy).toHaveBeenCalledTimes(1);
        expect(lookupSpy).toHaveBeenCalledWith(BUNDLED_VLLM_HOST, {
          all: true,
        });
      });

      test("is still pinned to the address it was checked at, with redirects refused", async () => {
        await complete(bundledVllm(true));

        const options: RequestOptions = lastPostOptions();

        expect(options.doNotFollowRedirects).toBe(true);
        expect(await dialedAddress(options, BUNDLED_VLLM_HOST)).toBe(
          VLLM_CLUSTER_IP,
        );
      });

      test.each(IN_CLUSTER_PROVIDERS)(
        "reaches an in-cluster %s endpoint",
        async (_name: string, config: LLMProviderConfig) => {
          await complete({ ...config, isGlobalProvider: true });

          expect(postSpy).toHaveBeenCalledTimes(1);
        },
      );
    },
  );
});

describe("a project-owned LLM provider where private addresses are refused", () => {
  startEachTestOnSelfHostedEgressPolicy();

  describe.each(PRIVATE_BLOCKING_POLICIES)(
    "with %s",
    (_switch: string, variable: string) => {
      beforeEach(() => {
        process.env[variable] = "true";
      });

      test("is refused at the bundled vLLM's address, and nothing is sent", async () => {
        await expectUnreachableRefusal(complete(bundledVllm()));

        expect(postSpy).not.toHaveBeenCalled();
      });

      test("is refused just the same when it says outright that it is not global", async () => {
        await expectUnreachableRefusal(complete(bundledVllm(false)));

        expect(postSpy).not.toHaveBeenCalled();
      });

      test.each(IN_CLUSTER_PROVIDERS)(
        "is refused at an in-cluster %s endpoint",
        async (_name: string, config: LLMProviderConfig) => {
          const error: EgressGuardException = await refusal(complete(config));

          expect(error.reason).toBe(EgressFailureReason.Unreachable);
          expect(postSpy).not.toHaveBeenCalled();
        },
      );
    },
  );
});

describe("with billing off and no private-network block (self-hosted)", () => {
  startEachTestOnSelfHostedEgressPolicy();

  const providers: Array<[string, boolean | undefined]> = [
    ["a global provider", true],
    ["a project-owned provider", undefined],
  ];

  test.each(providers)(
    "%s reaches the bundled vLLM, as before",
    async (_name: string, isGlobalProvider: boolean | undefined) => {
      const completion: LLMCompletionResponse = await complete(
        bundledVllm(isGlobalProvider),
      );

      expect(completion.content).toBe("OK");
      expect(postSpy).toHaveBeenCalledTimes(1);
    },
  );
});

describe("the exemption opens the private tier and nothing else", () => {
  startEachTestOnSelfHostedEgressPolicy();

  beforeEach(() => {
    process.env["BILLING_ENABLED"] = "true";
  });

  test.each([
    ["loopback", "http://127.0.0.1:8000/v1"],
    ["IPv6 loopback", "http://[::1]:8000/v1"],
    ["the unspecified address", "http://0.0.0.0:8000/v1"],
    ["the link-local cloud metadata endpoint", "http://169.254.169.254/v1"],
    // Inside fc00::/7, the IPv6 private range the exemption does open.
    ["the IPv6 cloud metadata endpoint", "http://[fd00:ec2::254]/v1"],
    ["an IPv4-mapped loopback address", "http://[::ffff:127.0.0.1]:8000/v1"],
  ])(
    "a global provider at %s is refused",
    async (_name: string, baseUrl: string) => {
      const error: EgressGuardException = await refusal(
        complete({ ...bundledVllm(true), baseUrl }),
      );

      expect(error.reason).toBe(EgressFailureReason.AddressBlocked);
      expect(postSpy).not.toHaveBeenCalled();
    },
  );

  test("a global provider whose host name resolves to loopback is refused", async () => {
    lookupSpy.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    await expectUnreachableRefusal(complete(bundledVllm(true)));

    expect(postSpy).not.toHaveBeenCalled();
  });

  test("one refused address among private ones still refuses the host", async () => {
    // The multi-record rule holds: every address must pass, not just one.
    lookupSpy.mockResolvedValue([
      { address: VLLM_CLUSTER_IP, family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);

    await expectUnreachableRefusal(complete(bundledVllm(true)));

    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe("AIService.executeWithLogging decides which providers are global", () => {
  startEachTestOnSelfHostedEgressPolicy();

  let createLog: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    process.env["BILLING_ENABLED"] = "true";

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: PROJECT_ID,
      enableAi: true,
      aiCurrentBalanceInUSDCents: 10_000,
    } as unknown as Project);

    createLog = jest
      .spyOn(LlmLogService, "create")
      .mockResolvedValue(new LlmLog()) as ReturnType<typeof jest.spyOn>;
  });

  /*
   * The row as the provider lookups read it: SeedGlobalLlmProviderFromEnv
   * writes the chart's env vars into a global row with no project, and leaves
   * the token cost at its default, so nothing is billed.
   */
  function providerRow(overrides: Partial<LlmProvider>): LlmProvider {
    return {
      id: new ObjectID("00000000-0000-0000-0000-000000000001"),
      name: "OneUptime AI",
      llmType: LlmType.OpenAICompatible,
      baseUrl: BUNDLED_VLLM_BASE_URL,
      modelName: VLLM_MODEL,
      costPerMillionTokensInUSDCents: 0,
      ...overrides,
    } as unknown as LlmProvider;
  }

  function askAI(provider: LlmProvider): Promise<AILogResponse> {
    jest
      .spyOn(LlmProviderService, "getProviderForChat")
      .mockResolvedValue(provider);

    return AIService.executeWithLogging({
      projectId: PROJECT_ID,
      // An interactive feature, so no autonomous budget applies.
      feature: "Observability Chat",
      messages: [{ role: "user", content: "which incidents are active?" }],
      requestRetries: 0,
    });
  }

  function loggedEntry(): LlmLog {
    return (createLog.mock.calls[0]![0] as { data: LlmLog }).data;
  }

  test("the chart's seeded global provider serves the project", async () => {
    const response: AILogResponse = await askAI(
      providerRow({ isGlobalLlm: true }),
    );

    expect(response.content).toBe("OK");
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(loggedEntry().status).toBe(LlmLogStatus.Success);
    expect(loggedEntry().isGlobalProvider).toBe(true);
  });

  test("a project's own provider at the same address is refused", async () => {
    await expectUnreachableRefusal(
      askAI(providerRow({ isGlobalLlm: false, projectId: PROJECT_ID })),
    );

    expect(postSpy).not.toHaveBeenCalled();
    expect(loggedEntry().status).toBe(LlmLogStatus.Error);
    expect(loggedEntry().statusMessage).toBe(UNREACHABLE_REFUSAL);
  });

  test("a global row that a project owns is refused: that project's members can edit its Base URL", async () => {
    await expectUnreachableRefusal(
      askAI(providerRow({ isGlobalLlm: true, projectId: PROJECT_ID })),
    );

    expect(postSpy).not.toHaveBeenCalled();
  });
});
