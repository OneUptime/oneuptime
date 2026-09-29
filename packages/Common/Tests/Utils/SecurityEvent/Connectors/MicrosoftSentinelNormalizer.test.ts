import { describe, expect, test } from "@jest/globals";
import MicrosoftSentinelNormalizer, {
  MICROSOFT_SENTINEL_INCIDENT_CLASS_NAME,
  MICROSOFT_SENTINEL_INCIDENT_CLASS_UID,
} from "../../../../Utils/SecurityEvent/Connectors/MicrosoftSentinelNormalizer";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import { JSONObject } from "../../../../Types/JSON";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";

/*
 * Fixtures are shaped like the Incident resource of the Sentinel REST API
 * (Incidents - List, api-version 2024-03-01), including the sample
 * response from the reference page.
 */

const SUBSCRIPTION_PATH: string =
  "/subscriptions/d0cfe6b2-9ac0-4464-9919-dccaee2e48c0/resourceGroups/myRg/providers/Microsoft.OperationalInsights/workspaces/myWorkspace/providers/Microsoft.SecurityInsights";

const definition: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.MicrosoftSentinel,
  )!;

// The reference page's sample incident, verbatim.
function sampleIncident(): JSONObject {
  return {
    id: `${SUBSCRIPTION_PATH}/incidents/73e01a99-5cd7-4139-a149-9f2736ff2ab5`,
    name: "73e01a99-5cd7-4139-a149-9f2736ff2ab5",
    type: "Microsoft.SecurityInsights/incidents",
    etag: '"0300bf09-0000-0000-0000-5c37296e0000"',
    properties: {
      lastModifiedTimeUtc: "2019-01-01T13:15:30Z",
      createdTimeUtc: "2019-01-01T13:15:30Z",
      lastActivityTimeUtc: "2019-01-01T13:05:30Z",
      firstActivityTimeUtc: "2019-01-01T13:00:30Z",
      description: "This is a demo incident",
      title: "My incident",
      owner: {
        objectId: "2046feea-040d-4a46-9e2b-91c2941bfa70",
        email: "john.doe@contoso.com",
        userPrincipalName: "john@contoso.com",
        assignedTo: "john doe",
      },
      severity: "High",
      classification: "FalsePositive",
      classificationComment: "Not a malicious activity",
      classificationReason: "IncorrectAlertLogic",
      status: "Closed",
      incidentUrl: `https://portal.azure.com/#asset/Microsoft_Azure_Security_Insights/Incident${SUBSCRIPTION_PATH}/incidents/73e01a99-5cd7-4139-a149-9f2736ff2ab5`,
      incidentNumber: 3177,
      labels: [],
      providerName: "Azure Sentinel",
      providerIncidentId: "3177",
      relatedAnalyticRuleIds: [
        `${SUBSCRIPTION_PATH}/alertRules/fab3d2d4-747f-46a7-8ef0-9c0be8112bf7`,
        `${SUBSCRIPTION_PATH}/alertRules/8deb8303-e94d-46ff-96e0-5fd94b33df1a`,
      ],
      additionalData: {
        alertsCount: 0,
        bookmarksCount: 0,
        commentsCount: 3,
        alertProductNames: [],
        tactics: ["Persistence"],
      },
    },
  };
}

// A live-looking incident: labels, several tactics, product names.
function richIncident(): JSONObject {
  return {
    id: `${SUBSCRIPTION_PATH}/incidents/0f4d2c3a-8b1e-4d7f-9a6c-1e2f3a4b5c6d`,
    name: "0f4d2c3a-8b1e-4d7f-9a6c-1e2f3a4b5c6d",
    type: "Microsoft.SecurityInsights/incidents",
    properties: {
      title: "Multiple failed sign-ins followed by a success",
      description: "Possible password spray",
      severity: "Medium",
      status: "Active",
      createdTimeUtc: "2026-09-12T13:15:30.1234567Z",
      lastModifiedTimeUtc: "2026-09-12T14:00:00Z",
      firstActivityTimeUtc: "2026-09-12T03:00:00Z",
      lastActivityTimeUtc: "2026-09-12T04:00:00Z",
      incidentNumber: 4802,
      incidentUrl: "https://portal.azure.com/#asset/incident/4802",
      owner: {
        objectId: "9d1c6a7e-2b3f-4c5d-8e9f-0a1b2c3d4e5f",
        email: "analyst@contoso.com",
        userPrincipalName: "analyst@contoso.com",
        assignedTo: "Analyst One",
        ownerType: "User",
      },
      labels: [
        { labelName: "Phishing", labelType: "User" },
        { labelName: "Tier1", labelType: "AutoAssigned" },
        { labelName: "phishing", labelType: "User" },
      ],
      providerName: "Azure Sentinel",
      providerIncidentId: "4802",
      relatedAnalyticRuleIds: [
        `${SUBSCRIPTION_PATH}/alertRules/aaaaaaaa-0000-1111-2222-bbbbbbbbbbbb`,
      ],
      additionalData: {
        alertsCount: 3,
        bookmarksCount: 0,
        commentsCount: 1,
        alertProductNames: ["Azure Sentinel", "Microsoft Defender XDR"],
        tactics: [
          "CredentialAccess",
          "InitialAccess",
          "PreAttack",
          "credentialaccess",
        ],
        providerIncidentUrl: "https://security.microsoft.com/incidents/4802",
      },
    },
  };
}

describe("MicrosoftSentinelNormalizer", () => {
  describe("isRecognized", () => {
    test("recognizes an incident by its ARM resource type", () => {
      expect(MicrosoftSentinelNormalizer.isRecognized(sampleIncident())).toBe(
        true,
      );
      expect(
        MicrosoftSentinelNormalizer.isRecognized({
          type: "microsoft.securityinsights/incidents",
          properties: {},
        }),
      ).toBe(true);
    });

    test("recognizes an untyped incident by its property bag", () => {
      expect(
        MicrosoftSentinelNormalizer.isRecognized({
          properties: { createdTimeUtc: "2026-09-12T13:15:30Z", title: "x" },
        }),
      ).toBe(true);
      expect(
        MicrosoftSentinelNormalizer.isRecognized({
          properties: {
            createdTimeUtc: "2026-09-12T13:15:30Z",
            incidentNumber: 7,
          },
        }),
      ).toBe(true);
    });

    test("rejects error envelopes, empty objects and non-objects", () => {
      expect(MicrosoftSentinelNormalizer.isRecognized({})).toBe(false);
      expect(
        MicrosoftSentinelNormalizer.isRecognized({
          error: { code: "AuthorizationFailed", message: "no" },
        }),
      ).toBe(false);
      expect(
        MicrosoftSentinelNormalizer.isRecognized({
          properties: { title: "no created time" },
        }),
      ).toBe(false);
      expect(
        MicrosoftSentinelNormalizer.isRecognized({
          properties: { createdTimeUtc: "2026-09-12T13:15:30Z" },
        }),
      ).toBe(false);
      expect(
        MicrosoftSentinelNormalizer.isRecognized({ properties: "string" }),
      ).toBe(false);
      expect(
        MicrosoftSentinelNormalizer.isRecognized(null as unknown as JSONObject),
      ).toBe(false);
      expect(
        MicrosoftSentinelNormalizer.isRecognized([
          sampleIncident(),
        ] as unknown as JSONObject),
      ).toBe(false);
    });
  });

  describe("normalize", () => {
    test("maps the reference sample to an OCSF Incident Finding", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftSentinelNormalizer.normalize(sampleIncident());

      expect(event.classUid).toBe(2005);
      expect(event.classUid).toBe(MICROSOFT_SENTINEL_INCIDENT_CLASS_UID);
      expect(event.className).toBe("Incident Finding");
      expect(event.className).toBe(MICROSOFT_SENTINEL_INCIDENT_CLASS_NAME);
      expect(event.categoryUid).toBe(2);
      expect(event.categoryName).toBe("Findings");
      expect(event.activityName).toBe("Create");

      expect(event.eventUid).toBe("73e01a99-5cd7-4139-a149-9f2736ff2ab5");
      expect(event.time.toISOString()).toBe("2019-01-01T13:15:30.000Z");

      expect(event.severityName).toBe(OcsfSeverity.High);
      expect(event.severityId).toBe(4);
      expect(event.statusName).toBe("Closed");
      expect(event.message).toBe("My incident");
      expect(event.ruleName).toBe("My incident");
      expect(event.ruleId).toBe("fab3d2d4-747f-46a7-8ef0-9c0be8112bf7");

      expect(event.vendorName).toBe(definition.vendorName);
      expect(event.productName).toBe(definition.productName);
      expect(event.vendorName).toBe("Microsoft");
      expect(event.productName).toBe("Microsoft Sentinel");

      expect(event.mitreTactics).toEqual(["TA0003"]);
      expect(event.mitreTechniques).toEqual([]);

      expect(event.principalUser).toBe("john@contoso.com");
      expect(event.principalHost).toBe("");
      expect(event.principalIp).toBe("");
      expect(event.targetUser).toBe("");
      expect(event.targetPort).toBe(0);
      expect(event.targetResource).toBe(
        String((sampleIncident()["properties"] as JSONObject)["incidentUrl"]),
      );

      expect(event.observables).toEqual([
        "john@contoso.com",
        "john.doe@contoso.com",
        "2046feea-040d-4a46-9e2b-91c2941bfa70",
      ]);
    });

    test("flattens the whole payload into string attributes", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftSentinelNormalizer.normalize(sampleIncident());

      expect(event.attributes["name"]).toBe(
        "73e01a99-5cd7-4139-a149-9f2736ff2ab5",
      );
      expect(event.attributes["properties.createdTimeUtc"]).toBe(
        "2019-01-01T13:15:30Z",
      );
      expect(event.attributes["properties.firstActivityTimeUtc"]).toBe(
        "2019-01-01T13:00:30Z",
      );
      expect(event.attributes["properties.incidentNumber"]).toBe("3177");
      expect(event.attributes["properties.classification"]).toBe(
        "FalsePositive",
      );
      expect(event.attributes["properties.classificationReason"]).toBe(
        "IncorrectAlertLogic",
      );
      expect(event.attributes["properties.additionalData.commentsCount"]).toBe(
        "3",
      );
      expect(event.attributes["properties.additionalData.tactics"]).toBe(
        "Persistence",
      );
      expect(event.attributes["properties.owner.assignedTo"]).toBe("john doe");
      expect(event.attributes["properties.relatedAnalyticRuleIds"]).toContain(
        "fab3d2d4-747f-46a7-8ef0-9c0be8112bf7",
      );

      for (const value of Object.values(event.attributes)) {
        expect(typeof value).toBe("string");
      }
    });

    test("maps every documented tactic name to its ATT&CK id, keeps unknown names, and dedupes", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftSentinelNormalizer.normalize(richIncident());

      expect(event.mitreTactics).toEqual(["TA0006", "TA0001", "PreAttack"]);

      const all: JSONObject = richIncident();
      ((all["properties"] as JSONObject)["additionalData"] as JSONObject)[
        "tactics"
      ] = [
        "Reconnaissance",
        "ResourceDevelopment",
        "InitialAccess",
        "Execution",
        "Persistence",
        "PrivilegeEscalation",
        "DefenseEvasion",
        "CredentialAccess",
        "Discovery",
        "LateralMovement",
        "Collection",
        "Exfiltration",
        "CommandAndControl",
        "Impact",
        "ImpairProcessControl",
        "InhibitResponseFunction",
      ];
      expect(MicrosoftSentinelNormalizer.normalize(all).mitreTactics).toEqual([
        "TA0043",
        "TA0042",
        "TA0001",
        "TA0002",
        "TA0003",
        "TA0004",
        "TA0005",
        "TA0006",
        "TA0007",
        "TA0008",
        "TA0009",
        "TA0010",
        "TA0011",
        "TA0040",
        "TA0106",
        "TA0107",
      ]);
    });

    test("reads techniques when a payload carries them and leaves them empty otherwise", () => {
      const raw: JSONObject = richIncident();
      ((raw["properties"] as JSONObject)["additionalData"] as JSONObject)[
        "techniques"
      ] = ["T1110", "T1078", "T1110"];

      expect(
        MicrosoftSentinelNormalizer.normalize(raw).mitreTechniques,
      ).toEqual(["T1110", "T1078"]);
      expect(
        MicrosoftSentinelNormalizer.normalize(richIncident()).mitreTechniques,
      ).toEqual([]);
    });

    test("maps the four Sentinel severities and falls back to Unknown", () => {
      const severities: Array<[string, OcsfSeverity, number]> = [
        ["High", OcsfSeverity.High, 4],
        ["Medium", OcsfSeverity.Medium, 3],
        ["Low", OcsfSeverity.Low, 2],
        ["Informational", OcsfSeverity.Informational, 1],
        ["Bogus", OcsfSeverity.Unknown, 0],
        ["", OcsfSeverity.Unknown, 0],
      ];

      for (const [input, name, id] of severities) {
        const raw: JSONObject = sampleIncident();
        (raw["properties"] as JSONObject)["severity"] = input;
        const event: NormalizedSecurityEvent =
          MicrosoftSentinelNormalizer.normalize(raw);
        expect(event.severityName).toBe(name);
        expect(event.severityId).toBe(id);
      }
    });

    test("derives the principal from the owner and the observables from owner identifiers and labels, case-insensitively deduped", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftSentinelNormalizer.normalize(richIncident());

      expect(event.principalUser).toBe("analyst@contoso.com");
      expect(event.observables).toEqual([
        "analyst@contoso.com",
        "9d1c6a7e-2b3f-4c5d-8e9f-0a1b2c3d4e5f",
        "Phishing",
        "Tier1",
      ]);
      expect(event.attributes["properties.labels.0.labelName"]).toBe(
        "Phishing",
      );
      expect(event.attributes["properties.labels.1.labelType"]).toBe(
        "AutoAssigned",
      );
    });

    test("falls back to the owner email when there is no user principal name, and to nothing when unassigned", () => {
      const emailOnly: JSONObject = sampleIncident();
      (emailOnly["properties"] as JSONObject)["owner"] = {
        email: "jane@contoso.com",
        assignedTo: "jane",
      };
      const byEmail: NormalizedSecurityEvent =
        MicrosoftSentinelNormalizer.normalize(emailOnly);
      expect(byEmail.principalUser).toBe("jane@contoso.com");
      expect(byEmail.observables).toEqual(["jane@contoso.com"]);

      const unassigned: JSONObject = sampleIncident();
      delete (unassigned["properties"] as JSONObject)["owner"];
      (unassigned["properties"] as JSONObject)["labels"] = ["Manual", "Manual"];
      const noOwner: NormalizedSecurityEvent =
        MicrosoftSentinelNormalizer.normalize(unassigned);
      expect(noOwner.principalUser).toBe("");
      expect(noOwner.observables).toEqual(["Manual"]);
    });

    test("uses the ARM id's last segment, then a content hash, when the incident has no name", () => {
      const byId: JSONObject = sampleIncident();
      delete byId["name"];
      expect(MicrosoftSentinelNormalizer.normalize(byId).eventUid).toBe(
        "73e01a99-5cd7-4139-a149-9f2736ff2ab5",
      );

      const hashed: JSONObject = sampleIncident();
      delete hashed["name"];
      delete hashed["id"];
      const first: string =
        MicrosoftSentinelNormalizer.normalize(hashed).eventUid;
      const again: string = MicrosoftSentinelNormalizer.normalize(
        JSON.parse(JSON.stringify(hashed)) as JSONObject,
      ).eventUid;
      expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(again).toBe(first);

      const changed: JSONObject = JSON.parse(
        JSON.stringify(hashed),
      ) as JSONObject;
      (changed["properties"] as JSONObject)["title"] = "Different";
      expect(MicrosoftSentinelNormalizer.normalize(changed).eventUid).not.toBe(
        first,
      );
    });

    test("uses creation time as the event time, falling back to last modification and then to now", () => {
      const created: NormalizedSecurityEvent =
        MicrosoftSentinelNormalizer.normalize(richIncident());
      expect(created.time.toISOString()).toBe("2026-09-12T13:15:30.123Z");

      const modifiedOnly: JSONObject = richIncident();
      delete (modifiedOnly["properties"] as JSONObject)["createdTimeUtc"];
      expect(
        MicrosoftSentinelNormalizer.normalize(modifiedOnly).time.toISOString(),
      ).toBe("2026-09-12T14:00:00.000Z");

      const timeless: JSONObject = richIncident();
      delete (timeless["properties"] as JSONObject)["createdTimeUtc"];
      delete (timeless["properties"] as JSONObject)["lastModifiedTimeUtc"];
      const before: number = Date.now();
      const event: NormalizedSecurityEvent =
        MicrosoftSentinelNormalizer.normalize(timeless);
      expect(event.time.getTime()).toBeGreaterThanOrEqual(before);
      expect(event.time.getTime()).toBeLessThanOrEqual(Date.now());
    });

    test("builds a message from the title, then the description, then the incident number", () => {
      const noTitle: JSONObject = richIncident();
      delete (noTitle["properties"] as JSONObject)["title"];
      const byDescription: NormalizedSecurityEvent =
        MicrosoftSentinelNormalizer.normalize(noTitle);
      expect(byDescription.message).toBe("Possible password spray");
      expect(byDescription.ruleName).toBe("");

      const numberOnly: JSONObject = richIncident();
      delete (numberOnly["properties"] as JSONObject)["title"];
      delete (numberOnly["properties"] as JSONObject)["description"];
      expect(MicrosoftSentinelNormalizer.normalize(numberOnly).message).toBe(
        "Microsoft Sentinel incident 4802",
      );

      const bare: JSONObject = {
        name: "x",
        type: "Microsoft.SecurityInsights/incidents",
        properties: { createdTimeUtc: "2026-09-12T13:15:30Z" },
      };
      const event: NormalizedSecurityEvent =
        MicrosoftSentinelNormalizer.normalize(bare);
      expect(event.message).toBe("Microsoft Sentinel incident");
      expect(event.ruleId).toBe("");
      expect(event.statusName).toBe("");
      expect(event.observables).toEqual([]);
    });

    test("does not mutate the raw payload", () => {
      const raw: JSONObject = richIncident();
      const snapshot: string = JSON.stringify(raw);

      MicrosoftSentinelNormalizer.normalize(raw);

      expect(JSON.stringify(raw)).toBe(snapshot);
    });
  });
});
