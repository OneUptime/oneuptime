import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The completed investigation, laid out for a responder: a Summary section
 * and the report split into its own sections. The queries behind the report
 * ("Evidence checked") are the host's to show (InvestigationRunDetails), so a
 * citation chip here only hands its id to the host through
 * onCitationActivate. The report is untrusted model output, so beyond layout
 * these tests pin that every fragment still goes through the safe markdown
 * renderer and that the only interactive things inside the prose are chips
 * for recorded citations and links to incidents/alerts the server resolved.
 *
 * react-markdown is mocked in Common jest, so the viewer mock below stands in
 * for the real inline-reference pipeline: it splits "[C#]" and "#123" tokens
 * out of the text and asks the panel's renderers for each one.
 */

const markdownViewerMock: MockFunction = getJestMockFunction();
const copyToClipboardMock: MockFunction = getJestMockFunction();
const citationActivateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Clipboard", () => {
  return {
    __esModule: true,
    default: {
      copyToClipboard: (...args: Array<unknown>) => {
        copyToClipboardMock(...args);
        return Promise.resolve(true);
      },
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      markdownViewerMock(props);
      const parts: Array<string> = props.text.split(
        /(\[C\d{1,3}\]|#\d{1,9}\b)/g,
      );

      return React.createElement(
        "div",
        { "data-testid": "report-markdown" },
        parts.map((part: string, index: number): React.ReactNode => {
          const citationPattern: RegExp = new RegExp("^\\[(C\\d{1,3})\\]$");
          const citation: RegExpExecArray | null = citationPattern.exec(part);

          if (citation && props.inlineReferences?.renderCitation) {
            const element: React.ReactElement | null =
              props.inlineReferences.renderCitation(citation[1]!);

            if (element) {
              return React.cloneElement(element, { key: index });
            }
          }

          const referencePattern: RegExp = new RegExp("^#(\\d{1,9})$");
          const reference: RegExpExecArray | null = referencePattern.exec(part);

          if (reference && props.inlineReferences?.renderEventReference) {
            const element: React.ReactElement | null =
              props.inlineReferences.renderEventReference({
                kind: null,
                number: parseInt(reference[1]!, 10),
                text: part,
              });

            if (element) {
              return React.cloneElement(element, { key: index });
            }
          }

          return part;
        }),
      );
    },
  };
});

import InvestigationReportView, {
  ComponentProps as ReportViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationReportView";
import {
  MAX_EVIDENCE_ITEMS,
  MAX_REPORT_SUMMARY_LENGTH,
  clipText,
  getInvestigationReportSummaryText,
  markdownToPlainText,
  parseInvestigationEvidence,
  parseInvestigationEvidenceRows,
  parseInvestigationReferences,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationReportData";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import {
  AIChatCitationTargetType,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import { getMaxLengthFromTableColumnType } from "../../../Types/Database/ColumnLength";
import { getTableColumn } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  InvestigationEventReference,
  InvestigationEvidenceItem,
} from "../../../Types/AI/InvestigationEvidence";
import type { MarkdownInlineReferenceRenderers } from "../../../UI/Components/Markdown.tsx/InlineReferences";
import {
  InvestigationReportSectionKind,
  parseInvestigationReport,
} from "../../../Utils/AI/InvestigationReport";
import { formatEvidenceLabel } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";

interface MarkdownViewerProps {
  text: string;
  safeMode?: boolean | undefined;
  inlineReferences?: MarkdownInlineReferenceRenderers | undefined;
}

const PRIOR_INCIDENT_ID: string = "66666666-6666-4666-8666-666666666666";
const ALERT_ID: string = "44444444-4444-4444-8444-444444444444";
const TLDR: string =
  "Checkout is returning 500s because the database connection pool is exhausted.";

const SERVER_REPORT: string = [
  "## \u{1F9E0} AI — Automated Root Cause Analysis",
  "",
  "**Summary** — the connection pool ran dry after the 18:00 deploy [C1].",
  "",
  "**Most likely root cause** — the deploy halved the pool size; this matches prior #6954 [C2].",
  "",
  "**Evidence**",
  "- 7 active incidents on checkout [C1]",
  "- pool timeouts in the API logs [C2]",
  "",
  "**Suggested next steps**",
  "- Roll back the deploy",
  "- Raise the pool size",
  "",
  "**Evidence checked**",
  "- **[C1]** Active incidents (7 total) — 7 row(s)",
  "- **[C2]** Logs 17:20 – 18:20 (1 shown) — 1 row(s)",
  "",
  "---",
  "*Investigated automatically by OneUptime AI — read-only, 2 queries run across your own telemetry using gpt-5. This is an AI-generated first pass; verify before acting.*",
].join("\n");

const evidence: Array<InvestigationEvidenceItem> = [
  {
    citationId: "C1",
    toolName: "query_incidents",
    label: "Active incidents (7 total)",
    rowCount: 7,
    queryArguments: { state: "active" },
    target: { type: AIChatCitationTargetType.Incidents },
    executedAt: "2026-09-14T18:01:00.000Z",
    canLoadRows: true,
  },
  {
    citationId: "C2",
    toolName: "search_logs",
    label: "Logs 17:20 – 18:20 (1 shown)",
    rowCount: 1,
    queryArguments: { bodySearchText: "pool timeout" },
    target: { type: AIChatCitationTargetType.Logs },
    executedAt: "2026-09-14T18:02:00.000Z",
    canLoadRows: true,
  },
];

const priorIncident: InvestigationEventReference = {
  kind: "incident",
  number: 6954,
  id: PRIOR_INCIDENT_ID,
  displayNumber: "INC-6954",
  title: "Checkout pool exhausted",
  stateName: "Resolved",
};

function viewProps(overrides: Partial<ReportViewProps> = {}): ReportViewProps {
  const analysisMarkdown: string = overrides.analysisMarkdown ?? SERVER_REPORT;

  return {
    analysisMarkdown,
    report: parseInvestigationReport(analysisMarkdown),
    analysisTldr: null,
    evidence,
    references: [priorIncident],
    subjectType: "incident",
    onCitationActivate: (citationId: string): void => {
      citationActivateMock(citationId);
    },
    ...overrides,
  };
}

function renderView(
  overrides: Partial<ReportViewProps> = {},
): ReturnType<typeof render> {
  return render(<InvestigationReportView {...viewProps(overrides)} />);
}

function viewerCalls(): Array<MarkdownViewerProps> {
  return (
    markdownViewerMock.mock.calls as Array<Array<MarkdownViewerProps>>
  ).map((call: Array<MarkdownViewerProps>): MarkdownViewerProps => {
    return call[0]!;
  });
}

function viewerTexts(): Array<string> {
  return viewerCalls().map((call: MarkdownViewerProps): string => {
    return call.text;
  });
}

function lastRenderers(): MarkdownInlineReferenceRenderers {
  const calls: Array<MarkdownViewerProps> = viewerCalls();
  return calls[calls.length - 1]!.inlineReferences!;
}

function reportSectionHeadings(): Array<string> {
  const report: HTMLElement = screen.getByLabelText("Investigation report");
  return within(report)
    .queryAllByRole("heading", { level: 4 })
    .map((heading: HTMLElement): string => {
      return heading.textContent || "";
    });
}

function citationChips(citationId: string): Array<HTMLElement> {
  return screen.queryAllByRole("button", {
    name: (accessibleName: string): boolean => {
      return accessibleName.startsWith(`Citation ${citationId}:`);
    },
  });
}

function activatedCitations(): Array<string> {
  return (citationActivateMock.mock.calls as Array<Array<string>>).map(
    (call: Array<string>): string => {
      return call[0]!;
    },
  );
}

afterEach(() => {
  cleanup();
  markdownViewerMock.mockReset();
  copyToClipboardMock.mockReset();
  citationActivateMock.mockReset();
});

describe("InvestigationReportView summary section", () => {
  test("leads with the TL;DR as plain text, then the report's Summary", () => {
    renderView({ analysisTldr: TLDR });

    const summary: HTMLElement = screen.getByRole("region", {
      name: "Investigation summary",
    });
    expect(
      within(summary).getByRole("heading", { name: "Summary" }),
    ).toBeInTheDocument();
    expect(within(summary).getByText("TL;DR")).toBeInTheDocument();

    const tldr: HTMLElement = within(summary).getByText(TLDR);
    expect(tldr.tagName).toBe("P");
    expect(tldr).toHaveClass("text-base", "font-semibold", "text-gray-900");

    const summaryMarkdown: HTMLElement =
      within(summary).getByTestId("report-markdown");
    expect(summaryMarkdown).toHaveTextContent(
      "the connection pool ran dry after the 18:00 deploy",
    );
    expect(
      tldr.compareDocumentPosition(summaryMarkdown) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The TL;DR is never routed through markdown.
    expect(viewerTexts()).not.toContain(TLDR);
    expect(
      viewerTexts().some((text: string): boolean => {
        return text.includes("Checkout is returning 500s");
      }),
    ).toBe(false);
  });

  test("uses the Summary as the lead text when there is no TL;DR", () => {
    renderView();

    const summary: HTMLElement = screen.getByRole("region", {
      name: "Investigation summary",
    });
    expect(within(summary).queryByText("TL;DR")).toBeNull();
    expect(within(summary).getByTestId("report-markdown")).toHaveTextContent(
      "the connection pool ran dry after the 18:00 deploy",
    );
  });

  test("shows only the TL;DR when the report has no Summary", () => {
    renderView({
      analysisMarkdown: "## Root cause\n\nThe pool was exhausted.",
      analysisTldr: TLDR,
    });

    const summary: HTMLElement = screen.getByRole("region", {
      name: "Investigation summary",
    });
    expect(summary).toHaveTextContent(TLDR);
    expect(within(summary).queryByTestId("report-markdown")).toBeNull();
  });

  test("has no summary section with neither a TL;DR nor a Summary", () => {
    renderView({
      analysisMarkdown: "## Root cause\n\nThe pool was exhausted.",
      analysisTldr: "   ",
    });

    expect(
      screen.queryByRole("region", { name: "Investigation summary" }),
    ).toBeNull();
    expect(screen.queryByText("TL;DR")).toBeNull();
  });

  /*
   * The host draws the run's evidence and activity directly under whatever
   * this view renders, so the report has to be the view's last element: a
   * section appended after it would land between the report and the queries
   * its citations point at.
   */
  test("sits above the report, which is the last thing the view draws", () => {
    const { container } = renderView({ analysisTldr: TLDR });

    const summary: HTMLElement = screen.getByRole("region", {
      name: "Investigation summary",
    });
    const report: HTMLElement = screen.getByRole("region", {
      name: "Investigation report",
    });

    expect(
      summary.compareDocumentPosition(report) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(Array.from(container.children)).toEqual([summary, report]);
  });

  test("renders a hostile TL;DR inertly", () => {
    const hostile: string =
      '<img src=x onerror="window.__reportPwned = true"> **bold** [link](https://evil.example)';
    renderView({ analysisTldr: hostile });

    const summary: HTMLElement = screen.getByLabelText("Investigation summary");
    expect(summary).toHaveTextContent(hostile);
    expect(summary.querySelector("img")).toBeNull();
    expect(summary.querySelector("a")).toBeNull();
    expect(
      (window as unknown as { __reportPwned?: boolean }).__reportPwned,
    ).toBeUndefined();
  });
});

describe("InvestigationReportView report section", () => {
  test("lays out the report's own sections in order, without the summary", () => {
    renderView();

    expect(reportSectionHeadings()).toEqual([
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
    ]);

    const report: HTMLElement = screen.getByLabelText("Investigation report");
    expect(report).not.toHaveTextContent("the connection pool ran dry");
  });

  test("labels each sub-section by its heading", () => {
    renderView();

    const report: HTMLElement = screen.getByLabelText("Investigation report");
    const subSections: Array<Element> = Array.from(
      report.querySelectorAll("section[aria-labelledby]"),
    );

    expect(subSections).toHaveLength(3);

    for (const subSection of subSections) {
      const headingId: string = subSection.getAttribute("aria-labelledby")!;
      const heading: HTMLElement | null = document.getElementById(headingId);
      expect(heading).not.toBeNull();
      expect(heading!.tagName).toBe("H4");
      expect(subSection).toContainElement(heading);
    }

    expect(
      screen.getByRole("region", { name: "Suggested next steps" }),
    ).toHaveTextContent("Roll back the deploy");
  });

  test("calls out the most likely root cause", () => {
    renderView();

    const rootCause: HTMLElement = screen.getByRole("region", {
      name: "Most likely root cause",
    });
    expect(rootCause).toHaveClass("border-amber-200", "bg-amber-50/60");
    expect(
      within(rootCause).getByRole("heading", {
        name: "Most likely root cause",
      }),
    ).toHaveClass("uppercase", "text-amber-700");
    expect(rootCause).toHaveTextContent("the deploy halved the pool size");
  });

  /*
   * Models often open the root cause with its own sub-heading. That heading
   * belongs to the root cause, so the callout (and its title) must survive
   * rather than the body turning into an unrelated section.
   */
  test("keeps a root cause that opens with a sub-heading inside its callout", () => {
    const markdown: string = [
      "## Summary",
      "Pool exhausted.",
      "",
      "## Most likely root cause",
      "### Connection pool exhaustion",
      "The pool hit 100% after the deploy [C1].",
      "",
      "## Evidence",
      "- pool timeouts [C2]",
    ].join("\n");
    renderView({ analysisMarkdown: markdown });

    const rootCause: HTMLElement = screen.getByRole("region", {
      name: "Most likely root cause",
    });
    expect(rootCause).toHaveAttribute(
      "data-section-kind",
      InvestigationReportSectionKind.RootCause,
    );
    expect(rootCause).toHaveClass("border-amber-200", "bg-amber-50/60");
    expect(rootCause).toHaveTextContent("Connection pool exhaustion");
    expect(rootCause).toHaveTextContent("The pool hit 100% after the deploy");
    // Its citation still becomes a chip inside the callout.
    expect(
      within(rootCause).getByRole("button", {
        name: "Citation C1: Active incidents (7 total)",
      }),
    ).toBeInTheDocument();

    // The sub-heading is part of the callout, not a section of its own.
    expect(reportSectionHeadings()).toEqual([
      "Most likely root cause",
      "Evidence",
    ]);
    expect(
      screen.queryByRole("region", { name: "Connection pool exhaustion" }),
    ).toBeNull();
    expect(
      screen
        .getByLabelText("Investigation report")
        .querySelector(
          `[data-section-kind="${InvestigationReportSectionKind.Other}"]`,
        ),
    ).toBeNull();
  });

  test("keeps a root cause that is only a sub-heading inside its callout", () => {
    const markdown: string = [
      "## Summary",
      "Pool exhausted.",
      "",
      "## Most likely root cause",
      "### Inconclusive",
      "",
      "## Evidence",
      "- pool timeouts [C2]",
    ].join("\n");
    renderView({ analysisMarkdown: markdown });

    const rootCause: HTMLElement = screen.getByRole("region", {
      name: "Most likely root cause",
    });
    expect(rootCause).toHaveClass("border-amber-200");
    expect(rootCause).toHaveTextContent("Inconclusive");
    expect(reportSectionHeadings()).toEqual([
      "Most likely root cause",
      "Evidence",
    ]);
  });

  test("keeps the brand heading, evidence list and footer out of the rendered text", () => {
    renderView();

    for (const text of viewerTexts()) {
      expect(text).not.toContain("Automated Root Cause Analysis");
      expect(text).not.toContain("Evidence checked");
      expect(text).not.toContain("Investigated automatically");
    }
  });

  test("renders every fragment through the safe viewer with inline references", () => {
    renderView({ analysisTldr: TLDR });

    expect(viewerCalls().length).toBeGreaterThanOrEqual(4);

    for (const call of viewerCalls()) {
      expect(call.safeMode).toBe(true);
      expect(typeof call.inlineReferences?.renderCitation).toBe("function");
      expect(typeof call.inlineReferences?.renderEventReference).toBe(
        "function",
      );
    }
  });

  test("keeps the report's preamble before its sections", () => {
    const markdown: string = [
      "Paged at 18:02 for checkout errors.",
      "",
      "## Summary",
      "Pool exhausted.",
      "",
      "## Root cause",
      "A deploy.",
    ].join("\n");
    renderView({ analysisMarkdown: markdown });

    const report: HTMLElement = screen.getByLabelText("Investigation report");
    const fragments: Array<HTMLElement> =
      within(report).getAllByTestId("report-markdown");
    expect(fragments[0]).toHaveTextContent(
      "Paged at 18:02 for checkout errors.",
    );
    expect(fragments[1]).toHaveTextContent("A deploy.");
    expect(reportSectionHeadings()).toEqual(["Root cause"]);
  });

  test("keeps unknown sections under their own title", () => {
    const markdown: string = [
      "**Summary** — Pool exhausted.",
      "",
      "**Most likely root cause** — A deploy.",
      "",
      "**Blast radius**",
      "Checkout and cart.",
    ].join("\n");
    renderView({ analysisMarkdown: markdown });

    expect(reportSectionHeadings()).toEqual([
      "Most likely root cause",
      "Blast radius",
    ]);
    expect(
      screen.getByRole("region", { name: "Blast radius" }),
    ).toHaveTextContent("Checkout and cart.");
  });

  test("keeps a second Summary in the report", () => {
    const markdown: string = [
      "**Summary** — First.",
      "",
      "**Most likely root cause** — A deploy.",
      "",
      "## Summary",
      "Second summary.",
    ].join("\n");
    renderView({ analysisMarkdown: markdown });

    expect(screen.getByLabelText("Investigation summary")).toHaveTextContent(
      "First.",
    );
    expect(reportSectionHeadings()).toEqual([
      "Most likely root cause",
      "Summary",
    ]);
    expect(screen.getByLabelText("Investigation report")).toHaveTextContent(
      "Second summary.",
    );
  });

  test("falls back to one viewer for an unstructured report", () => {
    const markdown: string =
      "## Alert root cause\n\nThe upstream dependency rejected requests.";
    renderView({ analysisMarkdown: markdown });

    expect(viewerTexts()).toEqual([markdown]);
    expect(reportSectionHeadings()).toEqual([]);
    expect(
      screen.queryByRole("region", { name: "Investigation summary" }),
    ).toBeNull();
    expect(screen.getByTestId("report-markdown")).toHaveTextContent(
      "The upstream dependency rejected requests.",
    );
  });

  test("an unstructured branded report drops only its chrome", () => {
    const markdown: string = [
      "## \u{1F9E0} AI — Automated Root Cause Analysis",
      "",
      "Nothing conclusive was found.",
      "",
      "---",
      "*Investigated automatically by OneUptime AI — read-only, 1 query run across your own telemetry.*",
    ].join("\n");
    renderView({ analysisMarkdown: markdown, evidence: [] });

    expect(viewerTexts()).toEqual(["Nothing conclusive was found."]);
  });

  test("says so when a structured report has nothing beyond its summary", () => {
    renderView({ analysisMarkdown: "**Summary** — Pool exhausted." });

    expect(screen.getByLabelText("Investigation report")).toHaveTextContent(
      "The report's findings are in the summary above.",
    );
  });

  /*
   * The header's one line under the title is the caveat a responder needs
   * before acting on model output; the separate "AI generated" pill said the
   * same thing twice and is gone. Copy report still copies the report as
   * published, not the sections rendered below it.
   */
  test("flags the report as an AI first pass and Copy report copies the original markdown", async () => {
    renderView();

    const report: HTMLElement = screen.getByRole("region", {
      name: "Investigation report",
    });
    const heading: HTMLElement = within(report).getByRole("heading", {
      name: "Investigation report",
    });
    const caveat: HTMLElement = within(report).getByText(
      "AI-generated first pass — verify before acting.",
    );
    expect(heading.parentElement).toContainElement(caveat);
    expect(
      heading.compareDocumentPosition(caveat) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(report).not.toHaveTextContent("AI generated");

    const copyButton: HTMLElement = within(report).getByRole("button", {
      name: "Copy report",
    });
    expect(copyButton).toHaveAttribute("type", "button");
    fireEvent.click(copyButton);

    expect(copyToClipboardMock).toHaveBeenCalledTimes(1);
    expect(copyToClipboardMock).toHaveBeenCalledWith(SERVER_REPORT);
    // The label only flips once the clipboard has taken the text.
    expect(
      await within(copyButton).findByText("Report copied"),
    ).toBeInTheDocument();
  });
});

describe("InvestigationReportView inline references", () => {
  test("turns a recorded citation into a chip", () => {
    renderView();

    const chips: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Citation C1: Active incidents (7 total)",
    });
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0]).toHaveAttribute("type", "button");
    expect(chips[0]).toHaveAttribute("title", "Active incidents (7 total)");
    expect(chips[0]).toHaveTextContent("C1");
    expect(chips[0]).toHaveClass("tabular-nums", "ring-inset");
  });

  /*
   * The formatted label depends on the viewer's timezone and clock, so the
   * expected name is derived with the same formatter the evidence row uses
   * (InvestigationEvidenceList's suite pins the row side of that contract).
   */
  test("reads a timestamped citation the way its evidence row shows it", () => {
    const rawLabel: string =
      "Logs 2026-09-14T17:20:00Z – 2026-09-14T18:20:00Z (1 shown)";
    const displayLabel: string = formatEvidenceLabel(rawLabel);
    expect(displayLabel).not.toBe(rawLabel);

    renderView({
      analysisMarkdown:
        "**Summary** — Pool timeouts [C2].\n\n**Most likely root cause** — A deploy [C2].",
      evidence: [evidence[0]!, { ...evidence[1]!, label: rawLabel }],
    });

    const chips: Array<HTMLElement> = screen.getAllByRole("button", {
      name: `Citation C2: ${displayLabel}`,
    });
    expect(chips).toHaveLength(2);

    for (const chip of chips) {
      expect(chip.getAttribute("aria-label")).not.toContain("2026-09-14T");
      expect(chip.getAttribute("aria-label")).not.toContain("00Z");
      // The tooltip keeps the raw label, like the evidence row's.
      expect(chip).toHaveAttribute("title", rawLabel);
      expect(chip).toHaveTextContent("C2");
    }

    // Activating it hands the host the id, not the formatted label.
    fireEvent.click(chips[1]!);
    expect(activatedCitations()).toEqual(["C2"]);
  });

  test("reads a timestamped legacy citation in local time too", () => {
    const rawLabel: string =
      "Changes 2026-09-13T18:02:00.000Z → 2026-09-14T18:02:00.000Z (3 events)";
    const markdown: string = [
      "**Summary** — A deploy changed the pool [C5].",
      "",
      "**Evidence checked**",
      `- **[C5]** ${rawLabel} — 3 row(s)`,
      "",
      "---",
      "*Investigated automatically by OneUptime AI — read-only, 1 query run across your own telemetry using gpt-5. This is an AI-generated first pass; verify before acting.*",
    ].join("\n");
    const report: ReturnType<typeof parseInvestigationReport> =
      parseInvestigationReport(markdown);
    // The fixture only proves something if the legacy label kept its timestamps.
    expect(report.evidenceChecked).toEqual([
      expect.objectContaining({ citationId: "C5", label: rawLabel }),
    ]);

    renderView({ analysisMarkdown: markdown, evidence: [] });

    const chip: HTMLElement = screen.getByRole("button", {
      name: `Citation C5: ${formatEvidenceLabel(rawLabel)}`,
    });
    expect(chip.getAttribute("aria-label")).not.toContain("2026-09-13T");
    expect(chip).toHaveAttribute("title", rawLabel);
  });

  /*
   * A chip promises "there is a query behind this"; a marker the run never
   * recorded has nowhere to go, so it must stay the text the model wrote.
   */
  test("leaves a citation that is not in the evidence list as plain text", () => {
    renderView({
      analysisMarkdown:
        "**Summary** — Pool exhausted [C9].\n\n**Most likely root cause** — A deploy [C1].",
    });

    const summary: HTMLElement = screen.getByRole("region", {
      name: "Investigation summary",
    });
    expect(summary).toHaveTextContent("Pool exhausted [C9].");
    expect(within(summary).queryByRole("button")).toBeNull();
    expect(citationChips("C9")).toHaveLength(0);
    expect(citationChips("C1")).toHaveLength(1);

    const renderers: MarkdownInlineReferenceRenderers = lastRenderers();
    expect(renderers.renderCitation!("C9")).toBeNull();
    expect(renderers.renderCitation!("C1")).not.toBeNull();
  });

  test("leaves every citation as plain text when the run recorded no evidence", () => {
    renderView({
      analysisMarkdown:
        "**Summary** — Pool exhausted [C1].\n\n**Most likely root cause** — A deploy [C2].",
      evidence: [],
    });

    expect(screen.getByLabelText("Investigation summary")).toHaveTextContent(
      "Pool exhausted [C1].",
    );
    expect(
      screen.getByRole("region", { name: "Most likely root cause" }),
    ).toHaveTextContent("A deploy [C2].");
    expect(screen.getAllByRole("button")).toEqual([
      screen.getByRole("button", { name: "Copy report" }),
    ]);
  });

  /*
   * Once the API returns structured evidence it is the source of truth: the
   * report's own "Evidence checked" lines are only a fallback for runs that
   * predate it, so a chip must not borrow a label (or a citation) from them.
   */
  test("labels chips from the structured evidence rather than the report's own list", () => {
    renderView({
      evidence: [{ ...evidence[0]!, label: "Active incidents (8 total)" }],
    });

    const chips: Array<HTMLElement> = citationChips("C1");
    expect(chips.length).toBeGreaterThan(0);

    for (const chip of chips) {
      expect(chip).toHaveAccessibleName(
        "Citation C1: Active incidents (8 total)",
      );
      expect(chip).toHaveAttribute("title", "Active incidents (8 total)");
    }

    // C2 is only in the report's own list, so it stays plain text.
    expect(citationChips("C2")).toHaveLength(0);
    expect(
      screen.getByRole("region", { name: "Most likely root cause" }),
    ).toHaveTextContent("[C2]");
  });

  /*
   * The view no longer owns the evidence list: revealing, expanding and
   * highlighting the query is the host's job (InvestigationRunDetails and
   * InvestigationEvidenceList). What the view owns is handing over the right
   * id, from every chip, every time; the host numbers each request, so a
   * second click on the same chip must reach it again.
   */
  test("a chip click hands its citation to the host, every time", () => {
    renderView();

    // One chip in the summary and one under Evidence, sharing a renderer.
    const summaryChip: HTMLElement = within(
      screen.getByRole("region", { name: "Investigation summary" }),
    ).getByRole("button", { name: "Citation C1: Active incidents (7 total)" });
    const evidenceChip: HTMLElement = within(
      screen.getByRole("region", { name: "Evidence" }),
    ).getByRole("button", { name: "Citation C1: Active incidents (7 total)" });
    const rootCauseChip: HTMLElement = within(
      screen.getByRole("region", { name: "Most likely root cause" }),
    ).getByRole("button", {
      name: "Citation C2: Logs 17:20 – 18:20 (1 shown)",
    });
    expect(citationActivateMock).not.toHaveBeenCalled();

    fireEvent.click(rootCauseChip);
    expect(activatedCitations()).toEqual(["C2"]);

    fireEvent.click(summaryChip);
    fireEvent.click(evidenceChip);
    fireEvent.click(evidenceChip);
    expect(activatedCitations()).toEqual(["C2", "C1", "C1", "C1"]);

    // The chips stay put; nothing is expanded or listed in the view itself.
    expect(citationChips("C1")).toEqual([summaryChip, evidenceChip]);
    expect(screen.queryByRole("list", { name: "Evidence checked" })).toBeNull();
  });

  test("a legacy citation hands its id to the host too", () => {
    renderView({ evidence: [] });

    const chips: Array<HTMLElement> = citationChips("C2");
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0]).toHaveAccessibleName(
      "Citation C2: Logs 17:20 – 18:20 (1 shown)",
    );

    fireEvent.click(chips[0]!);
    expect(activatedCitations()).toEqual(["C2"]);
  });

  /*
   * Nothing stops a host from passing a new handler on a later render (an
   * inline arrow, or a callback whose dependencies changed). Chips come from
   * a memoised renderer, so they must pick up the current handler rather
   * than keep reporting to the one from the first render.
   */
  test("a chip reports to the host's current handler after a re-render", () => {
    const firstHandler: MockFunction = getJestMockFunction();
    const secondHandler: MockFunction = getJestMockFunction();
    const { rerender } = renderView({
      onCitationActivate: (citationId: string): void => {
        firstHandler(citationId);
      },
    });

    rerender(
      <InvestigationReportView
        {...viewProps({
          onCitationActivate: (citationId: string): void => {
            secondHandler(citationId);
          },
        })}
      />,
    );

    fireEvent.click(citationChips("C1")[0]!);
    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledWith("C1");
  });

  test("links a resolved incident number to its page", () => {
    renderView();

    const link: HTMLElement = screen.getByRole("link", {
      name: "INC-6954 · Checkout pool exhausted · Resolved",
    });
    expect(link).toHaveTextContent("#6954");
    expect(link.getAttribute("href")).toMatch(
      new RegExp(`/incidents/${PRIOR_INCIDENT_ID}$`),
    );
    expect(link).toHaveAttribute(
      "title",
      "INC-6954 · Checkout pool exhausted · Resolved",
    );
  });

  test("leaves an unresolved number as plain text", () => {
    renderView({ references: [] });

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByLabelText("Investigation report")).toHaveTextContent(
      "prior #6954",
    );
    expect(
      lastRenderers().renderEventReference!({
        kind: "incident",
        number: 6954,
        text: "#6954",
      }),
    ).toBeNull();
  });

  test("an unqualified number resolves against the subject type", () => {
    const alertReference: InvestigationEventReference = {
      kind: "alert",
      number: 6954,
      id: ALERT_ID,
      displayNumber: "#6954",
      title: "Payment webhook failures",
    };

    renderView({
      subjectType: "alert",
      references: [priorIncident, alertReference],
    });

    const link: HTMLElement = screen.getByRole("link", {
      name: "#6954 · Payment webhook failures",
    });
    expect(link.getAttribute("href")).toMatch(
      new RegExp(`/alerts/${ALERT_ID}$`),
    );
  });

  test("an explicit qualifier wins over the subject type", () => {
    renderView({ subjectType: "alert" });

    const element: React.ReactElement | null = lastRenderers()
      .renderEventReference!({
      kind: "incident",
      number: 6954,
      text: "#6954",
    });
    expect(element).not.toBeNull();

    cleanup();
    render(element!);

    expect(screen.getByRole("link").getAttribute("href")).toMatch(
      new RegExp(`/incidents/${PRIOR_INCIDENT_ID}$`),
    );
  });

  test("hostile report markdown never produces a link or image outside resolved references", () => {
    const hostile: string = [
      "**Summary** — <img src=x onerror=alert(1)> [click](https://evil.example) ![p](https://evil.example/p.png)",
      "",
      "**Most likely root cause** — [C1]: https://evil.example and #999999",
    ].join("\n");
    const { container } = renderView({
      analysisMarkdown: hostile,
      references: [],
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();

    for (const call of viewerCalls()) {
      expect(call.safeMode).toBe(true);
    }
  });
});

/*
 * "Evidence checked" moved into the run details the host renders below the
 * report (collapsed, next to the activity). Drawing it here as well would
 * list every query twice, so the view must leave it out whichever source the
 * list would come from.
 */
describe("InvestigationReportView evidence", () => {
  test("never lists the structured evidence itself", () => {
    const { container } = renderView();

    expect(screen.queryByLabelText("Evidence checked")).toBeNull();
    expect(screen.queryByRole("list", { name: "Evidence checked" })).toBeNull();
    expect(container).not.toHaveTextContent("Active incidents (7 total)");
    expect(container).not.toHaveTextContent("2 queries");
    // The citations still resolve against it.
    expect(citationChips("C1").length).toBeGreaterThan(0);
    expect(citationChips("C2").length).toBeGreaterThan(0);
  });

  test("never lists the report's own evidence entries for older runs", () => {
    const { container } = renderView({ evidence: [] });

    expect(screen.queryByLabelText("Evidence checked")).toBeNull();
    expect(container).not.toHaveTextContent("Active incidents (7 total)");
    expect(container).not.toHaveTextContent("Logs 17:20 – 18:20 (1 shown)");
    // Legacy citations still become chips.
    expect(citationChips("C1").length).toBeGreaterThan(0);
    expect(citationChips("C2").length).toBeGreaterThan(0);
  });
});

describe("InvestigationReportData payload parsing", () => {
  test("reads well-formed evidence and sorts it by citation number", () => {
    const parsed: Array<InvestigationEvidenceItem> = parseInvestigationEvidence(
      [
        {
          citationId: "C10",
          toolName: "query_metrics",
          label: "P95(latency)",
          rowCount: 40,
          queryArguments: { metricName: "latency" },
          canLoadRows: true,
        },
        {
          citationId: "C2",
          toolName: "search_logs",
          label: "Logs",
          rowCount: 3,
          durationInMs: 120,
          queryArguments: { bodySearchText: "timeout" },
          target: { type: "Logs" },
          executedAt: "2026-09-14T18:01:00.000Z",
          canLoadRows: true,
        },
      ],
    );

    expect(
      parsed.map((item: InvestigationEvidenceItem): string => {
        return item.citationId;
      }),
    ).toEqual(["C2", "C10"]);
    expect(parsed[0]).toEqual({
      citationId: "C2",
      toolName: "search_logs",
      label: "Logs",
      rowCount: 3,
      durationInMs: 120,
      queryArguments: { bodySearchText: "timeout" },
      target: { type: AIChatCitationTargetType.Logs },
      executedAt: "2026-09-14T18:01:00.000Z",
      canLoadRows: true,
    });
  });

  test("treats a missing or malformed evidence field as empty", () => {
    expect(parseInvestigationEvidence(undefined)).toEqual([]);
    expect(parseInvestigationEvidence(null)).toEqual([]);
    expect(parseInvestigationEvidence({})).toEqual([]);
    expect(parseInvestigationEvidence("C1")).toEqual([]);
  });

  test("drops malformed items and duplicate citations", () => {
    const parsed: Array<InvestigationEvidenceItem> = parseInvestigationEvidence(
      [
        null,
        "C1",
        { citationId: "1", toolName: "search_logs" },
        { citationId: "C1234", toolName: "search_logs" },
        { citationId: "c1", toolName: "search_logs" },
        { citationId: "C1" },
        { citationId: "C1", toolName: "   " },
        { citationId: "C1", toolName: "search_logs", label: "first" },
        { citationId: "C1", toolName: "search_logs", label: "second" },
      ],
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.label).toBe("first");
  });

  test("normalises item fields defensively", () => {
    const [item] = parseInvestigationEvidence([
      {
        citationId: "C1",
        toolName: "query_incidents",
        rowCount: -4,
        durationInMs: "fast",
        queryArguments: {
          state: "active",
          limit: 20,
          problemsOnly: true,
          nested: { a: 1 },
          list: ["a", 1, false, { b: 2 }, null],
          infinite: Number.POSITIVE_INFINITY,
        },
        target: { type: "NotARealTarget" },
        executedAt: "not a date",
        canLoadRows: "yes",
      },
    ]);

    expect(item).toEqual({
      citationId: "C1",
      toolName: "query_incidents",
      label: "query_incidents",
      rowCount: 0,
      queryArguments: {
        state: "active",
        limit: 20,
        problemsOnly: true,
        list: ["a", 1, false],
      },
      canLoadRows: false,
    });
  });

  test("keeps only id-shaped target params", () => {
    const [item] = parseInvestigationEvidence([
      {
        citationId: "C1",
        toolName: "get_trace",
        target: {
          type: "TraceView",
          params: {
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
            evil: "../../settings?x=1",
            other: 7,
          },
        },
      },
      {
        citationId: "C2",
        toolName: "get_trace",
        target: { type: "TraceView", params: { evil: "a/b" } },
      },
    ]);

    expect(item!.target).toEqual({
      type: AIChatCitationTargetType.TraceView,
      params: { traceId: "4bf92f3577b34da6a3ce929d0e0e4736" },
    });
    expect(
      parseInvestigationEvidence([
        {
          citationId: "C2",
          toolName: "get_trace",
          target: { type: "TraceView", params: { evil: "a/b" } },
        },
      ])[0]!.target,
    ).toEqual({ type: AIChatCitationTargetType.TraceView });
  });

  test("caps the number of evidence items", () => {
    const many: Array<Record<string, unknown>> = [];

    for (let index: number = 1; index <= 150; index++) {
      many.push({ citationId: `C${index}`, toolName: "search_logs" });
    }

    expect(parseInvestigationEvidence(many)).toHaveLength(MAX_EVIDENCE_ITEMS);
  });

  test("reads resolved references and rejects anything that is not one", () => {
    const parsed: Array<InvestigationEventReference> =
      parseInvestigationReferences([
        {
          kind: "incident",
          number: 6954,
          id: PRIOR_INCIDENT_ID,
          displayNumber: "INC-6954",
          title: "Checkout pool exhausted",
          stateName: "Resolved",
          stateColor: "#10b981",
        },
        { kind: "alert", number: 7, id: ALERT_ID, title: "Webhook" },
        { kind: "monitor", number: 1, id: ALERT_ID },
        { kind: "incident", number: 1.5, id: ALERT_ID },
        { kind: "incident", number: -1, id: ALERT_ID },
        { kind: "incident", number: 2, id: "javascript:alert(1)" },
        { kind: "incident", number: 6954, id: ALERT_ID, title: "duplicate" },
        null,
      ]);

    expect(parsed).toEqual([
      {
        kind: "incident",
        number: 6954,
        id: PRIOR_INCIDENT_ID,
        displayNumber: "INC-6954",
        title: "Checkout pool exhausted",
        stateName: "Resolved",
        stateColor: "#10b981",
      },
      {
        kind: "alert",
        number: 7,
        id: ALERT_ID,
        displayNumber: "#7",
        title: "Webhook",
      },
    ]);
  });

  test("drops a state colour that is not a hex colour", () => {
    const [reference] = parseInvestigationReferences([
      {
        kind: "incident",
        number: 1,
        id: PRIOR_INCIDENT_ID,
        stateColor: "red; background: url(https://evil)",
      },
    ]);

    expect(reference!.stateColor).toBeUndefined();
    expect(parseInvestigationReferences(undefined)).toEqual([]);
  });

  test("reads an evidence rows response", () => {
    expect(
      parseInvestigationEvidenceRows({
        citationId: "C1",
        toolName: "query_incidents",
        label: "Active incidents (7 total)",
        rowCount: 7,
        isTruncated: true,
        executedAt: "2026-09-15T09:00:00.000Z",
        isPinnedToInvestigationTime: true,
        investigatedAt: "2026-09-14T18:01:00.000Z",
        widget: {
          id: "W1",
          type: AIChatWidgetType.IncidentList,
          title: "Active incidents",
          data: { items: [] },
        },
        text: "rows",
      }),
    ).toEqual({
      citationId: "C1",
      toolName: "query_incidents",
      label: "Active incidents (7 total)",
      rowCount: 7,
      isTruncated: true,
      executedAt: "2026-09-15T09:00:00.000Z",
      isPinnedToInvestigationTime: true,
      investigatedAt: "2026-09-14T18:01:00.000Z",
      widget: {
        id: "W1",
        type: AIChatWidgetType.IncidentList,
        title: "Active incidents",
        data: { items: [] },
      },
      text: "rows",
    });
  });

  test("rejects a rows response without a citation or row count and drops unknown widgets", () => {
    expect(parseInvestigationEvidenceRows(null)).toBeNull();
    expect(parseInvestigationEvidenceRows({ rowCount: 1 })).toBeNull();
    expect(
      parseInvestigationEvidenceRows({ citationId: "C1", rowCount: "7" }),
    ).toBeNull();

    const parsed: ReturnType<typeof parseInvestigationEvidenceRows> =
      parseInvestigationEvidenceRows({
        citationId: "C1",
        rowCount: 2,
        widget: { type: "Iframe", data: {} },
        text: "x".repeat(30_000),
      });
    expect(parsed!.widget).toBeUndefined();
    expect(parsed!.text).toHaveLength(20_000);
    expect(parsed!.isPinnedToInvestigationTime).toBe(false);
  });
});

describe("InvestigationReportData summary text", () => {
  test("strips markdown down to one line of words", () => {
    expect(
      markdownToPlainText(
        "**The pool** ran _dry_ after `deploy-42` [C1][C2].\n\n- see [the logs](https://x.example) ![chart](https://x/c.png)\n> quoted\n## Heading",
      ),
    ).toBe(
      "The pool ran dry after deploy-42. see the logs chart quoted Heading",
    );
  });

  test("keeps snake_case words and multiplication intact", () => {
    expect(markdownToPlainText("check pool_size_max and 2 * 3 * 4")).toBe(
      "check pool_size_max and 2 * 3 * 4",
    );
  });

  test("clips at a word boundary within the limit", () => {
    const text: string =
      "The database connection pool was exhausted after the deploy halved its size";
    const clipped: string = clipText(text, 40);

    expect(clipped.length).toBeLessThanOrEqual(40);
    expect(clipped.endsWith("…")).toBe(true);
    expect(text.startsWith(clipped.slice(0, -1))).toBe(true);
    expect(clipText("short", 40)).toBe("short");
  });

  test("clips a single long word hard", () => {
    const clipped: string = clipText("x".repeat(100), 10);
    expect(clipped).toBe(`${"x".repeat(9)}…`);
  });

  test("prefers the TL;DR, then the parsed Summary, else null", () => {
    const report: ReturnType<typeof parseInvestigationReport> =
      parseInvestigationReport(SERVER_REPORT);

    expect(
      getInvestigationReportSummaryText({ analysisTldr: ` ${TLDR}\n`, report }),
    ).toBe(TLDR);
    expect(
      getInvestigationReportSummaryText({ analysisTldr: null, report }),
    ).toBe("the connection pool ran dry after the 18:00 deploy.");
    expect(
      getInvestigationReportSummaryText({
        analysisTldr: "  ",
        report: parseInvestigationReport("## Root cause\n\nA deploy."),
      }),
    ).toBeNull();
    expect(
      getInvestigationReportSummaryText({ analysisTldr: null, report: null }),
    ).toBeNull();
  });

  test("bounds the summary text", () => {
    const longSummary: string = `**Summary** — ${"word ".repeat(200)}`;
    const summary: string | null = getInvestigationReportSummaryText({
      analysisTldr: null,
      report: parseInvestigationReport(longSummary),
    });

    expect(summary!.length).toBeLessThanOrEqual(MAX_REPORT_SUMMARY_LENGTH);
    expect(summary!.endsWith("…")).toBe(true);
  });

  /*
   * The server stores a TL;DR of up to 320 characters in a 500-character
   * column. The header used to clip at 280, so a complete TL;DR ended
   * mid-sentence ("... self-recovered within ~1 minute and the…"). The
   * lengths are literals on purpose, like the server's width chain: a
   * constant lowered on its own must not keep this green.
   */
  test("never clips a TL;DR the server can store", () => {
    const serverCappedTldr: string =
      "checkout-api release 2026.09.14-2 restarted at 17:52:04 with DB_POOL_MAX=10 instead of 40, so requests waited up to 2s in pg.pool.connect for an orders-db connection and p95 latency rose from ~310 ms to 2.35 s (db.client.connections.usage pinned at 10/10). Rolling back to 2026.09.14-1 cleared it, as in #1017 and #1029.";

    expect(serverCappedTldr).toHaveLength(320);
    expect(
      getInvestigationReportSummaryText({
        analysisTldr: serverCappedTldr,
        report: null,
      }),
    ).toBe(serverCappedTldr);

    const columnWideTldr: string = "a".repeat(500);

    expect(
      getInvestigationReportSummaryText({
        analysisTldr: columnWideTldr,
        report: null,
      }),
    ).toBe(columnWideTldr);
  });

  test("clips a TL;DR only past what the column holds", () => {
    const summary: string | null = getInvestigationReportSummaryText({
      analysisTldr: "a".repeat(501),
      report: null,
    });

    expect(summary).toBe(`${"a".repeat(499)}…`);
  });

  test("bounds the summary by the analysisTldr column's width", () => {
    const column: { type?: TableColumnType | undefined } = getTableColumn(
      new AIRun(),
      "analysisTldr",
    );

    expect(column.type).toBeDefined();
    expect(MAX_REPORT_SUMMARY_LENGTH).toBe(
      getMaxLengthFromTableColumnType(column.type as TableColumnType),
    );
  });
});
