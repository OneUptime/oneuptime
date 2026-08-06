import BadDataException from "../../../Types/Exception/BadDataException";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";

/*
 * Write-time validation for the monitor name / description patterns on status
 * page monitor rules.
 *
 * The rule engine accepts a case-insensitive regex or a '*' wildcard glob, the
 * same two syntaxes the network device rules take. Anything else - `api-(01`,
 * `[unclosed` - compiles to nothing and matches nothing, and the engine can
 * only log about it long after the user left the form. Reject it at the write
 * instead, exactly as NetworkDeviceRulePatternValidator does
 * (OneUptime/oneuptime#2940).
 */
export default class StatusPageMonitorRulePatternValidator {
  public static validate(data: {
    namePattern?: string | null | undefined;
    descriptionPattern?: string | null | undefined;
  }): void {
    StatusPageMonitorRulePatternValidator.validateOne(
      "Monitor Name Pattern",
      data.namePattern,
    );
    StatusPageMonitorRulePatternValidator.validateOne(
      "Monitor Description Pattern",
      data.descriptionPattern,
    );
  }

  private static validateOne(
    title: string,
    pattern: string | null | undefined,
  ): void {
    if (!pattern) {
      return;
    }

    if (RulePatternMatchUtil.isSupportedPattern(pattern)) {
      return;
    }

    throw new BadDataException(
      `${title} "${pattern}" is not a valid regular expression, and contains no '*' wildcard to fall back on, so it would never match a monitor. Use a regex such as api-.* or a wildcard such as *api*.`,
    );
  }
}
