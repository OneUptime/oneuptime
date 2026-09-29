import { describe, expect, test } from "@jest/globals";
import IncidentSlaStatus from "../../../Types/Incident/IncidentSlaStatus";

/*
 * IncidentSlaStatus is a plain string enum. These tests lock in the exact
 * string value of every member, the structural invariants of the enum object
 * (member count, key set, value uniqueness, absence of a reverse mapping) and
 * the runtime semantics that consumers rely on (equality, switch dispatch and
 * membership checks). Everything here is deterministic and pure: no network,
 * database, wall-clock or randomness is involved.
 */

describe("enum IncidentSlaStatus", () => {
  describe("member values", () => {
    test("OnTrack maps to the human-readable 'On Track'", () => {
      expect(IncidentSlaStatus.OnTrack).toBe("On Track");
    });

    test("AtRisk maps to the human-readable 'At Risk'", () => {
      expect(IncidentSlaStatus.AtRisk).toBe("At Risk");
    });

    test("ResponseBreached maps to 'Response Breached'", () => {
      expect(IncidentSlaStatus.ResponseBreached).toBe("Response Breached");
    });

    test("ResolutionBreached maps to 'Resolution Breached'", () => {
      expect(IncidentSlaStatus.ResolutionBreached).toBe("Resolution Breached");
    });

    test("Met maps to 'Met'", () => {
      expect(IncidentSlaStatus.Met).toBe("Met");
    });
  });

  describe("structural invariants", () => {
    test("exposes exactly five members", () => {
      /*
       * A string enum produces no reverse numeric mapping, so the key count is
       * exactly the number of declared members.
       */
      const keys: Array<string> = Object.keys(IncidentSlaStatus);
      expect(keys).toHaveLength(5);
    });

    test("declares the full, ordered key set", () => {
      const keys: Array<string> = Object.keys(IncidentSlaStatus);
      expect(keys).toEqual([
        "OnTrack",
        "AtRisk",
        "ResponseBreached",
        "ResolutionBreached",
        "Met",
      ]);
    });

    test("declares the full, ordered value set", () => {
      const values: Array<string> = Object.values(IncidentSlaStatus);
      expect(values).toEqual([
        "On Track",
        "At Risk",
        "Response Breached",
        "Resolution Breached",
        "Met",
      ]);
    });

    test("every member value is unique", () => {
      const values: Array<string> = Object.values(IncidentSlaStatus);
      const uniqueValues: Set<string> = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    test("every member key is unique", () => {
      const keys: Array<string> = Object.keys(IncidentSlaStatus);
      const uniqueKeys: Set<string> = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    test("has no reverse mapping from value back to key", () => {
      /*
       * Numeric enums create a reverse mapping (obj[0] === "Key"), which would
       * pollute the key set. A string enum must not; guard against a member
       * accidentally becoming numeric. The values below all contain a space, so
       * they can never coincide with a member key and unambiguously prove that
       * no value-to-key entry exists.
       */
      const record: Record<string, string> =
        IncidentSlaStatus as unknown as Record<string, string>;
      expect(record["On Track"]).toBeUndefined();
      expect(record["At Risk"]).toBeUndefined();
      expect(record["Response Breached"]).toBeUndefined();
      expect(record["Resolution Breached"]).toBeUndefined();
    });

    test("every value is a non-empty string", () => {
      const values: Array<string> = Object.values(IncidentSlaStatus);
      for (const value of values) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    });
  });

  describe("runtime semantics", () => {
    test("distinct members are not equal to one another", () => {
      const members: Array<IncidentSlaStatus> = [
        IncidentSlaStatus.OnTrack,
        IncidentSlaStatus.AtRisk,
        IncidentSlaStatus.ResponseBreached,
        IncidentSlaStatus.ResolutionBreached,
        IncidentSlaStatus.Met,
      ];

      for (let i: number = 0; i < members.length; i++) {
        for (let j: number = 0; j < members.length; j++) {
          if (i === j) {
            expect(members[i]).toBe(members[j]);
          } else {
            expect(members[i]).not.toBe(members[j]);
          }
        }
      }
    });

    test("a member can be located by its string value", () => {
      const values: Array<string> = Object.values(IncidentSlaStatus);
      expect(values.includes(IncidentSlaStatus.ResponseBreached)).toBe(true);
      expect(values.includes("Not A Status")).toBe(false);
    });

    test("drives switch dispatch by member identity", () => {
      /*
       * classify is a tiny local pure helper. It exercises every enum branch
       * plus the exhaustive default so a switch over the enum is verified to
       * reach each case deterministically.
       */
      const classify: (status: IncidentSlaStatus) => string = (
        status: IncidentSlaStatus,
      ): string => {
        switch (status) {
          case IncidentSlaStatus.OnTrack:
            return "healthy";
          case IncidentSlaStatus.AtRisk:
            return "warning";
          case IncidentSlaStatus.ResponseBreached:
          case IncidentSlaStatus.ResolutionBreached:
            return "breached";
          case IncidentSlaStatus.Met:
            return "closed";
          default:
            return "unknown";
        }
      };

      expect(classify(IncidentSlaStatus.OnTrack)).toBe("healthy");
      expect(classify(IncidentSlaStatus.AtRisk)).toBe("warning");
      expect(classify(IncidentSlaStatus.ResponseBreached)).toBe("breached");
      expect(classify(IncidentSlaStatus.ResolutionBreached)).toBe("breached");
      expect(classify(IncidentSlaStatus.Met)).toBe("closed");
    });

    test("an out-of-enum value falls through switch to the default branch", () => {
      const classify: (status: IncidentSlaStatus) => string = (
        status: IncidentSlaStatus,
      ): string => {
        switch (status) {
          case IncidentSlaStatus.OnTrack:
            return "healthy";
          default:
            return "unknown";
        }
      };

      /*
       * A raw string that is not one of the enum values must not match any
       * case. Cast through unknown to feed the negative/edge input safely.
       */
      const strayValue: IncidentSlaStatus =
        "In Progress" as unknown as IncidentSlaStatus;
      expect(classify(strayValue)).toBe("unknown");
    });

    test("serializes to its string value in JSON, not to an index", () => {
      const payload: { status: IncidentSlaStatus } = {
        status: IncidentSlaStatus.ResolutionBreached,
      };
      expect(JSON.stringify(payload)).toBe('{"status":"Resolution Breached"}');
    });
  });
});
