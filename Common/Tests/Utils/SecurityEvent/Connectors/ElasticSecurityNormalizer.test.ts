import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../../Types/SecurityEvent/OcsfEventClass";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import ElasticSecurityNormalizer, {
  ELASTIC_SECURITY_PRODUCT_NAME,
  ELASTIC_SECURITY_VENDOR_NAME,
} from "../../../../Utils/SecurityEvent/Connectors/ElasticSecurityNormalizer";

/*
 * An Elastic Security alert stays useful in the SIEM only if the columns
 * the dashboard filters and correlates on — severity, rule, MITRE ids,
 * host/user/IP, observables — are lifted off the alert document, which
 * mixes dotted rule-registry keys with nested ECS objects. These tests pin
 * that lift against a document shaped like the alert schema, plus every
 * fallback (severity from risk score, time from start/@timestamp, uid from
 * kibana.alert.uuid or a content hash).
 */

const DEFINITION: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.ElasticSecurity,
  )!;

const ALERT_ID: string =
  "8c1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8";
const RULE_UUID: string = "5f2d8e1a-6c3b-4e9f-8a7d-1b2c3d4e5f60";
const SHA256: string =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/*
 * One alert as POST /api/detection_engine/signals/search returns it: the
 * rule registry's fields dotted at the top level, the ECS fields copied
 * from the matched auditd event nested.
 */
function alertSource(overrides?: JSONObject | undefined): JSONObject {
  return {
    "@timestamp": "2026-09-12T10:05:03.412Z",
    "event.kind": "signal",
    "kibana.alert.uuid": ALERT_ID,
    "kibana.alert.rule.uuid": RULE_UUID,
    "kibana.alert.rule.rule_id": "8a1b5c2d-3e4f-4a5b-9c6d-7e8f9a0b1c2d",
    "kibana.alert.rule.name": "Potential Privilege Escalation via PKEXEC",
    "kibana.alert.rule.description":
      "Identifies an attempt to exploit a local privilege escalation in polkit pkexec (CVE-2021-4034).",
    "kibana.alert.rule.category": "Custom Query Rule",
    "kibana.alert.rule.consumer": "siem",
    "kibana.alert.rule.producer": "siem",
    "kibana.alert.rule.rule_type_id": "siem.queryRule",
    "kibana.alert.rule.threat": [
      {
        framework: "MITRE ATT&CK",
        tactic: {
          id: "TA0004",
          name: "Privilege Escalation",
          reference: "https://attack.mitre.org/tactics/TA0004/",
        },
        technique: [
          {
            id: "T1068",
            name: "Exploitation for Privilege Escalation",
            reference: "https://attack.mitre.org/techniques/T1068/",
          },
          {
            id: "T1548",
            name: "Abuse Elevation Control Mechanism",
            reference: "https://attack.mitre.org/techniques/T1548/",
            subtechnique: [
              {
                id: "T1548.001",
                name: "Setuid and Setgid",
                reference: "https://attack.mitre.org/techniques/T1548/001/",
              },
            ],
          },
        ],
      },
      {
        framework: "MITRE ATT&CK",
        tactic: {
          id: "TA0002",
          name: "Execution",
          reference: "https://attack.mitre.org/tactics/TA0002/",
        },
        technique: [],
      },
    ],
    "kibana.alert.severity": "high",
    "kibana.alert.risk_score": 73,
    "kibana.alert.workflow_status": "open",
    "kibana.alert.status": "active",
    "kibana.alert.reason":
      "process event with process pkexec, parent process bash, by www-data on web-01 created high alert Potential Privilege Escalation via PKEXEC.",
    "kibana.alert.original_time": "2026-09-12T09:58:41.117Z",
    "kibana.alert.original_event.category": ["process"],
    "kibana.alert.start": "2026-09-12T10:05:03.412Z",
    "kibana.alert.depth": 1,
    "kibana.space_ids": ["security"],
    "kibana.version": "9.1.0",
    host: {
      name: "web-01",
      ip: ["10.20.30.40", "fe80::1"],
      os: { family: "debian" },
    },
    user: { name: "www-data", id: "33" },
    process: {
      name: "pkexec",
      executable: "/usr/bin/pkexec",
      command_line: "pkexec /bin/sh",
      pid: 4211,
      parent: { name: "bash" },
    },
    source: { ip: "203.0.113.7", port: 51234 },
    destination: { ip: "198.51.100.9", port: 443, domain: "c2.example.net" },
    file: { path: "/tmp/payload", hash: { sha256: SHA256 } },
    event: { category: ["process"], type: ["start"], module: "auditd" },
    related: {
      user: ["www-data", "root"],
      ip: ["203.0.113.7"],
      hosts: ["WEB-01"],
    },
    ...(overrides || {}),
  };
}

function alertHit(overrides?: JSONObject | undefined): JSONObject {
  return {
    _index: ".internal.alerts-security.alerts-security-000001",
    _id: ALERT_ID,
    _score: null,
    _source: alertSource(overrides),
    sort: [1789200303412],
  };
}

describe("ElasticSecurityNormalizer", () => {
  describe("isRecognized", () => {
    test("recognizes a search hit, a bare alert document and a nested event.kind signal", () => {
      expect(ElasticSecurityNormalizer.isRecognized(alertHit())).toBe(true);
      expect(ElasticSecurityNormalizer.isRecognized(alertSource())).toBe(true);
      expect(
        ElasticSecurityNormalizer.isRecognized({
          event: { kind: "signal" },
          message: "no rule fields at all",
        }),
      ).toBe(true);
      expect(
        ElasticSecurityNormalizer.isRecognized({
          kibana: { alert: { rule: { name: "nested rule name" } } },
        }),
      ).toBe(true);
    });

    test("rejects documents that are not detection alerts", () => {
      expect(
        ElasticSecurityNormalizer.isRecognized({
          "@timestamp": "2026-09-12T10:05:03.412Z",
          message: "a log line",
          event: { kind: "event" },
        }),
      ).toBe(false);
      expect(ElasticSecurityNormalizer.isRecognized({})).toBe(false);
      expect(
        ElasticSecurityNormalizer.isRecognized({
          _id: "x",
          _source: { message: "not an alert" },
        }),
      ).toBe(false);
    });
  });

  describe("normalize", () => {
    test("frames the alert as a Detection Finding attributed to the catalog's vendor and product", () => {
      const event: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(alertHit());
      const category: { categoryUid: number; categoryName: string } =
        ocsfCategoryForClassUid(2004);

      expect(event.classUid).toBe(2004);
      expect(event.className).toBe("Detection Finding");
      expect(event.categoryUid).toBe(category.categoryUid);
      expect(event.categoryName).toBe(category.categoryName);
      expect(event.activityName).toBe("Create");
      expect(event.vendorName).toBe(DEFINITION.vendorName);
      expect(event.productName).toBe(DEFINITION.productName);
      expect(ELASTIC_SECURITY_VENDOR_NAME).toBe(DEFINITION.vendorName);
      expect(ELASTIC_SECURITY_PRODUCT_NAME).toBe(DEFINITION.productName);
    });

    test("uses the search hit _id as the event uid and keeps the index", () => {
      const event: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(alertHit());

      expect(event.eventUid).toBe(ALERT_ID);
      expect(event.attributes["_id"]).toBe(ALERT_ID);
      expect(event.attributes["_index"]).toBe(
        ".internal.alerts-security.alerts-security-000001",
      );
    });

    test("lifts severity, status, rule and message off the dotted rule-registry keys", () => {
      const event: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(alertHit());

      expect(event.severityName).toBe(OcsfSeverity.High);
      expect(event.severityId).toBe(4);
      expect(event.statusName).toBe("open");
      expect(event.ruleId).toBe(RULE_UUID);
      expect(event.ruleName).toBe("Potential Privilege Escalation via PKEXEC");
      expect(event.message).toBe(
        "process event with process pkexec, parent process bash, by www-data on web-01 created high alert Potential Privilege Escalation via PKEXEC.",
      );
    });

    test("maps every severity value the alert schema allows", () => {
      const cases: Array<[string, OcsfSeverity, number]> = [
        ["low", OcsfSeverity.Low, 2],
        ["medium", OcsfSeverity.Medium, 3],
        ["high", OcsfSeverity.High, 4],
        ["critical", OcsfSeverity.Critical, 5],
      ];

      for (const [severity, expectedName, expectedId] of cases) {
        const event: NormalizedSecurityEvent =
          ElasticSecurityNormalizer.normalize(
            alertHit({ "kibana.alert.severity": severity }),
          );
        expect(event.severityName).toBe(expectedName);
        expect(event.severityId).toBe(expectedId);
      }
    });

    test("falls back to the rule risk score bands when severity is absent, and to Unknown when both are", () => {
      const source: JSONObject = alertSource();
      delete source["kibana.alert.severity"];

      const bands: Array<[number, OcsfSeverity]> = [
        [0, OcsfSeverity.Low],
        [21, OcsfSeverity.Low],
        [22, OcsfSeverity.Medium],
        [47, OcsfSeverity.Medium],
        [48, OcsfSeverity.High],
        [73, OcsfSeverity.High],
        [74, OcsfSeverity.Critical],
        [100, OcsfSeverity.Critical],
      ];

      for (const [riskScore, expected] of bands) {
        const event: NormalizedSecurityEvent =
          ElasticSecurityNormalizer.normalize({
            ...source,
            "kibana.alert.risk_score": riskScore,
          });
        expect(event.severityName).toBe(expected);
      }

      delete source["kibana.alert.risk_score"];
      const unknown: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(source);
      expect(unknown.severityName).toBe(OcsfSeverity.Unknown);
      expect(unknown.severityId).toBe(0);
    });

    test("takes the event time from original_time, then start, then @timestamp", () => {
      expect(
        ElasticSecurityNormalizer.normalize(alertHit()).time.toISOString(),
      ).toBe("2026-09-12T09:58:41.117Z");

      const withoutOriginal: JSONObject = alertSource();
      delete withoutOriginal["kibana.alert.original_time"];
      withoutOriginal["kibana.alert.start"] = "2026-09-12T10:04:00.000Z";
      expect(
        ElasticSecurityNormalizer.normalize(withoutOriginal).time.toISOString(),
      ).toBe("2026-09-12T10:04:00.000Z");

      delete withoutOriginal["kibana.alert.start"];
      expect(
        ElasticSecurityNormalizer.normalize(withoutOriginal).time.toISOString(),
      ).toBe("2026-09-12T10:05:03.412Z");

      const noTimes: JSONObject = alertSource();
      delete noTimes["kibana.alert.original_time"];
      delete noTimes["kibana.alert.start"];
      delete noTimes["@timestamp"];
      const before: number = Date.now();
      const fallback: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(noTimes);
      expect(fallback.time.getTime()).toBeGreaterThanOrEqual(before);
      expect(fallback.time.getTime()).toBeLessThanOrEqual(Date.now());
    });

    test("collects MITRE tactic, technique and sub-technique ids from rule.threat", () => {
      const event: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(alertHit());

      expect(event.mitreTactics).toEqual(["TA0004", "TA0002"]);
      expect(event.mitreTechniques).toEqual(["T1068", "T1548", "T1548.001"]);
    });

    test("falls back to rule.parameters.threat under a dotted prefix holding a nested object", () => {
      const source: JSONObject = alertSource();
      delete source["kibana.alert.rule.threat"];
      source["kibana.alert.rule.parameters"] = {
        threat: [
          {
            framework: "MITRE ATT&CK",
            tactic: { id: "TA0006", name: "Credential Access" },
            technique: [{ id: "T1110", name: "Brute Force" }],
          },
        ],
      };

      const event: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(source);

      expect(event.mitreTactics).toEqual(["TA0006"]);
      expect(event.mitreTechniques).toEqual(["T1110"]);
    });

    test("fills principal and target columns from the nested ECS fields", () => {
      const event: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(alertHit());

      expect(event.principalUser).toBe("www-data");
      expect(event.principalHost).toBe("web-01");
      expect(event.principalIp).toBe("203.0.113.7");
      expect(event.principalProcess).toBe("pkexec");
      expect(event.targetUser).toBe("");
      expect(event.targetHost).toBe("c2.example.net");
      expect(event.targetIp).toBe("198.51.100.9");
      expect(event.targetPort).toBe(443);
      expect(event.targetResource).toBe("/tmp/payload");
    });

    test("uses the host IP as the principal IP when there is no source IP", () => {
      const source: JSONObject = alertSource();
      delete source["source"];

      const event: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(source);

      expect(event.principalIp).toBe("10.20.30.40");
    });

    test("mines observables from users, hosts, IPs, domains, process and hashes, deduplicated case-insensitively", () => {
      const event: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(alertHit());

      expect(event.observables).toEqual([
        "www-data",
        "root",
        "web-01",
        "10.20.30.40",
        "fe80::1",
        "203.0.113.7",
        "198.51.100.9",
        "c2.example.net",
        "pkexec",
        SHA256,
      ]);
    });

    test("flattens the whole source into attributes with dotted keys", () => {
      const event: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(alertHit());

      expect(event.attributes["kibana.alert.rule.name"]).toBe(
        "Potential Privilege Escalation via PKEXEC",
      );
      expect(event.attributes["kibana.alert.risk_score"]).toBe("73");
      expect(event.attributes["kibana.alert.rule.threat.0.tactic.id"]).toBe(
        "TA0004",
      );
      expect(event.attributes["host.ip"]).toBe("10.20.30.40,fe80::1");
      expect(event.attributes["process.command_line"]).toBe("pkexec /bin/sh");
      expect(event.attributes["event.category"]).toBe("process");
      expect(event.attributes["file.hash.sha256"]).toBe(SHA256);
    });

    test("reads a fully nested document (kibana.alert.* as objects) the same way", () => {
      const nested: JSONObject = {
        "@timestamp": "2026-09-12T10:05:03.412Z",
        event: { kind: "signal" },
        kibana: {
          alert: {
            uuid: "nested-uuid",
            severity: "critical",
            workflow_status: "acknowledged",
            reason: "nested reason",
            original_time: "2026-09-12T09:00:00.000Z",
            rule: {
              uuid: RULE_UUID,
              name: "Nested Rule",
              threat: [
                {
                  tactic: { id: "TA0001" },
                  technique: [{ id: "T1190" }],
                },
              ],
            },
          },
        },
        host: { name: "db-01" },
      };

      const event: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(nested);

      expect(event.eventUid).toBe("nested-uuid");
      expect(event.severityName).toBe(OcsfSeverity.Critical);
      expect(event.statusName).toBe("acknowledged");
      expect(event.ruleId).toBe(RULE_UUID);
      expect(event.ruleName).toBe("Nested Rule");
      expect(event.message).toBe("nested reason");
      expect(event.time.toISOString()).toBe("2026-09-12T09:00:00.000Z");
      expect(event.mitreTactics).toEqual(["TA0001"]);
      expect(event.mitreTechniques).toEqual(["T1190"]);
      expect(event.principalHost).toBe("db-01");
    });

    test("falls back to kibana.alert.uuid for a bare document, then to a stable content hash", () => {
      const bare: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(alertSource());
      expect(bare.eventUid).toBe(ALERT_ID);
      expect(bare.attributes["_id"]).toBeUndefined();

      const source: JSONObject = alertSource();
      delete source["kibana.alert.uuid"];

      const first: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(source);
      const second: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize({ ...source });

      expect(first.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(second.eventUid).toBe(first.eventUid);

      const different: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize({
          ...source,
          "kibana.alert.reason": "something else",
        });
      expect(different.eventUid).not.toBe(first.eventUid);
    });

    test("falls back from reason to rule name, description and a default message", () => {
      const noReason: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(
          alertHit({ "kibana.alert.reason": "" }),
        );
      expect(noReason.message).toBe(
        "Potential Privilege Escalation via PKEXEC",
      );

      const noRuleName: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(
          alertHit({ "kibana.alert.reason": "", "kibana.alert.rule.name": "" }),
        );
      expect(noRuleName.message).toBe(
        "Identifies an attempt to exploit a local privilege escalation in polkit pkexec (CVE-2021-4034).",
      );

      const nothing: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(
          alertHit({
            "kibana.alert.reason": "",
            "kibana.alert.rule.name": "",
            "kibana.alert.rule.description": "",
          }),
        );
      expect(nothing.message).toBe("Elastic Security alert");
    });

    test("uses rule_id when the rule uuid is missing and leaves columns empty rather than guessing", () => {
      const source: JSONObject = alertSource();
      delete source["kibana.alert.rule.uuid"];
      delete source["host"];
      delete source["user"];
      delete source["destination"];
      delete source["process"];
      delete source["file"];
      delete source["source"];
      delete source["related"];
      delete source["kibana.alert.workflow_status"];

      const event: NormalizedSecurityEvent =
        ElasticSecurityNormalizer.normalize(source);

      expect(event.ruleId).toBe("8a1b5c2d-3e4f-4a5b-9c6d-7e8f9a0b1c2d");
      expect(event.statusName).toBe("");
      expect(event.principalUser).toBe("");
      expect(event.principalHost).toBe("");
      expect(event.principalIp).toBe("");
      expect(event.principalProcess).toBe("");
      expect(event.targetIp).toBe("");
      expect(event.targetPort).toBe(0);
      expect(event.targetResource).toBe("");
      expect(event.observables).toEqual([]);
    });
  });
});
