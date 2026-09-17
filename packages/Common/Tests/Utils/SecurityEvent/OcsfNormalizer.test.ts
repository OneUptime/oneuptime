import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import OcsfNormalizer from "../../../Utils/SecurityEvent/OcsfNormalizer";

/*
 * OCSF is the canonical dialect, so this normalizer mostly lifts fields —
 * which makes its regressions the quiet kind: a producer omits class_name
 * and the row must re-derive it from the uid instead of storing "" ; a
 * payload carries both severity_id and a contradictory severity text and
 * the id must win or text-only producers and id producers grade the same
 * event differently; an unknown class_uid must be kept (with a derived
 * category) because the schema outgrows our curated subset. These tests pin
 * those trust-but-rederive rules plus the attacks/observables merges.
 */
describe("OcsfNormalizer", () => {
  describe("isOcsfEvent", () => {
    test("requires a numeric class_uid", () => {
      expect(OcsfNormalizer.isOcsfEvent({ class_uid: 3002 })).toBe(true);
      expect(OcsfNormalizer.isOcsfEvent({ class_uid: "3002" })).toBe(true);
      expect(OcsfNormalizer.isOcsfEvent({ class_uid: "not-a-number" })).toBe(
        false,
      );
      expect(OcsfNormalizer.isOcsfEvent({})).toBe(false);
      expect(
        OcsfNormalizer.isOcsfEvent({ metadata: { event_type: "USER_LOGIN" } }),
      ).toBe(false);
    });
  });

  describe("normalize: full authentication event", () => {
    const payload: JSONObject = {
      class_uid: 3002,
      activity_name: "Logon",
      severity_id: 4,
      severity: "LOW",
      time: 1714564800000,
      message: "Failed logon attempt",
      status: "Failure",
      metadata: {
        uid: "ocsf-1",
        product: { vendor_name: "Vendor", name: "Product" },
      },
      actor: { user: { name: "alice" }, process: { name: "winlogon.exe" } },
      src_endpoint: { hostname: "laptop-1", ip: "10.1.1.1" },
      dst_endpoint: { hostname: "dc-1", ip: "10.1.1.2", port: 445 },
      user: { name: "bob" },
      attacks: [
        {
          tactic: { uid: "TA0006", name: "Credential Access" },
          technique: { uid: "T1110", name: "Brute Force" },
        },
        { tactic: { uid: "TA0006" }, technique: { uid: "T1110.001" } },
      ],
      observables: [
        { name: "src ip", type_id: 2, value: "10.1.1.1" },
        { name: "domain", type_id: 1, value: "evil.example.com" },
      ],
    };

    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize(payload);

    test("class_name absent -> name derived from the uid", () => {
      expect(result.classUid).toBe(3002);
      expect(result.className).toBe("Authentication");
      expect(result.categoryUid).toBe(3);
      expect(result.categoryName).toBe("Identity & Access Management");
    });

    test("severity_id wins over the contradictory severity text", () => {
      expect(result.severityName).toBe(OcsfSeverity.High);
      expect(result.severityId).toBe(4);
    });

    test("time parses epoch millis", () => {
      expect(result.time.getTime()).toBe(1714564800000);
    });

    test("attacks[] uids extract and dedupe", () => {
      expect(result.mitreTactics).toEqual(["TA0006"]);
      expect(result.mitreTechniques).toEqual(["T1110", "T1110.001"]);
    });

    test("actor / src_endpoint / dst_endpoint / user extraction", () => {
      expect(result.principalUser).toBe("alice");
      expect(result.principalProcess).toBe("winlogon.exe");
      expect(result.principalHost).toBe("laptop-1");
      expect(result.principalIp).toBe("10.1.1.1");
      expect(result.targetUser).toBe("bob");
      expect(result.targetHost).toBe("dc-1");
      expect(result.targetIp).toBe("10.1.1.2");
      expect(result.targetPort).toBe(445);
    });

    test("observables[] values merge with entity fields, deduped", () => {
      expect(result.observables).toEqual([
        "alice",
        "bob",
        "laptop-1",
        "dc-1",
        "10.1.1.1",
        "10.1.1.2",
        "evil.example.com",
      ]);
    });

    test("status, message, product and uid lift as-is", () => {
      expect(result.statusName).toBe("Failure");
      expect(result.message).toBe("Failed logon attempt");
      expect(result.vendorName).toBe("Vendor");
      expect(result.productName).toBe("Product");
      expect(result.eventUid).toBe("ocsf-1");
      expect(result.activityName).toBe("Logon");
    });
  });

  describe("normalize: severity text fallback", () => {
    test("severity text grades when severity_id is absent", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 4001,
        severity: "critical",
      });

      expect(result.severityName).toBe(OcsfSeverity.Critical);
      expect(result.severityId).toBe(5);
    });

    test("unrecognised severity text -> Unknown", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 4001,
        severity: "P1",
      });

      expect(result.severityName).toBe(OcsfSeverity.Unknown);
      expect(result.severityId).toBe(0);
    });
  });

  describe("normalize: unknown class_uid is kept, never dropped", () => {
    test("without class_name -> Base Event with derived category", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 4999,
      });

      expect(result.classUid).toBe(4999);
      expect(result.className).toBe("Base Event");
      expect(result.categoryUid).toBe(4);
      expect(result.categoryName).toBe("Network Activity");
    });

    test("a supplied class_name is trusted", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 4999,
        class_name: "Tunnel Activity",
      });

      expect(result.className).toBe("Tunnel Activity");
    });
  });

  describe("normalize: fallback fields", () => {
    test("disposition backs up status", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 1001,
        disposition: "Blocked",
      });

      expect(result.statusName).toBe("Blocked");
    });

    test("time_dt backs up time", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 1001,
        time_dt: "2024-05-01T12:00:00Z",
      });

      expect(result.time.getTime()).toBe(1714564800000);
    });

    test("finding_info backs up rule fields and the message", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 2004,
        finding_info: { uid: "finding-1", title: "Suspicious login burst" },
      });

      expect(result.ruleId).toBe("finding-1");
      expect(result.ruleName).toBe("Suspicious login burst");
      expect(result.message).toBe("Suspicious login burst");
    });

    test("without message or finding_info, message is the class name", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 3002,
      });

      expect(result.message).toBe("Authentication");
    });

    test("without metadata.uid, eventUid is a content hash", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 3002,
      });

      expect(result.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });
});
