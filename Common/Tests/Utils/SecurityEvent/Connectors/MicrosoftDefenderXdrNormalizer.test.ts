import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../../Types/SecurityEvent/OcsfEventClass";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import MicrosoftDefenderXdrNormalizer from "../../../../Utils/SecurityEvent/Connectors/MicrosoftDefenderXdrNormalizer";
import { contentHashEventUid } from "../../../../Utils/SecurityEvent/NormalizerHelpers";

/*
 * A Defender alert is only useful in the SIEM if it stays joinable to the
 * device, user, IP and file it fired on; Graph puts all of that in
 * evidence[] typed by @odata.type, so the mining of evidence into the
 * principal/target columns and the observables array is what these tests
 * protect. Fixtures follow the vendor's own List alerts_v2 example
 * (https://learn.microsoft.com/en-us/graph/api/security-list-alerts_v2)
 * and the evidence resource pages.
 */

const DEFINITION: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.MicrosoftDefenderXdr,
  )!;

// The vendor's Example 1 response, trimmed to what the normalizer reads.
function vendorSampleAlert(): JSONObject {
  return {
    "@odata.type": "#microsoft.graph.security.alert",
    id: "da637551227677560813_-961444813",
    providerAlertId: "da637551227677560813_-961444813",
    incidentId: "28282",
    status: "new",
    severity: "low",
    classification: "unknown",
    determination: "unknown",
    serviceSource: "microsoftDefenderForEndpoint",
    detectionSource: "antivirus",
    detectorId: "e0da400f-affd-43ef-b1d5-afc2eb6f2756",
    tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
    title: "Suspicious execution of hidden file",
    description:
      "A hidden file has been launched. This activity could indicate a compromised host.",
    recommendedActions: "Collect artifacts and determine scope",
    category: "DefenseEvasion",
    assignedTo: null,
    alertWebUrl:
      "https://security.microsoft.com/alerts/da637551227677560813_-961444813?tid=b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
    incidentWebUrl:
      "https://security.microsoft.com/incidents/28282?tid=b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
    actorDisplayName: null,
    threatDisplayName: null,
    threatFamilyName: null,
    mitreTechniques: ["T1564.001"],
    createdDateTime: "2021-04-27T12:19:27.7211305Z",
    lastUpdateDateTime: "2021-05-02T14:19:01.3266667Z",
    resolvedDateTime: null,
    firstActivityDateTime: "2021-04-26T07:45:50.116Z",
    lastActivityDateTime: "2021-05-02T07:56:58.222Z",
    comments: [],
    evidence: [
      {
        "@odata.type": "#microsoft.graph.security.deviceEvidence",
        createdDateTime: "2021-04-27T12:19:27.7211305Z",
        verdict: "unknown",
        remediationStatus: "none",
        remediationStatusDetails: null,
        firstSeenDateTime: "2020-09-12T07:28:32.4321753Z",
        mdeDeviceId: "73e7e2de709dff64ef64b1d0c30e67fab63279db",
        azureAdDeviceId: null,
        deviceDnsName: "yonif-lap3.middleeast.corp.microsoft.com",
        hostName: "yonif-lap3",
        ntDomain: null,
        dnsDomain: "middleeast.corp.microsoft.com",
        osPlatform: "Windows10",
        osBuild: 22424,
        version: "Other",
        healthStatus: "active",
        riskScore: "medium",
        rbacGroupId: 75,
        rbacGroupName: "UnassignedGroup",
        onboardingStatus: "onboarded",
        defenderAvStatus: "unknown",
        ipInterfaces: ["1.1.1.1"],
        loggedOnUsers: [],
        roles: ["compromised"],
        detailedRoles: ["Main device"],
        tags: ["Test Machine"],
        vmMetadata: {
          vmId: "ca1b0d41-5a3b-4d95-b48b-f220aed11d78",
          cloudProvider: "azure",
          resourceId:
            "/subscriptions/8700d3a3-3bb7-4fbe-a090-488a1ad04161/resourceGroups/WdatpApi-EUS-STG/providers/Microsoft.Compute/virtualMachines/NirLaviTests",
          subscriptionId: "8700d3a3-3bb7-4fbe-a090-488a1ad04161",
        },
      },
      {
        "@odata.type": "#microsoft.graph.security.fileEvidence",
        createdDateTime: "2021-04-27T12:19:27.7211305Z",
        verdict: "unknown",
        remediationStatus: "none",
        remediationStatusDetails: null,
        detectionStatus: "detected",
        mdeDeviceId: "73e7e2de709dff64ef64b1d0c30e67fab63279db",
        roles: [],
        detailedRoles: ["Referred in command line"],
        tags: [],
        fileDetails: {
          sha1: "5f1e8acedc065031aad553b710838eb366cfee9a",
          sha256:
            "8963a19fb992ad9a76576c5638fd68292cffb9aaac29eb8285f9abf6196a7dec",
          fileName: "MsSense.exe",
          filePath: "C:\\Program Files\\temp",
          fileSize: 6136392,
          filePublisher: "Microsoft Corporation",
          signer: null,
          issuer: null,
        },
      },
      {
        "@odata.type": "#microsoft.graph.security.processEvidence",
        createdDateTime: "2021-04-27T12:19:27.7211305Z",
        verdict: "unknown",
        remediationStatus: "none",
        remediationStatusDetails: null,
        processId: 4780,
        parentProcessId: 668,
        processCommandLine: '"MsSense.exe"',
        processCreationDateTime: "2021-08-12T12:43:19.0772577Z",
        parentProcessCreationDateTime: "2021-08-12T07:39:09.0909239Z",
        detectionStatus: "detected",
        mdeDeviceId: "73e7e2de709dff64ef64b1d0c30e67fab63279db",
        roles: [],
        detailedRoles: [],
        tags: [],
        imageFile: {
          sha1: "5f1e8acedc065031aad553b710838eb366cfee9a",
          sha256:
            "8963a19fb992ad9a76576c5638fd68292cffb9aaac29eb8285f9abf6196a7dec",
          fileName: "MsSense.exe",
          filePath: "C:\\Program Files\\temp",
          fileSize: 6136392,
          filePublisher: "Microsoft Corporation",
          signer: null,
          issuer: null,
        },
        parentProcessImageFile: {
          sha1: null,
          sha256: null,
          fileName: "services.exe",
          filePath: "C:\\Windows\\System32",
          fileSize: 731744,
          filePublisher: "Microsoft Corporation",
          signer: null,
          issuer: null,
        },
        userAccount: {
          accountName: "SYSTEM",
          domainName: "NT AUTHORITY",
          userSid: "S-1-5-18",
          azureAdUserId: null,
          userPrincipalName: null,
          displayName: "System",
        },
      },
      {
        "@odata.type": "#microsoft.graph.security.registryKeyEvidence",
        createdDateTime: "2021-04-27T12:19:27.7211305Z",
        verdict: "unknown",
        remediationStatus: "none",
        remediationStatusDetails: null,
        registryKey:
          "SYSTEM\\CONTROLSET001\\CONTROL\\WMI\\AUTOLOGGER\\SENSEAUDITLOGGER",
        registryHive: "HKEY_LOCAL_MACHINE",
        roles: [],
        detailedRoles: [],
        tags: [],
      },
    ],
    systemTags: ["Defender Experts"],
  };
}

/*
 * An identity-style alert: attacker IP signing in with a compromised
 * account from a phishing URL, the scenario the alertEvidence page
 * describes.
 */
function identityAlert(): JSONObject {
  return {
    "@odata.type": "#microsoft.graph.security.alert",
    id: "da637878227677560813_-334257894",
    incidentId: "33",
    status: "inProgress",
    severity: "high",
    classification: "truePositive",
    determination: "compromisedAccount",
    serviceSource: "microsoftDefenderForIdentity",
    detectionSource: "microsoftDefenderForIdentity",
    title: "Suspicious sign-in activity detected",
    description:
      "Multiple failed sign-in attempts followed by a successful sign-in detected from an unusual location.",
    category: "SuspiciousActivity",
    categories: ["InitialAccess", "CredentialAccess", "SuspiciousActivity"],
    mitreTechniques: ["t1110", " T1110 ", "T1078.004"],
    createdDateTime: "2026-05-05T08:30:00.0000000Z",
    firstActivityDateTime: "2026-05-05T07:00:00.000Z",
    lastActivityDateTime: "2026-05-05T08:25:00.000Z",
    evidence: [
      {
        "@odata.type": "#microsoft.graph.security.ipEvidence",
        roles: ["attacker", "source"],
        ipAddress: "203.0.113.7",
        countryLetterCode: "US",
      },
      {
        "@odata.type": "#microsoft.graph.security.ipEvidence",
        roles: ["destination"],
        ipAddress: "10.0.0.5",
      },
      {
        "@odata.type": "#microsoft.graph.security.userEvidence",
        roles: ["compromised"],
        userAccount: {
          accountName: "alice",
          domainName: "CONTOSO",
          userSid: "S-1-5-21-1",
          azureAdUserId: "0a1b2c3d",
          userPrincipalName: "alice@contoso.com",
          displayName: "Alice",
        },
      },
      {
        "@odata.type": "#microsoft.graph.security.userEvidence",
        roles: ["added"],
        userAccount: {
          accountName: "bob",
          domainName: "CONTOSO",
          userPrincipalName: null,
          displayName: "Bob",
        },
      },
      {
        "@odata.type": "#microsoft.graph.security.urlEvidence",
        roles: ["contextual"],
        url: "https://phish.example.net/login",
      },
      {
        "@odata.type": "#microsoft.graph.security.mailboxEvidence",
        roles: ["compromised"],
        displayName: "Alice",
        primaryAddress: "alice.mailbox@contoso.com",
        upn: "alice@contoso.com",
        userAccount: null,
      },
      {
        "@odata.type": "#microsoft.graph.security.cloudApplicationEvidence",
        roles: ["contextual"],
        displayName: "Office 365",
      },
    ],
  };
}

describe("MicrosoftDefenderXdrNormalizer", () => {
  describe("isRecognized", () => {
    test("accepts the vendor's example alert", () => {
      expect(
        MicrosoftDefenderXdrNormalizer.isRecognized(vendorSampleAlert()),
      ).toBe(true);
    });

    test("accepts a re-serialized alert that lost its @odata.type but keeps id, createdDateTime and a title", () => {
      expect(
        MicrosoftDefenderXdrNormalizer.isRecognized({
          id: "abc",
          createdDateTime: "2026-05-05T08:30:00Z",
          title: "Something",
        }),
      ).toBe(true);
      expect(
        MicrosoftDefenderXdrNormalizer.isRecognized({
          id: "abc",
          createdDateTime: "2026-05-05T08:30:00Z",
          serviceSource: "microsoftDefenderForOffice365",
        }),
      ).toBe(true);
    });

    test("rejects records without an id and objects that are not alerts", () => {
      expect(MicrosoftDefenderXdrNormalizer.isRecognized({})).toBe(false);
      expect(
        MicrosoftDefenderXdrNormalizer.isRecognized({
          title: "no id",
          createdDateTime: "2026-05-05T08:30:00Z",
        }),
      ).toBe(false);
      expect(
        MicrosoftDefenderXdrNormalizer.isRecognized({
          id: "abc",
          name: "an incident, not an alert",
        }),
      ).toBe(false);
      expect(
        MicrosoftDefenderXdrNormalizer.isRecognized(
          null as unknown as JSONObject,
        ),
      ).toBe(false);
      expect(
        MicrosoftDefenderXdrNormalizer.isRecognized([
          "x",
        ] as unknown as JSONObject),
      ).toBe(false);
    });
  });

  describe("normalize", () => {
    test("frames the vendor sample as an OCSF Detection Finding attributed to the catalog's vendor and product", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize(vendorSampleAlert());
      const { categoryUid, categoryName } = ocsfCategoryForClassUid(2004);

      expect(event.classUid).toBe(2004);
      expect(event.className).toBe("Detection Finding");
      expect(event.categoryUid).toBe(categoryUid);
      expect(event.categoryName).toBe(categoryName);
      expect(event.activityName).toBe("Create");
      expect(event.vendorName).toBe(DEFINITION.vendorName);
      expect(event.productName).toBe(DEFINITION.productName);
      expect(event.vendorName).toBe("Microsoft");
      expect(event.productName).toBe("Microsoft Defender XDR");
    });

    test("lifts id, title, rule, severity, status and MITRE data off the alert row", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize(vendorSampleAlert());

      expect(event.eventUid).toBe("da637551227677560813_-961444813");
      expect(event.message).toBe("Suspicious execution of hidden file");
      expect(event.ruleName).toBe("Suspicious execution of hidden file");
      expect(event.ruleId).toBe("e0da400f-affd-43ef-b1d5-afc2eb6f2756");
      expect(event.severityName).toBe(OcsfSeverity.Low);
      expect(event.severityId).toBe(2);
      expect(event.statusName).toBe("New");
      expect(event.mitreTechniques).toEqual(["T1564.001"]);
      // category "DefenseEvasion" is the ATT&CK tactic TA0005.
      expect(event.mitreTactics).toEqual(["TA0005"]);
    });

    test("uses firstActivityDateTime as the event time, not the creation time", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize(vendorSampleAlert());

      expect(event.time.toISOString()).toBe("2021-04-26T07:45:50.116Z");
    });

    test("mines device, file and process evidence into the principal columns and observables", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize(vendorSampleAlert());

      expect(event.principalHost).toBe(
        "yonif-lap3.middleeast.corp.microsoft.com",
      );
      expect(event.principalProcess).toBe('"MsSense.exe"');
      expect(event.principalUser).toBe("NT AUTHORITY\\SYSTEM");
      expect(event.principalIp).toBe("");
      expect(event.targetHost).toBe("");
      expect(event.targetUser).toBe("");
      expect(event.targetPort).toBe(0);
      expect(event.targetResource).toBe("");

      for (const expected of [
        "yonif-lap3.middleeast.corp.microsoft.com",
        "yonif-lap3",
        "1.1.1.1",
        "8963a19fb992ad9a76576c5638fd68292cffb9aaac29eb8285f9abf6196a7dec",
        "5f1e8acedc065031aad553b710838eb366cfee9a",
        "MsSense.exe",
        "services.exe",
        "NT AUTHORITY\\SYSTEM",
      ]) {
        expect(event.observables).toContain(expected);
      }

      // Deduplicated: the same hash appears in file and process evidence once.
      expect(
        event.observables.filter((value: string): boolean => {
          return value === "5f1e8acedc065031aad553b710838eb366cfee9a";
        }),
      ).toHaveLength(1);
      expect(event.observables).not.toContain("");
    });

    test("flattens the whole payload into attributes with dot-notation keys", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize(vendorSampleAlert());

      expect(event.attributes["severity"]).toBe("low");
      expect(event.attributes["serviceSource"]).toBe(
        "microsoftDefenderForEndpoint",
      );
      expect(event.attributes["mitreTechniques"]).toBe("T1564.001");
      expect(event.attributes["evidence.0.hostName"]).toBe("yonif-lap3");
      expect(event.attributes["evidence.0.roles"]).toBe("compromised");
      expect(event.attributes["evidence.1.fileDetails.fileName"]).toBe(
        "MsSense.exe",
      );
      expect(event.attributes["evidence.2.userAccount.userSid"]).toBe(
        "S-1-5-18",
      );
      expect(event.attributes["alertWebUrl"]).toBe(
        "https://security.microsoft.com/alerts/da637551227677560813_-961444813?tid=b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
      );
      expect(event.attributes["incidentId"]).toBe("28282");
      expect(event.attributes["systemTags"]).toBe("Defender Experts");
    });

    test("splits evidence by role into principal and target for an identity alert", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize(identityAlert());

      expect(event.principalIp).toBe("203.0.113.7");
      expect(event.targetIp).toBe("10.0.0.5");
      expect(event.principalUser).toBe("alice@contoso.com");
      expect(event.targetUser).toBe("CONTOSO\\bob");
      expect(event.principalHost).toBe("");
      expect(event.targetResource).toBe("https://phish.example.net/login");

      for (const expected of [
        "203.0.113.7",
        "10.0.0.5",
        "alice@contoso.com",
        "alice",
        "CONTOSO\\bob",
        "bob",
        "https://phish.example.net/login",
        "alice.mailbox@contoso.com",
        "Office 365",
      ]) {
        expect(event.observables).toContain(expected);
      }
    });

    test("maps categories to ATT&CK tactic ids, ignores non-tactic categories, and dedupes techniques", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize(identityAlert());

      expect(event.mitreTactics).toEqual(["TA0001", "TA0006"]);
      expect(event.mitreTechniques).toEqual(["T1110", "T1078.004"]);
    });

    test("maps every documented alertSeverity value and refuses to guess an unknown one", () => {
      const cases: Array<[string, OcsfSeverity, number]> = [
        ["informational", OcsfSeverity.Informational, 1],
        ["low", OcsfSeverity.Low, 2],
        ["medium", OcsfSeverity.Medium, 3],
        ["high", OcsfSeverity.High, 4],
        ["unknown", OcsfSeverity.Unknown, 0],
        ["unknownFutureValue", OcsfSeverity.Unknown, 0],
        ["", OcsfSeverity.Unknown, 0],
      ];

      for (const [input, name, id] of cases) {
        const event: NormalizedSecurityEvent =
          MicrosoftDefenderXdrNormalizer.normalize({
            ...vendorSampleAlert(),
            severity: input,
          });

        expect(event.severityName).toBe(name);
        expect(event.severityId).toBe(id);
      }
    });

    test("maps every documented alertStatus value and leaves the rest empty", () => {
      const cases: Array<[string, string]> = [
        ["new", "New"],
        ["inProgress", "In Progress"],
        ["resolved", "Resolved"],
        ["unknown", "Unknown"],
        ["unknownFutureValue", ""],
        ["", ""],
      ];

      for (const [input, expected] of cases) {
        const event: NormalizedSecurityEvent =
          MicrosoftDefenderXdrNormalizer.normalize({
            ...vendorSampleAlert(),
            status: input,
          });

        expect(event.statusName).toBe(expected);
      }
    });

    test("falls back to createdDateTime when there is no activity time, and to now when there is neither", () => {
      const created: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize({
          ...vendorSampleAlert(),
          firstActivityDateTime: null,
        });
      expect(created.time.toISOString()).toBe("2021-04-27T12:19:27.721Z");

      const unparseable: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize({
          ...vendorSampleAlert(),
          firstActivityDateTime: "not a date",
        });
      expect(unparseable.time.toISOString()).toBe("2021-04-27T12:19:27.721Z");

      const before: number = Date.now();
      const none: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize({
          ...vendorSampleAlert(),
          firstActivityDateTime: null,
          createdDateTime: null,
        });
      expect(none.time.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(none.time.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    test("derives a stable content hash uid when the alert carries no id", () => {
      const payload: JSONObject = { ...vendorSampleAlert(), id: "" };

      const first: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize(payload);
      const second: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize({ ...payload });

      expect(first.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(first.eventUid).toBe(contentHashEventUid(payload));
      expect(second.eventUid).toBe(first.eventUid);
    });

    test("falls back to the description, then a fixed label, when the alert has no title", () => {
      expect(
        MicrosoftDefenderXdrNormalizer.normalize({
          ...vendorSampleAlert(),
          title: "",
        }).message,
      ).toBe(
        "A hidden file has been launched. This activity could indicate a compromised host.",
      );
      expect(
        MicrosoftDefenderXdrNormalizer.normalize({
          ...vendorSampleAlert(),
          title: "",
          description: null,
        }).message,
      ).toBe("Microsoft Defender XDR alert");
    });

    test("uses alertPolicyId as the rule id when there is no detectorId", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize({
          ...vendorSampleAlert(),
          detectorId: null,
          alertPolicyId: "policy-42",
        });

      expect(event.ruleId).toBe("policy-42");
    });

    test("prefers the first entity of a kind when no evidence carries an actor role", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize({
          ...vendorSampleAlert(),
          evidence: [
            {
              "@odata.type": "#microsoft.graph.security.deviceEvidence",
              roles: ["contextual"],
              hostName: "first-host",
            },
            {
              "@odata.type": "#microsoft.graph.security.deviceEvidence",
              roles: ["attacked"],
              hostName: "second-host",
            },
          ],
        });

      expect(event.principalHost).toBe("first-host");
      expect(event.targetHost).toBe("second-host");
    });

    test("still harvests identifiers from evidence types it does not model", () => {
      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize({
          ...vendorSampleAlert(),
          evidence: [
            {
              "@odata.type": "#microsoft.graph.security.nicEvidence",
              roles: [],
              ipAddress: "192.0.2.9",
            },
            {
              "@odata.type": "#microsoft.graph.security.dnsEvidence",
              roles: [],
              domainName: "c2.example.org",
            },
            {
              "@odata.type": "#microsoft.graph.security.azureResourceEvidence",
              roles: [],
              resourceId: "/subscriptions/1/resourceGroups/rg/vm",
              resourceName: "vm",
            },
          ],
        });

      expect(event.observables).toContain("192.0.2.9");
      expect(event.observables).toContain("c2.example.org");
      expect(event.observables).toContain(
        "/subscriptions/1/resourceGroups/rg/vm",
      );
      expect(event.targetResource).toBe(
        "/subscriptions/1/resourceGroups/rg/vm",
      );
      // An unmodeled evidence item never becomes the actor IP.
      expect(event.principalIp).toBe("");
    });

    test("tolerates junk evidence entries and a missing evidence array", () => {
      expect(() => {
        MicrosoftDefenderXdrNormalizer.normalize({
          ...vendorSampleAlert(),
          evidence: [null, "text", 42, { "@odata.type": 7 }],
        });
      }).not.toThrow();

      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize({
          ...vendorSampleAlert(),
          evidence: undefined,
        });
      expect(event.observables).toEqual([]);
      expect(event.principalHost).toBe("");
    });

    test("bounds the evidence it reads and the observables it stores so one alert cannot bloat a row", () => {
      const evidence: Array<JSONObject> = [];

      for (let index: number = 0; index < 400; index++) {
        evidence.push({
          "@odata.type": "#microsoft.graph.security.ipEvidence",
          roles: [],
          ipAddress: `10.${Math.floor(index / 256)}.${index % 256}.1`,
        });
      }

      const event: NormalizedSecurityEvent =
        MicrosoftDefenderXdrNormalizer.normalize({
          ...vendorSampleAlert(),
          evidence,
        });

      expect(event.observables.length).toBeLessThanOrEqual(200);
      expect(event.observables).toContain("10.0.99.1");
      expect(event.observables).not.toContain("10.0.150.1");
    });
  });

  describe("isomorphism", () => {
    test("imports nothing from the server tree", () => {
      const source: string = fs.readFileSync(
        path.join(
          __dirname,
          "../../../../Utils/SecurityEvent/Connectors/MicrosoftDefenderXdrNormalizer.ts",
        ),
        "utf8",
      );
      const imports: Array<string> = source.match(/from "([^"]+)"/g) || [];

      expect(imports.length).toBeGreaterThan(0);

      for (const line of imports) {
        expect(line).not.toContain("/Server/");
        expect(line).not.toMatch(/from "[a-z@]/);
      }
    });
  });
});
