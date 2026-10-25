import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of entity risk in the Dashboard: Security Events > Entity Risk,
 * an entity's page, Settings > Risk Scoring, and the Risk column of a case's
 * Entities. Each is an en.json key, looked up where it is drawn.
 *
 * React-free, so the words are pinned in a plain test, beside the numbers
 * they talk about (Types/SecurityCase/SecurityEntityRisk).
 */

// ---------- Security Events > Entity Risk ----------

export const ENTITY_RISK_TABLE_TITLE: string = translationKey("Entity Risk");

export const ENTITY_RISK_TABLE_DESCRIPTION: string = translationKey(
  "Every user, host and address, scored by what your rules, threat intel and connected products found about it in the last 7 days. Each source counts once.",
);

export const ENTITY_RISK_EMPTY_TITLE: string = translationKey(
  "No user, host or address has any risk yet.",
);

export const ENTITY_RISK_EMPTY_DESCRIPTION: string = translationKey(
  "Risk builds up as your detection rules, threat intel and connected products find things about the users, hosts and addresses they are about.",
);

export const ENTITY_RISK_EMPTY_ACTION: string =
  translationKey("Open the Rule Library");

// Said above the list while the project opens no case from risk.
export const RISK_CASES_OFF_TITLE: string = translationKey(
  "Entities that reach the threshold open no case",
);

export const RISK_CASES_OFF_DESCRIPTION: string = translationKey(
  "Risk is scored either way. Turn on risk cases in Risk Scoring, and an entity at High risk opens a case of its own.",
);

export const RISK_CASES_OFF_ACTION: string = translationKey("Open Risk Scoring");

export const RISK_CASES_OFF_TEST_ID: string = "entity-risk-cases-off";

// The list's columns.
export const ENTITY_COLUMN_TITLE: string = translationKey("Entity");
export const RISK_COLUMN_TITLE: string = translationKey("Risk");
export const CRITICALITY_COLUMN_TITLE: string = translationKey("Criticality");
export const SOURCES_COLUMN_TITLE: string = translationKey("Found By");
export const TACTICS_COLUMN_TITLE: string = translationKey("ATT&CK Tactics");
export const LAST_RISK_COLUMN_TITLE: string = translationKey("Last Risk");

// "Brute force and 2 more": the sources column, under its count.
export const SOURCES_AND_MORE: {
  one: string;
  other: string;
} = {
  one: translationKey("{{name}} and {{count}} more"),
  other: translationKey("{{name}} and {{count}} more"),
};

export const SOURCE_COUNT: { one: string; other: string } = {
  one: translationKey("{{count}} source"),
  other: translationKey("{{count}} sources"),
};

// ---------- An entity's page ----------

export const ENTITY_PAGE_NOT_NAMED_TITLE: string = translationKey(
  "Which entity? This page opens on a user, a host or an address.",
);

export const ENTITY_PAGE_NOT_NAMED_DESCRIPTION: string = translationKey(
  "Open one from Entity Risk, or from the entities of a case.",
);

export const ENTITY_RISK_CARD_TITLE: string = translationKey("Risk");

export const ENTITY_RISK_CARD_DESCRIPTION: string = translationKey(
  "What the findings about it in the last 7 days add up to, weighted by how much it matters.",
);

export const ENTITY_NO_RISK: string = translationKey(
  "Nothing found about it counts toward risk in the last 7 days.",
);

// "Risk 125 · High · a case opens at 100"
export const RISK_AGAINST_THRESHOLD: string = translationKey(
  "A case opens at {{threshold}}",
);

export const RISK_CRITICALITY_WEIGHT: string = translationKey(
  "{{criticality}} criticality: its findings count {{weight}} times",
);

export const RISK_BREAKDOWN: string = translationKey(
  "{{base}} from its sources × {{weight}} = {{score}}",
);

export const RISK_FIRST_AND_LAST: string = translationKey(
  "Counting since {{first}}, last finding {{last}}",
);

export const RISK_FALLS_AT: string = translationKey(
  "Falls {{when}}, as its oldest source stops counting",
);

export const RISK_CASE_OPENED_AT: string = translationKey(
  "Its risk last opened or joined a case {{when}}",
);

export const SOURCES_CARD_TITLE: string = translationKey(
  "What Adds to Its Risk",
);

export const SOURCES_CARD_DESCRIPTION: string = translationKey(
  "Each detection rule, threat intel feed and connected product's rule that found it in the last 7 days. Each counts once, at the most it added.",
);

export const SOURCES_EMPTY: string = translationKey(
  "No source counts toward its risk now.",
);

// The sources table's columns.
export const SOURCE_COLUMN_TITLE: string = translationKey("Source");
export const SEVERITY_COLUMN_TITLE: string = translationKey("Severity");
export const POINTS_COLUMN_TITLE: string = translationKey("Points");
export const TIMES_COLUMN_TITLE: string = translationKey("Times");
export const LAST_SEEN_COLUMN_TITLE: string = translationKey("Last Seen");

export const HISTORY_CARD_TITLE: string = translationKey(
  "Risk Over the Last 30 Days",
);

export const HISTORY_CARD_DESCRIPTION: string = translationKey(
  "Its score at the end of each day, colored by its level.",
);

export const HISTORY_CHART_LABEL: string = translationKey(
  "Risk score by day, for the last 30 days",
);

export const CASES_CARD_TITLE: string = translationKey("Cases About It");

export const CASES_CARD_DESCRIPTION: string = translationKey(
  "The security cases opened about this entity, the latest first.",
);

export const CASES_EMPTY: string = translationKey(
  "No case has been opened about it.",
);

export const ACTIVITY_CARD_TITLE: string = translationKey("Activity");

export const ACTIVITY_CARD_DESCRIPTION: string = translationKey(
  "The security events that name it in the last 7 days.",
);

export const ACTIVITY_EVENTS: string = translationKey("Events");
export const ACTIVITY_FINDINGS: string = translationKey("Findings");
export const ACTIVITY_FIRST_SEEN: string = translationKey("First Seen");
export const ACTIVITY_LAST_SEEN: string = translationKey("Last Seen");

export const OPEN_IN_CORRELATE: string = translationKey("Open in Correlate");
export const SEARCH_ITS_EVENTS: string = translationKey("Search Its Events");
export const RESET_RISK: string = translationKey("Reset Risk");

export const RESET_RISK_CONFIRM_TITLE: string = translationKey(
  "Reset this entity's risk?",
);

export const RESET_RISK_CONFIRM_DESCRIPTION: string = translationKey(
  "Its score and its sources are cleared, and the findings that come next count from nothing. Use it when you are sure it is fine, such as after a planned test. Its cases are not changed.",
);

// ---------- Settings > Risk Scoring ----------

export const RISK_CASES_CARD_TITLE: string = translationKey("Risk Cases");

export const RISK_CASES_CARD_DESCRIPTION: string = translationKey(
  "When what was found about one user, host or address adds up to the threshold, a case opens about it - or the open case about it takes the risk in.",
);

export const RISK_CASES_SWITCH_TITLE: string = translationKey(
  "Open a case when an entity's risk reaches the threshold",
);

export const RISK_CASES_SWITCH_ON: string = translationKey(
  "An entity that reaches the threshold opens a case, at High, or Critical from twice the threshold.",
);

export const RISK_CASES_SWITCH_OFF: string = translationKey(
  "Risk is still scored and listed under Entity Risk. No case opens from it.",
);

export const RISK_THRESHOLD_CARD_TITLE: string =
  translationKey("Risk Threshold");

export const RISK_THRESHOLD_CARD_DESCRIPTION: string = translationKey(
  "The risk at which a case opens and an entity reads High. Medium starts at half of it, and Critical at twice it.",
);

export const RISK_THRESHOLD_FIELD_TITLE: string =
  translationKey("Open a Case At");

export const RISK_THRESHOLD_FIELD_DESCRIPTION: string = translationKey(
  "A whole number from 10 to 10000. 100 is two different High findings, or a High and two Medium, about the same entity in a week.",
);

export const CRITICALITY_TABLE_TITLE: string =
  translationKey("Entity Criticality");

export const CRITICALITY_TABLE_DESCRIPTION: string = translationKey(
  "How much a user, host or address matters. The risk of one marked High counts one and a half times, Extreme twice, and Low half.",
);

export const CRITICALITY_TABLE_EMPTY: string = translationKey(
  "Every entity counts the same. Add the ones that matter more, such as domain controllers and executives, or less, such as test machines.",
);

export const CRITICALITY_SINGULAR: string = translationKey("Entry");
export const CRITICALITY_PLURAL: string = translationKey("Entries");

export const CRITICALITY_VALUE_DESCRIPTION: string = translationKey(
  "The user's sign-in name, the host's name or the address, whatever its case. Use * for any run of characters: dc-* names every domain controller.",
);

export const CRITICALITY_TYPE_DESCRIPTION: string = translationKey(
  "Optional. The kind of entity it is for. Empty is any kind.",
);

export const CRITICALITY_LEVEL_DESCRIPTION: string = translationKey(
  "How much it matters: Low counts its risk half, High one and a half times, Extreme twice.",
);

export const CRITICALITY_DESCRIPTION_DESCRIPTION: string = translationKey(
  "Optional. Why it matters this much.",
);

export const ANY_ENTITY_TYPE: string = translationKey("Any");

// The words beside each criticality, in the table and the form's choices.
export const CRITICALITY_WEIGHT_LABELS: {
  Low: string;
  High: string;
  Extreme: string;
} = {
  Low: translationKey("Low (×0.5)"),
  High: translationKey("High (×1.5)"),
  Extreme: translationKey("Extreme (×2)"),
};

// ---------- A detection rule's Risk Points ----------

export const RISK_POINTS_FIELD_TITLE: string = translationKey("Risk Points");

export const RISK_POINTS_FIELD_DESCRIPTION: string = translationKey(
  "What a match adds to the risk of the user, host or address it is about, from 0 to 100. Empty: by the rule's level - Low 10, Medium 25, High 50, Critical 75.",
);

// ---------- A case's Entities ----------

export const CASE_ENTITY_RISK_COLUMN_TITLE: string = translationKey("Risk");

export const CASE_ENTITY_RISK_TOOLTIP: string = translationKey(
  "Its risk from everything found about it in the last 7 days - open its page",
);

// ---------- The test ids ----------

export const ENTITY_RISK_TEST_IDS: {
  table: string;
  score: string;
  meter: string;
  levelPill: string;
  criticalityPill: string;
  entityHeader: string;
  sources: string;
  history: string;
  cases: string;
  activity: string;
  reset: string;
  notNamed: string;
  riskCasesSwitch: string;
  thresholdCard: string;
  criticalityTable: string;
  caseEntityRisk: string;
} = {
  table: "entity-risk-table",
  score: "entity-risk-score",
  meter: "entity-risk-meter",
  levelPill: "entity-risk-level",
  criticalityPill: "entity-risk-criticality",
  entityHeader: "entity-risk-header",
  sources: "entity-risk-sources",
  history: "entity-risk-history",
  cases: "entity-risk-cases",
  activity: "entity-risk-activity",
  reset: "entity-risk-reset",
  notNamed: "entity-risk-not-named",
  riskCasesSwitch: "security-risk-cases",
  thresholdCard: "security-risk-threshold",
  criticalityTable: "security-entity-criticality-table",
  caseEntityRisk: "security-case-entity-risk",
};
