import ObservabilityAssistant, {
  ObservabilityAssistantRequest,
} from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../../Server/Services/AIService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import { LLMMessage } from "../../../../../Server/Utils/LLM/LLMService";
import logger from "../../../../../Server/Utils/Logger";
import {
  AI_CONTEXT_PROMPT_HEADING,
  buildAiContextPromptSection,
} from "../../../../../Server/Utils/AI/AiContext/AiContextPrompt";
import Project from "../../../../../Models/DatabaseModels/Project";
import {
  AiContextActivity,
  composeAiContext,
} from "../../../../../Types/AI/AiContext";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE AGENT LOOP PLACES THE AI CONTEXT FIRST IN ITS SYSTEM PROMPT
 * (ObservabilityAssistant: autonomous investigations and fixes, and the
 * Slack and Microsoft Teams answers). Before the observability rules and
 * the run's persona, long before the run's own data in the user message -
 * and the same on every call of the loop, the prefix a provider caches.
 * Handed an AI context, it uses that one; handed null, none; handed
 * nothing - a Slack or Teams answer - it reads the project's itself.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const QUESTION: string = "Why is checkout returning 500 errors?";
const PERSONA: string = "You are OneUptime AI, investigating a new incident.";
const NOTES: string =
  "## Symptom → owner\n- 502 on /checkout: payments team, check payments-db.";

const AI_CONTEXT: AiContextActivity = composeAiContext({
  projectContext: NOTES,
})!;

function reply(data: {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: object }>;
}): AILogResponse {
  return {
    content: data.content ?? "",
    toolCalls: data.toolCalls,
    stopReason: data.toolCalls ? "tool_use" : "stop",
    llmLog: {
      totalTokens: 10,
      llmProviderName: "Test",
      modelName: "test-model",
    },
  } as unknown as AILogResponse;
}

function outcome(text: string): ToolCallOutcome {
  return {
    success: true,
    textForLlm: text,
    result: {
      dataForLlm: text,
      rowCount: 1,
      citationLabel: "logs",
      redactionCount: 0,
      isTruncated: false,
    },
  } as ToolCallOutcome;
}

// Two calls: one that asks for a tool, then the answer.
function mockLoop(): SpyInstance<typeof AIService.executeWithLogging> {
  jest
    .spyOn(AIToolbox, "executeTool")
    .mockResolvedValue(outcome("3 rows") as never);

  return jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValueOnce(
      reply({
        toolCalls: [{ id: "call_1", name: "search_logs", arguments: {} }],
      }),
    )
    .mockResolvedValueOnce(reply({ content: "payments-db ran out [C1]." }));
}

function messagesOf(
  execute: SpyInstance<typeof AIService.executeWithLogging>,
  index: number,
): Array<LLMMessage> {
  return (execute.mock.calls[index]![0] as AILogRequest).messages;
}

async function ask(
  overrides: Partial<ObservabilityAssistantRequest>,
): Promise<void> {
  await ObservabilityAssistant.answerQuestion({
    projectId: PROJECT_ID,
    props: { isRoot: true, tenantId: PROJECT_ID },
    question: QUESTION,
    feature: "AI Incident Investigation",
    maxWallClockMs: null,
    systemInstructions: PERSONA,
    ...overrides,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ObservabilityAssistant: where the AI context goes", () => {
  test("first in the system prompt: before the observability rules and the persona", async () => {
    const execute: SpyInstance<typeof AIService.executeWithLogging> =
      mockLoop();

    await ask({ aiContext: AI_CONTEXT });

    const system: string = messagesOf(execute, 0)[0]!.content;

    expect(messagesOf(execute, 0)[0]!.role).toBe("system");
    expect(system.startsWith(buildAiContextPromptSection(AI_CONTEXT))).toBe(
      true,
    );
    expect(system.indexOf(NOTES)).toBeLessThan(
      system.indexOf("You are OneUptime's observability copilot"),
    );
    expect(system.indexOf("## Hard rules")).toBeLessThan(
      system.indexOf(PERSONA),
    );
  });

  test("the run's own data stays in the user message, after it", async () => {
    const execute: SpyInstance<typeof AIService.executeWithLogging> =
      mockLoop();

    await ask({ aiContext: AI_CONTEXT });

    const messages: Array<LLMMessage> = messagesOf(execute, 0);

    expect(messages[1]).toEqual({ role: "user", content: QUESTION });
    expect(messages[0]!.content).not.toContain(QUESTION);
    expect(
      messages.slice(1).some((message: LLMMessage): boolean => {
        return message.content.includes(NOTES);
      }),
    ).toBe(false);
  });

  test("every call of the loop sends the same system prompt", async () => {
    const execute: SpyInstance<typeof AIService.executeWithLogging> =
      mockLoop();

    await ask({ aiContext: AI_CONTEXT });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(messagesOf(execute, 1)[0]).toEqual(messagesOf(execute, 0)[0]);
  });

  test("null: no AI context, nothing read, and the prompt is the one it always was", async () => {
    const read: SpyInstance<typeof ProjectService.findOneById> = jest.spyOn(
      ProjectService,
      "findOneById",
    );
    const execute: SpyInstance<typeof AIService.executeWithLogging> =
      mockLoop();

    await ask({ aiContext: null });

    const system: string = messagesOf(execute, 0)[0]!.content;

    expect(read).not.toHaveBeenCalled();
    expect(system.startsWith("You are OneUptime's observability copilot")).toBe(
      true,
    );
    expect(system).not.toContain(AI_CONTEXT_PROMPT_HEADING);
    expect(system.endsWith(`\n\n${PERSONA}`)).toBe(true);
  });

  test("left out - a Slack or Teams answer - the loop reads its project's notes itself", async () => {
    const project: Project = new Project(PROJECT_ID);
    project.aiContext = NOTES;
    const read: SpyInstance<typeof ProjectService.findOneById> = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project);
    const execute: SpyInstance<typeof AIService.executeWithLogging> =
      mockLoop();

    await ObservabilityAssistant.answerQuestion({
      projectId: PROJECT_ID,
      props: { isRoot: true, tenantId: PROJECT_ID },
      question: QUESTION,
      feature: "Slack ChatOps",
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: { aiContext: true },
      props: { isRoot: true },
    });
    expect(messagesOf(execute, 0)[0]!.content).toContain(NOTES);
    expect(
      messagesOf(execute, 0)[0]!.content.startsWith(AI_CONTEXT_PROMPT_HEADING),
    ).toBe(true);
  });

  test("a project whose notes cannot be read is answered all the same", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("down"));
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
    const execute: SpyInstance<typeof AIService.executeWithLogging> =
      mockLoop();

    await ObservabilityAssistant.answerQuestion({
      projectId: PROJECT_ID,
      props: { isRoot: true, tenantId: PROJECT_ID },
      question: QUESTION,
      feature: "Microsoft Teams ChatOps",
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(messagesOf(execute, 0)[0]!.content).not.toContain(
      AI_CONTEXT_PROMPT_HEADING,
    );
  });
});
