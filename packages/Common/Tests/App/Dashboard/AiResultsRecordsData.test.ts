import { describe, expect, test } from "@jest/globals";
import {
  AI_RESULTS_RECORDS_CLICK_HINTS,
  AI_RESULTS_RECORDS_COUNTS,
  describeRecordSubject,
  describeRecordsCount,
  getRecordFacts,
  parseAiOutcomesRecords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsRecordsData";
import {
  AI_OUTCOMES_PARTS,
  AiOutcomesPart,
  AiOutcomesRecord,
  AiOutcomesRecords,
} from "../../../Types/AI/AiOutcomes";
import AIRunAutoGrade from "../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../Types/AI/AIRunHumanVerdict";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { JSONObject } from "../../../Types/JSON";

/*
 * THE RECORDS BEHIND AN AI RESULTS NUMBER (issue #7768), in the dialog's
 * words: the server's answer read defensively, the line that says how many
 * it lists, and what each record says beyond its incident or alert. English
 * here: no i18next is set up.
 */

const RECORDS: AiOutcomesRecords = {
  part: AiOutcomesPart.RootCauses,
  outcome: "wrong",
  total: 15,
  records: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      at: "2026-11-10T09:00:00.000Z",
      subject: {
        kind: "incident",
        id: "55555555-5555-4555-8555-555555555555",
        title: "Checkout is down",
        number: 42,
        numberWithPrefix: "INC-42",
      },
      summary: "The database ran out of connections.",
      humanVerdict: AIRunHumanVerdict.Rejected,
      autoGrade: AIRunAutoGrade.Mismatch,
    },
  ],
  nextSkip: 50,
};

function body(records: AiOutcomesRecords = RECORDS): JSONObject {
  return JSON.parse(JSON.stringify(records)) as JSONObject;
}

describe("parseAiOutcomesRecords", () => {
  test("reads the server's answer as it was sent", () => {
    expect(parseAiOutcomesRecords(body())).toEqual(RECORDS);
  });

  test("the last page has no next one", () => {
    expect(
      parseAiOutcomesRecords(body({ ...RECORDS, nextSkip: null }))!.nextSkip,
    ).toBeNull();
  });

  test.each([
    ["nothing", undefined],
    ["a list", []],
    ["an unknown part", { ...body(), part: "everything" }],
    ["an outcome of another part", { ...body(), outcome: "holdTimeRanOut" }],
    ["no total", { ...body(), total: undefined }],
    ["a negative total", { ...body(), total: -1 }],
    ["no records", { ...body(), records: undefined }],
  ])("%s: nothing the dialog can draw", (_name: string, data: unknown) => {
    expect(parseAiOutcomesRecords(data)).toBeNull();
  });

  test("a record it cannot read is left out, the others kept", () => {
    const parsed: AiOutcomesRecords | null = parseAiOutcomesRecords({
      ...body(),
      records: [
        ...(body()["records"] as Array<JSONObject>),
        { id: "", at: "2026-11-10T09:00:00.000Z" },
        { id: "66666666-6666-4666-8666-666666666666", at: "yesterday" },
        "not a record",
      ],
    });

    expect(parsed!.records).toEqual(RECORDS.records);
  });

  test("an incident or alert it cannot read is no subject", () => {
    const parsed: AiOutcomesRecords | null = parseAiOutcomesRecords({
      ...body(),
      records: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          at: "2026-11-10T09:00:00.000Z",
          subject: { kind: "monitor", id: "1" },
        },
      ],
    });

    expect(parsed!.records[0]!.subject).toBeUndefined();
  });

  test("a pull request's link only to a web address", () => {
    const record: (url: string) => AiOutcomesRecord | undefined = (
      url: string,
    ): AiOutcomesRecord | undefined => {
      return parseAiOutcomesRecords({
        ...body(),
        part: AiOutcomesPart.PullRequestFixes,
        outcome: "regressed",
        records: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            at: "2026-11-10T09:00:00.000Z",
            pullRequestNumber: 7,
            pullRequestTitle: "Raise the timeout",
            pullRequestUrl: url,
          },
        ],
      })!.records[0];
    };

    expect(record("https://github.com/acme/shop/pull/7")!.pullRequestUrl).toBe(
      "https://github.com/acme/shop/pull/7",
    );
    expect(record("javascript:alert(1)")!.pullRequestUrl).toBeUndefined();
    expect(record("//evil.example")!.pullRequestUrl).toBeUndefined();
    expect(
      record("https://github.com/acme/shop/pull/7")!.pullRequestNumber,
    ).toBe(7);
  });
});

describe("the dialog's words", () => {
  test("how many it lists, for every part, in the plural forms of its count", () => {
    expect(describeRecordsCount(AiOutcomesPart.Pages, 1)).toBe(
      "1 held page over the last 12\u00A0weeks.",
    );
    expect(describeRecordsCount(AiOutcomesPart.Pages, 4)).toBe(
      "4 held pages over the last 12\u00A0weeks, newest first.",
    );
    expect(describeRecordsCount(AiOutcomesPart.RemediationFixes, 3)).toBe(
      "3 fixes OneUptime AI ran over the last 12\u00A0weeks, newest first.",
    );
    expect(describeRecordsCount(AiOutcomesPart.PullRequestFixes, 1)).toBe(
      "1 fix pull request OneUptime AI opened over the last 12\u00A0weeks.",
    );
    expect(describeRecordsCount(AiOutcomesPart.RootCauses, 15)).toBe(
      "15 investigations OneUptime AI finished over the last 12\u00A0weeks, newest first.",
    );

    for (const part of AI_OUTCOMES_PARTS) {
      expect(AI_RESULTS_RECORDS_COUNTS[part].one).toContain("{{count}}");
      expect(AI_RESULTS_RECORDS_COUNTS[part].other).toContain("{{count}}");
    }
  });

  test("each part says what pressing it shows", () => {
    expect(AI_RESULTS_RECORDS_CLICK_HINTS).toEqual({
      [AiOutcomesPart.Pages]: "Show the incidents and alerts",
      [AiOutcomesPart.RemediationFixes]: "Show the incidents and alerts",
      [AiOutcomesPart.PullRequestFixes]: "Show the pull requests",
      [AiOutcomesPart.RootCauses]: "Show the incidents and alerts",
    });
  });

  test("an incident or alert is named as the AI pages name it", () => {
    expect(describeRecordSubject(RECORDS.records[0]!.subject!)).toBe(
      "Incident INC-42: Checkout is down",
    );
    expect(
      describeRecordSubject({
        kind: "alert",
        id: "77777777-7777-4777-8777-777777777777",
        title: "Disk is full",
        number: 7,
      }),
    ).toBe("Alert #7: Disk is full");
  });
});

describe("what a record says beyond its incident or alert", () => {
  test("an investigation: how your team judged it and how it was graded", () => {
    expect(
      getRecordFacts(AiOutcomesPart.RootCauses, RECORDS.records[0]!),
    ).toEqual([
      "Rejected by your team",
      "Did not match the recorded root cause",
    ]);
    expect(
      getRecordFacts(AiOutcomesPart.RootCauses, {
        id: "1",
        at: "2026-11-10T09:00:00.000Z",
        autoGrade: AIRunAutoGrade.Partial,
      }),
    ).toEqual(["Partly matched the recorded root cause"]);
  });

  test("a fix: what kind it was - unless it names its runbook", () => {
    expect(
      getRecordFacts(AiOutcomesPart.RemediationFixes, {
        id: "1",
        at: "2026-11-10T09:00:00.000Z",
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
      }),
    ).toEqual(["Command plan"]);
    expect(
      getRecordFacts(AiOutcomesPart.RemediationFixes, {
        id: "1",
        at: "2026-11-10T09:00:00.000Z",
        suggestionType: AutoRemediationSuggestionType.Runbook,
        runbookName: "Restart checkout",
      }),
    ).toEqual([]);
    expect(
      getRecordFacts(AiOutcomesPart.RemediationFixes, {
        id: "1",
        at: "2026-11-10T09:00:00.000Z",
      }),
    ).toEqual([]);
  });

  test("a held page and a pull request: nothing more", () => {
    for (const part of [
      AiOutcomesPart.Pages,
      AiOutcomesPart.PullRequestFixes,
    ]) {
      expect(getRecordFacts(part, RECORDS.records[0]!)).toEqual([]);
    }
  });
});
