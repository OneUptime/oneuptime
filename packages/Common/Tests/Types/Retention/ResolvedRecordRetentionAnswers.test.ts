import ResolvedRecordRetentionAnswers, {
  DueRecordsCountRequest,
  RESOLVED_RECORD_RETENTION_COUNT_ROUTE,
  RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE,
  RESOLVED_RECORD_RETENTION_ROUTE,
} from "../../../Types/Retention/ResolvedRecordRetentionAnswers";
import { ResolvedRecordKind } from "../../../Types/Retention/ResolvedRecordRetention";
import { describe, expect, test } from "@jest/globals";

/*
 * What the Data Retention routes answer, read the way the Dashboard and the
 * Admin Dashboard read it (issues #6941, #6943). One shape on both sides: a
 * route writes it with these, a page reads it with these. A page must never
 * be told to lock a choice the server would not hold, nor read a count it
 * was not given as one.
 */

const STATUS: string = "6943a000-0000-4000-8000-000000000001";

describe("the routes", () => {
  test("live under the project's and the server's own paths", () => {
    expect(RESOLVED_RECORD_RETENTION_ROUTE).toBe("resolved-record-retention");
    expect(RESOLVED_RECORD_RETENTION_COUNT_ROUTE).toBe(
      "resolved-record-retention/count",
    );
    expect(RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE).toBe(
      "resolved-record-retention/projects-reached",
    );
  });
});

describe("the server's maximum", () => {
  test("is written with null for none and read back the same", () => {
    const json: Record<string, unknown> =
      ResolvedRecordRetentionAnswers.toLimitsJSON({
        incidentMaximumInDays: 365,
      });

    expect(json).toEqual({
      incidentMaximumInDays: 365,
      alertMaximumInDays: null,
    });
    expect(ResolvedRecordRetentionAnswers.readLimits(json)).toEqual({
      incidentMaximumInDays: 365,
      alertMaximumInDays: undefined,
    });
  });

  test("a value that is not a choice locks nothing", () => {
    for (const value of [45, 0, -1, "x", {}, true]) {
      expect(
        ResolvedRecordRetentionAnswers.readLimits({
          incidentMaximumInDays: value,
          alertMaximumInDays: value,
        }),
      ).toEqual({
        incidentMaximumInDays: undefined,
        alertMaximumInDays: undefined,
      });
    }

    expect(ResolvedRecordRetentionAnswers.readLimits(null)).toEqual({
      incidentMaximumInDays: undefined,
      alertMaximumInDays: undefined,
    });
  });

  test("each kind reads its own", () => {
    const answer: ReturnType<typeof ResolvedRecordRetentionAnswers.readLimits> =
      ResolvedRecordRetentionAnswers.readLimits({
        incidentMaximumInDays: 730,
        alertMaximumInDays: 90,
      });

    expect(
      ResolvedRecordRetentionAnswers.getMaximumInDays(
        answer,
        ResolvedRecordKind.Incident,
      ),
    ).toBe(730);
    expect(
      ResolvedRecordRetentionAnswers.getMaximumInDays(
        answer,
        ResolvedRecordKind.Alert,
      ),
    ).toBe(90);
  });
});

describe("a count", () => {
  test("is written and read back as a whole number, with whether it stopped early", () => {
    expect(
      ResolvedRecordRetentionAnswers.readCount(
        ResolvedRecordRetentionAnswers.toCountJSON({
          count: 4512,
          isAtLeast: false,
        }),
      ),
    ).toEqual({ count: 4512, isAtLeast: false });
    expect(
      ResolvedRecordRetentionAnswers.readCount({
        count: 10000,
        isAtLeast: true,
      }),
    ).toEqual({ count: 10000, isAtLeast: true });
    expect(
      ResolvedRecordRetentionAnswers.readCount({ count: 0, isAtLeast: false }),
    ).toEqual({ count: 0, isAtLeast: false });
  });

  test("an answer with no count - the count failed - reads as none, never as nothing to delete", () => {
    for (const value of [
      { count: null, isAtLeast: false },
      { count: "many" },
      { count: -1 },
      {},
      null,
      "4512",
    ]) {
      expect(ResolvedRecordRetentionAnswers.readCount(value)).toBeNull();
    }
  });
});

describe("a count request", () => {
  test("an alert's is its kind and length", () => {
    const request: DueRecordsCountRequest = {
      kind: ResolvedRecordKind.Alert,
      retentionInDays: 90,
      keepIncidentsWithCompletedPostmortem: false,
      keepIncidentsInPostmortemStatusIds: [STATUS],
    };

    expect(ResolvedRecordRetentionAnswers.toCountRequestJSON(request)).toEqual({
      kind: ResolvedRecordKind.Alert,
      retentionInDays: 90,
    });
    expect(
      ResolvedRecordRetentionAnswers.readCountRequest(
        ResolvedRecordRetentionAnswers.toCountRequestJSON(request),
      ),
    ).toEqual({ kind: ResolvedRecordKind.Alert, retentionInDays: 90 });
  });

  test("an incident's carries the postmortem switch and statuses when given, and leaves them out when not", () => {
    expect(
      ResolvedRecordRetentionAnswers.readCountRequest(
        ResolvedRecordRetentionAnswers.toCountRequestJSON({
          kind: ResolvedRecordKind.Incident,
          retentionInDays: 365,
          keepIncidentsWithCompletedPostmortem: false,
          keepIncidentsInPostmortemStatusIds: [STATUS],
        }),
      ),
    ).toEqual({
      kind: ResolvedRecordKind.Incident,
      retentionInDays: 365,
      keepIncidentsWithCompletedPostmortem: false,
      keepIncidentsInPostmortemStatusIds: [STATUS],
    });

    expect(
      ResolvedRecordRetentionAnswers.readCountRequest({
        kind: ResolvedRecordKind.Incident,
        retentionInDays: "90",
      }),
    ).toEqual({
      kind: ResolvedRecordKind.Incident,
      retentionInDays: 90,
      keepIncidentsWithCompletedPostmortem: undefined,
      keepIncidentsInPostmortemStatusIds: undefined,
    });
  });

  test("a switch that is not a clear false reads as on: it never counts more than the purge deletes", () => {
    for (const keep of [true, "false", 0, "no"]) {
      expect(
        ResolvedRecordRetentionAnswers.readCountRequest({
          kind: ResolvedRecordKind.Incident,
          retentionInDays: 90,
          keepIncidentsWithCompletedPostmortem: keep,
        })?.keepIncidentsWithCompletedPostmortem,
      ).toBe(true);
    }
  });

  test("is refused without a kind or with a length that is not a choice", () => {
    for (const value of [
      { retentionInDays: 90 },
      { kind: "Monitor", retentionInDays: 90 },
      { kind: ResolvedRecordKind.Incident },
      { kind: ResolvedRecordKind.Incident, retentionInDays: 45 },
      { kind: ResolvedRecordKind.Alert, retentionInDays: -30 },
      null,
      [],
    ]) {
      expect(ResolvedRecordRetentionAnswers.readCountRequest(value)).toBeNull();
    }
  });

  test("Never is a length that can be counted (it deletes nothing, or what the server's maximum does)", () => {
    expect(
      ResolvedRecordRetentionAnswers.readCountRequest({
        kind: ResolvedRecordKind.Alert,
        retentionInDays: 0,
      }),
    ).toEqual({ kind: ResolvedRecordKind.Alert, retentionInDays: 0 });
  });
});
