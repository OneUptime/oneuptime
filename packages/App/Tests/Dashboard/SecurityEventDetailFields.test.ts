import { describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { JSONObject } from "Common/Types/JSON";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import { SECURITY_EVENT_FACET_KEYS } from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsFacets";
import {
  SecurityEventDetailField,
  buildSecurityEventJson,
  buildSecurityEventOverviewFields,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailFields";

/*
 * What one security event says, as data — the field list the detail drawer's
 * Overview tab renders and the JSON its JSON tab prints.
 *
 * The two have deliberately opposite rules about absence, which is what most
 * of this pins: Overview drops what the source did not say (every column is
 * non-nullable with a '' or 0 default, so a wall of dashes would bury the six
 * facts an event does carry), while the JSON keeps it (a reader diffing two
 * events needs to see that one has no target host).
 */

function event(fields: Partial<SecurityEvent> = {}): SecurityEvent {
  return Object.assign(new SecurityEvent(), fields);
}

function labels(fields: Array<SecurityEventDetailField>): Array<string> {
  return fields.map((field: SecurityEventDetailField): string => {
    return field.label;
  });
}

function valueOf(
  fields: Array<SecurityEventDetailField>,
  label: string,
): string | undefined {
  return fields.find((field: SecurityEventDetailField) => {
    return field.label === label;
  })?.value;
}

describe("buildSecurityEventOverviewFields", () => {
  test("shows only what the source said", () => {
    const fields: Array<SecurityEventDetailField> =
      buildSecurityEventOverviewFields(
        event({
          className: "Authentication",
          message: "Failed logon for alice",
          principalUser: "alice",
        }),
      );

    expect(labels(fields)).toEqual([
      "Event Class",
      "Message",
      "Principal User",
    ]);
  });

  test("an event with nothing on it produces no rows rather than a wall of dashes", () => {
    expect(buildSecurityEventOverviewFields(event())).toEqual([]);
  });

  /*
   * "Check a log line" on Your logs describes the event a pasted line is
   * about to become - a NormalizedSecurityEvent, never stored - with the
   * drawer's own fields, so the two say the same of the same event.
   */
  test("an event a log line is about to become reads the same as a stored one", () => {
    const normalized: NormalizedSecurityEvent = {
      time: new Date("2026-10-30T12:00:00Z"),
      eventUid: "",
      categoryUid: 3,
      categoryName: "Identity & Access Management",
      classUid: 3002,
      className: "Authentication",
      activityName: "Logon",
      severityId: 2,
      severityName: OcsfSeverity.Low,
      statusName: "Failure",
      message: "Failed sign-in for alice to WIN-01",
      vendorName: "Microsoft",
      productName: "Windows",
      ruleId: "",
      ruleName: "",
      mitreTactics: [],
      mitreTechniques: [],
      principalUser: "alice",
      principalHost: "",
      principalIp: "203.0.113.7",
      principalProcess: "",
      processName: "",
      processPath: "",
      processCommandLine: "",
      parentProcessName: "",
      parentProcessPath: "",
      parentProcessCommandLine: "",
      targetUser: "",
      targetHost: "WIN-01",
      targetIp: "",
      targetPort: 0,
      targetResource: "",
      observables: ["alice", "203.0.113.7", "WIN-01"],
      attributes: {},
    };

    expect(buildSecurityEventOverviewFields(normalized)).toEqual(
      buildSecurityEventOverviewFields(
        event({
          categoryName: normalized.categoryName,
          className: normalized.className,
          activityName: normalized.activityName,
          statusName: normalized.statusName,
          message: normalized.message,
          vendorName: normalized.vendorName,
          productName: normalized.productName,
          principalUser: normalized.principalUser,
          principalIp: normalized.principalIp,
          targetHost: normalized.targetHost,
        }),
      ),
    );
    expect(labels(buildSecurityEventOverviewFields(normalized))).toEqual([
      "Event Class",
      "Category",
      "Activity",
      "Status",
      "Message",
      "Vendor",
      "Product",
      "Principal User",
      "Principal IP",
      "Target Host",
    ]);
  });

  test("whitespace-only values count as unsaid", () => {
    expect(
      buildSecurityEventOverviewFields(event({ vendorName: "   " })),
    ).toEqual([]);
  });

  test("reads what happened before who it happened to", () => {
    const fields: Array<SecurityEventDetailField> =
      buildSecurityEventOverviewFields(
        event({
          principalUser: "alice",
          className: "Authentication",
          targetHost: "db-01",
          categoryName: "IAM",
        }),
      );

    expect(labels(fields)).toEqual([
      "Event Class",
      "Category",
      "Principal User",
      "Target Host",
    ]);
  });

  /*
   * targetPort is a number column with a 0 default, so 0 means "the source
   * did not say" far more often than it means port zero.
   */
  test("target port 0 is absence, not a port", () => {
    expect(
      valueOf(
        buildSecurityEventOverviewFields(event({ targetPort: 0 })),
        "Target Port",
      ),
    ).toBeUndefined();
    expect(
      valueOf(
        buildSecurityEventOverviewFields(event({ targetPort: 443 })),
        "Target Port",
      ),
    ).toBe("443");
  });

  test("array fields read as one comma-joined line, with blanks dropped", () => {
    const fields: Array<SecurityEventDetailField> =
      buildSecurityEventOverviewFields(
        event({
          mitreTactics: ["TA0006", "", "TA0001"],
          mitreTechniques: [],
        }),
      );

    expect(valueOf(fields, "MITRE Tactics")).toBe("TA0006, TA0001");
    expect(valueOf(fields, "MITRE Techniques")).toBeUndefined();
  });

  test("a process launch shows the process that started, then the one that started it", () => {
    const fields: Array<SecurityEventDetailField> =
      buildSecurityEventOverviewFields(
        event({
          className: "Process Activity",
          principalHost: "laptop-7",
          principalProcess: "winword.exe",
          processName: "powershell.exe",
          processPath:
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
          processCommandLine: "powershell.exe -nop -enc JABzAD0A",
          parentProcessName: "winword.exe",
          parentProcessPath:
            "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
          parentProcessCommandLine: '"WINWORD.EXE" /n "C:\\Users\\a\\x.docm"',
        }),
      );

    expect(labels(fields)).toEqual([
      "Event Class",
      "Principal Host",
      "Principal Process",
      "Process",
      "Process Path",
      "Command Line",
      "Parent Process",
      "Parent Process Path",
      "Parent Command Line",
    ]);
    expect(valueOf(fields, "Command Line")).toBe(
      "powershell.exe -nop -enc JABzAD0A",
    );
    expect(valueOf(fields, "Parent Process")).toBe("winword.exe");
    // The names filter the list; a click lands on the facet of the same name.
    expect(
      fields
        .filter((field: SecurityEventDetailField): boolean => {
          return Boolean(field.facetKey);
        })
        .map((field: SecurityEventDetailField): string => {
          return field.facetKey!;
        }),
    ).toEqual([
      "className",
      "principalHost",
      "processName",
      "parentProcessName",
    ]);
  });

  test("every field offering a filter names a facet the sidebar also offers", () => {
    const fields: Array<SecurityEventDetailField> =
      buildSecurityEventOverviewFields(
        event({
          className: "Authentication",
          categoryName: "IAM",
          activityName: "Logon",
          statusName: "Failure",
          vendorName: "Acme",
          productName: "Defender",
          ruleName: "BruteForce",
          principalUser: "alice",
          principalHost: "web-01",
          principalIp: "10.0.0.4",
          processName: "powershell.exe",
          parentProcessName: "winword.exe",
          targetUser: "root",
          targetHost: "db-01",
          targetIp: "10.0.0.9",
          requestOutcome: "Rejected",
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          sessionId: "session-1",
        }),
      );

    const filterable: Array<string> = fields
      .filter((field: SecurityEventDetailField): boolean => {
        return Boolean(field.facetKey);
      })
      .map((field: SecurityEventDetailField): string => {
        return field.facetKey!;
      });

    expect(filterable.length).toBeGreaterThan(0);

    const columns: Array<string> = new SecurityEvent().tableColumns.map(
      (column: { key: string }): string => {
        return column.key;
      },
    );

    for (const facetKey of filterable) {
      expect(columns).toContain(facetKey);
    }

    /*
     * The sidebar's own dimensions must all be reachable from a row too —
     * otherwise a value you can SEE on an event is one you cannot filter by
     * from where you are looking at it.
     *
     * Two are excluded and both are structural: `primaryEntityId` is the
     * attribution id, which is not a value the drawer shows; `severityName`
     * is rendered as a coloured pill rather than text, so the drawer builds
     * that row itself (its filter action is pinned in
     * Common/Tests/App/Dashboard/SecurityEventDetailPanel.test.tsx).
     */
    for (const facetKey of SECURITY_EVENT_FACET_KEYS) {
      if (facetKey === "primaryEntityId" || facetKey === "severityName") {
        continue;
      }

      expect(filterable).toContain(facetKey);
    }
  });

  /*
   * Filtering on a value that is unique per row returns the one event you are
   * already looking at, so those fields deliberately offer no filter.
   */
  test("free-text and unique fields offer no filter", () => {
    const fields: Array<SecurityEventDetailField> =
      buildSecurityEventOverviewFields(
        event({
          message: "Failed logon",
          eventUid: "abc123",
          ruleId: "rule-7",
          principalProcess: "/usr/bin/sshd -D",
          processPath: "C:\\Windows\\System32\\cmd.exe",
          processCommandLine: "cmd.exe /c whoami",
          parentProcessPath: "C:\\Windows\\explorer.exe",
          parentProcessCommandLine: "C:\\Windows\\Explorer.EXE",
          targetResource: "/etc/shadow",
        }),
      );

    for (const label of [
      "Message",
      "Event UID",
      "Rule ID",
      "Principal Process",
      "Process Path",
      "Command Line",
      "Parent Process Path",
      "Parent Command Line",
      "Target Resource",
    ]) {
      expect(
        fields.find((field: SecurityEventDetailField) => {
          return field.label === label;
        })?.facetKey,
      ).toBeUndefined();
    }
  });
});

describe("the request an event happened in", () => {
  test("says how far it got, and the ids that find the rest of it", () => {
    const fields: Array<SecurityEventDetailField> =
      buildSecurityEventOverviewFields(
        event({
          targetResource: "/sitemap.xml?offset=1",
          requestOutcome: "Rejected",
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          sessionId: "session-1",
          eventUid: "log:abc",
        }),
      );

    // After what it was aimed at, before the event's own id.
    expect(labels(fields)).toEqual([
      "Target Resource",
      "Request Outcome",
      "Trace ID",
      "Session ID",
      "Event UID",
    ]);
    expect(
      fields.find((field: SecurityEventDetailField): boolean => {
        return field.label === "Request Outcome";
      })?.facetKey,
    ).toBe("requestOutcome");
    expect(valueOf(fields, "Trace ID")).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736",
    );
  });

  test("an event in no request shows none of it", () => {
    expect(
      labels(buildSecurityEventOverviewFields(event({ eventUid: "x" }))),
    ).toEqual(["Event UID"]);
  });

  test("the JSON carries the request's ids and outcome, empty when unknown", () => {
    const json: JSONObject = buildSecurityEventJson(
      event({
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        sessionId: "session-1",
        requestOutcome: "Reached Database",
      }),
    );

    expect(json["traceId"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(json["spanId"]).toBe("00f067aa0ba902b7");
    expect(json["sessionId"]).toBe("session-1");
    expect(json["requestOutcome"]).toBe("Reached Database");

    const empty: JSONObject = buildSecurityEventJson(event());

    expect(empty["traceId"]).toBe("");
    expect(empty["requestOutcome"]).toBe("");
  });
});

describe("buildSecurityEventJson", () => {
  const json: JSONObject = buildSecurityEventJson(
    event({
      time: new Date("2026-09-17T10:00:00.000Z"),
      eventUid: "abc123",
      severityName: OcsfSeverity.Critical,
      severityId: 5,
      className: "Authentication",
      classUid: 3002,
      message: "Failed logon",
      mitreTactics: ["TA0006"],
      observables: ["alice", "10.0.0.4"],
      attributes: { "threat.matched": "true" },
      targetPort: 443,
    }),
  );

  test("keeps the record whole, empties included", () => {
    expect(json["eventUid"]).toBe("abc123");
    expect(json["severityName"]).toBe(OcsfSeverity.Critical);
    expect(json["vendorName"]).toBe("");
    expect(json["targetHost"]).toBe("");
    expect(json["processCommandLine"]).toBe("");
    expect(json["parentProcessName"]).toBe("");
    expect(json["mitreTechniques"]).toEqual([]);
  });

  test("the time is an ISO string, and null when there is none", () => {
    expect(json["time"]).toBe("2026-09-17T10:00:00.000Z");
    expect(buildSecurityEventJson(event())["time"]).toBeNull();
  });

  test("numbers stay numbers and arrays stay arrays", () => {
    expect(json["severityId"]).toBe(5);
    expect(json["classUid"]).toBe(3002);
    expect(json["targetPort"]).toBe(443);
    expect(json["mitreTactics"]).toEqual(["TA0006"]);
    expect(json["observables"]).toEqual(["alice", "10.0.0.4"]);
  });

  test("the attributes map is carried verbatim", () => {
    expect(json["attributes"]).toEqual({ "threat.matched": "true" });
    expect(buildSecurityEventJson(event())["attributes"]).toEqual({});
  });

  /*
   * Built field by field rather than off the model instance: an analytics
   * model carries its whole table definition (columns, access control,
   * projections) on the object, and serializing that would bury the twenty
   * facts about the event under a few hundred about the table.
   */
  test("describes the event, not the table", () => {
    const keys: Array<string> = Object.keys(json);

    expect(keys).not.toContain("tableColumns");
    expect(keys).not.toContain("accessControl");
    expect(keys).not.toContain("tableName");
    expect(keys).not.toContain("projections");
  });

  test("every key is a real SecurityEvent column", () => {
    const columns: Array<string> = new SecurityEvent().tableColumns.map(
      (column: { key: string }): string => {
        return column.key;
      },
    );

    for (const key of Object.keys(json)) {
      expect(columns).toContain(key);
    }
  });

  test("it serializes — the JSON tab prints it", () => {
    expect(() => {
      return JSON.stringify(json);
    }).not.toThrow();
    expect(JSON.parse(JSON.stringify(json))["message"]).toBe("Failed logon");
  });
});
