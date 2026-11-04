import RemediationTrackRecordReader, {
  buildRunbookTrackRecord,
  describeRunbookTrackRecordForPlanner,
  EarlierRunbookFix,
  MAX_EARLIER_RUNBOOK_FIXES_READ,
  RUNBOOK_TRACK_RECORD_PLANNER_NOTE,
} from "../../../../../Server/Utils/AI/Remediation/RemediationTrackRecordReader";
import AlertService from "../../../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import logger from "../../../../../Server/Utils/Logger";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  MAX_TRACK_RECORD_RUNS,
  REMEDIATION_TRACK_RECORD_LOOKBACK_DAYS,
  REMEDIATION_TRACK_RECORD_MAX_FIXES_READ,
  RemediationTrackRecord,
  RemediationTrackRecordOutcome,
  parseRemediationTrackRecord,
  serializeRemediationTrackRecord,
} from "../../../../../Types/AutoRemediation/RemediationTrackRecord";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Contract under test - how a runbook went the last times OneUptime AI ran
 * it as a fix (RemediationTrackRecordReader.readRunbookTrackRecords, #5519's
 * follow-up), as a change of a plan carries how it went on its cluster or
 * resource:
 *
 *  - a runbook names its own targets in its steps, so its record is its
 *    runs as OneUptime AI's fix anywhere in the project: Runbook fixes of
 *    that runbook, approved or started on their own, judged by
 *    verification, in the last REMEDIATION_TRACK_RECORD_LOOKBACK_DAYS days;
 *  - never the round's own suggestion or signal, never a private incident
 *    or alert - neither named nor counted;
 *  - every candidate runbook of a round is read in one query, each keeping
 *    its newest REMEDIATION_TRACK_RECORD_MAX_FIXES_READ, newest runs named;
 *  - the planner is told each candidate's record in the words the person
 *    approving reads, and how to weigh it;
 *  - the record round-trips through the suggestion's JSON column;
 *  - nothing here throws: a record that cannot be read is none.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000a1",
);
const RUNBOOK_A: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000a2",
);
const RUNBOOK_B: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000a3",
);
const OWN_INCIDENT: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000a4",
);
const OWN_SUGGESTION: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000a5",
);
const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

function subjectId(index: number): string {
  return `10000000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`;
}

function runbookFix(data: {
  index: number;
  runbook?: ObjectID | undefined;
  alert?: boolean | undefined;
  subject?: ObjectID | undefined;
  verification?: AutoRemediationVerificationStatus | undefined;
  daysAgo?: number | undefined;
  id?: ObjectID | undefined;
}): AutoRemediationSuggestion {
  const fix: AutoRemediationSuggestion = new AutoRemediationSuggestion(
    data.id ||
      new ObjectID(
        `10000000-0000-4000-8000-0000000003${String(data.index).padStart(2, "0")}`,
      ),
  );
  const subject: ObjectID = data.subject || new ObjectID(subjectId(data.index));

  if (data.alert) {
    fix.alertId = subject;
  } else {
    fix.incidentId = subject;
  }

  fix.runbookId = data.runbook || RUNBOOK_A;
  fix.suggestionType = AutoRemediationSuggestionType.Runbook;
  fix.verificationStatus =
    data.verification || AutoRemediationVerificationStatus.Verified;
  fix.approvedAt = new Date(
    NOW.getTime() - (data.daysAgo ?? data.index) * 24 * 60 * 60 * 1000,
  );
  fix.createdAt = fix.approvedAt;
  return fix;
}

describe("a runbook's track record", () => {
  let fixes: Array<AutoRemediationSuggestion>;
  let privateIds: Set<string>;
  let fixFind: jest.SpyInstance;

  beforeEach(() => {
    fixes = [];
    privateIds = new Set<string>();

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    fixFind = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockImplementation(
        async (): Promise<Array<AutoRemediationSuggestion>> => {
          return fixes;
        },
      );
    // Each fix's incident or alert, as the project has it.
    jest
      .spyOn(IncidentService, "findBy")
      .mockImplementation(async (): Promise<Array<Incident>> => {
        return fixes
          .filter((fix: AutoRemediationSuggestion): boolean => {
            return Boolean(fix.incidentId);
          })
          .map((fix: AutoRemediationSuggestion, index: number): Incident => {
            const incident: Incident = new Incident(fix.incidentId!);
            incident.incidentNumber = 40 + index;
            incident.incidentNumberWithPrefix = `INC-${40 + index}`;
            incident.isPrivate = privateIds.has(fix.incidentId!.toString());
            return incident;
          });
      });
    jest
      .spyOn(AlertService, "findBy")
      .mockImplementation(async (): Promise<Array<Alert>> => {
        return fixes
          .filter((fix: AutoRemediationSuggestion): boolean => {
            return Boolean(fix.alertId);
          })
          .map((fix: AutoRemediationSuggestion, index: number): Alert => {
            const alert: Alert = new Alert(fix.alertId!);
            alert.alertNumber = 300 + index;
            alert.isPrivate = privateIds.has(fix.alertId!.toString());
            return alert;
          });
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function read(
    runbookIds: Array<ObjectID> = [RUNBOOK_A],
  ): Promise<Map<string, RemediationTrackRecord>> {
    return await RemediationTrackRecordReader.readRunbookTrackRecords({
      projectId: PROJECT_ID,
      runbookIds,
      excludeSuggestionId: OWN_SUGGESTION,
      excludeSubject: { incidentId: OWN_INCIDENT },
      now: NOW,
    });
  }

  test("reads the runbooks' judged fixes of the window, in the project, in one query", async () => {
    await read([RUNBOOK_A, RUNBOOK_B]);

    expect(fixFind).toHaveBeenCalledTimes(1);

    const findBy: JSONObject = fixFind.mock.calls[0]![0] as JSONObject;
    const query: JSONObject = findBy["query"] as JSONObject;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["suggestionType"]).toBe(AutoRemediationSuggestionType.Runbook);
    expect(JSON.stringify(query["runbookId"])).toContain(RUNBOOK_A.toString());
    expect(JSON.stringify(query["runbookId"])).toContain(RUNBOOK_B.toString());
    expect(JSON.stringify(query["status"])).toContain(
      AutoRemediationSuggestionStatus.Approved,
    );
    expect(JSON.stringify(query["status"])).toContain(
      AutoRemediationSuggestionStatus.AutoExecuted,
    );
    expect(JSON.stringify(query["status"])).not.toContain(
      AutoRemediationSuggestionStatus.Suggested,
    );
    expect(JSON.stringify(query["verificationStatus"])).toContain(
      AutoRemediationVerificationStatus.Verified,
    );
    expect(JSON.stringify(query["verificationStatus"])).toContain(
      AutoRemediationVerificationStatus.Failed,
    );
    expect(JSON.stringify(query["verificationStatus"])).not.toContain(
      AutoRemediationVerificationStatus.Pending,
    );
    expect(JSON.stringify(query["createdAt"])).toContain(
      new Date(
        NOW.getTime() -
          REMEDIATION_TRACK_RECORD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
    expect(findBy["limit"]).toBe(REMEDIATION_TRACK_RECORD_MAX_FIXES_READ * 2);
  });

  test("however many candidates, the read stays bounded", async () => {
    await read(
      Array.from({ length: 50 }, (_: unknown, index: number) => {
        return new ObjectID(
          `10000000-0000-4000-8000-0000000004${String(index).padStart(2, "0")}`,
        );
      }),
    );

    expect((fixFind.mock.calls[0]![0] as JSONObject)["limit"]).toBe(
      MAX_EARLIER_RUNBOOK_FIXES_READ,
    );
  });

  test("counts how often each runbook worked, the newest runs named first", async () => {
    fixes = [
      runbookFix({ index: 1 }),
      runbookFix({
        index: 2,
        verification: AutoRemediationVerificationStatus.Failed,
      }),
      runbookFix({ index: 3, alert: true }),
      runbookFix({ index: 4 }),
      runbookFix({ index: 5, runbook: RUNBOOK_B }),
    ];

    const records: Map<string, RemediationTrackRecord> = await read([
      RUNBOOK_A,
      RUNBOOK_B,
    ]);
    const a: RemediationTrackRecord = records.get(
      RUNBOOK_A.toString().toLowerCase(),
    )!;

    expect(a.workedCount).toBe(3);
    expect(a.didNotWorkCount).toBe(1);
    expect(a.runs).toHaveLength(MAX_TRACK_RECORD_RUNS);
    expect(
      a.runs.map((run: { subjectKind: string; outcome: string }) => {
        return `${run.subjectKind}:${run.outcome}`;
      }),
    ).toEqual([
      `incident:${RemediationTrackRecordOutcome.Worked}`,
      `incident:${RemediationTrackRecordOutcome.DidNotWork}`,
      `alert:${RemediationTrackRecordOutcome.Worked}`,
    ]);
    expect(a.runs[0]?.subjectNumber).toMatch(/^INC-/);
    expect(a.runs[2]?.subjectNumber).toMatch(/^#30/);
    expect(records.get(RUNBOOK_B.toString().toLowerCase())?.workedCount).toBe(
      1,
    );
  });

  test("never the round's own suggestion or signal, never a private incident or alert", async () => {
    privateIds = new Set<string>([subjectId(2), subjectId(3)]);
    fixes = [
      runbookFix({ index: 1, id: OWN_SUGGESTION }),
      runbookFix({ index: 6, subject: OWN_INCIDENT }),
      runbookFix({ index: 2 }),
      runbookFix({ index: 3, alert: true }),
    ];

    expect((await read()).size).toBe(0);

    fixes.push(runbookFix({ index: 4 }));

    const record: RemediationTrackRecord | undefined = (await read()).get(
      RUNBOOK_A.toString().toLowerCase(),
    );

    expect(record?.workedCount).toBe(1);
    expect(record?.didNotWorkCount).toBe(0);
  });

  test("each runbook keeps its newest fixes only", async () => {
    fixes = Array.from(
      { length: REMEDIATION_TRACK_RECORD_MAX_FIXES_READ + 5 },
      (_: unknown, index: number) => {
        return runbookFix({ index });
      },
    );

    const record: RemediationTrackRecord | undefined = (await read()).get(
      RUNBOOK_A.toString().toLowerCase(),
    );

    expect((record?.workedCount || 0) + (record?.didNotWorkCount || 0)).toBe(
      REMEDIATION_TRACK_RECORD_MAX_FIXES_READ,
    );
  });

  test("no runbook, or none that is an id, reads nothing; a failed read is no record", async () => {
    expect((await read([])).size).toBe(0);
    expect(fixFind).not.toHaveBeenCalled();

    fixFind.mockRejectedValue(new Error("Database not connected"));

    expect((await read()).size).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not read the runbooks' earlier fixes"),
    );
  });
});

describe("a runbook's record, pure", () => {
  function earlier(
    index: number,
    outcome: RemediationTrackRecordOutcome,
  ): EarlierRunbookFix {
    return {
      suggestionId: `s-${index}`,
      runbookId: RUNBOOK_A.toString(),
      subjectKind: "incident",
      subjectId: subjectId(index),
      subjectNumber: `INC-${index}`,
      ranAt: new Date(NOW.getTime() - index * 60 * 60 * 1000),
      outcome,
    };
  }

  test("is none until it ran, then its counts and newest runs", () => {
    expect(buildRunbookTrackRecord([])).toBeUndefined();

    const record: RemediationTrackRecord | undefined = buildRunbookTrackRecord([
      earlier(3, RemediationTrackRecordOutcome.DidNotWork),
      earlier(1, RemediationTrackRecordOutcome.Worked),
      earlier(2, RemediationTrackRecordOutcome.Worked),
      earlier(4, RemediationTrackRecordOutcome.Worked),
    ]);

    expect(record?.workedCount).toBe(3);
    expect(record?.didNotWorkCount).toBe(1);
    expect(
      record?.runs.map((run: { subjectNumber?: string | undefined }) => {
        return run.subjectNumber;
      }),
    ).toEqual(["INC-1", "INC-2", "INC-3"]);
  });

  test("the planner reads it in the approver's words, and how to weigh it", () => {
    const record: RemediationTrackRecord = buildRunbookTrackRecord([
      earlier(1, RemediationTrackRecordOutcome.Worked),
      earlier(2, RemediationTrackRecordOutcome.Worked),
    ])!;

    expect(describeRunbookTrackRecordForPlanner(record)).toBe(
      "track record: Worked both times it ran here before (INC-1, INC-2).",
    );
    expect(describeRunbookTrackRecordForPlanner(undefined)).toBeNull();
    expect(RUNBOOK_TRACK_RECORD_PLANNER_NOTE).toContain(
      `(last ${REMEDIATION_TRACK_RECORD_LOOKBACK_DAYS} days), as verification judged it`,
    );
    expect(RUNBOOK_TRACK_RECORD_PLANNER_NOTE).toContain(
      "do not pick one that did not work unless the evidence shows why it would work now, and say why",
    );
    expect(RUNBOOK_TRACK_RECORD_PLANNER_NOTE).toContain(
      "the runbook must still address what the telemetry shows",
    );
  });

  test("round-trips through the suggestion's JSON column", () => {
    const record: RemediationTrackRecord = buildRunbookTrackRecord([
      earlier(1, RemediationTrackRecordOutcome.Worked),
      earlier(2, RemediationTrackRecordOutcome.DidNotWork),
    ])!;
    const stored: JSONObject = JSON.parse(
      JSON.stringify(serializeRemediationTrackRecord(record)),
    ) as JSONObject;

    expect(parseRemediationTrackRecord(stored)).toEqual(record);
    // A run without a number keeps none in the column.
    const unnamed: JSONObject = serializeRemediationTrackRecord({
      ...record,
      runs: [{ ...record.runs[0]!, subjectNumber: undefined }],
    });
    expect(
      Object.keys((unnamed["runs"] as Array<JSONObject>)[0]!),
    ).not.toContain("subjectNumber");
  });
});
