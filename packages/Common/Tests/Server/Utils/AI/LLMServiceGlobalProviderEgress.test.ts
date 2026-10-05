import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import ObjectID from "../../../../Types/ObjectID";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../../Types/Exception/EgressGuardException";
import LLMService from "../../../../Server/Utils/LLM/LLMService";
import AIService from "../../../../Server/Services/AIService";
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
 * Every LLM request goes through the egress guard, and the guard refuses
 * private addresses wherever shouldBlockPrivateAddresses() is true:
 * BILLING_ENABLED=true, or DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true
 * (outboundConnections.blockPrivateNetwork in the chart). Nothing on the way
 * tells the guard that this provider is a global one, which only a master
 * admin or the operator's environment can configure.
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

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

let lookupSpy: LookupSpy;
let postSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
  lookupSpy.mockImplementation((hostname: string) => {
    if (hostname === BUNDLED_VLLM_HOST) {
      return Promise.resolve([{ address: VLLM_CLUSTER_IP, family: 4 }]);
    }

    return Promise.reject(new Error(`unexpected lookup of ${hostname}`));
  });

  postSpy = jest.spyOn(API, "post").mockResolvedValue({
    jsonData: {
      choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  } as unknown as HTTPResponse<JSONObject>) as ReturnType<typeof jest.spyOn>;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function completeAgainstBundledVllm(): ReturnType<
  typeof LLMService.getCompletion
> {
  return LLMService.getCompletion({
    // Keyless, like the chart's default (vllm.apiKey is empty).
    llmProviderConfig: {
      llmType: LlmType.OpenAICompatible,
      baseUrl: BUNDLED_VLLM_BASE_URL,
      modelName: VLLM_MODEL,
    },
    messages: [{ role: "user", content: "hi" }],
    requestRetries: 0,
  });
}

async function expectUnreachableRefusal(call: Promise<unknown>): Promise<void> {
  const error: unknown = await call.then(
    () => {
      throw new Error("Expected the request to be refused.");
    },
    (refusal: unknown) => {
      return refusal;
    },
  );

  expect(error).toBeInstanceOf(EgressGuardException);
  expect((error as EgressGuardException).reason).toBe(
    EgressFailureReason.Unreachable,
  );
  expect((error as EgressGuardException).message).toBe(UNREACHABLE_REFUSAL);
}

describe("the bundled vLLM Global LLM Provider at LLMService", () => {
  startEachTestOnSelfHostedEgressPolicy();

  test("is reached on a self-hosted install with billing off, pinned to its ClusterIP", async () => {
    const completion: Awaited<ReturnType<typeof LLMService.getCompletion>> =
      await completeAgainstBundledVllm();

    expect(completion.content).toBe("OK");
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(lookupSpy).toHaveBeenCalledWith(BUNDLED_VLLM_HOST, { all: true });
  });

  test("is refused as unreachable once BILLING_ENABLED=true, and nothing is sent", async () => {
    process.env["BILLING_ENABLED"] = "true";

    await expectUnreachableRefusal(completeAgainstBundledVllm());

    expect(postSpy).not.toHaveBeenCalled();
  });

  test("is refused the same way by outboundConnections.blockPrivateNetwork with billing off", async () => {
    process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] = "true";

    await expectUnreachableRefusal(completeAgainstBundledVllm());

    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe("the bundled vLLM Global LLM Provider through AIService.executeWithLogging", () => {
  startEachTestOnSelfHostedEgressPolicy();

  // The row SeedGlobalLlmProviderFromEnv writes for the chart's env vars.
  function seededGlobalProvider(): LlmProvider {
    return {
      id: new ObjectID("00000000-0000-0000-0000-000000000001"),
      name: "OneUptime AI",
      llmType: LlmType.OpenAICompatible,
      baseUrl: BUNDLED_VLLM_BASE_URL,
      modelName: VLLM_MODEL,
      isGlobalLlm: true,
      // The seed leaves the token cost at its default, so nothing is billed.
      costPerMillionTokensInUSDCents: 0,
    } as unknown as LlmProvider;
  }

  test("a project with AI credits still cannot use it when billing is enabled", async () => {
    process.env["BILLING_ENABLED"] = "true";

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: ObjectID.generate(),
      enableAi: true,
      aiCurrentBalanceInUSDCents: 10_000,
    } as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getProviderForChat")
      .mockResolvedValue(seededGlobalProvider());
    const createLog: ReturnType<typeof jest.spyOn> = jest
      .spyOn(LlmLogService, "create")
      .mockResolvedValue(new LlmLog()) as ReturnType<typeof jest.spyOn>;

    await expectUnreachableRefusal(
      AIService.executeWithLogging({
        projectId: ObjectID.generate(),
        // An interactive feature, so no autonomous budget applies.
        feature: "Observability Chat",
        messages: [{ role: "user", content: "which incidents are active?" }],
        requestRetries: 0,
      }),
    );

    expect(postSpy).not.toHaveBeenCalled();

    const loggedFailure: LlmLog = (
      createLog.mock.calls[0]![0] as { data: LlmLog }
    ).data;

    expect(loggedFailure.isGlobalProvider).toBe(true);
    expect(loggedFailure.statusMessage).toBe(UNREACHABLE_REFUSAL);
  });
});
