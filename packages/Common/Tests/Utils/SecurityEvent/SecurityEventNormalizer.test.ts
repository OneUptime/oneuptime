import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventFormat from "../../../Types/SecurityEvent/SecurityEventFormat";
import SecurityEventNormalizer from "../../../Utils/SecurityEvent/SecurityEventNormalizer";

/*
 * The dispatcher decides which normalizer sees an event, so its sniffing
 * precedence IS the ingest contract: an OCSF event that also carries UDM-ish
 * metadata must normalize as OCSF, and a UDM event inside a detection-shaped
 * envelope must normalize as UDM — reordering the checks silently reroutes
 * whole classes of traffic to the wrong normalizer with zero errors. The
 * same goes for the parseFormat aliases (a client sending ?format=chronicle
 * must keep meaning UDM), the null guard for empty/array payloads, and the
 * rule that an explicitly named format always beats sniffing.
 */
describe("SecurityEventNormalizer", () => {
  describe("detectFormat precedence", () => {
    test("OCSF beats UDM when both markers are present", () => {
      const payload: JSONObject = {
        class_uid: 3002,
        metadata: { event_type: "USER_LOGIN" },
      };

      expect(SecurityEventNormalizer.detectFormat(payload)).toBe(
        SecurityEventFormat.Ocsf,
      );
    });

    test("UDM beats the SecOps alert markers", () => {
      const payload: JSONObject = {
        metadata: { event_type: "USER_LOGIN" },
        collectionElements: [{}],
      };

      expect(SecurityEventNormalizer.detectFormat(payload)).toBe(
        SecurityEventFormat.Udm,
      );
    });

    test("SecOps alert beats generic", () => {
      const payload: JSONObject = {
        detection: [{ ruleName: "Brute Force" }],
      };

      expect(SecurityEventNormalizer.detectFormat(payload)).toBe(
        SecurityEventFormat.GoogleSecOpsAlert,
      );
    });

    test("anything unrecognised is generic", () => {
      expect(SecurityEventNormalizer.detectFormat({ message: "hello" })).toBe(
        SecurityEventFormat.Generic,
      );
    });
  });

  describe("parseFormat aliases", () => {
    test.each<[string, SecurityEventFormat]>([
      ["ocsf", SecurityEventFormat.Ocsf],
      ["udm", SecurityEventFormat.Udm],
      ["chronicle", SecurityEventFormat.Udm],
      ["google-secops", SecurityEventFormat.Udm],
      ["google-secops-alert", SecurityEventFormat.GoogleSecOpsAlert],
      ["secops-alert", SecurityEventFormat.GoogleSecOpsAlert],
      ["detection", SecurityEventFormat.GoogleSecOpsAlert],
      ["generic", SecurityEventFormat.Generic],
    ])("%s -> %s", (input: string, expected: SecurityEventFormat) => {
      expect(SecurityEventNormalizer.parseFormat(input)).toBe(expected);
    });

    test("aliases are case-insensitive and trimmed", () => {
      expect(SecurityEventNormalizer.parseFormat("  OCSF  ")).toBe(
        SecurityEventFormat.Ocsf,
      );
      expect(SecurityEventNormalizer.parseFormat("Chronicle")).toBe(
        SecurityEventFormat.Udm,
      );
    });

    test.each<[string]>([["unknown"], ["syslog"], [""], ["   "]])(
      "unrecognised %s -> null",
      (input: string) => {
        expect(SecurityEventNormalizer.parseFormat(input)).toBeNull();
      },
    );
  });

  describe("normalize guards", () => {
    test("empty object -> null", () => {
      expect(SecurityEventNormalizer.normalize({})).toBeNull();
    });

    test("arrays -> null, even non-empty ones", () => {
      expect(
        SecurityEventNormalizer.normalize([] as unknown as JSONObject),
      ).toBeNull();
      expect(
        SecurityEventNormalizer.normalize([
          { class_uid: 3002 },
        ] as unknown as JSONObject),
      ).toBeNull();
    });

    test("null payload -> null", () => {
      expect(
        SecurityEventNormalizer.normalize(null as unknown as JSONObject),
      ).toBeNull();
    });

    test("empty object stays null even with an explicit format", () => {
      expect(
        SecurityEventNormalizer.normalize({}, SecurityEventFormat.Ocsf),
      ).toBeNull();
    });
  });

  describe("normalize routing", () => {
    test("sniffed UDM payload routes to the UDM normalizer", () => {
      const result: NormalizedSecurityEvent | null =
        SecurityEventNormalizer.normalize({
          metadata: { event_type: "USER_LOGIN" },
        });

      expect(result).not.toBeNull();
      expect(result?.classUid).toBe(3002);
      expect(result?.className).toBe("Authentication");
    });

    test("explicit format overrides sniffing", () => {
      const udmPayload: JSONObject = {
        metadata: { event_type: "USER_LOGIN" },
      };

      const sniffed: NormalizedSecurityEvent | null =
        SecurityEventNormalizer.normalize(udmPayload);
      const forced: NormalizedSecurityEvent | null =
        SecurityEventNormalizer.normalize(
          udmPayload,
          SecurityEventFormat.Generic,
        );

      // Sniffed: UDM mapping fires. Forced generic: no metadata.* aliases.
      expect(sniffed?.classUid).toBe(3002);
      expect(forced?.classUid).toBe(0);
      expect(forced?.className).toBe("Base Event");
    });

    test("explicit OCSF format is honoured", () => {
      const result: NormalizedSecurityEvent | null =
        SecurityEventNormalizer.normalize(
          { class_uid: 4003, message: "dns query" },
          SecurityEventFormat.Ocsf,
        );

      expect(result?.className).toBe("DNS Activity");
      expect(result?.message).toBe("dns query");
    });

    test("explicit SecOps alert format is honoured", () => {
      const result: NormalizedSecurityEvent | null =
        SecurityEventNormalizer.normalize(
          { detection: [{ ruleName: "R1" }] },
          SecurityEventFormat.GoogleSecOpsAlert,
        );

      expect(result?.classUid).toBe(2004);
      expect(result?.className).toBe("Detection Finding");
      expect(result?.ruleName).toBe("R1");
    });
  });
});
