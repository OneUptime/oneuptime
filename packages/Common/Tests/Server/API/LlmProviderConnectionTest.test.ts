import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import LlmProviderAPI from "../../../Server/API/LlmProviderAPI";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import LLMService, {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMToolCall,
  LLMToolDefinition,
} from "../../../Server/Utils/LLM/LLMService";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /llm-provider/test is the ONLY verdict an operator ever gets on an LLM
 * provider before they hand it to the product. It used to answer a narrower
 * question than the one the operator is actually asking: it sent a bare
 * "Reply with the word: OK" prompt, and certified any provider that replied.
 *
 * Every OneUptime AI feature — Ask AI, investigations, the agent loops — reads
 * the user's data EXCLUSIVELY through tools. A model or endpoint that holds a
 * conversation but cannot call a tool is therefore unusable for all of them,
 * and it passed this test with a clean "Connection successful." The operator
 * left believing AI worked; the way they found out otherwise was a user asking
 * Ask AI a question and being told the assistant has no tool for it (issue
 * #3552 is exactly that complaint, reported as a missing feature rather than a
 * misconfigured provider).
 *
 * So the route now offers the model a trivial tool and reports whether it
 * called it. Three things about that are load-bearing and are what this file
 * pins:
 *
 *   1. The probe REALLY OFFERS A TOOL — the request that reaches
 *      LLMService.getCompletion carries a non-empty `tools` array. Without
 *      that the rest is theatre.
 *   2. A tool-blind provider is a WARNING, NEVER A FAILURE. Refusing to
 *      certify it would break a setup that works fine for everything except
 *      tool calling; saying nothing puts the operator back in #3552.
 *   3. A provider that REJECTS the `tools` field outright still gets its
 *      original verdict. Some OpenAI-compatible backends 400 on an unknown
 *      field, and this button must not start reporting "connection failed" for
 *      a provider whose key, model and base URL are all correct.
 *
 * The handler is driven directly off the mock router's recorded route (the
 * pattern used by AIChatRouteAuthorization / AIGenerationProjectAIToggle):
 * Express and Response are module-mocked, so the response body is read off the
 * Response call rather than off a socket. LlmProviderService.findOneById is
 * stubbed so no database is touched.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const TEST_ROUTE: string = "/llm-provider/test";

const PROVIDER_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

/*
 * The name of the probe tool, as the route both SENDS it and LOOKS FOR IT in
 * the reply. It is a contract between the two halves of the handler, so it is
 * written out here rather than read back off the request: a rename that
 * updated only the outgoing definition would leave every real provider
 * reported as tool-blind, and this constant is what catches that.
 */
const PROBE_TOOL_NAME: string = "connection_test_ping";

/*
 * The verdict the route used to return for EVERY reachable provider, tool
 * calling or not. Asserted against as a negative: a tool-blind provider must
 * no longer be sent away with this.
 */
const PRE_FIX_SUCCESS_MESSAGE: string =
  "Connection successful. The LLM provider responded to a test prompt.";

const PROVIDER_ERROR_MESSAGE: string =
  "Incorrect API key provided: sk-****. You can find your API key at https://example.invalid/keys.";

let getCompletionSpy: jest.SpyInstance;
let providerLookupSpy: jest.SpyInstance;

/*
 * A perfectly ordinary project-scoped provider: readable by the caller, not
 * global (so the master-admin gate is not what decides anything here), and
 * complete enough to be worth testing.
 */
function providerRow(): LlmProvider {
  const provider: LlmProvider = new LlmProvider(PROVIDER_ID);
  provider.projectId = PROJECT_ID;
  provider.isGlobalLlm = false;
  provider.llmType = LlmType.OpenAI;
  provider.apiKey = "sk-connection-test";
  provider.baseUrl = "https://example.invalid/v1";
  provider.modelName = "gpt-connection-test";
  return provider;
}

function callerProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };
}

// A completion the provider could plausibly have returned, with or without a tool call.
function completion(toolCalls?: Array<LLMToolCall>): LLMCompletionResponse {
  return {
    content: "OK",
    ...(toolCalls ? { toolCalls: toolCalls } : {}),
    usage: undefined,
  };
}

function probeToolCall(name: string): LLMToolCall {
  return {
    id: "call_1",
    name: name,
    arguments: {},
  };
}

type RouteCall = {
  thrown: unknown;
  nextCallCount: number;
};

async function callTestRoute(body?: JSONObject): Promise<RouteCall> {
  const req: ExpressRequest = {
    body: body || { llmProviderId: PROVIDER_ID.toString() },
    headers: {},
    params: {},
    query: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {} as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", TEST_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

function sentPayload(): JSONObject {
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  return send.mock.calls[0]![2] as JSONObject;
}

function sentError(): Exception {
  const send: jest.Mock = Response.sendErrorResponse as unknown as jest.Mock;
  return send.mock.calls[0]![2] as Exception;
}

function sentMessage(): string {
  return sentPayload()["message"] as string;
}

// Every request the handler put on the wire, in order.
function completionRequests(): Array<LLMCompletionRequest> {
  return getCompletionSpy.mock.calls.map(
    (call: Array<unknown>): LLMCompletionRequest => {
      return call[0] as LLMCompletionRequest;
    },
  );
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new LlmProviderAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(callerProps());

  /*
   * The handler reads the provider twice — once with the caller's props as an
   * access check, once as root for the decrypted key. Both are stubbed with
   * the same row so nothing reaches Postgres.
   */
  providerLookupSpy = getJestSpyOn(LlmProviderService, "findOneById");
  providerLookupSpy.mockImplementation(async (): Promise<LlmProvider> => {
    return providerRow();
  });

  getCompletionSpy = getJestSpyOn(LLMService, "getCompletion");
  getCompletionSpy.mockResolvedValue(
    completion([probeToolCall(PROBE_TOOL_NAME)]),
  );

  // The fallback paths log the provider's error; keep the test output clean.
  getJestSpyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /llm-provider/test - the probe actually exercises tool calling", () => {
  test("the test completion is sent with a non-empty tools array", async () => {
    /*
     * The bug this whole change exists for: the connection test asked the
     * provider a question that any chat endpoint can answer, and therefore
     * could not tell a provider that works for Ask AI from one that does not.
     * A probe with no `tools` on the request measures nothing.
     */
    await callTestRoute();

    const requests: Array<LLMCompletionRequest> = completionRequests();

    expect(requests.length).toBeGreaterThan(0);

    const tools: Array<LLMToolDefinition> = requests[0]!
      .tools as Array<LLMToolDefinition>;

    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    expect(
      tools.map((tool: LLMToolDefinition): string => {
        return tool.name;
      }),
    ).toContain(PROBE_TOOL_NAME);
  });

  test("the probe leaves room in the output budget for a tool call", async () => {
    /*
     * The old prompt only had to fit the word "OK", so the cap was 16 tokens.
     * A tool call is a JSON payload with a name and an argument object; capped
     * at 16 tokens the provider gets cut off mid-call and a perfectly capable
     * model is reported as tool-blind. The exact number is not the contract —
     * "more than the old one-word budget" is.
     */
    await callTestRoute();

    expect(completionRequests()[0]!.maxTokens).toBeGreaterThan(16);

    /*
     * And past reasoning overhead: on gpt-5/o-series the thinking tokens are
     * billed against this same cap, so a tight budget makes a fully capable
     * provider stop at "length" with nothing emitted and get reported as
     * unverified.
     */
    expect(completionRequests()[0]!.maxTokens).toBeGreaterThanOrEqual(1024);
  });
});

describe("POST /llm-provider/test - verdict when the model calls the tool", () => {
  test("reports supportsToolCalling true and says tool calling was used", async () => {
    getCompletionSpy.mockResolvedValue(
      completion([probeToolCall(PROBE_TOOL_NAME)]),
    );

    await callTestRoute();

    const payload: JSONObject = sentPayload();

    expect(payload["success"]).toBe(true);
    expect(payload["supportsToolCalling"]).toBe(true);
    expect(sentMessage()).toMatch(/tool calling/i);
    expect(sentMessage()).not.toMatch(/did not/i);
    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
  });

  test("a tool call for some other tool does not count as tool calling", async () => {
    /*
     * The check is "did it call THE TOOL WE OFFERED", not "did it emit
     * something in the tool-calls field". A provider echoing an unrelated or
     * hallucinated tool name has not demonstrated the capability, and
     * accepting it would put the operator right back in #3552.
     */
    getCompletionSpy.mockResolvedValue(
      completion([probeToolCall("some_other_tool")]),
    );

    await callTestRoute();

    expect(sentPayload()["success"]).toBe(true);
    expect(sentPayload()["supportsToolCalling"]).toBe(false);
  });
});

describe("POST /llm-provider/test - verdict when the model ignores the tool", () => {
  test("still succeeds, but flags the missing capability", async () => {
    /*
     * A tool-blind provider must NOT be rejected: its key, model and base URL
     * may be entirely correct, and this button is also how an operator checks
     * those. But it must not be waved through with the old bare
     * "Connection successful." either — that sentence is precisely what let
     * #3552 reach a user.
     */
    getCompletionSpy.mockResolvedValue(completion());

    await callTestRoute();

    const payload: JSONObject = sentPayload();

    expect(payload["success"]).toBe(true);
    expect(payload["supportsToolCalling"]).toBe(false);

    expect(sentMessage()).not.toBe(PRE_FIX_SUCCESS_MESSAGE);
    expect(sentMessage()).toMatch(/tool calling could not be verified/i);
    expect(sentMessage()).toMatch(/answered in prose/i);

    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
  });

  test("an empty toolCalls array is treated as no tool call", async () => {
    getCompletionSpy.mockResolvedValue(completion([]));

    await callTestRoute();

    expect(sentPayload()["success"]).toBe(true);
    expect(sentPayload()["supportsToolCalling"]).toBe(false);
  });

  test("a reply cut off at the output cap is reported as truncated, not tool-blind", async () => {
    /*
     * stopReason "length" means the provider stopped generating because it hit
     * maxTokens — the model may have been about to emit the tool call. On a
     * reasoning model the thinking tokens alone can reach the cap. Reporting
     * that as "this model answered in prose instead of calling the tool" would
     * send the operator to replace a model that is perfectly capable, so the
     * verdict has to name what actually happened.
     */
    getCompletionSpy.mockResolvedValue({
      ...completion(),
      stopReason: "length",
    });

    await callTestRoute();

    expect(sentPayload()["success"]).toBe(true);
    expect(sentPayload()["supportsToolCalling"]).toBe(false);
    expect(sentMessage()).toMatch(/output limit/i);
    expect(sentMessage()).not.toMatch(/answered in prose/i);

    /*
     * And it must not send the operator off to replace the model. A reasoning
     * model spends its thinking tokens against this same cap, so "length" is
     * the one no-tool-call outcome that carries no information about the
     * provider's capability.
     */
    expect(sentMessage()).not.toMatch(/support tool\/function calling/i);
  });

  test("a tool call still counts even when the reply was truncated after it", async () => {
    /*
     * The capability is proven by the call itself; where generation stopped
     * afterwards says nothing about it.
     */
    getCompletionSpy.mockResolvedValue({
      ...completion([probeToolCall(PROBE_TOOL_NAME)]),
      stopReason: "length",
    });

    await callTestRoute();

    expect(sentPayload()["supportsToolCalling"]).toBe(true);
    expect(sentMessage()).not.toMatch(/could not be verified/i);
  });
});

describe("POST /llm-provider/test - provider rejects the tools parameter", () => {
  test("falls back to a tool-less prompt and still certifies the connection", async () => {
    /*
     * The regression guard for OpenAI-compatible backends that 400 on an
     * unknown `tools` field. Before the fallback existed, adding the probe
     * would have turned this button from "your provider is fine" into
     * "connection failed" for every one of them — a worse bug than the one
     * being fixed. The retry carries NO tools, otherwise it fails the same way.
     */
    getCompletionSpy
      .mockRejectedValueOnce(
        new BadDataException("Unrecognized request argument supplied: tools"),
      )
      .mockResolvedValueOnce(completion());

    await callTestRoute();

    const requests: Array<LLMCompletionRequest> = completionRequests();

    expect(requests.length).toBe(2);
    expect((requests[0]!.tools || []).length).toBeGreaterThan(0);
    expect(requests[1]!.tools).toBeUndefined();

    const payload: JSONObject = sentPayload();

    expect(payload["success"]).toBe(true);
    expect(payload["supportsToolCalling"]).toBe(false);
    expect(sentMessage()).toMatch(/tool calling could not be verified/i);

    /*
     * The message reports what was OBSERVED — the tool-offering request
     * failed and only the plain prompt got through — rather than asserting
     * WHY. The first call could equally have hit a timeout or a rate limit,
     * and telling an operator their model "rejected the tools parameter"
     * when it did not sends them off to swap a perfectly good model.
     */
    expect(sentMessage()).toMatch(/offered a tool failed/i);

    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
  });

  test("a tool call in the fallback reply cannot fake tool support", async () => {
    /*
     * The fallback offered no tools, so nothing it returns is evidence of tool
     * calling. Reading the flag off the second reply would let a provider that
     * refuses the field entirely be certified as tool-capable.
     */
    getCompletionSpy
      .mockRejectedValueOnce(new BadDataException("tools is not supported"))
      .mockResolvedValueOnce(completion([probeToolCall(PROBE_TOOL_NAME)]));

    await callTestRoute();

    expect(sentPayload()["success"]).toBe(true);
    expect(sentPayload()["supportsToolCalling"]).toBe(false);
  });
});

describe("POST /llm-provider/test - the provider is genuinely unreachable", () => {
  test("both attempts failing still surfaces the provider's own error", async () => {
    /*
     * The original job of this button — telling the operator that their key,
     * model or base URL is wrong, IN THE PROVIDER'S OWN WORDS — has to survive
     * the added probe. It would be easy for the new retry to swallow the
     * second error and report something generic instead. That half is a drift
     * guard: it held before the probe existed and must still hold.
     *
     * The attempt count is not a guard. A genuinely unreachable provider must
     * be tried BOTH ways before it is condemned, otherwise the tool-less
     * fallback is not really a fallback.
     */
    getCompletionSpy.mockRejectedValue(
      new BadDataException(PROVIDER_ERROR_MESSAGE),
    );

    const call: RouteCall = await callTestRoute();

    expect(call.nextCallCount).toBe(0);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();

    const error: Exception = sentError();

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("LLM Provider test failed");
    expect(error.message).toContain(PROVIDER_ERROR_MESSAGE);

    // Both attempts were made before giving up.
    expect(completionRequests().length).toBe(2);
  });

  test("a provider that is not readable by the caller is refused before any completion", async () => {
    /*
     * DRIFT GUARD (passes before and after the fix). The access check runs
     * ahead of the probe, so the added tool call must not become a way to make
     * the platform talk to a provider the caller cannot read.
     */
    providerLookupSpy.mockResolvedValue(null);

    await callTestRoute();

    expect(getCompletionSpy).not.toHaveBeenCalled();
    expect(sentError()).toBeInstanceOf(BadDataException);
  });
});
