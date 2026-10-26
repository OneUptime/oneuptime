import AIService, {
  AILogRequest,
  AILogResponse,
  AutonomousBudgetStatus,
} from "../../../Server/Services/AIService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import LLMCallTelemetry, {
  CAPTURE_MESSAGE_CONTENT_ENV_VAR,
  GenAiMessage,
} from "../../../Server/Utils/LLM/LLMCallTelemetry";
import LLMProviderHTTPException from "../../../Server/Utils/LLM/LLMProviderHTTPException";
import LLMService, {
  LLMCompletionResponse,
  LLMMessage,
} from "../../../Server/Utils/LLM/LLMService";
import Telemetry from "../../../Server/Utils/Telemetry";
import LlmSpanUtil, {
  LlmSpanFields,
} from "../../../Server/Utils/Telemetry/LlmSpan";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { LlmCallKind } from "../../../Types/Telemetry/LlmCallKind";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import LlmMessageParser, {
  LlmCallContent,
} from "../../../Utils/Telemetry/LlmMessageParser";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { Attributes, Span, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/*
 * OneUptime's own AI calls, as OneUptime's own AI / LLM observability sees
 * them - the dogfooding loop. Every model call goes through
 * AIService.executeWithLogging; these tests run it against a real tracer and
 * read the span it exports, the way a deployment that sends its telemetry to
 * a OneUptime project does. Before, that span carried the model and the
 * tokens only, so every answer in the conversation view read "The AI
 * answered. What it said was not recorded.", calls of concurrent runs merged
 * into one "request", and a failed call was not an AI call at all.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return { ...actual, IsBillingEnabled: false };
});

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

const MODEL: string = "nvidia/nemotron-3-super-120b-a12b:free";
const FEATURE: string = "Incident Postmortem";
const SYSTEM: string = "You write postmortems for SRE teams.";
const QUESTION: string = "Write the postmortem of incident #42.";
const ANSWER: string = "## Summary\nCheckout failed for 12 minutes.";

const SCREENSHOT: string = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200 * 1024 - 8, 0x41),
]).toString("base64");

const MESSAGES: Array<LLMMessage> = [
  { role: "system", content: SYSTEM },
  { role: "user", content: QUESTION },
];

const projectId: ObjectID = ObjectID.generate();

beforeAll(() => {
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
});

afterAll(() => {
  trace.disable();
  context.disable();
});

describe("AIService.executeWithLogging marks its span as an AI call", () => {
  const originalCapture: string | undefined =
    process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR];

  let getCompletion: jest.SpyInstance;
  let getProviderForChat: jest.SpyInstance;

  function completion(
    response: Partial<LLMCompletionResponse>,
  ): LLMCompletionResponse {
    return {
      content: ANSWER,
      stopReason: "stop",
      usage: { promptTokens: 1200, completionTokens: 80, totalTokens: 1280 },
      ...response,
    };
  }

  function request(data?: Partial<AILogRequest>): AILogRequest {
    return {
      projectId: projectId,
      feature: FEATURE,
      messages: MESSAGES,
      maxTokens: 2048,
      temperature: 0.3,
      storeContentPreviews: false,
      ...data,
    };
  }

  // The span @CaptureSpan opened for the call - the one the AI pages read.
  function callSpan(): ReadableSpan {
    const spans: Array<ReadableSpan> = exporter
      .getFinishedSpans()
      .filter((span: ReadableSpan) => {
        return span.name === "Service.executeWithLogging";
      });

    expect(spans).toHaveLength(1);

    return spans[0]!;
  }

  function attributesOf(span: ReadableSpan): Attributes {
    return span.attributes;
  }

  function messagesIn(span: ReadableSpan, key: string): Array<GenAiMessage> {
    return JSON.parse(span.attributes[key] as string) as Array<GenAiMessage>;
  }

  function extract(span: ReadableSpan): LlmSpanFields {
    return LlmSpanUtil.extract(
      span.attributes as Parameters<typeof LlmSpanUtil.extract>[0],
    );
  }

  beforeEach(() => {
    exporter.reset();
    delete process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR];

    // A deployment that exports its own traces.
    jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
    } as unknown as Project);
    getProviderForChat = jest
      .spyOn(LlmProviderService, "getProviderForChat")
      .mockResolvedValue({
        id: ObjectID.generate(),
        name: "OpenRouter",
        llmType: LlmType.OpenAI,
        modelName: MODEL,
        isGlobalLlm: false,
      } as unknown as LlmProvider);
    getCompletion = jest
      .spyOn(LLMService, "getCompletion")
      .mockResolvedValue(completion({}));
    jest.spyOn(LlmLogService, "create").mockResolvedValue(new LlmLog());
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalCapture === undefined) {
      delete process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR];
    } else {
      process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR] = originalCapture;
    }
  });

  describe("with prompts and answers left out (the default)", () => {
    test("the span says which model, feature and conversation, and how the call went", async () => {
      const aiRunId: ObjectID = ObjectID.generate();

      await AIService.executeWithLogging(request({ aiRunId }));

      expect(attributesOf(callSpan())).toMatchObject({
        "gen_ai.operation.name": "chat",
        "gen_ai.system": "OpenAI",
        "gen_ai.provider.name": "OpenAI",
        "gen_ai.request.model": MODEL,
        "gen_ai.response.model": MODEL,
        "gen_ai.agent.name": FEATURE,
        "gen_ai.conversation.id": aiRunId.toString(),
        "gen_ai.request.max_tokens": 2048,
        "gen_ai.request.temperature": 0.3,
        "gen_ai.usage.input_tokens": 1200,
        "gen_ai.usage.output_tokens": 80,
        "gen_ai.usage.total_tokens": 1280,
        "gen_ai.response.finish_reasons": ["stop"],
      });
    });

    test("nothing the call said is on the span", async () => {
      await AIService.executeWithLogging(request());

      const attributes: Attributes = attributesOf(callSpan());

      expect(attributes["gen_ai.system_instructions"]).toBeUndefined();
      expect(attributes["gen_ai.input.messages"]).toBeUndefined();
      expect(attributes["gen_ai.output.messages"]).toBeUndefined();
      expect(JSON.stringify(attributes)).not.toContain(QUESTION);
      expect(JSON.stringify(attributes)).not.toContain("Checkout failed");
    });

    test("the temperature recorded is the one the model was sent", async () => {
      await AIService.executeWithLogging(request({ temperature: undefined }));

      expect(getCompletion.mock.calls[0]![0].temperature).toBe(0.7);
      expect(attributesOf(callSpan())["gen_ai.request.temperature"]).toBe(0.7);
    });
  });

  /*
   * A provider whose Model Name is blank leaves the model to the server -
   * the provider type's default, or the first model an OpenAI-compatible
   * server lists. AI Logs and the span name the model that answered, as
   * LLMService reports it, so nobody has to guess what ran.
   */
  describe("with the Model Name left to the server", () => {
    const SERVED_MODEL: string = "Qwen/Qwen3.8-27B";

    function loggedModelName(): string | undefined {
      const logged: LlmLog = (
        jest.mocked(LlmLogService.create).mock.calls[0]![0] as {
          data: LlmLog;
        }
      ).data;

      return logged.modelName;
    }

    beforeEach(() => {
      getProviderForChat.mockResolvedValue({
        id: ObjectID.generate(),
        name: "Self-hosted vLLM",
        llmType: LlmType.OpenAICompatible,
        baseUrl: "http://vllm.internal:8000/v1",
        isGlobalLlm: false,
      } as unknown as LlmProvider);
    });

    test("AI Logs and the span name the model the server chose", async () => {
      getCompletion.mockResolvedValue(completion({ modelName: SERVED_MODEL }));

      await AIService.executeWithLogging(request());

      // Asked for no model: the server chose.
      expect(
        getCompletion.mock.calls[0]![0].llmProviderConfig.modelName,
      ).toBeUndefined();
      expect(loggedModelName()).toBe(SERVED_MODEL);
      expect(attributesOf(callSpan())["gen_ai.response.model"]).toBe(
        SERVED_MODEL,
      );
      // Not known before the call went out.
      expect(attributesOf(callSpan())["gen_ai.request.model"]).toBeUndefined();
    });

    test("a model id longer than AI Logs' column is cut to fit, and the call still logs", async () => {
      // vLLM names a model loaded from disk by its path.
      const path: string = `/models/huggingface/hub/models--meta-llama--Llama-3.1-8B-Instruct/snapshots/0e9e39f249a16976918f6564b8830bc894c89659`;

      getCompletion.mockResolvedValue(completion({ modelName: path }));

      const response: AILogResponse =
        await AIService.executeWithLogging(request());

      expect(response.content).toBe(ANSWER);
      expect(path.length).toBeGreaterThan(100);
      expect(loggedModelName()).toBe(path.substring(0, 100));
      // The span keeps it whole.
      expect(attributesOf(callSpan())["gen_ai.response.model"]).toBe(path);
    });

    test("a typed Model Name is what AI Logs name, as before", async () => {
      getProviderForChat.mockResolvedValue({
        id: ObjectID.generate(),
        name: "Self-hosted vLLM",
        llmType: LlmType.OpenAICompatible,
        baseUrl: "http://vllm.internal:8000/v1",
        modelName: "meta-llama/Llama-3.1-8B-Instruct",
        isGlobalLlm: false,
      } as unknown as LlmProvider);
      getCompletion.mockResolvedValue(
        completion({ modelName: "meta-llama/Llama-3.1-8B-Instruct" }),
      );

      await AIService.executeWithLogging(request());

      expect(loggedModelName()).toBe("meta-llama/Llama-3.1-8B-Instruct");
      expect(attributesOf(callSpan())["gen_ai.request.model"]).toBe(
        "meta-llama/Llama-3.1-8B-Instruct",
      );
    });

    test("an answer that names no model keeps the provider's", async () => {
      getProviderForChat.mockResolvedValue({
        id: ObjectID.generate(),
        name: "OpenRouter",
        llmType: LlmType.OpenAI,
        modelName: MODEL,
        isGlobalLlm: false,
      } as unknown as LlmProvider);
      getCompletion.mockResolvedValue(completion({}));

      await AIService.executeWithLogging(request());

      expect(loggedModelName()).toBe(MODEL);
      expect(attributesOf(callSpan())["gen_ai.response.model"]).toBe(MODEL);
    });
  });

  describe("with prompts and answers recorded", () => {
    beforeEach(() => {
      process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR] = "true";
    });

    test("the span carries the system prompt, the messages and the answer", async () => {
      await AIService.executeWithLogging(request());

      const span: ReadableSpan = callSpan();

      expect(
        JSON.parse(span.attributes["gen_ai.system_instructions"] as string),
      ).toEqual([{ type: "text", content: SYSTEM }]);
      expect(messagesIn(span, "gen_ai.input.messages")).toEqual([
        { role: "user", parts: [{ type: "text", content: QUESTION }] },
      ]);
      expect(messagesIn(span, "gen_ai.output.messages")).toEqual([
        {
          role: "assistant",
          parts: [{ type: "text", content: ANSWER }],
          finish_reason: "stop",
        },
      ]);
    });

    test("the conversation view reads the call back, and ingest sees an answer", async () => {
      await AIService.executeWithLogging(request());

      const span: ReadableSpan = callSpan();
      const content: LlmCallContent = LlmMessageParser.readCallContent({
        attributes: span.attributes,
      });

      expect(content.systemInstructions).toBe(SYSTEM);
      expect(LlmMessageParser.getText(content.input[0]!)).toBe(QUESTION);
      expect(LlmMessageParser.getText(content.output[0]!)).toBe(ANSWER);

      expect(extract(span)).toMatchObject({
        isLlmSpan: true,
        llmCallKind: LlmCallKind.Answer,
        llmAgentName: FEATURE,
        llmIssues: [],
      });
      expect(
        LlmSpanUtil.getUserMessagePreview({ attributes: span.attributes }),
      ).toBe(QUESTION);
    });

    test("what is recorded is what was sent: an embedded screenshot is the note the model read", async () => {
      await AIService.executeWithLogging(
        request({
          messages: [
            {
              role: "user",
              content: `![Login page](data:image/png;base64,${SCREENSHOT})\nWhy did it fail?`,
            },
          ],
        }),
      );

      const recorded: string = callSpan().attributes[
        "gen_ai.input.messages"
      ] as string;

      expect(recorded).toContain("[image omitted: PNG, 200 KB]");
      expect(recorded).not.toContain(SCREENSHOT.slice(0, 1000));
      expect(recorded).toBe(
        JSON.stringify(
          LLMCallTelemetry.toInput(getCompletion.mock.calls[0]![0].messages)
            .inputMessages,
        ),
      );
    });

    test("an agent turn records the tools the model asked for", async () => {
      getCompletion.mockResolvedValue(
        completion({
          content: "",
          toolCalls: [
            { id: "call_1", name: "get_incident", arguments: { number: 42 } },
          ],
          stopReason: "tool_use",
        }),
      );

      const response: AILogResponse =
        await AIService.executeWithLogging(request());

      expect(response.toolCalls).toHaveLength(1);
      expect(messagesIn(callSpan(), "gen_ai.output.messages")).toEqual([
        {
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              id: "call_1",
              name: "get_incident",
              arguments: { number: 42 },
            },
          ],
          finish_reason: "tool_call",
        },
      ]);
      expect(
        attributesOf(callSpan())["gen_ai.response.finish_reasons"],
      ).toEqual(["tool_call"]);
    });

    test("an answer cut off at the token limit is flagged cut off", async () => {
      getCompletion.mockResolvedValue(
        completion({
          content: "## Summary\nCheckout fa",
          stopReason: "length",
        }),
      );

      await AIService.executeWithLogging(request());

      expect(extract(callSpan()).llmIssues).toEqual([LlmAnswerIssue.CutOff]);
    });

    test("the AI Logs previews stay redacted when the call asked for that", async () => {
      await AIService.executeWithLogging(request());

      const savedLog: LlmLog = (
        (LlmLogService.create as unknown as jest.SpyInstance).mock
          .calls[0]![0] as { data: LlmLog }
      ).data;

      expect(savedLog.requestPrompt).not.toContain(QUESTION);
      expect(savedLog.responsePreview).not.toContain("Checkout failed");
    });
  });

  describe("conversations", () => {
    test("an Ask AI chat is its conversation, not the run of one turn", async () => {
      const conversationId: ObjectID = ObjectID.generate();

      await AIService.executeWithLogging(
        request({ conversationId, aiRunId: ObjectID.generate() }),
      );

      expect(attributesOf(callSpan())["gen_ai.conversation.id"]).toBe(
        conversationId.toString(),
      );
    });

    test("an investigation's calls are the conversation of its run", async () => {
      const aiRunId: ObjectID = ObjectID.generate();

      jest
        .spyOn(AIService, "getAutonomousDailyBudgetStatus")
        .mockResolvedValue({
          exhausted: false,
          limitInTokens: null,
          usedTokensToday: 0,
        } as AutonomousBudgetStatus);

      await AIService.executeWithLogging(
        request({
          aiRunId,
          incidentId: ObjectID.generate(),
          feature: "AI Incident Investigation",
        }),
      );

      expect(extract(callSpan())).toMatchObject({
        llmConversationId: aiRunId.toString(),
        llmAgentName: "AI Incident Investigation",
      });
    });

    test("a call of no run and no chat is grouped by its trace", async () => {
      await AIService.executeWithLogging(request());

      expect(
        attributesOf(callSpan())["gen_ai.conversation.id"],
      ).toBeUndefined();
    });
  });

  describe("a call that fails", () => {
    function rateLimited(): LLMProviderHTTPException {
      return new LLMProviderHTTPException({
        message: `OpenAI API error: rate limit reached for "${QUESTION}"`,
        statusCode: 429,
        llmType: LlmType.OpenAI,
        providerMessage: `rate limit reached for "${QUESTION}"`,
      });
    }

    // What this change put on the span: the GenAI attributes and error.type.
    function aiAttributesOf(span: ReadableSpan): Array<string> {
      return Object.entries(span.attributes)
        .filter(([key]: [string, unknown]) => {
          return key.startsWith("gen_ai.") || key === "error.type";
        })
        .map(([key, value]: [string, unknown]) => {
          return `${key}=${JSON.stringify(value)}`;
        });
    }

    test("is an AI call that failed, named by its HTTP status", async () => {
      process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR] = "true";
      getCompletion.mockRejectedValue(rateLimited());

      await expect(AIService.executeWithLogging(request())).rejects.toThrow(
        "rate limit",
      );

      const span: ReadableSpan = callSpan();
      const fields: LlmSpanFields = extract(span);

      expect(span.attributes["error.type"]).toBe("429");
      expect(fields.isLlmSpan).toBe(true);
      expect(fields.llmIssues).toEqual([LlmAnswerIssue.Failed]);
      // What was sent is there; there is no answer.
      expect(messagesIn(span, "gen_ai.input.messages")).toEqual([
        { role: "user", parts: [{ type: "text", content: QUESTION }] },
      ]);
      expect(span.attributes["gen_ai.output.messages"]).toBeUndefined();
      // The failure's name carries none of the provider's words.
      expect(
        aiAttributesOf(span).filter((attribute: string) => {
          return attribute.includes("rate limit");
        }),
      ).toEqual([]);
    });

    test("a call that keeps provider errors private keeps them off the whole span", async () => {
      getCompletion.mockRejectedValue(rateLimited());

      await expect(
        AIService.executeWithLogging(request({ storeErrorDetails: false })),
      ).rejects.toThrow("The AI provider request failed.");

      const span: ReadableSpan = callSpan();

      expect(span.attributes["error.type"]).toBe("429");
      expect(extract(span).llmIssues).toEqual([LlmAnswerIssue.Failed]);
      expect(
        Object.values(span.attributes).some((value: unknown) => {
          return String(value).includes("rate limit");
        }),
      ).toBe(false);
      expect(
        span.events.some((event: { attributes?: Attributes | undefined }) => {
          return JSON.stringify(event.attributes || {}).includes("rate limit");
        }),
      ).toBe(false);
    });

    test("a call that never reached a model is not an AI call", async () => {
      getProviderForChat.mockResolvedValue(null);

      await expect(AIService.executeWithLogging(request())).rejects.toThrow(
        "No LLM provider configured",
      );

      const attributes: Attributes = attributesOf(callSpan());

      expect(
        Object.keys(attributes).filter((key: string) => {
          return key.startsWith("gen_ai.");
        }),
      ).toEqual([]);
      expect(getCompletion).not.toHaveBeenCalled();
    });
  });

  describe("telemetry never costs the call", () => {
    test("a deployment that exports no traces builds nothing, even with recording on", async () => {
      process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR] = "true";
      (
        Telemetry.isSpanExportEnabled as unknown as jest.SpyInstance
      ).mockReturnValue(false);
      const getRequestAttributes: jest.SpyInstance = jest.spyOn(
        LLMCallTelemetry,
        "getRequestAttributes",
      );

      // The caller's span is the active one when @CaptureSpan opens none.
      await trace
        .getTracer("test")
        .startActiveSpan("caller", async (span: Span) => {
          await AIService.executeWithLogging(request());
          span.end();
        });

      const caller: ReadableSpan = exporter.getFinishedSpans()[0]!;

      expect(caller.name).toBe("caller");
      expect(
        Object.keys(caller.attributes).filter((key: string) => {
          return key.startsWith("gen_ai.");
        }),
      ).toEqual([]);
      expect(getRequestAttributes).not.toHaveBeenCalled();
    });

    test("a telemetry failure never fails the AI call", async () => {
      jest
        .spyOn(LLMCallTelemetry, "getRequestAttributes")
        .mockImplementation(() => {
          throw new Error("telemetry broke");
        });
      jest
        .spyOn(LLMCallTelemetry, "getResponseAttributes")
        .mockImplementation(() => {
          throw new Error("telemetry broke");
        });

      const response: AILogResponse =
        await AIService.executeWithLogging(request());

      expect(response.content).toBe(ANSWER);
    });
  });
});
