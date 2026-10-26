import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Incidents → AI → Settings → More settings → Postmortem rules: which
 * resolved incidents OneUptime AI drafts a postmortem for, and the templates
 * each draft follows. "Can you please create rules for these just like we
 * have investigation rules in more options? The rules can contain which
 * incidents can we draft a postmortem report for, and what templates can be
 * used?" - the maintainer.
 *
 * With no rule, every resolved incident gets a draft in OneUptime AI's
 * standard outline, as before rules existed. With rules, only an incident
 * one matches does, and the first rule that matches - from the top of the
 * list, which people drag into order - decides its templates: none (the
 * standard outline), one, or several for OneUptime AI to pick the best fit
 * (Common/Server/Utils/AI/SRE/PostmortemRules). "Draft a postmortem when an
 * incident resolves" stays the one way to turn drafting off.
 *
 * A rule asks what every incident rule asks, in the same order: what it
 * matches (the Match step's "All incidents" / "Only incidents that match
 * conditions"), then what it does - the Draft step: its templates, and its
 * name, filled in from them.
 *
 * Kept free of React, so App/Tests read these exact strings. Every sentence
 * is wrapped in translationKey() so npm run i18n:extract finds it.
 */

/*
 * The card, and what an empty one says. Two lines beside the card's title
 * at most (ShortDescriptionsGuard: 210 characters).
 */
export const POSTMORTEM_RULES_CARD_DESCRIPTION: string = translationKey(
  "With no rule, OneUptime AI drafts a postmortem for every resolved incident. Add rules to draft only for matching incidents, in the templates you choose. The first rule that matches decides - drag to reorder.",
);

/*
 * The same card on OneUptime Cloud for a project below the plan postmortem
 * templates need: there is no template to choose, so every rule drafts in
 * the standard outline and their order decides nothing.
 */
export const POSTMORTEM_RULES_CARD_DESCRIPTION_WITHOUT_TEMPLATES: string =
  translationKey(
    "With no rule, OneUptime AI drafts a postmortem for every resolved incident. Add rules to draft only for the incidents that match one of them.",
  );

export const POSTMORTEM_RULES_NO_ITEMS_MESSAGE: string = translationKey(
  "No rules. Every resolved incident gets a postmortem draft.",
);

// The form's two steps: what the rule matches, then how the draft is written.
export const POSTMORTEM_RULE_MATCH_STEP_ID: string = "match-criteria";
export const POSTMORTEM_RULE_DRAFT_STEP_ID: string = "postmortem-draft";

export const POSTMORTEM_RULE_DRAFT_STEP_TITLE: string = translationKey("Draft");

// The templates a draft may follow.
export const POSTMORTEM_RULE_TEMPLATES_TITLE: string =
  translationKey("Templates");

export const POSTMORTEM_RULE_TEMPLATES_DESCRIPTION: string = translationKey(
  "Leave empty for OneUptime AI's standard outline. With more than one, OneUptime AI picks the one that fits the incident best.",
);

/*
 * What an empty template list means, said where it is empty: the picker's
 * placeholder, and the table's Templates column.
 */
export const POSTMORTEM_RULE_STANDARD_OUTLINE: string =
  translationKey("Standard outline");

// The rule's name, filled in from its templates.
export const POSTMORTEM_RULE_NAME_DESCRIPTION: string = translationKey(
  "Named after its templates until you type a name of your own.",
);

export const POSTMORTEM_RULE_NAME_PLACEHOLDER: string = translationKey(
  "e.g. Draft with Database outage",
);

/*
 * "Draft with Database outage": a postmortem rule is named after the
 * templates it drafts with - as many as fit, then a count - and a rule that
 * names none after the standard outline. The same shape as the other rule
 * forms' wordings (Utils/Form/ResourceRuleForm RuleNameWording).
 */
export const POSTMORTEM_RULE_NAME_WORDING: {
  picksSlot: string;
  allPicks: string;
  somePicks: PluralTemplate;
} = {
  picksSlot: "templates",
  allPicks: translationKey("Draft with {{templates}}"),
  somePicks: {
    one: "Draft with {{templates}} and {{count}} more",
    other: "Draft with {{templates}} and {{count}} more",
  },
};

export const POSTMORTEM_RULE_STANDARD_OUTLINE_NAME: string = translationKey(
  "Draft with the standard outline",
);

// The table's columns that are the rule's own (the conditions draw theirs).
export const POSTMORTEM_RULE_TEMPLATES_COLUMN_TITLE: string =
  translationKey("Templates");

/*
 * After a rule's first three templates in the table, the button that shows
 * the rest: "2 more templates" (TableColumnListComponent's moreTemplate).
 */
export const POSTMORTEM_RULE_MORE_TEMPLATES: PluralTemplate = {
  one: "{{count}} more template",
  other: "{{count}} more templates",
};
