import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import AIService, {
  AI_DATA_SECURITY_ISSUE_ANALYSIS_FEATURE,
  AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
  AILogRequest,
  AUTONOMOUS_AI_FEATURES,
} from "../../../../../Server/Services/AIService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import DataSecurityAiCall from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import DataSecurityAiInput, {
  AiIssueDossier,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import DataSecurityIssueAnalysis, {
  DataSecurityIssueAnalysisOutcome,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueAnalysis";
import DataSecurityIssueDossier from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueDossier";
import LlmProviderChoice, {
  RuleLlmProviderChoice,
} from "../../../../../Server/Utils/AI/LlmProviderChoice";
import AIInvestigationEngine from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import ProjectDataTypeNames from "../../../../../Server/Utils/DataSecurity/ProjectDataTypeNames";
import logger from "../../../../../Server/Utils/Logger";
import ProjectLanguage from "../../../../../Server/Utils/Notification/ProjectLanguage";
import UserLanguage from "../../../../../Server/Utils/Notification/UserLanguage";
import { DataSecurityAiDecisionReason } from "../../../../../Types/DataSecurity/DataSecurityAiDecision";
import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import {
  DataSecurityAiVerdict,
  DataSecurityIssueAnalysisRecord,
  getAnalysisInputHash,
  readDataSecurityIssueAnalysis,
  toDataSecurityIssueAnalysisJson,
} from "../../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "../../../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../../../Types/DataSecurity/DataStorePosture";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
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
import type { SpyInstance } from "jest-mock";

/*
 * ONEUPTIME AI'S ANALYSIS OF AN ISSUE (#10369): written from what OneUptime
 * knows about the issue, held to its facts, kept on the issue with what it
 * was written from - and never written again from the same facts.
 *
 * Its own, as #10364's engine's Analyze work: autonomous, so the daily
 * budget covers it; keeping nothing in the AI Logs (#10361); on the rule's
 * model when a rule picks one; saying what stopped it instead of throwing.
 * A person's, from the issue's page or Explain with AI: in their language,
 * refused with the project's AI off, and Analyze Again asks anyway.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10369000-0000-4000-8000-000000000001",
);
const ISSUE_ID: ObjectID = new ObjectID("10369000-0000-4000-8000-0000000000a1");
const STORE_ID: string = "10369000-0000-4000-8000-0000000000b1";
const USER_ID: ObjectID = new ObjectID("10369000-0000-4000-8000-0000000000e1");
const PROVIDER_ID: ObjectID = new ObjectID(
  "10369000-0000-4000-8000-0000000000d1",
);
const LOG_ID: ObjectID = new ObjectID("10369000-0000-4000-8000-0000000000f1");
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");

const ANSWER: JSONObject = {
  verdict: "Real",
  reason: {
    text: "Anyone on the internet can read the card numbers in it.",
    facts: ["S2", "S1"],
  },
  risk: { text: "About 12,000 card numbers, for anyone.", facts: ["S1", "R0"] },
  breaks: {
    text: "Nothing OneUptime can see uses it, so blocking breaks nothing.",
    facts: ["N1"],
  },
  path: { text: "Block public access now, from this page.", facts: ["A1"] },
  draft: null,
};

function dossier(overrides: Partial<AiIssueDossier> = {}): AiIssueDossier {
  return {
    issue: {
      _id: ISSUE_ID.toString(),
      checkId: "public-read",
      title: "Anyone on the internet can read it",
      evidence: "The bucket policy grants s3:GetObject to Principal *.",
      severity: SecuritySeverity.Critical,
      dataTypeIds: ["credit-card-number"],
    },
    store: {
      _id: STORE_ID,
      name: "acme-card-exports",
      kind: DataStoreKind.AwsS3Bucket,
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: ["credit-card-number"],
      exposure: DataStoreExposure.Public,
      estimatedRecords: 12_345,
    },
    places: [],
    access: [
      {
        _id: "10369000-0000-4000-8000-0000000000c1",
        principal: "*",
        principalName: "Everyone",
        principalType: DataStorePrincipalType.Public,
        accessLevel: DataStoreAccessLevel.Read,
        grantedVia: "Bucket policy",
        isPublic: true,
        isExternal: true,
      },
    ],
    copies: [],
    securityCaseIds: [],
    responses: [{ action: "Block public access", isAvailable: true }],
    proposals: [],
    declaredCode: null,
    owners: { recordIds: [], names: [], count: 0 },
    now: NOW,
    ...overrides,
  };
}

// What the analysis of dossier() is written from, hashed as the issue keeps it.
function hashOf(data: AiIssueDossier, language: string): string {
  return getAnalysisInputHash({
    data: DataSecurityAiInput.analysisFacts({
      dossier: data,
      dataTypeNamer: DataTypeNamer.withoutCustomTypes(),
    }).data,
    language,
  });
}

// An analysis the issue keeps: of the given verdict, in the given language.
function kept(
  verdict: DataSecurityAiVerdict,
  language: string,
  inputHash: string,
): DataSecurityIssue {
  const record: DataSecurityIssueAnalysisRecord = {
    version: 1,
    verdict,
    language,
    lines: {
      reason: { text: "It looked like it served the website.", facts: ["S3"] },
    },
    facts: [],
  };

  return {
    id: ISSUE_ID,
    aiAnalysis: toDataSecurityIssueAnalysisJson(record),
    aiAnalyzedAt: new Date("2026-11-19T12:00:00.000Z"),
    aiAnalysisInputHash: inputHash,
  } as unknown as DataSecurityIssue;
}

let stored: DataSecurityIssue | null;
let call: SpyInstance<typeof AIService.executeWithLogging>;
let update: SpyInstance<
  typeof DataSecurityIssueService.updateColumnsByIdWithoutHooks
>;
let feed: SpyInstance<
  typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
>;
let blocker: SpyInstance<
  typeof AIInvestigationEngine.getProviderOrBalanceReason
>;
let dossierReads: SpyInstance<typeof DataSecurityIssueDossier.read>;
let projectLanguage: string;

function answering(content: string): void {
  call.mockResolvedValue({
    content,
    llmLog: { id: LOG_ID },
  } as never);
}

async function analyze(
  llmProviderId?: ObjectID,
): Promise<DataSecurityIssueAnalysisOutcome> {
  return await DataSecurityIssueAnalysis.analyze({
    projectId: PROJECT_ID,
    issue: { id: ISSUE_ID } as DataSecurityIssue,
    dataTypeNamer: DataTypeNamer.withoutCustomTypes(),
    llmProviderId,
    now: NOW,
  });
}

// What the analysis wrote on the issue: its columns.
function written(): JSONObject {
  return update.mock.calls[0]![0].data as unknown as JSONObject;
}

beforeEach(() => {
  stored = null;
  projectLanguage = "en";

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null);
  jest
    .spyOn(DataSecurityIssueService, "findOneBy")
    .mockImplementation((async (args: { select: Record<string, unknown> }) => {
      // Only the analysis it keeps is read here; the issue itself is the dossier's.
      expect(Object.keys(args.select).sort()).toEqual(
        [
          "_id",
          "aiAnalysis",
          "aiAnalysisInputHash",
          "aiAnalysisLlmLogId",
          "aiAnalyzedAt",
        ].sort(),
      );

      return stored;
    }) as never);
  dossierReads = jest
    .spyOn(DataSecurityIssueDossier, "read")
    .mockImplementation(async (): Promise<AiIssueDossier> => {
      return dossier();
    });
  jest.spyOn(ProjectLanguage, "getLanguage").mockImplementation(async () => {
    return projectLanguage;
  });
  jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("de");
  jest
    .spyOn(ProjectDataTypeNames, "read")
    .mockResolvedValue(DataTypeNamer.withoutCustomTypes());
  jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
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
  call = jest.spyOn(AIService, "executeWithLogging");
  answering(JSON.stringify(ANSWER));
  update = jest
    .spyOn(DataSecurityIssueService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  feed = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OneUptime AI's own analysis of a new issue", () => {
  test("is kept on the issue: its verdict, the analysis held to its facts, when, and what it was written from", async () => {
    const outcome: DataSecurityIssueAnalysisOutcome = await analyze();

    expect(outcome.analyzed).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0].id).toEqual(ISSUE_ID);

    const columns: JSONObject = written();
    const record: DataSecurityIssueAnalysisRecord | null =
      readDataSecurityIssueAnalysis(columns["aiAnalysis"]);

    expect(columns["aiVerdict"]).toBe(DataSecurityAiVerdict.Real);
    expect(record?.verdict).toBe(DataSecurityAiVerdict.Real);
    expect(record?.language).toBe("en");
    expect(record?.lines.reason).toEqual({
      text: "Anyone on the internet can read the card numbers in it.",
      facts: ["S2", "S1"],
    });
    expect(record?.lines.path?.facts).toEqual(["A1"]);
    expect(columns["aiAnalysisInputHash"]).toBe(hashOf(dossier(), "en"));
    expect(columns["aiAnalysisLlmLogId"]).toEqual(LOG_ID);
    expect(columns["aiAnalyzedAt"]).toBeInstanceOf(Date);
  });

  test("changes nothing but the analysis: never the issue's status, nor its severity", async () => {
    await analyze();

    expect(Object.keys(written()).sort()).toEqual(
      [
        "aiAnalysis",
        "aiAnalysisInputHash",
        "aiAnalysisLlmLogId",
        "aiAnalyzedAt",
        "aiVerdict",
      ].sort(),
    );
  });

  test("is one entry on the issue's timeline, its verdict, with no person behind it", async () => {
    await analyze();

    expect(feed).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        dataSecurityIssueId: ISSUE_ID,
        eventType: DataSecurityIssueFeedEventType.AiAnalysis,
        feedInfoInMarkdown: "OneUptime AI analyzed this issue: **Real**.",
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
    const ask: SpyInstance<typeof DataSecurityAiCall.ask> = jest.spyOn(
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

  test("is asked from the facts, and answered in the project's language", async () => {
    projectLanguage = "ja";

    await analyze();

    const messages: AILogRequest["messages"] = call.mock.calls[0]![0].messages;

    expect(
      messages.map((message: { role: string }) => {
        return message.role;
      }),
    ).toEqual(["system", "user"]);
    expect(messages[0]!.content).toContain("in Japanese.");
    expect(messages[1]!.content).toContain(
      "Anyone on the internet can read it",
    );
    expect(messages[1]!.content).toContain("Card number");
    expect(messages[1]!.content).toContain("Everyone");
    expect(
      readDataSecurityIssueAnalysis(written()["aiAnalysis"])?.language,
    ).toBe("ja");
  });

  test("with nothing it rests on changed, asks the model nothing, writes nothing, and keeps what it has", async () => {
    stored = kept(DataSecurityAiVerdict.Real, "en", hashOf(dossier(), "en"));

    const outcome: DataSecurityIssueAnalysisOutcome = await analyze();

    expect(outcome).toMatchObject({
      analyzed: false,
      reason: DataSecurityAiDecisionReason.AlreadyAnalyzed,
    });
    expect(outcome.analysis?.record.verdict).toBe(DataSecurityAiVerdict.Real);
    expect(call).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test("with what it rests on changed, is written again in the language it was written in, and the timeline says what it said before", async () => {
    stored = kept(
      DataSecurityAiVerdict.LikelyByDesign,
      "fr",
      hashOf(dossier(), "fr").replace(/^./, "0"),
    );
    // The project's people read German now: an analysis is never written again for that alone.
    projectLanguage = "de";

    expect((await analyze()).analyzed).toBe(true);
    expect(call.mock.calls[0]![0].messages[0]!.content).toContain("in French.");
    expect(written()["aiAnalysisInputHash"]).toBe(hashOf(dossier(), "fr"));
    expect(feed.mock.calls[0]![0].feedInfoInMarkdown).toBe(
      "OneUptime AI analyzed this issue again: **Real**. It said **Likely by design** before.",
    );
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

      expect(await analyze()).toEqual({
        analyzed: false,
        reason: decision,
        analysis: null,
      });
      expect(call).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(feed).not.toHaveBeenCalled();
    },
  );

  test("with the project's daily limit reached asks the model nothing, and says why", async () => {
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue({ limit: "tokens" } as never);

    expect(await analyze()).toMatchObject({
      analyzed: false,
      reason: DataSecurityAiDecisionReason.AiDailyLimitReached,
    });
    expect(call).not.toHaveBeenCalled();
  });

  test("that the model refuses, answers with nothing, or answers what is not an analysis, is a failure that keeps nothing, never a throw", async () => {
    call.mockRejectedValue(new Error("AI is turned off for this project."));

    expect(await analyze()).toMatchObject({
      analyzed: false,
      reason: DataSecurityAiDecisionReason.AnalysisFailed,
    });

    for (const content of [
      "   ",
      "It is real. Block public access.",
      '{"verdict": "Fine"}',
    ]) {
      answering(content);

      expect(await analyze()).toMatchObject({
        analyzed: false,
        reason: DataSecurityAiDecisionReason.AnalysisFailed,
      });
    }

    expect(update).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test("an issue it cannot read is a failure, never a throw", async () => {
    dossierReads.mockRejectedValue(new BadDataException("Issue not found."));

    expect(await analyze()).toMatchObject({
      analyzed: false,
      reason: DataSecurityAiDecisionReason.AnalysisFailed,
    });
    expect(call).not.toHaveBeenCalled();
  });

  test("a verdict with no reason resting on a fact is kept as Cannot tell", async () => {
    answering(
      JSON.stringify({
        verdict: "LikelyByDesign",
        reason: { text: "Buckets like this are usually fine.", facts: [] },
      }),
    );

    await analyze();

    expect(written()["aiVerdict"]).toBe(DataSecurityAiVerdict.CannotTell);
  });

  test("a store of Restricted data is never likely by design on OneUptime AI's word", async () => {
    answering(
      JSON.stringify({
        verdict: "LikelyByDesign",
        reason: { text: "It serves the website's files.", facts: ["S3"] },
        draft: { text: "The bucket serves the website.", facts: ["S3"] },
      }),
    );

    await analyze();

    const record: DataSecurityIssueAnalysisRecord | null =
      readDataSecurityIssueAnalysis(written()["aiAnalysis"]);

    expect(record?.verdict).toBe(DataSecurityAiVerdict.CannotTell);
    expect(record?.lines.draft).toBeUndefined();
  });
});

describe("an analysis a person asks for", () => {
  async function analyzeForPerson(force?: boolean): Promise<{
    isNew: boolean;
    verdict: DataSecurityAiVerdict;
  }> {
    const result: Awaited<
      ReturnType<typeof DataSecurityIssueAnalysis.analyzeForPerson>
    > = await DataSecurityIssueAnalysis.analyzeForPerson({
      projectId: PROJECT_ID,
      issueId: ISSUE_ID,
      userId: USER_ID,
      force,
      now: NOW,
    });

    return { isNew: result.isNew, verdict: result.analysis.record.verdict };
  }

  test("with the project's AI off is refused before anything is read", async () => {
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockRejectedValue(
        new BadDataException("AI is turned off for this project."),
      );

    await expect(analyzeForPerson()).rejects.toThrow(
      "AI is turned off for this project.",
    );
    expect(dossierReads).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  test("an issue never analyzed is analyzed in the language of the person who asked, under their name", async () => {
    expect(await analyzeForPerson()).toEqual({
      isNew: true,
      verdict: DataSecurityAiVerdict.Real,
    });

    const request: AILogRequest = call.mock.calls[0]![0];

    expect(request.feature).toBe(AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE);
    expect(request.userId).toEqual(USER_ID);
    expect(request.messages[0]!.content).toContain("in German.");
    expect(feed.mock.calls[0]![0].userId).toEqual(USER_ID);
  });

  test("with nothing it rests on changed: the analysis the issue keeps, and no model call", async () => {
    stored = kept(DataSecurityAiVerdict.Real, "en", hashOf(dossier(), "en"));

    expect(await analyzeForPerson()).toEqual({
      isNew: false,
      verdict: DataSecurityAiVerdict.Real,
    });
    expect(call).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test("Analyze Again asks anyway, in the language of the person asking", async () => {
    stored = kept(
      DataSecurityAiVerdict.LikelyByDesign,
      "en",
      hashOf(dossier(), "en"),
    );

    expect(await analyzeForPerson(true)).toEqual({
      isNew: true,
      verdict: DataSecurityAiVerdict.Real,
    });
    expect(call.mock.calls[0]![0].messages[0]!.content).toContain("in German.");
    expect(feed.mock.calls[0]![0].feedInfoInMarkdown).toBe(
      "OneUptime AI analyzed this issue again: **Real**. It said **Likely by design** before.",
    );
  });

  test("an answer that is not an analysis is said in words, and nothing is kept", async () => {
    answering("I cannot help with that.");

    await expect(analyzeForPerson()).rejects.toThrow(
      "OneUptime AI's answer could not be read as an analysis. Try again in a moment.",
    );
    expect(update).not.toHaveBeenCalled();
  });
});
