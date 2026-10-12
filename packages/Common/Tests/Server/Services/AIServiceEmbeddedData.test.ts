import AIService from "../../../Server/Services/AIService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import LLMService, {
  LLMCompletionRequest,
  LLMMessage,
} from "../../../Server/Utils/LLM/LLMService";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE BACKSTOP: NO CALL SENDS AN EMBEDDED IMAGE (issue #4587).
 *
 * Every builder of a prompt puts a record's text in through PromptText.
 * AIService.executeWithLogging - which every call to a model goes through -
 * leaves embedded data out of every message as well, so a template, a
 * workflow's input, a pasted chat message or a tool's output cannot send a
 * screenshot either, now or in a caller written later. The one exception
 * is the coding agent, whose messages are source files: it asks for its
 * messages to go as they are.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return { ...actual, IsBillingEnabled: false };
});

const projectId: ObjectID = ObjectID.generate();

const SCREENSHOT: string = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200 * 1024 - 8, 0x41),
]).toString("base64");

const IMAGE: string = `![Login page](data:image/png;base64,${SCREENSHOT})`;
const NOTE: string = "![Login page]([image omitted: PNG, 200 KB])";

describe("AIService.executeWithLogging leaves embedded data out of what it sends", () => {
  let getCompletion: jest.SpyInstance;
  let createLog: jest.SpyInstance;

  function sent(): LLMCompletionRequest {
    return getCompletion.mock.calls[0]![0] as LLMCompletionRequest;
  }

  function savedLog(): LlmLog {
    return (createLog.mock.calls[0]![0] as { data: LlmLog }).data;
  }

  beforeEach(() => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
    } as unknown as Project);
    jest.spyOn(LlmProviderService, "getProviderForChat").mockResolvedValue({
      id: ObjectID.generate(),
      name: "Test Provider",
      llmType: LlmType.OpenAI,
      modelName: "test-model",
      isGlobalLlm: false,
    } as unknown as LlmProvider);
    getCompletion = jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
      content: "ok",
      usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
    });
    createLog = jest
      .spyOn(LlmLogService, "create")
      .mockResolvedValue(new LlmLog());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a screenshot in any message is a short note to the model", async () => {
    const messages: Array<LLMMessage> = [
      { role: "system", content: `Fill this template:\n${IMAGE}` },
      { role: "user", content: `Look at this:\n${IMAGE}\nWhy did it fail?` },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "get_incident", arguments: {} }],
      },
      { role: "tool", toolCallId: "call_1", content: `description=${IMAGE}` },
    ];

    await AIService.executeWithLogging({
      projectId,
      feature: "Embedded Data Test",
      messages,
    });

    expect(sent().messages).toEqual([
      { role: "system", content: `Fill this template:\n${NOTE}` },
      { role: "user", content: `Look at this:\n${NOTE}\nWhy did it fail?` },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "get_incident", arguments: {} }],
      },
      { role: "tool", toolCallId: "call_1", content: `description=${NOTE}` },
    ]);
  });

  test("the caller's own messages are left as they are", async () => {
    const message: LLMMessage = { role: "user", content: IMAGE };
    const messages: Array<LLMMessage> = [message];

    await AIService.executeWithLogging({
      projectId,
      feature: "Embedded Data Test",
      messages,
    });

    expect(messages[0]).toBe(message);
    expect(message.content).toBe(IMAGE);
  });

  test("messages with nothing embedded are sent as the very same array", async () => {
    const messages: Array<LLMMessage> = [
      { role: "system", content: "You are an SRE." },
      { role: "user", content: "Why is checkout down?" },
    ];

    await AIService.executeWithLogging({
      projectId,
      feature: "Embedded Data Test",
      messages,
    });

    expect(sent().messages).toBe(messages);
  });

  test("the AI Logs preview shows the note, and the words after it", async () => {
    await AIService.executeWithLogging({
      projectId,
      feature: "Embedded Data Test",
      messages: [{ role: "user", content: `${IMAGE}\nWhy did it fail?` }],
    });

    // Before, its 5,000 characters were all base64.
    expect(savedLog().requestPrompt).toBe(`${NOTE}\nWhy did it fail?`);
  });

  test("the coding agent's messages go exactly as they are", async () => {
    const stylesheet: string = `.logo { background: url(data:image/png;base64,${SCREENSHOT}); }`;
    const messages: Array<LLMMessage> = [
      { role: "tool", toolCallId: "read_1", content: stylesheet },
    ];

    await AIService.executeWithLogging({
      projectId,
      feature: "Embedded Data Test",
      messages,
      keepEmbeddedData: true,
    });

    expect(sent().messages).toBe(messages);
    expect(sent().messages[0]!.content).toBe(stylesheet);
  });
});
