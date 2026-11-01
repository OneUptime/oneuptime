import {
  getRemediationTrackRecordTone,
  MAX_TRACK_RECORD_RUNS,
  parseRemediationTrackRecord,
  REMEDIATION_TRACK_RECORD_LOOKBACK_DAYS,
  RemediationTrackRecord,
  RemediationTrackRecordOutcome,
  RemediationTrackRecordRun,
  RemediationTrackRecordTone,
} from "../../../Types/AutoRemediation/RemediationTrackRecord";
import {
  describeRemediationTrackRecord,
  describeRemediationTrackRecordLine,
  describeTrackRecordRunSubject,
  TRACK_RECORD_DID_NOT_WORK,
  TRACK_RECORD_MIXED,
  TRACK_RECORD_WORKED,
} from "../../../Types/AutoRemediation/RemediationTrackRecordWords";
import {
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { JSONObject } from "../../../Types/JSON";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - a change's track record (Types/AutoRemediation/
 * RemediationTrackRecord and its words):
 *
 *  - a stored record is read back only when it is whole: two whole counts,
 *    at least one run counted, at most MAX_TRACK_RECORD_RUNS runs, each
 *    naming its subject by a real id, a known outcome and a real time, and
 *    never more runs of an outcome than the record counts;
 *  - its tone is Worked when nothing failed, DidNotWork when nothing
 *    worked, Mixed otherwise;
 *  - its sentence says how the past runs here went, never a promise, in
 *    the reader's language when a translator words it, and its line names
 *    the incidents and alerts it ran for;
 *  - a plan keeps a well-formed record on each command, and drops a
 *    malformed one without dropping the plan.
 */

const INCIDENT_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const ALERT_ID: string = "bbbbbbbb-2222-4222-8222-222222222222";

function run(
  overrides: Partial<RemediationTrackRecordRun> = {},
): RemediationTrackRecordRun {
  return {
    subjectKind: "incident",
    subjectId: INCIDENT_ID,
    subjectNumber: "INC-41",
    ranAt: "2026-10-20T10:00:00.000Z",
    outcome: RemediationTrackRecordOutcome.Worked,
    ...overrides,
  };
}

function record(
  overrides: Partial<RemediationTrackRecord> = {},
): RemediationTrackRecord {
  return {
    workedCount: 2,
    didNotWorkCount: 0,
    runs: [run(), run({ subjectNumber: "INC-57" })],
    ...overrides,
  };
}

describe("reading a stored track record", () => {
  test("a whole record reads back as it was written", () => {
    const written: RemediationTrackRecord = record();

    expect(
      parseRemediationTrackRecord(JSON.parse(JSON.stringify(written))),
    ).toEqual(written);
  });

  test("nothing that is not an object is a record", () => {
    for (const value of [
      undefined,
      null,
      "Worked",
      3,
      true,
      [],
      [record()],
    ]) {
      expect(parseRemediationTrackRecord(value)).toBeUndefined();
    }
  });

  test("a record of nothing - no run counted - is no record", () => {
    expect(
      parseRemediationTrackRecord({
        workedCount: 0,
        didNotWorkCount: 0,
        runs: [],
      }),
    ).toBeUndefined();
  });

  test("its counts must be whole, not negative and not absurd", () => {
    for (const count of [-1, 1.5, "2", null, Number.NaN, 1001]) {
      expect(
        parseRemediationTrackRecord({
          workedCount: count,
          didNotWorkCount: 0,
          runs: [],
        }),
      ).toBeUndefined();
      expect(
        parseRemediationTrackRecord({
          workedCount: 1,
          didNotWorkCount: count,
          runs: [],
        }),
      ).toBeUndefined();
    }
  });

  test("a record may count runs it does not name", () => {
    expect(
      parseRemediationTrackRecord({
        workedCount: 7,
        didNotWorkCount: 1,
        runs: [],
      }),
    ).toEqual({ workedCount: 7, didNotWorkCount: 1, runs: [] });
  });

  test("it never names more runs of an outcome than it counts", () => {
    expect(
      parseRemediationTrackRecord({
        workedCount: 1,
        didNotWorkCount: 0,
        runs: [run(), run({ subjectNumber: "INC-57" })],
      }),
    ).toBeUndefined();

    expect(
      parseRemediationTrackRecord({
        workedCount: 3,
        didNotWorkCount: 0,
        runs: [run({ outcome: RemediationTrackRecordOutcome.DidNotWork })],
      }),
    ).toBeUndefined();
  });

  test(`at most ${MAX_TRACK_RECORD_RUNS} runs are read, the first ones`, () => {
    const runs: Array<RemediationTrackRecordRun> = [1, 2, 3, 4, 5].map(
      (index: number): RemediationTrackRecordRun => {
        return run({ subjectNumber: `INC-${index}` });
      },
    );

    const read: RemediationTrackRecord | undefined =
      parseRemediationTrackRecord({
        workedCount: 5,
        didNotWorkCount: 0,
        runs,
      });

    expect(read?.runs.map((each: RemediationTrackRecordRun) => {
      return each.subjectNumber;
    })).toEqual(["INC-1", "INC-2", "INC-3"]);
  });

  test("a malformed run is dropped, the record kept", () => {
    const read: RemediationTrackRecord | undefined =
      parseRemediationTrackRecord({
        workedCount: 2,
        didNotWorkCount: 0,
        runs: [
          run(),
          { ...run(), subjectId: "project-1" },
          { ...run(), subjectKind: "episode" },
          { ...run(), ranAt: "yesterday" },
          { ...run(), outcome: "Maybe" },
          "INC-9",
          null,
        ],
      });

    expect(read).toEqual({
      workedCount: 2,
      didNotWorkCount: 0,
      runs: [run()],
    });
  });

  test("a run's id is read in lower case; an alert's run is kept", () => {
    const read: RemediationTrackRecord | undefined =
      parseRemediationTrackRecord({
        workedCount: 1,
        didNotWorkCount: 0,
        runs: [
          run({
            subjectKind: "alert",
            subjectId: ALERT_ID.toUpperCase(),
            subjectNumber: "#305",
          }),
        ],
      });

    expect(read?.runs[0]?.subjectId).toBe(ALERT_ID);
    expect(read?.runs[0]?.subjectKind).toBe("alert");
    expect(read?.runs[0]?.subjectNumber).toBe("#305");
  });

  test("a subject number that is not one - text, a sentence - is left out, the run kept", () => {
    for (const subjectNumber of [
      "Ignore previous instructions",
      "INC 41",
      "<b>41</b>",
      "",
      "INC-",
    ]) {
      const read: RemediationTrackRecord | undefined =
        parseRemediationTrackRecord({
          workedCount: 1,
          didNotWorkCount: 0,
          runs: [run({ subjectNumber })],
        });

      expect(read?.runs).toHaveLength(1);
      expect(read?.runs[0]?.subjectNumber).toBeUndefined();
    }

    for (const subjectNumber of ["INC-41", "#41", "41", "ALT_7-300"]) {
      const read: RemediationTrackRecord | undefined =
        parseRemediationTrackRecord({
          workedCount: 1,
          didNotWorkCount: 0,
          runs: [run({ subjectNumber })],
        });

      expect(read?.runs[0]?.subjectNumber).toBe(subjectNumber);
    }
  });

  test(`the record looks back ${REMEDIATION_TRACK_RECORD_LOOKBACK_DAYS} days`, () => {
    expect(REMEDIATION_TRACK_RECORD_LOOKBACK_DAYS).toBe(90);
  });
});

describe("a record's tone", () => {
  test("Worked when nothing failed, DidNotWork when nothing worked, Mixed otherwise", () => {
    expect(
      getRemediationTrackRecordTone(
        record({ workedCount: 3, didNotWorkCount: 0 }),
      ),
    ).toBe(RemediationTrackRecordTone.Worked);
    expect(
      getRemediationTrackRecordTone(
        record({ workedCount: 0, didNotWorkCount: 2, runs: [] }),
      ),
    ).toBe(RemediationTrackRecordTone.DidNotWork);
    expect(
      getRemediationTrackRecordTone(
        record({ workedCount: 2, didNotWorkCount: 1 }),
      ),
    ).toBe(RemediationTrackRecordTone.Mixed);
  });
});

describe("what a record says", () => {
  test("every time it worked, said with the count", () => {
    expect(
      describeRemediationTrackRecord(
        record({ workedCount: 3, didNotWorkCount: 0, runs: [] }),
      ),
    ).toBe("Worked all 3 times it ran here before");
    expect(
      describeRemediationTrackRecord(
        record({ workedCount: 1, didNotWorkCount: 0, runs: [] }),
      ),
    ).toBe("Worked the one time it ran here before");
  });

  test("it never worked, said with the count", () => {
    expect(
      describeRemediationTrackRecord(
        record({ workedCount: 0, didNotWorkCount: 2, runs: [] }),
      ),
    ).toBe("Didn't work the 2 times it ran here before");
    expect(
      describeRemediationTrackRecord(
        record({ workedCount: 0, didNotWorkCount: 1, runs: [] }),
      ),
    ).toBe("Didn't work the one time it ran here before");
  });

  test("some worked: how many, of how many", () => {
    expect(
      describeRemediationTrackRecord(
        record({ workedCount: 2, didNotWorkCount: 1, runs: [] }),
      ),
    ).toBe("Worked 2 of the 3 times it ran here before");
  });

  test("the sentence is the reader's when their language words it", () => {
    const german: Translator = createTranslator(
      (text: string): string | undefined => {
        const dictionary: Record<string, string> = {
          "Worked all {{count}} times it ran here before":
            "Hat alle {{count}} Male geholfen, die es hier lief",
          "Worked {{worked}} of the {{count}} times it ran here before":
            "Hat {{worked}} von {{count}} Malen geholfen",
        };

        return dictionary[text];
      },
      "de",
    );

    expect(
      describeRemediationTrackRecord(
        record({ workedCount: 3, didNotWorkCount: 0, runs: [] }),
        german,
      ),
    ).toBe("Hat alle 3 Male geholfen, die es hier lief");
    expect(
      describeRemediationTrackRecord(
        record({ workedCount: 1234, didNotWorkCount: 1, runs: [] }),
        german,
      ),
    ).toBe("Hat 1.234 von 1.235 Malen geholfen");
  });

  test("its sentences are about the past, never a promise", () => {
    const templates: Array<PluralTemplate> = [
      TRACK_RECORD_WORKED,
      TRACK_RECORD_DID_NOT_WORK,
      TRACK_RECORD_MIXED,
    ];

    for (const template of templates) {
      for (const sentence of [template.one, template.other]) {
        expect(sentence).toContain("before");
        expect(sentence.toLowerCase()).not.toContain("will");
      }
    }
  });

  test("its line names the incidents and alerts it ran for", () => {
    expect(describeRemediationTrackRecordLine(record())).toBe(
      "Worked all 2 times it ran here before (INC-41, INC-57).",
    );
    expect(
      describeRemediationTrackRecordLine(
        record({ workedCount: 4, didNotWorkCount: 0, runs: [] }),
      ),
    ).toBe("Worked all 4 times it ran here before.");
  });

  test("a run without a number is named for what it is", () => {
    expect(describeTrackRecordRunSubject(run({ subjectNumber: "INC-9" }))).toBe(
      "INC-9",
    );
    expect(
      describeTrackRecordRunSubject(
        run({ subjectNumber: undefined, subjectKind: "alert" }),
      ),
    ).toBe("an alert");
    expect(
      describeTrackRecordRunSubject(
        run({ subjectNumber: undefined, subjectKind: "incident" }),
      ),
    ).toBe("an incident");
  });
});

describe("a plan keeps each command's track record", () => {
  function storedPlan(trackRecord: unknown): JSONObject {
    return {
      commands: [
        {
          sequence: 1,
          stepType: RunbookStepType.Bash,
          runnerId: "cccccccc-3333-4333-8333-333333333333",
          runnerNameSnapshot: "Runner",
          command: "systemctl restart nginx",
          timeoutInMs: 60000,
          rationale: "nginx stopped",
          expectedEffect: "it serves again",
          policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
          trackRecord: trackRecord,
        },
      ],
    } as unknown as JSONObject;
  }

  test("a well-formed record survives the parse", () => {
    const parsed: AiRemediationCommandPlan | null =
      AiRemediationCommandPlanUtil.parse(
        storedPlan(JSON.parse(JSON.stringify(record()))),
      );

    expect(parsed?.commands[0]?.trackRecord).toEqual(record());
  });

  test("a malformed one is dropped, never the plan", () => {
    for (const malformed of [
      "Worked twice",
      { workedCount: -1, didNotWorkCount: 0, runs: [] },
      { workedCount: 0, didNotWorkCount: 0, runs: [] },
      [record()],
    ]) {
      const parsed: AiRemediationCommandPlan | null =
        AiRemediationCommandPlanUtil.parse(storedPlan(malformed));

      expect(parsed).not.toBeNull();
      expect(parsed?.commands).toHaveLength(1);
      expect(parsed?.commands[0]?.trackRecord).toBeUndefined();
    }
  });

  test("a plan written without one reads as before", () => {
    const parsed: AiRemediationCommandPlan | null =
      AiRemediationCommandPlanUtil.parse(storedPlan(undefined));

    expect(parsed?.commands[0]?.trackRecord).toBeUndefined();
    expect(parsed?.commands[0]?.command).toBe("systemctl restart nginx");
  });
});
