import {
  InvestigationReportSection,
  InvestigationReportSectionKind,
  MAX_RULED_OUT_CAUSES_SHOWN,
  ParsedInvestigationReport,
  parseInvestigationReport,
  parseRuledOutCauses,
  RULED_OUT_SECTION_TITLE,
  RuledOutCause,
} from "../../../Utils/AI/InvestigationReport";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - what an investigation ruled out, in its report
 * (Utils/AI/InvestigationReport):
 *
 *  - a "Ruled out" section (and the wordings a model uses for one) is a
 *    section of its own kind, in its place among the others, and the
 *    parse keeps its body as `ruledOut`;
 *  - its list reads as causes, one per bullet: the bold label, without its
 *    colon, is the cause and the rest why the evidence rules it out,
 *    citations kept; a bullet's further lines continue it;
 *  - a section that is not such a list reads as no causes (the card then
 *    draws it as written), and at most MAX_RULED_OUT_CAUSES_SHOWN are read;
 *  - reading it takes time in line with its length, whatever it holds;
 *  - a report written before the section existed reads exactly as before.
 */

const REPORT: string = [
  "## AI — Automated Root Cause Analysis",
  "",
  "**Summary** — checkout-api restarted with its pool cut to 10 [C1].",
  "",
  "**Most likely root cause** — Release 2026.09.14-2 set DB_POOL_MAX=10 [C3].",
  "",
  "**Evidence**",
  "- p95 rose from 310 ms to 2.35 s [C2]",
  "",
  `**${RULED_OUT_SECTION_TITLE}**`,
  "- **The orders database itself:** its CPU stayed under 30% and no query slowed [C4].",
  "- **Traffic:** requests per minute were flat against the same hour last week [C5].",
  "- **The cloud underneath**: AWS Health lists no event in us-east-1 [C6].",
  "",
  "**Suggested next steps**",
  "1. Roll checkout-api back.",
].join("\n");

describe("a Ruled out section is a section of its own", () => {
  test("it is read as RuledOut, between Evidence and the next steps", () => {
    const report: ParsedInvestigationReport =
      parseInvestigationReport(REPORT);

    expect(
      report.sections.map((section: InvestigationReportSection) => {
        return section.kind;
      }),
    ).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.RuledOut,
      InvestigationReportSectionKind.NextSteps,
    ]);
    expect(report.ruledOut).toContain("The orders database itself");
    expect(report.ruledOut).toContain("[C6]");
    // Never part of the evidence or the next steps around it.
    expect(report.evidence).not.toContain("Traffic");
    expect(report.nextSteps).not.toContain("Traffic");
  });

  test.each([
    "Ruled out",
    "What was ruled out",
    "Other causes ruled out",
    "Causes ruled out",
    "Other causes checked",
    "Alternatives ruled out",
    "Hypotheses ruled out",
    "RULED OUT",
  ])("the heading %s is one", (heading: string) => {
    const report: ParsedInvestigationReport = parseInvestigationReport(
      `**Summary** — x [C1].\n\n## ${heading}\n- **A deploy:** none in the window [C2].`,
    );

    expect(
      report.sections.find((section: InvestigationReportSection) => {
        return section.kind === InvestigationReportSectionKind.RuledOut;
      })?.title,
    ).toBe(heading);
    expect(report.ruledOut).toContain("A deploy");
  });

  test("a report written before the section existed reads as before", () => {
    const before: string = REPORT.replace(
      /\*\*Ruled out\*\*[\s\S]*?\n\n/,
      "",
    );
    const report: ParsedInvestigationReport =
      parseInvestigationReport(before);

    expect(report.ruledOut).toBeUndefined();
    expect(
      report.sections.map((section: InvestigationReportSection) => {
        return section.kind;
      }),
    ).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.NextSteps,
    ]);
  });
});

describe("its list reads as causes, one per bullet", () => {
  test("the bold label is the cause, without its colon; the rest is why", () => {
    const report: ParsedInvestigationReport =
      parseInvestigationReport(REPORT);

    expect(parseRuledOutCauses(report.ruledOut)).toEqual([
      {
        causeMarkdown: "The orders database itself",
        reasonMarkdown: "its CPU stayed under 30% and no query slowed [C4].",
      },
      {
        causeMarkdown: "Traffic",
        reasonMarkdown:
          "requests per minute were flat against the same hour last week [C5].",
      },
      {
        causeMarkdown: "The cloud underneath",
        reasonMarkdown: "AWS Health lists no event in us-east-1 [C6].",
      },
    ]);
  });

  test("a bullet without a bold label is all reason", () => {
    expect(
      parseRuledOutCauses("- A deploy went out, but an hour earlier [C2]."),
    ).toEqual([
      {
        causeMarkdown: "",
        reasonMarkdown: "A deploy went out, but an hour earlier [C2].",
      },
    ]);
  });

  test("numbered lists, other markers and a full-width colon read the same", () => {
    expect(
      parseRuledOutCauses(
        [
          "1. **DNS:** every lookup answered [C1].",
          "2) **Disk**: 40% used [C2].",
          "* **内存：** 使用率正常 [C3]。",
          "+ **CPU**",
        ].join("\n"),
      ),
    ).toEqual([
      { causeMarkdown: "DNS", reasonMarkdown: "every lookup answered [C1]." },
      { causeMarkdown: "Disk", reasonMarkdown: "40% used [C2]." },
      { causeMarkdown: "内存", reasonMarkdown: "使用率正常 [C3]。" },
      { causeMarkdown: "CPU", reasonMarkdown: "" },
    ]);
  });

  test("a bullet's further lines continue it", () => {
    expect(
      parseRuledOutCauses(
        [
          "- **A bad deploy:** the last one went out at 15:02,",
          "  three hours before [C2].",
          "",
          "- **The network:** no drops [C3].",
        ].join("\n"),
      ),
    ).toEqual([
      {
        causeMarkdown: "A bad deploy",
        reasonMarkdown: "the last one went out at 15:02, three hours before [C2].",
      },
      { causeMarkdown: "The network", reasonMarkdown: "no drops [C3]." },
    ]);
  });

  test("a section that is not a list reads as no causes", () => {
    for (const markdown of [
      "The database was fine [C2], and so was the network [C3].",
      "Checked:\n- **DNS:** fine",
      "",
      "   ",
      undefined,
      null,
    ]) {
      expect(parseRuledOutCauses(markdown)).toEqual([]);
    }
  });

  test(`at most ${MAX_RULED_OUT_CAUSES_SHOWN} causes are read, the first ones`, () => {
    const many: string = Array.from({ length: 12 }, (_value: unknown, index: number) => {
      return `- **Cause ${index + 1}:** ruled out [C${index + 1}].`;
    }).join("\n");

    const causes: Array<RuledOutCause> = parseRuledOutCauses(many);

    expect(causes).toHaveLength(MAX_RULED_OUT_CAUSES_SHOWN);
    expect(causes[0]?.causeMarkdown).toBe("Cause 1");
    expect(causes[MAX_RULED_OUT_CAUSES_SHOWN - 1]?.causeMarkdown).toBe(
      `Cause ${MAX_RULED_OUT_CAUSES_SHOWN}`,
    );
  });

  test("a label is short: a long bold run is reason, not a cause", () => {
    const long: string = `- **${"x".repeat(300)}** rest`;

    expect(parseRuledOutCauses(long)[0]?.causeMarkdown).toBe("");
  });
});

describe("reading it takes time in line with its length", () => {
  const LENGTH: number = 400000;

  test.each([
    ["one bullet of asterisks", `- **${"*".repeat(LENGTH)}`],
    ["one bullet of colons", `- **${":".repeat(LENGTH)}**`],
    [
      "many bullets of open labels",
      "- **a\n".repeat(Math.floor(LENGTH / 6)),
    ],
    ["a list of markers", "- ".repeat(LENGTH / 2)],
    ["one long continued bullet", `- x\n${"  y\n".repeat(LENGTH / 4)}`],
  ])("%s", (_label: string, markdown: string) => {
    const timed: FastestRun<Array<RuledOutCause>> = fastestRun({
      run: (): Array<RuledOutCause> => {
        return parseRuledOutCauses(markdown);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
