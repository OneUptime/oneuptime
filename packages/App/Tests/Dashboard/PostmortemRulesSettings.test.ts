import {
  AI_LANE_ADVANCED_CARDS,
  AI_LANE_PAGE_COPY,
  AI_LANE_RULES_CARDS,
  AI_POSTMORTEM_RULES_TABLE_ID,
  AiLane,
  AiLaneAdvancedCard,
  AiLaneAdvancedState,
  EMPTY_AI_LANE_ADVANCED_STATE,
  getAiLaneAdvancedCardColumns,
  getAiLaneAdvancedCardTitle,
  getAiLaneAdvancedItems,
  getAiLaneAdvancedSummary,
  isAiLaneAdvancedConfigured,
  recordAiLaneAdvancedCard,
  recordAiLaneAdvancedRules,
} from "../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  POSTMORTEM_RULE_DRAFT_STEP_ID,
  POSTMORTEM_RULE_DRAFT_STEP_TITLE,
  POSTMORTEM_RULE_MATCH_STEP_ID,
  POSTMORTEM_RULE_MORE_TEMPLATES,
  POSTMORTEM_RULE_NAME_DESCRIPTION,
  POSTMORTEM_RULE_NAME_PLACEHOLDER,
  POSTMORTEM_RULE_NAME_WORDING,
  POSTMORTEM_RULE_STANDARD_OUTLINE,
  POSTMORTEM_RULE_STANDARD_OUTLINE_NAME,
  POSTMORTEM_RULE_TEMPLATES_COLUMN_TITLE,
  POSTMORTEM_RULE_TEMPLATES_DESCRIPTION,
  POSTMORTEM_RULE_TEMPLATES_TITLE,
  POSTMORTEM_RULES_CARD_DESCRIPTION,
  POSTMORTEM_RULES_CARD_DESCRIPTION_WITHOUT_TEMPLATES,
  POSTMORTEM_RULES_NO_ITEMS_MESSAGE,
} from "../../FeatureSet/Dashboard/src/Components/AISettings/PostmortemRulesCopy";
import AIPostmortemRule from "Common/Models/DatabaseModels/AIPostmortemRule";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Postmortem rules on Incidents → AI → Settings: "Can you please create
 * rules for these just like we have investigation rules in more options?
 * The rules can contain which incidents can we draft a postmortem report
 * for, and what templates can be used?" - the maintainer.
 *
 * App cannot render React, so this pins the React-free copy and decisions,
 * and the pages' wiring as source:
 *
 *   - a rules card under More settings on the incident page alone, after
 *     the auto remediation rules (the switches' order) and before the daily
 *     limits, counted on the folded header like the other rules tables;
 *   - the summary under the folded header says drafts happen by default;
 *   - its table is drag-ordered and its form asks Match, then Draft;
 *   - every new string is in every locale, in its own words.
 *
 * The table and its form are rendered in Common/Tests/App/Dashboard
 * (AIPostmortemRulesTable, ProjectAiSettingsSwitchPages,
 * MoreSettingsOneCard), and in a browser in packages/E2E/PostmortemRules.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Source with comments dropped and whitespace collapsed.
function readSource(relative: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const INCIDENT_PAGE: string = "Pages/Incidents/Settings/IncidentAISettings.tsx";
const ALERT_PAGE: string = "Pages/Alerts/Settings/AlertAISettings.tsx";
const TABLE: string = "Components/AISettings/AIPostmortemRulesTable.tsx";
const TEMPLATES_CELL: string =
  "Components/AISettings/PostmortemRuleTemplates.tsx";

// The more button's words, in the reader's plural forms - however prettier wraps the call.
const MORE_TEMPLATES_PLURAL_CALL: RegExp =
  /translator\.translatePlural\(\s*POSTMORTEM_RULE_MORE_TEMPLATES,\s*count,?\s*\)/;
const COPY: string = "Components/AISettings/PostmortemRulesCopy.ts";
const FORM: string = "Components/AISettings/PostmortemRuleForm.ts";

// Every card of a lane read, rules tables counting `counts`.
function everyCardRead(
  lane: AiLane,
  counts: Partial<Record<AiLaneAdvancedCard, number>> = {},
): AiLaneAdvancedState {
  let state: AiLaneAdvancedState = EMPTY_AI_LANE_ADVANCED_STATE;

  for (const card of AI_LANE_ADVANCED_CARDS[lane]) {
    state = AI_LANE_RULES_CARDS.includes(card)
      ? recordAiLaneAdvancedRules({ state, card, count: counts[card] || 0 })
      : recordAiLaneAdvancedCard({ state, lane, card, item: {} });
  }

  return state;
}

describe("Postmortem rules under More settings", () => {
  test("are on the incident page, after the AI rules and the investigation limits, and before the daily limits", () => {
    expect(AI_LANE_ADVANCED_CARDS[AiLane.Incident]).toEqual([
      AiLaneAdvancedCard.AiRules,
      AiLaneAdvancedCard.WhichAreInvestigated,
      AiLaneAdvancedCard.InvestigationLimits,
      AiLaneAdvancedCard.PostmortemRules,
      AiLaneAdvancedCard.DailyLimits,
    ]);
  });

  test("are not on the alert page: an alert has no postmortem", () => {
    expect(AI_LANE_ADVANCED_CARDS[AiLane.Alert]).not.toContain(
      AiLaneAdvancedCard.PostmortemRules,
    );
    expect(AI_LANE_ADVANCED_CARDS[AiLane.Alert]).toEqual(
      AI_LANE_ADVANCED_CARDS[AiLane.Incident].filter(
        (card: AiLaneAdvancedCard): boolean => {
          return card !== AiLaneAdvancedCard.PostmortemRules;
        },
      ),
    );
    expect(
      getAiLaneAdvancedCardTitle(
        AiLane.Alert,
        AiLaneAdvancedCard.PostmortemRules,
      ),
    ).toBe("");
  });

  test("are a rules table: they hold rules, not Project columns", () => {
    expect(AI_LANE_RULES_CARDS).toContain(AiLaneAdvancedCard.PostmortemRules);
    expect(
      getAiLaneAdvancedCardColumns(
        AiLane.Incident,
        AiLaneAdvancedCard.PostmortemRules,
      ),
    ).toEqual([]);
    expect(
      getAiLaneAdvancedCardTitle(
        AiLane.Incident,
        AiLaneAdvancedCard.PostmortemRules,
      ),
    ).toBe("Postmortem rules");
  });

  test("folded, the header names them and, once there is one, counts the enabled ones as a chip", () => {
    const none: Array<FoldedSectionItem> = getAiLaneAdvancedItems(
      AiLane.Incident,
      everyCardRead(AiLane.Incident),
    );
    const postmortem: FoldedSectionItem | undefined = none.find(
      (item: FoldedSectionItem): boolean => {
        return item.key === AiLaneAdvancedCard.PostmortemRules;
      },
    );

    expect(postmortem?.title).toBe("Postmortem rules");
    expect(postmortem?.isSet).toBe(false);

    const two: FoldedSectionItem | undefined = getAiLaneAdvancedItems(
      AiLane.Incident,
      everyCardRead(AiLane.Incident, {
        [AiLaneAdvancedCard.PostmortemRules]: 2,
      }),
    ).find((item: FoldedSectionItem): boolean => {
      return item.key === AiLaneAdvancedCard.PostmortemRules;
    });

    expect(two?.isSet).toBe(true);
    expect(two?.value).toBe("2");
  });

  test("a postmortem rule makes More settings Configured, and the defaults are no longer claimed", () => {
    const state: AiLaneAdvancedState = everyCardRead(AiLane.Incident, {
      [AiLaneAdvancedCard.PostmortemRules]: 1,
    });

    expect(isAiLaneAdvancedConfigured(AiLane.Incident, state)).toBe(true);
    expect(getAiLaneAdvancedSummary(AiLane.Incident, state)).toBeUndefined();
  });

  test("a count of postmortem rules never makes the alert page Configured", () => {
    const state: AiLaneAdvancedState = recordAiLaneAdvancedRules({
      state: everyCardRead(AiLane.Alert),
      card: AiLaneAdvancedCard.PostmortemRules,
      count: 5,
    });

    expect(isAiLaneAdvancedConfigured(AiLane.Alert, state)).toBe(false);
  });

  test("with every card read and nothing set, the folded line says drafts happen too", () => {
    expect(
      getAiLaneAdvancedSummary(AiLane.Incident, everyCardRead(AiLane.Incident)),
    ).toBe(
      "Every incident is investigated, whatever its severity, fixed while fixing is on, and given a postmortem draft when it resolves. Nothing limits how much OneUptime AI does.",
    );
    expect(AI_LANE_PAGE_COPY[AiLane.Incident].advancedDescription).toBe(
      "Which incidents are investigated, fixed or given a postmortem draft, and limits on investigations and on AI work each day.",
    );
    // The alerts' words are left as they were.
    expect(AI_LANE_PAGE_COPY[AiLane.Alert].advancedDefaultsSummary).not.toMatch(
      /postmortem/i,
    );
  });

  test("the incident page draws the table under More settings, counted on its header", () => {
    const page: string = readSource(INCIDENT_PAGE);
    const section: string = page.slice(page.indexOf("<AdvancedPageSection"));

    expect(page).toContain(
      'import AIPostmortemRulesTable from "../../../Components/AISettings/AIPostmortemRulesTable";',
    );
    expect(section).toContain(
      "<AIPostmortemRulesTable onRulesLoaded={advanced.onRulesLoaded( AiLaneAdvancedCard.PostmortemRules, )} />",
    );
    // After the AI rules, before the daily limits.
    expect(section.indexOf("<AiRulesTable")).toBeGreaterThan(-1);
    expect(section.indexOf("<AiRulesTable")).toBeLessThan(
      section.indexOf("<AIPostmortemRulesTable"),
    );
    expect(section.indexOf("<AIPostmortemRulesTable")).toBeLessThan(
      section.indexOf('name="Incident Daily Limits"'),
    );
    // Only once.
    expect(page.split("<AIPostmortemRulesTable").length).toBe(2);
  });

  test("the alert page does not", () => {
    expect(readSource(ALERT_PAGE)).not.toContain("AIPostmortemRulesTable");
  });

  test("the table is the postmortem rules, drag-ordered, asking Match then Draft", () => {
    const table: string = readSource(TABLE);

    expect(table).toContain(
      "<ModelTable<AIPostmortemRule> modelType={AIPostmortemRule}",
    );
    expect(table).toContain("enableDragAndDrop={true}");
    expect(table).toContain('dragDropIndexField="order"');
    expect(table).toContain('sortBy="order"');
    expect(table).toContain(
      'formSteps={[ { title: "Match", id: "match-criteria" }, { title: "Draft", id: "postmortem-draft" }, ]}',
    );
    expect(POSTMORTEM_RULE_MATCH_STEP_ID).toBe("match-criteria");
    expect(POSTMORTEM_RULE_DRAFT_STEP_ID).toBe("postmortem-draft");
    expect(POSTMORTEM_RULE_DRAFT_STEP_TITLE).toBe("Draft");
    expect(AI_POSTMORTEM_RULES_TABLE_ID).toBe("ai-postmortem-rules-table");
  });

  /*
   * Seven columns share a card about 940px wide beside the side menu at
   * 1280px. The templates were one line of names, which pushed Status out
   * of the card (the rows scrolled sideways), and every name was cut to
   * "Draft with Database...". Measured in packages/E2E/PostmortemRules.
   */
  test("the table fits beside the side menu: names wrap, templates are a capped list, one a line", () => {
    const table: string = readSource(TABLE);

    expect(table).toContain(
      'columns={[ { field: { name: true }, title: "Name", type: FieldType.Text, wrapContent: true, },',
    );
    expect(table).toContain(
      "wrapContent: true, wrapMaxWidthClassName: POSTMORTEM_RULE_TEMPLATES_COLUMN_CLASS_NAME,",
    );
    expect(table).toContain(
      "<PostmortemRuleTemplates templates={item.postmortemTemplates} />",
    );
    // No width cap through contentClassName (TableWrapContentInvariants).
    expect(table).not.toContain("contentClassName");

    const cell: string = readSource(TEMPLATES_CELL);

    expect(cell).toContain(
      'POSTMORTEM_RULE_TEMPLATES_COLUMN_CLASS_NAME: string = "max-w-[11rem] 2xl:max-w-[18rem]";',
    );
    // The list every table draws records with: three, then how many more.
    expect(cell).toContain("<TableColumnListComponent<TemplateItem>");
    expect(cell).toContain("getMoreText={(count: number): string =>");
    expect(cell).toMatch(MORE_TEMPLATES_PLURAL_CALL);
  });

  test("below the plan, the rule's Name has no help: the column's description would only repeat it", () => {
    const table: string = readSource(TABLE);

    expect(table).toContain(
      'description: offersTemplates ? POSTMORTEM_RULE_NAME_DESCRIPTION : "", hideColumnDescription: true,',
    );
  });

  test("the model it lists is the server's postmortem rule", () => {
    expect(new AIPostmortemRule().tableName).toBe("AIPostmortemRule");
  });

  test("its words module stays free of React, so this suite can read it", () => {
    for (const file of [COPY]) {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, file),
        "utf8",
      );

      expect([file, source.includes('from "react"')]).toEqual([file, false]);
      expect([file, source.includes('.tsx"')]).toEqual([file, false]);
    }

    // The form helpers name rules after templates with the shared rule-name code.
    expect(readSource(FORM)).toContain(
      "getRuleNameFromPicks(POSTMORTEM_RULE_NAME_WORDING, templateNames)",
    );
  });
});

describe("Postmortem rules: translations", () => {
  // New with this change: every locale has its own words for them.
  const strings: Array<string> = [
    "Postmortem rules",
    "Postmortem Rule",
    "Postmortem Rules",
    POSTMORTEM_RULES_CARD_DESCRIPTION,
    POSTMORTEM_RULES_CARD_DESCRIPTION_WITHOUT_TEMPLATES,
    POSTMORTEM_RULES_NO_ITEMS_MESSAGE,
    POSTMORTEM_RULE_TEMPLATES_DESCRIPTION,
    POSTMORTEM_RULE_STANDARD_OUTLINE,
    POSTMORTEM_RULE_STANDARD_OUTLINE_NAME,
    POSTMORTEM_RULE_NAME_DESCRIPTION,
    POSTMORTEM_RULE_NAME_PLACEHOLDER,
    POSTMORTEM_RULE_NAME_WORDING.allPicks,
    POSTMORTEM_RULE_NAME_WORDING.somePicks.other,
    POSTMORTEM_RULE_MORE_TEMPLATES.other,
    AI_LANE_PAGE_COPY[AiLane.Incident].advancedDescription,
    AI_LANE_PAGE_COPY[AiLane.Incident].advancedDefaultsSummary,
    new AIPostmortemRule().tableDescription || "",
  ];

  // Words the Dashboard already had, which the rules reuse.
  const existing: Array<string> = [
    POSTMORTEM_RULE_DRAFT_STEP_TITLE,
    POSTMORTEM_RULE_TEMPLATES_TITLE,
    POSTMORTEM_RULE_TEMPLATES_COLUMN_TITLE,
    "Match",
    "Name",
    "Enabled",
    "Disabled",
  ];

  test("en.json maps every string to itself, and the plural's one form", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const text of [...strings, ...existing]) {
      expect([text, english[text]]).toEqual([text, text]);
    }

    expect(english[`${POSTMORTEM_RULE_NAME_WORDING.somePicks.other}_one`]).toBe(
      POSTMORTEM_RULE_NAME_WORDING.somePicks.one,
    );
    expect(english[`${POSTMORTEM_RULE_MORE_TEMPLATES.other}_one`]).toBe(
      POSTMORTEM_RULE_MORE_TEMPLATES.one,
    );
  });

  test.each(OTHER_LOCALES)(
    "%s has its own words for every new string, keeping their placeholders",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const text of strings) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
        expect([text, translations[text]]).not.toEqual([text, text]);

        for (const placeholder of text.match(/\{\{\w+\}\}/g) || []) {
          expect([
            text,
            String(translations[text]).includes(placeholder),
          ]).toEqual([text, true]);
        }
      }

      for (const text of existing) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
      }

      const one: unknown =
        translations[`${POSTMORTEM_RULE_NAME_WORDING.somePicks.other}_one`];

      expect(typeof one).toBe("string");
      expect(String(one)).toContain("{{templates}}");

      // "2 more templates": the count in both forms.
      const moreOne: unknown =
        translations[`${POSTMORTEM_RULE_MORE_TEMPLATES.other}_one`];

      expect(typeof moreOne).toBe("string");
      expect(String(moreOne)).toContain("{{count}}");
    },
  );
});
