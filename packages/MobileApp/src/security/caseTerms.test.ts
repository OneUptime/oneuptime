import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_CASE_AI_VERDICTS,
  SECURITY_CASE_VERDICTS,
  SECURITY_ENTITY_TERMS,
  TRIAGE_INJECTION_LEAD_PREFIX,
  describeCaseSource,
  getAiVerdictTerm,
  getEntityTerm,
  getTriageReportBody,
  isSecurityCaseVerdict,
  readCaseEntities,
  type SecurityCaseAiVerdictTerm,
} from "./caseTerms";

/*
 * The words a case is read in. Common's SecurityCaseMobileParity holds every
 * value and sentence here to the server's; this suite pins how the app reads
 * what the API hands it - entities as stored, a triage report with the
 * runner's own lines around the model's - so a malformed row never takes the
 * case's screen down.
 */

describe("verdicts", () => {
  test("four, the worst first, each with what it means", () => {
    expect(
      SECURITY_CASE_VERDICTS.map((term: { verdict: string }) => {
        return term.verdict;
      }),
    ).toEqual([
      "True Positive",
      "Benign Positive",
      "False Positive",
      "Undetermined",
    ]);
    for (const term of SECURITY_CASE_VERDICTS) {
      expect(term.description.length).toBeGreaterThan(20);
    }
  });

  test("only the server's own values count as a verdict", () => {
    expect(isSecurityCaseVerdict("True Positive")).toBe(true);
    expect(isSecurityCaseVerdict("true positive")).toBe(false);
    expect(isSecurityCaseVerdict("")).toBe(false);
    expect(isSecurityCaseVerdict(null)).toBe(false);
    expect(isSecurityCaseVerdict(undefined)).toBe(false);
  });
});

describe("OneUptime AI's reads", () => {
  test("each read suggests the verdict it lines up with, Inconclusive none", () => {
    const suggestions: Record<string, string | undefined> = {};
    for (const term of SECURITY_CASE_AI_VERDICTS) {
      suggestions[term.verdict] = term.suggestedCloseVerdict;
    }

    expect(suggestions).toEqual({
      "Likely Malicious": "True Positive",
      "Likely Benign": "Benign Positive",
      "Likely False Positive": "False Positive",
      Inconclusive: undefined,
    });
  });

  test("a read is drawn in the colour family of the verdict it suggests", () => {
    const tones: Record<string, SecurityCaseAiVerdictTerm["tone"]> = {};
    for (const term of SECURITY_CASE_AI_VERDICTS) {
      tones[term.verdict] = term.tone;
    }

    expect(tones).toEqual({
      "Likely Malicious": "danger",
      "Likely Benign": "warning",
      "Likely False Positive": "success",
      Inconclusive: "neutral",
    });
  });

  test("a read this build does not know reads as no read at all", () => {
    expect(getAiVerdictTerm("Likely Malicious")?.tone).toBe("danger");
    expect(getAiVerdictTerm("Definitely fine")).toBeUndefined();
    expect(getAiVerdictTerm(null)).toBeUndefined();
  });
});

describe("entities", () => {
  test("every type has an icon and a reader's word", () => {
    for (const term of SECURITY_ENTITY_TERMS) {
      expect(term.label.length).toBeGreaterThan(0);
      expect(term.icon.length).toBeGreaterThan(0);
    }
    expect(getEntityTerm("IP Address").label).toBe("IP address");
  });

  test("an unknown type reads as Other", () => {
    expect(getEntityTerm("Mainframe").type).toBe("Other");
    expect(getEntityTerm(undefined).type).toBe("Other");
  });

  test("a case's stored entities are read defensively", () => {
    expect(
      readCaseEntities([
        { type: "User", value: " alice@acme.test " },
        { type: "Host", value: "web-01" },
        { type: "Mainframe", value: "z15" },
        { type: "User", value: "ALICE@acme.test" },
        { type: "User", value: "" },
        { type: "User" },
        null,
        "a string",
        ["an", "array"],
      ]),
    ).toEqual([
      { type: "User", value: "alice@acme.test" },
      { type: "Host", value: "web-01" },
      { type: "Other", value: "z15" },
    ]);
  });

  test("no entities, or something that is not a list, is an empty list", () => {
    expect(readCaseEntities(undefined)).toEqual([]);
    expect(readCaseEntities(null)).toEqual([]);
    expect(readCaseEntities({ type: "User", value: "alice" })).toEqual([]);
  });
});

describe("what opened the case", () => {
  test("each source in the app's own words", () => {
    expect(describeCaseSource("Detection Rule")).toBe("Detection rule");
    expect(describeCaseSource("Threat Intel")).toBe("Threat intel");
    expect(describeCaseSource("Connected Product")).toBe("Connected product");
    expect(describeCaseSource("Entity Risk")).toBe("Entity risk");
    expect(describeCaseSource("Manual")).toBe("A person");
  });

  test("a source this build does not know reads as stored; none reads as nothing", () => {
    expect(describeCaseSource("Honeypot")).toBe("Honeypot");
    expect(describeCaseSource("")).toBe("");
    expect(describeCaseSource(null)).toBe("");
  });
});

describe("the triage report as the phone draws it", () => {
  const HEADING: string = "## 🧠 AI — Security Case Triage";
  const LEAD: string = `${TRIAGE_INJECTION_LEAD_PREFIX} - a sign of an attempt to steer the triage. OneUptime AI treated it as data and leaves the call to a person.`;

  test("without the brand heading, which the section's own title replaces", () => {
    expect(
      getTriageReportBody(
        `${HEADING}\n\n**Summary**\nA brute force that ended in a success.`,
      ),
    ).toBe("**Summary**\nA brute force that ended in a success.");
  });

  test("without the runner's heads-up, which the section shows as a warning", () => {
    expect(
      getTriageReportBody(
        `${HEADING}\n\n${LEAD}\n\n**Summary**\nThe team's own scanner.`,
      ),
    ).toBe("**Summary**\nThe team's own scanner.");
  });

  test("a heads-up with no heading before it is still left out", () => {
    expect(getTriageReportBody(`${LEAD}\n\n**Summary**\nA scan.`)).toBe(
      "**Summary**\nA scan.",
    );
  });

  test("the model's own text stays, even when it says heads up", () => {
    const report: string = `${HEADING}\n\n**Summary**\n**Heads up:** the host is a domain controller.`;

    expect(getTriageReportBody(report)).toBe(
      "**Summary**\n**Heads up:** the host is a domain controller.",
    );
  });

  test("a report that is not text, or is empty, draws nothing", () => {
    expect(getTriageReportBody(undefined)).toBe("");
    expect(getTriageReportBody(null)).toBe("");
    expect(getTriageReportBody({ _type: "Markdown" })).toBe("");
    expect(getTriageReportBody("   \n  ")).toBe("");
  });
});
