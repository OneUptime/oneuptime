import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHAT AN INVESTIGATION RULED OUT, ON THE AI CARD (InvestigationReportView).
 *
 * A responder trusts a cause they can see was weighed against the others.
 * The report's Ruled out section is drawn as the list it is: one line per
 * cause, a cross before it, the cause first and why after it - each part
 * through the safe markdown viewer, citations and all - between the
 * evidence and the next steps. Why it is ruled out starts with a capital
 * once it sits on a line of its own; each cause reads the way it is
 * written (an English cause on a Persian page keeps its cross at its
 * left). A Ruled out section that is not such a list is drawn as written,
 * like every other section.
 *
 * react-markdown is mocked in Common jest, so the viewer mock below stands
 * in for the real pipeline: it records what it was asked to draw and turns
 * "[C#]" into the panel's citation chip.
 */

interface MarkdownViewerProps {
  text: string;
  safeMode?: boolean | undefined;
  inlineReferences?: MarkdownInlineReferenceRenderers | undefined;
}

const markdownViewerMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      markdownViewerMock(props);
      const parts: Array<string> = props.text.split(/(\[C\d{1,3}\])/g);

      return React.createElement(
        "div",
        { "data-testid": "report-markdown" },
        parts.map((part: string, index: number): React.ReactNode => {
          const citation: RegExpExecArray | null = new RegExp(
            "^\\[(C\\d{1,3})\\]$",
          ).exec(part);

          if (citation && props.inlineReferences?.renderCitation) {
            const element: React.ReactElement | null =
              props.inlineReferences.renderCitation(citation[1]!);

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
  getRuledOutReasonForDisplay,
  REPORT_SECTION_BODY_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationReportView";
import { AIChatCitationTargetType } from "../../../Types/AI/AIChatTypes";
import { InvestigationEvidenceItem } from "../../../Types/AI/InvestigationEvidence";
import type { MarkdownInlineReferenceRenderers } from "../../../UI/Components/Markdown.tsx/InlineReferences";
import { parseInvestigationReport } from "../../../Utils/AI/InvestigationReport";

const REPORT: string = [
  "**Summary** — checkout-api restarted with its pool cut to 10 [C1].",
  "",
  "**Most likely root cause** — Release 2026.09.14-2 set DB_POOL_MAX=10 [C1].",
  "",
  "**Evidence**",
  "- pool waits rose from 0 to 1,900 [C1]",
  "",
  "**Ruled out**",
  "- **The orders database itself:** its CPU stayed under 30% [C2].",
  "- **Traffic:** requests per minute were flat against last week.",
  "- AWS Health lists no event in us-east-1.",
  "",
  "**Suggested next steps**",
  "1. Roll checkout-api back.",
].join("\n");

const evidence: Array<InvestigationEvidenceItem> = [
  {
    citationId: "C1",
    toolName: "query_metrics",
    label: "Pool waits",
    rowCount: 12,
    queryArguments: {},
    target: { type: AIChatCitationTargetType.Logs },
    executedAt: "2026-09-14T18:01:00.000Z",
    canLoadRows: true,
  },
  {
    citationId: "C2",
    toolName: "query_metrics",
    label: "Database CPU",
    rowCount: 12,
    queryArguments: {},
    target: { type: AIChatCitationTargetType.Logs },
    executedAt: "2026-09-14T18:02:00.000Z",
    canLoadRows: true,
  },
];

function renderReport(markdown: string): void {
  const props: ReportViewProps = {
    analysisMarkdown: markdown,
    report: parseInvestigationReport(markdown),
    analysisTldr: null,
    evidence,
    references: [],
    subjectType: "incident",
    onCitationActivate: (): void => {},
  };

  render(<InvestigationReportView {...props} />);
}

function sectionHeadings(): Array<string> {
  return within(screen.getByLabelText("Investigation report"))
    .queryAllByRole("heading", { level: 3 })
    .map((heading: HTMLElement): string => {
      return heading.textContent || "";
    });
}

afterEach(() => {
  cleanup();
  markdownViewerMock.mockReset();
});

describe("the causes an investigation ruled out", () => {
  test("are their own section, between the evidence and the next steps", () => {
    renderReport(REPORT);

    expect(sectionHeadings()).toEqual([
      "Most likely root cause",
      "Evidence",
      "Ruled out",
      "Suggested next steps",
    ]);
  });

  test("read as a list: one line per cause, a cross before it, the cause and then why", () => {
    renderReport(REPORT);

    const list: HTMLElement = screen.getByTestId("investigation-ruled-out");
    expect(list.tagName).toBe("UL");

    const causes: Array<HTMLElement> = within(list).getAllByTestId(
      "investigation-ruled-out-cause",
    );
    expect(causes).toHaveLength(3);

    expect(
      within(causes[0]!).getByTestId("investigation-ruled-out-cause-name"),
    ).toHaveTextContent("The orders database itself");
    // Its own line, so it starts with a capital.
    expect(
      within(causes[0]!).getByTestId("investigation-ruled-out-cause-reason"),
    ).toHaveTextContent("Its CPU stayed under 30%");
    expect(
      within(causes[1]!).getByTestId("investigation-ruled-out-cause-name"),
    ).toHaveTextContent("Traffic");

    // A bullet without a bold label is all reason.
    expect(
      within(causes[2]!).queryByTestId("investigation-ruled-out-cause-name"),
    ).not.toBeInTheDocument();
    expect(
      within(causes[2]!).getByTestId("investigation-ruled-out-cause-reason"),
    ).toHaveTextContent("AWS Health lists no event in us-east-1.");

    // The cross is decoration: the words say what was ruled out.
    for (const cause of causes) {
      expect(cause.querySelector("svg")).not.toBeNull();
    }
  });

  test("each part goes through the safe viewer, and a cited reason keeps its chip", () => {
    renderReport(REPORT);

    const texts: Array<string> = (
      markdownViewerMock.mock.calls as Array<Array<MarkdownViewerProps>>
    ).map((call: Array<MarkdownViewerProps>): string => {
      return call[0]!.text;
    });

    expect(texts).toContain("The orders database itself");
    expect(texts).toContain("Its CPU stayed under 30% [C2].");

    for (const call of markdownViewerMock.mock.calls as Array<
      Array<MarkdownViewerProps>
    >) {
      expect(call[0]!.safeMode).toBe(true);
    }

    const reason: HTMLElement = within(
      screen.getAllByTestId("investigation-ruled-out-cause")[0]!,
    ).getByTestId("investigation-ruled-out-cause-reason");
    expect(
      within(reason).getByRole("button", {
        name: (name: string): boolean => {
          return name.startsWith("Citation C2:");
        },
      }),
    ).toBeInTheDocument();
  });

  test("a Ruled out section that is not a list is drawn as written", () => {
    renderReport(
      REPORT.replace(
        /\*\*Ruled out\*\*\n[\s\S]*?\n\n/,
        "**Ruled out** — nothing else fits the timing.\n\n",
      ),
    );

    expect(
      screen.queryByTestId("investigation-ruled-out"),
    ).not.toBeInTheDocument();

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "Ruled out",
    });
    const body: HTMLElement = heading.nextElementSibling as HTMLElement;
    expect(body).toHaveClass(REPORT_SECTION_BODY_CLASS_NAME);
    expect(body).toHaveTextContent("nothing else fits the timing.");
  });

  test("each cause reads the way it is written: English left to right, Persian right to left", () => {
    renderReport(
      REPORT.replace(
        "- AWS Health lists no event in us-east-1.",
        "- **\u067e\u0627\u06cc\u06af\u0627\u0647 \u062f\u0627\u062f\u0647:** \u0645\u0634\u06a9\u0644\u06cc \u0646\u062f\u0627\u0634\u062a.",
      ),
    );

    const causes: Array<HTMLElement> = screen.getAllByTestId(
      "investigation-ruled-out-cause",
    );

    expect(causes[0]).toHaveAttribute("dir", "ltr");
    expect(causes[1]).toHaveAttribute("dir", "ltr");
    expect(causes[2]).toHaveAttribute("dir", "rtl");
  });

  test("a reason starts with a capital only when its first word is plain lowercase", () => {
    expect(getRuledOutReasonForDisplay("its CPU stayed under 30% [C2].")).toBe(
      "Its CPU stayed under 30% [C2].",
    );
    expect(getRuledOutReasonForDisplay("flat, against last week")).toBe(
      "Flat, against last week",
    );
    expect(getRuledOutReasonForDisplay("checked")).toBe("Checked");
    // Already a capital, a name written its own way, code, a number: as written.
    for (const reason of [
      "AWS Health lists no event.",
      "eBPF shows no drops.",
      "iOS clients were fine.",
      "`pg.pool.connect` waited 2 ms.",
      "42 queries ran, none slow.",
      "",
    ]) {
      expect(getRuledOutReasonForDisplay(reason)).toBe(reason);
    }
  });

  test("a report without the section draws none", () => {
    renderReport(REPORT.replace(/\*\*Ruled out\*\*\n[\s\S]*?\n\n/, ""));

    expect(sectionHeadings()).toEqual([
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
    ]);
    expect(
      screen.queryByTestId("investigation-ruled-out"),
    ).not.toBeInTheDocument();
  });
});
