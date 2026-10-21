import Color from "../Color";
import { Gray500, Green, Red, Yellow } from "../BrandColors";

/*
 * What a closed case turned out to be. The verdict is what makes a closed
 * queue worth reading back: the share of false positives per rule is the
 * tuning list, and the true positives are the record of what really
 * happened.
 */
enum SecurityCaseVerdict {
  TruePositive = "True Positive",
  BenignPositive = "Benign Positive",
  FalsePositive = "False Positive",
  Undetermined = "Undetermined",
}

export interface SecurityCaseVerdictDescription {
  verdict: SecurityCaseVerdict;
  description: string;
}

// In the order the close dialog offers them, each with what it means.
export const SECURITY_CASE_VERDICTS: ReadonlyArray<SecurityCaseVerdictDescription> =
  [
    {
      verdict: SecurityCaseVerdict.TruePositive,
      description: "Malicious or unauthorized activity really happened.",
    },
    {
      verdict: SecurityCaseVerdict.BenignPositive,
      description:
        "The activity was real but expected, such as a penetration test or an admin task.",
    },
    {
      verdict: SecurityCaseVerdict.FalsePositive,
      description:
        "The detection was wrong: the rule or the data misread normal activity.",
    },
    {
      verdict: SecurityCaseVerdict.Undetermined,
      description: "There was not enough information to tell.",
    },
  ];

export function isSecurityCaseVerdict(
  value: unknown,
): value is SecurityCaseVerdict {
  return (
    typeof value === "string" &&
    SECURITY_CASE_VERDICTS.some(
      (item: SecurityCaseVerdictDescription): boolean => {
        return item.verdict === value;
      },
    )
  );
}

export function getSecurityCaseVerdictColor(
  verdict: SecurityCaseVerdict | string | undefined | null,
): Color {
  switch (verdict) {
    case SecurityCaseVerdict.TruePositive:
      return Red;
    case SecurityCaseVerdict.BenignPositive:
      return Yellow;
    case SecurityCaseVerdict.FalsePositive:
      return Green;
    default:
      return Gray500;
  }
}

export default SecurityCaseVerdict;
