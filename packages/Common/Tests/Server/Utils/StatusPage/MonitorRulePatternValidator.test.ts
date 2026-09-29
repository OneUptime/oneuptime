import StatusPageMonitorRulePatternValidator from "../../../../Server/Utils/StatusPage/MonitorRulePatternValidator";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * Write-time validation for the monitor name/description patterns on status
 * page monitor rules — the same two syntaxes (case-insensitive regex or '*'
 * glob) the network-device rules take, and the same refusal for anything that
 * would compile to a pattern matching nothing (OneUptime/oneuptime#2940).
 */

describe("StatusPageMonitorRulePatternValidator.validate", () => {
  test("accepts absent, null and empty patterns", () => {
    expect(() => {
      return StatusPageMonitorRulePatternValidator.validate({});
    }).not.toThrow();
    expect(() => {
      return StatusPageMonitorRulePatternValidator.validate({
        namePattern: null,
        descriptionPattern: "",
      });
    }).not.toThrow();
  });

  test("accepts a valid regex and a wildcard glob", () => {
    expect(() => {
      return StatusPageMonitorRulePatternValidator.validate({
        namePattern: "api-.*",
      });
    }).not.toThrow();
    expect(() => {
      return StatusPageMonitorRulePatternValidator.validate({
        namePattern: "*api*",
      });
    }).not.toThrow();
  });

  test("rejects a name pattern that is neither valid regex nor a glob", () => {
    let thrown: unknown = null;
    try {
      StatusPageMonitorRulePatternValidator.validate({
        namePattern: "api-(01",
      });
    } catch (err: unknown) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as BadDataException).message).toContain(
      "Monitor Name Pattern",
    );
    expect((thrown as BadDataException).message).toContain("api-(01");
  });

  test("rejects an invalid description pattern", () => {
    expect(() => {
      return StatusPageMonitorRulePatternValidator.validate({
        descriptionPattern: "[unclosed",
      });
    }).toThrow(BadDataException);
  });
});
