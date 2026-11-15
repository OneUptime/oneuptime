import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_ALERT_SEVERITY_NAMES,
  DEFAULT_ALERT_STATE_NAMES,
  DEFAULT_INCIDENT_SEVERITY_NAMES,
  DEFAULT_INCIDENT_STATE_NAMES,
  DEFAULT_MONITOR_STATUS_NAMES,
  DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
  DEFAULT_STATUS_NAMES,
} from "../../Types/StatusPage/DefaultStatusNames";
import { createTranslator, Translator } from "../../Types/Translator";
import {
  getDefaultRecordNames,
  isDefaultRecordName,
  isRecordNameAsWritten,
  translateRecordName,
} from "../../Utils/DefaultRecordNames";
import { DEFAULT_POSTMORTEM_STATUSES } from "../../Utils/Incident/PostmortemStatus";
import { DEFAULT_SECURITY_CASE_PRIORITIES } from "../../Utils/SecurityCase/SecurityCasePriorities";
import { DEFAULT_SECURITY_CASE_STATUSES } from "../../Utils/SecurityCase/SecurityCaseStatuses";
import { StateListType } from "../../Utils/StateOrder";

/*
 * ONE RULE FOR A RECORD'S NAME (#7780, #7782).
 *
 * A record's name is its owner's and is drawn as written; OneUptime's
 * default names of the lists a project starts with - its states,
 * severities and statuses - are its words, read in the reader's language.
 * Which is which is decided here, by the record's own table and its whole
 * name, for every badge, picker and filter that draws one.
 */

const SPANISH: Record<string, string> = {
  Resolved: "Resuelto",
  Open: "Abrir",
  Network: "Red",
  High: "Alta",
  Operational: "Operativo",
};

const spanish: Translator = createTranslator(
  (text: string | undefined): string | undefined => {
    return text === undefined ? undefined : SPANISH[text];
  },
  "es",
);

function namesOf(values: ReadonlyArray<{ name: string }>): Array<string> {
  return values.map((value: { name: string }): string => {
    return value.name;
  });
}

describe("the names each list starts with", () => {
  test.each([
    [StateListType.IncidentState, DEFAULT_INCIDENT_STATE_NAMES],
    [StateListType.AlertState, DEFAULT_ALERT_STATE_NAMES],
    [
      StateListType.ScheduledMaintenanceState,
      DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
    ],
    [StateListType.MonitorStatus, DEFAULT_MONITOR_STATUS_NAMES],
    [StateListType.IncidentSeverity, DEFAULT_INCIDENT_SEVERITY_NAMES],
    [StateListType.AlertSeverity, DEFAULT_ALERT_SEVERITY_NAMES],
    [
      StateListType.IncidentPostmortemStatus,
      namesOf(DEFAULT_POSTMORTEM_STATUSES),
    ],
    [StateListType.SecurityCaseStatus, namesOf(DEFAULT_SECURITY_CASE_STATUSES)],
    [
      StateListType.SecurityCasePriority,
      namesOf(DEFAULT_SECURITY_CASE_PRIORITIES),
    ],
  ])(
    "%s: its own seeded list",
    (table: string, names: ReadonlyArray<string>) => {
      expect(names.length).toBeGreaterThan(0);
      expect([...getDefaultRecordNames(table)]).toEqual([...names]);
    },
  );

  test("every list a project orders has its names, read by the table's name", () => {
    for (const table of Object.values(StateListType)) {
      expect({
        table,
        hasNames: getDefaultRecordNames(table).length > 0,
      }).toEqual({ table, hasNames: true });
    }
  });

  test("the status page's list is the same names it always was, the alert severities aside", () => {
    expect([...DEFAULT_STATUS_NAMES]).toEqual([
      "Identified",
      "Acknowledged",
      "Resolved",
      "Critical Incident",
      "Major Incident",
      "Minor Incident",
      "Operational",
      "Degraded",
      "Offline",
      "Scheduled",
      "Ongoing",
      "Ended",
      "Completed",
    ]);
  });

  test.each([
    "Label",
    "Monitor",
    "Team",
    "IncidentRole",
    "",
    "constructor",
    "toString",
  ])(
    "a table whose names are all its owners' (%j) has none",
    (table: string) => {
      expect(getDefaultRecordNames(table)).toEqual([]);
    },
  );

  test("nor does a record of no table", () => {
    expect(getDefaultRecordNames(undefined)).toEqual([]);
    expect(getDefaultRecordNames(null)).toEqual([]);
  });
});

describe("a default name, by its record's table and its whole name", () => {
  test.each([
    [StateListType.IncidentState, "Resolved", true],
    [StateListType.AlertState, "Acknowledged", true],
    [StateListType.MonitorStatus, "Operational", true],
    [StateListType.IncidentSeverity, "Critical Incident", true],
    [StateListType.AlertSeverity, "High", true],
    [StateListType.ScheduledMaintenanceState, "Ongoing", true],
    [StateListType.IncidentPostmortemStatus, "Draft", true],
    [StateListType.SecurityCasePriority, "High", true],
    [StateListType.SecurityCaseStatus, "Investigating", true],
    // Written with space around it, as a form may save it.
    [StateListType.IncidentState, " Resolved ", true],
  ])(
    "%s %j is OneUptime's",
    (table: string, name: string, isDefault: boolean) => {
      expect(isDefaultRecordName(table, name)).toBe(isDefault);
      expect(isRecordNameAsWritten(table, name)).toBe(!isDefault);
    },
  );

  test.each([
    // Another list's default is the project's own name here.
    [StateListType.MonitorStatus, "High"],
    [StateListType.SecurityCaseStatus, "High"],
    [StateListType.IncidentState, "Operational"],
    [StateListType.IncidentSeverity, "High"],
    // A default renamed, however slightly.
    [StateListType.IncidentSeverity, "Critical"],
    [StateListType.IncidentSeverity, "Critical incident"],
    [StateListType.IncidentState, "resolved"],
    [StateListType.IncidentState, "Resolved (auto)"],
    // A name the project chose.
    [StateListType.IncidentState, "Open"],
    [StateListType.AlertSeverity, "Network"],
    // A record no list starts with.
    ["Label", "Resolved"],
    ["Monitor", "Operational"],
    [undefined, "Resolved"],
  ])(
    "%s %j is the project's, drawn as written",
    (table: string | undefined, name: string) => {
      expect(isDefaultRecordName(table, name)).toBe(false);
      expect(isRecordNameAsWritten(table, name)).toBe(true);
    },
  );

  test("no name is neither: what a badge draws in its place is the product's word", () => {
    for (const name of [undefined, null, "", "   "]) {
      expect(isRecordNameAsWritten(StateListType.IncidentState, name)).toBe(
        false,
      );
      expect(isRecordNameAsWritten("Label", name)).toBe(false);
    }

    expect(isDefaultRecordName(StateListType.IncidentState, undefined)).toBe(
      false,
    );
  });
});

describe("a record's name in the reader's words", () => {
  test("a default name in their language", () => {
    expect(
      translateRecordName(spanish, StateListType.IncidentState, "Resolved"),
    ).toBe("Resuelto");
    expect(
      translateRecordName(spanish, StateListType.MonitorStatus, "Operational"),
    ).toBe("Operativo");
    expect(
      translateRecordName(spanish, StateListType.AlertSeverity, "High"),
    ).toBe("Alta");
  });

  test("any other name as written, whatever the words it happens to be", () => {
    expect(
      translateRecordName(spanish, StateListType.IncidentState, "Open"),
    ).toBe("Open");
    expect(translateRecordName(spanish, "Label", "Network")).toBe("Network");
    expect(
      translateRecordName(spanish, StateListType.MonitorStatus, "High"),
    ).toBe("High");
  });

  test("a default name the reader's language has no word for stays English", () => {
    expect(
      translateRecordName(spanish, StateListType.IncidentState, "Identified"),
    ).toBe("Identified");
  });

  test("no name is no text", () => {
    expect(translateRecordName(spanish, StateListType.IncidentState, "")).toBe(
      "",
    );
    expect(
      translateRecordName(spanish, StateListType.IncidentState, undefined),
    ).toBe("");
  });
});
