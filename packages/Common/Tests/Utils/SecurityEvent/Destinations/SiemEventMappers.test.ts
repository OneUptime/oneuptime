import {
  ECS_VERSION,
  SENTINEL_TABLE_COLUMNS,
  toEcsDocument,
  toSentinelRecord,
  toSplunkHecEvent,
  validIpAddress,
} from "../../../../Utils/SecurityEvent/Destinations/SiemEventMappers";
import { SecurityEventRecord } from "../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A OneUptime security event in the shape each SIEM takes it: a Splunk HEC
 * event in Common Information Model names, a row of the Sentinel custom
 * table the setup guide declares, an Elastic Common Schema document.
 */

function record(
  overrides: Partial<SecurityEventRecord> = {},
): SecurityEventRecord {
  return {
    id: "0193c0de-cccc-4aaa-8bbb-000000000001",
    time: new Date("2026-10-21T10:00:00.250Z"),
    createdAt: new Date("2026-10-21T10:00:05.000Z"),
    eventUid: "okta-1",
    categoryUid: 3,
    categoryName: "Identity & Access Management",
    classUid: 3002,
    className: "Authentication",
    activityName: "Logon",
    severityId: 3,
    severityName: "Medium",
    statusName: "Failure",
    message: "Failed sign-in for alice",
    vendorName: "Okta",
    productName: "Okta System Log",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: "alice@example.com",
    principalHost: "laptop-7",
    principalIp: "203.0.113.7",
    principalProcess: "",
    processName: "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser: "",
    targetHost: "app.example.com",
    targetIp: "198.51.100.20",
    targetPort: 443,
    targetResource: "",
    observables: ["alice@example.com", "203.0.113.7"],
    attributes: { "okta.outcome.reason": "INVALID_CREDENTIALS" },
    ...overrides,
  };
}

const FINDING: SecurityEventRecord = record({
  categoryUid: 2,
  categoryName: "Findings",
  classUid: 2004,
  className: "Detection Finding",
  activityName: "Create",
  severityId: 4,
  severityName: "High",
  statusName: "New",
  message: "Brute force from 203.0.113.7",
  vendorName: "OneUptime",
  productName: "OneUptime Detections",
  ruleId: "1e112332",
  ruleName: "Failed sign-ins, then a success",
  mitreTactics: ["TA0006"],
  mitreTechniques: ["T1110"],
});

describe("a Splunk HTTP Event Collector event", () => {
  test("carries time, host, source, sourcetype and index beside the event", () => {
    const event: JSONObject = toSplunkHecEvent(record(), {
      index: "security",
      sourceType: "oneuptime:security",
    });

    expect(event["time"]).toBe(1792576800.25);
    expect(event["host"]).toBe("laptop-7");
    expect(event["source"]).toBe("oneuptime");
    expect(event["sourcetype"]).toBe("oneuptime:security");
    expect(event["index"]).toBe("security");
  });

  test("leaves the index out when none is set, for the token's default", () => {
    const event: JSONObject = toSplunkHecEvent(record(), {
      sourceType: "oneuptime:security",
    });

    expect("index" in event).toBe(false);
  });

  test("names the event's fields as Splunk's Common Information Model does", () => {
    const inner: JSONObject = toSplunkHecEvent(record(), {
      sourceType: "oneuptime:security",
    })["event"] as JSONObject;

    expect(inner).toMatchObject({
      message: "Failed sign-in for alice",
      time: "2026-10-21T10:00:00.250Z",
      oneuptime_event_id: "0193c0de-cccc-4aaa-8bbb-000000000001",
      event_uid: "okta-1",
      class_name: "Authentication",
      action: "blocked",
      severity: "medium",
      severity_id: 3,
      vendor_product: "Okta Okta System Log",
      src_user: "alice@example.com",
      src_ip: "203.0.113.7",
      src: "203.0.113.7",
      user: "alice@example.com",
      dest: "198.51.100.20",
      dest_ip: "198.51.100.20",
      dest_host: "app.example.com",
      dest_port: 443,
      attributes: { "okta.outcome.reason": "INVALID_CREDENTIALS" },
    });
    // Nothing OneUptime did not know.
    expect("signature" in inner).toBe(false);
    expect("process" in inner).toBe(false);
  });

  test("a finding's rule is its signature, with its ATT&CK tactics and techniques", () => {
    const inner: JSONObject = toSplunkHecEvent(FINDING, {
      sourceType: "oneuptime:security",
    })["event"] as JSONObject;

    expect(inner).toMatchObject({
      signature: "Failed sign-ins, then a success",
      signature_id: "1e112332",
      severity: "high",
      mitre_attack_tactics: ["TA0006"],
      mitre_attack_techniques: ["T1110"],
    });
    expect("action" in inner).toBe(false);
  });

  test("an address that is not one is never a src_ip; the host stands in for src", () => {
    const inner: JSONObject = toSplunkHecEvent(
      record({ principalIp: "not-an-ip" }),
      { sourceType: "x" },
    )["event"] as JSONObject;

    expect("src_ip" in inner).toBe(false);
    expect(inner["src"]).toBe("laptop-7");
  });
});

describe("a Microsoft Sentinel row", () => {
  test("has only the columns the setup guide's table declares, TimeGenerated first", () => {
    const row: JSONObject = toSentinelRecord(FINDING);
    const declared: Array<string> = SENTINEL_TABLE_COLUMNS.map(
      (column: { name: string }): string => {
        return column.name;
      },
    );

    expect(Object.keys(row)[0]).toBe("TimeGenerated");

    for (const key of Object.keys(row)) {
      expect([key, declared.includes(key)]).toEqual([key, true]);
    }
  });

  test("each value has its column's type", () => {
    const row: JSONObject = toSentinelRecord(FINDING);

    for (const column of SENTINEL_TABLE_COLUMNS) {
      const value: unknown = row[column.name];

      if (value === undefined) {
        continue;
      }

      const ok: boolean =
        column.type === "int"
          ? Number.isInteger(value)
          : column.type === "dynamic"
            ? typeof value === "object"
            : typeof value === "string";

      expect([column.name, ok]).toEqual([column.name, true]);
    }

    expect(row).toMatchObject({
      TimeGenerated: "2026-10-21T10:00:00.250Z",
      EventId: "0193c0de-cccc-4aaa-8bbb-000000000001",
      ClassName: "Detection Finding",
      Severity: "High",
      SeverityId: 4,
      RuleName: "Failed sign-ins, then a success",
      MitreTechniques: ["T1110"],
      TargetPort: 443,
    });
  });

  test("the table's columns are unique, and TimeGenerated is a datetime", () => {
    const names: Array<string> = SENTINEL_TABLE_COLUMNS.map(
      (column: { name: string }): string => {
        return column.name;
      },
    );

    expect(new Set(names).size).toBe(names.length);
    expect(SENTINEL_TABLE_COLUMNS[0]).toEqual({
      name: "TimeGenerated",
      type: "datetime",
    });
  });
});

describe("an Elastic Common Schema document", () => {
  test("is an alert for what OneUptime found, and an event for the rest", () => {
    expect((toEcsDocument(FINDING)["event"] as JSONObject)["kind"]).toBe(
      "alert",
    );
    expect((toEcsDocument(record())["event"] as JSONObject)["kind"]).toBe(
      "event",
    );
  });

  test("puts the event in ECS's fields", () => {
    const document: JSONObject = toEcsDocument(FINDING);

    expect(document).toMatchObject({
      "@timestamp": "2026-10-21T10:00:00.250Z",
      message: "Brute force from 203.0.113.7",
      ecs: { version: ECS_VERSION },
      event: {
        kind: "alert",
        category: ["intrusion_detection"],
        action: "Create",
        outcome: "unknown",
        severity: 4,
        id: "okta-1",
        dataset: "oneuptime.security",
        module: "oneuptime",
      },
      rule: { id: "1e112332", name: "Failed sign-ins, then a success" },
      threat: {
        framework: "MITRE ATT&CK",
        tactic: { name: ["TA0006"] },
        technique: { id: ["T1110"] },
      },
      user: { name: "alice@example.com" },
      host: { name: "laptop-7" },
      source: { ip: "203.0.113.7" },
      destination: {
        ip: "198.51.100.20",
        domain: "app.example.com",
        port: 443,
      },
      observer: { vendor: "OneUptime", product: "OneUptime Detections" },
      related: {
        ip: ["203.0.113.7", "198.51.100.20"],
        user: ["alice@example.com"],
        hosts: ["laptop-7", "app.example.com"],
      },
    });
  });

  test("an authentication is in the authentication category, its outcome read from its status", () => {
    const event: JSONObject = toEcsDocument(record())["event"] as JSONObject;

    expect(event["category"]).toEqual(["authentication"]);
    expect(event["outcome"]).toBe("failure");
  });

  test("an address that is not one never reaches an ECS ip field", () => {
    const document: JSONObject = toEcsDocument(
      record({ principalIp: "host-1", targetIp: "", observables: ["x"] }),
    );

    expect("source" in document).toBe(false);
    expect(
      ((document["related"] as JSONObject)["ip"] as unknown) || [],
    ).toEqual([]);
  });

  test("OneUptime's attributes are one JSON text, so a project's keys never become mappings", () => {
    const oneuptime: JSONObject = toEcsDocument(record())[
      "oneuptime"
    ] as JSONObject;

    expect(oneuptime["attributes"]).toBe(
      JSON.stringify({ "okta.outcome.reason": "INVALID_CREDENTIALS" }),
    );
    expect(oneuptime["event_id"]).toBe("0193c0de-cccc-4aaa-8bbb-000000000001");
  });

  test("empty values are left out", () => {
    const document: JSONObject = toEcsDocument(
      record({ ruleId: "", ruleName: "", processName: "" }),
    );

    expect("rule" in document).toBe(false);
    expect("process" in document).toBe(false);
    expect("threat" in document).toBe(false);
  });
});

describe("an address", () => {
  test.each([
    ["203.0.113.7", "203.0.113.7"],
    [" 2001:db8::1 ", "2001:db8::1"],
    ["999.1.1.1", ""],
    ["laptop-7", ""],
    ["", ""],
  ])("%s is %s", (value: string, expected: string) => {
    expect(validIpAddress(value)).toBe(expected);
  });
});
