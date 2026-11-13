import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHAT AN INVESTIGATION SAYS IT HURTS, ON THE AI CARD
 * (InvestigationReportView, #5519's follow-up).
 *
 * The leading AI SRE tools show the impact first: how bad it is decides who
 * is woken and what customers are told. The report's Impact section is
 * drawn right under its summary, wherever the report wrote it: one line
 * per thing affected, each with its own mark - the people, the services,
 * the SLOs - the label first in bold, then what the report says and how it
 * was worked out, through the safe markdown viewer, citations and all. An
 * Impact that is not such a list is drawn as written; a second Impact keeps
 * its place; a report without one is what it was, and so is a report too
 * loose to be laid out section by section.
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
  getImpactLineMarkdown,
  IMPACT_ASPECT_ICONS,
  REPORT_SECTION_BODY_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationReportView";
import { AIChatCitationTargetType } from "../../../Types/AI/AIChatTypes";
import { InvestigationEvidenceItem } from "../../../Types/AI/InvestigationEvidence";
import IconProp from "../../../Types/Icon/IconProp";
import type { MarkdownInlineReferenceRenderers } from "../../../UI/Components/Markdown.tsx/InlineReferences";
import {
  InvestigationImpactAspect,
  parseInvestigationReport,
} from "../../../Utils/AI/InvestigationReport";

const IMPACT: string = [
  "**Impact**",
  "- **Users:** about 1,240 failed checkout requests since 14:02 - root spans with errors, counted over 20 minutes [C2].",
  "- **Services:** checkout-api, and cart-api, which calls it.",
  "- **SLOs:** Checkout availability is At Risk, 38% of its error budget left [C1].",
  "- Revenue: about 4% of the hour's orders.",
].join("\n");

function report(impactAfterRootCause: boolean = false): string {
  const parts: Array<string> = [
    "**Summary** — checkout-api restarted with its pool cut to 10 [C1].",
    "",
  ];

  if (!impactAfterRootCause) {
    parts.push(IMPACT, "");
  }

  parts.push(
    "**Most likely root cause** — Release 2026.09.14-2 set DB_POOL_MAX=10 [C1].",
    "",
    "**Evidence**",
    "- pool waits rose from 0 to 1,900 [C1]",
    "",
  );

  if (impactAfterRootCause) {
    parts.push(IMPACT, "");
  }

  parts.push("**Suggested next steps**", "1. Roll checkout-api back.");

  return parts.join("\n");
}

const evidence: Array<InvestigationEvidenceItem> = [
  {
    citationId: "C1",
    toolName: "query_slos",
    label: "Checkout availability",
    rowCount: 1,
    queryArguments: {},
    target: { type: AIChatCitationTargetType.Logs },
    executedAt: "2026-09-14T18:01:00.000Z",
    canLoadRows: true,
  },
  {
    citationId: "C2",
    toolName: "query_traces",
    label: "Failed checkout requests",
    rowCount: 20,
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

// The headings of the whole view, the lifted ones included, in order.
function allHeadings(): Array<string> {
  return screen
    .queryAllByRole("heading", { level: 3 })
    .map((heading: HTMLElement): string => {
      return heading.textContent || "";
    });
}

function reportSectionHeadings(): Array<string> {
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

describe("the impact, first", () => {
  test("is drawn right under the summary, its own section, out of the report's", () => {
    renderReport(report());

    expect(allHeadings()).toEqual([
      "Summary",
      "Impact",
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
    ]);
    expect(reportSectionHeadings()).not.toContain("Impact");

    const section: HTMLElement = screen.getByRole("region", { name: "Impact" });
    expect(section).toHaveAttribute("data-section-kind", "Impact");
    expect(section).toHaveAttribute(
      "data-testid",
      "investigation-report-impact",
    );
  });

  test("an Impact the report wrote last is still said first", () => {
    renderReport(report(true));

    expect(allHeadings()).toEqual([
      "Summary",
      "Impact",
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
    ]);
  });

  test("one line a thing affected, each with its own mark, the label first", () => {
    renderReport(report());

    const lines: Array<HTMLElement> = within(
      screen.getByTestId("investigation-impact"),
    ).getAllByTestId("investigation-impact-line");

    expect(screen.getByTestId("investigation-impact").tagName).toBe("UL");
    expect(
      lines.map((line: HTMLElement): string | null => {
        return line.getAttribute("data-aspect");
      }),
    ).toEqual([
      InvestigationImpactAspect.Users,
      InvestigationImpactAspect.Services,
      InvestigationImpactAspect.Slos,
      "Other",
    ]);

    expect(lines[0]).toHaveTextContent(
      "**Users:** about 1,240 failed checkout requests since 14:02",
    );
    expect(lines[3]).toHaveTextContent(
      "Revenue: about 4% of the hour's orders.",
    );

    // A mark before each, decoration beside the words.
    for (const line of lines) {
      expect(line.querySelector("svg")).not.toBeNull();
    }
  });

  test("each aspect has its own mark: the people, the services', the SLOs'", () => {
    expect(IMPACT_ASPECT_ICONS).toEqual({
      [InvestigationImpactAspect.Users]: IconProp.UserGroup,
      [InvestigationImpactAspect.Services]: IconProp.SquareStack,
      [InvestigationImpactAspect.Slos]: IconProp.Gauge,
      Other: IconProp.ChartBar,
    });
  });

  test("each line goes through the safe viewer as one paragraph, and a cited one keeps its chip", () => {
    renderReport(report());

    const texts: Array<string> = (
      markdownViewerMock.mock.calls as Array<Array<MarkdownViewerProps>>
    ).map((call: Array<MarkdownViewerProps>): string => {
      return call[0]!.text;
    });

    expect(texts).toContain(
      "**Users:** about 1,240 failed checkout requests since 14:02 - root spans with errors, counted over 20 minutes [C2].",
    );
    expect(texts).toContain(
      "**SLOs:** Checkout availability is At Risk, 38% of its error budget left [C1].",
    );

    for (const call of markdownViewerMock.mock.calls as Array<
      Array<MarkdownViewerProps>
    >) {
      expect(call[0]!.safeMode).toBe(true);
    }

    const users: HTMLElement = screen.getAllByTestId(
      "investigation-impact-line",
    )[0]!;
    expect(
      within(users).getByRole("button", {
        name: (name: string): boolean => {
          return name.startsWith("Citation C2:");
        },
      }),
    ).toBeInTheDocument();
  });

  test("a line without a bold label is drawn as written", () => {
    expect(
      getImpactLineMarkdown({
        aspect: null,
        labelMarkdown: "",
        textMarkdown: "Checkout fails for everyone.",
      }),
    ).toBe("Checkout fails for everyone.");
    expect(
      getImpactLineMarkdown({
        aspect: InvestigationImpactAspect.Users,
        labelMarkdown: "Users",
        textMarkdown: "about 30.",
      }),
    ).toBe("**Users:** about 30.");
  });

  test("an Impact that is not a list is drawn as written", () => {
    renderReport(
      report().replace(
        IMPACT,
        "**Impact** — checkout fails for every EU user [C2].",
      ),
    );

    expect(
      screen.queryByTestId("investigation-impact"),
    ).not.toBeInTheDocument();

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "Impact",
    });
    const body: HTMLElement = heading.nextElementSibling as HTMLElement;
    expect(body).toHaveClass(REPORT_SECTION_BODY_CLASS_NAME);
    expect(body).toHaveTextContent("checkout fails for every EU user");
  });

  test("each line reads the way it is written: English left to right, Persian right to left", () => {
    renderReport(
      report().replace(
        "- Revenue: about 4% of the hour's orders.",
        "- **کاربران:** حدود ۳۰ نفر.",
      ),
    );

    const lines: Array<HTMLElement> = screen.getAllByTestId(
      "investigation-impact-line",
    );

    expect(lines[0]).toHaveAttribute("dir", "ltr");
    expect(lines[3]).toHaveAttribute("dir", "rtl");
  });

  test("its title is the report's own, in its own direction", () => {
    renderReport(report().replace("**Impact**", "**Customer impact**"));

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "Customer impact",
    });

    expect(heading).toHaveAttribute("dir", "auto");
  });
});

describe("what stays as it was", () => {
  test("a second Impact keeps its place in the report", () => {
    renderReport(`${report()}\n\n## Impact\nAnd later, more.`);

    expect(allHeadings()).toEqual([
      "Summary",
      "Impact",
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
      "Impact",
    ]);
    expect(reportSectionHeadings()).toEqual([
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
      "Impact",
    ]);
  });

  test("a report without one is what it was", () => {
    renderReport(report().replace(`${IMPACT}\n\n`, ""));

    expect(
      screen.queryByTestId("investigation-report-impact"),
    ).not.toBeInTheDocument();
    expect(allHeadings()).toEqual([
      "Summary",
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
    ]);
  });

  test("a report too loose to lay out is drawn whole, its impact in it", () => {
    renderReport(`I looked around.\n\n${IMPACT}`);

    expect(
      screen.queryByTestId("investigation-report-impact"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Investigation report")).toHaveTextContent(
      "about 1,240 failed checkout requests",
    );
  });
});
