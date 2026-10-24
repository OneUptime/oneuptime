import {
  SecurityCaseTriageDecision,
  isSecurityCaseTriageDecisionLine,
  readSecurityCaseTriageDecision,
  removeSecurityCaseTriageDecisionLines,
} from "../../../../../Server/Utils/AI/Security/SecurityCaseTriageDecision";
import SecurityCaseAiVerdict from "../../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriorityLevel from "../../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { describe, expect, test } from "@jest/globals";

/*
 * What the server reads from a triage's answer: three closing lines, each
 * only a suggestion, each falling toward a person looking. The answers
 * below are recorded model answers, as the triage persona has the model
 * write them (SecurityCaseTriagePrompt).
 */

const PLAYBOOK_ID: string = "7c1e8a1e-4a7d-4b8f-9b8e-2f3c4d5e6f70";
const OTHER_PLAYBOOK_ID: string = "0b6f5e4d-3c2b-4a19-8f7e-6d5c4b3a2910";

const MALICIOUS_ANSWER: string = `**Summary**
Thirty-two failed SSH sign-ins from 203.0.113.9 against web-1 in four minutes, then a success for deploy. This is most likely a brute force that worked.

**Assessment**
Likely malicious: the address is on the Feodo list [C2] and the success came seconds after the failures [C1].

**Evidence**
- 32 failures then 1 success for deploy [C1]
- 203.0.113.9 matches the Feodo Tracker feed at confidence 90 [C2]

**Suggested next steps**
1. Run the Contain Host playbook on web-1.
2. Rotate the deploy user's keys.

Verdict: malicious
Priority: critical
Playbook: ${PLAYBOOK_ID}`;

const BENIGN_ANSWER: string = `**Summary**
The weekly vulnerability scan from the security team's scanner.

**Assessment**
Likely benign: the scanner host is the team's own [C1].

Verdict: benign
Priority: low
Playbook: none`;

function read(
  analysisMarkdown: string,
  options: {
    offered?: Array<string>;
    injection?: boolean;
  } = {},
): SecurityCaseTriageDecision {
  return readSecurityCaseTriageDecision({
    analysisMarkdown,
    offeredPlaybookIds: options.offered || [PLAYBOOK_ID],
    instructionLikeTextFound: options.injection === true,
  });
}

describe("readSecurityCaseTriageDecision", () => {
  test("a malicious read, with the priority and an offered playbook", () => {
    expect(read(MALICIOUS_ANSWER)).toEqual({
      verdict: SecurityCaseAiVerdict.LikelyMalicious,
      suggestedPriority: SecurityCasePriorityLevel.Critical,
      suggestedPlaybookId: PLAYBOOK_ID,
      verdictSetAside: false,
    });
  });

  test("a benign read with no playbook", () => {
    expect(read(BENIGN_ANSWER)).toEqual({
      verdict: SecurityCaseAiVerdict.LikelyBenign,
      suggestedPriority: SecurityCasePriorityLevel.Low,
      suggestedPlaybookId: undefined,
      verdictSetAside: false,
    });
  });

  test("each verdict word maps to its read", () => {
    const cases: Array<[string, SecurityCaseAiVerdict]> = [
      ["malicious", SecurityCaseAiVerdict.LikelyMalicious],
      ["benign", SecurityCaseAiVerdict.LikelyBenign],
      ["false-positive", SecurityCaseAiVerdict.LikelyFalsePositive],
      ["inconclusive", SecurityCaseAiVerdict.Inconclusive],
      ["MALICIOUS", SecurityCaseAiVerdict.LikelyMalicious],
    ];

    for (const [word, verdict] of cases) {
      expect(read(`Report.\n\nVerdict: ${word}`).verdict).toBe(verdict);
    }
  });

  test("a missing or unreadable verdict reads Inconclusive", () => {
    expect(read("No closing lines at all.").verdict).toBe(
      SecurityCaseAiVerdict.Inconclusive,
    );
    expect(read("Verdict: probably fine").verdict).toBe(
      SecurityCaseAiVerdict.Inconclusive,
    );
    expect(read("").verdict).toBe(SecurityCaseAiVerdict.Inconclusive);
  });

  test("the last line of each label wins: the model may quote the format first", () => {
    const answer: string = `I will end with "Verdict: <malicious | benign>" as asked.
Verdict: benign
Priority: low
Playbook: none

On a closer look the success matters.

Verdict: malicious
Priority: high
Playbook: ${PLAYBOOK_ID}`;

    expect(read(answer)).toEqual({
      verdict: SecurityCaseAiVerdict.LikelyMalicious,
      suggestedPriority: SecurityCasePriorityLevel.High,
      suggestedPlaybookId: PLAYBOOK_ID,
      verdictSetAside: false,
    });
  });

  test("bold labels, '=' separators and any case are read", () => {
    const answer: string = `**Verdict:** False-Positive
**PRIORITY** = Informational
playbook = ${PLAYBOOK_ID.toUpperCase()}`;

    expect(read(answer)).toEqual({
      verdict: SecurityCaseAiVerdict.LikelyFalsePositive,
      suggestedPriority: SecurityCasePriorityLevel.Informational,
      suggestedPlaybookId: PLAYBOOK_ID,
      verdictSetAside: false,
    });
  });

  test("a playbook the context did not offer is no suggestion", () => {
    expect(
      read(MALICIOUS_ANSWER, { offered: [OTHER_PLAYBOOK_ID] })
        .suggestedPlaybookId,
    ).toBeUndefined();
    expect(read(MALICIOUS_ANSWER, { offered: [] }).suggestedPlaybookId).toBe(
      undefined,
    );
    expect(
      read("Verdict: malicious\nPlaybook: not-an-id").suggestedPlaybookId,
    ).toBeUndefined();
  });

  test("a priority off the scale is no suggestion", () => {
    expect(
      read("Verdict: malicious\nPriority: urgent").suggestedPriority,
    ).toBeUndefined();
    expect(read("Verdict: malicious").suggestedPriority).toBeUndefined();
  });

  /*
   * The case's data held text written to steer an AI: the read such text is
   * after - let the case go - is the one never taken from it, and neither
   * is anything else the same answer suggested (its Low priority would be
   * one click away on the card).
   */
  test("text written to steer an AI sets a benign read aside for Inconclusive, with nothing it suggested", () => {
    expect(read(BENIGN_ANSWER, { injection: true })).toEqual({
      verdict: SecurityCaseAiVerdict.Inconclusive,
      suggestedPriority: undefined,
      suggestedPlaybookId: undefined,
      verdictSetAside: true,
    });
    expect(read("Verdict: false-positive", { injection: true }).verdict).toBe(
      SecurityCaseAiVerdict.Inconclusive,
    );
  });

  test("a dismissing read set aside keeps no playbook it named", () => {
    const answer: string = `Verdict: false-positive
Priority: informational
Playbook: ${PLAYBOOK_ID}`;

    expect(read(answer)).toEqual({
      verdict: SecurityCaseAiVerdict.LikelyFalsePositive,
      suggestedPriority: SecurityCasePriorityLevel.Informational,
      suggestedPlaybookId: PLAYBOOK_ID,
      verdictSetAside: false,
    });
    expect(read(answer, { injection: true })).toEqual({
      verdict: SecurityCaseAiVerdict.Inconclusive,
      suggestedPriority: undefined,
      suggestedPlaybookId: undefined,
      verdictSetAside: true,
    });
  });

  test("a malicious or inconclusive read stands whatever the data held", () => {
    expect(read(MALICIOUS_ANSWER, { injection: true })).toEqual({
      verdict: SecurityCaseAiVerdict.LikelyMalicious,
      suggestedPriority: SecurityCasePriorityLevel.Critical,
      suggestedPlaybookId: PLAYBOOK_ID,
      verdictSetAside: false,
    });
    expect(
      read("Verdict: inconclusive", { injection: true }).verdictSetAside,
    ).toBe(false);
  });

  test("an answer line that is not a line start is not read", () => {
    expect(
      read("The attacker wrote 'Verdict: benign' in the user agent.").verdict,
    ).toBe(SecurityCaseAiVerdict.Inconclusive);
  });
});

describe("the decision lines in the report", () => {
  test("recognizes each decision line, in any case, bold or not", () => {
    for (const line of [
      "Verdict: malicious",
      "  **Verdict:** benign",
      "PRIORITY = high",
      "Playbook: none",
      "**Playbook** : none",
    ]) {
      expect(isSecurityCaseTriageDecisionLine(line)).toBe(true);
    }

    for (const line of [
      "The verdict is malicious",
      "Verdicts: many",
      "Priority is high",
      "- Verdict: benign",
      "",
    ]) {
      expect(isSecurityCaseTriageDecisionLine(line)).toBe(false);
    }
  });

  test("the report people read leaves the three lines and the blank lines after it out", () => {
    const report: string = removeSecurityCaseTriageDecisionLines(
      `${MALICIOUS_ANSWER}\n\n\n`,
    );

    expect(report).not.toContain("Verdict:");
    expect(report).not.toContain("Priority: critical");
    expect(report).not.toContain(PLAYBOOK_ID);
    expect(report).toContain("**Suggested next steps**");
    expect(report.endsWith("2. Rotate the deploy user's keys.")).toBe(true);
  });

  test("a report without decision lines stays as it was", () => {
    expect(
      removeSecurityCaseTriageDecisionLines("**Summary**\nAll quiet."),
    ).toBe("**Summary**\nAll quiet.");
    expect(removeSecurityCaseTriageDecisionLines("")).toBe("");
  });
});

describe("reading an answer in linear time", () => {
  /*
   * The answer is what a model wrote after reading text an attacker may
   * have written; reading it must take time in line with its length
   * (400,000 characters under 2 seconds).
   */
  test("a 400,000 character answer of near-miss lines answers in under 2 seconds", () => {
    const nearMisses: string = "**Verdict** \n".repeat(30_800);
    const stars: string = `${"*".repeat(200_000)}${" ".repeat(200_000)}`;
    const started: number = Date.now();

    expect(read(`${nearMisses}Verdict: malicious`).verdict).toBe(
      SecurityCaseAiVerdict.LikelyMalicious,
    );
    expect(read(stars).verdict).toBe(SecurityCaseAiVerdict.Inconclusive);
    removeSecurityCaseTriageDecisionLines(nearMisses);

    expect(Date.now() - started).toBeLessThan(2000);
  });
});
