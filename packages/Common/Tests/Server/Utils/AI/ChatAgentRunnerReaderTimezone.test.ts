import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import { ToolContext } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import Timezone from "../../../../Types/Timezone";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * AN ASK AI TURN HANDS ITS TOOLS THE ASKER'S TIME ZONE (issue #7922).
 *
 * The request that starts a turn, and the approval that resumes one, carry
 * the zone the asker reads the Dashboard's charts in (ChatTurnRequest
 * .timezone). The turn's tools read it as ToolContext.readerTimezone, and a
 * chart over more than a week cuts its days at that midnight. A zone the
 * Timezone list does not name never reaches them, and a legacy name reaches
 * them by its current name. The model is never told the zone: it changes
 * where a day starts, not what the model is asked.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

function response(data: {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: JSONObject }>;
}): AILogResponse {
  return {
    content: data.content ?? "",
    toolCalls: data.toolCalls,
    llmLog: { totalTokens: 10, costInUSDCents: 1 },
  } as unknown as AILogResponse;
}

function buildRequest(overrides?: Partial<ChatTurnRequest>): ChatTurnRequest {
  return {
    projectId: ObjectID.generate(),
    userId: ObjectID.generate(),
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.AutoRun,
    props: { userId: ObjectID.generate() },
    ...overrides,
  };
}

interface Spies {
  executeWithLogging: jest.SpyInstance;
  executeTool: jest.SpyInstance;
}

// A turn that asks for one metric chart over the past month, then answers.
function installSpies(): Spies {
  jest.spyOn(AIRunEventService, "create").mockResolvedValue({} as never);
  jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);

  const run: AIRun = new AIRun();
  run.status = AIRunStatus.Running;
  jest.spyOn(AIRunService, "findOneById").mockResolvedValue(run as never);
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1 as never);
  jest
    .spyOn(AIConversationMessageService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(AIConversationMessageService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
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

  const executeWithLogging: jest.SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValueOnce(
      response({
        toolCalls: [
          {
            id: "call-metrics",
            name: "query_metrics",
            arguments: {
              metricName: "checkout.orders",
              startTime: "2026-10-16T15:00:00.000Z",
              endTime: "2026-11-15T15:00:00.000Z",
            },
          },
        ],
      }) as never,
    )
    .mockResolvedValue(response({ content: "Orders held steady." }) as never);

  const executeTool: jest.SpyInstance = jest
    .spyOn(AIToolbox, "executeTool")
    .mockResolvedValue({
      success: true,
      textForLlm: "30 days of orders",
      result: {
        dataForLlm: "30 days of orders",
        rowCount: 30,
        citationLabel: "Sum(checkout.orders)",
        redactionCount: 0,
        isTruncated: false,
      },
    } as never);

  return { executeWithLogging, executeTool };
}

// The context the one tool call of the turn ran in.
function toolContextOf(spies: Spies): ToolContext {
  expect(spies.executeTool).toHaveBeenCalledTimes(1);
  return (spies.executeTool.mock.calls[0]![0] as { ctx: ToolContext }).ctx;
}

describe("ChatAgentRunner.runTurn hands its tools the asker's time zone", () => {
  test.each([
    Timezone.AmericaNew_York,
    Timezone.EuropeLondon,
    Timezone.AsiaKolkata,
    Timezone.AsiaKathmandu,
    Timezone.UTC,
  ])("a turn asked in %s", async (timezone: Timezone) => {
    const spies: Spies = installSpies();

    await ChatAgentRunner.runTurn(buildRequest({ timezone }));

    expect(toolContextOf(spies).readerTimezone).toBe(timezone);
  });

  test("a legacy name reaches the tools by its current name", async () => {
    const spies: Spies = installSpies();

    await ChatAgentRunner.runTurn(
      buildRequest({ timezone: Timezone.AsiaCalcutta }),
    );

    expect(toolContextOf(spies).readerTimezone).toBe(Timezone.AsiaKolkata);
  });

  test.each([
    "Mars/Olympus_Mons",
    "america/new_york",
    "UTC'); DROP TABLE Metric; --",
  ])(
    "a zone the list does not name (%s) never reaches the tools",
    async (timezone: string) => {
      const spies: Spies = installSpies();

      await ChatAgentRunner.runTurn(
        buildRequest({ timezone: timezone as Timezone }),
      );

      expect("readerTimezone" in toolContextOf(spies)).toBe(false);
    },
  );

  test("a turn with no zone - an older Dashboard - hands its tools none", async () => {
    const spies: Spies = installSpies();

    await ChatAgentRunner.runTurn(buildRequest());

    expect("readerTimezone" in toolContextOf(spies)).toBe(false);
  });

  test("the model is never told the zone", async () => {
    const spies: Spies = installSpies();

    await ChatAgentRunner.runTurn(
      buildRequest({ timezone: Timezone.AsiaKathmandu }),
    );

    expect(toolContextOf(spies).readerTimezone).toBe(Timezone.AsiaKathmandu);
    for (const call of spies.executeWithLogging.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain("Kathmandu");
    }
  });
});

describe("the tool context a turn builds", () => {
  type BuildToolContext = (
    request: ChatTurnRequest,
    pageContext: undefined,
  ) => ToolContext;

  // Built the same way for a turn that starts and one an approval resumes.
  const buildToolContext: BuildToolContext = (
    ChatAgentRunner as unknown as { buildToolContext: BuildToolContext }
  ).buildToolContext.bind(ChatAgentRunner);

  test("carries the zone beside the language, and only what each reader keeps", () => {
    const request: ChatTurnRequest = buildRequest({
      timezone: Timezone.AmericaNew_York,
      language: "de",
    });

    expect(buildToolContext(request, undefined)).toEqual({
      projectId: request.projectId,
      props: request.props,
      language: "de",
      readerTimezone: Timezone.AmericaNew_York,
    });
    expect(
      buildToolContext(
        buildRequest({ timezone: "Mars/Olympus_Mons" as Timezone }),
        undefined,
      ),
    ).not.toHaveProperty("readerTimezone");
  });
});
