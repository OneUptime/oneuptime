import NetworkDeviceRulePatternValidator from "../../../../Server/Utils/NetworkDevice/RulePatternValidator";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * Write-time validation for network-device label/owner rule patterns. The rule
 * engine accepts a case-insensitive regex OR a '*' wildcard glob; anything else
 * (`switch-(01`, `[unclosed`) compiles to nothing, matches nothing, and can
 * only be logged about long after the user left the form. This rejects it at
 * the write instead (OneUptime/oneuptime#2940).
 */

describe("NetworkDeviceRulePatternValidator.validate", () => {
  test("accepts absent patterns", () => {
    expect(() => {
      return NetworkDeviceRulePatternValidator.validate({});
    }).not.toThrow();
  });

  test("accepts null and empty patterns", () => {
    expect(() => {
      return NetworkDeviceRulePatternValidator.validate({
        namePattern: null,
        descriptionPattern: "",
      });
    }).not.toThrow();
  });

  test("accepts a valid regex pattern", () => {
    expect(() => {
      return NetworkDeviceRulePatternValidator.validate({
        namePattern: "core-switch-.*",
      });
    }).not.toThrow();
  });

  test("accepts a wildcard glob even when it is not valid regex", () => {
    expect(() => {
      return NetworkDeviceRulePatternValidator.validate({
        namePattern: "*0664*",
      });
    }).not.toThrow();
  });

  test("rejects a name pattern that is neither valid regex nor a glob", () => {
    expect(() => {
      return NetworkDeviceRulePatternValidator.validate({
        namePattern: "[unclosed",
      });
    }).toThrow(BadDataException);
  });

  test("rejects an invalid description pattern and names it in the message", () => {
    let thrown: unknown = null;
    try {
      NetworkDeviceRulePatternValidator.validate({
        descriptionPattern: "switch-(01",
      });
    } catch (err: unknown) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as BadDataException).message).toContain(
      "Network Device Description Pattern",
    );
    expect((thrown as BadDataException).message).toContain("switch-(01");
  });

  test("a valid name still fails the write when the description is invalid", () => {
    expect(() => {
      return NetworkDeviceRulePatternValidator.validate({
        namePattern: "core-.*",
        descriptionPattern: "(unbalanced",
      });
    }).toThrow(BadDataException);
  });
});
