import BadDataException from "../../../Types/Exception/BadDataException";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";

/*
 * Write-time validation for the name / description patterns on network device
 * label and owner rules.
 *
 * The rule engines accept a case-insensitive regex or a '*' wildcard glob.
 * Anything else - `switch-(01`, `[unclosed` - compiles to nothing and matches
 * nothing, and the engine can only log about it long after the user left the
 * form. Reject it at the write instead (OneUptime/oneuptime#2940).
 */
export default class NetworkDeviceRulePatternValidator {
  public static validate(data: {
    namePattern?: string | null | undefined;
    descriptionPattern?: string | null | undefined;
  }): void {
    NetworkDeviceRulePatternValidator.validateOne(
      "Network Device Name Pattern",
      data.namePattern,
    );
    NetworkDeviceRulePatternValidator.validateOne(
      "Network Device Description Pattern",
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
      `${title} "${pattern}" is not a valid regular expression, and contains no '*' wildcard to fall back on, so it would never match a network device. Use a regex such as core-switch-.* or a wildcard such as *0664*.`,
    );
  }
}
