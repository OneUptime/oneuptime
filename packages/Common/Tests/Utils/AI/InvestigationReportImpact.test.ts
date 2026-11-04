import {
  IMPACT_LINE_LABELS,
  IMPACT_SECTION_TITLE,
  InvestigationImpactAspect,
  InvestigationImpactLine,
  InvestigationReportSection,
  InvestigationReportSectionKind,
  MAX_IMPACT_LINES_SHOWN,
  ParsedInvestigationReport,
  getImpactAspect,
  parseImpactLines,
  parseInvestigationReport,
  parseRuledOutCauses,
} from "../../../Utils/AI/InvestigationReport";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - what an investigation says it hurts, in its report
 * (Utils/AI/InvestigationReport, #5519's follow-up):
 *
 *  - an "Impact" section (and the wordings a model uses for one) is a
 *    section of its own kind, in its place among the others, and the parse
 *    keeps its body as `impact`;
 *  - its list reads as lines, one per bullet: the bold label, without its
 *    colon, and the rest - how it was worked out and its citations kept -
 *    and each label is read as the aspect it names (the users, the
 *    services, the SLOs) or none;
 *  - an "Impact" grouped inside another section (a sub-heading of a root
 *    cause, the first label under a bodiless one) stays where it is, as a
 *    nested "Ruled out" does;
 *  - a section that is not such a list reads as no lines (the card then
 *    draws it as written), and at most MAX_IMPACT_LINES_SHOWN are read;
 *  - reading it takes time in line with its length, whatever it holds;
 *  - a report without one reads exactly as before, and the Ruled out
 *    causes' reader, which shares the bullet reading, reads as it did.
 */

const REPORT: string = [
  "## AI — Automated Root Cause Analysis",
  "",
  "**Summary** — checkout-api restarted with its pool cut to 10 [C1].",
  "",
  `**${IMPACT_SECTION_TITLE}**`,
  "- **Users:** about 1,240 failed checkout requests since 14:02 - root spans of checkout-api with errors, counted over the last 20 minutes [C2].",
  "- **Services:** checkout-api, and cart-api, which calls it [C3].",
  "- **SLOs:** Checkout availability is At Risk, 38% of its error budget left [C4].",
  "",
  "**Most likely root cause** — Release 2026.09.14-2 set DB_POOL_MAX=10 [C5].",
  "",
  "**Evidence**",
  "- p95 rose from 310 ms to 2.35 s [C2]",
  "",
  "**Suggested next steps**",
  "1. Roll checkout-api back.",
].join("\n");

function kindsOf(report: ParsedInvestigationReport): Array<string> {
  return report.sections.map((section: InvestigationReportSection) => {
    return section.kind;
  });
}

describe("an Impact section is a section of its own", () => {
  test("it is read as Impact, after the summary, before the root cause", () => {
    const report: ParsedInvestigationReport = parseInvestigationReport(REPORT);

    expect(kindsOf(report)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.Impact,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.NextSteps,
    ]);
    expect(report.impact).toContain("about 1,240 failed checkout requests");
    expect(report.impact).toContain("[C4]");
    // Never part of the summary or the root cause around it.
    expect(report.summary).not.toContain("Users");
    expect(report.rootCause).not.toContain("SLOs");
    expect(report.isStructured).toBe(true);
  });

  test.each([
    "Impact",
    "Customer impact",
    "User impact",
    "Business impact",
    "Impact assessment",
    "Impact and scope",
    "Scope of impact",
    "Blast radius",
    "Who is affected",
    "What is affected",
    "IMPACT",
  ])("the heading %s is one", (heading: string) => {
    for (const style of [
      `## ${heading}\n- **Users:** a few.`,
      `**${heading}**\n- **Users:** a few.`,
      `**${heading}:** - **Users:** a few.`,
      `**${heading}** — - **Users:** a few.`,
    ]) {
      const report: ParsedInvestigationReport = parseInvestigationReport(
        `**Summary** — A.\n\n${style}`,
      );

      expect(kindsOf(report)).toEqual([
        InvestigationReportSectionKind.Summary,
        InvestigationReportSectionKind.Impact,
      ]);
      expect(report.sections[1]!.title).toBe(heading);
    }
  });

  test("an Impact written after the root cause is still read as Impact, in its place", () => {
    const report: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary** — A.",
        "",
        "**Most likely root cause** — B [C1].",
        "",
        "## Impact",
        "- **Users:** about 30 [C2].",
      ].join("\n"),
    );

    expect(kindsOf(report)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Impact,
    ]);
    expect(report.impact).toBe("- **Users:** about 30 [C2].");
  });

  test("a line labelled Impact in the middle of another section starts the section, as every known label does", () => {
    const report: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**Summary** — A.",
        "",
        "**Evidence**",
        "- p95 rose [C1]",
        "**Impact:** users could not pay [C2]",
      ].join("\n"),
    );

    expect(kindsOf(report)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.Impact,
    ]);
    expect(report.impact).toBe("users could not pay [C2]");
  });

  test("an Impact grouped under a root cause stays in it, as a nested Ruled out stays in Evidence", () => {
    const asSubHeading: ParsedInvestigationReport = parseInvestigationReport(
      [
        "## Summary",
        "A.",
        "## Most likely root cause",
        "### Cause",
        "The pool was cut [C1].",
        "### Impact",
        "Checkout fails [C2].",
      ].join("\n"),
    );

    expect(kindsOf(asSubHeading)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
    ]);
    expect(asSubHeading.rootCause).toContain("### Impact\nCheckout fails [C2].");
    expect(asSubHeading.impact).toBeUndefined();

    const firstUnderBodiless: ParsedInvestigationReport =
      parseInvestigationReport(
        [
          "**Summary** — A.",
          "",
          "**Evidence**",
          "**Impact:**",
          "**Supports:**",
          "- pool 100%",
        ].join("\n"),
      );

    expect(kindsOf(firstUnderBodiless)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.Evidence,
    ]);
    expect(firstUnderBodiless.evidence).toBe(
      "**Impact:**\n**Supports:**\n- pool 100%",
    );
  });

  test("a report without one reads as before: no impact, the same sections", () => {
    const without: string = REPORT.split("\n")
      .filter((line: string): boolean => {
        return (
          !line.startsWith(`**${IMPACT_SECTION_TITLE}**`) &&
          !line.startsWith("- **Users:**") &&
          !line.startsWith("- **Services:**") &&
          !line.startsWith("- **SLOs:**")
        );
      })
      .join("\n");
    const report: ParsedInvestigationReport = parseInvestigationReport(without);

    expect(report.impact).toBeUndefined();
    expect(kindsOf(report)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.NextSteps,
    ]);
  });

  test("an Impact with no body is no section", () => {
    const report: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary** — A.\n\n**Impact**\n\n**Most likely root cause** — B.",
    );

    expect(report.impact).toBeUndefined();
    expect(kindsOf(report)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
    ]);
  });
});

describe("parseImpactLines", () => {
  test("one line a bullet: its label, what it says and how, citations kept, each label's aspect", () => {
    const report: ParsedInvestigationReport = parseInvestigationReport(REPORT);

    expect(parseImpactLines(report.impact)).toEqual([
      {
        aspect: InvestigationImpactAspect.Users,
        labelMarkdown: "Users",
        textMarkdown:
          "about 1,240 failed checkout requests since 14:02 - root spans of checkout-api with errors, counted over the last 20 minutes [C2].",
      },
      {
        aspect: InvestigationImpactAspect.Services,
        labelMarkdown: "Services",
        textMarkdown: "checkout-api, and cart-api, which calls it [C3].",
      },
      {
        aspect: InvestigationImpactAspect.Slos,
        labelMarkdown: "SLOs",
        textMarkdown:
          "Checkout availability is At Risk, 38% of its error budget left [C4].",
      },
    ]);
  });

  test("the persona's own labels are the aspects', in its order", () => {
    expect(IMPACT_LINE_LABELS).toEqual({
      [InvestigationImpactAspect.Users]: "Users",
      [InvestigationImpactAspect.Services]: "Services",
      [InvestigationImpactAspect.Slos]: "SLOs",
    });

    for (const aspect of Object.values(InvestigationImpactAspect)) {
      expect(getImpactAspect(IMPACT_LINE_LABELS[aspect])).toBe(aspect);
    }
  });

  test.each([
    ["Customers", InvestigationImpactAspect.Users],
    ["End users", InvestigationImpactAspect.Users],
    ["sessions", InvestigationImpactAspect.Users],
    ["Requests", InvestigationImpactAspect.Users],
    ["Affected users", InvestigationImpactAspect.Users],
    ["Service", InvestigationImpactAspect.Services],
    ["Dependencies", InvestigationImpactAspect.Services],
    ["Affected services", InvestigationImpactAspect.Services],
    ["SLO", InvestigationImpactAspect.Slos],
    ["Error budget", InvestigationImpactAspect.Slos],
    ["Service level objectives", InvestigationImpactAspect.Slos],
    ["SLAs", InvestigationImpactAspect.Slos],
  ])("the label %s names %s", (label: string, aspect: string) => {
    expect(getImpactAspect(label)).toBe(aspect);
    expect(getImpactAspect(`  ${label.toUpperCase()}  `)).toBe(aspect);
  });

  test("any other label names no aspect, and is kept as written", () => {
    expect(
      parseImpactLines("- **Revenue:** about $4,000 an hour of orders [C6]."),
    ).toEqual([
      {
        aspect: null,
        labelMarkdown: "Revenue",
        textMarkdown: "about $4,000 an hour of orders [C6].",
      },
    ]);
    expect(getImpactAspect("Usersomething")).toBeNull();
    expect(getImpactAspect("")).toBeNull();
  });

  test("a bullet with no bold label is a line without one", () => {
    expect(parseImpactLines("- Checkout fails for everyone [C2].")).toEqual([
      {
        aspect: null,
        labelMarkdown: "",
        textMarkdown: "Checkout fails for everyone [C2].",
      },
    ]);
  });

  test("the colon may sit inside or after the bold, full width too, and a line may run on", () => {
    expect(
      parseImpactLines(
        [
          "* **Users**: about 30",
          "  of them on iOS [C2].",
          "1. **サービス：** checkout-api [C3]",
          "2) **SLOs** — none count it.",
        ].join("\n"),
      ),
    ).toEqual([
      {
        aspect: InvestigationImpactAspect.Users,
        labelMarkdown: "Users",
        textMarkdown: "about 30 of them on iOS [C2].",
      },
      {
        aspect: null,
        labelMarkdown: "サービス",
        textMarkdown: "checkout-api [C3]",
      },
      {
        aspect: InvestigationImpactAspect.Slos,
        labelMarkdown: "SLOs",
        textMarkdown: "— none count it.",
      },
    ]);
  });

  test("a section that is not a list reads as no lines, and nothing as nothing", () => {
    expect(parseImpactLines("Checkout is down for EU users [C2].")).toEqual([]);
    expect(
      parseImpactLines("Checkout is down.\n- **Users:** about 30."),
    ).toEqual([]);
    expect(parseImpactLines("")).toEqual([]);
    expect(parseImpactLines("   \n  ")).toEqual([]);
    expect(parseImpactLines(undefined)).toEqual([]);
    expect(parseImpactLines(null)).toEqual([]);
  });

  test(`at most ${MAX_IMPACT_LINES_SHOWN} lines are read`, () => {
    const lines: Array<InvestigationImpactLine> = parseImpactLines(
      Array.from({ length: MAX_IMPACT_LINES_SHOWN + 5 }, (_: unknown, i) => {
        return `- **Line ${i}:** ${i}`;
      }).join("\n"),
    );

    expect(lines).toHaveLength(MAX_IMPACT_LINES_SHOWN);
    expect(lines[0]!.labelMarkdown).toBe("Line 0");
  });

  test("the Ruled out causes read as they did on the shared bullet reader", () => {
    expect(
      parseRuledOutCauses(
        "- **The database:** its CPU stayed under 30% [C4].\n- Traffic was flat [C5].",
      ),
    ).toEqual([
      {
        causeMarkdown: "The database",
        reasonMarkdown: "its CPU stayed under 30% [C4].",
      },
      { causeMarkdown: "", reasonMarkdown: "Traffic was flat [C5]." },
    ]);
  });
});

describe("reading an Impact section takes time in line with its length", () => {
  const LENGTH: number = 400000;

  test.each([
    ["one bullet of asterisks", `- **${"*".repeat(LENGTH)}`],
    ["a label that never closes, again and again", "- **Users ".repeat(LENGTH / 10)],
    ["a list of markers", "- \n".repeat(LENGTH / 3)],
    ["one long continued line", `- **Users:** x\n${"  y\n".repeat(LENGTH / 4)}`],
    ["labels of every aspect", "- **Users:** a\n- **SLOs:** b\n".repeat(LENGTH / 28)],
  ])("%s", (_label: string, markdown: string) => {
    const timed: FastestRun<Array<InvestigationImpactLine>> = fastestRun({
      run: (): Array<InvestigationImpactLine> => {
        return parseImpactLines(markdown);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);

    // The whole report around it too, the section read as Impact.
    const report: FastestRun<ParsedInvestigationReport> = fastestRun({
      run: (): ParsedInvestigationReport => {
        return parseInvestigationReport(
          `**Summary** — A.\n\n**Impact**\n${markdown}`,
        );
      },
      limitInMs: 2000,
    });

    expect(report.inMs).toBeLessThan(2000);
  });
});
