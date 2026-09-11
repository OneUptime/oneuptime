import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import CrowdStrikeFalconNormalizer from "../../../../Utils/SecurityEvent/Vendor/CrowdStrikeFalconNormalizer";

describe("CrowdStrikeFalconNormalizer", () => {
  function alert(): JSONObject {
    return {
      composite_id: "composite-1",
      display_name: "Suspicious PowerShell",
      aggregation_rule_id: "rule-1",
      aggregation_rule_name: "PowerShell detection",
      severity: 85,
      status: "new",
      timestamp: "2026-02-03T04:05:06Z",
      user_name: "analyst@example.com",
      device: {
        hostname: "workstation-01",
        local_ip: "10.1.2.3",
        device_id: "device-123",
      },
      command_line: "powershell.exe -enc payload",
      tactic_id: "TA0002",
      technique_id: "T1059.001",
      behaviors: [
        {
          description: "Encoded command execution",
          domain_name: "evil.example",
          remote_ip: "203.0.113.8",
          sha256: "abc123",
          tactic_id: "TA0005",
          technique_id: "T1027",
        },
      ],
    };
  }

  test("detects Falcon payload signatures and rejects unrelated events", () => {
    expect(CrowdStrikeFalconNormalizer.isCrowdStrikeFalconEvent(alert())).toBe(
      true,
    );
    expect(
      CrowdStrikeFalconNormalizer.isCrowdStrikeFalconAlert({
        vendor_name: "CrowdStrike",
      }),
    ).toBe(true);
    expect(
      CrowdStrikeFalconNormalizer.isCrowdStrikeFalconEvent({
        vendor: "another vendor",
        message: "ordinary event",
      }),
    ).toBe(false);
  });

  test("maps alert metadata, entities, observables, and MITRE references", () => {
    const result: NormalizedSecurityEvent =
      CrowdStrikeFalconNormalizer.normalize(alert());

    expect(result).toMatchObject({
      eventUid: "composite-1",
      categoryUid: 2,
      classUid: 2004,
      severityName: OcsfSeverity.Critical,
      statusName: "new",
      message: "Suspicious PowerShell",
      vendorName: "CrowdStrike",
      productName: "Falcon",
      ruleId: "rule-1",
      ruleName: "PowerShell detection",
      principalUser: "analyst@example.com",
      principalProcess: "powershell.exe -enc payload",
      targetHost: "workstation-01",
      targetIp: "10.1.2.3",
      targetResource: "device-123",
      mitreTactics: ["TA0002", "TA0005"],
      mitreTechniques: ["T1059.001", "T1027"],
    });
    expect(result.time.toISOString()).toBe("2026-02-03T04:05:06.000Z");
    expect(result.observables).toEqual(
      expect.arrayContaining([
        "analyst@example.com",
        "workstation-01",
        "10.1.2.3",
        "evil.example",
        "203.0.113.8",
        "abc123",
      ]),
    );
  });

  test.each<[number, OcsfSeverity]>([
    [1, OcsfSeverity.Informational],
    [20, OcsfSeverity.Low],
    [40, OcsfSeverity.Medium],
    [60, OcsfSeverity.High],
    [80, OcsfSeverity.Critical],
  ])(
    "maps numeric severity score %i",
    (score: number, expected: OcsfSeverity) => {
      expect(
        CrowdStrikeFalconNormalizer.normalize({
          ...alert(),
          severity: score,
          severity_name: undefined,
        }).severityName,
      ).toBe(expected);
    },
  );

  test("prefers named severity and behavior details when top-level fields are absent", () => {
    const result: NormalizedSecurityEvent =
      CrowdStrikeFalconNormalizer.normalize({
        detection_id: "detection-1",
        severity_display_name: "medium",
        behaviors: [
          {
            description: "Behavior-only alert",
            username: "behavior-user",
            hostname: "behavior-host",
            local_ip: "192.0.2.9",
            cmdline: "cmd.exe /c whoami",
          },
        ],
      });

    expect(result.eventUid).toBe("detection-1");
    expect(result.severityName).toBe(OcsfSeverity.Medium);
    expect(result.message).toBe("Behavior-only alert");
    expect(result.principalUser).toBe("behavior-user");
    expect(result.targetHost).toBe("behavior-host");
    expect(result.principalProcess).toBe("cmd.exe /c whoami");
  });

  test("uses a stable hash and unknown severity for a minimally identified alert", () => {
    const payload: JSONObject = { product: "Falcon" };
    const result: NormalizedSecurityEvent =
      CrowdStrikeFalconNormalizer.normalize(payload);

    expect(result.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.message).toBe("CrowdStrike Falcon alert");
    expect(result.severityName).toBe(OcsfSeverity.Unknown);
  });
});
