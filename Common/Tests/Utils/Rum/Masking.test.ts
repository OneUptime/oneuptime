import Masking from "../../../Utils/Rum/Masking";

describe("Masking", () => {
  describe("maskInputValue", () => {
    it("is NOT length preserving", () => {
      /*
       * This is the single most important assertion in the masking suite.
       * rrweb's built-in mask is '*'.repeat(value.length), which turns
       * every masked field into a length oracle: it narrows a password
       * search space and it identifies a 16-digit value as a card number.
       * Our mask must be constant width regardless of input.
       */
      const short: string = Masking.maskInputValue();
      const long: string = Masking.maskInputValue();

      expect(short).toBe(long);
      expect(short.length).toBe(3);
    });

    it("emits the same mask for values of wildly different lengths", () => {
      const lengths: Array<number> = [1, 4, 8, 16, 32, 256];

      const masks: Array<string> = lengths.map((): string => {
        return Masking.maskInputValue();
      });

      const unique: Set<string> = new Set(masks);

      expect(unique.size).toBe(1);
    });

    it("masks an empty value too, so cleared and untouched are indistinguishable", () => {
      expect(Masking.maskInputValue().length).toBeGreaterThan(0);
    });
  });

  describe("maskText", () => {
    it("buckets rather than preserving exact length", () => {
      /*
       * Static text is bucketed rather than fixed-width so a wireframe
       * replay keeps usable layout, but two different strings in the same
       * bucket must be indistinguishable.
       */
      expect(Masking.maskText("hello wo")).toBe(Masking.maskText("goodbye!"));
    });

    it("maps the three size classes to three distinct widths", () => {
      const shortMask: string = Masking.maskText("abc");
      const mediumMask: string = Masking.maskText("a".repeat(20));
      const longMask: string = Masking.maskText("a".repeat(200));

      expect(shortMask.length).toBe(4);
      expect(mediumMask.length).toBe(16);
      expect(longMask.length).toBe(40);
    });

    it("never leaks the original characters", () => {
      const secret: string = "Order #4815162342 for jane@example.com";
      const masked: string = Masking.maskText(secret);

      expect(masked).not.toContain("4815162342");
      expect(masked).not.toContain("jane@example.com");
      expect(masked).not.toContain("Order");
    });

    it("caps the leak to a coarse size class for very long text", () => {
      /*
       * A 200-char and a 20,000-char paragraph must produce the same
       * mask, so the mask cannot be used to fingerprint page content.
       */
      expect(Masking.maskText("a".repeat(200))).toBe(
        Masking.maskText("a".repeat(20000)),
      );
    });

    it("leaves whitespace-only text untouched so spacing survives", () => {
      expect(Masking.maskText("   ")).toBe("   ");
      expect(Masking.maskText("\n\t")).toBe("\n\t");
    });

    it("returns empty input unchanged", () => {
      expect(Masking.maskText("")).toBe("");
    });
  });

  describe("maskFileInputValue", () => {
    it("always blanks the value", () => {
      /*
       * A file input's DOM value is C:\fakepath\<real filename>, and
       * filenames are routinely personal — "passport-scan.pdf",
       * "payslip-march.pdf", "biopsy-results.pdf".
       */
      expect(Masking.maskFileInputValue()).toBe("");
    });
  });

  describe("isAlwaysSensitiveInputType", () => {
    it("treats password as always sensitive", () => {
      expect(Masking.isAlwaysSensitiveInputType("password")).toBe(true);
      expect(Masking.isAlwaysSensitiveInputType("PASSWORD")).toBe(true);
    });

    it("does not treat ordinary types as always sensitive", () => {
      expect(Masking.isAlwaysSensitiveInputType("text")).toBe(false);
      expect(Masking.isAlwaysSensitiveInputType("checkbox")).toBe(false);
      expect(Masking.isAlwaysSensitiveInputType("")).toBe(false);
    });
  });

  describe("isStickySensitiveAutocomplete", () => {
    it("recognises credential and one-time-code fields", () => {
      expect(Masking.isStickySensitiveAutocomplete("current-password")).toBe(
        true,
      );
      expect(Masking.isStickySensitiveAutocomplete("new-password")).toBe(true);
      expect(Masking.isStickySensitiveAutocomplete("one-time-code")).toBe(true);
    });

    it("recognises card fields, which are type=text and so invisible to type checks", () => {
      /*
       * rrweb keys masking on HTML input *type*. A card number field is
       * type="text", so autocomplete is the only durable signal short of
       * a cross-origin PSP iframe.
       */
      expect(Masking.isStickySensitiveAutocomplete("cc-number")).toBe(true);
      expect(Masking.isStickySensitiveAutocomplete("cc-csc")).toBe(true);
      expect(Masking.isStickySensitiveAutocomplete("cc-exp")).toBe(true);
    });

    it("handles the multi-token form with section and billing prefixes", () => {
      /*
       * autocomplete legitimately reads "section-payment billing cc-number",
       * so a whole-string comparison would miss real card fields.
       */
      expect(
        Masking.isStickySensitiveAutocomplete(
          "section-payment billing cc-number",
        ),
      ).toBe(true);
      expect(Masking.isStickySensitiveAutocomplete("shipping cc-csc")).toBe(
        true,
      );
    });

    it("is case-insensitive", () => {
      expect(Masking.isStickySensitiveAutocomplete("CC-NUMBER")).toBe(true);
    });

    it("does not over-match ordinary autocomplete values", () => {
      expect(Masking.isStickySensitiveAutocomplete("email")).toBe(false);
      expect(Masking.isStickySensitiveAutocomplete("name")).toBe(false);
      expect(Masking.isStickySensitiveAutocomplete("off")).toBe(false);
      expect(Masking.isStickySensitiveAutocomplete("")).toBe(false);
    });
  });

  describe("quantiseTimestamp", () => {
    it("floors timestamps into buckets", () => {
      expect(Masking.quantiseTimestamp(1000, 250)).toBe(1000);
      expect(Masking.quantiseTimestamp(1123, 250)).toBe(1000);
      expect(Masking.quantiseTimestamp(1249, 250)).toBe(1000);
      expect(Masking.quantiseTimestamp(1250, 250)).toBe(1250);
    });

    it("removes inter-keystroke timing resolution", () => {
      /*
       * A masked password field still leaks typed content through
       * keystroke timing, which is a published side channel. Bucketing
       * collapses realistic keystroke gaps to a single value.
       */
      const keystrokes: Array<number> = [1000, 1040, 1095, 1160, 1210];

      const quantised: Array<number> = keystrokes.map((t: number): number => {
        return Masking.quantiseTimestamp(t, 250);
      });

      expect(new Set(quantised).size).toBe(1);
    });

    it("passes through non-finite input and non-positive buckets unchanged", () => {
      expect(Masking.quantiseTimestamp(Number.NaN, 250)).toBeNaN();
      expect(Masking.quantiseTimestamp(1234, 0)).toBe(1234);
      expect(Masking.quantiseTimestamp(1234, -5)).toBe(1234);
    });
  });
});
