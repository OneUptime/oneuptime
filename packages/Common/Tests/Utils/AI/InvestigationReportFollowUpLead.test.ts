import { describe, expect, test } from "@jest/globals";
import { ObservabilityAssistantResult } from "../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIInvestigationEngine from "../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import IncidentFollowUpCheck from "../../../Server/Utils/AI/SRE/IncidentFollowUpCheck";
import { LinkedAffectedResourceType } from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import {
  FOLLOW_UP_REPORT_LEAD_PREFIX,
  InvestigationReportSectionKind,
  ParsedInvestigationReport,
  extractEventReferences,
  parseInvestigationReport,
} from "../../../Utils/AI/InvestigationReport";
import { MarkdownText } from "../../../Utils/Markdown/FeedMarkdown";

/*
 * A FOLLOW-UP CHECK'S REPORT LEADS WITH WHY IT WAS WRITTEN.
 *
 * When an alert opens on an open incident's linked infrastructure after its
 * first analysis, OneUptime AI checks the incident again, and the server
 * writes one line of its own under the report's heading: "**Checked again**
 * after alert #12 opened on Host web-1, 2 minutes after this incident was
 * declared: High CPU on web-1." Every reader of the report needs that line
 * apart from the model's analysis: the AI Investigation card draws it above
 * the Summary, the feed's entry says "OneUptime AI checked again after ...",
 * and the alert it names is a link. So the parser hands it over as
 * `followUpLead`, outside the preamble, the sections and bodyMarkdown - but
 * only where the server writes it, straight under the brand heading.
 */

const DECLARED_AT: Date = new Date("2026-10-16T14:30:00.000Z");

const ANALYSIS: string = [
  "**Summary** — The host's CPU alert confirms the earlier analysis: shop-api saturated web-1's CPU [C1].",
  "**Most likely root cause** — shop-api 2026.10.16-1 runs a busy loop on every request [C1].",
  "**Suggested next steps**\n1. Roll shop-api back.",
].join("\n\n");

function lead(
  overrides: Partial<{ title: string; withResource: boolean }> = {},
): MarkdownText {
  return IncidentFollowUpCheck.buildReportLead({
    incidentCreatedAt: DECLARED_AT,
    alertId: "11111111-1111-4111-8111-111111111111",
    alertNumber: 12,
    alertTitle: overrides.title ?? "High CPU on web-1",
    alertOpenedAt: new Date(DECLARED_AT.getTime() + 2 * 60 * 1000),
    resources:
      overrides.withResource === false
        ? []
        : [
            {
              type: LinkedAffectedResourceType.Host,
              id: "22222222-2222-4222-8222-222222222222",
              name: "web-1",
            },
          ],
  });
}

// The report exactly as the engine posts it.
function report(
  analysis: string,
  reportLead?: MarkdownText | undefined,
): string {
  return AIInvestigationEngine.buildBrandedMarkdown(
    {
      contentInMarkdown: analysis,
      citations: [{ id: "C1", label: "CPU of web-1", rowCount: 12 }],
      toolCallCount: 3,
      llmCallCount: 2,
      totalTokens: 1000,
    } as unknown as ObservabilityAssistantResult,
    analysis,
    0,
    0,
    reportLead,
  );
}

describe("the follow-up lead the server writes", () => {
  test("starts with the prefix the readers look for", () => {
    expect(lead().toString().startsWith(FOLLOW_UP_REPORT_LEAD_PREFIX)).toBe(
      true,
    );
    expect(FOLLOW_UP_REPORT_LEAD_PREFIX).toBe("**Checked again**");
  });

  test("says what opened, where and when, then the alert's title", () => {
    expect(lead().toString()).toBe(
      "**Checked again** after alert #12 opened on Host web-1, 2 minutes after this incident was declared: High CPU on web-1.",
    );
  });

  test("an alert template's title, brackets and all, closes the sentence instead of sitting in parentheses inside it", () => {
    expect(
      lead({
        title: "[Docker] High CPU Usage (>80% of one core) - web-1",
      }).toString(),
    ).toBe(
      "**Checked again** after alert #12 opened on Host web-1, 2 minutes after this incident was declared: \\[Docker\\] High CPU Usage (>80% of one core) - web-1.",
    );
  });

  test("without a title it ends after when; without a resource it names the incident's infrastructure", () => {
    expect(lead({ title: "  " }).toString()).toBe(
      "**Checked again** after alert #12 opened on Host web-1, 2 minutes after this incident was declared.",
    );
    expect(lead({ withResource: false }).toString()).toBe(
      "**Checked again** after alert #12 opened on infrastructure linked to this incident, 2 minutes after this incident was declared: High CPU on web-1.",
    );
  });

  test("a title's own full stops never double the sentence's, and a long title is cut", () => {
    expect(IncidentFollowUpCheck.describeLeadTitle("CPU is high.")).toBe(
      "CPU is high",
    );
    expect(IncidentFollowUpCheck.describeLeadTitle("  CPU is high ... ")).toBe(
      "CPU is high",
    );
    expect(IncidentFollowUpCheck.describeLeadTitle(undefined)).toBe("");

    const long: string = IncidentFollowUpCheck.describeLeadTitle(
      "x".repeat(500),
    );

    expect(long.length).toBe(200);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("parseInvestigationReport reads the lead apart from the analysis", () => {
  test("the lead, and an analysis that reads exactly as without one", () => {
    const withLead: ParsedInvestigationReport = parseInvestigationReport(
      report(ANALYSIS, lead()),
    );
    const without: ParsedInvestigationReport = parseInvestigationReport(
      report(ANALYSIS),
    );

    expect(withLead.followUpLead).toBe(lead().toString());
    expect(without.followUpLead).toBeUndefined();

    // Nothing else changes: not the preamble, the sections or the body.
    expect(withLead.preamble).toBe("");
    expect(withLead.isStructured).toBe(true);
    expect(withLead.sections).toEqual(without.sections);
    expect(withLead.summary).toBe(without.summary);
    expect(withLead.rootCause).toBe(without.rootCause);
    expect(withLead.bodyMarkdown).toBe(without.bodyMarkdown);
    expect(withLead.bodyMarkdown).not.toContain("Checked again");
    expect(withLead.evidenceChecked).toEqual(without.evidenceChecked);
    expect(withLead.footer).toEqual(without.footer);
  });

  test("an unstructured follow-up keeps its body, without the lead", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report("I looked at web-1 and found nothing new.", lead()),
    );

    expect(parsed.isStructured).toBe(false);
    expect(parsed.followUpLead).toBe(lead().toString());
    expect(parsed.bodyMarkdown).toBe(
      "I looked at web-1 and found nothing new.",
    );
    expect(parsed.preamble).toBe("I looked at web-1 and found nothing new.");
  });

  test("only straight under the brand heading: the same words from the model elsewhere stay its content", () => {
    const modelWrote: string = [
      "**Summary** — Nothing new.",
      "**Checked again** after the restart, the error rate stayed at 4%.",
      "**Most likely root cause** — A bad release.",
    ].join("\n\n");
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report(modelWrote),
    );

    expect(parsed.followUpLead).toBeUndefined();
    expect(parsed.summary).toContain("Checked again");
  });

  test("a report without the brand heading has no lead, whatever it starts with", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      `${lead().toString()}\n\n${ANALYSIS}`,
    );

    expect(parsed.followUpLead).toBeUndefined();
    expect(parsed.preamble).toContain("Checked again");
  });

  test("a lead in a code block is code, and an over-long paragraph is the model's", () => {
    const fenced: ParsedInvestigationReport = parseInvestigationReport(
      `## 🧠 AI — Automated Root Cause Analysis\n\n\`\`\`text\n**Checked again** after alert #12\n\`\`\`\n\n${ANALYSIS}`,
    );

    expect(fenced.followUpLead).toBeUndefined();

    const long: ParsedInvestigationReport = parseInvestigationReport(
      `## 🧠 AI — Automated Root Cause Analysis\n\n**Checked again** ${"word ".repeat(300)}\n\n${ANALYSIS}`,
    );

    expect(long.followUpLead).toBeUndefined();
    expect(long.preamble.startsWith("**Checked again**")).toBe(true);
  });

  test("the lead is one paragraph: the analysis after it is never swallowed", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report(ANALYSIS, lead()),
    );

    expect(parsed.followUpLead).not.toContain("Summary");
    expect(
      parsed.sections.map((section: { kind: string }) => {
        return section.kind;
      }),
    ).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.NextSteps,
    ]);
  });

  test("the alert the lead names is a reference the report makes", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report(ANALYSIS, lead()),
    );

    // The analysis never names alert #12; the lead does.
    expect(extractEventReferences(parsed.bodyMarkdown, "incident")).toEqual([]);
    expect(
      extractEventReferences(parsed.followUpLead || "", "incident"),
    ).toEqual([{ kind: "alert", number: 12 }]);
  });
});
