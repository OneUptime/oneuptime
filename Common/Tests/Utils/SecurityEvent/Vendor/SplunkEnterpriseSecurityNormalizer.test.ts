import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SplunkEnterpriseSecurityNormalizer from "../../../../Utils/SecurityEvent/Vendor/SplunkEnterpriseSecurityNormalizer";

describe("SplunkEnterpriseSecurityNormalizer", () => {
  function notableEvent(): JSONObject {
    return {
      event_id: "notable-1",
      _time: "2026-06-07T08:09:10Z",
      rule_id: "rule-1",
      rule_name: "Brute force detected",
      description: "Repeated failed authentication attempts",
      urgency: "high",
      status_label: "2",
      src_user: "attacker",
      src_ip: "198.51.100.30",
      dest_user: "target-user",
      dest: "target-host",
      dest_ip: "10.3.4.5",
      dest_port: "22",
      process_name: "sshd",
      annotations: '{"tactic":"TA0006","technique":"T1110"}',
      sha256: "file-hash",
      domain: "bad.example",
    };
  }

  test("detects notable and risk events while rejecting ordinary Splunk records", () => {
    expect(
      SplunkEnterpriseSecurityNormalizer.isSplunkEnterpriseSecurityEvent(
        notableEvent(),
      ),
    ).toBe(true);
    expect(
      SplunkEnterpriseSecurityNormalizer.isSplunkNotableOrRiskEvent({
        risk_object: "target-user",
        risk_score: 85,
      }),
    ).toBe(true);
    expect(
      SplunkEnterpriseSecurityNormalizer.isSplunkEnterpriseSecurityEvent({
        host: "indexer-1",
        message: "ordinary log",
      }),
    ).toBe(false);
  });

  test("maps notable event identity, status, network fields, and annotations", () => {
    const result: NormalizedSecurityEvent =
      SplunkEnterpriseSecurityNormalizer.normalize(notableEvent());

    expect(result).toMatchObject({
      eventUid: "notable-1",
      categoryUid: 2,
      classUid: 2004,
      activityName: "Create",
      severityName: OcsfSeverity.High,
      statusName: "In Progress",
      message: "Repeated failed authentication attempts",
      vendorName: "Splunk",
      productName: "Enterprise Security",
      ruleId: "rule-1",
      ruleName: "Brute force detected",
      principalUser: "attacker",
      principalIp: "198.51.100.30",
      principalProcess: "sshd",
      targetUser: "target-user",
      targetHost: "target-host",
      targetIp: "10.3.4.5",
      targetPort: 22,
      mitreTactics: ["TA0006"],
      mitreTechniques: ["T1110"],
    });
    expect(result.time.toISOString()).toBe("2026-06-07T08:09:10.000Z");
    expect(result.observables).toEqual(
      expect.arrayContaining([
        "attacker",
        "198.51.100.30",
        "target-user",
        "target-host",
        "10.3.4.5",
        "file-hash",
        "bad.example",
      ]),
    );
  });

  test.each<[number, OcsfSeverity]>([
    [1, OcsfSeverity.Informational],
    [40, OcsfSeverity.Low],
    [60, OcsfSeverity.Medium],
    [80, OcsfSeverity.High],
    [100, OcsfSeverity.Critical],
  ])("maps risk score %i", (riskScore: number, expected: OcsfSeverity) => {
    expect(
      SplunkEnterpriseSecurityNormalizer.normalize({
        risk_object: "account@example.com",
        risk_object_type: "user",
        risk_score: riskScore,
      }).severityName,
    ).toBe(expected);
  });

  test("maps risk modifiers separately and extracts MITRE data from scalar fields", () => {
    const result: NormalizedSecurityEvent =
      SplunkEnterpriseSecurityNormalizer.normalize({
        risk_object: "server-1",
        risk_object_type: "system",
        risk_score: 90,
        mitre_tactic: "TA0008",
        mitre_technique_id: "T1021.001",
      });

    expect(result.activityName).toBe("Update");
    expect(result.statusName).toBe("");
    expect(result.message).toBe("Risk modifier for server-1");
    expect(result.targetHost).toBe("server-1");
    expect(result.targetResource).toBe("server-1");
    expect(result.mitreTactics).toEqual(["TA0008"]);
    expect(result.mitreTechniques).toEqual(["T1021.001"]);
  });

  test("uses a stable hash and safe defaults when optional notable fields are absent", () => {
    const payload: JSONObject = { rule_name: "minimal", owner: "analyst" };
    const first: NormalizedSecurityEvent =
      SplunkEnterpriseSecurityNormalizer.normalize(payload);
    const second: NormalizedSecurityEvent =
      SplunkEnterpriseSecurityNormalizer.normalize(payload);

    expect(first.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.eventUid).toBe(second.eventUid);
    expect(first.message).toBe("minimal");
    expect(first.severityName).toBe(OcsfSeverity.Unknown);
  });

  test("scopes raw data addresses by bucket", () => {
    const first: NormalizedSecurityEvent =
      SplunkEnterpriseSecurityNormalizer.normalize({
        _bkt: "main~1~bucket-a",
        _cd: "12:34",
        rule_name: "first",
      });
    const second: NormalizedSecurityEvent =
      SplunkEnterpriseSecurityNormalizer.normalize({
        _bkt: "main~1~bucket-b",
        _cd: "12:34",
        rule_name: "second",
      });

    expect(first.eventUid).toBe("main~1~bucket-a|12:34");
    expect(second.eventUid).toBe("main~1~bucket-b|12:34");
    expect(first.eventUid).not.toBe(second.eventUid);
  });
});
