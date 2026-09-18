import AIConfidenceSignal, {
  ConfidenceClassificationToken,
  ConfidenceSignal,
  ConfidenceSource,
  EvidenceInput,
} from "../../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import { AIChatCitation } from "../../../../../Types/AI/AIChatTypes";
import { describe, expect, test } from "@jest/globals";

/*
 * AI SRE confidence signal — the pure, LLM-free half of the module (the
 * deterministic evidence floor, the defensive token parser, and the
 * per-consumer decision helpers). These encode the safety-critical fail
 * directions from the module header's decision table:
 *
 *   | source / verdict              | ping | instrumentation | auto code fix |
 *   |-------------------------------|------|-----------------|---------------|
 *   | deterministic-floor           | no   | yes             | no            |
 *   | classification / CODE_FIX     | yes  | no              | yes           |
 *   | classification / NO_CODE_FIX  | yes  | no              | no            |
 *   | classification / INCONCLUSIVE | no   | yes             | no            |
 *   | classification-failed         | YES  | no              | no            |
 *
 * The two load-bearing invariants these pin: (1) autonomous PR creation
 * (instrumentation + auto code fix) fails toward doing nothing on a broken
 * classifier, and (2) the on-call ping fails LOUDER — a broken classifier must
 * never suppress it. Getting either direction backwards is the failure the
 * threat model (vision §6) is written against, so it must not regress silently.
 */

function citation(rowCount: number): AIChatCitation {
  return {
    id: "C1",
    toolName: "query_logs",
    label: "logs",
    queryArguments: {},
    rowCount,
  };
}

function signal(
  source: ConfidenceSource,
  confident: boolean,
  codeFixRecommended?: boolean,
): ConfidenceSignal {
  return { source, confident, codeFixRecommended };
}

describe("AIConfidenceSignal.isDataBearingRowCount", () => {
  test("a positive row count is data-bearing", () => {
    expect(AIConfidenceSignal.isDataBearingRowCount(1)).toBe(true);
    expect(AIConfidenceSignal.isDataBearingRowCount(1000)).toBe(true);
  });

  test("zero rows is server-verified but NOT data-bearing (proof of absence)", () => {
    expect(AIConfidenceSignal.isDataBearingRowCount(0)).toBe(false);
  });

  test("null / undefined coalesce to zero → not data-bearing", () => {
    expect(AIConfidenceSignal.isDataBearingRowCount(null)).toBe(false);
    expect(AIConfidenceSignal.isDataBearingRowCount(undefined)).toBe(false);
  });

  test("a negative row count is not data-bearing", () => {
    expect(AIConfidenceSignal.isDataBearingRowCount(-5)).toBe(false);
  });
});

describe("AIConfidenceSignal.evidenceFromCitations", () => {
  test("counts every citation but only data-bearing ones as data-bearing", () => {
    const evidence: EvidenceInput = AIConfidenceSignal.evidenceFromCitations([
      citation(3),
      citation(0),
      citation(7),
    ]);

    expect(evidence.citationCount).toBe(3);
    expect(evidence.dataBearingToolCallCount).toBe(2);
    expect(evidence.anyToolReturnedData).toBe(true);
  });

  test("citations that all returned zero rows count but bear no data", () => {
    const evidence: EvidenceInput = AIConfidenceSignal.evidenceFromCitations([
      citation(0),
      citation(0),
    ]);

    expect(evidence.citationCount).toBe(2);
    expect(evidence.dataBearingToolCallCount).toBe(0);
    expect(evidence.anyToolReturnedData).toBe(false);
  });

  test("no citations → an all-zero evidence input", () => {
    const evidence: EvidenceInput = AIConfidenceSignal.evidenceFromCitations(
      [],
    );

    expect(evidence.citationCount).toBe(0);
    expect(evidence.dataBearingToolCallCount).toBe(0);
    expect(evidence.anyToolReturnedData).toBe(false);
  });
});

describe("AIConfidenceSignal.hasVerifiableEvidence", () => {
  test("true when any of the three signals is present", () => {
    expect(
      AIConfidenceSignal.hasVerifiableEvidence({
        citationCount: 1,
        dataBearingToolCallCount: 0,
        anyToolReturnedData: false,
      }),
    ).toBe(true);

    expect(
      AIConfidenceSignal.hasVerifiableEvidence({
        citationCount: 0,
        dataBearingToolCallCount: 2,
        anyToolReturnedData: false,
      }),
    ).toBe(true);

    expect(
      AIConfidenceSignal.hasVerifiableEvidence({
        citationCount: 0,
        dataBearingToolCallCount: 0,
        anyToolReturnedData: true,
      }),
    ).toBe(true);
  });

  test("false only when the run minted nothing at all", () => {
    expect(
      AIConfidenceSignal.hasVerifiableEvidence({
        citationCount: 0,
        dataBearingToolCallCount: 0,
        anyToolReturnedData: false,
      }),
    ).toBe(false);
  });

  test("a citation with zero data-bearing rows still passes the floor", () => {
    // A tool that ran and proved absence is server-verified evidence.
    const evidence: EvidenceInput = AIConfidenceSignal.evidenceFromCitations([
      citation(0),
    ]);
    expect(AIConfidenceSignal.hasVerifiableEvidence(evidence)).toBe(true);
  });
});

describe("AIConfidenceSignal.parseClassificationToken", () => {
  test("recognises each of the three verdicts when it is the only one", () => {
    expect(AIConfidenceSignal.parseClassificationToken("CODE_FIX")).toBe(
      "CODE_FIX",
    );
    expect(AIConfidenceSignal.parseClassificationToken("NO_CODE_FIX")).toBe(
      "NO_CODE_FIX",
    );
    expect(AIConfidenceSignal.parseClassificationToken("INCONCLUSIVE")).toBe(
      "INCONCLUSIVE",
    );
  });

  test("is case-insensitive", () => {
    expect(AIConfidenceSignal.parseClassificationToken("code_fix")).toBe(
      "CODE_FIX",
    );
    expect(AIConfidenceSignal.parseClassificationToken("Inconclusive")).toBe(
      "INCONCLUSIVE",
    );
  });

  test("tolerates editorializing prose around a single verdict", () => {
    expect(
      AIConfidenceSignal.parseClassificationToken(
        "The verdict is CODE_FIX because the null check is missing.",
      ),
    ).toBe("CODE_FIX");
  });

  test("NO_CODE_FIX is not mis-read as CODE_FIX (underscore is a word char)", () => {
    // Only NO_CODE_FIX appears as a whole word; CODE_FIX must not also match.
    expect(AIConfidenceSignal.parseClassificationToken("NO_CODE_FIX")).toBe(
      "NO_CODE_FIX",
    );
  });

  test("multiple distinct verdicts → null (unparseable)", () => {
    expect(
      AIConfidenceSignal.parseClassificationToken("CODE_FIX or INCONCLUSIVE"),
    ).toBeNull();
  });

  test("no verdict token → null", () => {
    expect(
      AIConfidenceSignal.parseClassificationToken("I am not sure what to say."),
    ).toBeNull();
  });

  test("empty / null / undefined → null", () => {
    expect(AIConfidenceSignal.parseClassificationToken("")).toBeNull();
    expect(AIConfidenceSignal.parseClassificationToken(null)).toBeNull();
    expect(AIConfidenceSignal.parseClassificationToken(undefined)).toBeNull();
  });

  test("word boundaries required — a substring inside another word does not match", () => {
    // "PRECODE_FIXED" contains CODE_FIX as a substring but not as a word.
    expect(
      AIConfidenceSignal.parseClassificationToken("PRECODE_FIXED"),
    ).toBeNull();
  });
});

describe("AIConfidenceSignal.shouldSendWorkspaceNotification", () => {
  test("classification-failed pings LOUDER regardless of the confident flag", () => {
    expect(
      AIConfidenceSignal.shouldSendWorkspaceNotification(
        signal("classification-failed", false),
      ),
    ).toBe(true);
    expect(
      AIConfidenceSignal.shouldSendWorkspaceNotification(
        signal("classification-failed", true),
      ),
    ).toBe(true);
  });

  test("otherwise it follows the confident flag", () => {
    expect(
      AIConfidenceSignal.shouldSendWorkspaceNotification(
        signal("classification", true, true),
      ),
    ).toBe(true);
    expect(
      AIConfidenceSignal.shouldSendWorkspaceNotification(
        signal("deterministic-floor", false, false),
      ),
    ).toBe(false);
  });
});

describe("AIConfidenceSignal.shouldEnqueueInstrumentationTask", () => {
  test("classification-failed fails toward doing nothing", () => {
    expect(
      AIConfidenceSignal.shouldEnqueueInstrumentationTask(
        signal("classification-failed", false),
      ),
    ).toBe(false);
  });

  test("enqueues on a positive inconclusive verdict (floor or classifier)", () => {
    expect(
      AIConfidenceSignal.shouldEnqueueInstrumentationTask(
        signal("deterministic-floor", false, false),
      ),
    ).toBe(true);
    expect(
      AIConfidenceSignal.shouldEnqueueInstrumentationTask(
        signal("classification", false, false),
      ),
    ).toBe(true);
  });

  test("does not enqueue when the run was confident", () => {
    expect(
      AIConfidenceSignal.shouldEnqueueInstrumentationTask(
        signal("classification", true, true),
      ),
    ).toBe(false);
  });
});

describe("AIConfidenceSignal.isCodeFixRecommended / shouldAutoEnqueueCodeFixTask", () => {
  test("requires classification source, confident, AND codeFixRecommended", () => {
    const positive: ConfidenceSignal = signal("classification", true, true);
    expect(AIConfidenceSignal.isCodeFixRecommended(positive)).toBe(true);
    expect(AIConfidenceSignal.shouldAutoEnqueueCodeFixTask(positive)).toBe(
      true,
    );
  });

  test("NO_CODE_FIX (confident but not recommended) is insufficient", () => {
    const noFix: ConfidenceSignal = signal("classification", true, false);
    expect(AIConfidenceSignal.isCodeFixRecommended(noFix)).toBe(false);
    expect(AIConfidenceSignal.shouldAutoEnqueueCodeFixTask(noFix)).toBe(false);
  });

  test("the deterministic floor never triggers an auto code fix", () => {
    // Even if some caller mislabeled the floor as recommended, source gates it.
    const floor: ConfidenceSignal = signal("deterministic-floor", false, true);
    expect(AIConfidenceSignal.isCodeFixRecommended(floor)).toBe(false);
  });

  test("classification-failed never triggers an auto code fix", () => {
    const failed: ConfidenceSignal = signal(
      "classification-failed",
      true,
      true,
    );
    expect(AIConfidenceSignal.isCodeFixRecommended(failed)).toBe(false);
  });

  test("an absent (legacy) codeFixRecommended fails closed", () => {
    const legacy: ConfidenceSignal = {
      source: "classification",
      confident: true,
    };
    expect(AIConfidenceSignal.isCodeFixRecommended(legacy)).toBe(false);
  });
});

describe("AIConfidenceSignal decision table (cross-consumer)", () => {
  interface Row {
    signal: ConfidenceSignal;
    ping: boolean;
    instrumentation: boolean;
    autoCodeFix: boolean;
  }

  const rows: Array<Row> = [
    {
      signal: signal("deterministic-floor", false, false),
      ping: false,
      instrumentation: true,
      autoCodeFix: false,
    },
    {
      signal: signal("classification", true, true),
      ping: true,
      instrumentation: false,
      autoCodeFix: true,
    },
    {
      signal: signal("classification", true, false),
      ping: true,
      instrumentation: false,
      autoCodeFix: false,
    },
    {
      signal: signal("classification", false, false),
      ping: false,
      instrumentation: true,
      autoCodeFix: false,
    },
    {
      signal: signal("classification-failed", false),
      ping: true,
      instrumentation: false,
      autoCodeFix: false,
    },
  ];

  test("every documented row maps to the three consumer decisions", () => {
    for (const row of rows) {
      const context: ConfidenceSource = row.signal.source;

      expect({
        context,
        ping: AIConfidenceSignal.shouldSendWorkspaceNotification(row.signal),
        instrumentation: AIConfidenceSignal.shouldEnqueueInstrumentationTask(
          row.signal,
        ),
        autoCodeFix: AIConfidenceSignal.shouldAutoEnqueueCodeFixTask(
          row.signal,
        ),
      }).toEqual({
        context,
        ping: row.ping,
        instrumentation: row.instrumentation,
        autoCodeFix: row.autoCodeFix,
      });
    }
  });
});

// Keep the imported token type referenced for readers of this spec.
const _tokenType: ConfidenceClassificationToken = "CODE_FIX";
void _tokenType;
