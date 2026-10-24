import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import logger from "../../../../../Server/Utils/Logger";
import { AI_CONTEXT_PROMPT_HEADING } from "../../../../../Server/Utils/AI/AiContext/AiContextPrompt";
import AIConversation from "../../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../../Models/DatabaseModels/AIRunEvent";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIChatPermissionMode from "../../../../../Types/AI/AIChatPermissionMode";
import AIRunEventType from "../../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import { AiContextSource } from "../../../../../Types/AI/AiContext";
import { LLMMessage } from "../../../../../Server/Utils/LLM/LLMService";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ASK AI READS THE PROJECT'S AI CONTEXT ON EVERY TURN (ChatAgentRunner:
 * the Dashboard's Ask AI, and an incident's or alert's shared thread):
 * first in the turn's system prompt, recorded in the turn's activity right
 * after it starts - and for a shared thread, the notes of the AI rules
 * that investigate its incident, as its investigation read them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOTES: string =
  "## Glossary\n- PSP: our payment service provider (Adyen).";

function request(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    projectId: PROJECT_ID,
    userId: ObjectID.generate(),
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.ReadOnly,
    props: { userId: ObjectID.generate() },
    ...overrides,
  };
}

function answer(): AILogResponse {
  return {
    content: "The PSP is Adyen.",
    toolCalls: undefined,
    stopReason: "stop",
    llmLog: { totalTokens: 10, costInUSDCents: 1 },
  } as unknown as AILogResponse;
}

describe("ChatAgentRunner.runTurn: the project's AI context", () => {
  let events: Array<AIRunEvent>;
  let execute: SpyInstance<typeof AIService.executeWithLogging>;
  let projectRead: SpyInstance<typeof ProjectService.findOneById>;
  let notes: string | undefined;

  function systemMessage(): LLMMessage {
    // The turn's own call is the first; a title call may follow it.
    return (execute.mock.calls[0]![0] as AILogRequest).messages[0]!;
  }

  function aiContextEvents(): Array<AIRunEvent> {
    return events.filter((event: AIRunEvent): boolean => {
      return Boolean(event.resultSummary?.aiContext);
    });
  }

  beforeEach(() => {
    events = [];
    notes = NOTES;

    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (data: unknown) => {
        const event: AIRunEvent = (data as { data: AIRunEvent }).data;
        events.push(event);
        return event;
      });
    jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(
        Object.assign(new AIRun(), { status: AIRunStatus.Running }) as never,
      );
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1 as never);
    jest
      .spyOn(AIConversationMessageService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(AIConversationMessageService, "countBy")
      .mockResolvedValue(new PositiveNumber(5) as never);
    jest
      .spyOn(AIConversationMessageService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(AIConversationMessageService, "updateOneBy")
      .mockResolvedValue(1 as never);
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(new AIConversation() as never);
    jest
      .spyOn(AIConversationService, "updateOneById")
      .mockResolvedValue(1 as never);
    execute = jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue(answer());
    projectRead = jest
      .spyOn(ProjectService, "findOneById")
      .mockImplementation(async (data: { id: ObjectID }) => {
        const project: Project = new Project(data.id);

        if (notes !== undefined) {
          project.aiContext = notes;
        }

        return project;
      });
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("first in the turn's system prompt, read from the turn's own project", async () => {
    await ChatAgentRunner.runTurn(request());

    expect(projectRead).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: { aiContext: true },
      props: { isRoot: true },
    });
    expect(systemMessage().role).toBe("system");
    expect(systemMessage().content.startsWith(AI_CONTEXT_PROMPT_HEADING)).toBe(
      true,
    );
    expect(systemMessage().content.indexOf(NOTES)).toBeLessThan(
      systemMessage().content.indexOf(
        "You are OneUptime's observability copilot",
      ),
    );
  });

  test("recorded in the turn's activity, word for word, right after it starts", async () => {
    await ChatAgentRunner.runTurn(request());

    expect(events[0]!.eventType).toBe(AIRunEventType.RunStarted);
    expect(events[1]!.eventType).toBe(AIRunEventType.ProgressLog);
    expect(events[1]!.resultSummary!.aiContext!.parts).toEqual([
      { source: AiContextSource.Project, text: NOTES },
    ]);
    expect(aiContextEvents()).toHaveLength(1);
  });

  test("a shared thread adds the notes of the rules that investigate its incident, after the project's", async () => {
    await ChatAgentRunner.runTurn(
      request({
        isSharedThread: true,
        additionalSystemInstructions:
          "You are answering in the shared thread of incident #42.",
        aiContextRules: [
          { id: "r1", name: "Checkout", aiContext: "Checkout runs on k8s." },
        ],
      }),
    );

    const content: string = systemMessage().content;

    expect(content.indexOf(NOTES)).toBeLessThan(
      content.indexOf("Checkout runs on k8s."),
    );
    expect(content.indexOf("Checkout runs on k8s.")).toBeLessThan(
      content.indexOf(
        "You are answering in the shared thread of incident #42.",
      ),
    );
    expect(
      aiContextEvents()[0]!.resultSummary!.aiContext!.parts.map(
        (part: { source: AiContextSource }) => {
          return part.source;
        },
      ),
    ).toEqual([AiContextSource.Project, AiContextSource.AiRule]);
  });

  test("a project with no notes: nothing recorded, and the prompt is the one it always was", async () => {
    notes = undefined;

    await ChatAgentRunner.runTurn(request());

    expect(aiContextEvents()).toHaveLength(0);
    expect(
      systemMessage().content.startsWith(
        "You are OneUptime's observability copilot",
      ),
    ).toBe(true);
    expect(systemMessage().content).not.toContain(AI_CONTEXT_PROMPT_HEADING);
  });

  test("notes that cannot be read never fail the turn", async () => {
    projectRead.mockRejectedValue(new Error("down"));

    await ChatAgentRunner.runTurn(request());

    expect(execute).toHaveBeenCalled();
    expect(systemMessage().content).not.toContain(AI_CONTEXT_PROMPT_HEADING);
    expect(
      events.some((event: AIRunEvent): boolean => {
        return event.eventType === AIRunEventType.RunCompleted;
      }),
    ).toBe(true);
  });
});
