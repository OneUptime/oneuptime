import { describe, expect, test } from "@jest/globals";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
  ocsfSeverityFromId,
} from "../../../Types/SecurityEvent/OcsfSeverity";

/*
 * A SecurityEvent row stores severity twice: as text (severityName) and as a
 * number (severityId), and every writer promises the pair agrees. Filters
 * compare against the numeric id while the UI shows the text, so a drifting
 * map would make a row claim "Critical" while filtering as something else and
 * nobody would see an error. These tests pin the id map, the id -> name
 * reverse lookup, and the alias table that grades foreign dialect severities
 * (UDM security_result, syslog levels) — the exact strings the normalizers
 * depend on to grade events consistently.
 */
describe("OcsfSeverity", () => {
  describe("OcsfSeverityId matches the OCSF severity_id values", () => {
    test.each<[OcsfSeverity, number]>([
      [OcsfSeverity.Unknown, 0],
      [OcsfSeverity.Informational, 1],
      [OcsfSeverity.Low, 2],
      [OcsfSeverity.Medium, 3],
      [OcsfSeverity.High, 4],
      [OcsfSeverity.Critical, 5],
      [OcsfSeverity.Fatal, 6],
      [OcsfSeverity.Other, 99],
    ])("%s -> %i", (severity: OcsfSeverity, expected: number) => {
      expect(OcsfSeverityId[severity]).toBe(expected);
    });

    test("every enum member has an id", () => {
      for (const severity of Object.values(OcsfSeverity)) {
        expect(OcsfSeverityId[severity]).toBeDefined();
      }
    });
  });

  describe("ocsfSeverityFromId reverses the id map", () => {
    test("round-trips every enum member", () => {
      for (const severity of Object.values(OcsfSeverity)) {
        expect(ocsfSeverityFromId(OcsfSeverityId[severity])).toBe(severity);
      }
    });

    test.each<[number]>([[7], [42], [-1], [100], [98]])(
      "unknown id %i -> Unknown",
      (id: number) => {
        expect(ocsfSeverityFromId(id)).toBe(OcsfSeverity.Unknown);
      },
    );
  });

  describe("normalizeOcsfSeverity grades the dialects we ingest", () => {
    // UDM security_result severities.
    test.each<[string, OcsfSeverity]>([
      ["EMERGENCY", OcsfSeverity.Fatal],
      ["ALERT", OcsfSeverity.Critical],
      ["CRITICAL", OcsfSeverity.Critical],
      ["ERROR", OcsfSeverity.Medium],
      ["HIGH", OcsfSeverity.High],
      ["MEDIUM", OcsfSeverity.Medium],
      ["LOW", OcsfSeverity.Low],
      ["INFORMATIONAL", OcsfSeverity.Informational],
      ["NONE", OcsfSeverity.Informational],
      ["UNKNOWN_SEVERITY", OcsfSeverity.Unknown],
      ["UNKNOWN", OcsfSeverity.Unknown],
    ])("UDM %s -> %s", (input: string, expected: OcsfSeverity) => {
      expect(normalizeOcsfSeverity(input)).toBe(expected);
    });

    /*
     * Syslog levels. ERR is the interesting one: it is severity 3 in syslog
     * but grades as OCSF Medium here, matching how ERROR is graded — the two
     * spellings of the same level must not diverge.
     */
    test.each<[string, OcsfSeverity]>([
      ["DEBUG", OcsfSeverity.Informational],
      ["INFO", OcsfSeverity.Informational],
      ["NOTICE", OcsfSeverity.Informational],
      ["WARNING", OcsfSeverity.Low],
      ["WARN", OcsfSeverity.Low],
      ["ERR", OcsfSeverity.Medium],
      ["CRIT", OcsfSeverity.Critical],
    ])("syslog %s -> %s", (input: string, expected: OcsfSeverity) => {
      expect(normalizeOcsfSeverity(input)).toBe(expected);
    });

    test.each<[string, OcsfSeverity]>([
      ["high", OcsfSeverity.High],
      ["Critical", OcsfSeverity.Critical],
      ["  low  ", OcsfSeverity.Low],
      ["moderate", OcsfSeverity.Medium],
      ["severe", OcsfSeverity.High],
      ["fatal", OcsfSeverity.Fatal],
    ])(
      "case-insensitive and trimmed: %s -> %s",
      (input: string, expected: OcsfSeverity) => {
        expect(normalizeOcsfSeverity(input)).toBe(expected);
      },
    );

    test.each<[string]>([[""], ["   "], ["nonsense"], ["P1"], ["3"], ["Sev1"]])(
      "unrecognised %s -> null rather than a guess",
      (input: string) => {
        expect(normalizeOcsfSeverity(input)).toBeNull();
      },
    );
  });
});
