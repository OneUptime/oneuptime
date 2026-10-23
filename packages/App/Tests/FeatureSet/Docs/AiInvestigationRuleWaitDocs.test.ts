import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { AI_SRE } from "./AiDocsPages";
import { readPage } from "./DocsContentSupport";
import { toLatinDigits } from "./DocsTranslationChecks";
import {
  INVESTIGATION_RULE_TIMING_COPY,
  INVESTIGATION_RULE_TIMING_FIELD_TITLE,
  INVESTIGATION_RULE_WAIT_FIELD_TITLE,
  InvestigationRuleTiming,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import { AiLane } from "../../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { AI_RULE_COLUMN_TITLE } from "../../../FeatureSet/Dashboard/src/Components/AISettings/AiRuleCopy";
import {
  INVESTIGATE_NOW,
  INVESTIGATION_WAITING_STATUS,
} from "../../../FeatureSet/Dashboard/src/Components/AI/InvestigationWaitingState";
import { FOLLOW_UP_WINDOW_MINUTES } from "Common/Server/Utils/AI/SRE/IncidentFollowUpCheck";
import InvestigationEligibility from "Common/Server/Utils/AI/SRE/InvestigationEligibility";
import {
  INVESTIGATION_RULE_WAIT_COLUMN,
  MAX_INVESTIGATION_RULE_WAIT_MINUTES,
} from "Common/Types/AI/InvestigationRuleWait";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5074: an investigation rule can make OneUptime AI wait, and
 * investigate only the incidents still open when the wait ends. The AI SRE
 * page says so in a section of its own, at the end of "Which incidents are
 * investigated and fixed", in the words the rule form, the rules table, the
 * AI card and the server use, with the numbers the code holds: a wait of at
 * most a day, and the follow-up check's window counted from the waited
 * investigation's end. Every language has the section in the English one's
 * place, keeping the server's English line and the API's column name.
 */

const RULES_HEADING: string = "## Which incidents are investigated and fixed";
const HEADING: string = "### Wait before investigating";
const NEXT_HEADING: string = "## Auto-remediation waits for the analysis";

const ENGLISH: string = readPage("en", AI_SRE);
const ENGLISH_LINES: Array<string> = ENGLISH.split("\n");
const START: number = ENGLISH_LINES.indexOf(HEADING);
const END: number = ENGLISH_LINES.indexOf(NEXT_HEADING);

// The lines of the section, in a language, where the English page has them.
function sectionIn(language: string): string {
  return readPage(language, AI_SRE).split("\n").slice(START, END).join("\n");
}

const SECTION: string = sectionIn("en");

function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// The server's title for an incident resolved during its rule's wait.
const RESOLVED_TITLE: string = InvestigationEligibility.reason(
  "resolved_before_investigation",
  { projectId: ObjectID.generate(), incidentId: ObjectID.generate() },
  undefined,
  { waitMinutes: 10 },
).title;

describe("the AI SRE page says how an AI rule waits", () => {
  test("in a section of its own, closing the rules section, before auto-remediation", () => {
    const rules: number = ENGLISH_LINES.indexOf(RULES_HEADING);

    expect(rules).toBeGreaterThan(0);
    expect(START).toBeGreaterThan(rules);
    expect(END).toBeGreaterThan(START);
    // Nothing else sits between it and the next section.
    expect(
      ENGLISH_LINES.slice(START + 1, END).filter((line: string): boolean => {
        return line.startsWith("#");
      }),
    ).toEqual([]);
  });

  test("names the rule form's question and its two answers as the form draws them", () => {
    expect(SECTION).toContain(`**${INVESTIGATION_RULE_TIMING_FIELD_TITLE}**`);

    for (const timing of [
      InvestigationRuleTiming.RightAway,
      InvestigationRuleTiming.AfterWait,
    ]) {
      expect(SECTION).toContain(
        `- **${INVESTIGATION_RULE_TIMING_COPY[AiLane.Incident][timing].title}** — `,
      );
    }

    expect(SECTION).toContain(`**${INVESTIGATION_RULE_WAIT_FIELD_TITLE}**`);
  });

  test("states the limits the server holds a wait to, and the API's column", () => {
    expect(MAX_INVESTIGATION_RULE_WAIT_MINUTES).toBe(1440);
    expect(SECTION).toContain(
      `from 1 to ${MAX_INVESTIGATION_RULE_WAIT_MINUTES} (a day), counted from when the incident is declared`,
    );
    expect(SECTION).toContain(`\`${INVESTIGATION_RULE_WAIT_COLUMN}\``);
    expect(SECTION).toContain("empty means no wait");
  });

  test("quotes the AI card's line for an incident resolved during the wait as the server writes it", () => {
    expect(RESOLVED_TITLE).toBe("Resolved before the investigation started");
    expect(SECTION).toContain(`card says why: **${RESOLVED_TITLE}**`);
  });

  test("names what the card, the table and the decision say as the Dashboard draws them", () => {
    expect(SECTION).toContain(`**${INVESTIGATION_WAITING_STATUS}**`);
    expect(SECTION).toContain(`**${AI_RULE_COLUMN_TITLE}**`);
    expect(SECTION).toContain(`**${INVESTIGATE_NOW}**`);
    expect(SECTION).toContain("**Decision recorded when the wait ended**");

    // The Dashboard draws the decision's source line from its own locale.
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../FeatureSet/Dashboard/src/Components/AI/InvestigationNotStarted.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('"Decision recorded when the wait ended"');
  });

  test("says what decides between several rules, and what a change during the wait does", () => {
    const section: string = flat(SECTION);

    expect(section).toContain(
      "When several enabled rules match, the shortest wait decides, and a matching rule that investigates right away means right away.",
    );
    expect(section).toContain(
      "When the incident's severity, labels, monitors, title or description change while it waits, the wait follows the rules it matches then",
    );
    expect(section).toContain(
      "If the rules it matches now wait longer, it waits on until then.",
    );
  });

  test("says fixing does not wait, and the follow-up window runs from the waited investigation's end", () => {
    expect(FOLLOW_UP_WINDOW_MINUTES).toBe(30);
    expect(flat(SECTION)).toContain(
      "Auto-remediation starts when the incident is declared, as when no investigation is enqueued, and the investigation after the wait never starts it again",
    );
    expect(flat(SECTION)).toContain(
      `The follow-up check counts its ${FOLLOW_UP_WINDOW_MINUTES} minutes from when the investigation finished, not from when the incident was declared`,
    );
  });

  test("says Investigate now ignores the wait and the rules, never AI being off, credits or the limits", () => {
    expect(flat(SECTION)).toContain(
      "It starts at once, whatever the rules, the severity floor or the cooldown say, as long as AI is on, has an LLM provider and AI credits, and no limit is reached.",
    );
  });

  test("the rules bullet, the follow-up check and auto-remediation point at it, and troubleshooting names the reason", () => {
    const pointers: number = ENGLISH_LINES.filter((line: string): boolean => {
      return line.includes("(#wait-before-investigating)");
    }).length;

    // The rules bullet, the follow-up check and auto-remediation.
    expect(pointers).toBe(3);
    expect(ENGLISH).toContain("or it was resolved during an AI rule's wait");
  });
});

describe("every language has the section in the English one's place", () => {
  test.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s keeps the server's line, the API's column and the numbers",
    (language: string) => {
      const section: string = sectionIn(language);
      const lines: Array<string> = section.split("\n");

      expect(lines[0]?.startsWith("### ")).toBe(true);
      expect(
        readPage(language, AI_SRE).split("\n")[END]?.startsWith("## "),
      ).toBe(true);
      expect(section).toContain(`**${RESOLVED_TITLE}**`);
      expect(section).toContain(`\`${INVESTIGATION_RULE_WAIT_COLUMN}\``);

      // The wait's bounds and the follow-up window, in the language's digits.
      const numbers: Array<string> = toLatinDigits(section).match(/\d+/g) || [];

      expect(numbers).toEqual(
        expect.arrayContaining([
          "1",
          String(MAX_INVESTIGATION_RULE_WAIT_MINUTES),
          String(FOLLOW_UP_WINDOW_MINUTES),
        ]),
      );
    },
  );
});
