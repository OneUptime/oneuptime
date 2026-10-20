/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it. Nothing here touches password hashing.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

/*
 * The job module registers its cron when it is imported; the queue under it
 * is replaced so the import opens no Redis connection.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
    default: {
      addJob: jest.fn(() => {
        return Promise.resolve(undefined);
      }),
    },
  };
});

import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import { importLlmChatSpans } from "../../FeatureSet/Workers/Jobs/LlmObservability/PullLlmConnections";
import LlmChatSpanPayload, {
  LLM_CHAT_APP_ATTRIBUTE,
} from "Common/Server/Utils/LlmObservability/LlmChatSpanPayload";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import {
  LlmChatPartType,
  LlmChatRole,
  LlmChatTurn,
} from "Common/Types/LlmObservability/LlmConnectionRecords";
import { LLM_CONNECTION_ID_ATTRIBUTE } from "Common/Types/LlmObservability/LlmProviderUsageMetrics";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A company AI tool's chats through the REAL span ingest loop, the way the
 * worker hands them over (importLlmChatSpans): each turn is stored as an AI
 * call the Conversations and Calls tabs read - its conversation, the person
 * who asked, the model, what was asked and answered, the app it was asked
 * in - with no tokens and no cost, since these tools are paid per seat. With
 * "keep what was written" off, the stored call has no text at all.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";
const SERVICE_NAME: string = "Claude Enterprise";

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

const TURN: LlmChatTurn = {
  turnId: "msg_answer_1",
  conversationId: "claude_chat_A",
  conversationTitle: "Incident policy",
  personEmail: "erin@example.com",
  personId: "user_01",
  personName: "Erin",
  model: "claude-opus-5-5",
  app: "",
  startedAt: new Date("2026-10-19T09:00:00.250Z"),
  endedAt: new Date("2026-10-19T09:00:20.750Z"),
  question: [
    {
      id: "q1",
      role: LlmChatRole.User,
      createdAt: new Date("2026-10-19T09:00:00.250Z"),
      parts: [
        { type: LlmChatPartType.Text, text: "Summarize our incident policy." },
      ],
    },
  ],
  answer: [
    {
      id: "a1",
      role: LlmChatRole.Assistant,
      createdAt: new Date("2026-10-19T09:00:20.750Z"),
      parts: [{ type: LlmChatPartType.Text, text: "Here is the summary." }],
    },
  ],
  url: "https://claude.ai/chat/claude_chat_A",
};

function setup(): Array<JSONObject> {
  const capturedRows: Array<JSONObject> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelTracesIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: SERVICE_NAME,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });

  jest
    .spyOn(service, "submitSpansBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      capturedRows.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });
  jest
    .spyOn(service, "submitExceptionsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      rows.splice(0, rows.length);
      return Promise.resolve();
    });

  jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);

  return capturedRows;
}

async function ingest(data: {
  turns: Array<LlmChatTurn>;
  keepText?: boolean;
  genAiProviderName?: string;
}): Promise<Array<JSONObject>> {
  const rows: Array<JSONObject> = setup();

  await importLlmChatSpans({
    projectId: PROJECT_ID,
    payload: LlmChatSpanPayload.build({
      turns: data.turns,
      connectionId: CONNECTION_ID,
      connectionName: "Claude at Acme",
      serviceName: SERVICE_NAME,
      genAiProviderName: data.genAiProviderName || "anthropic",
      keepText: data.keepText !== false,
    }),
  });

  return rows;
}

function attributesOf(row: JSONObject): Record<string, unknown> {
  return (row["attributes"] || {}) as Record<string, unknown>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a company AI tool's turn is stored as an AI call", () => {
  test("of its conversation and person, with its model, and with what was asked and answered", async () => {
    const rows: Array<JSONObject> = await ingest({ turns: [TURN] });

    expect(rows).toHaveLength(1);
    const row: JSONObject = rows[0]!;

    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect(row["primaryEntityId"]).toBe(SERVICE_ID.toString());
    expect(row["spanId"]).toBe(
      LlmChatSpanPayload.spanIdOf(CONNECTION_ID, "msg_answer_1"),
    );
    expect(row["traceId"]).toBe(
      LlmChatSpanPayload.traceIdOf(CONNECTION_ID, "msg_answer_1"),
    );
    expect(row["name"]).toBe("chat claude-opus-5-5");
    expect(row["isLlmSpan"]).toBe(true);
    expect(row["llmRequestModel"]).toBe("claude-opus-5-5");
    expect(row["llmConversationId"]).toBe("claude_chat_A");
    expect(row["llmUserEmail"]).toBe("erin@example.com");
    expect(row["llmCallKind"]).toBe("answer");
    expect(row["llmUserMessagePreview"]).toBe("Summarize our incident policy.");
    // Paid per seat: no tokens, no cost.
    expect(row["llmInputTokens"]).toBe(0);
    expect(row["llmOutputTokens"]).toBe(0);
    expect(row["llmCost"]).toBe(0);
    // The answer took 20.5 seconds from the question.
    expect(Math.round(Number(row["durationUnixNano"]) / 1_000_000)).toBe(
      20_500,
    );

    const attributes: Record<string, unknown> = attributesOf(row);
    expect(attributes[LLM_CONNECTION_ID_ATTRIBUTE]).toBe(CONNECTION_ID);
    expect(String(attributes["gen_ai.input.messages"])).toContain(
      "Summarize our incident policy.",
    );
    expect(String(attributes["gen_ai.output.messages"])).toContain(
      "Here is the summary.",
    );
  });

  test("the app it was asked in is kept for Microsoft 365 Copilot", async () => {
    const rows: Array<JSONObject> = await ingest({
      turns: [{ ...TURN, model: "Microsoft 365 Copilot", app: "Word" }],
      genAiProviderName: "microsoft.copilot",
    });

    expect(attributesOf(rows[0]!)[LLM_CHAT_APP_ATTRIBUTE]).toBe("Word");
    expect(rows[0]!["llmRequestModel"]).toBe("Microsoft 365 Copilot");
  });

  test("with text off, nobody can read what was written - not even its preview", async () => {
    const rows: Array<JSONObject> = await ingest({
      turns: [TURN],
      keepText: false,
    });

    const row: JSONObject = rows[0]!;
    expect(row["llmUserMessagePreview"] || "").toBe("");
    expect(row["llmUserEmail"]).toBe("erin@example.com");
    expect(row["llmConversationId"]).toBe("claude_chat_A");

    const stored: string = JSON.stringify(row);
    for (const words of [
      "incident policy",
      "Here is the summary",
      "claude.ai/chat",
    ]) {
      expect(stored.toLowerCase()).not.toContain(words.toLowerCase());
    }
  });

  test("a question with no answer yet is still a call of the conversation", async () => {
    const rows: Array<JSONObject> = await ingest({
      turns: [
        { ...TURN, turnId: "q_only", answer: [], endedAt: TURN.startedAt },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!["isLlmSpan"]).toBe(true);
    expect(rows[0]!["llmConversationId"]).toBe("claude_chat_A");
    expect(rows[0]!["llmUserMessagePreview"]).toBe(
      "Summarize our incident policy.",
    );
  });

  test("every turn of a batch is stored", async () => {
    const turns: Array<LlmChatTurn> = Array.from(
      { length: 25 },
      (_: unknown, index: number) => {
        return { ...TURN, turnId: `answer_${index}` };
      },
    );

    const rows: Array<JSONObject> = await ingest({ turns });

    expect(rows).toHaveLength(25);
    expect(
      new Set(
        rows.map((row: JSONObject) => {
          return row["spanId"];
        }),
      ).size,
    ).toBe(25);
  });
});
