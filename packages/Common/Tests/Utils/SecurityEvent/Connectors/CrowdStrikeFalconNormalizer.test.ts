import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import CrowdStrikeFalconNormalizer from "../../../../Utils/SecurityEvent/Connectors/CrowdStrikeFalconNormalizer";
import { contentHashEventUid } from "../../../../Utils/SecurityEvent/NormalizerHelpers";

/*
 * A Falcon alert is only useful in the SIEM if it stays joinable to the
 * host, user and file it fired on, keeps its MITRE tactic/technique, and
 * is dated by the time Falcon CREATED it (the poll window's basis) rather
 * than the behaviour time. Nothing errors when any of that mining silently
 * stops working — the finding row just becomes an island — so the typed
 * columns are pinned here against a payload shaped like Falcon's own
 * PostEntitiesAlertsV2 resource (the sample in Elastic's crowdstrike.alert
 * data stream).
 */

const DEFINITION: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.CrowdStrikeFalcon,
  )!;

const COMPOSITE_ID: string =
  "92012896127c4a8236ba7601b886b0:ind:2ce412d17b334ad4adc8c1c54dbfec4b:399748687993-5761-42627600";

function buildAlert(overrides?: JSONObject): JSONObject {
  return {
    agent_id: "2ce412d17b334ad4adc8c1c54dbfec4b",
    aggregate_id:
      "aggind:2ce412d17b334ad4adc8c1c54dbfec4b:399748687993-5761-42627600",
    cid: "92012896127c4a8236ba7601b886b0",
    composite_id: COMPOSITE_ID,
    id: "ind:2ce412d17b334ad4adc8c1c54dbfec4b:399748687993-5761-42627600",
    pattern_id: "5761",
    pattern_disposition: 2048,
    name: "PrewittPupAdwareSensorDetect-Lowest",
    display_name: "PrewittPupAdwareSensorDetect-Lowest",
    description:
      "This file meets the Adware/PUP Anti-malware ML algorithm's lowest-confidence threshold.",
    scenario: "NGAV",
    severity: 21,
    severity_name: "low",
    confidence: 20,
    status: "new",
    show_in_ui: true,
    email_sent: false,
    tactic: "MachineLearning",
    tactic_id: "CSTA0004",
    technique: "Adware/PUP",
    technique_id: "CST0000",
    objective: "Falcon Detection Method",
    created_timestamp: "2023-11-03T18:01:23.995Z",
    timestamp: "2023-11-03T18:00:22.328Z",
    updated_timestamp: "2023-11-03T19:00:23.985Z",
    product: "epp",
    type: "ldt",
    platform: "Windows",
    device: {
      device_id: "2ce412d17b334ad4adc8c1c54dbfec4b",
      hostname: "ABC709-1175",
      local_ip: "10.20.30.40",
      external_ip: "81.2.69.142",
      platform_name: "Windows",
      os_version: "Windows 10",
      machine_domain: "corp.example.com",
    },
    user_name: "mohit.jha",
    user_id: "S-1-5-21-1909377054-3469629671-4104191496-4425",
    filename:
      "openvpn-abc-pfSense-UDP4-1194-pfsense-install-2.6.5-I001-amd64.exe",
    filepath:
      "\\Device\\HarddiskVolume3\\Users\\mohit.jha\\Downloads\\openvpn-abc-pfSense-UDP4-1194-pfsense-install-2.6.5-I001-amd64.exe",
    cmdline:
      '"C:\\Users\\mohit.jha\\Downloads\\openvpn-abc-pfSense-UDP4-1194-pfsense-install-2.6.5-I001-amd64.exe" ',
    sha256: "b26a6791b72753d2317efd5e1363d93fdd33e611c8b9e08a3b24ea4d755b81fd",
    md5: "3a9e1c7e2c1b4f5d6e7f8091a2b3c4d5",
    falcon_host_link:
      "https://falcon.crowdstrike.com/activity-v2/detections/92012896127c4a8236ba7601b886b0:ind:2ce412d17b334ad4adc8c1c54dbfec4b:399748687993-5761-42627600",
    tags: [],
    ...overrides,
  };
}

describe("CrowdStrikeFalconNormalizer", () => {
  describe("attribution", () => {
    test("vendor and product names come from the catalog entry", () => {
      expect(CrowdStrikeFalconNormalizer.vendorName).toBe(
        DEFINITION.vendorName,
      );
      expect(CrowdStrikeFalconNormalizer.productName).toBe(
        DEFINITION.productName,
      );
      expect(DEFINITION.vendorName).toBe("CrowdStrike");
      expect(DEFINITION.productName).toBe("Falcon");

      const event: NormalizedSecurityEvent =
        CrowdStrikeFalconNormalizer.normalize(buildAlert());
      expect(event.vendorName).toBe(DEFINITION.vendorName);
      expect(event.productName).toBe(DEFINITION.productName);
    });
  });

  describe("isRecognized", () => {
    test("accepts an alert with a composite_id", () => {
      expect(CrowdStrikeFalconNormalizer.isRecognized(buildAlert())).toBe(true);
      expect(
        CrowdStrikeFalconNormalizer.isRecognized({
          composite_id: COMPOSITE_ID,
        }),
      ).toBe(true);
    });

    test("accepts an older shape with id plus an alert marker", () => {
      expect(
        CrowdStrikeFalconNormalizer.isRecognized({
          id: "ldt:abc:123",
          created_timestamp: "2023-11-03T18:01:23.995Z",
        }),
      ).toBe(true);
      expect(
        CrowdStrikeFalconNormalizer.isRecognized({
          id: "ldt:abc:123",
          severity_name: "high",
        }),
      ).toBe(true);
      expect(
        CrowdStrikeFalconNormalizer.isRecognized({
          id: "ldt:abc:123",
          tactic: "Execution",
        }),
      ).toBe(true);
      expect(
        CrowdStrikeFalconNormalizer.isRecognized({
          id: "ldt:abc:123",
          pattern_id: "5761",
        }),
      ).toBe(true);
    });

    test("rejects payloads that are not alerts", () => {
      expect(CrowdStrikeFalconNormalizer.isRecognized({})).toBe(false);
      expect(CrowdStrikeFalconNormalizer.isRecognized({ id: "x" })).toBe(false);
      expect(
        CrowdStrikeFalconNormalizer.isRecognized({
          severity_name: "high",
          name: "no id at all",
        }),
      ).toBe(false);
      expect(
        CrowdStrikeFalconNormalizer.isRecognized(null as unknown as JSONObject),
      ).toBe(false);
      expect(
        CrowdStrikeFalconNormalizer.isRecognized([] as unknown as JSONObject),
      ).toBe(false);
    });
  });

  describe("normalize: full alert", () => {
    const event: NormalizedSecurityEvent =
      CrowdStrikeFalconNormalizer.normalize(buildAlert());

    test("frames the alert as an OCSF Detection Finding", () => {
      expect(event.classUid).toBe(2004);
      expect(event.className).toBe("Detection Finding");
      expect(event.categoryUid).toBe(2);
      expect(event.categoryName).toBe("Findings");
      expect(event.activityName).toBe("Create");
    });

    test("uses composite_id as the stable event uid", () => {
      expect(event.eventUid).toBe(COMPOSITE_ID);
    });

    test("dates the finding by created_timestamp, not the behaviour timestamp", () => {
      expect(event.time.toISOString()).toBe("2023-11-03T18:01:23.995Z");
    });

    test("takes severity from severity_name with the matching id", () => {
      expect(event.severityName).toBe(OcsfSeverity.Low);
      expect(event.severityId).toBe(OcsfSeverityId[OcsfSeverity.Low]);
    });

    test("carries the Falcon status as the status name", () => {
      expect(event.statusName).toBe("new");
    });

    test("lifts rule provenance and MITRE references", () => {
      expect(event.ruleId).toBe("5761");
      expect(event.ruleName).toBe("PrewittPupAdwareSensorDetect-Lowest");
      expect(event.mitreTactics).toEqual(["CSTA0004"]);
      expect(event.mitreTechniques).toEqual(["CST0000"]);
    });

    test("uses the description as the message", () => {
      expect(event.message).toBe(
        "This file meets the Adware/PUP Anti-malware ML algorithm's lowest-confidence threshold.",
      );
    });

    test("maps the device and user onto the principal columns", () => {
      expect(event.principalHost).toBe("ABC709-1175");
      expect(event.principalIp).toBe("10.20.30.40");
      expect(event.principalUser).toBe("mohit.jha");
      expect(event.principalProcess).toBe(
        "openvpn-abc-pfSense-UDP4-1194-pfsense-install-2.6.5-I001-amd64.exe",
      );
      expect(event.targetUser).toBe("");
      expect(event.targetHost).toBe("");
      expect(event.targetIp).toBe("");
      expect(event.targetPort).toBe(0);
      expect(event.targetResource).toBe("");
    });

    test("collects hostname, both ips, user and sha256 as observables in a stable order", () => {
      expect(event.observables).toEqual([
        "ABC709-1175",
        "10.20.30.40",
        "81.2.69.142",
        "mohit.jha",
        "b26a6791b72753d2317efd5e1363d93fdd33e611c8b9e08a3b24ea4d755b81fd",
      ]);
    });

    test("flattens the payload into dot-notation attributes with string values", () => {
      expect(event.attributes["device.hostname"]).toBe("ABC709-1175");
      expect(event.attributes["device.platform_name"]).toBe("Windows");
      expect(event.attributes["severity"]).toBe("21");
      expect(event.attributes["show_in_ui"]).toBe("true");
      expect(event.attributes["timestamp"]).toBe("2023-11-03T18:00:22.328Z");
      expect(event.attributes["falcon_host_link"]).toContain(
        "falcon.crowdstrike.com",
      );
      expect(event.attributes["tags"]).toBeUndefined();

      for (const value of Object.values(event.attributes)) {
        expect(typeof value).toBe("string");
      }
    });
  });

  describe("normalize: severity", () => {
    test.each<[string, OcsfSeverity]>([
      ["informational", OcsfSeverity.Informational],
      ["low", OcsfSeverity.Low],
      ["medium", OcsfSeverity.Medium],
      ["high", OcsfSeverity.High],
      ["critical", OcsfSeverity.Critical],
      ["Critical", OcsfSeverity.Critical],
    ])(
      "severity_name %s -> %s",
      (severityName: string, expected: OcsfSeverity) => {
        const event: NormalizedSecurityEvent =
          CrowdStrikeFalconNormalizer.normalize(
            buildAlert({ severity_name: severityName, severity: 0 }),
          );
        expect(event.severityName).toBe(expected);
        expect(event.severityId).toBe(OcsfSeverityId[expected]);
      },
    );

    test.each<[number, OcsfSeverity]>([
      [0, OcsfSeverity.Informational],
      [19, OcsfSeverity.Informational],
      [20, OcsfSeverity.Low],
      [39, OcsfSeverity.Low],
      [40, OcsfSeverity.Medium],
      [59, OcsfSeverity.Medium],
      [60, OcsfSeverity.High],
      [79, OcsfSeverity.High],
      [80, OcsfSeverity.Critical],
      [100, OcsfSeverity.Critical],
    ])(
      "numeric severity %i falls back to %s when severity_name is absent",
      (severity: number, expected: OcsfSeverity) => {
        const alert: JSONObject = buildAlert({ severity });
        delete alert["severity_name"];

        expect(CrowdStrikeFalconNormalizer.normalize(alert).severityName).toBe(
          expected,
        );
      },
    );

    test("severity_name wins over a contradicting numeric severity", () => {
      const event: NormalizedSecurityEvent =
        CrowdStrikeFalconNormalizer.normalize(
          buildAlert({ severity_name: "critical", severity: 5 }),
        );
      expect(event.severityName).toBe(OcsfSeverity.Critical);
    });

    test("is Unknown when neither a name nor a number is present", () => {
      const alert: JSONObject = buildAlert();
      delete alert["severity_name"];
      delete alert["severity"];

      const event: NormalizedSecurityEvent =
        CrowdStrikeFalconNormalizer.normalize(alert);
      expect(event.severityName).toBe(OcsfSeverity.Unknown);
      expect(event.severityId).toBe(0);
    });
  });

  describe("normalize: time", () => {
    test("falls back to timestamp, then updated_timestamp, when created_timestamp is absent", () => {
      const noCreated: JSONObject = buildAlert();
      delete noCreated["created_timestamp"];
      expect(
        CrowdStrikeFalconNormalizer.normalize(noCreated).time.toISOString(),
      ).toBe("2023-11-03T18:00:22.328Z");

      delete noCreated["timestamp"];
      expect(
        CrowdStrikeFalconNormalizer.normalize(noCreated).time.toISOString(),
      ).toBe("2023-11-03T19:00:23.985Z");
    });

    test("falls back to now when no timestamp parses", () => {
      const before: number = Date.now();
      const event: NormalizedSecurityEvent =
        CrowdStrikeFalconNormalizer.normalize(
          buildAlert({
            created_timestamp: "not a date",
            timestamp: "",
            updated_timestamp: null,
          }),
        );

      expect(event.time.getTime()).toBeGreaterThanOrEqual(before);
      expect(event.time.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("normalize: fallbacks", () => {
    test("uses id, then a content hash, when composite_id is absent", () => {
      const withId: JSONObject = buildAlert();
      delete withId["composite_id"];
      expect(CrowdStrikeFalconNormalizer.normalize(withId).eventUid).toBe(
        "ind:2ce412d17b334ad4adc8c1c54dbfec4b:399748687993-5761-42627600",
      );

      const idless: JSONObject = buildAlert();
      delete idless["composite_id"];
      delete idless["id"];
      const event: NormalizedSecurityEvent =
        CrowdStrikeFalconNormalizer.normalize(idless);
      expect(event.eventUid).toBe(contentHashEventUid(idless));
      expect(event.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
      // The hash is stable across deliveries of the same payload.
      expect(
        CrowdStrikeFalconNormalizer.normalize(
          JSON.parse(JSON.stringify(idless)),
        ).eventUid,
      ).toBe(event.eventUid);
    });

    test("prefers display_name over name for the rule name and message fallback", () => {
      const event: NormalizedSecurityEvent =
        CrowdStrikeFalconNormalizer.normalize(
          buildAlert({
            display_name: "Credential dumping via LSASS access",
            name: "LsassAccess",
            description: "",
          }),
        );
      expect(event.ruleName).toBe("Credential dumping via LSASS access");
      expect(event.message).toBe("Credential dumping via LSASS access");

      const nameOnly: NormalizedSecurityEvent =
        CrowdStrikeFalconNormalizer.normalize(
          buildAlert({
            display_name: "",
            name: "LsassAccess",
            description: "",
          }),
        );
      expect(nameOnly.ruleName).toBe("LsassAccess");
      expect(nameOnly.message).toBe("LsassAccess");
    });

    test("falls back to a generic message when there is no description or name", () => {
      const event: NormalizedSecurityEvent =
        CrowdStrikeFalconNormalizer.normalize(
          buildAlert({ display_name: "", name: "", description: "" }),
        );
      expect(event.message).toBe("CrowdStrike Falcon alert");
    });

    test("falls back to cmdline for the principal process when filename is absent", () => {
      const alert: JSONObject = buildAlert({ filename: "" });
      expect(
        CrowdStrikeFalconNormalizer.normalize(alert).principalProcess,
      ).toBe(
        '"C:\\Users\\mohit.jha\\Downloads\\openvpn-abc-pfSense-UDP4-1194-pfsense-install-2.6.5-I001-amd64.exe" ',
      );
    });

    test("leaves MITRE arrays empty and columns blank when the alert carries no such data", () => {
      const event: NormalizedSecurityEvent =
        CrowdStrikeFalconNormalizer.normalize({
          composite_id: COMPOSITE_ID,
          created_timestamp: "2023-11-03T18:01:23.995Z",
        });

      expect(event.mitreTactics).toEqual([]);
      expect(event.mitreTechniques).toEqual([]);
      expect(event.principalHost).toBe("");
      expect(event.principalIp).toBe("");
      expect(event.principalUser).toBe("");
      expect(event.principalProcess).toBe("");
      expect(event.observables).toEqual([]);
      expect(event.statusName).toBe("");
      expect(event.ruleId).toBe("");
      expect(event.ruleName).toBe("");
    });

    test("dedupes observables case-insensitively when the local and external ip match", () => {
      const event: NormalizedSecurityEvent =
        CrowdStrikeFalconNormalizer.normalize(
          buildAlert({
            device: {
              hostname: "abc709-1175",
              local_ip: "81.2.69.142",
              external_ip: "81.2.69.142",
            },
            user_name: "ABC709-1175",
          }),
        );

      expect(event.observables).toEqual([
        "abc709-1175",
        "81.2.69.142",
        "b26a6791b72753d2317efd5e1363d93fdd33e611c8b9e08a3b24ea4d755b81fd",
      ]);
    });

    test("an identity or cloud alert without a device still normalizes", () => {
      const event: NormalizedSecurityEvent =
        CrowdStrikeFalconNormalizer.normalize({
          composite_id:
            "92012896127c4a8236ba7601b886b0:idp:4c3f5a2b-0d6e-4b1a-9f2c-7e8d9a0b1c2d",
          id: "idp:4c3f5a2b-0d6e-4b1a-9f2c-7e8d9a0b1c2d",
          display_name: "Unusual access to a privileged account",
          description:
            "A user accessed a privileged account from a new location.",
          severity: 70,
          severity_name: "high",
          status: "in_progress",
          tactic: "Credential Access",
          tactic_id: "TA0006",
          technique: "Valid Accounts",
          technique_id: "T1078",
          created_timestamp: "2026-09-12T08:15:00.000Z",
          timestamp: "2026-09-12T08:14:59.000Z",
          product: "idp",
          type: "idp-user-endpoint-activity",
          user_name: "alice@corp.example.com",
          source_account_name: "alice",
        });

      expect(event.severityName).toBe(OcsfSeverity.High);
      expect(event.statusName).toBe("in_progress");
      expect(event.mitreTactics).toEqual(["TA0006"]);
      expect(event.mitreTechniques).toEqual(["T1078"]);
      expect(event.principalUser).toBe("alice@corp.example.com");
      expect(event.principalHost).toBe("");
      expect(event.observables).toEqual(["alice@corp.example.com"]);
      expect(event.attributes["product"]).toBe("idp");
    });
  });
});
