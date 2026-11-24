import {
  AiFindingToJudge,
  DATA_SECURITY_AI_DATA_RULE,
  DataSecurityAiPrompt,
  isDataSecurityAiPrompt,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import {
  buildFindingVerdictPrompt,
  canConfirmOnItsOwn,
  FindingVerdictAnswer,
  getFindingReference,
  getFindingVerdictInstructions,
  getPrecedentReference,
  holdFindingVerdictToFacts,
  MAX_FINDINGS_PER_VERDICT_REQUEST,
  parseFindingVerdictResponse,
} from "../../../../../Server/Utils/AI/DataSecurity/FindingVerdictPrompt";
import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import DataConfidence from "../../../../../Types/DataSecurity/DataConfidence";
import {
  DataStoreFindingDecision,
  DataStoreFindingPrecedent,
  DataStoreFindingVerdict,
  DataStoreFindingVerdictRecord,
  FindingWrongMatchSign,
} from "../../../../../Types/DataSecurity/DataStoreFindingVerdict";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT ONEUPTIME AI IS ASKED ABOUT THE FINDINGS THAT WAIT FOR A PERSON, AND
 * HOW ITS ANSWER IS HELD (#10372): the prompt is the builder's, in the
 * project's language; the answer is read strictly, and held to what it was
 * told - it cites only the precedent it was given and only what agrees,
 * a verdict with no reason is Cannot tell, the draft prefers the team's
 * own words - and a Confirm is made on its own only on the team's own
 * confirmation or a field named for the type.
 */

const NOW: Date = new Date("2026-11-23T10:00:00.000Z");

function precedent(
  decision: DataStoreFindingDecision,
  index: number,
  reason: string = "Order numbers, not cards.",
): DataStoreFindingPrecedent {
  return {
    findingId: `finding-${index}`,
    dataStoreId: `store-${index}`,
    location: "public.orders.order_number",
    decision,
    reason: decision === DataStoreFindingDecision.NotSensitive ? reason : "",
    isSameName: true,
  };
}

function answer(more: Partial<FindingVerdictAnswer> = {}): FindingVerdictAnswer {
  return {
    verdict: DataStoreFindingVerdict.NotSensitive,
    reason: "Your team marked order_number not sensitive on 4 stores.",
    precedentRefs: ["P1", "P2"],
    draft: "Order numbers that pass the Luhn check.",
    ...more,
  };
}

function hold(
  given: FindingVerdictAnswer,
  precedentList: Array<DataStoreFindingPrecedent>,
): DataStoreFindingVerdictRecord {
  return holdFindingVerdictToFacts({
    answer: given,
    precedent: precedentList,
    signs: [FindingWrongMatchSign.IdFieldWithLuhnNumbers],
    language: "en",
    now: NOW,
  });
}

function toJudge(index: number): AiFindingToJudge {
  return {
    ref: getFindingReference(index),
    finding: {
      _id: `finding-${index}`,
      dataTypeId: "credit-card-number",
      dataTypeName: "Card number",
      location: "public.orders.order_number",
      locationKind: "Column",
      confidence: DataConfidence.Low,
      valueCount: 1000,
      matchPercent: 8,
      matchCount: 80,
      distinctValues: 80,
      testValueCount: 0,
    },
    signs: [FindingWrongMatchSign.IdFieldWithLuhnNumbers],
    nameSaysInstead: [],
    precedent: [
      {
        ref: getPrecedentReference(0),
        decision: DataStoreFindingDecision.NotSensitive,
        location: "sales.orders.orderNumber",
        isSameName: true,
        reason: "Order numbers, not cards.",
        storeKind: DataStoreKind.PostgreSql,
      },
    ],
  };
}

describe("what OneUptime AI is asked", () => {
  test("is the builder's prompt, under the feature's own label", () => {
    const prompt: DataSecurityAiPrompt = buildFindingVerdictPrompt({
      store: { name: "orders-eu", kind: DataStoreKind.PostgreSql },
      findings: [toJudge(0)],
      language: "en",
    });

    expect(isDataSecurityAiPrompt(prompt)).toBe(true);
    expect(prompt.feature).toBe(DataSecurityAiFeature.JudgeFindings);
    expect(prompt.messages[0]!.content).toBe(
      `${getFindingVerdictInstructions("en")}\n\n${DATA_SECURITY_AI_DATA_RULE}`,
    );

    const data: JSONObject = JSON.parse(
      prompt.messages[1]!.content as string,
    ) as JSONObject;
    const first: JSONObject = (data["findings"] as Array<JSONObject>)[0]!;

    expect(first["ref"]).toBe("F1");
    expect(first["signsOfAWrongMatch"]).toEqual([
      "idFieldHoldingNumbersThatPassTheLuhnCheck",
    ]);
    expect((first["precedent"] as Array<JSONObject>)[0]).toEqual({
      ref: "P1",
      decision: "markedNotSensitive",
      location: "sales.orders.orderNumber",
      foundBy: "the same field name",
      store: { kind: DataStoreKind.PostgreSql },
      reason: "Order numbers, not cards.",
    });
  });

  test("asks for the reason and the draft in the project's language", () => {
    expect(getFindingVerdictInstructions("de")).toContain("in German");
    expect(getFindingVerdictInstructions("fa")).toContain("in Persian");
    expect(getFindingVerdictInstructions("en")).toContain("in English");
    // A language no build knows is asked for in English.
    expect(getFindingVerdictInstructions("xx")).toContain("in English");
  });

  test("says the team's decisions weigh most, and a secret is never dismissed on its own", () => {
    const instructions: string = getFindingVerdictInstructions("en");

    expect(instructions).toContain("The team's own decisions are the strongest evidence");
    expect(instructions).toContain(
      "only when precedent for the same field name marks it not sensitive",
    );
  });

  test("asks about at most the most findings one call takes", () => {
    const prompt: DataSecurityAiPrompt = buildFindingVerdictPrompt({
      store: { name: "orders-eu", kind: DataStoreKind.PostgreSql },
      findings: Array.from(
        { length: MAX_FINDINGS_PER_VERDICT_REQUEST + 5 },
        (_: unknown, index: number): AiFindingToJudge => {
          return toJudge(index);
        },
      ),
      language: "en",
    });
    const data: JSONObject = JSON.parse(
      prompt.messages[1]!.content as string,
    ) as JSONObject;

    expect(data["findings"]).toHaveLength(MAX_FINDINGS_PER_VERDICT_REQUEST);
  });
});

describe("how its answer is read", () => {
  const refs: ReadonlySet<string> = new Set(["F1", "F2"]);

  test("one verdict per finding asked about, each once", () => {
    const read: Map<string, FindingVerdictAnswer> | null =
      parseFindingVerdictResponse({
        content: JSON.stringify({
          findings: [
            {
              ref: "F1",
              verdict: "NotSensitive",
              reason: "Order numbers.",
              precedent: ["P1"],
              draft: "Order numbers.",
            },
            { ref: "F1", verdict: "Confirm", reason: "Twice." },
            { ref: "F9", verdict: "Confirm", reason: "Not asked." },
            { ref: "F2", verdict: "CannotTell", reason: null },
          ],
        }),
        references: refs,
      });

    expect([...(read?.keys() || [])]).toEqual(["F1", "F2"]);
    expect(read?.get("F1")?.verdict).toBe(DataStoreFindingVerdict.NotSensitive);
    expect(read?.get("F2")).toEqual({
      verdict: DataStoreFindingVerdict.CannotTell,
      reason: "",
      precedentRefs: [],
      draft: "",
    });
  });

  test("a verdict no build knows leaves that finding out", () => {
    const read: Map<string, FindingVerdictAnswer> | null =
      parseFindingVerdictResponse({
        content: JSON.stringify({
          findings: [
            { ref: "F1", verdict: "Ignore", reason: "?" },
            { ref: "F2", verdict: "Confirm", reason: "Named for it." },
          ],
        }),
        references: refs,
      });

    expect([...(read?.keys() || [])]).toEqual(["F2"]);
  });

  test.each([
    ["words around the JSON", 'Sure! {"findings":[]} Hope this helps.'],
    ["not JSON", "NotSensitive"],
    ["the wrong shape", JSON.stringify({ verdicts: [] })],
    ["nothing", ""],
  ])("%s is no answer", (_title: string, content: string) => {
    expect(
      parseFindingVerdictResponse({ content, references: refs }),
    ).toBeNull();
  });
});

describe("how the answer is held to what it was told", () => {
  const fourDismissals: Array<DataStoreFindingPrecedent> = [1, 2, 3, 4].map(
    (index: number): DataStoreFindingPrecedent => {
      return precedent(DataStoreFindingDecision.NotSensitive, index);
    },
  );

  test("a Not sensitive cites the decisions it was given, by their refs", () => {
    const record: DataStoreFindingVerdictRecord = hold(
      answer({ precedentRefs: ["P1", "P2", "P3", "P4"] }),
      fourDismissals,
    );

    expect(record.verdict).toBe(DataStoreFindingVerdict.NotSensitive);
    expect(
      record.precedent.map((entry: DataStoreFindingPrecedent): string => {
        return entry.findingId;
      }),
    ).toEqual(["finding-1", "finding-2", "finding-3", "finding-4"]);
    expect(record.signs).toEqual([FindingWrongMatchSign.IdFieldWithLuhnNumbers]);
    expect(record.writtenAt).toBe(NOW.toISOString());
  });

  test("a ref it was not given, or one twice, cites nothing", () => {
    const record: DataStoreFindingVerdictRecord = hold(
      answer({ precedentRefs: ["P1", "P1", "P9", "P0", "S1", "p2"] }),
      fourDismissals,
    );

    expect(
      record.precedent.map((entry: DataStoreFindingPrecedent): string => {
        return entry.findingId;
      }),
    ).toEqual(["finding-1"]);
  });

  test("a verdict cites only the decisions that agree with it", () => {
    const mixed: Array<DataStoreFindingPrecedent> = [
      precedent(DataStoreFindingDecision.NotSensitive, 1),
      precedent(DataStoreFindingDecision.Confirmed, 2),
    ];

    expect(
      hold(answer({ precedentRefs: ["P1", "P2"] }), mixed).precedent.map(
        (entry: DataStoreFindingPrecedent): string => {
          return entry.findingId;
        },
      ),
    ).toEqual(["finding-1"]);
    expect(
      hold(
        answer({
          verdict: DataStoreFindingVerdict.Confirm,
          precedentRefs: ["P1", "P2"],
        }),
        mixed,
      ).precedent.map((entry: DataStoreFindingPrecedent): string => {
        return entry.findingId;
      }),
    ).toEqual(["finding-2"]);
    // Cannot tell keeps what it weighed, both ways.
    expect(
      hold(
        answer({
          verdict: DataStoreFindingVerdict.CannotTell,
          precedentRefs: ["P1", "P2"],
        }),
        mixed,
      ).precedent,
    ).toHaveLength(2);
  });

  test("a Confirm or a Not sensitive with no reason is Cannot tell", () => {
    expect(hold(answer({ reason: "   " }), fourDismissals).verdict).toBe(
      DataStoreFindingVerdict.CannotTell,
    );
    expect(
      hold(
        answer({ verdict: DataStoreFindingVerdict.Confirm, reason: "" }),
        fourDismissals,
      ).verdict,
    ).toBe(DataStoreFindingVerdict.CannotTell);
  });

  test("only Not sensitive drafts a reason, the team's own words before a made-up one", () => {
    expect(hold(answer(), fourDismissals).draft).toBe(
      "Order numbers that pass the Luhn check.",
    );
    expect(hold(answer({ draft: "" }), fourDismissals).draft).toBe(
      "Order numbers, not cards.",
    );
    expect(
      hold(answer({ draft: "", precedentRefs: [] }), fourDismissals).draft,
    ).toBe("Your team marked order_number not sensitive on 4 stores.");
    expect(
      hold(
        answer({ verdict: DataStoreFindingVerdict.Confirm }),
        fourDismissals,
      ).draft,
    ).toBe("");
  });
});

describe("what OneUptime AI may confirm on its own, where a rule says so", () => {
  const confirm: (
    precedentList: Array<DataStoreFindingPrecedent>,
  ) => DataStoreFindingVerdictRecord = (
    precedentList: Array<DataStoreFindingPrecedent>,
  ): DataStoreFindingVerdictRecord => {
    return hold(
      answer({
        verdict: DataStoreFindingVerdict.Confirm,
        precedentRefs: ["P1"],
      }),
      precedentList,
    );
  };

  test("a Confirm on the team's own confirmation of a finding like it", () => {
    expect(
      canConfirmOnItsOwn({
        record: confirm([precedent(DataStoreFindingDecision.Confirmed, 1)]),
        isNameHinted: false,
      }),
    ).toBe(true);
  });

  test("a Confirm of a field named for the type", () => {
    expect(
      canConfirmOnItsOwn({ record: confirm([]), isNameHinted: true }),
    ).toBe(true);
  });

  test("never a Confirm that rests on neither", () => {
    expect(
      canConfirmOnItsOwn({ record: confirm([]), isNameHinted: false }),
    ).toBe(false);
  });

  test("never a Not sensitive, nor a Cannot tell, whatever they rest on", () => {
    for (const verdict of [
      DataStoreFindingVerdict.NotSensitive,
      DataStoreFindingVerdict.CannotTell,
    ]) {
      expect(
        canConfirmOnItsOwn({
          record: hold(answer({ verdict }), [
            precedent(DataStoreFindingDecision.Confirmed, 1),
          ]),
          isNameHinted: true,
        }),
      ).toBe(false);
    }
  });
});
