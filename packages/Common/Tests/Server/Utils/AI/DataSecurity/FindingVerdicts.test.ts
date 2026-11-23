import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import Project from "../../../../../Models/DatabaseModels/Project";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ConfirmFindingsAction, {
  ConfirmFindingsPlan,
  readConfirmFindingsPlan,
} from "../../../../../Server/Utils/AI/DataSecurity/Actions/ConfirmFindingsAction";
import DataSecurityAiCall, {
  DataSecurityAiCallRequest,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import DataSecurityAiEngine from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiEngine";
import DataSecurityAiProposals from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiProposals";
import DataSecurityFindingVerdicts, {
  FindingVerdictOutcome,
  FindingVerdictSkip,
} from "../../../../../Server/Utils/AI/DataSecurity/FindingVerdicts";
import logger from "../../../../../Server/Utils/Logger";
import ProjectLanguage from "../../../../../Server/Utils/Notification/ProjectLanguage";
import {
  DataSecurityAiAutonomy,
  DataSecurityAiWithoutAskingVerdict,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import AutoRemediationTriggerEntity from "../../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import DataConfidence from "../../../../../Types/DataSecurity/DataConfidence";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import {
  DataStoreFindingDecision,
  DataStoreFindingVerdict,
  DataStoreFindingVerdictRecord,
  readDataStoreFindingVerdictRecord,
} from "../../../../../Types/DataSecurity/DataStoreFindingVerdict";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ONEUPTIME AI'S VERDICTS ON THE FINDINGS THAT WAIT FOR A PERSON (#10372),
 * the run: under the project's switches and its AI rules, each waiting
 * finding with its precedent is asked about once while what it rests on
 * stays the same, its verdict is kept on it - and OneUptime AI never marks
 * a finding not sensitive, under any rule, and confirms one on its own only
 * where a rule says so. The project, the store, its findings, the rules and
 * the model are stand-ins.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-11-23T10:00:00.000Z");

let project: Project;
let store: DataStore;
let waiting: Array<DataStoreFinding>;
let decided: Array<DataStoreFinding>;
let rules: Array<AutoRemediationRule> | null;
let answer: string | Error;
let turnedDown: Array<JSONObject>;
let askSpy: jest.SpyInstance;
let writeSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let proposeSpy: jest.SpyInstance;

let counter: number = 0;

function nextId(): ObjectID {
  counter++;
  return new ObjectID(
    `33333333-3333-4333-8333-${String(counter).padStart(12, "0")}`,
  );
}

function waitingFinding(more: Partial<DataStoreFinding> = {}): DataStoreFinding {
  const row: DataStoreFinding = new DataStoreFinding(nextId());
  row.dataStoreId = STORE_ID;
  row.dataTypeId = "credit-card-number";
  row.dataTypeName = "Card number";
  row.sensitivity = DataSensitivity.Restricted;
  row.location = "public.orders.order_number";
  row.locationKind = "Column";
  row.confidence = DataConfidence.Low;
  row.valueCount = 1000;
  row.matchPercent = 8;
  row.matchCount = 80;
  row.distinctValues = 80;
  row.testValueCount = 0;
  row.isFreeText = false;
  row.isNameHinted = false;
  row.isFoundByName = false;
  row.isAiSuggested = false;
  row.isSuppressed = false;
  row.isConfirmed = false;
  Object.assign(row, more);
  waiting.push(row);
  return row;
}

function decision(
  kind: DataStoreFindingDecision,
  location: string,
  storeIndex: number,
): DataStoreFinding {
  const row: DataStoreFinding = new DataStoreFinding(nextId());
  row.dataStoreId = new ObjectID(
    `44444444-4444-4444-8444-${String(storeIndex).padStart(12, "0")}`,
  );
  row.dataTypeId = "credit-card-number";
  row.location = location;
  row.locationKind = "Column";
  row.isFreeText = false;
  row.isSuppressed = kind === DataStoreFindingDecision.NotSensitive;
  row.isConfirmed = kind === DataStoreFindingDecision.Confirmed;
  row.isConfirmedByAi = false;
  row.suppressedReason =
    kind === DataStoreFindingDecision.NotSensitive
      ? "Shopify order numbers, not card numbers."
      : undefined;
  row.decidedAt = new Date(NOW.getTime() - storeIndex * 60 * 1000);
  decided.push(row);
  return row;
}

function rule(judge: DataSecurityAiAutonomy): AutoRemediationRule {
  const row: AutoRemediationRule = new AutoRemediationRule(nextId());
  row.name = `Judge ${judge}`;
  row.isEnabled = true;
  row.triggerEntityType = AutoRemediationTriggerEntity.DataSecurityIssue;
  row.dataSecurityAnalyze = DataSecurityAiAutonomy.WithoutAsking;
  row.dataSecurityContain = DataSecurityAiAutonomy.Suggest;
  row.dataSecurityFix = DataSecurityAiAutonomy.Suggest;
  row.dataSecurityJudge = judge;
  return row;
}

function answerWith(
  findings: Array<{
    ref: string;
    verdict: DataStoreFindingVerdict;
    reason?: string;
    precedent?: Array<string>;
    draft?: string | null;
  }>,
): string {
  return JSON.stringify({
    findings: findings.map((entry: { reason?: string }) => {
      return { reason: "Your team's decisions on findings like it.", ...entry };
    }),
  });
}

function judge(): Promise<FindingVerdictOutcome> {
  return DataSecurityFindingVerdicts.judgeStore({
    projectId: PROJECT_ID,
    dataStoreId: STORE_ID,
    now: NOW,
  });
}

function sentData(call: number = 0): JSONObject {
  const request: DataSecurityAiCallRequest = askSpy.mock.calls[call]![0];

  return JSON.parse(request.prompt.messages[1]!.content as string) as JSONObject;
}

function writtenVerdicts(): Array<{
  id: string;
  verdict: unknown;
  record: DataStoreFindingVerdictRecord | null;
  data: JSONObject;
}> {
  return writeSpy.mock.calls.map((call: Array<unknown>) => {
    const write: { id: ObjectID; data: JSONObject } = call[0] as {
      id: ObjectID;
      data: JSONObject;
    };

    return {
      id: write.id.toString(),
      verdict: write.data["aiVerdict"],
      record: readDataStoreFindingVerdictRecord(write.data["aiVerdictAnalysis"]),
      data: write.data,
    };
  });
}

beforeEach(() => {
  waiting = [];
  decided = [];
  rules = [];
  turnedDown = [];
  answer = answerWith([]);

  project = new Project(PROJECT_ID);
  project.enableAi = true;
  project.enableAutomaticDataSecurityAi = true;
  project.requireTwoApprovalsForRiskierFixes = false;

  store = new DataStore(STORE_ID);
  store.projectId = PROJECT_ID;
  store.name = "orders-eu";
  store.kind = DataStoreKind.PostgreSql;
  store.isArchived = false;

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return project;
  }) as never);
  jest.spyOn(DataStoreService, "findOneBy").mockImplementation((async () => {
    return store;
  }) as never);
  jest.spyOn(DataStoreService, "findBy").mockImplementation((async () => {
    return [];
  }) as never);
  jest
    .spyOn(DataStoreFindingService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject }) => {
      // The store's findings that may wait for a person.
      if (findBy.query["dataStoreId"]) {
        return waiting;
      }

      // Precedent: the project's decided findings of a type, by decision.
      return decided.filter((row: DataStoreFinding): boolean => {
        return (
          row.dataTypeId === findBy.query["dataTypeId"] &&
          (findBy.query["isSuppressed"] === true
            ? row.isSuppressed === true
            : row.isConfirmed === true && row.isSuppressed !== true)
        );
      });
    }) as never);
  writeSpy = jest
    .spyOn(DataStoreFindingService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  updateSpy = jest
    .spyOn(DataStoreFindingService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataStoreFindingService, "updateBy")
    .mockResolvedValue(0 as never);
  jest.spyOn(DataSecurityAiEngine, "readRules").mockImplementation((async () => {
    return rules;
  }) as never);
  jest
    .spyOn(DataSecurityAiEngine, "readDataTypes")
    .mockImplementation((async () => {
      return {
        namer: DataTypeNamer.withoutCustomTypes(),
        categoryOf: new Map(),
      };
    }) as never);
  jest
    .spyOn(DataSecurityAiEngine, "countChangesWithoutAskingThisHour")
    .mockResolvedValue(0 as never);
  jest
    .spyOn(DataSecurityAiProposalService, "findBy")
    .mockImplementation((async () => {
      return turnedDown;
    }) as never);
  jest.spyOn(ProjectLanguage, "getLanguage").mockResolvedValue("en" as never);
  askSpy = jest
    .spyOn(DataSecurityAiCall, "ask")
    .mockImplementation((async () => {
      if (answer instanceof Error) {
        throw answer;
      }

      return { content: answer };
    }) as never);
  proposeSpy = jest
    .spyOn(DataSecurityAiProposals, "propose")
    .mockResolvedValue({ work: "Judge", reason: "Proposed" } as never);
  jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Low finding the team dismissed four times elsewhere", () => {
  test("arrives with a Not sensitive verdict that cites those four decisions", async () => {
    const finding: DataStoreFinding = waitingFinding();
    const four: Array<DataStoreFinding> = [
      decision(DataStoreFindingDecision.NotSensitive, "public.orders.order_number", 1),
      decision(DataStoreFindingDecision.NotSensitive, "sales.orders.orderNumber", 2),
      decision(DataStoreFindingDecision.NotSensitive, "shop.OrderNumber", 3),
      decision(DataStoreFindingDecision.NotSensitive, "eu.orders.order_number", 4),
    ];

    answer = answerWith([
      {
        ref: "F1",
        verdict: DataStoreFindingVerdict.NotSensitive,
        reason: "Your team marked order_number not sensitive on 4 stores.",
        precedent: ["P1", "P2", "P3", "P4"],
        draft: "Order numbers that pass the Luhn check, not card numbers.",
      },
    ]);

    const outcome: FindingVerdictOutcome = await judge();

    expect(outcome).toMatchObject({ waiting: 1, judged: 1, unchanged: 0 });

    // OneUptime AI was told the four decisions, with their reasons, and no value.
    const sent: JSONObject = sentData();
    const told: Array<JSONObject> = (
      (sent["findings"] as Array<JSONObject>)[0]!["precedent"] as Array<JSONObject>
    );

    expect(told).toHaveLength(4);
    expect(told[0]).toMatchObject({
      ref: "P1",
      decision: "markedNotSensitive",
      foundBy: "the same field name",
      reason: "Shopify order numbers, not card numbers.",
    });
    expect(
      (askSpy.mock.calls[0]![0] as DataSecurityAiCallRequest).prompt.feature,
    ).toBe(DataSecurityAiFeature.JudgeFindings);

    const [written] = writtenVerdicts();

    expect(written!.id).toBe(finding.id!.toString());
    expect(written!.verdict).toBe(DataStoreFindingVerdict.NotSensitive);
    expect(written!.data["aiVerdictAt"]).toEqual(NOW);
    expect(written!.data["aiVerdictInputHash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(
      written!.record!.precedent.map((entry: { findingId: string }) => {
        return entry.findingId;
      }),
    ).toEqual(
      four.map((row: DataStoreFinding): string => {
        return row.id!.toString().toLowerCase();
      }),
    );
    expect(written!.record!.draft).toBe(
      "Order numbers that pass the Luhn check, not card numbers.",
    );
  });

  test("and is still only a verdict: nobody's decision, and nothing proposed", async () => {
    waitingFinding();
    decision(DataStoreFindingDecision.NotSensitive, "orders.order_number", 1);
    answer = answerWith([
      {
        ref: "F1",
        verdict: DataStoreFindingVerdict.NotSensitive,
        precedent: ["P1"],
      },
    ]);

    await judge();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(proposeSpy).not.toHaveBeenCalled();
    expect(
      writtenVerdicts().every((write: { data: JSONObject }): boolean => {
        return (
          write.data["isSuppressed"] === undefined &&
          write.data["suppressedReason"] === undefined &&
          write.data["isConfirmed"] === undefined
        );
      }),
    ).toBe(true);
  });
});

describe("OneUptime AI never marks a finding not sensitive on its own, under any rule", () => {
  test.each([
    ["the project's defaults", null],
    ["a rule that suggests", DataSecurityAiAutonomy.Suggest],
    ["a rule that acts without asking", DataSecurityAiAutonomy.WithoutAsking],
  ])(
    "%s: a Not sensitive verdict changes nothing but the verdict",
    async (_title: string, autonomy: DataSecurityAiAutonomy | null) => {
      rules = autonomy ? [rule(autonomy)] : [];
      waitingFinding();
      waitingFinding({ location: "billing.invoice_no" });
      decision(DataStoreFindingDecision.NotSensitive, "order_number", 1);
      answer = answerWith([
        {
          ref: "F1",
          verdict: DataStoreFindingVerdict.NotSensitive,
          precedent: ["P1"],
        },
        { ref: "F2", verdict: DataStoreFindingVerdict.NotSensitive },
      ]);

      const outcome: FindingVerdictOutcome = await judge();

      expect(outcome.judged).toBe(2);
      expect(outcome.confirmedOnItsOwn).toBe(0);
      expect(updateSpy).not.toHaveBeenCalled();
      expect(proposeSpy).not.toHaveBeenCalled();

      for (const write of writtenVerdicts()) {
        expect(Object.keys(write.data).sort()).toEqual([
          "aiVerdict",
          "aiVerdictAnalysis",
          "aiVerdictAt",
          "aiVerdictInputHash",
        ]);
      }
    },
  );
});

describe("OneUptime AI confirms on its own only where a rule says so", () => {
  function confirmedTwice(): DataStoreFinding {
    const finding: DataStoreFinding = waitingFinding();

    decision(DataStoreFindingDecision.Confirmed, "public.orders.order_number", 1);
    decision(DataStoreFindingDecision.Confirmed, "eu.orders.order_number", 2);
    answer = answerWith([
      {
        ref: "F1",
        verdict: DataStoreFindingVerdict.Confirm,
        precedent: ["P1", "P2"],
      },
    ]);

    return finding;
  }

  test("a rule whose Judge is Without asking: one proposal, made without asking", async () => {
    rules = [rule(DataSecurityAiAutonomy.WithoutAsking)];
    const finding: DataStoreFinding = confirmedTwice();

    const outcome: FindingVerdictOutcome = await judge();

    expect(outcome.confirmedOnItsOwn).toBe(1);
    expect(proposeSpy).toHaveBeenCalledTimes(1);

    const proposed: {
      action: unknown;
      issue: unknown;
      store: DataStore;
      verdict: DataSecurityAiWithoutAskingVerdict;
      change: { plan: JSONObject };
    } = proposeSpy.mock.calls[0]![0];

    expect(proposed.action).toBe(ConfirmFindingsAction);
    expect(proposed.issue).toBeNull();
    expect(proposed.store).toBe(store);
    expect(proposed.verdict.runWithoutAsking).toBe(true);

    const plan: ConfirmFindingsPlan | null = readConfirmFindingsPlan(
      proposed.change.plan,
    );

    expect(
      plan!.findings.map((entry: { findingId: string }) => {
        return entry.findingId;
      }),
    ).toEqual([finding.id!.toString().toLowerCase()]);
  });

  test.each([
    ["the project's defaults", null],
    ["a rule that suggests", DataSecurityAiAutonomy.Suggest],
  ])(
    "%s: the Confirm waits on the finding's row",
    async (_title: string, autonomy: DataSecurityAiAutonomy | null) => {
      rules = autonomy ? [rule(autonomy)] : [];
      confirmedTwice();

      const outcome: FindingVerdictOutcome = await judge();

      expect(writtenVerdicts()[0]!.verdict).toBe(DataStoreFindingVerdict.Confirm);
      expect(outcome.confirmedOnItsOwn).toBe(0);
      expect(proposeSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    },
  );

  test("never on a Confirm that rests on neither the team's confirmation nor the field's name", async () => {
    rules = [rule(DataSecurityAiAutonomy.WithoutAsking)];
    waitingFinding({ location: "analytics.session_ref" });
    answer = answerWith([
      { ref: "F1", verdict: DataStoreFindingVerdict.Confirm },
    ]);

    const outcome: FindingVerdictOutcome = await judge();

    expect(writtenVerdicts()[0]!.verdict).toBe(DataStoreFindingVerdict.Confirm);
    expect(outcome.confirmedOnItsOwn).toBe(0);
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  test("never again for a finding whose confirmation a person undid or dismissed", async () => {
    rules = [rule(DataSecurityAiAutonomy.WithoutAsking)];
    const finding: DataStoreFinding = confirmedTwice();

    turnedDown = [
      {
        plan: {
          dataStoreId: STORE_ID.toString(),
          storeName: "orders-eu",
          findings: [
            {
              findingId: finding.id!.toString(),
              dataTypeId: "credit-card-number",
              dataTypeName: "Card number",
              location: "public.orders.order_number",
              reason: "Twice.",
            },
          ],
        },
      },
    ];

    const outcome: FindingVerdictOutcome = await judge();

    expect(outcome.confirmedOnItsOwn).toBe(0);
    expect(proposeSpy).not.toHaveBeenCalled();
  });
});

describe("what is judged, and when", () => {
  test("only findings that wait for a person: not a Medium or High one with no sign", async () => {
    waitingFinding({
      confidence: DataConfidence.High,
      location: "payments.card_number",
      isNameHinted: true,
    });
    const low: DataStoreFinding = waitingFinding();

    answer = answerWith([
      { ref: "F1", verdict: DataStoreFindingVerdict.CannotTell },
    ]);

    const outcome: FindingVerdictOutcome = await judge();

    expect(outcome.waiting).toBe(1);
    expect(sentData()["findings"]).toHaveLength(1);
    expect(writtenVerdicts()[0]!.id).toBe(low.id!.toString());
  });

  test("a finding whose verdict rests on what it was written from is not asked about again", async () => {
    const finding: DataStoreFinding = waitingFinding();

    answer = answerWith([
      { ref: "F1", verdict: DataStoreFindingVerdict.CannotTell },
    ]);
    await judge();

    finding.aiVerdictInputHash = writtenVerdicts()[0]!.data[
      "aiVerdictInputHash"
    ] as string;
    askSpy.mockClear();
    writeSpy.mockClear();

    const again: FindingVerdictOutcome = await judge();

    expect(again).toMatchObject({ waiting: 1, judged: 0, unchanged: 1 });
    expect(askSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();

    // A new decision like it changes what it rests on: it is asked again.
    decision(DataStoreFindingDecision.NotSensitive, "order_number", 9);
    await judge();

    expect(askSpy).toHaveBeenCalledTimes(1);
  });

  test("a scan that changes its counts a little changes nothing it is told", async () => {
    const finding: DataStoreFinding = waitingFinding();

    answer = answerWith([
      { ref: "F1", verdict: DataStoreFindingVerdict.CannotTell },
    ]);
    await judge();
    finding.aiVerdictInputHash = writtenVerdicts()[0]!.data[
      "aiVerdictInputHash"
    ] as string;
    askSpy.mockClear();

    finding.matchCount = 83;
    finding.valueCount = 1003;
    finding.matchPercent = 8;
    await judge();

    expect(askSpy).not.toHaveBeenCalled();
  });

  test("Enable AI off, or OneUptime AI's work on its own off: nothing is asked or written", async () => {
    waitingFinding();

    project.enableAi = false;
    expect((await judge()).skipped).toBe(FindingVerdictSkip.AiOff);

    project.enableAi = true;
    project.enableAutomaticDataSecurityAi = false;
    expect((await judge()).skipped).toBe(FindingVerdictSkip.AiOff);

    expect(askSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test("a rule whose Judge is Off: nothing is asked", async () => {
    rules = [rule(DataSecurityAiAutonomy.Off)];
    waitingFinding();

    expect((await judge()).skipped).toBe(FindingVerdictSkip.JudgeOff);
    expect(askSpy).not.toHaveBeenCalled();
  });

  test("rules that cannot be read: nothing is asked", async () => {
    rules = null;
    waitingFinding();

    expect((await judge()).skipped).toBe(FindingVerdictSkip.RulesUnreadable);
    expect(askSpy).not.toHaveBeenCalled();
  });

  test("a store gone from its cloud, or with nothing waiting: nothing is asked", async () => {
    expect((await judge()).skipped).toBe(FindingVerdictSkip.NothingWaits);

    waitingFinding();
    store.isArchived = true;
    expect((await judge()).skipped).toBe(FindingVerdictSkip.StoreGone);
    expect(askSpy).not.toHaveBeenCalled();
  });

  test("a refusal, or an answer that is not the JSON asked for, writes nothing", async () => {
    waitingFinding();

    answer = new Error("Enable AI is off.");
    expect((await judge()).skipped).toBe(FindingVerdictSkip.NoAnswer);

    answer = "Sure! Here are my verdicts.";
    expect((await judge()).skipped).toBe(FindingVerdictSkip.NoAnswer);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test("at most two calls of twenty findings, the ones never judged first", async () => {
    for (let index: number = 0; index < 45; index++) {
      waitingFinding({ location: `t.field_${index}_ref` });
    }

    answer = answerWith([]);
    await judge();

    expect(askSpy).toHaveBeenCalledTimes(2);
    expect(sentData(0)["findings"]).toHaveLength(20);
    expect(sentData(1)["findings"]).toHaveLength(20);
  });

  test("in the project's language", async () => {
    (ProjectLanguage.getLanguage as unknown as jest.SpyInstance).mockResolvedValue(
      "de",
    );
    waitingFinding();
    answer = answerWith([
      { ref: "F1", verdict: DataStoreFindingVerdict.CannotTell },
    ]);

    await judge();

    expect(
      (askSpy.mock.calls[0]![0] as DataSecurityAiCallRequest).prompt
        .instructions,
    ).toContain("in German");
    expect(writtenVerdicts()[0]!.record!.language).toBe("de");
  });

  test("never reads a finding's masked samples or records", async () => {
    waitingFinding();
    answer = answerWith([]);

    await judge();

    for (const call of (
      DataStoreFindingService.findBy as unknown as jest.SpyInstance
    ).mock.calls) {
      const select: JSONObject = (call[0] as { select: JSONObject }).select;

      expect(select["maskedSamples"]).toBeUndefined();
      expect(select["sampleRecords"]).toBeUndefined();
    }
  });
});
