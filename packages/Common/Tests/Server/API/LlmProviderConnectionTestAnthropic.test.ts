import { mockRouter } from "./Helpers";
import stubLLMEgressGuard from "../Utils/AI/StubLLMEgressGuard";
import CommonAPI from "../../../Server/API/CommonAPI";
import LlmProviderAPI from "../../../Server/API/LlmProviderAPI";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import LLMService from "../../../Server/Utils/LLM/LLMService";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../Utils/API";
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
 * Issue #4583 reported Test LLM Provider failing on the default Anthropic
 * setup with "`temperature` is deprecated for this model." The route test in
 * LlmProviderConnectionTest.test.ts replaces LLMService.getCompletion with a
 * stub, so it cannot see what goes on the wire. This file runs the route on
 * the real LLMService, with only the HTTP call to Anthropic faked, and holds
 * the button to what an operator with a current Claude model needs from it:
 *
 *  - the probe it sends a current model carries no temperature, so a
 *    correctly configured provider is certified, tool calling included;
 *  - a model that refuses the temperature anyway is certified after one
 *    adapted retry, not reported as a failed connection;
 *  - the provider's Additional Parameters go into the probe;
 *  - a probe that ran out of tokens while thinking is reported as undecided,
 *    and a safety refusal is reported in words, not as "No text content".
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

const PROBE_TOOL_NAME: string = "connection_test_ping";

let postSpy: jest.SpyInstance;
let provider: LlmProvider;

function anthropicProvider(data: {
  modelName?: string;
  additionalParams?: JSONObject;
}): LlmProvider {
  const row: LlmProvider = new LlmProvider(PROVIDER_ID);
  row.projectId = PROJECT_ID;
  row.isGlobalLlm = false;
  row.llmType = LlmType.Anthropic;
  row.apiKey = "sk-ant-connection-test";

  if (data.modelName) {
    row.modelName = data.modelName;
  }

  if (data.additionalParams) {
    row.additionalParams = data.additionalParams;
  }

  return row;
}

function anthropicReply(
  content: Array<JSONObject>,
  stopReason: string,
  extra?: JSONObject,
): HTTPResponse<JSONObject> {
  return {
    jsonData: {
      content: content,
      stop_reason: stopReason,
      usage: { input_tokens: 40, output_tokens: 12 },
      ...(extra || {}),
    },
  } as unknown as HTTPResponse<JSONObject>;
}

function calledTheProbe(): HTTPResponse<JSONObject> {
  return anthropicReply(
    [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "tool_use", id: "toolu_1", name: PROBE_TOOL_NAME, input: {} },
    ],
    "tool_use",
  );
}

function wireBody(callIndex: number): JSONObject {
  return (postSpy.mock.calls[callIndex]![0] as { data: JSONObject }).data;
}

async function callTestRoute(): Promise<void> {
  const req: ExpressRequest = {
    body: { llmProviderId: PROVIDER_ID.toString() },
    headers: {},
    params: {},
    query: {},
  } as unknown as ExpressRequest;

  await mockRouter
    .match("post", TEST_ROUTE)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      jest.fn() as unknown as NextFunction,
    );
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

beforeAll(() => {
  mockRouter.routes.length = 0;
  new LlmProviderAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  LLMService.clearRequestAdaptationCache();
  stubLLMEgressGuard();

  jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps").mockResolvedValue({
    userId: USER_ID,
    tenantId: PROJECT_ID,
  });

  provider = anthropicProvider({});

  getJestSpyOn(LlmProviderService, "findOneById").mockImplementation(
    async (): Promise<LlmProvider> => {
      return provider;
    },
  );

  postSpy = getJestSpyOn(API, "post");

  getJestSpyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  getJestSpyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Test LLM Provider on the default Anthropic setup (issue #4583)", () => {
  test("certifies the provider, tool calling included, in one request without a temperature", async () => {
    postSpy.mockResolvedValue(calledTheProbe());

    await callTestRoute();

    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    expect(sentPayload()["success"]).toBe(true);
    expect(sentPayload()["supportsToolCalling"]).toBe(true);

    expect(postSpy).toHaveBeenCalledTimes(1);

    const body: JSONObject = wireBody(0);

    // Model Name was left blank: the current Sonnet.
    expect(body["model"]).toBe("claude-sonnet-5-5");
    // The route asks for temperature 0; the model would refuse it.
    expect(body["temperature"]).toBeUndefined();
    expect(body["top_p"]).toBeUndefined();
    expect(body["top_k"]).toBeUndefined();
    // The probe still offers its tool.
    expect(
      (body["tools"] as Array<JSONObject>).map((tool: JSONObject): unknown => {
        return tool["name"];
      }),
    ).toEqual([PROBE_TOOL_NAME]);
  });

  test("a model that refuses the temperature anyway is certified after one adapted retry", async () => {
    provider = anthropicProvider({ modelName: "prod-claude-gateway" });

    postSpy
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          400,
          {
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "`temperature` is deprecated for this model.",
            },
          },
          {},
        ),
      )
      .mockResolvedValueOnce(calledTheProbe());

    await callTestRoute();

    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    expect(sentPayload()["success"]).toBe(true);
    // The retry was the same probe, tools and all, not the tool-less fallback.
    expect(sentPayload()["supportsToolCalling"]).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(wireBody(0)["temperature"]).toBe(0);
    expect(wireBody(1)["temperature"]).toBeUndefined();
    expect(wireBody(1)["tools"]).toHaveLength(1);
  });

  test("the provider's Additional Parameters go into the probe, but never over its own fields", async () => {
    provider = anthropicProvider({
      modelName: "claude-opus-5-5",
      additionalParams: {
        output_config: { effort: "low" },
        model: "some-other-model",
        tool_choice: { type: "none" },
      },
    });

    postSpy.mockResolvedValue(calledTheProbe());

    await callTestRoute();

    const body: JSONObject = wireBody(0);

    expect(body["output_config"]).toEqual({ effort: "low" });
    expect(body["model"]).toBe("claude-opus-5-5");
    expect(body["tool_choice"]).toBeUndefined();
    expect(sentPayload()["supportsToolCalling"]).toBe(true);
  });

  test("the probe leaves the model room to think before it calls the tool", async () => {
    postSpy.mockResolvedValue(calledTheProbe());

    await callTestRoute();

    expect(wireBody(0)["max_tokens"]).toBe(
      4096 + LLMService.ANTHROPIC_THINKING_ROOM_TOKENS,
    );
  });
});

describe("Test LLM Provider when a current model's reply is not an answer", () => {
  test("a probe that ran out of tokens while thinking is reported as undecided, not as a failure", async () => {
    postSpy.mockResolvedValue(
      anthropicReply(
        [{ type: "thinking", thinking: "", signature: "sig" }],
        "max_tokens",
      ),
    );

    await callTestRoute();

    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    expect(sentPayload()["success"]).toBe(true);
    expect(sentPayload()["supportsToolCalling"]).toBe(false);
    expect(sentPayload()["message"]).toMatch(/output limit/i);
  });

  test("a safety refusal is reported in words the operator can act on", async () => {
    postSpy.mockResolvedValue(
      anthropicReply([], "refusal", {
        stop_details: { type: "refusal", category: "cyber" },
      }),
    );

    await callTestRoute();

    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();

    const error: Exception = sentError();

    expect(error.message).toContain("LLM Provider test failed");
    expect(error.message).toContain("Anthropic declined this request");
    expect(error.message).toContain("(cyber)");
    expect(error.message).not.toContain("No text content");
  });
});
