import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import GoogleSecurityCommandCenterNormalizer from "../../../../Utils/SecurityEvent/Vendor/GoogleSecurityCommandCenterNormalizer";

describe("GoogleSecurityCommandCenterNormalizer", () => {
  function finding(): JSONObject {
    return {
      canonicalName:
        "organizations/1/sources/2/locations/global/findings/finding-1",
      findingClass: "THREAT",
      category: "MALWARE_DETECTED",
      state: "ACTIVE",
      severity: "HIGH",
      eventTime: "2026-03-04T05:06:07Z",
      description: "Malware was detected",
      resourceName:
        "//compute.googleapis.com/projects/project-1/instances/vm-1",
      access: {
        principalEmail: "operator@example.com",
        callerIp: "198.51.100.5",
      },
      indicator: {
        ipAddresses: ["203.0.113.10"],
        domains: ["malware.example"],
      },
      connections: [{ destinationIp: "10.2.3.4" }],
      mitreAttack: {
        tactic: "INITIAL ACCESS",
        technique: "T1190",
      },
      sourceProperties: {
        ruleId: "detector-1",
        mitre_tactic_id: "TA0005",
      },
    };
  }

  test("detects direct findings and SCC Pub/Sub envelopes", () => {
    expect(
      GoogleSecurityCommandCenterNormalizer.isGoogleSecurityCommandCenterEvent(
        finding(),
      ),
    ).toBe(true);
    expect(
      GoogleSecurityCommandCenterNormalizer.isGoogleSecurityCommandCenterFinding(
        {
          finding: finding(),
          stateChange: "ADDED",
        },
      ),
    ).toBe(true);
    expect(
      GoogleSecurityCommandCenterNormalizer.isGoogleSecurityCommandCenterEvent({
        category: "ordinary",
        state: "ACTIVE",
      }),
    ).toBe(false);
  });

  test("maps detection findings, resource context, and MITRE names and ids", () => {
    const result: NormalizedSecurityEvent =
      GoogleSecurityCommandCenterNormalizer.normalize({
        finding: finding(),
        stateChange: "ADDED",
        resource: {
          displayName: "production-vm",
        },
      });

    expect(result).toMatchObject({
      eventUid: "organizations/1/sources/2/locations/global/findings/finding-1",
      categoryUid: 2,
      classUid: 2004,
      className: "Detection Finding",
      activityName: "Create",
      severityName: OcsfSeverity.High,
      statusName: "ACTIVE",
      message: "Malware was detected",
      vendorName: "Google",
      productName: "Security Command Center",
      ruleId: "detector-1",
      ruleName: "Malware Detected",
      principalUser: "operator@example.com",
      principalIp: "198.51.100.5",
      targetHost: "production-vm",
      targetIp: "10.2.3.4",
      targetResource:
        "//compute.googleapis.com/projects/project-1/instances/vm-1",
      mitreTactics: ["TA0005", "TA0001"],
      mitreTechniques: ["T1190"],
    });
    expect(result.time.toISOString()).toBe("2026-03-04T05:06:07.000Z");
    expect(result.observables).toEqual(
      expect.arrayContaining([
        "operator@example.com",
        "198.51.100.5",
        "production-vm",
        "203.0.113.10",
        "malware.example",
      ]),
    );
  });

  test.each<[string, number, string, string]>([
    ["VULNERABILITY", 2002, "Vulnerability Finding", "Update"],
    ["MISCONFIGURATION", 2003, "Compliance Finding", "Close"],
    ["POSTURE_VIOLATION", 2003, "Compliance Finding", "Create"],
  ])(
    "maps %s findings to their OCSF class and activity",
    (
      findingClass: string,
      classUid: number,
      className: string,
      activityName: string,
    ) => {
      const payload: JSONObject = {
        ...finding(),
        findingClass,
        state: activityName === "Close" ? "INACTIVE" : "ACTIVE",
      };
      const stateChange: string = activityName === "Update" ? "CHANGED" : "";

      const result: NormalizedSecurityEvent =
        GoogleSecurityCommandCenterNormalizer.normalize({
          finding: payload,
          stateChange,
        });

      expect(result.classUid).toBe(classUid);
      expect(result.className).toBe(className);
      expect(result.activityName).toBe(activityName);
    },
  );

  test("uses category and resource fallbacks when optional SCC fields are missing", () => {
    const payload: JSONObject = {
      resourceName: "projects/project-1/resources/resource-1",
      category: "OPEN_BUCKET",
      state: "ACTIVE",
      severity: "SEVERITY_UNSPECIFIED",
    };
    const result: NormalizedSecurityEvent =
      GoogleSecurityCommandCenterNormalizer.normalize({
        finding: payload,
        resource: { name: "resource-fallback" },
      });

    expect(result.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.ruleId).toBe("OPEN_BUCKET");
    expect(result.ruleName).toBe("Open Bucket");
    expect(result.message).toBe("Open Bucket");
    expect(result.targetResource).toBe(
      "projects/project-1/resources/resource-1",
    );
    expect(result.severityName).toBe(OcsfSeverity.Unknown);
  });
});
