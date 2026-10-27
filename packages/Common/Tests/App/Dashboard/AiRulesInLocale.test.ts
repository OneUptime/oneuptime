import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AI_RULE_COLUMN_TITLE,
  AI_RULE_DOES_NOT_INVESTIGATE_TEXT,
  AI_RULE_DOES_NOTHING_TEXT,
  AI_RULE_FIX_FIELD_COPY,
  AI_RULE_FIX_OPTIONS,
  AI_RULE_FIX_TEXT,
  AI_RULE_ONLY_FIXES_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiRuleCopy";
import {
  AI_LANE_ADVANCED_CARD_TITLES,
  AI_LANE_RULES_COPY,
  AiLane,
  AiLaneAdvancedCard,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { INVESTIGATION_WAITING_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationWaitingState";
import { NOT_INVESTIGATED_REASONS } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  EXTERNAL_MCP_SERVER_TOOLS_COPY,
  RULE_MCP_SERVERS_FIELD_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerCopy";
import { RULE_CODE_REPOSITORIES_FIELD_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/RuleCodeRepositoriesCopy";
import { AI_RULE_AI_CONTEXT_FIELD_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiContextCopy";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";

/*
 * EVERY WORD THE AI RULES ADD IS EVERY LANGUAGE'S OWN, AND THE WORDS OF THE
 * TWO KINDS OF RULE THEY REPLACE ARE GONE.
 *
 * Investigation rules and auto remediation rules became one AI rule: its
 * table and form, the note on a rule that only fixes, the reasons a fix was
 * or was not made, the AI Insights page's reasons, the model's own names -
 * read from the Dashboard's locale files themselves, so a key that lost its
 * translation, kept the English or lost a placeholder is caught, and so is
 * an old sentence left behind.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
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

// Japanese, Korean and Chinese read no "one" form: theirs may stay as is.
const WITHOUT_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

const LANES: Array<AiLane> = [AiLane.Incident, AiLane.Alert];

const MODEL: AutoRemediationRule = new AutoRemediationRule();

// A fix names the AI rule behind it: its two columns' titles.
const SUGGESTION: AutoRemediationSuggestion = new AutoRemediationSuggestion();

// Every sentence the AI rules add, by the key the code looks it up with.
const SENTENCES: Array<string> = [
  // The model's names and description: the API reference, the Dashboard.
  MODEL.singularName!,
  MODEL.pluralName!,
  MODEL.tableDescription!,
  SUGGESTION.getTableColumnMetadata("autoRemediationRule").title!,
  SUGGESTION.getTableColumnMetadata("autoRemediationRuleId").title!,
  // The AI settings page's card, and its table.
  ...LANES.flatMap((lane: AiLane): Array<string> => {
    return [
      AI_LANE_ADVANCED_CARD_TITLES[lane][AiLaneAdvancedCard.AiRules]!,
      AI_LANE_RULES_COPY[lane].aiRulesDescription,
      AI_LANE_RULES_COPY[lane].noAiRulesMessage,
      AI_RULE_ONLY_FIXES_COPY[lane].note,
      AI_RULE_ONLY_FIXES_COPY[lane].investigateToo,
    ];
  }),
  // The table's one column for what a rule does.
  AI_RULE_COLUMN_TITLE,
  AI_RULE_DOES_NOT_INVESTIGATE_TEXT,
  AI_RULE_FIX_TEXT.DoNotFix,
  AI_RULE_FIX_TEXT.AskFirst,
  AI_RULE_FIX_TEXT.WithoutAsking,
  // The rule form.
  AI_RULE_FIX_FIELD_COPY.description,
  ...AI_RULE_FIX_OPTIONS.flatMap((option: CardSelectOption): Array<string> => {
    return [option.title, option.description || ""];
  }),
  AI_RULE_DOES_NOTHING_TEXT,
  "Production incidents",
  "Production alerts",
  RULE_MCP_SERVERS_FIELD_COPY.aiRuleDescription,
  RULE_CODE_REPOSITORIES_FIELD_COPY.aiRuleDescription,
  // What the pickers' open lists say while the project has none to pick.
  RULE_MCP_SERVERS_FIELD_COPY.emptyList,
  RULE_CODE_REPOSITORIES_FIELD_COPY.emptyList,
  "No runbooks yet.",
  EXTERNAL_MCP_SERVER_TOOLS_COPY.description,
  // The rule's AI context, under More fields after the LLM provider (#5198).
  AI_RULE_AI_CONTEXT_FIELD_COPY.title,
  AI_RULE_AI_CONTEXT_FIELD_COPY.description,
  AI_RULE_AI_CONTEXT_FIELD_COPY.placeholder,
  // AI Insights' reasons an incident was not investigated.
  NOT_INVESTIGATED_REASONS.incident.no_investigation_rule_matched,
  NOT_INVESTIGATED_REASONS.incident.resolved_before_investigation,
  // The reasons a fix was made, or not, on the incident and alert pages.
  "Incident AI rules",
  "Alert AI rules",
  "AI rules were not checked: this {{signal}} already has the most fixes one {{signal}} can get.",
  "Enable AI is off for this project, so nothing is fixed automatically: no cluster or resource fix and no AI rule runs.",
  "No AI rule is set up for this kind of {{signal}}. A rule can propose or start a runbook when a matching one is created.",
  "No AI rule that matches this {{signal}} fixes with OneUptime AI, so OneUptime AI did not fix it on the clusters or hosts it is linked to.",
  'OneUptime AI is composing a fix for cluster "{{clusterName}}". Nothing runs until you approve it, because AI rule "{{ruleName}}" asks before fixing.',
  'OneUptime AI is composing a fix for {{resourceKind}} "{{resourceName}}". Nothing runs until you approve it, because AI rule "{{ruleName}}" asks before fixing.',
];

// The plural sentences: their "other" key, and the "one" form under _one.
const PLURALS: Array<{ one: string; other: string }> = [
  INVESTIGATION_WAITING_COPY.incident.description,
  INVESTIGATION_WAITING_COPY.alert.description,
  {
    one: "The {{count}} AI rule set up does not match this {{signal}}, so it was not fixed. With rules set up, OneUptime AI fixes only what matches a rule that fixes.",
    other:
      "None of the {{count}} AI rules set up match this {{signal}}, so it was not fixed. With rules set up, OneUptime AI fixes only what matches a rule that fixes.",
  },
  {
    one: "The {{count}} AI rule set up did not match this {{signal}}.",
    other: "None of the {{count}} AI rules set up matched this {{signal}}.",
  },
  {
    one: 'AI rule "{{ruleName}}" matched this {{signal}}, and it only investigates, so it was not fixed.',
    other:
      "{{count}} AI rules matched this {{signal}}, and they only investigate, so it was not fixed.",
  },
];

/*
 * What the two kinds of rule said that no screen says any more: each left
 * in a locale file would be a translation nobody reads, and a sign a screen
 * still says it.
 */
const RETIRED: Array<string> = [
  "Auto Remediation Rule",
  "Auto Remediation Rule ID",
  "Investigation rules",
  "Auto remediation rules",
  "Investigation Rule",
  "Investigation Rules",
  "Auto Remediation Rules",
  "Incident Auto Remediation Rules",
  "Alert Auto Remediation Rules",
  "Approval",
  "OneUptime AI works out each fix. Choose whether it waits for someone to approve it.",
  "Investigate production incidents",
  "Investigate production alerts",
  "No rules. Every new incident is investigated.",
  "No rules. Every new alert is investigated.",
  "No rules. Every new incident is fixed while fixing is on.",
  "No rules. Every new alert is fixed while fixing is on.",
  "With no rule, OneUptime AI investigates every new incident right away. Add rules to investigate only the incidents that match one of them, or only those still open after a wait.",
  "With no rule, OneUptime AI investigates every new alert right away. Add rules to investigate only the alerts that match one of them, or only those still open after a wait.",
  "With no rule, OneUptime AI fixes every new incident while fixing is on, pull requests included. Add rules to fix only the incidents that match one, to ask first, or to choose what it may use.",
  "With no rule, OneUptime AI fixes every new alert while fixing is on, pull requests included. Add rules to fix only the alerts that match one, to ask first, or to choose what it may use.",
  "OneUptime AI may use all of your MCP servers to fix. Pick some to let it use only those.",
  "OneUptime AI may use all of your MCP servers while it investigates. Pick some to let it use only those.",
  "OneUptime AI may read all of your connected repositories while it investigates. Pick some to let it read only those.",
  "Investigations use only the tools that read. Fixes also use the others, the way the auto remediation rule's Approval says.",
  "They matched none of the investigation rules.",
  "They were resolved during an investigation rule's wait.",
  "An investigation rule makes OneUptime AI wait {{count}} minutes, so incidents resolved by then are not investigated.",
  "An investigation rule makes OneUptime AI wait {{count}} minutes, so alerts resolved by then are not investigated.",
  "Auto Remediation Rules were not checked: this {{signal}} already has the most fixes one {{signal}} can get.",
  "None of the {{count}} Auto Remediation Rules set up matched this {{signal}}.",
  /*
   * Words the UI review replaced: the table's "Asks first" read as asking
   * before the investigation above it; the shared fields' lines said what
   * only a rule that fixes does; the card's line ran to a third line; and
   * the Remediation card's "only what a rule that fixes matches is fixed".
   */
  "Asks first",
  "Without asking",
  "OneUptime AI may use all of your MCP servers to investigate and fix. Pick some to let it use only those.",
  "OneUptime AI may read all of your connected repositories, and open pull requests in them. Pick some to let it use only those.",
  "With no rule, OneUptime AI investigates every new incident right away, and fixes it while fixing is on, pull requests included. Add rules to work only on the incidents that match one, to wait, or to choose how each is fixed.",
  "With no rule, OneUptime AI investigates every new alert right away, and fixes it while fixing is on, pull requests included. Add rules to work only on the alerts that match one, to wait, or to choose how each is fixed.",
  "None of the {{count}} AI rules set up match this {{signal}}, so it was not fixed. With rules set up, only what a rule that fixes matches is fixed.",
];

/*
 * The placeholders a sentence fills, each once: a language may name the
 * signal twice where English says "one" the second time.
 */
function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(/\{\{[a-zA-Z]+\}\}/g) || [])).sort();
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

describe("English holds every sentence under its own words", () => {
  test("there is something to check", () => {
    expect(SENTENCES.length).toBeGreaterThan(30);
    for (const sentence of SENTENCES) {
      expect(sentence.length).toBeGreaterThan(0);
    }
  });

  test.each(SENTENCES)("%s", (sentence: string) => {
    expect(ENGLISH[sentence]).toBe(sentence);
  });

  test.each(PLURALS)(
    "the plural %j",
    (plural: { one: string; other: string }) => {
      expect(ENGLISH[plural.other]).toBe(plural.other);
      expect(ENGLISH[`${plural.other}_one`]).toBe(plural.one);
    },
  );

  test("the model is named AI Rule, and once was an Auto Remediation Rule", () => {
    expect(MODEL.singularName).toBe("AI Rule");
    expect(MODEL.pluralName).toBe("AI Rules");
    expect(MODEL.formerSingularName).toBe("Auto Remediation Rule");
  });

  test("a fix names the AI rule behind it", () => {
    expect(SUGGESTION.getTableColumnMetadata("autoRemediationRule").title).toBe(
      "AI Rule",
    );
    expect(
      SUGGESTION.getTableColumnMetadata("autoRemediationRuleId").title,
    ).toBe("AI Rule ID");
  });
});

describe.each(["en", ...LANGUAGES])("the %s locale", (language: string) => {
  const words: Record<string, string> =
    language === "en" ? ENGLISH : LOCALES[language]!;

  test("keeps no sentence of the two kinds of rule the AI rules replace", () => {
    const leftBehind: Array<string> = RETIRED.filter((sentence: string) => {
      return (
        words[sentence] !== undefined || words[`${sentence}_one`] !== undefined
      );
    });

    expect(leftBehind).toEqual([]);
  });

  test("holds exactly English's keys", () => {
    expect(Object.keys(words)).toEqual(Object.keys(ENGLISH));
  });
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  const words: Record<string, string> = LOCALES[language]!;

  test("every sentence is the language's own, with the English placeholders", () => {
    for (const sentence of SENTENCES) {
      const translated: string | undefined = words[sentence];

      expect({
        sentence,
        isTranslated: Boolean(translated) && translated !== sentence,
      }).toEqual({
        sentence,
        isTranslated: true,
      });
      expect({ sentence, placeholders: placeholders(translated!) }).toEqual({
        sentence,
        placeholders: placeholders(sentence),
      });
    }
  });

  test("every plural is the language's own, with the English placeholders", () => {
    for (const plural of PLURALS) {
      expect(words[plural.other]).toBeDefined();
      expect(words[plural.other]).not.toBe(plural.other);
      expect(placeholders(words[plural.other]!)).toEqual(
        placeholders(plural.other),
      );

      if (!WITHOUT_ONE_FORM.includes(language)) {
        expect(words[`${plural.other}_one`]).toBeDefined();
        expect(words[`${plural.other}_one`]).not.toBe(plural.one);
        expect(placeholders(words[`${plural.other}_one`]!)).toEqual(
          placeholders(plural.one),
        );
      }
    }
  });
});
