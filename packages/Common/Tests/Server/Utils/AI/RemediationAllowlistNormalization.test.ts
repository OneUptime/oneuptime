import RemediationExecutionRunner from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — RemediationExecutionRunner.normalizeAllowlist, the
 * single reader of a rule's operator-authored command allowlist.
 *
 * The column is jsonb, and the dashboard's JSON form field can persist
 * either a real array or a JSON STRING containing one. The runner used to
 * assume Array<string> and called array methods on whatever came back, so a
 * string-shaped allowlist crashed the run before it could settle the
 * suggestion. Normalization now accepts both shapes:
 *
 * - a real Array<string> passes through, trimmed, with empty/whitespace
 *   entries and non-string entries dropped;
 * - a JSON-string array is parsed into that same array (the crash fix — it
 *   must not throw for any string input);
 * - a bare non-JSON string is one pattern, because an operator who typed a
 *   single pattern without brackets meant that pattern;
 * - anything else (JSON that is not an array, undefined, null) is [].
 *
 * IMPORTANT: an empty result is the SAFE direction, not a failure — a rule
 * with no usable patterns can never match a command, so resolveMode
 * downgrades the run to Suggest and NOTHING auto-executes.
 */

describe("RemediationExecutionRunner.normalizeAllowlist", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a real array (the ordinary shape)", () => {
    it("passes patterns through in order", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist([
          "systemctl restart *",
          "kubectl rollout restart *",
        ]);

      expect(result).toEqual([
        "systemctl restart *",
        "kubectl rollout restart *",
      ]);
    });

    it("trims surrounding whitespace on each pattern", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist([
          "  systemctl restart *  ",
          "\tdocker restart *\n",
        ]);

      expect(result).toEqual(["systemctl restart *", "docker restart *"]);
    });

    it("drops empty and whitespace-only entries", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist([
          "systemctl restart *",
          "",
          "   ",
          "\t\n",
          "docker restart *",
        ]);

      expect(result).toEqual(["systemctl restart *", "docker restart *"]);
    });

    it("drops non-string entries rather than stringifying them", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist([
          "systemctl restart *",
          5,
          null,
          undefined,
          { a: 1 },
          ["nested"],
          true,
        ]);

      expect(result).toEqual(["systemctl restart *"]);
    });

    it("returns [] for an array with nothing usable in it", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist(["", "   ", 7, null]);

      expect(result).toEqual([]);
    });

    it("returns [] for an empty array", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist([]);

      expect(result).toEqual([]);
    });
  });

  /*
   * The crash fix. jsonb round-trips the dashboard's JSON field as a string
   * often enough that this is the common real-world shape, and the old code
   * threw on it — taking the whole run down before it could settle the
   * suggestion.
   */
  describe("a JSON-string array (what the dashboard's JSON field can persist)", () => {
    it("parses the string into the pattern array instead of throwing", () => {
      const value: string = '["systemctl restart *","docker restart *"]';

      expect(() => {
        return RemediationExecutionRunner.normalizeAllowlist(value);
      }).not.toThrow();

      expect(RemediationExecutionRunner.normalizeAllowlist(value)).toEqual([
        "systemctl restart *",
        "docker restart *",
      ]);
    });

    it("trims and drops blanks inside the parsed array too", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist(
          '["  systemctl restart *  ","","   ","docker restart *"]',
        );

      expect(result).toEqual(["systemctl restart *", "docker restart *"]);
    });

    it("drops non-string entries inside the parsed array", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist(
          '["systemctl restart *",5,null,{"a":1}]',
        );

      expect(result).toEqual(["systemctl restart *"]);
    });

    it("returns [] for an empty JSON array string", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist("[]");

      expect(result).toEqual([]);
    });
  });

  /*
   * An operator who typed one pattern into the field without brackets meant
   * that one pattern — honored, but only because it is a bare string that is
   * not parseable JSON.
   */
  describe("a bare non-JSON string", () => {
    it("becomes a single-pattern allowlist", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist("systemctl restart *");

      expect(result).toEqual(["systemctl restart *"]);
    });

    it("is trimmed like any other pattern", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist(
          "  systemctl restart *  ",
        );

      expect(result).toEqual(["systemctl restart *"]);
    });

    it("returns [] for a whitespace-only string", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist("   ");

      expect(result).toEqual([]);
    });

    it("returns [] for an empty string", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist("");

      expect(result).toEqual([]);
    });
  });

  /*
   * Valid JSON that is not an array of patterns is not an allowlist. It
   * normalizes to [] — nothing auto-executes — rather than being coerced
   * into something that could match a command.
   */
  describe("JSON that does not describe an array", () => {
    it('returns [] for a JSON object string ("{}")', () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist('"{}"');

      expect(result).toEqual([]);
    });

    it("returns [] for a JSON object", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist("{}");

      expect(result).toEqual([]);
    });

    it("returns [] for a JSON number string", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist("5");

      expect(result).toEqual([]);
    });

    it('returns [] for the string "null"', () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist("null");

      expect(result).toEqual([]);
    });

    it('returns [] for the string "true"', () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist("true");

      expect(result).toEqual([]);
    });
  });

  describe("absent values", () => {
    it("returns [] for undefined (column never set)", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist(undefined);

      expect(result).toEqual([]);
    });

    it("returns [] for null (column explicitly null)", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist(null);

      expect(result).toEqual([]);
    });

    it("returns [] for a non-string, non-array value", () => {
      const result: Array<string> =
        RemediationExecutionRunner.normalizeAllowlist({
          patterns: ["systemctl restart *"],
        });

      expect(result).toEqual([]);
    });
  });
});
