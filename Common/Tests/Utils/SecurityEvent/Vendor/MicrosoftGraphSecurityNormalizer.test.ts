import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import MicrosoftGraphSecurityNormalizer from "../../../../Utils/SecurityEvent/Vendor/MicrosoftGraphSecurityNormalizer";

describe("MicrosoftGraphSecurityNormalizer", () => {
  function alert(): JSONObject {
    return {
      "@odata.type": "#microsoft.graph.security.alert",
      id: "alert-1",
      displayName: "Suspicious sign-in",
      severity: "high",
      status: "new",
      serviceSource: "microsoftDefenderForEndpoint",
      productName: "Microsoft Defender for Endpoint",
      createdDateTime: "2026-04-05T06:07:08Z",
      alertPolicyId: "policy-1",
      threatDisplayName: "Password spray",
      categories: ["CredentialAccess"],
      mitreTechniques: ["T1110"],
      evidence: [
        {
          "@odata.type": "#microsoft.graph.security.userEvidence",
          roles: ["attacker"],
          userAccount: { userPrincipalName: "attacker@example.com" },
        },
        {
          "@odata.type": "#microsoft.graph.security.deviceEvidence",
          roles: ["impacted"],
          deviceDnsName: "target.example.com",
          ipInterfaces: ["10.0.0.8"],
        },
        {
          "@odata.type": "#microsoft.graph.security.ipEvidence",
          roles: ["source"],
          ipAddress: "198.51.100.10",
        },
        {
          "@odata.type": "#microsoft.graph.security.processEvidence",
          processCommandLine: "powershell.exe -enc payload",
          fileDetails: { sha256: "hash-1", fileName: "payload.ps1" },
        },
      ],
    };
  }

  test("detects direct alerts, collection responses, and change notifications", () => {
    expect(
      MicrosoftGraphSecurityNormalizer.isMicrosoftGraphSecurityEvent(alert()),
    ).toBe(true);
    expect(
      MicrosoftGraphSecurityNormalizer.isMicrosoftGraphSecurityEvent({
        "@odata.context":
          "https://graph.microsoft.com/v1.0/$metadata#security/alerts",
        value: [alert()],
      }),
    ).toBe(true);
    expect(
      MicrosoftGraphSecurityNormalizer.isMicrosoftGraphSecurityEvent({
        value: [{ resourceData: alert() }],
      }),
    ).toBe(true);
    expect(
      MicrosoftGraphSecurityNormalizer.isMicrosoftGraphSecurityEvent({
        id: "ordinary-event",
      }),
    ).toBe(false);
  });

  test("maps an alert's identity, evidence, and attack metadata", () => {
    const result: NormalizedSecurityEvent =
      MicrosoftGraphSecurityNormalizer.normalize(alert());

    expect(result).toMatchObject({
      eventUid: "alert-1",
      categoryUid: 2,
      classUid: 2004,
      className: "Detection Finding",
      severityName: OcsfSeverity.High,
      statusName: "new",
      message: "Suspicious sign-in",
      vendorName: "Microsoft",
      productName: "Microsoft Defender for Endpoint",
      ruleId: "policy-1",
      ruleName: "Password spray",
      mitreTactics: ["CredentialAccess"],
      mitreTechniques: ["T1110"],
      principalUser: "attacker@example.com",
      principalIp: "198.51.100.10",
      principalProcess: "powershell.exe -enc payload",
      targetHost: "target.example.com",
      targetResource: "payload.ps1",
    });
    expect(result.time.toISOString()).toBe("2026-04-05T06:07:08.000Z");
    expect(result.observables).toEqual(
      expect.arrayContaining([
        "attacker@example.com",
        "198.51.100.10",
        "target.example.com",
        "hash-1",
        "payload.ps1",
      ]),
    );
  });

  test("expands incident alerts and derives the Sentinel product and priority severity", () => {
    const result: NormalizedSecurityEvent =
      MicrosoftGraphSecurityNormalizer.normalize({
        "@odata.type": "#microsoft.graph.security.incident",
        id: "incident-1",
        displayName: "Coordinated attack",
        priorityScore: 20,
        status: "active",
        serviceSource: "microsoftSentinel",
        lastActivityDateTime: "2026-04-06T00:00:00Z",
        alerts: [
          {
            id: "alert-child",
            detectorId: "detector-1",
            category: "Malware",
            mitreTechniques: ["T1059"],
            evidence: [
              {
                "@odata.type": "#microsoft.graph.security.ipEvidence",
                roles: ["attacker"],
                ipAddress: "203.0.113.11",
              },
            ],
          },
        ],
      });

    expect(result.classUid).toBe(2005);
    expect(result.className).toBe("Incident Finding");
    expect(result.productName).toBe("Microsoft Sentinel");
    expect(result.severityName).toBe(OcsfSeverity.Medium);
    expect(result.ruleId).toBe("detector-1");
    expect(result.ruleName).toBe("Malware");
    expect(result.principalIp).toBe("203.0.113.11");
    expect(result.mitreTechniques).toEqual(["T1059"]);
  });

  test.each<[number, OcsfSeverity]>([
    [0, OcsfSeverity.Low],
    [15, OcsfSeverity.Medium],
    [86, OcsfSeverity.High],
  ])("maps priority score %i", (score: number, expected: OcsfSeverity) => {
    expect(
      MicrosoftGraphSecurityNormalizer.normalize({
        providerAlertId: "provider-alert",
        serviceSource: "defender",
        priorityScore: score,
      }).severityName,
    ).toBe(expected);
  });
});
