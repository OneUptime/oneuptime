import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import AIService, {
  AI_DATA_SECURITY_ISSUE_ANALYSIS_FEATURE,
  AILogRequest,
  AUTONOMOUS_AI_FEATURES,
} from "../../../../../Server/Services/AIService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import DataSecurityIssueAnalysis from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueAnalysis";
import AIInvestigationEngine from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import DataSecurityAiCall from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import DataSecurityAiReads from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiReads";
import LlmProviderChoice, {
  RuleLlmProviderChoice,
} from "../../../../../Server/Utils/AI/LlmProviderChoice";
import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import logger from "../../../../../Server/Utils/Logger";
import { DataSecurityAiDecisionReason } from "../../../../../Types/DataSecurity/DataSecurityAiDecision";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import ObjectID from "../../../../../Types/ObjectID";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONEUPTIME AI'S OWN ANALYSIS OF A NEW DATA SECURITY ISSUE (#10364): the
 * explanation Explain with AI writes, written with no one pressing it -
 * autonomous, so the daily budget covers it; keeping nothing in the AI Logs
 * (#10361); on the rule's model when a rule picks one; and saying what
 * stopped it instead of throwing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10364000-0000-4000-8000-000000000001",
);
const ISSUE_ID: ObjectID = new ObjectID("10364000-0000-4000-8000-0000000000a1");
const PROVIDER_ID: ObjectID = new ObjectID(
  "10364000-0000-4000-8000-0000000000d1",
);

function issue(): DataSecurityIssue {
  return {
    id: ISSUE_ID,
    checkId: "public-read",
    title: "Anyone on the internet can read it",
    evidence: "The bucket policy grants s3:GetObject to Principal *.",
    severity: SecuritySeverity.Critical,
    dataTypeIds: ["credit-card-number"],
    dataStoreId: new ObjectID("10364000-0000-4000-8000-0000000000b1"),
    dataStore: { name: "acme-card-exports", kind: "AWS S3 Bucket" },
  } as unknown as DataSecurityIssue;
}

let call: jest.SpiedFunction<typeof AIService.executeWithLogging>;
let feed: jest.SpiedFunction<
  typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
>;
let blocker: jest.SpiedFunction<
  typeof AIInvestigationEngine.getProviderOrBalanceReason
>;

async function analyze(
  llmProviderId?: ObjectID,
): Promise<{ analyzed: boolean; reason?: DataSecurityAiDecisionReason }> {
  return (await DataSecurityIssueAnalysis.analyze({
    projectId: PROJECT_ID,
    issue: issue(),
    dataTypeNamer: DataTypeNamer.withoutCustomTypes(),
    llmProviderId,
  })) as { analyzed: boolean; reason?: DataSecurityAiDecisionReason };
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null);
  // The issue and its places, as the input builder reads them (#10365).
  jest
    .spyOn(DataSecurityAiReads, "readIssue")
    .mockResolvedValue(issue() as never);
  jest.spyOn(DataSecurityAiReads, "readPlaces").mockResolvedValue([]);
  // The rule's pick, when there is one, is the provider the call runs on.
  jest
    .spyOn(LlmProviderChoice, "decideIfPicked")
    .mockImplementation(
      async (data: {
        pickedProviderId?: unknown;
      }): Promise<RuleLlmProviderChoice> => {
        return {
          pickedProviderId: data.pickedProviderId
            ? String(data.pickedProviderId)
            : "",
          llmProviderId: data.pickedProviderId
            ? (data.pickedProviderId as ObjectID)
            : undefined,
        } as unknown as RuleLlmProviderChoice;
      },
    );
  blocker = jest
    .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
    .mockResolvedValue(null);
  jest.spyOn(AIService, "getReachedProjectDailyLimit").mockResolvedValue(null);
  call = jest.spyOn(AIService, "executeWithLogging").mockResolvedValue({
    content:
      "Anyone can download the card numbers. Turn on Block Public Access.",
  } as never);
  feed = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OneUptime AI's analysis of a new issue", () => {
  test("is written on the issue's timeline as OneUptime AI's, with no person behind it", async () => {
    expect(await analyze()).toEqual({ analyzed: true });
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        dataSecurityIssueId: ISSUE_ID,
        eventType: "AiExplanation",
        feedInfoInMarkdown: "OneUptime AI analyzed this issue on its own.",
        moreInformationInMarkdown: expect.stringContaining(
          "Turn on Block Public Access.",
        ),
      }),
    );
    expect(feed.mock.calls[0]![0].userId).toBeUndefined();
  });

  test("is an autonomous call that keeps neither the issue nor the answer in the AI Logs", async () => {
    await analyze();

    const request: AILogRequest = call.mock.calls[0]![0];

    expect(request.feature).toBe(AI_DATA_SECURITY_ISSUE_ANALYSIS_FEATURE);
    expect(AUTONOMOUS_AI_FEATURES).toContain(
      AI_DATA_SECURITY_ISSUE_ANALYSIS_FEATURE,
    );
    expect(request.storeContentPreviews).toBe(false);
    expect(request.storeErrorDetails).toBe(false);
    expect(request.userId).toBeUndefined();
    expect(request.llmProviderId).toBeUndefined();
  });

  test("is built by the input builder, as its own feature, and asked through the one Data Security call", async () => {
    const ask: jest.SpiedFunction<typeof DataSecurityAiCall.ask> = jest.spyOn(
      DataSecurityAiCall,
      "ask",
    );

    await analyze();

    const request: Parameters<typeof DataSecurityAiCall.ask>[0] =
      ask.mock.calls[0]![0];

    expect(request.prompt.feature).toBe(DataSecurityAiFeature.AnalyzeIssue);
    // No person started it: the call's own messages and bounds hold.
    expect(request.protectRequestParameters).toBe(true);
    expect(request.userId).toBeUndefined();
  });

  test("tells OneUptime AI what Explain tells it - the issue as its check saw it", async () => {
    await analyze();

    const messages: AILogRequest["messages"] = call.mock.calls[0]![0].messages;

    expect(
      messages.map((message: { role: string }) => {
        return message.role;
      }),
    ).toEqual(["system", "user"]);
    expect(messages[1]!.content).toContain(
      "Anyone on the internet can read it",
    );
    expect(messages[1]!.content).toContain("Card number");
  });

  test("runs on the LLM provider the Data Security AI rule picks", async () => {
    await analyze(PROVIDER_ID);

    expect(call.mock.calls[0]![0].llmProviderId).toEqual(PROVIDER_ID);
    expect(blocker).toHaveBeenCalledWith(PROJECT_ID, PROVIDER_ID);
  });

  test.each([
    ["provider_missing", DataSecurityAiDecisionReason.NoLlmProvider],
    ["insufficient_ai_balance", DataSecurityAiDecisionReason.NoAiCredits],
  ] as const)(
    "with %s asks the model nothing, and says why",
    async (
      reason: "provider_missing" | "insufficient_ai_balance",
      decision: DataSecurityAiDecisionReason,
    ) => {
      blocker.mockResolvedValue(reason);

      expect(await analyze()).toEqual({ analyzed: false, reason: decision });
      expect(call).not.toHaveBeenCalled();
      expect(feed).not.toHaveBeenCalled();
    },
  );

  test("with the project's daily limit reached asks the model nothing, and says why", async () => {
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue({ limit: "tokens" } as never);

    expect(await analyze()).toEqual({
      analyzed: false,
      reason: DataSecurityAiDecisionReason.AiDailyLimitReached,
    });
    expect(call).not.toHaveBeenCalled();
  });

  test("that the model refuses, or answers with nothing, is a failure, never a throw", async () => {
    call.mockRejectedValue(new Error("AI is turned off for this project."));

    expect(await analyze()).toEqual({
      analyzed: false,
      reason: DataSecurityAiDecisionReason.AnalysisFailed,
    });

    call.mockResolvedValue({ content: "   " } as never);

    expect(await analyze()).toEqual({
      analyzed: false,
      reason: DataSecurityAiDecisionReason.AnalysisFailed,
    });
    expect(feed).not.toHaveBeenCalled();
  });
});
