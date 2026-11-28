import FixProductionCheck from "../../../Types/AI/FixProductionCheck";
import { parseFixProductionReport } from "../../../Types/AI/FixProductionReport";
import FixProductionStatus from "../../../Types/AI/FixProductionStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * The Dashboard reads what production showed about a merged AI fix from
 * whatever the server sent. A report it cannot trust is no report, and an
 * older server's report - one sent before fixes had checks - is an
 * exception fix's.
 */

describe("parseFixProductionReport", () => {
  test("reads every field of a full report", () => {
    expect(
      parseFixProductionReport({
        status: FixProductionStatus.Verified,
        check: FixProductionCheck.Performance,
        summary: "p99 went from 1.2s to 300ms.",
        statusAt: "2026-10-01T10:00:00.000Z",
        deployedAt: "2026-09-30T08:30:00.000Z",
        deployedVersion: "v1.4.2",
        deployedCommitSha: "abc123",
      }),
    ).toEqual({
      status: FixProductionStatus.Verified,
      check: FixProductionCheck.Performance,
      summary: "p99 went from 1.2s to 300ms.",
      statusAt: "2026-10-01T10:00:00.000Z",
      deployedAt: "2026-09-30T08:30:00.000Z",
      deployedVersion: "v1.4.2",
      deployedCommitSha: "abc123",
    });
  });

  test("is none for no report, or one that is not an object", () => {
    for (const value of [undefined, null, "", 0, false, "Verified", 42]) {
      expect(parseFixProductionReport(value)).toBeUndefined();
    }
  });

  test("is none for an array", () => {
    expect(
      parseFixProductionReport([FixProductionStatus.Verified]),
    ).toBeUndefined();
  });

  test("is none without a status", () => {
    expect(
      parseFixProductionReport({ check: FixProductionCheck.Exception }),
    ).toBeUndefined();
  });

  test("is none for a status this reader does not know", () => {
    expect(
      parseFixProductionReport({
        status: "Abandoned",
        check: FixProductionCheck.Exception,
      }),
    ).toBeUndefined();
  });

  test("is none for a check this reader does not know", () => {
    expect(
      parseFixProductionReport({
        status: FixProductionStatus.Watching,
        check: "Cost",
      }),
    ).toBeUndefined();
  });

  test("an older server's report without a check is an exception fix's", () => {
    for (const check of [undefined, null, ""]) {
      expect(
        parseFixProductionReport({
          status: FixProductionStatus.AwaitingDeploy,
          check,
        })?.check,
      ).toBe(FixProductionCheck.Exception);
    }
  });

  test("leaves out the optional fields a report does not have", () => {
    expect(
      parseFixProductionReport({
        status: FixProductionStatus.Unverifiable,
        check: FixProductionCheck.Telemetry,
      }),
    ).toEqual({
      status: FixProductionStatus.Unverifiable,
      check: FixProductionCheck.Telemetry,
      summary: undefined,
      statusAt: undefined,
      deployedAt: undefined,
      deployedVersion: undefined,
      deployedCommitSha: undefined,
    });
  });

  test("leaves out empty or non-text summary, version and commit", () => {
    const report: ReturnType<typeof parseFixProductionReport> =
      parseFixProductionReport({
        status: FixProductionStatus.Regressed,
        check: FixProductionCheck.Recurrence,
        summary: "",
        deployedVersion: 2,
        deployedCommitSha: { sha: "abc123" },
      });

    expect(report?.summary).toBeUndefined();
    expect(report?.deployedVersion).toBeUndefined();
    expect(report?.deployedCommitSha).toBeUndefined();
  });

  test("normalises a time to ISO-8601", () => {
    const report: ReturnType<typeof parseFixProductionReport> =
      parseFixProductionReport({
        status: FixProductionStatus.Watching,
        check: FixProductionCheck.Exception,
        statusAt: "2026-10-01T15:30:00+05:30",
        deployedAt: "2026-09-30T08:30:00Z",
      });

    expect(report?.statusAt).toBe("2026-10-01T10:00:00.000Z");
    expect(report?.deployedAt).toBe("2026-09-30T08:30:00.000Z");
  });

  test("reads a time given as a Date", () => {
    expect(
      parseFixProductionReport({
        status: FixProductionStatus.Watching,
        check: FixProductionCheck.Exception,
        deployedAt: new Date("2026-09-30T08:30:00.000Z"),
      })?.deployedAt,
    ).toBe("2026-09-30T08:30:00.000Z");
  });

  test("leaves out a time that is not one", () => {
    const report: ReturnType<typeof parseFixProductionReport> =
      parseFixProductionReport({
        status: FixProductionStatus.Watching,
        check: FixProductionCheck.Exception,
        statusAt: "not a time",
        deployedAt: 1727685000000,
      });

    expect(report?.statusAt).toBeUndefined();
    expect(report?.deployedAt).toBeUndefined();
  });

  test("leaves alone a field it does not know", () => {
    const report: ReturnType<typeof parseFixProductionReport> =
      parseFixProductionReport({
        status: FixProductionStatus.Verified,
        check: FixProductionCheck.Exception,
        confidence: 0.9,
      });

    expect(report).toBeDefined();
    expect(report).not.toHaveProperty("confidence");
  });
});
