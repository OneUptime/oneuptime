import BadDataException from "../../../Types/Exception/BadDataException";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";

/*
 * Write-time validation for the SLO name / description patterns on SLO label
 * and owner rules.
 *
 * The rule engines accept a case-insensitive regex or a '*' wildcard glob, the
 * same two syntaxes the SLO monitor rules take. Anything else - `api-(01`,
 * `[unclosed` - compiles to nothing and matches nothing, and the engine can
 * only log about it long after the user left the form. Reject it at the write
 * instead, as NetworkDeviceRulePatternValidator does (OneUptime/oneuptime#2940).
 */
export default class SloRulePatternValidator {
  public static validate(data: {
    namePattern?: string | null | undefined;
    descriptionPattern?: string | null | undefined;
  }): void {
    SloRulePatternValidator.validateOne("SLO Name Pattern", data.namePattern);
    SloRulePatternValidator.validateOne(
      "SLO Description Pattern",
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
      `${title} "${pattern}" is not a valid regular expression, and contains no '*' wildcard to fall back on, so it would never match an SLO. Use a regex such as checkout-.* or a wildcard such as *checkout*.`,
    );
  }
}
