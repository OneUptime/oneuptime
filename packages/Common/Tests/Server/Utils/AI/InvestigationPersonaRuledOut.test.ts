import {
  INVESTIGATION_PERSONA,
  MAX_RULED_OUT_CAUSES,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import {
  InvestigationReportSectionKind,
  MAX_RULED_OUT_CAUSES_SHOWN,
  ParsedInvestigationReport,
  parseInvestigationReport,
  parseRuledOutCauses,
  RULED_OUT_SECTION_TITLE,
} from "../../../../Utils/AI/InvestigationReport";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - the investigation rules the other likely causes in
 * or out, and says what it ruled out (AIInvestigationEngine's persona):
 *
 *  - it is asked to test the causes a senior engineer rules out first - a
 *    change, a capacity limit, a dependency, the platform underneath, the
 *    traffic - with its tools, keeping the evidence;
 *  - its answer has a Ruled out section after the evidence and before the
 *    next steps, one cited bullet per cause written as the card reads it,
 *    at most MAX_RULED_OUT_CAUSES, and left out when nothing else was
 *    checked;
 *  - the heading it is asked for is the one the report parser reads as
 *    the RuledOut section, and the bullet shape it is asked for is the one
 *    the card reads as a cause.
 */

describe("the investigation is asked to rule other causes in or out", () => {
  test("it tests the likely causes with its tools and keeps the evidence", () => {
    expect(INVESTIGATION_PERSONA).toContain(
      "Rule the other likely causes in or out, as a senior engineer does before naming one",
    );

    for (const cause of [
      "a recent change",
      "a capacity limit",
      "a dependency",
      "the platform or cloud provider underneath",
      "the traffic or input itself",
    ]) {
      expect(INVESTIGATION_PERSONA).toContain(cause);
    }

    expect(INVESTIGATION_PERSONA).toContain(
      "keep the evidence that rules each one out",
    );
  });

  test("its answer has a Ruled out section between the evidence and the next steps", () => {
    const evidence: number = INVESTIGATION_PERSONA.indexOf("**Evidence** —");
    const ruledOut: number = INVESTIGATION_PERSONA.indexOf(
      `**${RULED_OUT_SECTION_TITLE}** —`,
    );
    const nextSteps: number = INVESTIGATION_PERSONA.indexOf(
      "**Suggested next steps** —",
    );

    expect(evidence).toBeGreaterThan(0);
    expect(ruledOut).toBeGreaterThan(evidence);
    expect(nextSteps).toBeGreaterThan(ruledOut);
  });

  test("one cited bullet per cause, at most a few, left out when nothing else was checked", () => {
    expect(INVESTIGATION_PERSONA).toContain(
      `one bullet per cause, written "- **The cause:** why it is ruled out", each cited, at most ${MAX_RULED_OUT_CAUSES}, the most plausible first. Leave this section out when you checked no other cause.`,
    );
    expect(MAX_RULED_OUT_CAUSES).toBeLessThanOrEqual(
      MAX_RULED_OUT_CAUSES_SHOWN,
    );
  });

  test("the sections are asked for in order, no longer as exactly these", () => {
    expect(INVESTIGATION_PERSONA).toContain(
      "with these sections, in this order (use these markdown headings)",
    );
    expect(INVESTIGATION_PERSONA).not.toContain("with exactly these sections");
  });
});

describe("what it is asked for is what the card reads", () => {
  test("the heading is read as the RuledOut section, the bullet as a cause", () => {
    const answer: string = [
      "**Summary** — the pool was cut [C1].",
      "",
      "**Most likely root cause** — a release [C2].",
      "",
      "**Evidence** — p95 rose [C3].",
      "",
      `**${RULED_OUT_SECTION_TITLE}** — `,
      "- **The cause:** why it is ruled out [C4].",
      "",
      "**Suggested next steps** — roll back.",
    ].join("\n");

    const report: ParsedInvestigationReport = parseInvestigationReport(answer);

    expect(
      report.sections.some(
        (section: { kind: InvestigationReportSectionKind }) => {
          return section.kind === InvestigationReportSectionKind.RuledOut;
        },
      ),
    ).toBe(true);
    expect(parseRuledOutCauses(report.ruledOut)).toEqual([
      {
        causeMarkdown: "The cause",
        reasonMarkdown: "why it is ruled out [C4].",
      },
    ]);
  });
});
