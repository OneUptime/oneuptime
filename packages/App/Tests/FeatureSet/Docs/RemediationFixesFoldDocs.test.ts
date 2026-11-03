import { AI_SRE, EXTERNAL_MCP_SERVERS } from "./AiDocsPages";
import { readPage, TRANSLATED_LANGUAGES } from "./DocsContentSupport";
import { drawnActionLabel } from "./DocsDashboardLabels";
import {
  REMEDIATION_FIX_HIDE_DETAILS,
  REMEDIATION_FIX_REVIEW_AND_APPROVE,
} from "../../../FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import { MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON } from "Common/Server/Services/AutoRemediationRuleEngineService";
import { describe, expect, test } from "@jest/globals";

/*
 * The AI SRE page and the External MCP Servers page say what the AI card's
 * Remediation step does with a fix (#5413's follow-ups, fu-ai-remediation;
 * issue #5598):
 *
 *   - each fix reads as the steps it went through - planned, approved, ran,
 *     recovered, rolled back - each step opening to more, and Review and
 *     approve opens the plan of a fix that waits, with Approve & Run under
 *     it, in the words the step draws in each language;
 *   - a cluster's or resource's Fixes turned on make OneUptime AI decide
 *     again for as many open records as the engine tries again
 *     (MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON), and a resolved record is
 *     never tried again.
 *
 * Every language says it in the English page's places.
 */

const ENGLISH_AI_SRE: Array<string> = readPage("en", AI_SRE).split("\n");
const ENGLISH_MCP: Array<string> = readPage("en", EXTERNAL_MCP_SERVERS).split(
  "\n",
);

function lineStarting(lines: Array<string>, start: string): number {
  return lines.findIndex((line: string): boolean => {
    return line.startsWith(start);
  });
}

const STEPS_LINE: number = lineStarting(
  ENGLISH_AI_SRE,
  "Each fix reads as the steps it went through",
);
const DECIDED_ONCE_LINE: number = lineStarting(
  ENGLISH_AI_SRE,
  "A decision is made once, with the project's settings of that moment",
);
const ASK_BEFORE_FIXING_LINE: number = lineStarting(
  ENGLISH_MCP,
  "- **Ask before fixing**",
);

// The count the page writes, as each language writes its digits.
function writtenCount(language: string, count: number): string {
  return language === "fa"
    ? String(count).replace(/[0-9]/g, (digit: string): string => {
        return "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]!;
      })
    : String(count);
}

describe("the English pages", () => {
  test("say a fix reads as its steps, what each opens to, and name the presses the step draws", () => {
    expect(STEPS_LINE).toBeGreaterThan(0);
    expect(
      ENGLISH_AI_SRE.lastIndexOf("### Before you approve a fix", STEPS_LINE),
    ).toBe(STEPS_LINE - 2);

    const line: string = ENGLISH_AI_SRE[STEPS_LINE]!;
    expect(REMEDIATION_FIX_REVIEW_AND_APPROVE).toBe("Review and approve");
    expect(line).toContain("in the order they happened, one line each");
    expect(line).toContain(
      "how many commands it runs and where, or how many changes it makes and through which MCP servers",
    );
    expect(line).toContain(
      "how it ran, whether the incident recovered, and what was rolled back",
    );
    expect(line).toContain(
      "the plan opens to the reasoning and each command, the run to each command's output and exit code, and the rollback to each undo",
    );
    expect(line).toContain(
      "says in red how many of its commands or changes failed",
    );
    expect(line).toContain(`**${REMEDIATION_FIX_REVIEW_AND_APPROVE}**`);
    expect(line).toContain("**Approve & Run** under it");
    // Hide details is the press that closes it again: not something to read.
    expect(line).not.toContain(REMEDIATION_FIX_HIDE_DETAILS);
    // A fix that ran opens step by step, with no press of its own.
    expect(line).not.toContain("Show details");
    // The list of what a waiting fix's plan shows follows it.
    expect(line.endsWith(":")).toBe(true);
    expect(ENGLISH_AI_SRE[STEPS_LINE + 2]?.startsWith("- **")).toBe(true);
  });

  test("say Fixes turned on reach back, for as many open records as the engine tries again, and a resolved one never", () => {
    const line: string = ENGLISH_AI_SRE[DECIDED_ONCE_LINE]!;

    expect(MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON).toBe(25);
    expect(line).toContain(
      `A cluster's or resource's **Fixes** turned on do reach back: OneUptime AI decides again for the ${MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON} most recent open incidents and alerts it did not fix because they were off there`,
    );
    expect(line).toContain(
      "A resolved incident or alert is never tried again: its lines say what happened, and how the next one is linked.",
    );
  });

  test("the External MCP Servers page sums the changes up, and Review and approve lists them", () => {
    expect(ASK_BEFORE_FIXING_LINE).toBeGreaterThan(0);
    expect(ENGLISH_MCP[ASK_BEFORE_FIXING_LINE]).toContain(
      `sums them up in one sentence, and **${REMEDIATION_FIX_REVIEW_AND_APPROVE}** lists them in order`,
    );
  });
});

describe.each(TRANSLATED_LANGUAGES)("the %s pages", (language: string) => {
  const aiSre: Array<string> = readPage(language, AI_SRE).split("\n");
  const mcp: Array<string> = readPage(language, EXTERNAL_MCP_SERVERS).split(
    "\n",
  );

  test("are line for line with English", () => {
    expect(aiSre.length).toBe(ENGLISH_AI_SRE.length);
    expect(mcp.length).toBe(ENGLISH_MCP.length);
  });

  test("name Review and approve and Approve & Run as the step draws them", () => {
    const line: string = aiSre[STEPS_LINE] || "";

    for (const label of [REMEDIATION_FIX_REVIEW_AND_APPROVE, "Approve & Run"]) {
      const drawn: string = drawnActionLabel(language, label);

      expect({ label, drawn, has: line.includes(`**${drawn}**`) }).toEqual({
        label,
        drawn,
        has: true,
      });
    }

    expect(mcp[ASK_BEFORE_FIXING_LINE]).toContain(
      `**${drawnActionLabel(language, REMEDIATION_FIX_REVIEW_AND_APPROVE)}**`,
    );
  });

  test("say Fixes turned on reach back, for the same number of open records", () => {
    const line: string = aiSre[DECIDED_ONCE_LINE] || "";

    expect(line).toContain(`**${drawnActionLabel(language, "Fixes")}**`);
    expect(line).toContain(
      writtenCount(language, MAX_SUBJECTS_TRIED_AGAIN_WHEN_FIXES_TURN_ON),
    );
  });
});
