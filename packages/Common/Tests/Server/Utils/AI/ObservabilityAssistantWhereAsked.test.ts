import ObservabilityAssistant from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ObservabilityChatApp } from "../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import { ToolContext } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * WHERE A SLACK OR MICROSOFT TEAMS QUESTION IS ASKED (#5315's and #5409's
 * follow-ups).
 *
 * The assistant behind OneUptime AI's answers in Slack and Microsoft Teams
 * (and autonomous runs) is told:
 *
 *   - which chat app the answer is read in, with its commands and the link
 *     to Ask AI in the Dashboard: asked to change something, it says how
 *     to from there, never "switch modes";
 *   - the incident or alert whose own channel the question was asked in,
 *     as Ask AI opened on its page knows it - in the system prompt, and in
 *     the context its tools read;
 *   - nothing of a chat app when the run is an autonomous one.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const SLACK: ObservabilityChatApp = {
  name: "Slack",
  incidentCommand: "/oneuptime incident",
  pageCommand: "/oneuptime page",
  askAiUrl:
    "https://oneuptime.example.com/dashboard/" +
    PROJECT_ID.toString() +
    "/ai/chat",
};

const INCIDENT_CHANNEL: AIChatPageContext = {
  type: AIChatPageContextType.Incident,
  entityId: INCIDENT_ID,
  entityTitle: "INC-42 Checkout is down",
};

function response(data: {
  content?: string;
  stopReason?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: JSONObject }>;
}): AILogResponse {
  return {
    content: data.content ?? "",
    toolCalls: data.toolCalls,
    stopReason: data.stopReason,
    llmLog: { totalTokens: 10, llmProviderName: "Test", modelName: "m" },
  } as unknown as AILogResponse;
}

// The system prompt the model was first handed.
function systemPromptOf(executeWithLogging: jest.SpyInstance): string {
  const request: AILogRequest = executeWithLogging.mock
    .calls[0]![0] as AILogRequest;

  return String(request.messages[0]!.content);
}

describe("an answer read in Slack", () => {
  test("is told it reads only, and how to make a change from Slack - never to switch modes", async () => {
    const executeWithLogging: jest.SpyInstance = jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue(response({ content: "Done." }) as never);

    await ObservabilityAssistant.answerQuestion({
      projectId: PROJECT_ID,
      props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
      question: "Create an incident for the checkout outage.",
      feature: "Slack ChatOps",
      aiContext: null,
      chatApp: SLACK,
    });

    const prompt: string = systemPromptOf(executeWithLogging);

    expect(prompt).toContain(
      "You are answering in Slack, where OneUptime AI only reads.",
    );
    expect(prompt).toContain(
      "declare an incident with `/oneuptime incident <title>`",
    );
    expect(prompt).toContain(
      "`/oneuptime incident <number>`, which shows its buttons",
    );
    expect(prompt).toContain("page a person or a team with `/oneuptime page`");
    expect(prompt).toContain(SLACK.askAiUrl);
    expect(prompt).toContain(
      "Slack has no modes: never tell them to switch modes.",
    );
    expect(prompt).not.toContain("switch modes to let you act");
    expect(prompt).not.toContain("permission mode");
  });

  test("asked in an incident's own channel, the question is about that incident - in the prompt and for its tools", async () => {
    const executeWithLogging: jest.SpyInstance = jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValueOnce(
        response({
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call-1",
              name: "query_incidents",
              arguments: { incidentId: INCIDENT_ID },
            },
          ],
        }) as never,
      )
      .mockResolvedValue(response({ content: "It is down." }) as never);

    const contexts: Array<ToolContext> = [];
    jest.spyOn(AIToolbox, "executeTool").mockImplementation((async (data: {
      ctx: ToolContext;
    }): Promise<ToolCallOutcome> => {
      contexts.push(data.ctx);
      return {
        success: true,
        textForLlm: "INC-42 is open.",
        result: {
          dataForLlm: "INC-42 is open.",
          rowCount: 1,
          citationLabel: "INC-42",
          redactionCount: 0,
          isTruncated: false,
        },
      };
    }) as never);

    await ObservabilityAssistant.answerQuestion({
      projectId: PROJECT_ID,
      props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
      question: "Why did this happen?",
      feature: "Slack ChatOps",
      aiContext: null,
      chatApp: SLACK,
      pageContext: INCIDENT_CHANNEL,
    });

    const prompt: string = systemPromptOf(executeWithLogging);

    expect(prompt).toContain("## Current channel context");
    expect(prompt).toContain(
      'The user is asking in the Slack channel of an incident titled "INC-42 Checkout is down".',
    );
    expect(prompt).toContain(`incidentId="${INCIDENT_ID}"`);
    expect(prompt).toContain("assume they mean this channel's incident");
    expect(prompt).not.toContain("## Current page context");

    // Its tools read the same subject, as Ask AI's do on the incident's page.
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.pageContext).toEqual(INCIDENT_CHANNEL);
  });
});

describe("an autonomous run", () => {
  test("is told it reads only, with nobody to tell about modes or chat commands", async () => {
    const executeWithLogging: jest.SpyInstance = jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue(response({ content: "Report." }) as never);

    await ObservabilityAssistant.answerQuestion({
      projectId: PROJECT_ID,
      props: { isRoot: true },
      question: "Investigate incident INC-42.",
      feature: "AI Incident Investigation",
      aiContext: null,
    });

    const prompt: string = systemPromptOf(executeWithLogging);

    expect(prompt).toContain("5. This run is READ-ONLY");
    expect(prompt).not.toContain("switch modes");
    expect(prompt).not.toContain("/oneuptime");
    expect(prompt).not.toContain("Ask to act");
  });
});
