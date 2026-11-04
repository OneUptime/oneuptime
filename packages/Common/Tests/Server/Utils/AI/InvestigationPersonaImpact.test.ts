import { INVESTIGATION_PERSONA } from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import {
  IMPACT_LINE_LABELS,
  IMPACT_SECTION_TITLE,
  InvestigationImpactAspect,
  InvestigationImpactLine,
  InvestigationReportSection,
  InvestigationReportSectionKind,
  ParsedInvestigationReport,
  parseImpactLines,
  parseInvestigationReport,
  RULED_OUT_SECTION_TITLE,
} from "../../../../Utils/AI/InvestigationReport";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - every investigation says what the signal hurts,
 * first (AIInvestigationEngine's persona, #5519's follow-up):
 *
 *  - it is asked to work the impact out like a senior engineer: how many
 *    users or requests and since when, counted from the telemetry and named
 *    for what was counted (failed requests are not users), which services
 *    it reaches, and which SLOs it burns - the ones its context lists,
 *    through query_slos - keeping how it worked each out;
 *  - its answer has an Impact section right after the summary and before
 *    the root cause: one cited line each for the users, the services and
 *    the SLOs, with how it was worked out, and "not measured" rather than a
 *    guessed number;
 *  - the heading and the line labels it is asked for are the ones the
 *    report parser reads as the Impact section and its aspects;
 *  - and it recognises a recurrence of a past alert as it does of a past
 *    incident, with the fix OneUptime AI made.
 */

describe("the investigation is asked to work out the impact", () => {
  test("users or requests counted from the telemetry, named for what was counted", () => {
    expect(INVESTIGATION_PERSONA).toContain(
      "Work out the impact, the first thing the paged engineer needs to know: how many users or requests it hurts, and since when",
    );
    expect(INVESTIGATION_PERSONA).toContain(
      "name what you counted, since failed requests are not users",
    );

    for (const source of [
      "query_traces",
      "sessions in the RUM tools",
      "the error rate against its baseline",
    ]) {
      expect(INVESTIGATION_PERSONA).toContain(source);
    }
  });

  test("the services it reaches and the SLOs it burns, from the SLOs its context lists", () => {
    expect(INVESTIGATION_PERSONA).toContain(
      "which services it reaches (the one it is about, and the ones that call it)",
    );
    expect(INVESTIGATION_PERSONA).toContain(
      `the SLOs the context lists under ${IMPACT_SECTION_TITLE}, read with query_slos (status, error budget left, burn rate)`,
    );
    expect(INVESTIGATION_PERSONA).toContain("Keep how you worked each out.");
  });
});

describe("its answer says the impact first", () => {
  test("an Impact section after the summary and before the root cause", () => {
    const summary: number = INVESTIGATION_PERSONA.indexOf("**Summary** —");
    const impact: number = INVESTIGATION_PERSONA.indexOf(
      `**${IMPACT_SECTION_TITLE}** —`,
    );
    const rootCause: number = INVESTIGATION_PERSONA.indexOf(
      "**Most likely root cause** —",
    );
    const ruledOut: number = INVESTIGATION_PERSONA.indexOf(
      `**${RULED_OUT_SECTION_TITLE}** —`,
    );

    expect(summary).toBeGreaterThan(0);
    expect(impact).toBeGreaterThan(summary);
    expect(rootCause).toBeGreaterThan(impact);
    // The Ruled out section keeps its place after the evidence.
    expect(ruledOut).toBeGreaterThan(rootCause);
  });

  test("one cited line each, written with the labels the card reads, and never a guessed number", () => {
    const labels: Array<string> = [
      InvestigationImpactAspect.Users,
      InvestigationImpactAspect.Services,
      InvestigationImpactAspect.Slos,
    ].map((aspect: InvestigationImpactAspect): string => {
      return `"- **${IMPACT_LINE_LABELS[aspect]}:** ..."`;
    });

    expect(INVESTIGATION_PERSONA).toContain(
      `one bullet each, written ${labels[0]}, ${labels[1]} and ${labels[2]}, each with its number and how you worked it out (what you counted, over which window), cited.`,
    );
    expect(INVESTIGATION_PERSONA).toContain(
      'When the data does not show one, say so in its bullet in a few words ("not measured: checkout sends no traces") - never guess a number.',
    );
  });
});

describe("what it is asked for is what the card reads", () => {
  test("the heading is read as the Impact section, each label as its aspect", () => {
    const answer: string = [
      "**Summary** — the pool was cut [C1].",
      "",
      `**${IMPACT_SECTION_TITLE}** — `,
      `- **${IMPACT_LINE_LABELS[InvestigationImpactAspect.Users]}:** about 1,240 failed requests in 18 minutes [C2].`,
      `- **${IMPACT_LINE_LABELS[InvestigationImpactAspect.Services]}:** checkout-api [C3].`,
      `- **${IMPACT_LINE_LABELS[InvestigationImpactAspect.Slos]}:** not measured: no SLO counts checkout.`,
      "",
      "**Most likely root cause** — a release [C4].",
      "",
      "**Evidence** — p95 rose [C5].",
      "",
      "**Suggested next steps** — roll back.",
    ].join("\n");

    const report: ParsedInvestigationReport = parseInvestigationReport(answer);

    expect(
      report.sections.map((section: InvestigationReportSection) => {
        return section.kind;
      }),
    ).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.Impact,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.Evidence,
      InvestigationReportSectionKind.NextSteps,
    ]);
    expect(
      parseImpactLines(report.impact).map((line: InvestigationImpactLine) => {
        return line.aspect;
      }),
    ).toEqual([
      InvestigationImpactAspect.Users,
      InvestigationImpactAspect.Services,
      InvestigationImpactAspect.Slos,
    ]);
  });
});

describe("a recurrence of a past alert", () => {
  test("is checked as one of a past incident is, with the fix OneUptime AI made", () => {
    expect(INVESTIGATION_PERSONA).toContain(
      "If the context lists past resolved incidents or alerts, check whether this is a RECURRENCE.",
    );
    expect(INVESTIGATION_PERSONA).toContain(
      "reference that incident or alert number, and note how it was resolved before, with the fix OneUptime AI made when it was verified",
    );
    expect(INVESTIGATION_PERSONA).not.toContain(
      "If the context lists past resolved incidents, check",
    );
  });
});
