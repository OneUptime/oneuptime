import MonitorRulePatternValidator from "../../../../Server/Utils/Rules/MonitorRulePatternValidator";
import StatusPageMonitorRulePatternValidator from "../../../../Server/Utils/StatusPage/MonitorRulePatternValidator";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * The one pattern validator every monitor rule writes through - SLO monitor
 * rules and status page monitor rules. A pattern the engines would compile to
 * nothing must be refused at the write, with a message that names the field
 * rather than the product, and the status page import path must keep
 * resolving to exactly the same validator.
 */

describe("MonitorRulePatternValidator.validate", () => {
  test("accepts empty patterns - an empty criterion is skipped, not invalid", () => {
    expect(() => {
      return MonitorRulePatternValidator.validate({});
    }).not.toThrow();
    expect(() => {
      return MonitorRulePatternValidator.validate({
        namePattern: "",
        descriptionPattern: null,
      });
    }).not.toThrow();
  });

  test("accepts regular expressions and * wildcard globs", () => {
    for (const pattern of [
      "^api-.*",
      ".*",
      "customer facing|tier-1",
      "*api*",
    ]) {
      expect(() => {
        return MonitorRulePatternValidator.validate({
          namePattern: pattern,
          descriptionPattern: pattern,
        });
      }).not.toThrow();
    }
  });

  test("refuses a name pattern that is neither, naming the field", () => {
    expect(() => {
      return MonitorRulePatternValidator.validate({ namePattern: "api-(01" });
    }).toThrow(BadDataException);
    expect(() => {
      return MonitorRulePatternValidator.validate({ namePattern: "api-(01" });
    }).toThrow('Monitor Name Pattern "api-(01"');
  });

  test("refuses a description pattern that is neither, naming the field", () => {
    expect(() => {
      return MonitorRulePatternValidator.validate({
        descriptionPattern: "[unclosed",
      });
    }).toThrow('Monitor Description Pattern "[unclosed"');
  });

  test("never names a product, so any monitor rule can use it", () => {
    let message: string = "";

    try {
      MonitorRulePatternValidator.validate({ namePattern: "api-(01" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toMatch(/status page|slo/i);
  });

  test("the status page import path is the same validator", () => {
    expect(StatusPageMonitorRulePatternValidator).toBe(
      MonitorRulePatternValidator,
    );
  });
});
