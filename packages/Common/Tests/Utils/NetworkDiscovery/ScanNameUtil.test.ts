import ScanNameUtil, {
  DiscoveryScanIdentity,
} from "../../../Utils/NetworkDiscovery/ScanNameUtil";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test: the optional name on a Network Device Discovery Scan
 * (issue #3391).
 *
 * Three rules are pinned here, because four different layers depend on all
 * three agreeing — the create form, the server's write hooks, the Discovery
 * Scans list, and the probe's own log lines:
 *
 *   1. what gets STORED (normalize): one line, trimmed, and nothing at all
 *      rather than an empty string. A scan is either named or it is not;
 *      "" is a third state that every `name ?` in the product would read as
 *      the first one and render as a blank line above the scan target.
 *   2. what is REJECTED (getValidationError): only two things — a value that
 *      is not text, and one that would not fit the varchar(100) column. The
 *      field is optional, so absence and blankness are not errors anywhere.
 *   3. what a scan is CALLED (getScanLabel): its name and its target
 *      together, falling back to whichever one it has. Every scan that
 *      existed before this column did has no name, so the fallback is the
 *      common case, not the edge case.
 */

function scan(name?: unknown, cidr?: unknown): DiscoveryScanIdentity {
  return {
    name: name as string | null | undefined,
    cidr: cidr as string | null | undefined,
  };
}

const MAX: number = ScanNameUtil.MAX_SCAN_NAME_LENGTH;

describe("ScanNameUtil", () => {
  /*
   * The ceiling is the column, not a number this module invented. A name that
   * passes validation and then fails the INSERT would be the worst of both.
   */
  it("caps names at the width of the ShortText column they are stored in", () => {
    expect(MAX).toBe(ColumnLength.ShortText);
    expect(MAX).toBe(100);
  });

  describe("normalize", () => {
    it("returns null when there is no name", () => {
      expect(ScanNameUtil.normalize(undefined)).toBeNull();
      expect(ScanNameUtil.normalize(null)).toBeNull();
    });

    /*
     * The distinction that matters most: an operator who typed nothing and one
     * who typed a space have said the same thing, and the column stores the
     * same thing for both.
     */
    it("returns null for a blank name rather than an empty string", () => {
      expect(ScanNameUtil.normalize("")).toBeNull();
      expect(ScanNameUtil.normalize(" ")).toBeNull();
      expect(ScanNameUtil.normalize("   ")).toBeNull();
      expect(ScanNameUtil.normalize("\t")).toBeNull();
      expect(ScanNameUtil.normalize("\n\n")).toBeNull();
      // A non-breaking space pasted out of a document is still a blank box.
      expect(ScanNameUtil.normalize("\u00A0")).toBeNull();
    });

    it("keeps an ordinary name exactly as it was typed", () => {
      expect(ScanNameUtil.normalize("Router Discovery - Region 1100")).toBe(
        "Router Discovery - Region 1100",
      );
    });

    it("trims the ends", () => {
      expect(ScanNameUtil.normalize("  Switch Discovery  ")).toBe(
        "Switch Discovery",
      );
    });

    /*
     * A name is rendered in one table cell and inlined into log lines. A value
     * pasted out of a spreadsheet cell arrives with a newline in it, and
     * nothing downstream would ever repair that.
     */
    it("folds a multi-line name onto one line", () => {
      expect(ScanNameUtil.normalize("Router\nDiscovery")).toBe(
        "Router Discovery",
      );
      expect(ScanNameUtil.normalize("Router\r\nDiscovery")).toBe(
        "Router Discovery",
      );
      expect(ScanNameUtil.normalize("Router\tDiscovery")).toBe(
        "Router Discovery",
      );
    });

    it("collapses every run of whitespace to a single space", () => {
      expect(ScanNameUtil.normalize("Router     Discovery")).toBe(
        "Router Discovery",
      );
      expect(ScanNameUtil.normalize(" WB \n\t  Units ")).toBe("WB Units");
    });

    it("strips control characters, including ones with no whitespace meaning", () => {
      expect(ScanNameUtil.normalize("Router\u0000Discovery")).toBe(
        "Router Discovery",
      );
      expect(ScanNameUtil.normalize("Router\u007FDiscovery")).toBe(
        "Router Discovery",
      );
      expect(ScanNameUtil.normalize("\u0001\u0002")).toBeNull();
    });

    it("leaves punctuation, accents and symbols alone", () => {
      expect(ScanNameUtil.normalize("Switch Discovery — WB Units (v2)")).toBe(
        "Switch Discovery — WB Units (v2)",
      );
      expect(ScanNameUtil.normalize("Zürich / Køge · 10%")).toBe(
        "Zürich / Køge · 10%",
      );
    });

    /*
     * The value arrives straight from request JSON, so it is genuinely not
     * guaranteed to be a string. normalize() answers "what would be stored",
     * and the answer for a non-string is "nothing" — rejecting it is
     * getValidationError's job, not this one's.
     */
    it("returns null for anything that is not a string", () => {
      expect(ScanNameUtil.normalize(1100)).toBeNull();
      expect(ScanNameUtil.normalize(0)).toBeNull();
      expect(ScanNameUtil.normalize(true)).toBeNull();
      expect(ScanNameUtil.normalize({ name: "Router" })).toBeNull();
      expect(ScanNameUtil.normalize(["Router"])).toBeNull();
      expect(ScanNameUtil.normalize(NaN)).toBeNull();
    });

    // Normalizing is what gets STORED, so it must not also be a length gate.
    it("does not truncate a name that is too long to store", () => {
      const tooLong: string = "a".repeat(MAX + 50);

      expect(ScanNameUtil.normalize(tooLong)).toBe(tooLong);
    });

    it("is idempotent, so a stored name re-read is left alone", () => {
      const messy: string = "  Router \n Discovery — Region 1100  ";
      const once: string | null = ScanNameUtil.normalize(messy);

      expect(ScanNameUtil.normalize(once)).toBe(once);
    });
  });

  describe("getValidationError", () => {
    it("says nothing about a missing name, because the field is optional", () => {
      expect(ScanNameUtil.getValidationError(undefined)).toBeNull();
      expect(ScanNameUtil.getValidationError(null)).toBeNull();
    });

    it("says nothing about a blank name either", () => {
      expect(ScanNameUtil.getValidationError("")).toBeNull();
      expect(ScanNameUtil.getValidationError("   ")).toBeNull();
      expect(ScanNameUtil.getValidationError("\n\t")).toBeNull();
    });

    it("accepts an ordinary name", () => {
      expect(
        ScanNameUtil.getValidationError("Router Discovery - Region 1100"),
      ).toBeNull();
    });

    it("accepts a name of exactly the column width", () => {
      expect(ScanNameUtil.getValidationError("a".repeat(MAX))).toBeNull();
    });

    it("rejects a name one character past the column width", () => {
      const error: string | null = ScanNameUtil.getValidationError(
        "a".repeat(MAX + 1),
      );

      expect(error).not.toBeNull();
      expect(error).toContain(String(MAX));
      expect(error).toContain(String(MAX + 1));
    });

    /*
     * Length is measured on what would be STORED. Rejecting a value this
     * module was about to shorten by trimming would be refusing to save
     * something perfectly storable.
     */
    it("measures the normalized name, not the raw one", () => {
      expect(
        ScanNameUtil.getValidationError(` ${"a".repeat(MAX)} \n`),
      ).toBeNull();

      const collapsible: string = `${"a".repeat(MAX - 2)}     b`;

      expect(collapsible.length).toBeGreaterThan(MAX);
      expect(ScanNameUtil.getValidationError(collapsible)).toBeNull();
    });

    it("rejects a value that is not text at all", () => {
      for (const value of [1100, true, { name: "Router" }, ["Router"]]) {
        const error: string | null = ScanNameUtil.getValidationError(value);

        expect(error).not.toBeNull();
        expect(error).toContain("text");
      }
    });

    /*
     * A non-string is reported rather than silently dropped: a client sending
     * `{"name": 1100}` has made a type error, and quietly storing no name at
     * all would hide it until someone noticed the scan was unnamed.
     */
    it("does not accept a non-string merely because it normalizes to nothing", () => {
      expect(ScanNameUtil.normalize(1100)).toBeNull();
      expect(ScanNameUtil.getValidationError(1100)).not.toBeNull();
    });
  });

  describe("getDisplayName", () => {
    it("is the normalized name", () => {
      expect(ScanNameUtil.getDisplayName(scan("  Router Discovery  "))).toBe(
        "Router Discovery",
      );
    });

    /*
     * Normalized on the way OUT as well as in, because rows written before the
     * column existed — and any writer that bypasses the hooks — are not
     * guaranteed to have been through normalize().
     */
    it("is null for a scan with no usable name, whatever the row holds", () => {
      expect(ScanNameUtil.getDisplayName(scan(undefined))).toBeNull();
      expect(ScanNameUtil.getDisplayName(scan(null))).toBeNull();
      expect(ScanNameUtil.getDisplayName(scan(""))).toBeNull();
      expect(ScanNameUtil.getDisplayName(scan("   "))).toBeNull();
      expect(ScanNameUtil.getDisplayName(scan(1100))).toBeNull();
    });

    it("ignores the scan target entirely", () => {
      expect(
        ScanNameUtil.getDisplayName(scan(undefined, "10.15.128.0-255")),
      ).toBeNull();
    });

    it("reads a row that selected no name column at all", () => {
      expect(ScanNameUtil.getDisplayName({})).toBeNull();
    });
  });

  describe("getScanLabel", () => {
    it("names a named scan and says what it sweeps", () => {
      expect(
        ScanNameUtil.getScanLabel(
          scan("Router Discovery - Region 1100", "10.15.128.0-255"),
        ),
      ).toBe("Router Discovery - Region 1100 (10.15.128.0-255)");
    });

    // Exactly what every log line and modal said before names existed.
    it("falls back to the target for an unnamed scan", () => {
      expect(
        ScanNameUtil.getScanLabel(scan(undefined, "10.15.128.0-255")),
      ).toBe("10.15.128.0-255");
      expect(ScanNameUtil.getScanLabel(scan("", "192.168.1.0/24"))).toBe(
        "192.168.1.0/24",
      );
      expect(ScanNameUtil.getScanLabel(scan("  ", "192.168.1.0/24"))).toBe(
        "192.168.1.0/24",
      );
    });

    it("uses the name alone when the target was not selected", () => {
      expect(ScanNameUtil.getScanLabel(scan("Router Discovery"))).toBe(
        "Router Discovery",
      );
    });

    /*
     * Returned empty rather than invented: the only caller that can see this
     * is one that selected neither column, and each of them appends its own
     * fallback (the scan id).
     */
    it("is empty when the row carries neither", () => {
      expect(ScanNameUtil.getScanLabel({})).toBe("");
      expect(ScanNameUtil.getScanLabel(scan(null, null))).toBe("");
      expect(ScanNameUtil.getScanLabel(scan("  ", "   "))).toBe("");
    });

    it("normalizes both halves", () => {
      expect(
        ScanNameUtil.getScanLabel(scan(" Router\nDiscovery ", " 10.0.0.0/24 ")),
      ).toBe("Router Discovery (10.0.0.0/24)");
    });

    it("ignores a target that is not text", () => {
      expect(ScanNameUtil.getScanLabel(scan("Router Discovery", 10))).toBe(
        "Router Discovery",
      );
      expect(ScanNameUtil.getScanLabel(scan(undefined, 10))).toBe("");
    });

    it("does not truncate, so a log line always names the whole scan", () => {
      const long: string = "a".repeat(MAX);

      expect(ScanNameUtil.getScanLabel(scan(long, "10.0.0.0/24"))).toBe(
        `${long} (10.0.0.0/24)`,
      );
    });
  });
});
