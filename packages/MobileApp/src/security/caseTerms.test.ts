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
  readSummaryLabel,
  splitTriageReport,
  type SecurityCaseAiVerdictTerm,
  type TriageReportParts,
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

describe("the triage's Summary, lifted above the rest of the report", () => {
  const HEADING: string = "## 🧠 AI — Security Case Triage";
  const LEAD: string = `${TRIAGE_INJECTION_LEAD_PREFIX} - a sign of an attempt to steer the triage.`;
  const FOOTER: string =
    "---\n*Investigated automatically by OneUptime AI — read-only, 3 queries run across your own telemetry. This is an AI-generated first pass; verify before acting.*";

  function split(...lines: Array<string>): TriageReportParts {
    return splitTriageReport([HEADING, "", ...lines].join("\n"));
  }

  test("the report as the triage is asked to write it: the Summary, then the rest", () => {
    const parts: TriageReportParts = split(
      "**Summary**",
      "Fourteen failed VPN sign-ins for alice@acme.test, then one that succeeded.",
      "This is most likely a password spray.",
      "",
      "**Assessment**",
      "Likely malicious [C1].",
      "",
      "**Suggested next steps**",
      "1. Suspend alice@acme.test in Okta.",
      "",
      FOOTER,
    );

    expect(parts.summary).toBe(
      "Fourteen failed VPN sign-ins for alice@acme.test, then one that succeeded.\nThis is most likely a password spray.",
    );
    expect(parts.rest).toBe(
      `**Assessment**\nLikely malicious [C1].\n\n**Suggested next steps**\n1. Suspend alice@acme.test in Okta.\n\n${FOOTER}`,
    );
  });

  test("whatever way the label is written", () => {
    const shapes: Array<Array<string>> = [
      ["**Summary**", "A spray."],
      ["**Summary:**", "A spray."],
      ["**Summary**:", "A spray."],
      ["**Summary** - A spray."],
      ["**Summary** — A spray."],
      ["**Summary:** A spray."],
      ["**Summary**: A spray."],
      ["***Summary***", "A spray."],
      ["__Summary__", "A spray."],
      ["**Summary (high confidence)**", "A spray."],
      ["**TL;DR**", "A spray."],
      ["## Summary", "A spray."],
      ["### Summary ###", "A spray."],
      ["Summary: A spray."],
      ["TL;DR: A spray."],
      ["**Summary**", "", "", "A spray."],
    ];

    for (const shape of shapes) {
      expect(split(...shape, "", "**Assessment**", "Bad.")).toEqual({
        summary: "A spray.",
        rest: "**Assessment**\nBad.",
      });
    }
  });

  test("after the runner's heads-up, which the AI section says as a warning", () => {
    expect(split(LEAD, "", "**Summary**", "A spray.").summary).toBe("A spray.");
  });

  test("its first paragraph, which a line that could open anything else ends sooner", () => {
    const enders: Array<string> = [
      "",
      "**Assessment**",
      "**Evidence:** fourteen rows.",
      "__Evidence__",
      "### Evidence",
      "Evidence: fourteen rows.",
      "Root cause (likely): a leaked password.",
      "---",
      "***",
      "```",
      "~~~",
    ];

    for (const ender of enders) {
      const parts: TriageReportParts = split(
        "**Summary**",
        "A spray.",
        ender,
        "More.",
      );

      expect(parts.summary).toBe("A spray.");
      expect(parts.rest).toBe([ender, "More."].join("\n").trim());
    }
  });

  test("lines that only read like labels stay in it", () => {
    expect(
      split(
        "**Summary**",
        "Fourteen failed sign-ins:",
        "- from 203.0.113.24",
        "- in six minutes",
        "Note: the address is new.",
      ).summary,
    ).toBe(
      "Fourteen failed sign-ins:\n- from 203.0.113.24\n- in six minutes\nNote: the address is new.",
    );
  });

  test("a report that does not open with its Summary lifts nothing, and folds whole", () => {
    const reports: Array<Array<string>> = [
      ["Some words first.", "", "**Summary**", "A spray."],
      ["**Assessment**", "Bad."],
      ["**Summary** is below.", "", "A spray."],
      ["Summary (v2): A spray."],
      ["**Summary**"],
      ["**Summary**", "", "**Assessment**", "Bad."],
      ["**Summary**", "**Alice** signed in from Lisbon."],
      ["Summary"],
      ["#Summary", "A spray."],
      ["####### Summary", "A spray."],
    ];

    for (const lines of reports) {
      const report: string = [HEADING, "", ...lines].join("\n");

      expect(splitTriageReport(report)).toEqual({
        summary: "",
        rest: getTriageReportBody(report),
      });
    }
  });

  test("a report that is not text lifts nothing", () => {
    for (const report of [undefined, null, 42, { _type: "Markdown" }, ""]) {
      expect(splitTriageReport(report)).toEqual({ summary: "", rest: "" });
    }
  });

  test("a label is read only at the start of the line", () => {
    expect(readSummaryLabel("**Summary**")).toEqual({ text: "" });
    expect(readSummaryLabel("  **Summary:** A spray.  ")).toEqual({
      text: "A spray.",
    });
    expect(readSummaryLabel("The **Summary** follows.")).toBeNull();
    expect(readSummaryLabel("**Summaries**")).toBeNull();
    expect(readSummaryLabel("**")).toBeNull();
    expect(readSummaryLabel("****")).toBeNull();
    expect(readSummaryLabel("")).toBeNull();
  });

  test("reads megabytes of one shape in time in line with their length", () => {
    const long: number = 400000;
    const worst: Array<string> = [
      `**${"*".repeat(long)}`,
      `**Summary**\n${"**".repeat(long / 2)}`,
      `**Summary**\n${"a ".repeat(long / 2)}:`,
      `Summary${" ".repeat(long)}:`,
      `${"#".repeat(long)} Summary`,
      `**Summary**\n${"x\n".repeat(long / 2)}`,
      `**Summary** ${"-".repeat(long)}`,
      `## ${"#".repeat(long)}`,
    ];

    for (const report of worst) {
      const started: number = Date.now();
      splitTriageReport(report);
      expect(Date.now() - started).toBeLessThan(2000);
    }
  });
});
