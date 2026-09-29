import { describe, expect, test } from "@jest/globals";
import SplunkNormalizer, {
  isIpAddress,
} from "../../../../Utils/SecurityEvent/Connectors/SplunkNormalizer";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { JSONObject } from "../../../../Types/JSON";

/*
 * Fixtures are shaped like the `result` object of one line of a JSON
 * export over index=notable in Splunk Enterprise Security: flat string
 * fields (Splunk renders numbers as strings), multivalue fields as JSON
 * arrays, dotted annotation keys as literal keys, and the internal
 * underscore fields every indexed event carries.
 */

const definition: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
  )!;

function bruteForceNotable(): JSONObject {
  return {
    _bkt: "notable~12~C8D6C9F5-4C3B-4F3E-9A3E-0F2B2C9D4E1A",
    _cd: "12:4821",
    _indextime: "1757671200",
    _raw: '09/12/2026 10:15:00 +0000, search_name="Access - Brute Force Access Behavior Detected - Rule", search_now=1757671200.000, info_min_time=1757667600.000, info_max_time=1757671200.000, info_search_time=1757671201.123, count=57, src="10.20.30.40", dest="wkstn-042", user="alice"',
    _serial: "0",
    _si: ["idx-01", "notable"],
    _sourcetype: "stash",
    _time: "2026-09-12T10:15:00.000+00:00",
    "annotations.mitre_attack": ["T1110", "T1110.001"],
    "annotations.mitre_attack.mitre_tactic": "Credential Access",
    "annotations.mitre_attack.mitre_tactic_id": "TA0006",
    "annotations.mitre_attack.mitre_technique_id": ["T1110", "T1110.001"],
    count: "57",
    dest: "wkstn-042",
    dest_user: "svc-backup",
    event_id:
      "C8D6C9F5-4C3B-4F3E-9A3E-0F2B2C9D4E1A@@notable@@1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
    host: "sh-01",
    index: "notable",
    info_max_time: "1757671200.000",
    info_min_time: "1757667600.000",
    orig_sid:
      "scheduler__nobody__SplunkEnterpriseSecuritySuite__RMD5c0ffee_at_1757671200_12345",
    orig_rid: "0",
    owner: "unassigned",
    rule_description:
      "Detects excessive failed authentication attempts from a single source.",
    rule_name: "Access - Brute Force Access Behavior Detected - Rule",
    rule_title: "Brute Force Access Behavior Detected from 10.20.30.40",
    search_name: "Access - Brute Force Access Behavior Detected - Rule",
    security_domain: "access",
    severity: "medium",
    source: "Access - Brute Force Access Behavior Detected - Rule",
    sourcetype: "stash",
    splunk_server: "idx-01",
    src: "10.20.30.40",
    status: "1",
    status_description: "Event has not been reviewed.",
    status_label: "New",
    urgency: "high",
    user: "alice",
  };
}

describe("SplunkNormalizer", () => {
  describe("isRecognized", () => {
    test("recognizes an export row by _time, event_id or its rule name", () => {
      expect(SplunkNormalizer.isRecognized(bruteForceNotable())).toBe(true);
      expect(
        SplunkNormalizer.isRecognized({ _time: "1789209600", _raw: "x" }),
      ).toBe(true);
      expect(SplunkNormalizer.isRecognized({ event_id: "abc" })).toBe(true);
      expect(
        SplunkNormalizer.isRecognized({ rule_name: "Threat - Rule" }),
      ).toBe(true);
    });

    test("rejects rows that could not have come from an event export", () => {
      expect(SplunkNormalizer.isRecognized({ count: "3" })).toBe(false);
      expect(SplunkNormalizer.isRecognized({})).toBe(false);
      expect(SplunkNormalizer.isRecognized([] as unknown as JSONObject)).toBe(
        false,
      );
      expect(SplunkNormalizer.isRecognized(null as unknown as JSONObject)).toBe(
        false,
      );
    });
  });

  describe("normalize", () => {
    test("maps a brute-force notable to a Detection Finding with every typed column", () => {
      const event: NormalizedSecurityEvent =
        SplunkNormalizer.normalize(bruteForceNotable());

      expect(event.classUid).toBe(2004);
      expect(event.className).toBe("Detection Finding");
      expect(event.categoryUid).toBe(2);
      expect(event.categoryName).toBe("Findings");
      expect(event.activityName).toBe("Create");
      expect(event.time.toISOString()).toBe("2026-09-12T10:15:00.000Z");
      expect(event.eventUid).toBe(
        "C8D6C9F5-4C3B-4F3E-9A3E-0F2B2C9D4E1A@@notable@@1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
      );
      expect(event.vendorName).toBe(definition.vendorName);
      expect(event.productName).toBe(definition.productName);
      expect(event.vendorName).toBe("Splunk");
      expect(event.productName).toBe("Splunk Enterprise Security");

      // Urgency wins over the raw correlation-search severity.
      expect(event.severityName).toBe(OcsfSeverity.High);
      expect(event.severityId).toBe(4);
      expect(event.statusName).toBe("New");
      expect(event.message).toBe(
        "Brute Force Access Behavior Detected from 10.20.30.40",
      );
      expect(event.ruleName).toBe(
        "Access - Brute Force Access Behavior Detected - Rule",
      );
      expect(event.ruleId).toBe(
        "Access - Brute Force Access Behavior Detected - Rule",
      );

      expect(event.mitreTechniques).toEqual(["T1110", "T1110.001"]);
      expect(event.mitreTactics).toEqual(["TA0006"]);

      expect(event.principalIp).toBe("10.20.30.40");
      expect(event.principalHost).toBe("");
      expect(event.principalUser).toBe("alice");
      expect(event.principalProcess).toBe("");
      expect(event.targetHost).toBe("wkstn-042");
      expect(event.targetIp).toBe("");
      expect(event.targetUser).toBe("svc-backup");
      expect(event.targetPort).toBe(0);
      expect(event.targetResource).toBe("");

      expect(event.observables).toEqual([
        "alice",
        "svc-backup",
        "wkstn-042",
        "10.20.30.40",
        "sh-01",
      ]);
    });

    test("keeps every source field, dotted keys included, in the flattened attributes", () => {
      const event: NormalizedSecurityEvent =
        SplunkNormalizer.normalize(bruteForceNotable());

      expect(event.attributes["annotations.mitre_attack"]).toBe(
        "T1110,T1110.001",
      );
      expect(event.attributes["annotations.mitre_attack.mitre_tactic"]).toBe(
        "Credential Access",
      );
      expect(event.attributes["security_domain"]).toBe("access");
      expect(event.attributes["_si"]).toBe("idx-01,notable");
      expect(event.attributes["orig_sid"]).toBe(
        "scheduler__nobody__SplunkEnterpriseSecuritySuite__RMD5c0ffee_at_1757671200_12345",
      );
      expect(event.attributes["_cd"]).toBe("12:4821");
      expect(typeof event.attributes["_raw"]).toBe("string");
    });

    test("uses the bucket and offset pair as the uid when the notable macro did not add event_id", () => {
      const payload: JSONObject = bruteForceNotable();
      delete payload["event_id"];

      const event: NormalizedSecurityEvent =
        SplunkNormalizer.normalize(payload);

      expect(event.eventUid).toBe(
        "splunk:notable~12~C8D6C9F5-4C3B-4F3E-9A3E-0F2B2C9D4E1A:12:4821",
      );
    });

    test("falls back to a stable content hash when the row carries no identity at all", () => {
      const payload: JSONObject = {
        _time: "1789209600",
        rule_name: "Threat - Ransomware Note Files - Rule",
        dest: "fs-01",
      };

      const first: NormalizedSecurityEvent =
        SplunkNormalizer.normalize(payload);
      const second: NormalizedSecurityEvent = SplunkNormalizer.normalize({
        ...payload,
      });

      expect(first.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(second.eventUid).toBe(first.eventUid);
      expect(
        SplunkNormalizer.normalize({ ...payload, dest: "fs-02" }).eventUid,
      ).not.toBe(first.eventUid);
    });

    test("parses _time as epoch seconds, epoch with fraction, or ISO with offset", () => {
      expect(
        SplunkNormalizer.normalize({
          _time: "1789209600",
          rule_name: "r",
        }).time.toISOString(),
      ).toBe("2026-09-12T10:40:00.000Z");
      expect(
        SplunkNormalizer.normalize({
          _time: "1789209600.500",
          rule_name: "r",
        }).time.toISOString(),
      ).toBe("2026-09-12T10:40:00.500Z");
      expect(
        SplunkNormalizer.normalize({
          _time: "2026-09-12T12:15:00.000-02:00",
          rule_name: "r",
        }).time.toISOString(),
      ).toBe("2026-09-12T14:15:00.000Z");
    });

    test("falls back to now when _time is missing or unparseable", () => {
      const before: number = Date.now();
      const event: NormalizedSecurityEvent = SplunkNormalizer.normalize({
        _time: "yesterday-ish",
        rule_name: "r",
      });

      expect(event.time.getTime()).toBeGreaterThanOrEqual(before);
      expect(event.time.getTime()).toBeLessThanOrEqual(Date.now());
    });

    test("maps every urgency level and falls back to severity, then Unknown", () => {
      const cases: Array<[string, OcsfSeverity]> = [
        ["informational", OcsfSeverity.Informational],
        ["low", OcsfSeverity.Low],
        ["medium", OcsfSeverity.Medium],
        ["high", OcsfSeverity.High],
        ["critical", OcsfSeverity.Critical],
        ["unknown", OcsfSeverity.Unknown],
      ];

      for (const [urgency, expected] of cases) {
        expect(
          SplunkNormalizer.normalize({ _time: "1789209600", urgency })
            .severityName,
        ).toBe(expected);
      }

      expect(
        SplunkNormalizer.normalize({
          _time: "1789209600",
          severity: "critical",
        }).severityName,
      ).toBe(OcsfSeverity.Critical);
      expect(
        SplunkNormalizer.normalize({
          _time: "1789209600",
          urgency: "whatever",
          severity: "low",
        }).severityName,
      ).toBe(OcsfSeverity.Low);
      expect(
        SplunkNormalizer.normalize({ _time: "1789209600" }).severityName,
      ).toBe(OcsfSeverity.Unknown);
      expect(
        SplunkNormalizer.normalize({ _time: "1789209600" }).severityId,
      ).toBe(0);
    });

    test("labels a numeric status with the default review status names and keeps unknown codes", () => {
      expect(
        SplunkNormalizer.normalize({ _time: "1789209600", status: "2" })
          .statusName,
      ).toBe("In Progress");
      expect(
        SplunkNormalizer.normalize({ _time: "1789209600", status: "5" })
          .statusName,
      ).toBe("Closed");
      expect(
        SplunkNormalizer.normalize({ _time: "1789209600", status: "9" })
          .statusName,
      ).toBe("9");
      expect(
        SplunkNormalizer.normalize({
          _time: "1789209600",
          status: "2",
          status_description: "Investigation in progress.",
        }).statusName,
      ).toBe("Investigation in progress.");
      expect(
        SplunkNormalizer.normalize({ _time: "1789209600" }).statusName,
      ).toBe("");
    });

    test("tells IP addresses from hostnames in src and dest and honours the explicit CIM fields", () => {
      const event: NormalizedSecurityEvent = SplunkNormalizer.normalize({
        _time: "1789209600",
        src: "attacker.example.net",
        src_ip: "203.0.113.9",
        dest: "192.0.2.15",
        dest_host: "db-01.corp.example.com",
        dest_port: "5432",
        src_user: "bob",
        process_name: "psql.exe",
        file_path: "C:\\Temp\\dump.sql",
      });

      expect(event.principalHost).toBe("attacker.example.net");
      expect(event.principalIp).toBe("203.0.113.9");
      expect(event.principalUser).toBe("bob");
      expect(event.principalProcess).toBe("psql.exe");
      expect(event.targetIp).toBe("192.0.2.15");
      expect(event.targetHost).toBe("db-01.corp.example.com");
      expect(event.targetPort).toBe(5432);
      expect(event.targetResource).toBe("C:\\Temp\\dump.sql");
      expect(event.observables).toEqual([
        "bob",
        "attacker.example.net",
        "db-01.corp.example.com",
        "203.0.113.9",
        "192.0.2.15",
      ]);
    });

    test("recognizes IPv6 sources", () => {
      const event: NormalizedSecurityEvent = SplunkNormalizer.normalize({
        _time: "1789209600",
        src: "2001:db8::1",
        dest: "::ffff:192.0.2.1",
      });

      expect(event.principalIp).toBe("2001:db8::1");
      expect(event.principalHost).toBe("");
      expect(event.targetIp).toBe("::ffff:192.0.2.1");
      expect(isIpAddress("wkstn-042")).toBe(false);
      expect(isIpAddress("256.1.1.1")).toBe(false);
      expect(isIpAddress("")).toBe(false);
    });

    test("reads MITRE annotations from a comma-joined string and from tactic names", () => {
      const event: NormalizedSecurityEvent = SplunkNormalizer.normalize({
        _time: "1789209600",
        "annotations.mitre_attack": "T1078, t1078.004, TA0001, bogus",
        mitre_tactic: ["Initial Access", "Defense Evasion"],
        mitre_technique_id: "T1562.001",
      });

      expect(event.mitreTechniques).toEqual([
        "T1078",
        "T1078.004",
        "T1562.001",
      ]);
      expect(event.mitreTactics).toEqual(["TA0001", "TA0005"]);
    });

    test("multivalue src and user fields take the first value", () => {
      const event: NormalizedSecurityEvent = SplunkNormalizer.normalize({
        _time: "1789209600",
        src: ["10.0.0.1", "10.0.0.2"],
        user: ["alice", "bob"],
      });

      expect(event.principalIp).toBe("10.0.0.1");
      expect(event.principalUser).toBe("alice");
      expect(event.attributes["src"]).toBe("10.0.0.1,10.0.0.2");
    });

    test("falls back through rule_description, rule_name and a generic message for the title", () => {
      expect(
        SplunkNormalizer.normalize({
          _time: "1789209600",
          rule_description: "Something happened",
          rule_name: "Threat - Rule",
        }).message,
      ).toBe("Something happened");
      expect(
        SplunkNormalizer.normalize({
          _time: "1789209600",
          search_name: "Threat - Saved Search",
        }).message,
      ).toBe("Threat - Saved Search");
      expect(
        SplunkNormalizer.normalize({ _time: "1789209600", source: "src" })
          .message,
      ).toBe("src");
      expect(SplunkNormalizer.normalize({ _time: "1789209600" }).message).toBe(
        "Splunk Enterprise Security notable event",
      );
    });

    test("does not include nested objects or empty strings as observables", () => {
      const event: NormalizedSecurityEvent = SplunkNormalizer.normalize({
        _time: "1789209600",
        src: "",
        user: { name: "nested" } as unknown as string,
        host: "  sh-01  ",
      });

      expect(event.principalUser).toBe("");
      expect(event.observables).toEqual(["sh-01"]);
    });
  });
});
