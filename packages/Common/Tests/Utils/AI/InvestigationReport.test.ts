import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import {
  AI_ROOT_CAUSE_HEADING_TEXT,
  DEFAULT_EVENT_REFERENCE_LIMIT,
  ExtractedInvestigationEventReference,
  InvestigationEventReferenceToken,
  InvestigationEvidenceCheckedEntry,
  InvestigationReportSection,
  InvestigationReportSectionKind,
  ParsedInvestigationReport,
  extractEventReferences,
  getCitationMarkerRegex,
  parseInvestigationReport,
  tokenizeEventReferences,
} from "../../../Utils/AI/InvestigationReport";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";

/*
 * The investigation panel lays the AI report out section by section, links
 * the incidents it mentions and lists the evidence it checked; the API uses
 * the same helpers to label evidence and resolve references. Every one of
 * those reads model-authored text, so these tests pin both the formats a
 * model actually produces and the places where it must NOT be believed
 * (fenced code, a fake "Evidence checked" block, bold prose).
 */

interface BrandedCitation {
  id: string;
  label: string;
  rowCount: number;
  // The tool that produced it; the cluster tools are worded apart.
  toolName?: string | undefined;
}

/*
 * A line-for-line copy of AIInvestigationEngine.describeClusterCitationOutcome
 * (see the source pin at the bottom of this file).
 */
function describeClusterCitationOutcome(
  citation: BrandedCitation,
): string | null {
  if (citation.toolName === RUN_KUBECTL_TOOL_NAME) {
    return citation.rowCount > 0 ? "succeeded" : "kubectl returned an error";
  }

  if (citation.toolName === LIST_CLUSTER_ACCESS_TOOL_NAME) {
    return `${citation.rowCount} cluster(s)`;
  }

  return null;
}

/*
 * A line-for-line copy of AIInvestigationEngine.buildBrandedMarkdown, so the
 * parser is tested against the exact string the server posts — the
 * telemetry-only footer and the one a run that used cluster tools gets. The
 * source pin at the bottom of this file fails if the server format drifts.
 */
function buildBrandedMarkdown(data: {
  analysisMarkdown: string;
  citations: Array<BrandedCitation>;
  toolCallCount: number;
  modelName?: string | undefined;
  clusterToolCallCount?: number | undefined;
}): string {
  let markdown: string = `## 🧠 AI — Automated Root Cause Analysis\n\n${data.analysisMarkdown}`;

  const citations: Array<BrandedCitation> = data.citations;
  const clusterToolCallCount: number = data.clusterToolCallCount ?? 0;

  if (citations.length > 0) {
    markdown += `\n\n**Evidence checked**`;
    for (const citation of citations.slice(0, 15)) {
      const clusterOutcome: string | null =
        describeClusterCitationOutcome(citation);

      if (clusterOutcome !== null) {
        markdown += `\n- **[${citation.id}]** ${citation.label} — ${clusterOutcome}`;
        continue;
      }

      markdown += `\n- **[${citation.id}]** ${citation.label} — ${citation.rowCount} row(s)`;
    }
  }

  if (clusterToolCallCount <= 0) {
    markdown += `\n\n---\n*Investigated automatically by OneUptime AI — read-only, ${data.toolCallCount} quer${
      data.toolCallCount === 1 ? "y" : "ies"
    } run across your own telemetry${
      data.modelName ? ` using ${data.modelName}` : ""
    }. This is an AI-generated first pass; verify before acting.*`;

    return markdown;
  }

  const telemetryQueryCount: number = Math.max(
    0,
    data.toolCallCount - clusterToolCallCount,
  );
  const kubectlCommandCount: number = citations.filter(
    (citation: BrandedCitation): boolean => {
      return citation.toolName === RUN_KUBECTL_TOOL_NAME;
    },
  ).length;
  const counts: Array<string> = [];

  if (telemetryQueryCount > 0) {
    counts.push(
      `${telemetryQueryCount} quer${
        telemetryQueryCount === 1 ? "y" : "ies"
      } run across your own telemetry`,
    );
  }

  if (kubectlCommandCount > 0) {
    counts.push(
      `${kubectlCommandCount} kubectl ${
        kubectlCommandCount === 1 ? "command" : "commands"
      } run on your Kubernetes clusters`,
    );
  }

  if (counts.length === 0) {
    counts.push("no telemetry queries or kubectl commands run");
  }

  markdown += `\n\n---\n*Investigated automatically by OneUptime AI — read-only, ${counts.join(
    " and ",
  )}${
    data.modelName ? ` using ${data.modelName}` : ""
  }. This is an AI-generated first pass; verify before acting.*`;

  return markdown;
}

const MODEL_ANALYSIS: string = [
  "**Summary** — Checkout is failing because the payments database connection pool is exhausted [C2].",
  "",
  "**Most likely root cause** — Deploy 4711 cut the pool size from 50 to 5 [C3]. This matches prior incidents #6954 and #6963.",
  "",
  "**Evidence**",
  "- Error rate on checkout-api jumped to 45% at 18:02 [C1].",
  "- p95 connection wait went from 2ms to 3.4s [C2].",
  "",
  "**Suggested next steps**",
  "1. Roll back deploy 4711.",
  "2. Restore the pool size to 50.",
].join("\n");

const CITATIONS: Array<BrandedCitation> = [
  { id: "C1", label: "Active incidents (7 total)", rowCount: 7 },
  { id: "C2", label: "Metric db.pool.wait — p95 — last hour", rowCount: 120 },
  { id: "C3", label: 'Logs matching "pool size"', rowCount: 0 },
  { id: "C4", label: "Incident #6954 timeline", rowCount: 1 },
];

const SERVER_REPORT: string = buildBrandedMarkdown({
  analysisMarkdown: MODEL_ANALYSIS,
  citations: CITATIONS,
  toolCallCount: 4,
  modelName: "gpt-4.1-mini",
});

function kindsOf(
  report: ParsedInvestigationReport,
): Array<InvestigationReportSectionKind> {
  return report.sections.map(
    (section: InvestigationReportSection): InvestigationReportSectionKind => {
      return section.kind;
    },
  );
}

function titlesOf(report: ParsedInvestigationReport): Array<string> {
  return report.sections.map((section: InvestigationReportSection): string => {
    return section.title;
  });
}

function referencesOf(
  text: string,
): Array<{ kind: string | null; number: number; text: string }> {
  return tokenizeEventReferences(text).map(
    (
      token: InvestigationEventReferenceToken,
    ): { kind: string | null; number: number; text: string } => {
      return {
        kind: token.kind,
        number: token.number,
        text: text.slice(token.start, token.end),
      };
    },
  );
}

describe("parseInvestigationReport — the real server format", () => {
  const report: ParsedInvestigationReport =
    parseInvestigationReport(SERVER_REPORT);

  test("recognises the four sections the investigation persona asks for, in order", () => {
    expect(report.isStructured).toBe(true);
    expect(kindsOf(report)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.NextSteps,
    ]);
    expect(titlesOf(report)).toEqual([
      "Summary",
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
    ]);
  });

  test("section bodies drop the label and its separator but keep citations and references verbatim", () => {
    expect(report.summary).toBe(
      "Checkout is failing because the payments database connection pool is exhausted [C2].",
    );
    expect(report.rootCause).toBe(
      "Deploy 4711 cut the pool size from 50 to 5 [C3]. This matches prior incidents #6954 and #6963.",
    );
    expect(report.evidence).toBe(
      "- Error rate on checkout-api jumped to 45% at 18:02 [C1].\n- p95 connection wait went from 2ms to 3.4s [C2].",
    );
    expect(report.nextSteps).toBe(
      "1. Roll back deploy 4711.\n2. Restore the pool size to 50.",
    );
  });

  test("the Suggested next steps body does not swallow the Evidence checked list or the footer", () => {
    expect(report.nextSteps).not.toContain("Evidence checked");
    expect(report.nextSteps).not.toContain("[C1]**");
    expect(report.nextSteps).not.toContain("Investigated automatically");
  });

  test("the convenience fields mirror the sections array", () => {
    for (const section of report.sections) {
      if (section.kind === InvestigationReportSectionKind.Summary) {
        expect(report.summary).toBe(section.markdown);
      }
      if (section.kind === InvestigationReportSectionKind.NextSteps) {
        expect(report.nextSteps).toBe(section.markdown);
      }
    }
  });

  test("there is no preamble: the brand heading is dropped", () => {
    expect(report.preamble).toBe("");
  });

  test("parses the Evidence checked list, keeping labels that contain ' — '", () => {
    const expected: Array<InvestigationEvidenceCheckedEntry> = [
      { citationId: "C1", label: "Active incidents (7 total)", rowCount: 7 },
      {
        citationId: "C2",
        label: "Metric db.pool.wait — p95 — last hour",
        rowCount: 120,
      },
      { citationId: "C3", label: 'Logs matching "pool size"', rowCount: 0 },
      { citationId: "C4", label: "Incident #6954 timeline", rowCount: 1 },
    ];

    expect(report.evidenceChecked).toEqual(expected);
  });

  test("parses the footer: text without emphasis, model name and query count", () => {
    expect(report.footer).toEqual({
      text: "Investigated automatically by OneUptime AI — read-only, 4 queries run across your own telemetry using gpt-4.1-mini. This is an AI-generated first pass; verify before acting.",
      modelName: "gpt-4.1-mini",
      queryCount: 4,
    });
  });

  test("bodyMarkdown keeps the model's note but not the brand heading, evidence list or footer", () => {
    expect(report.bodyMarkdown).toBe(MODEL_ANALYSIS);
    expect(report.bodyMarkdown).not.toContain(AI_ROOT_CAUSE_HEADING_TEXT);
    expect(report.bodyMarkdown).not.toContain("Evidence checked");
    expect(report.bodyMarkdown).not.toContain("---");
    expect(report.bodyMarkdown).not.toContain("Investigated automatically");
  });

  test("a report with no citations has no Evidence checked entries but still has a footer", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: MODEL_ANALYSIS,
        citations: [],
        toolCallCount: 0,
      }),
    );

    expect(parsed.evidenceChecked).toEqual([]);
    expect(parsed.footer?.queryCount).toBe(0);
    expect(parsed.footer?.modelName).toBeUndefined();
    expect(parsed.bodyMarkdown).toBe(MODEL_ANALYSIS);
    expect(parsed.nextSteps).toBe(
      "1. Roll back deploy 4711.\n2. Restore the pool size to 50.",
    );
  });

  test("only the first 15 citations appear in the server list, and all of them parse", () => {
    const many: Array<BrandedCitation> = [];
    for (let index: number = 1; index <= 20; index++) {
      many.push({ id: `C${index}`, label: `Query ${index}`, rowCount: index });
    }

    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: MODEL_ANALYSIS,
        citations: many,
        toolCallCount: 20,
      }),
    );

    expect(parsed.evidenceChecked).toHaveLength(15);
    expect(parsed.evidenceChecked[14]).toEqual({
      citationId: "C15",
      label: "Query 15",
      rowCount: 15,
    });
  });

  test("the legacy brand heading without the emoji is dropped too", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      `## ${AI_ROOT_CAUSE_HEADING_TEXT}\n\nThe incident was caused by connection exhaustion.`,
    );

    expect(parsed.bodyMarkdown).toBe(
      "The incident was caused by connection exhaustion.",
    );
    expect(parsed.preamble).toBe(
      "The incident was caused by connection exhaustion.",
    );
    expect(parsed.isStructured).toBe(false);
    expect(parsed.sections).toEqual([]);
  });

  test("a brand-like heading that is not the first line is ordinary content", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "Intro line.\n\n## AI — Automated Root Cause Analysis\n\n**Summary** — pool ran dry.",
    );

    expect(parsed.preamble).toBe(
      "Intro line.\n\n## AI — Automated Root Cause Analysis",
    );
    expect(parsed.summary).toBe("pool ran dry.");
  });
});

describe("parseInvestigationReport — section label styles", () => {
  test("## heading style", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "## Summary",
        "",
        "The pool ran dry [C1].",
        "",
        "## Most likely root cause",
        "",
        "Deploy 4711.",
        "",
        "### Evidence",
        "- Wait time spiked [C2].",
        "",
        "# Suggested next steps ##",
        "Roll back.",
      ].join("\n"),
    );

    expect(parsed.isStructured).toBe(true);
    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.NextSteps,
    ]);
    expect(parsed.summary).toBe("The pool ran dry [C1].");
    expect(parsed.rootCause).toBe("Deploy 4711.");
    expect(parsed.evidence).toBe("- Wait time spiked [C2].");
    expect(parsed.nextSteps).toBe("Roll back.");
    expect(titlesOf(parsed)[3]).toBe("Suggested next steps");
  });

  test("**Summary:** with the body on the same line and on the following lines", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary:** The pool ran dry.",
        "It started at 18:01.",
        "",
        "**Most likely root cause:**",
        "Deploy 4711.",
      ].join("\n"),
    );

    expect(parsed.summary).toBe("The pool ran dry.\nIt started at 18:01.");
    expect(parsed.rootCause).toBe("Deploy 4711.");
    expect(titlesOf(parsed)).toEqual(["Summary", "Most likely root cause"]);
  });

  test("**Summary**: with the colon outside the emphasis", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary**: The pool ran dry.\n\n**Root cause**:\nDeploy 4711.",
    );

    expect(parsed.summary).toBe("The pool ran dry.");
    expect(parsed.rootCause).toBe("Deploy 4711.");
  });

  test("plain Summary: labels at the start of a line", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "Summary: The pool ran dry.",
        "",
        "Most likely root cause: Deploy 4711.",
        "",
        "Next steps:",
        "- Roll back.",
      ].join("\n"),
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.NextSteps,
    ]);
    expect(parsed.summary).toBe("The pool ran dry.");
    expect(parsed.rootCause).toBe("Deploy 4711.");
    expect(parsed.nextSteps).toBe("- Roll back.");
  });

  test("a plain 'Label:' line only counts for known labels", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — ok.\n\nImpact: checkout is down.\nNote: none.",
    );

    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.Summary]);
    expect(parsed.summary).toBe(
      "ok.\n\nImpact: checkout is down.\nNote: none.",
    );
  });

  test("**Summary** — text on the same line, with em dash, en dash, hyphen and double hyphen", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary** — em dash body.",
        "**Most likely root cause** – en dash body.",
        "**Evidence** - hyphen body.",
        "**Next steps** -- double hyphen body.",
      ].join("\n"),
    );

    expect(parsed.summary).toBe("em dash body.");
    expect(parsed.rootCause).toBe("en dash body.");
    expect(parsed.evidence).toBe("hyphen body.");
    expect(parsed.nextSteps).toBe("double hyphen body.");
  });

  test("a separator with no space before it still splits", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary**—tight em dash.",
    );

    expect(parsed.summary).toBe("tight em dash.");
  });

  test("__Label__ and ***Label*** emphasis", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "__Summary__\nUnderscore body.\n\n***Most likely root cause*** — bold italic body.",
    );

    expect(parsed.summary).toBe("Underscore body.");
    expect(parsed.rootCause).toBe("bold italic body.");
    expect(titlesOf(parsed)).toEqual(["Summary", "Most likely root cause"]);
  });

  test("label matching is case-insensitive and keeps the title as written", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**SUMMARY**\nLoud.\n\n## most likely ROOT cause\nQuiet.",
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
    ]);
    expect(titlesOf(parsed)).toEqual(["SUMMARY", "most likely ROOT cause"]);
  });

  test("headings with emphasis, a trailing colon or a separator and body", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "## **Summary:**",
        "One.",
        "## Root cause: Deploy 4711.",
        "## Evidence — see below",
        "- Two.",
        "## **Next steps** — Roll back.",
      ].join("\n"),
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.NextSteps,
    ]);
    expect(parsed.summary).toBe("One.");
    expect(parsed.rootCause).toBe("Deploy 4711.");
    expect(parsed.evidence).toBe("see below\n- Two.");
    expect(parsed.nextSteps).toBe("Roll back.");
  });

  test("decorative emoji and numbering in front of a heading are ignored for matching and the title", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "## 🔍 Summary\nA.\n\n### ⚠️ Most likely root cause\nB.\n\n## 3. Next steps\nC.",
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.NextSteps,
    ]);
    expect(titlesOf(parsed)).toEqual([
      "Summary",
      "Most likely root cause",
      "Next steps",
    ]);
  });

  test("a confidence qualifier after the label keeps the section and lands in the title", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary** — A.",
        "**Most likely root cause** (medium confidence) — Deploy 4711.",
        "**Evidence (partial)**",
        "- B.",
        "Next steps (urgent): Roll back.",
      ].join("\n"),
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.NextSteps,
    ]);
    expect(titlesOf(parsed)).toEqual([
      "Summary",
      "Most likely root cause (medium confidence)",
      "Evidence (partial)",
      "Next steps (urgent)",
    ]);
    expect(parsed.rootCause).toBe("Deploy 4711.");
    expect(parsed.nextSteps).toBe("Roll back.");
  });

  test.each([
    ["Summary", InvestigationReportSectionKind.Summary],
    ["TL;DR", InvestigationReportSectionKind.Summary],
    ["TLDR", InvestigationReportSectionKind.Summary],
    ["Most likely root cause", InvestigationReportSectionKind.RootCause],
    ["Likely root cause", InvestigationReportSectionKind.RootCause],
    ["Probable root cause", InvestigationReportSectionKind.RootCause],
    ["Root cause", InvestigationReportSectionKind.RootCause],
    ["Root cause hypothesis", InvestigationReportSectionKind.RootCause],
    ["Evidence", InvestigationReportSectionKind.Evidence],
    ["Key evidence", InvestigationReportSectionKind.Evidence],
    ["Supporting evidence", InvestigationReportSectionKind.Evidence],
    ["Key findings", InvestigationReportSectionKind.Evidence],
    ["Findings", InvestigationReportSectionKind.Evidence],
    ["Suggested next steps", InvestigationReportSectionKind.NextSteps],
    ["Next steps", InvestigationReportSectionKind.NextSteps],
    ["Recommended next steps", InvestigationReportSectionKind.NextSteps],
    ["Recommended actions", InvestigationReportSectionKind.NextSteps],
    ["Recommendations", InvestigationReportSectionKind.NextSteps],
  ])(
    "known label %p maps to %p in every label style",
    (label: string, kind: InvestigationReportSectionKind) => {
      const styles: Array<string> = [
        `## ${label}\nBody.`,
        `**${label}**\nBody.`,
        `**${label}:** Body.`,
        `**${label}** — Body.`,
        `${label}: Body.`,
      ];

      for (const style of styles) {
        const parsed: ParsedInvestigationReport =
          parseInvestigationReport(style);

        expect(parsed.sections).toEqual([
          { kind, title: label, markdown: "Body." },
        ]);
      }
    },
  );

  test("a bold phrase followed by prose is not a label", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n**Root cause** is still unclear.\n**Evidence** points both ways.",
    );

    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.Summary]);
    expect(parsed.summary).toBe(
      "A.\n\n**Root cause** is still unclear.\n**Evidence** points both ways.",
    );
  });

  test("an indented (code block) label is not a section", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n    **Most likely root cause** — not a heading\n\tRoot cause: nope",
    );

    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.Summary]);
    expect(parsed.summary).toContain("not a heading");
  });

  test("a label inside a list item or blockquote is not a section", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n- **Root cause** — in a list\n> **Evidence** — in a quote",
    );

    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.Summary]);
  });

  test("a confidence qualifier after a colon inside the bold keeps the section", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n**Most likely root cause:** (medium confidence) A connection leak [C2].\n\n**Evidence**\n- x",
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Evidence,
    ]);
    expect(titlesOf(parsed)[1]).toBe(
      "Most likely root cause (medium confidence)",
    );
    expect(parsed.rootCause).toBe("A connection leak [C2].");
    expect(parsed.summary).toBe("A.");
  });

  test("a bold phrase, a qualifier and then prose is still not a label", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n**Root cause** (low confidence) is unclear.\n**Impact:** (high) users could not pay.",
    );

    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.Summary]);
    expect(parsed.rootCause).toBeUndefined();
    expect(parsed.summary).toBe(
      "A.\n\n**Root cause** (low confidence) is unclear.\n**Impact:** (high) users could not pay.",
    );
  });

  /*
   * An indented line under a list item continues that item. Read as a
   * label, it cut the list in two and handed the rest of it to another
   * section, even to the root cause callout.
   */
  test.each([
    [
      "a bold-only line under a numbered item",
      "**Suggested next steps**\n1. Roll back the deploy\n   **Why**\n   because the pool is exhausted\n2. Page the DB team",
      InvestigationReportSectionKind.NextSteps,
    ],
    [
      "a bold-only line under a bullet",
      "**Evidence**\n- pool exhausted\n  **Detail**\n  more\n- error rate up",
      InvestigationReportSectionKind.Evidence,
    ],
    [
      "a known plain label under a numbered item",
      "**Suggested next steps**\n1. Roll back the deploy\n   Evidence: pool at 100%\n2. Page the DB team",
      InvestigationReportSectionKind.NextSteps,
    ],
    [
      "a known bold label with a body under a numbered item",
      "**Evidence**\n1. Pool saturation hit 100% [C1].\n   **Root cause:** a missing release() call [C2].\n2. Error rate rose 30x [C3].",
      InvestigationReportSectionKind.Evidence,
    ],
    [
      "a heading under a bullet",
      "**Evidence**\n- pool exhausted\n  ## Detail\n- error rate up",
      InvestigationReportSectionKind.Evidence,
    ],
    [
      "a label after a blank line inside the item",
      "**Suggested next steps**\n1. Roll back the deploy\n\n   **Why**\n\n   because the pool is exhausted\n2. Page the DB team",
      InvestigationReportSectionKind.NextSteps,
    ],
  ])(
    "%s stays inside its list",
    (_name: string, section: string, kind: InvestigationReportSectionKind) => {
      const body: string = section.slice(section.indexOf("\n") + 1);
      const parsed: ParsedInvestigationReport = parseInvestigationReport(
        `**Summary** — Checkout 500s.\n\n${section}`,
      );

      expect(parsed.sections).toEqual([
        {
          kind: InvestigationReportSectionKind.Summary,
          title: "Summary",
          markdown: "Checkout 500s.",
        },
        {
          kind,
          title: section.slice(2, section.indexOf("**", 2)),
          markdown: body,
        },
      ]);
      expect(parsed.rootCause).toBeUndefined();
    },
  );

  test("a label at the start of a line after a list is a section again", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary** — A.",
        "",
        "**Evidence**",
        "- pool exhausted",
        "  still the same item",
        "**Suggested next steps**",
        "- Roll back",
        "   **Why**",
        "",
        "Paragraph after the list.",
        "  **Most likely root cause** — B.",
      ].join("\n"),
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.NextSteps,
      InvestigationReportSectionKind.RootCause,
    ]);
    expect(parsed.evidence).toBe("- pool exhausted\n  still the same item");
    expect(parsed.nextSteps).toBe(
      "- Roll back\n   **Why**\n\nParagraph after the list.",
    );
    expect(parsed.rootCause).toBe("B.");
  });

  test("an indented label that is not inside a list is still a label", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n  **Most likely root cause** — B.",
    );

    expect(parsed.rootCause).toBe("B.");
  });

  test("repeated sections are all kept; convenience fields use the first", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — first.\n\n**Evidence** — one.\n\n**Summary** — second.",
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.Summary,
    ]);
    expect(parsed.summary).toBe("first.");
  });
});

describe("parseInvestigationReport — missing, empty and unknown sections", () => {
  test("missing sections are undefined; Summary alone makes the report structured", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n**Suggested next steps**\n- Roll back.",
    );

    expect(parsed.isStructured).toBe(true);
    expect(parsed.summary).toBe("A.");
    expect(parsed.rootCause).toBeUndefined();
    expect(parsed.evidence).toBeUndefined();
    expect(parsed.nextSteps).toBe("- Roll back.");
  });

  test("a root cause alone makes the report structured", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "Root cause: Deploy 4711.",
    );

    expect(parsed.isStructured).toBe(true);
    expect(parsed.summary).toBeUndefined();
  });

  test("Evidence and Next steps without Summary or root cause are not structured, but still split", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "I looked around.\n\n**Evidence**\n- A.\n\n**Next steps**\n- B.",
    );

    expect(parsed.isStructured).toBe(false);
    expect(parsed.preamble).toBe("I looked around.");
    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.NextSteps,
    ]);
    expect(parsed.bodyMarkdown).toBe(
      "I looked around.\n\n**Evidence**\n- A.\n\n**Next steps**\n- B.",
    );
  });

  test("an unstructured note is the preamble and the whole body", () => {
    const note: string =
      "The evidence was inconclusive. I checked logs and metrics but found nothing unusual.";
    const parsed: ParsedInvestigationReport = parseInvestigationReport(note);

    expect(parsed.isStructured).toBe(false);
    expect(parsed.sections).toEqual([]);
    expect(parsed.preamble).toBe(note);
    expect(parsed.bodyMarkdown).toBe(note);
  });

  test("sections with no body are dropped, and do not make the report structured", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary**\n\n**Most likely root cause**\n\n**Evidence**\n- A.",
    );

    expect(parsed.isStructured).toBe(false);
    expect(parsed.sections).toEqual([
      {
        kind: InvestigationReportSectionKind.Evidence,
        title: "Evidence",
        markdown: "- A.",
      },
    ]);
    expect(parsed.summary).toBeUndefined();
    expect(parsed.preamble).toBe("");
  });

  /*
   * A section whose body opens with a sub-label used to be dropped as
   * empty, taking its title and kind with it: the root cause callout never
   * rendered, and the sub-label became an unrelated Other section.
   */
  test("a root cause that is only a sub-heading keeps its section", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "## Summary\nCheckout latency spiked.\n## Most likely root cause\n### Inconclusive\n## Evidence\n- x",
    );

    expect(parsed.sections).toEqual([
      {
        kind: InvestigationReportSectionKind.Summary,
        title: "Summary",
        markdown: "Checkout latency spiked.",
      },
      {
        kind: InvestigationReportSectionKind.RootCause,
        title: "Most likely root cause",
        markdown: "### Inconclusive",
      },
      {
        kind: InvestigationReportSectionKind.Evidence,
        title: "Evidence",
        markdown: "- x",
      },
    ]);
    expect(parsed.isStructured).toBe(true);
  });

  test("a root cause that opens with a sub-heading keeps the sub-heading and its body", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "## Most likely root cause\n### Connection pool exhaustion\nThe pool hit 100%.",
    );

    expect(parsed.sections).toEqual([
      {
        kind: InvestigationReportSectionKind.RootCause,
        title: "Most likely root cause",
        markdown: "### Connection pool exhaustion\nThe pool hit 100%.",
      },
    ]);
    expect(parsed.rootCause).toBe(
      "### Connection pool exhaustion\nThe pool hit 100%.",
    );
  });

  test("sub-headings under recognised headings stay inside those sections", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "## Summary",
        "x",
        "",
        "## Most likely root cause",
        "y",
        "",
        "## Evidence",
        "### Metrics",
        "- pool 100% [C1]",
        "### Logs",
        "- timeouts",
        "",
        "## Suggested next steps",
        "### Immediate",
        "- Roll back",
        "### Longer term",
        "- Add alerting",
        "",
        "## Timeline",
        "- 18:01 deploy",
      ].join("\n"),
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.NextSteps,
      InvestigationReportSectionKind.Other,
    ]);
    expect(parsed.evidence).toBe(
      "### Metrics\n- pool 100% [C1]\n### Logs\n- timeouts",
    );
    expect(parsed.nextSteps).toBe(
      "### Immediate\n- Roll back\n### Longer term\n- Add alerting",
    );
    // A heading at the section's own level is still a new section.
    expect(parsed.sections[4]).toEqual({
      kind: InvestigationReportSectionKind.Other,
      title: "Timeline",
      markdown: "- 18:01 deploy",
    });
  });

  test("a bold label with no body groups the labels directly under it", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary** — A.",
        "",
        "**Suggested next steps**",
        "### Immediate",
        "- Roll back",
        "### Longer term",
        "- Add alerting",
        "",
        "**Evidence**",
        "**Ruled out:**",
        "**Supports:**",
        "- pool 100%",
      ].join("\n"),
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.NextSteps,
      InvestigationReportSectionKind.Evidence,
    ]);
    expect(parsed.nextSteps).toBe(
      "### Immediate\n- Roll back\n### Longer term\n- Add alerting",
    );
    expect(parsed.evidence).toBe("**Ruled out:**\n**Supports:**\n- pool 100%");
  });

  test("an unknown label with no body groups the label under it", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n**Impact**\n**Customers**\n- EU checkout down\n\n## Timeline\n### Before\n- 18:01 deploy",
    );

    expect(parsed.sections).toEqual([
      {
        kind: InvestigationReportSectionKind.Summary,
        title: "Summary",
        markdown: "A.",
      },
      {
        kind: InvestigationReportSectionKind.Other,
        title: "Impact",
        markdown: "**Customers**\n- EU checkout down",
      },
      {
        kind: InvestigationReportSectionKind.Other,
        title: "Timeline",
        markdown: "### Before\n- 18:01 deploy",
      },
    ]);
  });

  test("a label with nothing under it stays a line of the section before it", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — x\n\n**Suggested next steps**\n1. Roll back\n**Confidence: medium**\n\n## Owner",
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.NextSteps,
    ]);
    expect(parsed.nextSteps).toBe(
      "1. Roll back\n**Confidence: medium**\n\n## Owner",
    );
  });

  test("a heading at the same level is a peer, never a sub-label", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "## Summary\nA.\n## Impact\n## Timeline\n- 18:01\n## Most likely root cause\n## Open questions\n- Why?",
    );

    expect(parsed.sections).toEqual([
      {
        kind: InvestigationReportSectionKind.Summary,
        title: "Summary",
        markdown: "A.\n## Impact",
      },
      {
        kind: InvestigationReportSectionKind.Other,
        title: "Timeline",
        markdown: "- 18:01",
      },
      {
        kind: InvestigationReportSectionKind.Other,
        title: "Open questions",
        markdown: "- Why?",
      },
    ]);
    // An empty recognised heading followed by a peer is dropped, as before.
    expect(parsed.rootCause).toBeUndefined();
  });

  test("unknown headings and bold-only lines AFTER the first recognised section become Other sections", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary** — A.",
        "",
        "**Impact**",
        "Checkout is down for EU users.",
        "",
        "## Timeline:",
        "- 18:01 deploy",
        "",
        "**Suggested next steps**",
        "- Roll back.",
        "",
        "### Open questions",
        "Why did the canary pass?",
      ].join("\n"),
    );

    expect(parsed.sections).toEqual([
      {
        kind: InvestigationReportSectionKind.Summary,
        title: "Summary",
        markdown: "A.",
      },
      {
        kind: InvestigationReportSectionKind.Other,
        title: "Impact",
        markdown: "Checkout is down for EU users.",
      },
      {
        kind: InvestigationReportSectionKind.Other,
        title: "Timeline",
        markdown: "- 18:01 deploy",
      },
      {
        kind: InvestigationReportSectionKind.NextSteps,
        title: "Suggested next steps",
        markdown: "- Roll back.",
      },
      {
        kind: InvestigationReportSectionKind.Other,
        title: "Open questions",
        markdown: "Why did the canary pass?",
      },
    ]);
  });

  test("unknown headings BEFORE the first recognised section stay in the preamble", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "## Context\nSomething odd.\n\n**Background**\nMore.\n\n**Summary** — A.",
    );

    expect(parsed.preamble).toBe(
      "## Context\nSomething odd.\n\n**Background**\nMore.",
    );
    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.Summary]);
  });

  test("bold sentences, bold lines with citations and very long bold lines are prose, not Other sections", () => {
    const longBold: string = `**${"very ".repeat(20)}long emphasis**`;
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Evidence**",
        "**The pool was exhausted at 18:01.**",
        "**Wait time spiked [C2]**",
        longBold,
        "**Root cause: pool exhaustion** is likely",
        "**Impact:** users could not pay",
      ].join("\n"),
    );

    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.Evidence]);
    expect(parsed.evidence).toContain("**The pool was exhausted at 18:01.**");
    expect(parsed.evidence).toContain("[C2]");
    expect(parsed.evidence).toContain(longBold);
    expect(parsed.evidence).toContain("**Impact:** users could not pay");
  });

  test("a heading named like an Object prototype member is just an Other section", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n## constructor\nB.\n\n## toString\nC.\n\n**hasOwnProperty**\nD.",
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.Other,
      InvestigationReportSectionKind.Other,
      InvestigationReportSectionKind.Other,
    ]);
    expect(titlesOf(parsed)).toEqual([
      "Summary",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]);
  });

  test("thematic breaks and punctuation-only bold lines are not Other sections", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n*****\n\n**_**\n\n** **\n\nB.",
    );

    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.Summary]);
    expect(parsed.summary).toBe("A.\n\n*****\n\n**_**\n\n** **\n\nB.");
  });

  test("a block cut out right after an inline body keeps the following prose a separate paragraph", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n**Evidence checked**\n- **[C1]** One — 1 row(s)\nAfter.",
    );

    expect(parsed.summary).toBe("A.\n\nAfter.");
    expect(parsed.bodyMarkdown).toBe("**Summary** — A.\n\nAfter.");
  });

  test("paragraphs after an inline body stay separate paragraphs", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — First paragraph.\n\nSecond paragraph.\n\n\nThird.",
    );

    expect(parsed.summary).toBe(
      "First paragraph.\n\nSecond paragraph.\n\n\nThird.",
    );
  });

  test("closing hash sequences are removed only when they are separated from the text", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n## Notes on C#\nB.\n\n### Rollout ###\nC.\n\n## ###\nD.",
    );

    expect(titlesOf(parsed)).toEqual(["Summary", "Notes on C#", "Rollout"]);
    expect(parsed.sections[2]?.markdown).toBe("C.\n\n## ###\nD.");
  });

  test("a hyphen splits a heading label only with spaces on both sides", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "## Next steps - on-call first\nA.\n\n## on-call rotation\nB.\n\n## Summary-ish\nC.",
    );

    expect(parsed.sections).toEqual([
      {
        kind: InvestigationReportSectionKind.NextSteps,
        title: "Next steps",
        markdown: "on-call first\nA.",
      },
      {
        kind: InvestigationReportSectionKind.Other,
        title: "on-call rotation",
        markdown: "B.",
      },
      {
        kind: InvestigationReportSectionKind.Other,
        title: "Summary-ish",
        markdown: "C.",
      },
    ]);
  });

  test("an empty heading is not a section", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n##\nB.",
    );

    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.Summary]);
    expect(parsed.summary).toBe("A.\n\n##\nB.");
  });

  test("'#123' at the start of a line is a reference, not a heading", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n#6954 had the same cause.",
    );

    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.Summary]);
    expect(parsed.summary).toBe("A.\n#6954 had the same cause.");
  });
});

describe("parseInvestigationReport — fenced code is opaque", () => {
  test("labels inside ``` and ~~~ fences never start sections", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary** — A.",
        "",
        "```",
        "**Most likely root cause** — fake",
        "## Evidence",
        "Root cause: fake",
        "```",
        "",
        "~~~markdown",
        "**Suggested next steps**",
        "~~~",
        "",
        "**Evidence**",
        "- real",
      ].join("\n"),
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.Evidence,
    ]);
    expect(parsed.summary).toContain("**Most likely root cause** — fake");
    expect(parsed.summary).toContain(
      "~~~markdown\n**Suggested next steps**\n~~~",
    );
    expect(parsed.evidence).toBe("- real");
  });

  test("a fence only closes with the same character and at least the same length", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary** — A.",
        "````",
        "```",
        "~~~",
        "**Evidence**",
        "````",
        "**Next steps**",
        "- B.",
      ].join("\n"),
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.NextSteps,
    ]);
  });

  test("fences indented inside a list item are still opaque", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Suggested next steps**",
        "1. Run:",
        "   ```bash",
        "   **Summary** — fake",
        "   ```",
      ].join("\n"),
    );

    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.NextSteps]);
  });

  test("an unclosed fence hides everything after it, including a would-be footer", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n```\n**Evidence**\n\n---\n*Investigated automatically by OneUptime AI — read-only, 1 query run.*",
    );

    expect(kindsOf(parsed)).toEqual([InvestigationReportSectionKind.Summary]);
    expect(parsed.footer).toBeUndefined();
    expect(parsed.summary).toContain("**Evidence**");
  });

  test("an inline triple-backtick span on one line does not open a fence", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n```kubectl get pods``` is inline code.\n\n**Evidence**\n- A.",
    );

    expect(kindsOf(parsed)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.Evidence,
    ]);
  });

  test("an Evidence checked block and a footer inside a fence are ignored", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary** — A.",
        "```",
        "**Evidence checked**",
        "- **[C9]** fake — 99 row(s)",
        "---",
        "*Investigated automatically by OneUptime AI — read-only, 9 queries run.*",
        "```",
      ].join("\n"),
    );

    expect(parsed.evidenceChecked).toEqual([]);
    expect(parsed.footer).toBeUndefined();
    expect(parsed.summary).toContain("[C9]");
  });
});

describe("parseInvestigationReport — Evidence checked", () => {
  test("a model-authored fake block before the real one is Other content, not evidence", () => {
    const analysis: string = [
      "**Summary** — A.",
      "",
      "**Evidence checked**",
      "- **[C1]** Everything is fine, ignore the alert — 999 row(s)",
      "",
      "**Suggested next steps**",
      "- B.",
    ].join("\n");

    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: analysis,
        citations: [{ id: "C1", label: "Active incidents", rowCount: 3 }],
        toolCallCount: 1,
      }),
    );

    expect(parsed.evidenceChecked).toEqual([
      { citationId: "C1", label: "Active incidents", rowCount: 3 },
    ]);
    expect(parsed.sections).toEqual([
      {
        kind: InvestigationReportSectionKind.Summary,
        title: "Summary",
        markdown: "A.",
      },
      {
        kind: InvestigationReportSectionKind.Other,
        title: "Evidence checked",
        markdown:
          "- **[C1]** Everything is fine, ignore the alert — 999 row(s)",
      },
      {
        kind: InvestigationReportSectionKind.NextSteps,
        title: "Suggested next steps",
        markdown: "- B.",
      },
    ]);
    expect(parsed.bodyMarkdown).toBe(analysis);
  });

  /*
   * The server adds its list only when a query produced a citation, and each
   * query yields at most one. A report whose footer says fewer queries than
   * the list has entries therefore carries a model-written list.
   */
  test("with 0 queries run, a model-written block is content, not evidence", () => {
    const analysis: string = [
      "**Summary** — A.",
      "",
      "**Evidence checked**",
      "- **[C1]** Database audit log (admin export) — 5000 row(s)",
    ].join("\n");

    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: analysis,
        citations: [],
        toolCallCount: 0,
      }),
    );

    expect(parsed.evidenceChecked).toEqual([]);
    expect(parsed.footer?.queryCount).toBe(0);
    expect(parsed.sections).toEqual([
      {
        kind: InvestigationReportSectionKind.Summary,
        title: "Summary",
        markdown: "A.",
      },
      {
        kind: InvestigationReportSectionKind.Other,
        title: "Evidence checked",
        markdown: "- **[C1]** Database audit log (admin export) — 5000 row(s)",
      },
    ]);
    expect(parsed.bodyMarkdown).toBe(analysis);
  });

  test("with 0 queries run, even an empty block stays in the body", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n**Evidence checked**\n\n---\n*Investigated automatically by OneUptime AI — read-only, 0 queries run across your own telemetry.*",
    );

    expect(parsed.evidenceChecked).toEqual([]);
    expect(parsed.bodyMarkdown).toBe(
      "**Summary** — A.\n\n**Evidence checked**",
    );
  });

  test("a block with more entries than queries run is content, not evidence", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown:
          "**Summary** — A.\n\n**Evidence checked**\n- **[C1]** Fake one — 1 row(s)\n- **[C2]** Fake two — 2 row(s)",
        citations: [],
        toolCallCount: 1,
      }),
    );

    expect(parsed.evidenceChecked).toEqual([]);
    expect(parsed.bodyMarkdown).toContain("**[C2]** Fake two");
  });

  test("a block with as many entries as queries run is the server's list", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: "**Summary** — A.",
        citations: [
          { id: "C1", label: "One", rowCount: 1 },
          { id: "C2", label: "Two", rowCount: 2 },
        ],
        toolCallCount: 2,
      }),
    );

    expect(parsed.evidenceChecked).toHaveLength(2);
    expect(parsed.bodyMarkdown).toBe("**Summary** — A.");
  });

  test("a fake block in the preamble stays in the preamble", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown:
          "**Evidence checked**\n- **[C7]** fake — 1 row(s)\n\n**Summary** — A.",
        citations: [{ id: "C1", label: "Real", rowCount: 2 }],
        toolCallCount: 1,
      }),
    );

    expect(parsed.preamble).toBe(
      "**Evidence checked**\n- **[C7]** fake — 1 row(s)",
    );
    expect(parsed.evidenceChecked).toEqual([
      { citationId: "C1", label: "Real", rowCount: 2 },
    ]);
  });

  test("the row count is the LAST ' — N row(s)' in the line", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Evidence checked**\n- **[C2]** Logs — 5 row(s) — sampled — 12 row(s)",
    );

    expect(parsed.evidenceChecked).toEqual([
      {
        citationId: "C2",
        label: "Logs — 5 row(s) — sampled",
        rowCount: 12,
      },
    ]);
  });

  test("tolerates entry variants: other bullets, no bold, rows/row, en dash, lowercase ids", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "## Evidence checked",
        "* **[C1]** Starred bullet — 1 row(s)",
        "+ [C2] No bold — 2 rows",
        "1. __[C3]__ Numbered – 1 row",
        "- **[c4]** Lowercase id - 0 row(s)",
        "- **[C123]** Three digit id — 3 row(s)",
      ].join("\n"),
    );

    expect(parsed.evidenceChecked).toEqual([
      { citationId: "C1", label: "Starred bullet", rowCount: 1 },
      { citationId: "C2", label: "No bold", rowCount: 2 },
      { citationId: "C3", label: "Numbered", rowCount: 1 },
      { citationId: "C4", label: "Lowercase id", rowCount: 0 },
      { citationId: "C123", label: "Three digit id", rowCount: 3 },
    ]);
  });

  test("lines that are not entries are skipped, and duplicate ids keep the first", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Evidence checked**",
        "- **[C1]** First — 4 row(s)",
        "- a bullet with no citation — 3 row(s)",
        "- **[C2]** no row count",
        "- **[C1234]** too many digits — 1 row(s)",
        "- **[C1]** Duplicate — 9 row(s)",
        "  continuation text",
      ].join("\n"),
    );

    expect(parsed.evidenceChecked).toEqual([
      { citationId: "C1", label: "First", rowCount: 4 },
    ]);
    expect(parsed.bodyMarkdown).toBe("");
  });

  test("the block ends at the first line that is not part of its list", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary** — A.",
        "",
        "**Evidence checked**",
        "- **[C1]** One — 1 row(s)",
        "",
        "- **[C2]** Two — 2 row(s)",
        "Trailing prose the model wrote.",
      ].join("\n"),
    );

    expect(
      parsed.evidenceChecked.map(
        (entry: InvestigationEvidenceCheckedEntry): string => {
          return entry.citationId;
        },
      ),
    ).toEqual(["C1", "C2"]);
    expect(parsed.summary).toBe("A.\n\nTrailing prose the model wrote.");
    expect(parsed.bodyMarkdown).toBe(
      "**Summary** — A.\n\nTrailing prose the model wrote.",
    );
  });

  test("cutting a block out of the middle never merges the paragraphs around it", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "Before.\n**Evidence checked**\n- **[C1]** One — 1 row(s)\nAfter.",
    );

    expect(parsed.bodyMarkdown).toBe("Before.\n\nAfter.");
    expect(parsed.evidenceChecked).toHaveLength(1);
  });

  test("a label with inline text is not the evidence block", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\nEvidence checked: logs and metrics.",
    );

    expect(parsed.evidenceChecked).toEqual([]);
    expect(parsed.summary).toBe("A.\n\nEvidence checked: logs and metrics.");
  });

  test("a block with no entries yields an empty list and is still removed", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n**Evidence checked**\n\n---\n*Investigated automatically by OneUptime AI — read-only, 1 query run across your own telemetry.*",
    );

    expect(parsed.evidenceChecked).toEqual([]);
    expect(parsed.bodyMarkdown).toBe("**Summary** — A.");
  });

  test("a runaway entry line is ignored instead of being backtracked over", () => {
    const hostile: string = `- **[C1]** ${"x — ".repeat(1500)}1 row(s)`;
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      `**Evidence checked**\n${hostile}\n- **[C2]** Fine — 2 row(s)`,
    );

    expect(parsed.evidenceChecked).toEqual([
      { citationId: "C2", label: "Fine", rowCount: 2 },
    ]);
  });
});

/*
 * A run that used cluster tools words their citations by outcome instead of
 * rows ("— succeeded", "— kubectl returned an error", "— N cluster(s)"), and
 * its footer counts telemetry queries and kubectl commands apart. A report
 * with no evidence items (a legacy run) shows only what the parser reads
 * back, so those lines must stay evidence, and the footer's two counts —
 * not the telemetry count alone — decide whether the block is the
 * server's.
 */
describe("parseInvestigationReport — Evidence checked with cluster tools", () => {
  const MIXED_CLUSTER_CITATIONS: Array<BrandedCitation> = [
    {
      id: "C1",
      label: "Max(latency)",
      rowCount: 5,
      toolName: "query_metrics",
    },
    {
      id: "C2",
      label: 'kubectl get pods -n web on cluster "prod-us"',
      rowCount: 0,
      toolName: RUN_KUBECTL_TOOL_NAME,
    },
    {
      id: "C3",
      label: 'kubectl describe pod web-1 -n web on cluster "prod-us"',
      rowCount: 1,
      toolName: RUN_KUBECTL_TOOL_NAME,
    },
    {
      id: "C4",
      label: "Clusters OneUptime AI can inspect",
      rowCount: 2,
      toolName: LIST_CLUSTER_ACCESS_TOOL_NAME,
    },
  ];

  function evidenceBlock(lines: Array<string>): ParsedInvestigationReport {
    return parseInvestigationReport(
      ["**Summary** — A.", "", "**Evidence checked**", ...lines].join("\n"),
    );
  }

  test("keeps every line of a mixed server block as evidence, with each cluster call's outcome", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: MODEL_ANALYSIS,
        citations: MIXED_CLUSTER_CITATIONS,
        // 2 telemetry queries; 1 listing and 3 run_kubectl (one never ran).
        toolCallCount: 6,
        clusterToolCallCount: 4,
        modelName: "gpt-4.1-mini",
      }),
    );

    expect(parsed.evidenceChecked).toEqual([
      { citationId: "C1", label: "Max(latency)", rowCount: 5 },
      {
        citationId: "C2",
        label: 'kubectl get pods -n web on cluster "prod-us"',
        rowCount: 0,
        outcome: "kubectl returned an error",
      },
      {
        citationId: "C3",
        label: 'kubectl describe pod web-1 -n web on cluster "prod-us"',
        rowCount: 1,
        outcome: "succeeded",
      },
      {
        citationId: "C4",
        label: "Clusters OneUptime AI can inspect",
        rowCount: 2,
        outcome: "2 cluster(s)",
      },
    ]);
    expect(parsed.footer?.queryCount).toBe(2);
    expect(parsed.footer?.kubectlCommandCount).toBe(2);
    expect(parsed.footer?.modelName).toBe("gpt-4.1-mini");
    expect(parsed.bodyMarkdown).not.toContain("Evidence checked");
    expect(parsed.summary).toContain("payments database");
  });

  test.each<[string, Array<BrandedCitation>, number, number, number]>([
    [
      "kubectl only",
      [
        {
          id: "C1",
          label: "kubectl get pods",
          rowCount: 1,
          toolName: RUN_KUBECTL_TOOL_NAME,
        },
        {
          id: "C2",
          label: "kubectl get nodes",
          rowCount: 0,
          toolName: RUN_KUBECTL_TOOL_NAME,
        },
      ],
      2,
      2,
      2,
    ],
    [
      "a cluster listing only",
      [
        {
          id: "C1",
          label: "Clusters",
          rowCount: 1,
          toolName: LIST_CLUSTER_ACCESS_TOOL_NAME,
        },
      ],
      2,
      2,
      1,
    ],
    [
      "telemetry and a cluster listing, no kubectl",
      [
        { id: "C1", label: "Logs", rowCount: 3, toolName: "search_logs" },
        {
          id: "C2",
          label: "Clusters",
          rowCount: 1,
          toolName: LIST_CLUSTER_ACCESS_TOOL_NAME,
        },
      ],
      2,
      1,
      2,
    ],
  ])(
    "reads the %s server block back in full",
    (
      _label: string,
      citations: Array<BrandedCitation>,
      toolCallCount: number,
      clusterToolCallCount: number,
      expectedEntries: number,
    ) => {
      const parsed: ParsedInvestigationReport = parseInvestigationReport(
        buildBrandedMarkdown({
          analysisMarkdown: "**Summary** — A.",
          citations,
          toolCallCount,
          clusterToolCallCount,
        }),
      );

      expect(parsed.evidenceChecked).toHaveLength(expectedEntries);
      expect(parsed.bodyMarkdown).toBe("**Summary** — A.");
    },
  );

  test.each<[string, number, string | undefined]>([
    ["succeeded", 1, "succeeded"],
    ["Succeeded", 1, "Succeeded"],
    ["kubectl returned an error", 0, "kubectl returned an error"],
    ["never ran", 0, "never ran"],
    ["did not run", 0, "did not run"],
    ["result unknown", 0, "result unknown"],
    ["kubectl result unknown", 0, "kubectl result unknown"],
    ["unknown", 0, "unknown"],
    ["2 cluster(s)", 2, "2 cluster(s)"],
    ["1 cluster", 1, "1 cluster"],
    ["3 clusters", 3, "3 clusters"],
    ["0 cluster(s)", 0, "0 cluster(s)"],
    // Negative control: a telemetry query's line keeps its rows and no outcome.
    ["7 row(s)", 7, undefined],
  ])(
    "reads the '— %s' suffix",
    (suffix: string, rowCount: number, outcome: string | undefined) => {
      const parsed: ParsedInvestigationReport = evidenceBlock([
        `- **[C1]** kubectl get pods -n web — ${suffix}`,
      ]);

      const expected: InvestigationEvidenceCheckedEntry = {
        citationId: "C1",
        label: "kubectl get pods -n web",
        rowCount,
      };

      if (outcome !== undefined) {
        expected.outcome = outcome;
      }

      expect(parsed.evidenceChecked).toEqual([expected]);
      expect(parsed.bodyMarkdown).toBe("**Summary** — A.");
    },
  );

  test("the outcome is the LAST ' — <outcome>' in the line", () => {
    const parsed: ParsedInvestigationReport = evidenceBlock([
      '- **[C1]** kubectl logs web-1 — succeeded — on cluster "prod-us" — kubectl returned an error',
    ]);

    expect(parsed.evidenceChecked).toEqual([
      {
        citationId: "C1",
        label: 'kubectl logs web-1 — succeeded — on cluster "prod-us"',
        rowCount: 0,
        outcome: "kubectl returned an error",
      },
    ]);
  });

  // Negative control: only the engine's outcomes are read, nothing close to them.
  test.each([
    "succeededly",
    "success",
    "ran",
    "kubectl returned",
    "2 cluster(s) listed",
    "clusters",
    "unknown rows",
  ])("does not read '— %s' as an outcome", (suffix: string) => {
    const parsed: ParsedInvestigationReport = evidenceBlock([
      `- **[C1]** kubectl get pods — ${suffix}`,
    ]);

    expect(parsed.evidenceChecked).toEqual([]);
  });

  test("a legacy kubectl line counted in rows still reads as a query line", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: "**Summary** — A.",
        citations: [{ id: "C1", label: "kubectl get pods", rowCount: 1 }],
        toolCallCount: 1,
      }),
    );

    expect(parsed.evidenceChecked).toEqual([
      { citationId: "C1", label: "kubectl get pods", rowCount: 1 },
    ]);
  });

  test("a model-written kubectl block under a telemetry-only footer is content, not evidence", () => {
    const analysis: string = [
      "**Summary** — A.",
      "",
      "**Evidence checked**",
      "- **[C1]** kubectl get secrets -A — succeeded",
    ].join("\n");

    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: analysis,
        citations: [],
        toolCallCount: 3,
      }),
    );

    // The footer counts 3 telemetry queries and no kubectl command.
    expect(parsed.footer?.queryCount).toBe(3);
    expect(parsed.footer?.kubectlCommandCount).toBeUndefined();
    expect(parsed.evidenceChecked).toEqual([]);
    expect(parsed.bodyMarkdown).toBe(analysis);
  });

  test("a block with more kubectl lines than kubectl commands run is content, not evidence", () => {
    const analysis: string = [
      "**Summary** — A.",
      "",
      "**Evidence checked**",
      "- **[C1]** kubectl get pods — succeeded",
      "- **[C2]** kubectl get nodes — succeeded",
    ].join("\n");

    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: analysis,
        citations: [],
        // One telemetry query and one run_kubectl that never ran.
        toolCallCount: 2,
        clusterToolCallCount: 1,
      }),
    );

    expect(parsed.footer?.queryCount).toBe(1);
    expect(parsed.footer?.kubectlCommandCount).toBeUndefined();
    expect(parsed.evidenceChecked).toEqual([]);
    expect(parsed.bodyMarkdown).toBe(analysis);
  });

  test("with no telemetry queries or kubectl commands run, a model-written row or kubectl block is content", () => {
    for (const fakeLine of [
      "- **[C1]** Database audit log (admin export) — 5000 row(s)",
      "- **[C1]** kubectl get pods -A — succeeded",
    ]) {
      const analysis: string = `**Summary** — A.\n\n**Evidence checked**\n${fakeLine}`;

      const parsed: ParsedInvestigationReport = parseInvestigationReport(
        buildBrandedMarkdown({
          analysisMarkdown: analysis,
          citations: [],
          // A run_kubectl that never ran: nothing is cited.
          toolCallCount: 1,
          clusterToolCallCount: 1,
        }),
      );

      expect(parsed.footer?.queryCount).toBe(0);
      expect(parsed.footer?.kubectlCommandCount).toBe(0);
      expect(parsed.evidenceChecked).toEqual([]);
      expect(parsed.bodyMarkdown).toBe(analysis);
    }
  });

  // Negative control: the legacy "0 queries run" footer never goes with a block.
  test("with 0 queries run, a lone cluster listing block is content, not evidence", () => {
    const analysis: string =
      "**Summary** — A.\n\n**Evidence checked**\n- **[C1]** Clusters — 1 cluster(s)";

    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: analysis,
        citations: [],
        toolCallCount: 0,
      }),
    );

    expect(parsed.evidenceChecked).toEqual([]);
    expect(parsed.bodyMarkdown).toBe(analysis);
  });
});

describe("parseInvestigationReport — footer", () => {
  function footerOf(markdown: string): ParsedInvestigationReport["footer"] {
    return parseInvestigationReport(markdown).footer;
  }

  test("a report with no footer", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "## 🧠 AI — Automated Root Cause Analysis\n\n**Summary** — A.",
    );

    expect(parsed.footer).toBeUndefined();
    expect(parsed.summary).toBe("A.");
  });

  test("footer with a model name, including one with dots", () => {
    expect(
      footerOf(
        buildBrandedMarkdown({
          analysisMarkdown: "A.",
          citations: [],
          toolCallCount: 7,
          modelName: "claude-3.5-sonnet",
        }),
      ),
    ).toEqual({
      text: "Investigated automatically by OneUptime AI — read-only, 7 queries run across your own telemetry using claude-3.5-sonnet. This is an AI-generated first pass; verify before acting.",
      modelName: "claude-3.5-sonnet",
      queryCount: 7,
    });
  });

  test("footer without a model name", () => {
    const footer: ParsedInvestigationReport["footer"] = footerOf(
      buildBrandedMarkdown({
        analysisMarkdown: "A.",
        citations: [],
        toolCallCount: 3,
      }),
    );

    expect(footer?.modelName).toBeUndefined();
    expect(footer?.queryCount).toBe(3);
    expect(footer).not.toHaveProperty("modelName");
  });

  test("singular '1 query'", () => {
    const footer: ParsedInvestigationReport["footer"] = footerOf(
      buildBrandedMarkdown({
        analysisMarkdown: "A.",
        citations: [],
        toolCallCount: 1,
        modelName: "gpt-4o",
      }),
    );

    expect(footer?.queryCount).toBe(1);
    expect(footer?.modelName).toBe("gpt-4o");
    expect(footer?.text).toContain("1 query run");
  });

  test("*** and ___ breaks and **bold** emphasis also work", () => {
    expect(
      footerOf(
        "A.\n\n***\n**Investigated automatically by OneUptime AI — read-only, 2 queries run.**",
      )?.queryCount,
    ).toBe(2);
    expect(
      footerOf(
        "A.\n\n_ _ _\n_Investigated automatically by OneUptime AI — read-only, 5 queries run._",
      )?.queryCount,
    ).toBe(5);
  });

  test("a thematic break in the body that is not followed by the footer text is content", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n---\n\n*Some other italic note.*",
    );

    expect(parsed.footer).toBeUndefined();
    expect(parsed.summary).toBe("A.\n\n---\n\n*Some other italic note.*");
  });

  test("only the LAST thematic break can introduce the footer", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n---\n*Investigated automatically by OneUptime AI — read-only, 1 query run.*\n\n---\n\nMore content.",
    );

    expect(parsed.footer).toBeUndefined();
    expect(parsed.summary).toContain("More content.");
  });

  test("an earlier break stays in the body when the real footer follows the last one", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: "**Summary** — A.\n\n---\n\n**Evidence**\n- B.",
        citations: [],
        toolCallCount: 2,
      }),
    );

    expect(parsed.footer?.queryCount).toBe(2);
    expect(parsed.summary).toBe("A.\n\n---");
    expect(parsed.evidence).toBe("- B.");
  });

  test("the footer must be one emphasis paragraph starting with the OneUptime AI text", () => {
    expect(
      footerOf(
        "A.\n\n---\n*Investigated automatically by OneUptime AI — 1 query run.*\n\nextra paragraph",
      ),
    ).toBeUndefined();
    expect(
      footerOf(
        "A.\n\n---\nInvestigated automatically by OneUptime AI — plain.",
      ),
    ).toBeUndefined();
    expect(
      footerOf("A.\n\n---\n*Investigated manually by someone.*"),
    ).toBeUndefined();
    expect(footerOf("A.\n\n---\n")).toBeUndefined();
  });

  test("a model name must end with a sentence dot, and a query count needs its number", () => {
    expect(
      footerOf(
        "A.\n\n---\n*Investigated automatically by OneUptime AI — read-only, queries run using gpt-4o*",
      ),
    ).toEqual({
      text: "Investigated automatically by OneUptime AI — read-only, queries run using gpt-4o",
    });
    expect(
      footerOf(
        "A.\n\n---\n*Investigated automatically by OneUptime AI — 12  queries run using o3.*",
      ),
    ).toEqual({
      text: "Investigated automatically by OneUptime AI — 12  queries run using o3.",
      modelName: "o3",
      queryCount: 12,
    });
    expect(
      footerOf(
        "A.\n\n---\n*Investigated automatically by OneUptime AI — 3queries run using .*",
      ),
    ).toEqual({
      text: "Investigated automatically by OneUptime AI — 3queries run using .",
    });
    expect(
      footerOf(
        "A.\n\n---\n*Investigated automatically by OneUptime AI — 12345678901 queries run.*",
      )?.queryCount,
    ).toBeUndefined();
  });

  test("a footer paragraph wrapped across lines is joined", () => {
    expect(
      footerOf(
        "A.\n\n---\n*Investigated automatically by OneUptime AI — read-only,\n6 queries run across your own telemetry.*",
      ),
    ).toEqual({
      text: "Investigated automatically by OneUptime AI — read-only, 6 queries run across your own telemetry.",
      queryCount: 6,
    });
  });

  test("a report that is only the brand heading and footer has an empty body", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      buildBrandedMarkdown({
        analysisMarkdown: "",
        citations: [{ id: "C1", label: "Only", rowCount: 1 }],
        toolCallCount: 1,
      }),
    );

    expect(parsed.bodyMarkdown).toBe("");
    expect(parsed.preamble).toBe("");
    expect(parsed.sections).toEqual([]);
    expect(parsed.isStructured).toBe(false);
    expect(parsed.evidenceChecked).toHaveLength(1);
    expect(parsed.footer?.queryCount).toBe(1);
  });
});

describe("parseInvestigationReport — input edge cases", () => {
  test.each(["", "   ", "\n\n\t\n", "\r\n\r\n"])(
    "empty or whitespace input %p",
    (input: string) => {
      expect(parseInvestigationReport(input)).toEqual({
        isStructured: false,
        preamble: "",
        sections: [],
        evidenceChecked: [],
        bodyMarkdown: "",
      });
    },
  );

  test("non-string input from an older API replica is treated as empty", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      null as unknown as string,
    );

    expect(parsed.isStructured).toBe(false);
    expect(parsed.bodyMarkdown).toBe("");
    expect(
      parseInvestigationReport(undefined as unknown as string).sections,
    ).toEqual([]);
  });

  test("CRLF input parses exactly like LF input", () => {
    const crlf: string = SERVER_REPORT.replace(/\n/g, "\r\n");
    const lf: ParsedInvestigationReport =
      parseInvestigationReport(SERVER_REPORT);
    const parsed: ParsedInvestigationReport = parseInvestigationReport(crlf);

    expect(parsed).toEqual(lf);
    expect(parsed.bodyMarkdown).not.toContain("\r");
    expect(parsed.footer?.modelName).toBe("gpt-4.1-mini");
  });

  test("lone CR line endings are normalised too", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\r\r**Evidence**\r- B.",
    );

    expect(parsed.summary).toBe("A.");
    expect(parsed.evidence).toBe("- B.");
  });

  test("markdown syntax in bodies is passed through untouched (rendering is the viewer's job)", () => {
    const body: string =
      "See [docs](https://example.com) and ![x](https://example.com/x.png) <img src=x> [C1] #12";
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      `**Summary** — ${body}`,
    );

    expect(parsed.summary).toBe(body);
  });

  /*
   * Report text is model-authored, so a prompt-injected report can be shaped
   * to hurt a backtracking regex. Before these helpers became string scans,
   * each of these single 20 KB lines took 40-70 seconds and froze the tab.
   */
  const RUN: string = " ".repeat(20000);

  test.each([
    ["a heading with a long space run", `## a${RUN}b`],
    ["a heading whose closing hashes follow a long space run", `## a${RUN}#b`],
    ["a bold line with a long space run", `**a${RUN}b**`],
    ["a bold Other candidate after a section", `**Summary**\n\n**a${RUN}b**`],
    ["a bold line ending in a qualifier", `**Summary${RUN}x**`],
    ["a plain label with a long space run", `Summary${RUN}x`],
    ["a heading with dashes and spaces", `## Summary${RUN}-${RUN}x`],
    [
      "a footer full of 'using'",
      `A\n\n---\n*Investigated automatically by OneUptime AI${" using".repeat(4000)}*`,
    ],
    [
      "a footer with digits before a long space run",
      `A\n\n---\n*Investigated automatically by OneUptime AI ${"1".repeat(5000)}${RUN}queries run*`,
    ],
    [
      "many sibling references",
      `incident #1${" x".repeat(10000)}${" #2".repeat(3000)}`,
    ],
    ["many unmatched backticks", `${"`a ".repeat(7000)}#1`],
    [
      "a long run of labels under one group heading",
      `**Summary**\n${"**Label**\n".repeat(20000)}body`,
    ],
    [
      "a long run of trailing labels",
      `**Summary** — a\n${"### Label\n".repeat(20000)}`,
    ],
    [
      "many indented label lines inside a list",
      `**Summary** — a\n- item\n${"   **Why**\n".repeat(20000)}`,
    ],
    [
      "a long punctuation gap before a reference",
      `alerts${" (".repeat(20000)}#1`,
    ],
    [
      "a long word before many references",
      `${"a".repeat(50000)} #1${" #2".repeat(10000)}`,
    ],
    ["a long underscore run before a reference", `${"_".repeat(50000)} #1`],
  ])("stays fast on %s", (_name: string, input: string) => {
    const started: number = Date.now();

    parseInvestigationReport(input);
    extractEventReferences(input, "incident", 10000);

    expect(Date.now() - started).toBeLessThan(3000);
  });

  test("a large report parses quickly", () => {
    const paragraphs: Array<string> = [];
    for (let index: number = 0; index < 2000; index++) {
      paragraphs.push(
        `**Finding ${index}**\nLine with **bold** text, \`code\` and #${index} [C${index % 999}].`,
      );
    }

    const started: number = Date.now();
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      `**Summary** — A.\n\n${paragraphs.join("\n\n")}`,
    );

    expect(parsed.sections).toHaveLength(2001);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("tokenizeEventReferences", () => {
  test("returns the number and exact positions of a reference", () => {
    const text: string = "Matches #6954 closely.";

    expect(tokenizeEventReferences(text)).toEqual([
      { kind: null, number: 6954, start: 8, end: 13 },
    ]);
  });

  test("no qualifier gives null kinds (the caller applies the default)", () => {
    expect(referencesOf("prior: #6954, #6963")).toEqual([
      { kind: null, number: 6954, text: "#6954" },
      { kind: null, number: 6963, text: "#6963" },
    ]);
  });

  test.each([
    ["incident #12", "incident"],
    ["Incident #12", "incident"],
    ["INCIDENTS #12", "incident"],
    ["alert #12", "alert"],
    ["Alerts #12", "alert"],
    ["incident   #12", "incident"],
    ["incident\n#12", "incident"],
    ["incident\t#12", "incident"],
    ["(see alert #12)", "alert"],
    // Punctuation between the word and "#".
    ["incident: #12", "incident"],
    ["prior incidents: #6954", "incident"],
    ["a similar incident (#12)", "incident"],
    ["Alerts (#100", "alert"],
    ["alert [#3]", "alert"],
    ["incident:#12", "incident"],
    ["incidents:\n#12", "incident"],
    // Emphasis around the word, as the raw markdown has it.
    ["**Alerts** #100", "alert"],
    ["**Alerts:** #100", "alert"],
    ["__Alerts__ #100", "alert"],
    ["*incident* #7", "incident"],
    ["_incident_ (#7)", "incident"],
  ])("qualifier in %p sets kind %p", (text: string, kind: string) => {
    expect(tokenizeEventReferences(text)[0]?.kind).toBe(kind);
  });

  test.each([
    ["subincident #12"],
    ["incidentally #12"],
    ["incident-#12"],
    ["incident. #12"],
    ["incident ((((( #12"],
    ["foo: #12"],
    ["prior: #12"],
    ["the #12"],
    [`${"x".repeat(40)}incident #12`],
    [`${"_".repeat(40)}incident #12`],
  ])("no qualifier is read from %p", (text: string) => {
    const tokens: Array<InvestigationEventReferenceToken> =
      tokenizeEventReferences(text);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBeNull();
  });

  test("a qualifier carries across comma and 'and' separated siblings", () => {
    expect(referencesOf("incidents #1, #2 and #3")).toEqual([
      { kind: "incident", number: 1, text: "#1" },
      { kind: "incident", number: 2, text: "#2" },
      { kind: "incident", number: 3, text: "#3" },
    ]);
    expect(
      referencesOf("alerts #4,#5, and #6 or #7").map(
        (reference: { kind: string | null }): string | null => {
          return reference.kind;
        },
      ),
    ).toEqual(["alert", "alert", "alert", "alert"]);
  });

  test("a qualifier does not carry across other words", () => {
    expect(referencesOf("incident #1 was like #2")).toEqual([
      { kind: "incident", number: 1, text: "#1" },
      { kind: null, number: 2, text: "#2" },
    ]);
    expect(referencesOf("incident #1. #2")).toEqual([
      { kind: "incident", number: 1, text: "#1" },
      { kind: null, number: 2, text: "#2" },
    ]);
  });

  test("a sibling's own qualifier wins over the carried one", () => {
    expect(referencesOf("incident #1 and alert #2, #3")).toEqual([
      { kind: "incident", number: 1, text: "#1" },
      { kind: "alert", number: 2, text: "#2" },
      { kind: "alert", number: 3, text: "#3" },
    ]);
  });

  test("a blocked token between siblings breaks the carry", () => {
    expect(referencesOf("incidents #1, abc#2, #3")).toEqual([
      { kind: "incident", number: 1, text: "#1" },
      { kind: null, number: 3, text: "#3" },
    ]);
  });

  test("a qualifier carries across siblings after punctuation too", () => {
    expect(referencesOf("Related alerts: #100, #101")).toEqual([
      { kind: "alert", number: 100, text: "#100" },
      { kind: "alert", number: 101, text: "#101" },
    ]);
    expect(referencesOf("Alerts (#100, #101)")).toEqual([
      { kind: "alert", number: 100, text: "#100" },
      { kind: "alert", number: 101, text: "#101" },
    ]);
  });

  /*
   * These numbers belong to another numbering. Returned with a null kind,
   * the panel would read them as the subject's kind and link "scheduled
   * maintenance #42" to incident #42.
   */
  test.each([
    ["Scheduled maintenance #42 overlapped"],
    ["Scheduled Maintenance: #42"],
    ["Episode #3"],
    ["incident episode #3"],
    ["PR #45"],
    ["pull request #45"],
    ["MR (#9)"],
    ["Issue: #7"],
    ["ticket #1234"],
    ["commit #3"],
    ["build #812 failed"],
    ["deployment #3"],
    ["release #12"],
    ["version #2"],
    ["job #5"],
    ["pipeline run #99"],
    ["step #1"],
    ["Steps #1"],
    ["retry #2"],
    ["line #42"],
    ["port #8080"],
    ["pod #2"],
    ["node #3"],
    ["page #2"],
    ["stage #1"],
    ["option #2"],
    ["priority #1"],
    ["No #5"],
    ["incident number #12"],
    ["monitor #4"],
    ["**Monitors** #4"],
  ])("%p is another numbering, not a reference", (text: string) => {
    expect(tokenizeEventReferences(text)).toEqual([]);
  });

  test("the siblings of a number from another numbering are not references either", () => {
    expect(referencesOf("PRs #45, #46 and #47")).toEqual([]);
    expect(referencesOf("incident #1, PR #2, #3")).toEqual([
      { kind: "incident", number: 1, text: "#1" },
    ]);
  });

  test("another numbering does not reach past its own number", () => {
    expect(referencesOf("PR #45 and incident #46, #47")).toEqual([
      { kind: "incident", number: 46, text: "#46" },
      { kind: "incident", number: 47, text: "#47" },
    ]);
    expect(referencesOf("PR #45 was like #46")).toEqual([
      { kind: null, number: 46, text: "#46" },
    ]);
    expect(referencesOf("the PR merged before #45")).toEqual([
      { kind: null, number: 45, text: "#45" },
    ]);
  });

  test("only the whole word counts as another numbering", () => {
    expect(referencesOf("prerelease #3, rerun #4, nodes2 #5")).toEqual([
      { kind: null, number: 3, text: "#3" },
      { kind: null, number: 4, text: "#4" },
      { kind: null, number: 5, text: "#5" },
    ]);
  });

  test("a null-kind reference does not carry anything", () => {
    expect(referencesOf("#1, #2 and incident #3, #4")).toEqual([
      { kind: null, number: 1, text: "#1" },
      { kind: null, number: 2, text: "#2" },
      { kind: "incident", number: 3, text: "#3" },
      { kind: "incident", number: 4, text: "#4" },
    ]);
  });

  test.each([
    ["abc#12", "preceded by a word character"],
    ["C#12", "preceded by a letter"],
    ["_#12", "preceded by an underscore"],
    ["9#12", "preceded by a digit"],
    ["&#123;", "an HTML entity"],
    ["https://x/#12", "a URL fragment"],
    ["##12", "a double hash"],
    ["#12abc", "followed by a word character"],
    ["#12_", "followed by an underscore"],
    ["#1234567890", "ten digits"],
    ["#10b981", "a hex colour"],
    ["#", "a bare hash"],
    ["# 12", "a hash and a space"],
    ["#abc", "no digits"],
  ])("%p is not a reference (%s)", (text: string) => {
    expect(tokenizeEventReferences(text)).toEqual([]);
  });

  test.each([
    ["#123456789", 123456789],
    ["(#12)", 12],
    ["[#12]", 12],
    ["#12.", 12],
    ["#12,", 12],
    ["#12-hotfix", 12],
    ["#007", 7],
    ["**#12**", 12],
    ["line one\n#12", 12],
  ])("%p is a reference to %p", (text: string, expected: number) => {
    const tokens: Array<InvestigationEventReferenceToken> =
      tokenizeEventReferences(text);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.number).toBe(expected);
    expect(text.slice(tokens[0]?.start, tokens[0]?.end)).toMatch(/^#\d+$/);
  });

  test("multiple references per line with accurate positions", () => {
    const text: string = "Like #1 and #22, unlike alert #333 (#4444).";
    const tokens: Array<InvestigationEventReferenceToken> =
      tokenizeEventReferences(text);

    expect(
      tokens.map((token: InvestigationEventReferenceToken): string => {
        return text.slice(token.start, token.end);
      }),
    ).toEqual(["#1", "#22", "#333", "#4444"]);
    expect(tokens).toEqual([
      { kind: null, number: 1, start: 5, end: 7 },
      { kind: null, number: 22, start: 12, end: 15 },
      { kind: "alert", number: 333, start: 30, end: 34 },
      { kind: null, number: 4444, start: 36, end: 41 },
    ]);
  });

  test("empty, hash-free and non-string input yield nothing", () => {
    expect(tokenizeEventReferences("")).toEqual([]);
    expect(tokenizeEventReferences("no references here")).toEqual([]);
    expect(tokenizeEventReferences(null as unknown as string)).toEqual([]);
  });

  test("repeated calls are independent (no shared RegExp state)", () => {
    const text: string = "incident #5 and #6";

    expect(tokenizeEventReferences(text)).toEqual(
      tokenizeEventReferences(text),
    );
    expect(tokenizeEventReferences("#7")).toEqual([
      { kind: null, number: 7, start: 0, end: 2 },
    ]);
  });
});

describe("extractEventReferences", () => {
  test("applies the default kind to unqualified references and keeps explicit kinds", () => {
    const references: Array<ExtractedInvestigationEventReference> =
      extractEventReferences(
        "Prior: #6954. Also alert #12 and incident #7.",
        "incident",
      );

    expect(references).toEqual([
      { kind: "incident", number: 6954 },
      { kind: "alert", number: 12 },
      { kind: "incident", number: 7 },
    ]);

    expect(extractEventReferences("Same as #3.", "alert")).toEqual([
      { kind: "alert", number: 3 },
    ]);
  });

  test("dedupes by kind and number in first-seen order", () => {
    expect(
      extractEventReferences(
        "#2 then #1 then #2 again, incident #1, alert #1, alert #1",
        "incident",
      ),
    ).toEqual([
      { kind: "incident", number: 2 },
      { kind: "incident", number: 1 },
      { kind: "alert", number: 1 },
    ]);
  });

  test("skips inline code spans, including multi-backtick spans", () => {
    expect(
      extractEventReferences(
        "Real #1, code `#2`, double ``a ` #3``, real #4.",
        "incident",
      ),
    ).toEqual([
      { kind: "incident", number: 1 },
      { kind: "incident", number: 4 },
    ]);
  });

  test("an unmatched backtick is literal and does not hide later references", () => {
    expect(
      extractEventReferences(
        "A stray ` then #5.\n\nNext paragraph #6 `",
        "alert",
      ),
    ).toEqual([
      { kind: "alert", number: 5 },
      { kind: "alert", number: 6 },
    ]);
  });

  test("a code span cannot carry a qualifier to a reference after it", () => {
    expect(extractEventReferences("incident `x` #9", "alert")).toEqual([
      { kind: "alert", number: 9 },
    ]);
  });

  test("skips fenced code blocks (``` and ~~~) but not text after them", () => {
    const markdown: string = [
      "Before #1.",
      "```",
      "#2 inside",
      "```",
      "~~~",
      "incident #3",
      "~~~",
      "After #4.",
    ].join("\n");

    expect(extractEventReferences(markdown, "incident")).toEqual([
      { kind: "incident", number: 1 },
      { kind: "incident", number: 4 },
    ]);
  });

  test("an unclosed fence hides the rest of the document", () => {
    expect(extractEventReferences("#1\n```\n#2\n\n#3", "incident")).toEqual([
      { kind: "incident", number: 1 },
    ]);
  });

  test("qualifiers work across a soft line break inside a paragraph", () => {
    expect(extractEventReferences("alerts\n#1, #2", "incident")).toEqual([
      { kind: "alert", number: 1 },
      { kind: "alert", number: 2 },
    ]);
  });

  test("a punctuated qualifier wins over the default kind", () => {
    expect(
      extractEventReferences("This matches prior incidents: #12, #13", "alert"),
    ).toEqual([
      { kind: "incident", number: 12 },
      { kind: "incident", number: 13 },
    ]);
    expect(
      extractEventReferences("Incident **#12** and **Alerts** #4", "alert"),
    ).toEqual([
      { kind: "incident", number: 12 },
      { kind: "alert", number: 4 },
    ]);
  });

  test("a number from another numbering is never given the default kind", () => {
    expect(
      extractEventReferences(
        "Scheduled maintenance #42 and PRs #45, #46 overlapped with #7.",
        "incident",
      ),
    ).toEqual([{ kind: "incident", number: 7 }]);
  });

  test("a bare number the report also names as the other kind is left out", () => {
    expect(
      extractEventReferences(
        "alert #12 fired, then #12 kept firing",
        "incident",
      ),
    ).toEqual([{ kind: "alert", number: 12 }]);
    // The explicit mention may come after the bare one.
    expect(
      extractEventReferences(
        "#12 first.\n\nLater: incident #12, #13.",
        "alert",
      ),
    ).toEqual([
      { kind: "incident", number: 12 },
      { kind: "incident", number: 13 },
    ]);
  });

  test("a bare number the report also puts in another numbering is left out", () => {
    expect(
      extractEventReferences(
        "Scheduled maintenance #42 ran long; #42 overlapped #7.",
        "incident",
      ),
    ).toEqual([{ kind: "incident", number: 7 }]);
  });

  test("a bare number still takes the default kind when only the same kind names it", () => {
    expect(
      extractEventReferences("incident #5 and again #5, plus #6", "incident"),
    ).toEqual([
      { kind: "incident", number: 5 },
      { kind: "incident", number: 6 },
    ]);
    // Another number named as the other kind does not affect this one.
    expect(
      extractEventReferences("alert #9 fired while #8 was open", "incident"),
    ).toEqual([
      { kind: "alert", number: 9 },
      { kind: "incident", number: 8 },
    ]);
  });

  test("the server's own evidence labels are not references once the body is parsed out", () => {
    const report: string = buildBrandedMarkdown({
      analysisMarkdown: "**Summary** — a recurrence of #12 [C1].",
      citations: [
        { id: "C1", label: "Incident #6954 timeline", rowCount: 1 },
        { id: "C2", label: "Scheduled maintenance #42", rowCount: 1 },
      ],
      toolCallCount: 2,
    });

    expect(extractEventReferences(report, "alert")).toEqual([
      { kind: "alert", number: 12 },
      { kind: "incident", number: 6954 },
    ]);
    expect(
      extractEventReferences(
        parseInvestigationReport(report).bodyMarkdown,
        "alert",
      ),
    ).toEqual([{ kind: "alert", number: 12 }]);
  });

  test("caps at the default limit of 25", () => {
    const markdown: string = Array.from(
      { length: 40 },
      (_value: unknown, index: number): string => {
        return `#${index + 1}`;
      },
    ).join(" ");

    const references: Array<ExtractedInvestigationEventReference> =
      extractEventReferences(markdown, "incident");

    expect(DEFAULT_EVENT_REFERENCE_LIMIT).toBe(25);
    expect(references).toHaveLength(25);
    expect(references[24]).toEqual({ kind: "incident", number: 25 });
  });

  test("honours a custom limit, counting unique references only", () => {
    expect(extractEventReferences("#1 #1 #1 #2 #3", "incident", 2)).toEqual([
      { kind: "incident", number: 1 },
      { kind: "incident", number: 2 },
    ]);
    expect(extractEventReferences("#1 #2 #3", "incident", 2.9)).toHaveLength(2);
  });

  test.each([0, -1, Number.NaN])(
    "limit %p returns nothing",
    (limit: number) => {
      expect(extractEventReferences("#1 #2", "incident", limit)).toEqual([]);
    },
  );

  test("handles CRLF, empty and non-string input", () => {
    expect(
      extractEventReferences("```\r\n#1\r\n```\r\n#2", "incident"),
    ).toEqual([{ kind: "incident", number: 2 }]);
    expect(extractEventReferences("", "incident")).toEqual([]);
    expect(
      extractEventReferences(undefined as unknown as string, "incident"),
    ).toEqual([]);
  });

  test("finds the references in the real server report, ignoring URL fragments and entities", () => {
    const markdown: string = `${SERVER_REPORT}\n\nSee https://status.example.com/#77 and &#123; and \`#88\`.`;

    expect(extractEventReferences(markdown, "incident")).toEqual([
      { kind: "incident", number: 6954 },
      { kind: "incident", number: 6963 },
    ]);
  });
});

describe("getCitationMarkerRegex", () => {
  function citationIds(text: string): Array<string> {
    const regex: RegExp = getCitationMarkerRegex();
    const ids: Array<string> = [];
    let match: RegExpExecArray | null = regex.exec(text);

    while (match) {
      ids.push(match[1] || "");
      match = regex.exec(text);
    }

    return ids;
  }

  test("is global and returns a fresh instance every call", () => {
    const first: RegExp = getCitationMarkerRegex();
    const second: RegExp = getCitationMarkerRegex();

    expect(first.global).toBe(true);
    expect(first).not.toBe(second);
    expect(first.source).toBe("\\[(C\\d{1,3})\\]");

    first.exec("[C1] [C2]");
    expect(first.lastIndex).toBeGreaterThan(0);
    expect(second.lastIndex).toBe(0);
  });

  test("captures one to three digit citation ids, including adjacent markers", () => {
    expect(citationIds("A [C1], B [C12][C123] and [C4][C5].")).toEqual([
      "C1",
      "C12",
      "C123",
      "C4",
      "C5",
    ]);
  });

  test("ignores malformed markers", () => {
    expect(citationIds("[C] [C1234] [c1] (C1) [ C1 ] [D1] C1")).toEqual([]);
  });
});

describe("AI_ROOT_CAUSE_HEADING_TEXT", () => {
  test("is the heading text the feeds and PostedRootCause look for", () => {
    expect(AI_ROOT_CAUSE_HEADING_TEXT).toBe(
      "AI — Automated Root Cause Analysis",
    );

    const postedRootCause: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Server",
        "Utils",
        "AI",
        "SRE",
        "PostedRootCause.ts",
      ),
      "utf8",
    );

    expect(postedRootCause).toContain(`"${AI_ROOT_CAUSE_HEADING_TEXT}"`);
  });
});

/*
 * Source pin: the test copy of buildBrandedMarkdown above must stay in step
 * with the server. If the engine's report format changes, update the copy,
 * then make sure the parser still understands it.
 */
describe("AIInvestigationEngine report format stays in sync with this parser", () => {
  const engineSource: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Server",
      "Utils",
      "AI",
      "SRE",
      "AIInvestigationEngine.ts",
    ),
    "utf8",
  );

  test.each([
    [
      "the brand heading",
      "`## 🧠 AI — Automated Root Cause Analysis\\n\\n${analysisMarkdown}`",
    ],
    ["the Evidence checked label", "markdown += `\\n\\n**Evidence checked**`;"],
    [
      "the evidence entry",
      "markdown += `\\n- **[${citation.id}]** ${citation.label} — ${citation.rowCount} row(s)`;",
    ],
    [
      "the footer opening",
      "markdown += `\\n\\n---\\n*Investigated automatically by OneUptime AI — read-only, ${result.toolCallCount} quer${",
    ],
    [
      "the singular/plural query word",
      'result.toolCallCount === 1 ? "y" : "ies"',
    ],
    ["the model name", 'result.modelName ? ` using ${result.modelName}` : ""'],
    [
      "the footer closing",
      "}. This is an AI-generated first pass; verify before acting.*`;",
    ],
    [
      "the cluster tool entry",
      "markdown += `\\n- **[${citation.id}]** ${citation.label} — ${clusterOutcome}`;",
    ],
    [
      "the kubectl outcomes",
      'return citation.rowCount > 0 ? "succeeded" : "kubectl returned an error";',
    ],
    [
      "the cluster listing outcome",
      "return `${citation.rowCount} cluster(s)`;",
    ],
    ["the kubectl command count", "} run on your Kubernetes clusters`,"],
    [
      "the nothing-run footer",
      'counts.push("no telemetry queries or kubectl commands run");',
    ],
    [
      "the cluster footer opening",
      "markdown += `\\n\\n---\\n*Investigated automatically by OneUptime AI — read-only, ${counts.join(",
    ],
  ])("engine still writes %s", (_name: string, fragment: string) => {
    expect(engineSource).toContain(fragment);
  });

  test("the persona still asks for the section labels the parser recognises", () => {
    for (const label of [
      "**Summary** —",
      "**Most likely root cause** —",
      "**Evidence** —",
      "**Suggested next steps** —",
    ]) {
      expect(engineSource).toContain(label);
    }
  });
});
