import {
  ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
  ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
} from "Common/Types/OnCallDutyPolicy/OnCallEmptyLevel";
import { ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { TRANSLATED_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { readCommonSource, readDashboardSource } from "./DocsDashboardMenus";
import { describe, expect, it } from "@jest/globals";

/*
 * A LEVEL WITH NOBODY TO PAGE IS PASSED AT ONCE, AND THE DOCS SAY SO.
 *
 * An on-call policy no longer waits out a level that pages nobody when it is
 * reached - no responders, an empty team, a schedule with nobody on call,
 * people away, gone or unreachable - and no longer tries a schedule with
 * nobody on call again for a few minutes: it pages the next level at once
 * (OnCallEscalationAdvance.moveOnAtOnce). A pass that paged nobody is not
 * repeated. The escalation rules page and the on-call policies page say
 * this, in every docs language, and name the Dashboard's new words - the
 * summary's "Skipped at once", the timeline's "Moved on at once" - as each
 * language's Dashboard draws them.
 *
 * These hold the English sentences to the engine and the Dashboard source,
 * and every translation to its English line.
 */

const ESCALATION_RULES: string = "on-call/escalation-rules";
const POLICIES: string = "on-call/policies";

const EMPTY_LEVEL_PARAGRAPH: string =
  "A level that has nobody to page when it is reached is passed at once: the next level is paged straight away, without waiting. That is a level with no responders, and one whose responders give it nobody to page at that moment: a team with no members, a schedule with nobody on call, or people who are away with nobody to cover, have left the project, or cannot be reached at all. When no level has anybody to page, the policy stops at once and does not repeat.";

const SUMMARY_SENTENCE: string =
  "A level with no responders shows **Skipped at once**, and its wait is not counted towards when the next level is paged.";

const SCHEDULE_GAP_BULLET: string =
  "- When nobody is on call in the schedule at all, nobody is next either, and the level pages nobody there.";

const NO_REPEAT_SENTENCES: string =
  "A policy that starts again three more times goes through its levels four times in all. A pass in which no level had anybody to page is not repeated: another would page nobody either, so the policy stops.";

const NO_ONE_NOTIFIED_ROW: string = `| **${OnCallDutyPolicyStatus.CompletedWithNoNotifications}** | The run went through every rule and paged nobody: usually a schedule with nobody on call, or a level with no responders. |`;

const TIMELINE_SENTENCE: string =
  "A level that paged nobody says why, with **Moved on at once** under it: the policy did not wait for it.";

const TROUBLESHOOTING_TITLE: string =
  ":::details The next level was paged at once, without waiting";

// The paragraph the empty-level one follows links here.
const CREATED_CLOSED_LINK: string = "](/docs/incidents/declaring-incidents#";

/*
 * The retry the pages promised for a schedule with nobody on call, as each
 * language's page said it. The engine no longer tries such a level again.
 */
const RETIRED_RETRY: Record<string, string> = {
  en: "tried again for a few minutes",
  de: "einige Minuten lang erneut versucht",
  fr: "retenté pendant quelques minutes",
  es: "se vuelve a intentar durante unos minutos",
  it: "ritentato per qualche minuto",
  pt: "tentado de novo por alguns minutos",
  nl: "een paar minuten lang opnieuw geprobeerd",
  da: "forsøges igen i et par minutter",
  no: "prøves på nytt i noen minutter",
  sv: "försöks igen i några minuter",
  ru: "повторяется ещё несколько минут",
  ja: "数分間再試行",
  ko: "몇 분 동안 다시 시도",
  "zh-CN": "几分钟内重试",
  "zh-TW": "幾分鐘內重試",
  hi: "कुछ मिनट तक फिर से आज़माया",
  fa: "چند دقیقه دوباره امتحان",
};

function lines(language: string, page: string): Array<string> {
  return readPage(language, page).split("\n");
}

// The line of the English page that holds this text.
function englishLineOf(page: string, text: string): number {
  return lines("en", page).findIndex((line: string): boolean => {
    return line.includes(text);
  });
}

describe("the engine the pages describe", () => {
  it("moves on from a level that paged nobody at once, and its line on the timeline says so", () => {
    expect(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE).toContain(
      "moved on at once",
    );
    expect(ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE).toContain(
      "moved on at once",
    );

    const ruleService: string = readCommonSource(
      "Server/Services/OnCallDutyPolicyEscalationRuleService.ts",
    );
    const advance: string = readCommonSource(
      "Server/Utils/OnCall/OnCallEscalationAdvance.ts",
    );

    expect(ruleService).toContain("movesOnAtOnce: reachedNobody");
    expect(advance).toContain("public static async moveOnAtOnce(");
  });

  it("no longer tries a schedule with nobody on call again", () => {
    expect(
      readCommonSource(
        "Server/Services/OnCallDutyPolicyEscalationRuleService.ts",
      ),
    ).not.toContain("scheduleGapRetryCount");
  });

  it("does not repeat a pass that paged nobody, and ends it saying so", () => {
    expect(
      readCommonSource("Server/Utils/OnCall/OnCallEscalationAdvance.ts"),
    ).toContain("if (!hasPassReachedAnybody) {");
    expect(ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE).toContain(
      "no escalation rule of this policy had anybody to page",
    );
  });
});

describe("the English escalation rules page", () => {
  const page: Array<string> = lines("en", ESCALATION_RULES);

  it("says a level with nobody to page is passed at once, and what such a level is, in a paragraph of its own", () => {
    const index: number = page.indexOf(EMPTY_LEVEL_PARAGRAPH);

    expect(index).toBeGreaterThan(0);
    expect(page[index - 1]).toBe("");
    expect(page[index + 1]).toBe("");
    // Below the levels paragraph and the created-already-closed one.
    expect(page[index - 2]).toContain(CREATED_CLOSED_LINK);

    const heading: string | undefined = page
      .slice(0, index)
      .reverse()
      .find((line: string): boolean => {
        return line.startsWith("## ");
      });

    expect(heading).toBe("## How the levels page people");
  });

  it("names the summary's Skipped at once, as the Dashboard draws it", () => {
    expect(page.join("\n")).toContain(SUMMARY_SENTENCE);
    expect(
      readDashboardSource(
        "Components/OnCallPolicy/EscalationRule/EscalationSummary.tsx",
      ),
    ).toContain('translationKey("Skipped at once")');
  });

  it("no longer promises a schedule with nobody on call a few more minutes", () => {
    expect(page).toContain(SCHEDULE_GAP_BULLET);
    expect(page.join("\n")).not.toContain(RETIRED_RETRY["en"]!);
  });
});

describe("the English on-call policies page", () => {
  const page: Array<string> = lines("en", POLICIES);
  const text: string = page.join("\n");

  it("says a pass that paged nobody is not repeated, right after how many passes a repeat makes", () => {
    expect(text).toContain(NO_REPEAT_SENTENCES);
  });

  it("says when a run ends with nobody notified, by the status the run shows", () => {
    expect(page).toContain(NO_ONE_NOTIFIED_ROW);
  });

  it("names the timeline's Moved on at once, as the timeline draws it", () => {
    expect(text).toContain(TIMELINE_SENTENCE);
    expect(
      readDashboardSource(
        "Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable.tsx",
      ),
    ).toContain('translationKey("Moved on at once")');
  });

  it("answers why the next level was paged at once, under Troubleshooting", () => {
    const index: number = page.indexOf(TROUBLESHOOTING_TITLE);

    expect(index).toBeGreaterThan(page.indexOf("## Troubleshooting"));
    expect(page[index + 1]).toContain("**View Timeline**");
    expect(page[index + 2]).toBe(":::");
  });
});

describe("the retired retry, by language", () => {
  it("is known for every docs language", () => {
    expect(Object.keys(RETIRED_RETRY).sort()).toEqual(
      ["en", ...TRANSLATED_LANGUAGES].sort(),
    );
  });
});

describe.each(TRANSLATED_LANGUAGES)("in %s", (language: string) => {
  it("has the empty-level paragraph translated, on the English one's line, in a paragraph of its own", () => {
    const index: number = lines("en", ESCALATION_RULES).indexOf(
      EMPTY_LEVEL_PARAGRAPH,
    );
    const page: Array<string> = lines(language, ESCALATION_RULES);

    expect(page[index]!.trim().length).toBeGreaterThan(0);
    expect(page[index]).not.toBe(EMPTY_LEVEL_PARAGRAPH);
    expect(page[index - 1]).toBe("");
    expect(page[index + 1]).toBe("");
    expect(page[index - 2]).toContain(CREATED_CLOSED_LINK);
  });

  it("names Skipped at once as its Dashboard draws it, on the English sentence's line", () => {
    const drawn: string = drawnDashboardLabel(language, "Skipped at once");

    expect(drawn).not.toBe("Skipped at once");
    expect(
      lines(language, ESCALATION_RULES)[
        englishLineOf(ESCALATION_RULES, SUMMARY_SENTENCE)
      ],
    ).toContain(`**${drawn}**`);
  });

  it("names Moved on at once as its Dashboard draws it, on the English sentence's line", () => {
    const drawn: string = drawnDashboardLabel(language, "Moved on at once");

    expect(drawn).not.toBe("Moved on at once");
    expect(
      lines(language, POLICIES)[englishLineOf(POLICIES, TIMELINE_SENTENCE)],
    ).toContain(`**${drawn}**`);
  });

  it("no longer promises a schedule with nobody on call a few more minutes", () => {
    expect(readPage(language, ESCALATION_RULES)).not.toContain(
      RETIRED_RETRY[language]!,
    );
  });

  it("keeps the status a run with nobody notified shows in English, on the English row's line", () => {
    const row: string = lines(language, POLICIES)[
      lines("en", POLICIES).indexOf(NO_ONE_NOTIFIED_ROW)
    ]!;

    expect(
      row.startsWith(
        `| **${OnCallDutyPolicyStatus.CompletedWithNoNotifications}** | `,
      ),
    ).toBe(true);
    expect(row).not.toBe(NO_ONE_NOTIFIED_ROW);
  });

  it("answers why the next level was paged at once, on the English entry's lines, naming View Timeline as its Dashboard draws it", () => {
    const index: number = lines("en", POLICIES).indexOf(TROUBLESHOOTING_TITLE);
    const page: Array<string> = lines(language, POLICIES);

    expect(page[index]!.startsWith(":::details ")).toBe(true);
    expect(page[index]).not.toBe(TROUBLESHOOTING_TITLE);
    expect(page[index + 1]).toContain(
      `**${drawnDashboardLabel(language, "View Timeline")}**`,
    );
    expect(page[index + 2]).toBe(":::");
  });
});
