import SentinelConfidenceSignal, {
  CONFIDENCE_CLASSIFICATION_FEATURE,
  ConfidenceSignal,
  EvidenceInput,
} from "../../../../Server/Utils/AI/Sentinel/ConfidenceSignal";
import AIService, {
  AILogResponse,
  AUTONOMOUS_AI_FEATURES,
} from "../../../../Server/Services/AIService";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * The G6 structured confidence signal: no control-flow decision may derive
 * from free-form model prose. Under test: the deterministic evidence floor
 * (zero server-minted evidence → inconclusive, always, no LLM spent), the
 * word-bounded CONFIDENT/INCONCLUSIVE token parse, the PER-CONSUMER fail
 * directions (ping fails louder; instrumentation-PR creation fails toward
 * doing nothing), and computeConfidenceSignal's never-throws contract.
 */

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();

function fakeCitation(rowCount: number): AIChatCitation {
  return {
    id: `C${rowCount}`,
    toolName: "search_logs",
    label: "Logs",
    queryArguments: {},
    rowCount,
  } as AIChatCitation;
}

function evidence(data: Partial<EvidenceInput>): EvidenceInput {
  return {
    citationCount: 0,
    dataBearingToolCallCount: 0,
    anyToolReturnedData: false,
    ...data,
  };
}

function fakeLlmResponse(content: string): AILogResponse {
  return { content } as unknown as AILogResponse;
}

describe("SentinelConfidenceSignal.evidenceFromCitations", () => {
  test("no citations → zero evidence", () => {
    expect(SentinelConfidenceSignal.evidenceFromCitations([])).toEqual({
      citationCount: 0,
      dataBearingToolCallCount: 0,
      anyToolReturnedData: false,
    });
  });

  test("counts data-bearing citations separately from row-less ones", () => {
    expect(
      SentinelConfidenceSignal.evidenceFromCitations([
        fakeCitation(0),
        fakeCitation(3),
        fakeCitation(12),
      ]),
    ).toEqual({
      citationCount: 3,
      dataBearingToolCallCount: 2,
      anyToolReturnedData: true,
    });
  });

  test("citations whose every result was empty carry no data", () => {
    expect(
      SentinelConfidenceSignal.evidenceFromCitations([
        fakeCitation(0),
        fakeCitation(0),
      ]),
    ).toEqual({
      citationCount: 2,
      dataBearingToolCallCount: 0,
      anyToolReturnedData: false,
    });
  });
});

describe("SentinelConfidenceSignal.hasVerifiableEvidence (deterministic floor)", () => {
  test("zero citations AND zero data-bearing tool calls → no evidence, always", () => {
    expect(SentinelConfidenceSignal.hasVerifiableEvidence(evidence({}))).toBe(
      false,
    );
  });

  test("a single minted citation passes the floor (rowCount 0 is proof of absence — still server-verified evidence)", () => {
    expect(
      SentinelConfidenceSignal.hasVerifiableEvidence(
        evidence({ citationCount: 1 }),
      ),
    ).toBe(true);
  });

  test("a data-bearing tool call passes the floor even without a citation count (defensive OR)", () => {
    expect(
      SentinelConfidenceSignal.hasVerifiableEvidence(
        evidence({ dataBearingToolCallCount: 1 }),
      ),
    ).toBe(true);
    expect(
      SentinelConfidenceSignal.hasVerifiableEvidence(
        evidence({ anyToolReturnedData: true }),
      ),
    ).toBe(true);
  });
});

describe("SentinelConfidenceSignal.parseClassificationToken", () => {
  test("exact single tokens parse (case-insensitively, whitespace-tolerant)", () => {
    expect(SentinelConfidenceSignal.parseClassificationToken("CONFIDENT")).toBe(
      true,
    );
    expect(
      SentinelConfidenceSignal.parseClassificationToken(" inconclusive\n"),
    ).toBe(false);
    expect(SentinelConfidenceSignal.parseClassificationToken("confident")).toBe(
      true,
    );
  });

  test("a token embedded in editorializing prose still parses", () => {
    expect(
      SentinelConfidenceSignal.parseClassificationToken(
        "The analysis is CONFIDENT.",
      ),
    ).toBe(true);
    expect(
      SentinelConfidenceSignal.parseClassificationToken(
        "I would call this INCONCLUSIVE, the evidence is thin.",
      ),
    ).toBe(false);
  });

  test("a token embedded inside a larger word does not parse (word boundaries)", () => {
    expect(
      SentinelConfidenceSignal.parseClassificationToken("CONFIDENTLY"),
    ).toBeNull();
    expect(
      SentinelConfidenceSignal.parseClassificationToken("inconclusively"),
    ).toBeNull();
  });

  test("both tokens → null (ambiguous)", () => {
    expect(
      SentinelConfidenceSignal.parseClassificationToken(
        "Either CONFIDENT or INCONCLUSIVE, hard to say.",
      ),
    ).toBeNull();
  });

  test("no token / empty / null → null", () => {
    expect(
      SentinelConfidenceSignal.parseClassificationToken("I cannot judge this."),
    ).toBeNull();
    expect(SentinelConfidenceSignal.parseClassificationToken("")).toBeNull();
    expect(SentinelConfidenceSignal.parseClassificationToken(null)).toBeNull();
    expect(
      SentinelConfidenceSignal.parseClassificationToken(undefined),
    ).toBeNull();
  });
});

describe("per-consumer fail directions", () => {
  const floorInconclusive: ConfidenceSignal = {
    confident: false,
    source: "deterministic-floor",
  };
  const classifiedConfident: ConfidenceSignal = {
    confident: true,
    source: "classification",
  };
  const classifiedInconclusive: ConfidenceSignal = {
    confident: false,
    source: "classification",
  };
  const classificationFailed: ConfidenceSignal = {
    confident: false,
    source: "classification-failed",
  };

  test("workspace ping: confident classifications ping; verified-inconclusive stays quiet", () => {
    expect(
      SentinelConfidenceSignal.shouldSendWorkspaceNotification(
        classifiedConfident,
      ),
    ).toBe(true);
    expect(
      SentinelConfidenceSignal.shouldSendWorkspaceNotification(
        classifiedInconclusive,
      ),
    ).toBe(false);
    expect(
      SentinelConfidenceSignal.shouldSendWorkspaceNotification(
        floorInconclusive,
      ),
    ).toBe(false);
  });

  test("workspace ping fails LOUDER: classification-failed → ping sends", () => {
    expect(
      SentinelConfidenceSignal.shouldSendWorkspaceNotification(
        classificationFailed,
      ),
    ).toBe(true);
  });

  test("instrumentation PR: only a POSITIVE inconclusive verdict enqueues", () => {
    expect(
      SentinelConfidenceSignal.shouldEnqueueInstrumentationTask(
        floorInconclusive,
      ),
    ).toBe(true);
    expect(
      SentinelConfidenceSignal.shouldEnqueueInstrumentationTask(
        classifiedInconclusive,
      ),
    ).toBe(true);
    expect(
      SentinelConfidenceSignal.shouldEnqueueInstrumentationTask(
        classifiedConfident,
      ),
    ).toBe(false);
  });

  test("instrumentation PR fails toward DOING NOTHING: classification-failed → no PR", () => {
    expect(
      SentinelConfidenceSignal.shouldEnqueueInstrumentationTask(
        classificationFailed,
      ),
    ).toBe(false);
  });
});

describe("SentinelConfidenceSignal.computeConfidenceSignal", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the deterministic floor short-circuits: zero evidence → inconclusive, NO LLM call — prose cannot fake evidence that was never minted", async () => {
    const executeWithLogging: jest.SpyInstance = jest.spyOn(
      AIService,
      "executeWithLogging",
    );

    const signal: ConfidenceSignal =
      await SentinelConfidenceSignal.computeConfidenceSignal({
        projectId,
        aiRunId,
        analysisMarkdown:
          "**Most likely root cause** — definitely the database, trust me.",
        evidence: evidence({}),
      });

    expect(signal).toEqual({
      confident: false,
      source: "deterministic-floor",
    });
    expect(executeWithLogging).not.toHaveBeenCalled();
  });

  test("floor passes + CONFIDENT token → one budgeted, preview-less, temperature-0 call", async () => {
    const executeWithLogging: jest.SpyInstance = jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue(fakeLlmResponse("CONFIDENT"));

    const signal: ConfidenceSignal =
      await SentinelConfidenceSignal.computeConfidenceSignal({
        projectId,
        aiRunId,
        analysisMarkdown: "The connection pool ran dry [C1].",
        evidence: evidence({
          citationCount: 2,
          dataBearingToolCallCount: 1,
          anyToolReturnedData: true,
        }),
      });

    expect(signal).toEqual({ confident: true, source: "classification" });

    expect(executeWithLogging).toHaveBeenCalledTimes(1);
    expect(executeWithLogging).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        aiRunId,
        // Budget coverage: must be an AUTONOMOUS_AI_FEATURES member.
        feature: CONFIDENCE_CLASSIFICATION_FEATURE,
        // The verdict drives control flow — no prompt previews in LlmLog.
        storeContentPreviews: false,
        temperature: 0,
        maxTokens: 20,
      }),
    );
  });

  test("INCONCLUSIVE token → classified inconclusive", async () => {
    jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue(fakeLlmResponse("INCONCLUSIVE"));

    const signal: ConfidenceSignal =
      await SentinelConfidenceSignal.computeConfidenceSignal({
        projectId,
        aiRunId,
        analysisMarkdown: "Nothing anomalous found in any signal [C1].",
        evidence: evidence({ citationCount: 1 }),
      });

    expect(signal).toEqual({ confident: false, source: "classification" });
  });

  test("unparseable response (neither or both tokens) → classification-failed", async () => {
    const executeWithLogging: jest.SpyInstance = jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue(fakeLlmResponse("CONFIDENT... no wait, INCONCLUSIVE"));

    expect(
      await SentinelConfidenceSignal.computeConfidenceSignal({
        projectId,
        aiRunId,
        analysisMarkdown: "Analysis.",
        evidence: evidence({ citationCount: 1 }),
      }),
    ).toEqual({ confident: false, source: "classification-failed" });

    executeWithLogging.mockResolvedValue(fakeLlmResponse("I cannot say."));

    expect(
      await SentinelConfidenceSignal.computeConfidenceSignal({
        projectId,
        aiRunId,
        analysisMarkdown: "Analysis.",
        evidence: evidence({ citationCount: 1 }),
      }),
    ).toEqual({ confident: false, source: "classification-failed" });
  });

  test("an LLM failure (provider down, daily budget rejection) → classification-failed, never a throw", async () => {
    jest
      .spyOn(AIService, "executeWithLogging")
      .mockRejectedValue(new Error("Daily AI token budget exhausted"));

    await expect(
      SentinelConfidenceSignal.computeConfidenceSignal({
        projectId,
        aiRunId,
        analysisMarkdown: "Analysis.",
        evidence: evidence({ citationCount: 1 }),
      }),
    ).resolves.toEqual({
      confident: false,
      source: "classification-failed",
    });
  });

  test("the analysis is truncated to 8000 chars before it reaches the classifier", async () => {
    const executeWithLogging: jest.SpyInstance = jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue(fakeLlmResponse("CONFIDENT"));

    const analysisMarkdown: string = "H".repeat(8000) + "TAIL_MARKER";

    await SentinelConfidenceSignal.computeConfidenceSignal({
      projectId,
      aiRunId,
      analysisMarkdown,
      evidence: evidence({ citationCount: 1 }),
    });

    const userMessage: { content: string } =
      executeWithLogging.mock.calls[0]![0].messages[1];

    expect(userMessage.content).toContain("H".repeat(8000));
    expect(userMessage.content).not.toContain("TAIL_MARKER");
  });

  test("the feature is covered by the G4 daily autonomous budget", () => {
    expect(AUTONOMOUS_AI_FEATURES).toContain(CONFIDENCE_CLASSIFICATION_FEATURE);
  });
});
