/*
 * ---------------------------------------------------------------------------
 * BackendAPI.llmCompletion: one model call of the code agent, made through
 * the OneUptime server for the run this Runner claimed (issue #6441). What
 * matters to the agent is how a call fails: a refusal carries the status
 * the server answered with, and a call that got no answer at all says the
 * server could not be reached - so the agent can tell a failure a repeat
 * gets past (a 429, a 5xx, a restart) from one it never will. Its wait is
 * bounded, and an aborted task gives it up.
 * ---------------------------------------------------------------------------
 */

import BackendAPI, { LlmCompletionResult } from "../../Utils/BackendAPI";
import LlmCompletionError from "../../Utils/LlmCompletionError";
import RunnerAPIRequest from "../../Utils/RunnerAPIRequest";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";

const postMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

interface PostCall {
  url: URL;
  data: JSONObject;
  options: JSONObject;
}

function postCall(): PostCall {
  expect(postMock).toHaveBeenCalledTimes(1);

  return postMock.mock.calls[0]?.[0] as PostCall;
}

async function failure(promise: Promise<unknown>): Promise<LlmCompletionError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmCompletionError);
    return error as LlmCompletionError;
  }

  throw new Error("The call did not fail.");
}

function call(
  extra: {
    timeoutInMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<LlmCompletionResult> {
  return new BackendAPI().llmCompletion({
    taskId: "run-1",
    messages: [{ role: "user", content: "Fix the bug." }],
    tools: [
      {
        name: "read_file",
        description: "Reads a file.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    maxTokens: 8192,
    ...extra,
  });
}

beforeEach(() => {
  postMock.mockReset();
});

describe("a call the server answers", () => {
  test("asks for the run it claimed, and reads the answer, its tool calls and its budget", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          message: {
            content: "Reading it first.",
            toolCalls: [
              { id: "call-1", name: "read_file", arguments: { path: "a.ts" } },
            ],
          },
          budget: {
            completionCallsUsed: 3,
            maxCompletionCalls: 400,
            outputTokensUsed: 900,
            maxOutputTokens: 2_000_000,
          },
        },
        {},
      ),
    );

    const result: LlmCompletionResult = await call();

    expect(postCall().url.toString()).toContain(
      "/api/ai-agent-data/llm-completion",
    );
    expect(postCall().data).toEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      taskId: "run-1",
      messages: [{ role: "user", content: "Fix the bug." }],
      tools: [
        {
          name: "read_file",
          description: "Reads a file.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      maxTokens: 8192,
    });
    expect(result.content).toBe("Reading it first.");
    expect(result.toolCalls).toEqual([
      { id: "call-1", name: "read_file", arguments: { path: "a.ts" } },
    ]);
    // No stop reason sent: a call with tool calls is read as one.
    expect(result.stopReason).toBe("tool_use");
    expect(result.budget.completionCallsUsed).toBe(3);
  });

  test("its wait is bounded, and an abort gives it up - only when asked for", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { message: { content: "Done." } }, {}),
    );
    const controller: AbortController = new AbortController();

    await call({ timeoutInMs: 90_000, signal: controller.signal });

    expect(postCall().options).toEqual(
      RunnerAPIRequest.getDefaultRequestOptions({
        timeout: 90_000,
        signal: controller.signal,
      }),
    );
    expect(postCall().options["sameServerRedirectsOnly"]).toBe(true);

    postMock.mockClear();
    await call();

    expect(postCall().options).toEqual(
      RunnerAPIRequest.getDefaultRequestOptions(),
    );
    expect(Object.keys(postCall().options)).not.toContain("timeout");
    expect(Object.keys(postCall().options)).not.toContain("signal");
  });
});

describe("a call that fails", () => {
  test("a refusal carries the server's reason and its status", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(
        429,
        { message: "The model provider is rate limiting this project." },
        {},
      ),
    );

    const error: LlmCompletionError = await failure(call());

    expect(error.message).toBe(
      "The model provider is rate limiting this project.",
    );
    expect(error.statusCode).toBe(429);
    expect(error.isNetworkFailure).toBe(false);
    expect(error.name).toBe("LlmCompletionError");
  });

  test("a refusal with no reason says its status", async () => {
    postMock.mockResolvedValue(new HTTPErrorResponse(502, {}, {}));

    const error: LlmCompletionError = await failure(call());

    expect(error.message).toBe("LLM completion request failed (HTTP 502)");
    expect(error.statusCode).toBe(502);
  });

  test("no answer at all says the server could not be reached, with no status", async () => {
    postMock.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:443"));

    const error: LlmCompletionError = await failure(call());

    expect(error.message).toBe(
      "The OneUptime server could not be reached for the model call: connect ECONNREFUSED 10.0.0.5:443",
    );
    expect(error.isNetworkFailure).toBe(true);
    expect(error.statusCode).toBeUndefined();
  });

  test("something thrown that is not an Error is still a failure the agent can read", async () => {
    postMock.mockRejectedValue("socket hang up");

    const error: LlmCompletionError = await failure(call());

    expect(error.message).toBe(
      "The OneUptime server could not be reached for the model call: socket hang up",
    );
    expect(error.isNetworkFailure).toBe(true);
  });
});
