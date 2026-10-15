import { describe, expect, test } from "@jest/globals";
import EpisodeFromRecords, {
  NewEpisodePrefill,
  RecordForNewEpisode,
} from "../../../Utils/Episode/EpisodeFromRecords";
import { SeverityForMapping } from "../../../Utils/Incident/IncidentFromAlerts";

/*
 * What "Add to New Episode" starts the new episode with: the most severe
 * selected record's severity, and its title unless it is private.
 */

const CRITICAL: SeverityForMapping = {
  id: "s-critical",
  name: "Critical",
  order: 1,
};
const MAJOR: SeverityForMapping = { id: "s-major", name: "Major", order: 2 };
const MINOR: SeverityForMapping = { id: "s-minor", name: "Minor", order: 3 };

// Listed out of order on purpose: the order column decides, not the list.
const SEVERITIES: Array<SeverityForMapping> = [MINOR, CRITICAL, MAJOR];

type RecordFunction = (
  id: string,
  title: string,
  severity: SeverityForMapping | undefined,
  isPrivate?: boolean,
) => RecordForNewEpisode;

const record: RecordFunction = (
  id: string,
  title: string,
  severity: SeverityForMapping | undefined,
  isPrivate?: boolean,
): RecordForNewEpisode => {
  return {
    id: id,
    title: title,
    ...(severity ? { severityId: severity.id } : {}),
    ...(isPrivate ? { isPrivate: true } : {}),
  };
};

const prefill: (records: Array<RecordForNewEpisode>) => NewEpisodePrefill = (
  records: Array<RecordForNewEpisode>,
): NewEpisodePrefill => {
  return EpisodeFromRecords.getPrefill({
    records: records,
    severities: SEVERITIES,
  });
};

describe("the severity a new episode starts with", () => {
  test("is the most severe of the selection's, wherever it was selected", () => {
    expect(
      prefill([
        record("a", "Disk filling up", MINOR),
        record("b", "Checkout API is offline", CRITICAL),
        record("c", "Latency above 2 s", MAJOR),
      ]).severityId,
    ).toBe(CRITICAL.id);
  });

  test("is the only one's, for one record", () => {
    expect(prefill([record("a", "Disk filling up", MINOR)]).severityId).toBe(
      MINOR.id,
    );
  });

  test("is a private record's too: a severity names no secret", () => {
    expect(
      prefill([
        record("a", "Public", MINOR),
        record("b", "Payroll export failing", CRITICAL, true),
      ]).severityId,
    ).toBe(CRITICAL.id);
  });

  test("ignores a record with no severity, or one the project does not list", () => {
    expect(
      prefill([
        record("a", "No severity", undefined),
        { id: "b", title: "Retired severity", severityId: "s-deleted" },
        record("c", "Latency", MAJOR),
      ]).severityId,
    ).toBe(MAJOR.id);
  });

  test("is left empty when no record has one the project lists", () => {
    expect(
      prefill([
        record("a", "No severity", undefined),
        { id: "b", title: "Retired severity", severityId: "s-deleted" },
      ]).severityId,
    ).toBeUndefined();
    expect(prefill([]).severityId).toBeUndefined();
  });
});

describe("the title a new episode starts with", () => {
  test("is the most severe record's", () => {
    expect(
      prefill([
        record("a", "Disk filling up", MINOR),
        record("b", "Checkout API is offline", CRITICAL),
        record("c", "Latency above 2 s", MAJOR),
      ]).title,
    ).toBe("Checkout API is offline");
  });

  test("goes to the first selected on a tie", () => {
    expect(
      prefill([
        record("a", "First critical", CRITICAL),
        record("b", "Second critical", CRITICAL),
      ]).title,
    ).toBe("First critical");
  });

  test("never copies a private record's title: the next most severe one's is taken", () => {
    expect(
      prefill([
        record("a", "Disk filling up", MINOR),
        record("b", "Payroll export failing", CRITICAL, true),
        record("c", "Latency above 2 s", MAJOR),
      ]).title,
    ).toBe("Latency above 2 s");
  });

  test("is empty when every record is private, so the person names it", () => {
    expect(
      prefill([
        record("a", "Payroll export failing", CRITICAL, true),
        record("b", "Salary file leaked", MINOR, true),
      ]).title,
    ).toBe("");
  });

  test("skips a record with no title, and trims the one it takes", () => {
    expect(
      prefill([
        record("a", "   ", CRITICAL),
        record("b", "  Checkout API is offline  ", MAJOR),
      ]).title,
    ).toBe("Checkout API is offline");
  });

  test("is a record without a severity's when no record has one", () => {
    expect(
      prefill([
        record("a", "First", undefined),
        record("b", "Second", undefined),
      ]).title,
    ).toBe("First");
  });
});

describe("sortBySeverity", () => {
  test("puts the most severe first, those without a severity last, ties in order", () => {
    const sorted: Array<RecordForNewEpisode> =
      EpisodeFromRecords.sortBySeverity({
        records: [
          record("none-1", "", undefined),
          record("minor", "", MINOR),
          record("critical-1", "", CRITICAL),
          record("none-2", "", undefined),
          record("critical-2", "", CRITICAL),
          record("major", "", MAJOR),
        ],
        severities: SEVERITIES,
      });

    expect(
      sorted.map((entry: RecordForNewEpisode): string => {
        return entry.id;
      }),
    ).toEqual([
      "critical-1",
      "critical-2",
      "major",
      "minor",
      "none-1",
      "none-2",
    ]);
  });

  test("leaves the list it was given as it was", () => {
    const records: Array<RecordForNewEpisode> = [
      record("minor", "", MINOR),
      record("critical", "", CRITICAL),
    ];

    EpisodeFromRecords.sortBySeverity({
      records: records,
      severities: SEVERITIES,
    });

    expect(
      records.map((entry: RecordForNewEpisode): string => {
        return entry.id;
      }),
    ).toEqual(["minor", "critical"]);
  });
});
