import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import GoogleSecOpsAlertNormalizer from "../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";

/*
 * A Chronicle detection alert is only useful in the SIEM if it stays
 * joinable to the hosts/users it fired on — that linkage comes entirely
 * from mining the matched UDM sample events in collectionElements into the
 * observables column and inheriting the first sample's principal/target
 * columns. Nothing errors if that mining silently stops working; the
 * finding row just becomes an island. These tests pin the mining, the
 * Detection Finding (2004) framing, the rule/severity lift from the
 * `detection` entry, and the MAX_SAMPLE_EVENTS cap that keeps a detection
 * with hundreds of matches from bloating one row.
 */
describe("GoogleSecOpsAlertNormalizer", () => {
  function buildDetectionPayload(): JSONObject {
    return {
      id: "de_12345",
      type: "RULE_DETECTION",
      detectionTime: "2024-05-01T12:00:00Z",
      detection: [
        {
          ruleName: "Brute Force Login",
          ruleId: "ru_abc123",
          ruleVersionId: "ru_abc123@v1",
          severity: "HIGH",
          description: "Multiple failed logins followed by a success",
          alertState: "ALERTING",
        },
      ],
      collectionElements: [
        {
          label: "e",
          references: [
            {
              event: {
                metadata: { event_type: "USER_LOGIN" },
                principal: {
                  user: { userid: "alice" },
                  hostname: "workstation-1",
                  ip: ["10.0.0.1"],
                },
                target: { hostname: "server-1" },
              },
            },
            {
              event: {
                metadata: { event_type: "USER_LOGIN" },
                principal: { user: { userid: "bob" }, ip: ["10.0.0.2"] },
              },
            },
          ],
        },
      ],
    };
  }

  describe("isGoogleSecOpsAlert", () => {
    test("detects each of the alert markers", () => {
      expect(
        GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert(
          buildDetectionPayload(),
        ),
      ).toBe(true);
      expect(
        GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert({
          detection: [{ ruleName: "r" }],
        }),
      ).toBe(true);
      expect(
        GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert({
          type: "RULE_DETECTION",
        }),
      ).toBe(true);
      expect(
        GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert({
          collectionElements: [{}],
        }),
      ).toBe(true);
      expect(
        GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert({
          collection_elements: [{}],
        }),
      ).toBe(true);
    });

    test("rejects unrelated payloads", () => {
      expect(GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert({})).toBe(false);
      expect(
        GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert({
          message: "hello",
          type: "audit",
        }),
      ).toBe(false);
    });
  });

  describe("normalize: detection stream payload", () => {
    const result: NormalizedSecurityEvent =
      GoogleSecOpsAlertNormalizer.normalize(buildDetectionPayload());

    test("always a Detection Finding (2004) under Findings", () => {
      expect(result.classUid).toBe(2004);
      expect(result.className).toBe("Detection Finding");
      expect(result.categoryUid).toBe(2);
      expect(result.categoryName).toBe("Findings");
      expect(result.activityName).toBe("Create");
    });

    test("rule provenance lifts from the detection entry", () => {
      expect(result.ruleId).toBe("ru_abc123");
      expect(result.ruleName).toBe("Brute Force Login");
    });

    test("detection severity normalizes", () => {
      expect(result.severityName).toBe(OcsfSeverity.High);
      expect(result.severityId).toBe(4);
    });

    test("vendor/product are fixed to Google SecOps", () => {
      expect(result.vendorName).toBe("Google");
      expect(result.productName).toBe("Google SecOps");
    });

    test("time comes from detectionTime, uid from id", () => {
      expect(result.time.getTime()).toBe(1714564800000);
      expect(result.eventUid).toBe("de_12345");
    });

    test("alertState becomes the status, ruleName the message", () => {
      expect(result.statusName).toBe("ALERTING");
      expect(result.message).toBe("Brute Force Login");
    });

    test("observables are the union across sample events", () => {
      expect(result.observables).toEqual([
        "alice",
        "workstation-1",
        "server-1",
        "10.0.0.1",
        "bob",
        "10.0.0.2",
      ]);
    });

    test("principal/target columns inherit from the first sample", () => {
      expect(result.principalUser).toBe("alice");
      expect(result.principalHost).toBe("workstation-1");
      expect(result.principalIp).toBe("10.0.0.1");
      expect(result.targetHost).toBe("server-1");
    });
  });

  describe("normalize: snake_case webhook spelling", () => {
    const payload: JSONObject = {
      detection: { rule_name: "Lateral Movement", rule_id: "ru_snake" },
      detection_time: 1714564800,
      collection_elements: [
        {
          references: [
            {
              event: {
                metadata: { event_type: "NETWORK_CONNECTION" },
                principal: { hostname: "snake-host" },
              },
            },
          ],
        },
      ],
    };

    const result: NormalizedSecurityEvent =
      GoogleSecOpsAlertNormalizer.normalize(payload);

    test("detection as a bare object with snake_case fields still lifts", () => {
      expect(result.ruleName).toBe("Lateral Movement");
      expect(result.ruleId).toBe("ru_snake");
      expect(result.time.getTime()).toBe(1714564800000);
      expect(result.observables).toEqual(["snake-host"]);
    });
  });

  describe("normalize: fallbacks", () => {
    test("severity falls back to the payload level, ruleVersionId backs up ruleId", () => {
      const result: NormalizedSecurityEvent =
        GoogleSecOpsAlertNormalizer.normalize({
          id: "de_2",
          severity: "MEDIUM",
          detection: [{ ruleVersionId: "ru_v2@v1" }],
        });

      expect(result.severityName).toBe(OcsfSeverity.Medium);
      expect(result.ruleId).toBe("ru_v2@v1");
    });

    test("without a rule name, message falls back to the description", () => {
      const result: NormalizedSecurityEvent =
        GoogleSecOpsAlertNormalizer.normalize({
          detection: [{ description: "Something suspicious" }],
        });

      expect(result.message).toBe("Something suspicious");
    });

    test("without any detection detail, message is the generic label", () => {
      const result: NormalizedSecurityEvent =
        GoogleSecOpsAlertNormalizer.normalize({
          type: "RULE_DETECTION",
        });

      expect(result.message).toBe("Google SecOps detection");
      expect(result.severityName).toBe(OcsfSeverity.Unknown);
      expect(result.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe("normalize: sample-event mining is capped", () => {
    test("only the first 25 references contribute observables", () => {
      const references: Array<JSONObject> = [];

      for (let i: number = 1; i <= 30; i++) {
        references.push({
          event: {
            metadata: { event_type: "USER_LOGIN" },
            principal: { hostname: `host-${i}` },
          },
        });
      }

      const payload: JSONObject = {
        id: "de_capped",
        detection: [{ ruleName: "Noisy Rule", severity: "LOW" }],
        collectionElements: [{ label: "e", references: references }],
      };

      const result: NormalizedSecurityEvent =
        GoogleSecOpsAlertNormalizer.normalize(payload);

      expect(result.observables).toHaveLength(25);
      expect(result.observables).toContain("host-1");
      expect(result.observables).toContain("host-25");
      expect(result.observables).not.toContain("host-26");
      expect(result.observables).not.toContain("host-30");

      // The first sample still supplies the principal columns.
      expect(result.principalHost).toBe("host-1");
    });
  });
});
