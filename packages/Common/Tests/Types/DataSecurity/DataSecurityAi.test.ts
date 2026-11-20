import crypto from "crypto";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import {
  DATA_SECURITY_AI_ALWAYS_ASKS,
  DATA_SECURITY_AI_CHANGES_WITHOUT_ASKING_PER_HOUR,
  DATA_SECURITY_AI_PROPOSAL_KINDS,
  DATA_SECURITY_AI_RISKIER_CHANGES,
  DATA_SECURITY_AI_RULE_DEFAULT_AUTONOMY,
  DATA_SECURITY_AI_RULE_DOES_NOTHING_MESSAGE,
  DATA_SECURITY_AI_WORK_AUTONOMIES,
  DATA_SECURITY_AI_WORK_COLUMN,
  DATA_SECURITY_AI_WORKS,
  DataSecurityAiAskReason,
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiPlan,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiRuleFacts,
  DataSecurityAiSkip,
  DataSecurityAiWithoutAskingVerdict,
  DataSecurityAiWork,
  DataSecurityAiWorkDecision,
  compareDataSecurityAiProposalsByRisk,
  decideDataSecurityAiWork,
  getDataSecurityAiApprovalsNeeded,
  getDataSecurityAiPlanFingerprint,
  getDataSecurityAiRuleAutonomy,
  getDataSecurityAiRuleProblem,
  getDataSecurityAiWithoutAskingVerdict,
  getDefaultDataSecurityAiWork,
  isDataSecurityAiPlanFingerprint,
  isDataSecurityAiProposalKind,
  isDataSecurityAiProposalUndoable,
  isDataSecurityAiProposalWaiting,
  isDataSecurityAiWorkToDo,
  isRiskierDataSecurityAiChange,
  toStableJsonText,
} from "../../../Types/DataSecurity/DataSecurityAi";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT ONEUPTIME AI MAY DO WITH A DATA SECURITY ISSUE, AND WHAT IT MAY DO
 * WITHOUT ASKING (#10364): the safe defaults, how rules combine, and - for
 * every kind of change at every autonomy - whether it runs on its own or
 * waits for a person. "Only reversible, mask-only actions run without
 * asking out of the box. Anything that changes access, deletes or pages
 * people always asks."
 */

const OFF: DataSecurityAiAutonomy = DataSecurityAiAutonomy.Off;
const SUGGEST: DataSecurityAiAutonomy = DataSecurityAiAutonomy.Suggest;
const WITHOUT_ASKING: DataSecurityAiAutonomy =
  DataSecurityAiAutonomy.WithoutAsking;

function rule(
  name: string,
  work: Partial<Record<DataSecurityAiWork, DataSecurityAiAutonomy>>,
  more: Partial<DataSecurityAiRuleFacts> = {},
): DataSecurityAiRuleFacts {
  const facts: DataSecurityAiRuleFacts = { _id: `id-${name}`, name, ...more };

  for (const [key, value] of Object.entries(work)) {
    facts[DATA_SECURITY_AI_WORK_COLUMN[key as DataSecurityAiWork]] = value;
  }

  return facts;
}

function byRules(
  matchingRules: Array<DataSecurityAiRuleFacts>,
  severity: SecuritySeverity = SecuritySeverity.Medium,
): DataSecurityAiPlan {
  return decideDataSecurityAiWork({
    isAiEnabled: true,
    isAutomaticOn: true,
    rules: { rulesSetUp: true, matchingRules },
    issue: { severity },
  });
}

describe("the four kinds of work and their answers", () => {
  test("are analyze, contain, fix and judge, each set in a column of its own", () => {
    expect(DATA_SECURITY_AI_WORKS).toEqual([
      DataSecurityAiWork.Analyze,
      DataSecurityAiWork.Contain,
      DataSecurityAiWork.Fix,
      DataSecurityAiWork.Judge,
    ]);
    expect(Object.values(DATA_SECURITY_AI_WORK_COLUMN)).toEqual([
      "dataSecurityAnalyze",
      "dataSecurityContain",
      "dataSecurityFix",
      "dataSecurityJudge",
    ]);
  });

  test("the stored answers are a wire contract", () => {
    expect(Object.values(DataSecurityAiAutonomy)).toEqual([
      "Off",
      "Suggest",
      "WithoutAsking",
    ]);
  });

  test("an analysis changes nothing, so it is off or runs: there is nothing to approve", () => {
    expect(DATA_SECURITY_AI_WORK_AUTONOMIES[DataSecurityAiWork.Analyze]).toEqual(
      [OFF, WITHOUT_ASKING],
    );

    for (const work of [
      DataSecurityAiWork.Contain,
      DataSecurityAiWork.Fix,
      DataSecurityAiWork.Judge,
    ]) {
      expect(DATA_SECURITY_AI_WORK_AUTONOMIES[work]).toEqual([
        OFF,
        SUGGEST,
        WITHOUT_ASKING,
      ]);
    }
  });
});

describe("a rule's answer for one kind of work", () => {
  test("is its column's", () => {
    const facts: DataSecurityAiRuleFacts = rule("a", {
      [DataSecurityAiWork.Contain]: WITHOUT_ASKING,
      [DataSecurityAiWork.Fix]: OFF,
    });

    expect(
      getDataSecurityAiRuleAutonomy(facts, DataSecurityAiWork.Contain),
    ).toBe(WITHOUT_ASKING);
    expect(getDataSecurityAiRuleAutonomy(facts, DataSecurityAiWork.Fix)).toBe(
      OFF,
    );
  });

  test("is the rule's default when the column is empty, or holds an answer no build wrote", () => {
    for (const work of DATA_SECURITY_AI_WORKS) {
      expect(getDataSecurityAiRuleAutonomy({}, work)).toBe(
        DATA_SECURITY_AI_RULE_DEFAULT_AUTONOMY[work],
      );
      expect(
        getDataSecurityAiRuleAutonomy(
          { [DATA_SECURITY_AI_WORK_COLUMN[work]]: "Always" },
          work,
        ),
      ).toBe(DATA_SECURITY_AI_RULE_DEFAULT_AUTONOMY[work]);
    }
  });

  test("a rule's defaults: analyze what it matches, and suggest everything else", () => {
    expect(DATA_SECURITY_AI_RULE_DEFAULT_AUTONOMY).toEqual({
      [DataSecurityAiWork.Analyze]: WITHOUT_ASKING,
      [DataSecurityAiWork.Contain]: SUGGEST,
      [DataSecurityAiWork.Fix]: SUGGEST,
      [DataSecurityAiWork.Judge]: SUGGEST,
    });
  });

  test("an analysis a person would approve is one that runs", () => {
    expect(
      getDataSecurityAiRuleAutonomy(
        { dataSecurityAnalyze: SUGGEST },
        DataSecurityAiWork.Analyze,
      ),
    ).toBe(WITHOUT_ASKING);
  });
});

describe("a Data Security AI rule that cannot be saved", () => {
  test("is one that turns every kind of work off", () => {
    expect(
      getDataSecurityAiRuleProblem({
        dataSecurityAnalyze: OFF,
        dataSecurityContain: OFF,
        dataSecurityFix: OFF,
        dataSecurityJudge: OFF,
      }),
    ).toBe(DATA_SECURITY_AI_RULE_DOES_NOTHING_MESSAGE);
  });

  test("is one that gives a kind of work an answer it does not offer", () => {
    expect(getDataSecurityAiRuleProblem({ dataSecurityAnalyze: SUGGEST })).toBe(
      "Data Security: Analyze must be one of Off, WithoutAsking.",
    );
    expect(getDataSecurityAiRuleProblem({ dataSecurityContain: "Auto" })).toBe(
      "Data Security: Contain must be one of Off, Suggest, WithoutAsking.",
    );
    expect(getDataSecurityAiRuleProblem({ dataSecurityFix: 3 })).toBe(
      "Data Security: Fix must be one of Off, Suggest, WithoutAsking.",
    );
  });

  test("leaves out the answers a write does not give: they take the rule's defaults", () => {
    expect(getDataSecurityAiRuleProblem({})).toBeNull();
    expect(
      getDataSecurityAiRuleProblem({
        dataSecurityAnalyze: OFF,
        dataSecurityContain: OFF,
        dataSecurityFix: OFF,
      }),
    ).toBeNull();
    expect(
      getDataSecurityAiRuleProblem({
        dataSecurityAnalyze: null,
        dataSecurityContain: WITHOUT_ASKING,
      }),
    ).toBeNull();
  });
});

describe("with no Data Security AI rule, the project's defaults", () => {
  test.each([
    [SecuritySeverity.Critical, WITHOUT_ASKING],
    [SecuritySeverity.High, WITHOUT_ASKING],
    [SecuritySeverity.Medium, OFF],
    [SecuritySeverity.Low, OFF],
  ])(
    "analyze a %s issue: %s",
    (severity: SecuritySeverity, analyze: DataSecurityAiAutonomy) => {
      const plan: DataSecurityAiPlan = decideDataSecurityAiWork({
        isAiEnabled: true,
        isAutomaticOn: true,
        rules: { rulesSetUp: false, matchingRules: [] },
        issue: { severity },
      });

      expect(plan.skip).toBeNull();
      expect(plan.works[DataSecurityAiWork.Analyze]).toEqual({
        autonomy: analyze,
        fromDefaults: true,
      });
    },
  );

  test("contain without asking only what proves it is safe, and suggest every fix and judgement", () => {
    expect(
      getDefaultDataSecurityAiWork({ severity: SecuritySeverity.Low }),
    ).toEqual({
      [DataSecurityAiWork.Analyze]: { autonomy: OFF, fromDefaults: true },
      [DataSecurityAiWork.Contain]: {
        autonomy: WITHOUT_ASKING,
        fromDefaults: true,
      },
      [DataSecurityAiWork.Fix]: { autonomy: SUGGEST, fromDefaults: true },
      [DataSecurityAiWork.Judge]: { autonomy: SUGGEST, fromDefaults: true },
    });
  });

  test("an issue with no severity is not analyzed", () => {
    expect(
      getDefaultDataSecurityAiWork({})[DataSecurityAiWork.Analyze].autonomy,
    ).toBe(OFF);
  });
});

describe("what the switches and the rules decide", () => {
  test("nothing runs with Enable AI off, whatever the rules say", () => {
    const plan: DataSecurityAiPlan = decideDataSecurityAiWork({
      isAiEnabled: false,
      isAutomaticOn: true,
      rules: { rulesSetUp: false, matchingRules: [] },
      issue: { severity: SecuritySeverity.Critical },
    });

    expect(plan.skip).toBe(DataSecurityAiSkip.AiOff);
    expect(isDataSecurityAiWorkToDo(plan)).toBe(false);

    for (const work of DATA_SECURITY_AI_WORKS) {
      expect(plan.works[work].autonomy).toBe(OFF);
    }
  });

  test("nothing runs with Work on new Data Security issues off", () => {
    const plan: DataSecurityAiPlan = decideDataSecurityAiWork({
      isAiEnabled: true,
      isAutomaticOn: false,
      rules: { rulesSetUp: false, matchingRules: [] },
      issue: { severity: SecuritySeverity.Critical },
    });

    expect(plan.skip).toBe(DataSecurityAiSkip.AutomaticOff);
    expect(isDataSecurityAiWorkToDo(plan)).toBe(false);
  });

  test("nothing a rule may keep out runs while the rules cannot be read", () => {
    const plan: DataSecurityAiPlan = decideDataSecurityAiWork({
      isAiEnabled: true,
      isAutomaticOn: true,
      rules: null,
      issue: { severity: SecuritySeverity.Critical },
    });

    expect(plan.skip).toBe(DataSecurityAiSkip.RulesUnreadable);
    expect(isDataSecurityAiWorkToDo(plan)).toBe(false);
  });

  test("with rules, an issue no rule matches is not worked on - not even by the defaults", () => {
    const plan: DataSecurityAiPlan = decideDataSecurityAiWork({
      isAiEnabled: true,
      isAutomaticOn: true,
      rules: { rulesSetUp: true, matchingRules: [] },
      issue: { severity: SecuritySeverity.Critical },
    });

    expect(plan.skip).toBe(DataSecurityAiSkip.NoMatchingRule);
    expect(isDataSecurityAiWorkToDo(plan)).toBe(false);
  });

  test("a matching rule decides each kind of work, named on the decision", () => {
    const plan: DataSecurityAiPlan = byRules([
      rule("Production stores", {
        [DataSecurityAiWork.Analyze]: OFF,
        [DataSecurityAiWork.Contain]: WITHOUT_ASKING,
        [DataSecurityAiWork.Fix]: SUGGEST,
        [DataSecurityAiWork.Judge]: OFF,
      }),
    ]);

    expect(plan.skip).toBeNull();
    expect(plan.works[DataSecurityAiWork.Analyze].autonomy).toBe(OFF);
    expect(plan.works[DataSecurityAiWork.Contain]).toEqual({
      autonomy: WITHOUT_ASKING,
      fromDefaults: false,
      ruleId: "id-Production stores",
      ruleName: "Production stores",
    });
    expect(plan.works[DataSecurityAiWork.Fix].autonomy).toBe(SUGGEST);
    expect(plan.works[DataSecurityAiWork.Judge].autonomy).toBe(OFF);
    expect(isDataSecurityAiWorkToDo(plan)).toBe(true);
  });

  test("of two matching rules the careful answer wins: Suggest over Without asking", () => {
    const plan: DataSecurityAiPlan = byRules([
      rule("A", { [DataSecurityAiWork.Contain]: WITHOUT_ASKING }),
      rule("B", { [DataSecurityAiWork.Contain]: SUGGEST }),
    ]);

    expect(plan.works[DataSecurityAiWork.Contain]).toEqual({
      autonomy: SUGGEST,
      fromDefaults: false,
      ruleId: "id-B",
      ruleName: "B",
    });
  });

  test("a rule that turns a kind of work off leaves it to the rules that turn it on", () => {
    const plan: DataSecurityAiPlan = byRules([
      rule("A", { [DataSecurityAiWork.Contain]: OFF }),
      rule("B", { [DataSecurityAiWork.Contain]: WITHOUT_ASKING }),
    ]);

    expect(plan.works[DataSecurityAiWork.Contain].autonomy).toBe(
      WITHOUT_ASKING,
    );
    expect(plan.works[DataSecurityAiWork.Contain].ruleName).toBe("B");
  });

  test("a kind of work every matching rule turns off is off, decided by no rule", () => {
    const plan: DataSecurityAiPlan = byRules([
      rule("A", { [DataSecurityAiWork.Fix]: OFF }),
      rule("B", { [DataSecurityAiWork.Fix]: OFF }),
    ]);

    expect(plan.works[DataSecurityAiWork.Fix]).toEqual({
      autonomy: OFF,
      fromDefaults: false,
    });
  });

  test("the rule that decides is the first by name that gave the winning answer", () => {
    const plan: DataSecurityAiPlan = byRules([
      rule("Alpha", { [DataSecurityAiWork.Judge]: WITHOUT_ASKING }),
      rule("Beta", { [DataSecurityAiWork.Judge]: WITHOUT_ASKING }),
    ]);

    expect(plan.works[DataSecurityAiWork.Judge].ruleName).toBe("Alpha");
  });

  test("the LLM provider is the first matching rule's that picks one", () => {
    const plan: DataSecurityAiPlan = byRules([
      rule("A", {}),
      rule("B", {}, { llmProviderId: "provider-b" }),
      rule("C", {}, { llmProviderId: "provider-c" }),
    ]);

    expect(plan.llmProviderId).toBe("provider-b");
    expect(byRules([rule("A", {})]).llmProviderId).toBe("");
  });

  test("a rule's analysis applies to whatever it matches, whatever the severity", () => {
    const plan: DataSecurityAiPlan = byRules(
      [rule("Everything", {})],
      SecuritySeverity.Low,
    );

    expect(plan.works[DataSecurityAiWork.Analyze].autonomy).toBe(
      WITHOUT_ASKING,
    );
  });
});

/*
 * Every kind of change at every autonomy, from a rule and from the
 * defaults: whether it runs on its own, and why it asks when it does.
 */
describe("what may run without asking", () => {
  function verdict(data: {
    autonomy: DataSecurityAiAutonomy;
    safety: DataSecurityAiChangeSafety;
    fromDefaults?: boolean;
    meetsDefaultConditions?: boolean;
    isNamedByRule?: boolean;
    twoApprovals?: boolean;
    changesThisHour?: number;
  }): DataSecurityAiWithoutAskingVerdict {
    const work: DataSecurityAiWorkDecision = {
      autonomy: data.autonomy,
      fromDefaults: data.fromDefaults === true,
    };

    return getDataSecurityAiWithoutAskingVerdict({
      work,
      safety: data.safety,
      meetsDefaultConditions: data.meetsDefaultConditions === true,
      isNamedByRule: data.isNamedByRule === true,
      requireTwoApprovalsForRiskierChanges: data.twoApprovals === true,
      changesWithoutAskingThisHour: data.changesThisHour || 0,
    });
  }

  const RUNS: DataSecurityAiWithoutAskingVerdict = {
    runWithoutAsking: true,
    askReason: null,
  };

  function asks(
    askReason: DataSecurityAiAskReason,
  ): DataSecurityAiWithoutAskingVerdict {
    return { runWithoutAsking: false, askReason };
  }

  const EVERY_SAFETY: Array<DataSecurityAiChangeSafety> = Object.values(
    DataSecurityAiChangeSafety,
  );

  test.each(
    EVERY_SAFETY.filter((safety: DataSecurityAiChangeSafety): boolean => {
      return safety !== DataSecurityAiChangeSafety.ReadOnly;
    }),
  )("%s: Off and Suggest always ask", (safety: DataSecurityAiChangeSafety) => {
    expect(verdict({ autonomy: OFF, safety })).toEqual(
      asks(DataSecurityAiAskReason.WorkAsksFirst),
    );
    expect(verdict({ autonomy: SUGGEST, safety })).toEqual(
      asks(DataSecurityAiAskReason.WorkAsksFirst),
    );
    expect(
      verdict({ autonomy: SUGGEST, safety, isNamedByRule: true }),
    ).toEqual(asks(DataSecurityAiAskReason.WorkAsksFirst));
  });

  test("an analysis changes nothing: it runs whenever its work is on", () => {
    const safety: DataSecurityAiChangeSafety = DataSecurityAiChangeSafety.ReadOnly;

    expect(verdict({ autonomy: WITHOUT_ASKING, safety })).toEqual(RUNS);
    expect(verdict({ autonomy: SUGGEST, safety })).toEqual(RUNS);
    expect(
      verdict({ autonomy: WITHOUT_ASKING, safety, fromDefaults: true }),
    ).toEqual(RUNS);
    expect(verdict({ autonomy: OFF, safety }).runWithoutAsking).toBe(false);
  });

  test.each([
    DataSecurityAiChangeSafety.MaskOnly,
    DataSecurityAiChangeSafety.OpensPullRequest,
    DataSecurityAiChangeSafety.RecordsJudgement,
  ])(
    "%s runs without asking where a rule says so",
    (safety: DataSecurityAiChangeSafety) => {
      expect(verdict({ autonomy: WITHOUT_ASKING, safety })).toEqual(RUNS);
    },
  );

  test.each([
    DataSecurityAiChangeSafety.MaskOnly,
    DataSecurityAiChangeSafety.OpensPullRequest,
    DataSecurityAiChangeSafety.RecordsJudgement,
  ])(
    "%s, out of the box, runs only when it proves it is safe",
    (safety: DataSecurityAiChangeSafety) => {
      expect(
        verdict({ autonomy: WITHOUT_ASKING, safety, fromDefaults: true }),
      ).toEqual(asks(DataSecurityAiAskReason.NotProvenSafe));
      expect(
        verdict({
          autonomy: WITHOUT_ASKING,
          safety,
          fromDefaults: true,
          meetsDefaultConditions: true,
        }),
      ).toEqual(RUNS);
    },
  );

  test("a change of access never runs without asking out of the box, even proven safe", () => {
    expect(
      verdict({
        autonomy: WITHOUT_ASKING,
        safety: DataSecurityAiChangeSafety.ChangesAccess,
        fromDefaults: true,
        meetsDefaultConditions: true,
        isNamedByRule: true,
      }),
    ).toEqual(asks(DataSecurityAiAskReason.NotNamedByRule));
  });

  test("a change of access runs without asking only where the rule names that very action", () => {
    const safety: DataSecurityAiChangeSafety =
      DataSecurityAiChangeSafety.ChangesAccess;

    expect(verdict({ autonomy: WITHOUT_ASKING, safety })).toEqual(
      asks(DataSecurityAiAskReason.NotNamedByRule),
    );
    expect(
      verdict({ autonomy: WITHOUT_ASKING, safety, isNamedByRule: true }),
    ).toEqual(RUNS);
  });

  test.each([
    DataSecurityAiChangeSafety.Deletes,
    DataSecurityAiChangeSafety.Pages,
  ])(
    "%s always asks, whatever a rule says or names",
    (safety: DataSecurityAiChangeSafety) => {
      expect(DATA_SECURITY_AI_ALWAYS_ASKS).toContain(safety);

      for (const fromDefaults of [true, false]) {
        expect(
          verdict({
            autonomy: WITHOUT_ASKING,
            safety,
            fromDefaults,
            meetsDefaultConditions: true,
            isNamedByRule: true,
          }),
        ).toEqual(asks(DataSecurityAiAskReason.AlwaysAsks));
      }
    },
  );

  test("where two people approve a riskier change, a named change of access asks for them", () => {
    expect(
      verdict({
        autonomy: WITHOUT_ASKING,
        safety: DataSecurityAiChangeSafety.ChangesAccess,
        isNamedByRule: true,
        twoApprovals: true,
      }),
    ).toEqual(asks(DataSecurityAiAskReason.TwoApprovals));
    // A mask-only change is no riskier change: the rule does not touch it.
    expect(
      verdict({
        autonomy: WITHOUT_ASKING,
        safety: DataSecurityAiChangeSafety.MaskOnly,
        twoApprovals: true,
      }),
    ).toEqual(RUNS);
  });

  test("the circuit breaker proposes what comes after the hour's changes made without asking", () => {
    const safety: DataSecurityAiChangeSafety = DataSecurityAiChangeSafety.MaskOnly;

    expect(
      verdict({
        autonomy: WITHOUT_ASKING,
        safety,
        changesThisHour: DATA_SECURITY_AI_CHANGES_WITHOUT_ASKING_PER_HOUR - 1,
      }),
    ).toEqual(RUNS);
    expect(
      verdict({
        autonomy: WITHOUT_ASKING,
        safety,
        changesThisHour: DATA_SECURITY_AI_CHANGES_WITHOUT_ASKING_PER_HOUR,
      }),
    ).toEqual(asks(DataSecurityAiAskReason.CircuitBreaker));
  });

  test("the riskier changes are the ones that change access, delete or page", () => {
    expect([...DATA_SECURITY_AI_RISKIER_CHANGES].sort()).toEqual(
      [
        DataSecurityAiChangeSafety.ChangesAccess,
        DataSecurityAiChangeSafety.Deletes,
        DataSecurityAiChangeSafety.Pages,
      ].sort(),
    );
    expect(isRiskierDataSecurityAiChange(DataSecurityAiChangeSafety.MaskOnly)).toBe(
      false,
    );
    expect(isRiskierDataSecurityAiChange(undefined)).toBe(false);
  });
});

describe("how many people approve a proposal", () => {
  test.each(Object.values(DataSecurityAiChangeSafety))(
    "%s",
    (safety: DataSecurityAiChangeSafety) => {
      expect(
        getDataSecurityAiApprovalsNeeded({
          requireTwoApprovalsForRiskierChanges: false,
          safety,
        }),
      ).toBe(1);
      expect(
        getDataSecurityAiApprovalsNeeded({
          requireTwoApprovalsForRiskierChanges: true,
          safety,
        }),
      ).toBe(isRiskierDataSecurityAiChange(safety) ? 2 : 1);
    },
  );
});

describe("the kinds of change", () => {
  test("Scrub It is a contain change that only masks", () => {
    expect(
      DATA_SECURITY_AI_PROPOSAL_KINDS[DataSecurityAiProposalKind.ScrubTelemetry],
    ).toEqual({
      kind: DataSecurityAiProposalKind.ScrubTelemetry,
      work: DataSecurityAiWork.Contain,
      safety: DataSecurityAiChangeSafety.MaskOnly,
    });
  });

  test("every kind has its definition, under its own name", () => {
    for (const kind of Object.values(DataSecurityAiProposalKind)) {
      expect(DATA_SECURITY_AI_PROPOSAL_KINDS[kind].kind).toBe(kind);
      expect(isDataSecurityAiProposalKind(kind)).toBe(true);
    }

    expect(isDataSecurityAiProposalKind("RunAnything")).toBe(false);
  });

  test("a proposal waits for a person only while it is proposed, and is undone only once made", () => {
    for (const status of Object.values(DataSecurityAiProposalStatus)) {
      expect(isDataSecurityAiProposalWaiting(status)).toBe(
        status === DataSecurityAiProposalStatus.Proposed,
      );
      expect(isDataSecurityAiProposalUndoable(status)).toBe(
        status === DataSecurityAiProposalStatus.Applied ||
          status === DataSecurityAiProposalStatus.AppliedWithoutAsking,
      );
    }
  });
});

describe("the inbox lists what waits riskiest first", () => {
  test("riskier changes first, then by risk score, then the oldest first", () => {
    const old: Date = new Date("2026-11-01T00:00:00Z");
    const recent: Date = new Date("2026-11-10T00:00:00Z");
    const proposals: Array<{
      id: string;
      safety: string;
      riskScore: number;
      createdAt: Date;
    }> = [
      { id: "low", safety: "MaskOnly", riskScore: 20, createdAt: old },
      { id: "high-recent", safety: "MaskOnly", riskScore: 90, createdAt: recent },
      { id: "high-old", safety: "MaskOnly", riskScore: 90, createdAt: old },
      { id: "access", safety: "ChangesAccess", riskScore: 10, createdAt: recent },
    ];

    expect(
      [...proposals]
        .sort(compareDataSecurityAiProposalsByRisk)
        .map((proposal: { id: string }): string => {
          return proposal.id;
        }),
    ).toEqual(["access", "high-old", "high-recent", "low"]);
  });
});

describe("a plan's fingerprint", () => {
  test("is the same however the plan's keys are ordered", () => {
    expect(
      getDataSecurityAiPlanFingerprint({
        kind: "ScrubTelemetry",
        plan: { kind: "Logs", places: [{ a: 1, b: 2 }] },
      }),
    ).toBe(
      getDataSecurityAiPlanFingerprint({
        kind: "ScrubTelemetry",
        plan: { places: [{ b: 2, a: 1 }], kind: "Logs" },
      }),
    );
  });

  test("changes with the plan and with the kind", () => {
    const plan: { places: Array<string> } = { places: ["x"] };
    const fingerprint: string = getDataSecurityAiPlanFingerprint({
      kind: "ScrubTelemetry",
      plan,
    });

    expect(isDataSecurityAiPlanFingerprint(fingerprint)).toBe(true);
    expect(
      getDataSecurityAiPlanFingerprint({
        kind: "ScrubTelemetry",
        plan: { places: ["y"] },
      }),
    ).not.toBe(fingerprint);
    expect(
      getDataSecurityAiPlanFingerprint({ kind: "OtherKind", plan }),
    ).not.toBe(fingerprint);
  });

  test("is sixteen hex digits of the SHA-256 Node's crypto writes, so the Dashboard works it out the same", () => {
    const plan: { places: Array<string> } = { places: ["attributes.email"] };
    const text: string = toStableJsonText({ kind: "ScrubTelemetry", plan });

    expect(getDataSecurityAiPlanFingerprint({ kind: "ScrubTelemetry", plan })).toBe(
      crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16),
    );
    expect(isDataSecurityAiPlanFingerprint("ABCDEF0123456789")).toBe(false);
    expect(isDataSecurityAiPlanFingerprint("abc")).toBe(false);
  });

  test("a stable text leaves out what is undefined, and keeps arrays in order", () => {
    expect(toStableJsonText({ b: [2, 1], a: undefined, c: null })).toBe(
      '{"b":[2,1],"c":null}',
    );
  });
});
