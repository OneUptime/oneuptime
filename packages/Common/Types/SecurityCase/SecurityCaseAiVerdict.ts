import Color from "../Color";
import { Gray500, Green, Red, Yellow } from "../BrandColors";
import SecurityCaseVerdict from "./SecurityCaseVerdict";

/*
 * What OneUptime AI made of a security case when it triaged it: its read of
 * the case, never the case's verdict. A person closes a case and picks the
 * verdict (SecurityCaseVerdict); this only suggests one, so a triage can
 * never close, dismiss or quiet a case by itself.
 *
 * The four reads line up with the four verdicts a case closes with:
 *
 *   Likely Malicious       -> True Positive
 *   Likely Benign          -> Benign Positive (real, but expected)
 *   Likely False Positive  -> False Positive (the rule misread it)
 *   Inconclusive           -> no suggestion: a person has to look
 *
 * Inconclusive is also what a triage settles on when it cannot tell, when
 * its answer could not be read, and when the case's own data holds text
 * written to steer an AI and the triage would otherwise have waved the case
 * through (SecurityCaseTriageDecision): every doubt falls toward a person
 * looking, never toward a case being let go.
 */
enum SecurityCaseAiVerdict {
  LikelyMalicious = "Likely Malicious",
  LikelyBenign = "Likely Benign",
  LikelyFalsePositive = "Likely False Positive",
  Inconclusive = "Inconclusive",
}

export interface SecurityCaseAiVerdictDescription {
  verdict: SecurityCaseAiVerdict;
  // The word the model writes on its "Verdict:" line.
  token: string;
  // What it means, in a sentence.
  description: string;
  // The verdict the close dialog starts on, when there is one to suggest.
  suggestedCloseVerdict?: SecurityCaseVerdict | undefined;
}

// In the order a reader weighs them: the worst first.
export const SECURITY_CASE_AI_VERDICTS: ReadonlyArray<SecurityCaseAiVerdictDescription> =
  [
    {
      verdict: SecurityCaseAiVerdict.LikelyMalicious,
      token: "malicious",
      description: "The evidence points at malicious or unauthorized activity.",
      suggestedCloseVerdict: SecurityCaseVerdict.TruePositive,
    },
    {
      verdict: SecurityCaseAiVerdict.LikelyBenign,
      token: "benign",
      description:
        "The activity looks real but expected, such as an admin task or a scan your team runs.",
      suggestedCloseVerdict: SecurityCaseVerdict.BenignPositive,
    },
    {
      verdict: SecurityCaseAiVerdict.LikelyFalsePositive,
      token: "false-positive",
      description: "The detection looks like it misread normal activity.",
      suggestedCloseVerdict: SecurityCaseVerdict.FalsePositive,
    },
    {
      verdict: SecurityCaseAiVerdict.Inconclusive,
      token: "inconclusive",
      description:
        "There was not enough evidence to tell. A person has to look.",
    },
  ];

export function isSecurityCaseAiVerdict(
  value: unknown,
): value is SecurityCaseAiVerdict {
  return (
    typeof value === "string" &&
    SECURITY_CASE_AI_VERDICTS.some(
      (item: SecurityCaseAiVerdictDescription): boolean => {
        return item.verdict === value;
      },
    )
  );
}

export function getSecurityCaseAiVerdictDescription(
  verdict: SecurityCaseAiVerdict | string | undefined | null,
): SecurityCaseAiVerdictDescription | undefined {
  return SECURITY_CASE_AI_VERDICTS.find(
    (item: SecurityCaseAiVerdictDescription): boolean => {
      return item.verdict === verdict;
    },
  );
}

/*
 * The read a "Verdict:" line's word names, or undefined for any other word:
 * the caller decides what an unreadable answer means (Inconclusive).
 */
export function securityCaseAiVerdictFromToken(
  token: string | undefined | null,
): SecurityCaseAiVerdict | undefined {
  const normalized: string = (token || "").trim().toLowerCase();

  return SECURITY_CASE_AI_VERDICTS.find(
    (item: SecurityCaseAiVerdictDescription): boolean => {
      return item.token === normalized;
    },
  )?.verdict;
}

// The verdict the close dialog starts on, or undefined to start on none.
export function getSuggestedCloseVerdict(
  verdict: SecurityCaseAiVerdict | string | undefined | null,
): SecurityCaseVerdict | undefined {
  return getSecurityCaseAiVerdictDescription(verdict)?.suggestedCloseVerdict;
}

/*
 * Whether this read would let a case go - expected activity or a false
 * alarm - which is the read text written to steer an AI is after.
 */
export function isDismissingSecurityCaseAiVerdict(
  verdict: SecurityCaseAiVerdict | string | undefined | null,
): boolean {
  return (
    verdict === SecurityCaseAiVerdict.LikelyBenign ||
    verdict === SecurityCaseAiVerdict.LikelyFalsePositive
  );
}

// The colors of the close verdicts each read suggests.
export function getSecurityCaseAiVerdictColor(
  verdict: SecurityCaseAiVerdict | string | undefined | null,
): Color {
  switch (verdict) {
    case SecurityCaseAiVerdict.LikelyMalicious:
      return Red;
    case SecurityCaseAiVerdict.LikelyBenign:
      return Yellow;
    case SecurityCaseAiVerdict.LikelyFalsePositive:
      return Green;
    default:
      return Gray500;
  }
}

export default SecurityCaseAiVerdict;
