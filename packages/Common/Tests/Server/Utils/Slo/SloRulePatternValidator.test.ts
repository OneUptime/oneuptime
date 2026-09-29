import SloRulePatternValidator from "../../../../Server/Utils/Slo/SloRulePatternValidator";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, it } from "@jest/globals";

/*
 * Write-time pattern validation for SLO label and owner rules: the engines
 * take a case-insensitive regex or a '*' wildcard, and anything else could
 * only ever match nothing.
 */
describe("SloRulePatternValidator", () => {
  it.each([
    ["an anchored regex", "^checkout-.*$"],
    ["an alternation", "checkout|payments"],
    ["a leading wildcard", "*checkout"],
    ["a wildcard on both sides", "*checkout*"],
    ["a plain word", "checkout"],
    // Not a regex, but the '*' makes it a wildcard.
    ["a wildcard that is not a valid regex", "*api-(01*"],
  ])("accepts %s", (_: string, pattern: string) => {
    expect(() => {
      SloRulePatternValidator.validate({
        namePattern: pattern,
        descriptionPattern: pattern,
      });
    }).not.toThrow();
  });

  it.each([undefined, null, ""])(
    "treats %p as no pattern at all",
    (pattern: string | null | undefined) => {
      expect(() => {
        SloRulePatternValidator.validate({
          namePattern: pattern,
          descriptionPattern: pattern,
        });
      }).not.toThrow();
    },
  );

  it("refuses a name pattern that is neither a regex nor a wildcard", () => {
    expect(() => {
      SloRulePatternValidator.validate({ namePattern: "checkout-(01" });
    }).toThrow(
      new BadDataException(
        `SLO Name Pattern "checkout-(01" is not a valid regular expression, and contains no '*' wildcard to fall back on, so it would never match an SLO. Use a regex such as checkout-.* or a wildcard such as *checkout*.`,
      ),
    );
  });

  it("refuses a description pattern that is neither a regex nor a wildcard", () => {
    expect(() => {
      SloRulePatternValidator.validate({
        namePattern: "checkout",
        descriptionPattern: "[unclosed",
      });
    }).toThrow('SLO Description Pattern "[unclosed"');
  });

  it("checks the name before the description", () => {
    expect(() => {
      SloRulePatternValidator.validate({
        namePattern: "(",
        descriptionPattern: "[",
      });
    }).toThrow("SLO Name Pattern");
  });
});
