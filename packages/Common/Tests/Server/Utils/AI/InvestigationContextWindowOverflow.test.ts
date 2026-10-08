import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import LlmLogService from "../../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../Server/Services/ProjectService";
import LLMService from "../../../../Server/Utils/LLM/LLMService";
import logger from "../../../../Server/Utils/Logger";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import LlmLog from "../../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../Models/DatabaseModels/Project";
import API from "../../../../Utils/API";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import LlmLogStatus from "../../../../Types/LlmLogStatus";
import LlmType from "../../../../Types/LLM/LlmType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * An AI investigation on a self-hosted Ollama whose context window is too
 * small, end to end: the engine, the agent loop, AIService and LLMService
 * are all real, and only the HTTP call to Ollama and the database are not.
 *
 * It holds the two things a customer's report turned on. OneUptime sends the
 * question on every call, so "no user query found in messages" means Ollama
 * dropped it to fit num_ctx. And the run then fails once, with an error that
 * says how to raise num_ctx, instead of being queued to fill the same window
 * again.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  // A self-hosted install: the project's own provider, nothing billed.
  return { ...actual, IsBillingEnabled: false };
});

const QUESTION_MARKER: string = "# Incident: checkout is down";
const EVIDENCE_TOOL_NAME: string = "read_incident_evidence";

const OLLAMA_PROVIDER: LlmProvider = {
  id: ObjectID.generate(),
  name: "Self-Hosted Ollama",
  llmType: LlmType.Ollama,
  baseUrl: "http://ollama.internal:11434",
  modelName: "qwen3.8",
  additionalParams: { options: { num_ctx: 32768 } },
  isGlobalLlm: false,
} as unknown as LlmProvider;

// What Ollama's /api/chat answers when the model asks for a tool.
function ollamaToolCallReply(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: { name: EVIDENCE_TOOL_NAME, arguments: {} },
          },
        ],
      },
      done_reason: "stop",
      prompt_eval_count: 20_000,
      eval_count: 20,
    },
    {},
  );
}

describe("an investigation that outgrows Ollama's context window", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  let post: jest.SpyInstance;
  let failOrRequeue: jest.SpyInstance;
  let createLlmLog: jest.SpyInstance;
  let postAnalysis: jest.Mock;

  function makeRequest(): InvestigationRequest {
    return {
      feature: "Context Window Test Investigation",
      contextSummary: QUESTION_MARKER,
      postAnalysis:
        postAnalysis as unknown as InvestigationRequest["postAnalysis"],
      extraTools: [
        {
          definition: {
            name: EVIDENCE_TOOL_NAME,
            description: "Reads the incident's evidence.",
            inputSchema: { type: "object", properties: {} },
          },
          execute: async () => {
            return {
              success: true,
              // A large result, as a log query returns.
              textForLlm: "log line\n".repeat(2000),
              result: {
                dataForLlm: "log line\n".repeat(2000),
                rowCount: 2000,
                citationLabel: "Incident evidence",
                redactionCount: 0,
                isTruncated: false,
              },
            };
          },
        },
      ],
    };
  }

  function sentRequest(callIndex: number): JSONObject {
    return (post.mock.calls[callIndex]![0] as { data: JSONObject }).data;
  }

  function sentRoles(callIndex: number): Array<string> {
    return (sentRequest(callIndex)["messages"] as JSONArray).map(
      (message: unknown): string => {
        return (message as JSONObject)["role"] as string;
      },
    );
  }

  beforeEach(() => {
    stubLLMEgressGuard();
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    postAnalysis = jest.fn(async (): Promise<void> => {});

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
    } as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getProviderForChat")
      .mockResolvedValue(OLLAMA_PROVIDER);
    createLlmLog = jest
      .spyOn(LlmLogService, "create")
      .mockResolvedValue(new LlmLog());

    // The run's event trail and heartbeat are best-effort writes.
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockResolvedValue({} as unknown as AIRunEvent);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    failOrRequeue = jest
      .spyOn(AIInvestigationQueue, "failOrRequeue")
      .mockResolvedValue("finalized");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runInvestigation(): Promise<void> {
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount: 1,
      request: makeRequest(),
    });
  }

  test("every call to Ollama carries the question, right after the system prompt", async () => {
    post = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(ollamaToolCallReply())
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          500,
          { error: "no user query found in messages" },
          {},
        ),
      );

    await runInvestigation();

    expect(post).toHaveBeenCalledTimes(2);
    expect(sentRoles(0)).toEqual(["system", "user"]);
    // The call Ollama refused still had the question in it.
    expect(sentRoles(1)).toEqual(["system", "user", "assistant", "tool"]);

    const question: JSONObject = (
      sentRequest(1)["messages"] as JSONArray
    )[1] as JSONObject;
    expect(question["content"]).toContain(QUESTION_MARKER);

    // And the window the operator configured went with it.
    expect((sentRequest(1)["options"] as JSONObject)["num_ctx"]).toBe(32768);
  });

  test("the run fails once, with the setting to raise, and is not queued again", async () => {
    post = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(ollamaToolCallReply())
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          500,
          { error: "no user query found in messages" },
          {},
        ),
      );

    await runInvestigation();

    expect(postAnalysis).not.toHaveBeenCalled();
    expect(failOrRequeue).toHaveBeenCalledTimes(1);

    const failure: { errorMessage: string; isPermanent: boolean } =
      failOrRequeue.mock.calls[0]![0] as {
        errorMessage: string;
        isPermanent: boolean;
      };

    expect(failure.isPermanent).toBe(true);
    expect(failure.errorMessage).toContain(
      LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR,
    );
    expect(failure.errorMessage).toContain(
      'set "num_ctx" under "options" in this LLM provider\'s Additional Parameters to 65536 or more (it is 32768 now)',
    );
    expect(failure.errorMessage).toContain("OLLAMA_CONTEXT_LENGTH");
  });

  test("the LLM log records the whole explanation", async () => {
    post = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(ollamaToolCallReply())
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          500,
          { error: "no user query found in messages" },
          {},
        ),
      );

    await runInvestigation();

    const failedLog: LlmLog | undefined = createLlmLog.mock.calls
      .map((call: Array<unknown>): LlmLog => {
        return (call[0] as { data: LlmLog }).data;
      })
      .find((log: LlmLog): boolean => {
        return log.status === LlmLogStatus.Error;
      });

    expect(failedLog).toBeDefined();
    // Not cut short by the column's limit: the fix is at the end.
    expect(failedLog!.statusMessage).toMatch(
      /^Ollama API error: the request is larger than the model's context window.*OLLAMA_CONTEXT_LENGTH on the Ollama server\.$/,
    );
  });

  test("a transient Ollama failure is still queued for another attempt", async () => {
    post = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(ollamaToolCallReply())
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          500,
          { error: "model runner has unexpectedly stopped" },
          {},
        ),
      );

    await runInvestigation();

    const failure: { errorMessage: string; isPermanent: boolean } =
      failOrRequeue.mock.calls[0]![0] as {
        errorMessage: string;
        isPermanent: boolean;
      };

    expect(failure.isPermanent).toBe(false);
    expect(failure.errorMessage).not.toContain(
      LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR,
    );
  });
});
