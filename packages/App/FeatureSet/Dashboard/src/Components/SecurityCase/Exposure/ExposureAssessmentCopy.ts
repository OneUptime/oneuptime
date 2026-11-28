import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF A CASE'S EXPOSURE ASSESSMENT (#10377): the Was It a Breach?
 * card and the Breach Notices card on a security case's Overview. English
 * constants, looked up where they are drawn, in the reader's language. The
 * laws' own words (what each asks, of whom, what a person still checks)
 * are the table's (Common/Types/DataSecurity/BreachLaws), and the kinds of
 * fact a draft rests on the compliance facts' (ComplianceDraftsCopy).
 */

/*
 * The Was It a Breach? card's place on the case's Overview (Card's id,
 * Utils/PageAnchor): a link that names it after its "#" - each checklist
 * task's answer on the Tasks page - lands on the card.
 */
export const EXPOSURE_CARD_PLACE: string = "was-it-a-breach";

export const EXPOSURE_TEST_IDS: {
  card: string;
  notAssessed: string;
  assess: string;
  storePicker: string;
  notLegalAdvice: string;
  headline: string;
  dueState: string;
  reads: string;
  window: string;
  whose: string;
  secrets: string;
  laws: string;
  law: string;
  moreLaws: string;
  uncovered: string;
  places: string;
  placeChoice: string;
  savePlaces: string;
  checklist: string;
  notices: string;
  draft: string;
  part: string;
  partToggle: string;
  taskAnswer: string;
  readLogs: string;
  placeStates: string;
  stateLaws: string;
  statesNotApplying: string;
  dataHolder: string;
} = {
  card: "security-case-exposure-assessment",
  notAssessed: "security-case-exposure-not-assessed",
  assess: "security-case-exposure-assess",
  storePicker: "security-case-exposure-store",
  notLegalAdvice: "security-case-exposure-not-legal-advice",
  headline: "security-case-exposure-headline",
  dueState: "security-case-exposure-due-state",
  reads: "security-case-exposure-reads",
  window: "security-case-exposure-window",
  whose: "security-case-exposure-whose",
  secrets: "security-case-exposure-secrets",
  laws: "security-case-exposure-laws",
  law: "security-case-exposure-law",
  moreLaws: "security-case-exposure-more-laws",
  uncovered: "security-case-exposure-uncovered",
  places: "security-case-exposure-places",
  placeChoice: "security-case-exposure-place",
  savePlaces: "security-case-exposure-save-places",
  checklist: "security-case-exposure-checklist",
  notices: "security-case-exposure-notices",
  draft: "security-case-exposure-draft",
  part: "security-case-exposure-part",
  partToggle: "security-case-exposure-part-toggle",
  // A checklist task's answer, under the task on the case's Tasks page (#10954).
  taskAnswer: "security-case-task-exposure-answer",
  // Read the Access Logs, on the reads line (#10951).
  readLogs: "security-case-exposure-read-logs",
  // The US states picker, and the states' laws drawn together (#10952).
  placeStates: "security-case-exposure-place-states",
  stateLaws: "security-case-exposure-state-laws",
  statesNotApplying: "security-case-exposure-states-not-applying",
  dataHolder: "security-case-exposure-data-holder",
};

// The card.
export const WAS_IT_A_BREACH: string = translationKey("Was It a Breach?");
export const WAS_IT_A_BREACH_DESCRIPTION: string = translationKey(
  "How long the store was open, who could read it, whose data it was and which breach laws may apply, from what OneUptime recorded.",
);
export const NOT_LEGAL_ADVICE: string = translationKey(
  "Not legal advice. OneUptime works this out from what it recorded and its table of breach laws: have it checked by whoever answers for your compliance. Nothing is sent from here.",
);

// A case not assessed yet.
export const NOT_ASSESSED_TITLE: string = translationKey("Not assessed yet");
export const NOT_ASSESSED_DESCRIPTION: string = translationKey(
  "Work out how long the store was open, who could read it, whose data it was and which breach laws may apply. Nothing is sent.",
);
export const NOT_ASSESSED_READ_ONLY: string = translationKey(
  "Someone who can edit this case can assess it.",
);
export const ASSESS_EXPOSURE: string = translationKey("Assess This Exposure");
export const STORE_TO_ASSESS: string = translationKey("Store to Assess");
export const ASSESSED_TOAST: string = translationKey("Exposure assessed.");

// What is due first.
export const DUE_FIRST: string = translationKey("Due first");
export const LAW_AND_PROVISION: string = translationKey(
  "{{law}} {{provision}}",
);
export const DUE_ON: string = translationKey("Due {{date}}");
export const DUE_ON_AT_THE_LATEST: string = translationKey(
  "Due {{date}} at the latest",
);
export const OVERDUE_BY: string = translationKey("Overdue by {{time}}");
export const DUE_IN: string = translationKey("Due in {{time}}");
export const COUNTED_FROM: string = translationKey(
  "Counted from when Data Security found it: {{date}}.",
);
export const NOTHING_DUE_TITLE: string = translationKey(
  "No law in OneUptime's table asks for a notice",
);
export const NOTHING_DUE_DESCRIPTION: string = translationKey(
  "From what it holds and where its people live. Check the laws the table does not cover, below.",
);
export const WHERE_FIRST_TITLE: string = translationKey(
  "Where do the people live?",
);
export const WHERE_FIRST_DESCRIPTION: string = translationKey(
  "Which breach laws apply depends on it, and nothing in the data says. Pick every place where some of them live.",
);

// The deadline of a law, in its own units, and what it counts from.
export const WITHIN_HOURS: PluralTemplate = {
  one: "Within {{count}} hour of finding it",
  other: "Within {{count}} hours of finding it",
};
export const WITHIN_CALENDAR_DAYS: PluralTemplate = {
  one: "Within {{count}} calendar day of finding it",
  other: "Within {{count}} calendar days of finding it",
};
export const WITHIN_BUSINESS_DAYS: PluralTemplate = {
  one: "Within {{count}} business day of finding it",
  other: "Within {{count}} business days of finding it",
};
export const WITHIN_DAYS_OF_PEOPLE: PluralTemplate = {
  one: "Within {{count}} day of telling the people",
  other: "Within {{count}} days of telling the people",
};
// Iowa's notice to its attorney general (#10952).
export const WITHIN_BUSINESS_DAYS_OF_PEOPLE: PluralTemplate = {
  one: "Within {{count}} business day of telling the people",
  other: "Within {{count}} business days of telling the people",
};
export const WHEN_PEOPLE_TOLD: string = translationKey(
  "When the people are told",
);
export const WITHIN_DAYS_OF_YEAR_END: PluralTemplate = {
  one: "Within {{count}} day of the end of the year it was found in",
  other: "Within {{count}} days of the end of the year it was found in",
};
export const WITHOUT_UNDUE_DELAY: string = translationKey(
  "Without undue delay",
);
// Most US states' words: "in the most expedient time possible and without unreasonable delay".
export const WITHOUT_UNREASONABLE_DELAY: string = translationKey(
  "As soon as possible, without unreasonable delay",
);
export const NO_FIXED_TIME: string = translationKey("No fixed deadline");
// The notices to the data's owner (#11427): "immediately following discovery", "as soon as practicable".
export const IMMEDIATELY: string = translationKey("Immediately");
export const AS_SOON_AS_PRACTICABLE: string = translationKey(
  "As soon as practicable",
);

// Who read it.
export const READS_NOT_LOGGED: string = translationKey(
  "Reads were not logged. Treat the data as read.",
);
export const READS_UNKNOWN: string = translationKey(
  "Whether reads were logged is not known. Treat the data as read until someone checks.",
);
export const READS_LOGGED: string = translationKey(
  "Reads were logged. The store's access logs say who read it.",
);

// What the store's own access logs say, once OneUptime read them (#10951).
export const LOGS_FROM_OUTSIDE: PluralTemplate = {
  one: "OneUptime read the store's access logs for this window: {{count}} read from outside your accounts.",
  other:
    "OneUptime read the store's access logs for this window: {{count}} reads from outside your accounts.",
};
export const LOGS_NONE_FROM_OUTSIDE: string = translationKey(
  "OneUptime read the store's access logs for this window: no read from outside your accounts.",
);
export const LOGS_NONE_SO_FAR: string = translationKey(
  "OneUptime read part of the store's access logs for this window: no read from outside your accounts so far.",
);
// Who made the reads from outside, each "{{reads}} by ...": counted by its own plural.
export const LOGS_BY_ANYONE: PluralTemplate = {
  one: "{{reads}} by anyone on the internet, from {{count}} address",
  other: "{{reads}} by anyone on the internet, from {{count}} addresses",
};
export const LOGS_BY_ACCOUNTS: PluralTemplate = {
  one: "{{reads}} by {{count}} account outside your company",
  other: "{{reads}} by {{count}} accounts outside your company",
};
export const LOGS_BY_UNPLACED: string = translationKey(
  "{{reads}} by requesters OneUptime cannot place",
);
export const LOGS_OBJECTS_SENT: PluralTemplate = {
  one: "{{count}} object read, {{size}} sent.",
  other: "{{count}} objects read, {{size}} sent.",
};
export const LOGS_LISTINGS: PluralTemplate = {
  one: "{{count}} listing of its objects from outside, which names them without sending them.",
  other:
    "{{count}} listings of its objects from outside, which name them without sending them.",
};
export const LOGS_FILES_READ: PluralTemplate = {
  one: "It read {{count}} log file of the window.",
  other: "It read {{count}} log files of the window.",
};
export const LOGS_PART_READ: PluralTemplate = {
  one: "It read {{count}} log file, to {{date}}, within the time a read takes: the counts are those so far.",
  other:
    "It read {{count}} log files, to {{date}}, within the time a read takes: the counts are those so far.",
};
export const LOGS_BEST_EFFORT: string = translationKey(
  "S3 delivers its access logs on a best effort basis, so a person still checks.",
);
export const LOGS_OLDER_WINDOW: string = translationKey(
  "Read {{date}}, for the window as it was then. Read them again for the window as it is now.",
);
export const LOGS_NO_CONTENT_ACCESS: string = translationKey(
  "OneUptime cannot read these logs: the store's cloud connection may not read objects. Give it content access in its data security settings, or read the logs where they are.",
);
export const LOGS_LOGGING_OFF: string = translationKey(
  "The store logs no reads now, so OneUptime found no logs to read.",
);
export const LOGS_UNREADABLE: string = translationKey(
  "OneUptime could not read the bucket the logs are written to, {{location}}.",
);
export const LOGS_UNREADABLE_SOMEWHERE: string = translationKey(
  "OneUptime could not read the bucket the logs are written to.",
);
export const LOGS_NOT_SUPPORTED: string = translationKey(
  "OneUptime reads an S3 bucket's access logs. This store's are for you to read where they are.",
);
export const READ_ACCESS_LOGS: string = translationKey("Read the Access Logs");
export const READ_LOGS_AGAIN: string = translationKey("Read the Logs Again");
export const LOGS_READ_TOAST: string = translationKey(
  "The store's access logs were read.",
);
export const WHO_READ_FROM_OUTSIDE: string = translationKey(
  "Who Read It From Outside",
);
export const LOGS_PRINCIPAL_LINE: PluralTemplate = {
  one: "{{count}} read, {{size}}, from {{first}} to {{last}}",
  other: "{{count}} reads, {{size}}, from {{first}} to {{last}}",
};
export const ANYONE_COULD_READ: string = translationKey(
  "Anyone on the internet could read it.",
);
export const OUTSIDE_ACCOUNTS: PluralTemplate = {
  one: "{{count}} account outside your company could read it.",
  other: "{{count}} accounts outside your company could read it.",
};
export const OUTSIDE_ACCOUNTS_USED: PluralTemplate = {
  one: "{{count}} of them used its access while the store was open.",
  other: "{{count}} of them used their access while the store was open.",
};

// How long it was open.
export const HOW_LONG: string = translationKey("How Long It Was Open");
export const OPEN_DAYS: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};
export const OPEN_HOURS: PluralTemplate = {
  one: "{{count}} hour",
  other: "{{count}} hours",
};
export const LESS_THAN_AN_HOUR: string = translationKey("Less than an hour");
export const STILL_OPEN: string = translationKey("Still open");
export const SINCE_FOUND: string = translationKey(
  "At least since {{date}}, when Data Security found it",
);
export const SINCE_CHANGE: string = translationKey(
  "Since {{date}}, when the cloud's log recorded {{operation}}",
);
export const UNTIL_RESPONSE: string = translationKey(
  "Until {{date}}, when Data Security's response closed it",
);
export const UNTIL_SCAN: string = translationKey(
  "Until {{date}} at the latest, when a check found it closed",
);
export const UNTIL_CHANGE: string = translationKey(
  "Until {{date}}, when the cloud's log recorded {{operation}}",
);
export const UNTIL_CLOSED_BY_CHANGE: string = translationKey(
  "Until {{date}}, when a change in the cloud closed it",
);
export const OPEN_UNTIL_NOW: string = translationKey("And it is open now");
export const EARLIER_PERIODS: PluralTemplate = {
  one: "It was open {{count}} time before this too.",
  other: "It was open {{count}} times before this too.",
};
export const NO_WINDOW: string = translationKey(
  "No exposure issue of the store says when it was open.",
);

// Whose data it was.
export const WHOSE_DATA: string = translationKey("Whose Data");
export const ABOUT_RECORDS: PluralTemplate = {
  one: "About {{count}} record",
  other: "About {{count}} records",
};
export const PEOPLE_IN: string = translationKey(
  "People in {{places}}, as the data shows",
);
export const PEOPLE_SAID_IN: string = translationKey(
  "People in {{places}}, as a person said",
);
export const PEOPLE_ARE: string = translationKey("About {{people}}");
export const INCLUDES_CHILDREN: string = translationKey(
  "It is about children too.",
);
export const SPECIAL_CATEGORIES: string = translationKey(
  "Special category data: {{categories}}",
);
export const NOTHING_FOUND_IN_IT: string = translationKey(
  "No sensitive data was found in it.",
);

// The secrets to rotate.
export const SECRETS_TO_ROTATE: string = translationKey("Secrets to Rotate");
export const SECRET_STILL_THERE: string = translationKey("Still there");
export const SECRET_REMOVED: string = translationKey("Removed since");
export const NO_SECRETS: string = translationKey(
  "No secrets or keys were found in the store.",
);
export const MORE_SECRETS: string = translationKey(
  "And more: the store's Sensitive Data lists every one.",
);
export const SECRETS_COUNT: PluralTemplate = {
  one: "{{count}} secret",
  other: "{{count}} secrets",
};

// The laws.
export const BREACH_LAWS: string = translationKey("Breach Laws");
export const MAY_APPLY: string = translationKey("May apply");
export const NOT_YET_IN_FORCE: string = translationKey("Not yet in force");
export const DOES_NOT_APPLY: string = translationKey("Does not apply");
export const IF_PEOPLE_LIVE_ELSEWHERE: string = translationKey(
  "If any of the people live elsewhere",
);
export const SHOW_MORE_LAWS: PluralTemplate = {
  one: "Show {{count}} more law",
  other: "Show {{count}} more laws",
};
export const SHOW_FEWER_LAWS: string = translationKey("Show fewer laws");
// The US states' laws, drawn together while nobody said which states (#10952).
export const US_STATE_LAWS: string = translationKey("US state laws");
export const US_STATE_LAWS_MAY_APPLY: PluralTemplate = {
  one: "The breach law of {{count}} US state may apply if any of the people live there.",
  other:
    "The breach laws of {{count}} US states may apply if any of the people live there.",
};
export const US_STATE_LAWS_SAY_WHICH: string = translationKey(
  "Say which states they live in, and only those states' laws stay.",
);
export const SHOW_STATE_LAWS: string = translationKey("Show the states' laws");
export const HIDE_STATE_LAWS: string = translationKey("Hide the states' laws");
export const STATES_NOT_APPLYING: PluralTemplate = {
  one: "The breach law of {{count}} more US state does not apply on these facts.",
  other:
    "The breach laws of {{count}} more US states do not apply on these facts.",
};
export const SHOW_DETAILS: string = translationKey("Show details");
export const HIDE_DETAILS: string = translationKey("Hide details");
export const WHO_IS_TOLD: string = translationKey("Who is told");
export const WHAT_TO_CHECK: string = translationKey("What a person checks");
export const WHY_NOT: string = translationKey("Why not");
export const SOURCE_CHECKED: string = translationKey("Checked {{date}}");
export const IN_FORCE_FROM: string = translationKey("In force from {{date}}.");
// A newer text of a law that took effect after the exposure was found (#11425).
export const IN_FORCE_AFTER_FOUND: string = translationKey(
  "It took effect on {{date}}, after the exposure was found: the text in force when it was found applies.",
);
export const IF_PEOPLE_LIVE_IN: string = translationKey(
  "If any of the people live in {{places}}.",
);
export const IF_MORE_THAN_PEOPLE: PluralTemplate = {
  one: "If it affects more than {{count}} person.",
  other: "If it affects more than {{count}} people.",
};
export const IF_AT_LEAST_PEOPLE: PluralTemplate = {
  one: "If it affects {{count}} or more people.",
  other: "If it affects {{count}} or more people.",
};
export const IF_FEWER_PEOPLE: PluralTemplate = {
  one: "If it affects fewer than {{count}} person.",
  other: "If it affects fewer than {{count}} people.",
};
export const IF_HELD_WITH_NAMES: string = translationKey(
  "If the numbers were held with people's names: no names were found, but a scan can miss them.",
);
export const IF_READ_FROM_OUTSIDE: string = translationKey(
  "If the store's access logs show the data was read from outside your accounts.",
);
export const REASON_PEOPLE_ELSEWHERE: string = translationKey(
  "A person said the people live elsewhere.",
);
export const REASON_HOLDS_NONE: string = translationKey(
  "The store held none of the data this law covers.",
);
export const REASON_NO_PERSONAL_DATA: string = translationKey(
  "The store held no personal data.",
);
export const REASON_NOT_ENOUGH_PEOPLE: string = translationKey(
  "Too few people for this notice, by the records counted.",
);
export const NOT_COVERED: string = translationKey(
  "What OneUptime's table does not cover",
);

// Where the people live.
export const WHERE_PEOPLE_LIVE: string = translationKey(
  "Where the People Live",
);
export const PLACES_FROM_DATA: string = translationKey(
  "The data shows people in {{places}}. Add every other place where some of them live.",
);
export const PLACES_SAID: string = translationKey(
  "{{name}} said the people live in {{places}}.",
);
export const PLACES_SAID_BY_SOMEONE: string = translationKey(
  "Someone said the people live in {{places}}.",
);
/*
 * The US states, the District of Columbia, Puerto Rico, Guam and the US
 * Virgin Islands, picked from a list of their own (#10952, #11426).
 */
export const US_STATES: string = translationKey("US states");
export const SEARCH_US_STATES: string = translationKey("Search for a state");
export const US_STATES_HINT: string = translationKey(
  "Pick each state some of them live in, the District of Columbia, Puerto Rico, Guam and the US Virgin Islands too: each has its own breach law.",
);
export const STATE_NOT_IN_TABLE: string = translationKey(
  "Its breach law is not in OneUptime's table",
);
export const CHANGE_PLACES: string = translationKey("Change Places");
export const SAVE_PLACES: string = translationKey("Save Places");
export const CANCEL: string = translationKey("Cancel");
export const PLACES_SAVED: string = translationKey("Places saved.");

/*
 * Whether the organization holds the data for another organization (#11427):
 * a switch, kept with who said it, as where the people live is.
 */
export const DATA_OWNER_HEADING: string = translationKey("The Data's Owner");
export const HOLDS_FOR_ANOTHER: string = translationKey(
  "We hold this data for another organization",
);
export const HOLDS_FOR_ANOTHER_DESCRIPTION: string = translationKey(
  "On, the notices the law asks a vendor or service provider to send the data's owner are added.",
);
export const HELD_FOR_ANOTHER_SAID: string = translationKey(
  "{{name}} said your organization holds this data for another organization.",
);
export const HELD_FOR_ANOTHER_SAID_BY_SOMEONE: string = translationKey(
  "Someone said your organization holds this data for another organization.",
);
export const OWN_DATA_SAID: string = translationKey(
  "{{name}} said this data is your organization's own.",
);
export const OWN_DATA_SAID_BY_SOMEONE: string = translationKey(
  "Someone said this data is your organization's own.",
);
export const DATA_OWNER_SAVED: string = translationKey("Answer saved.");
export const DATA_OWNER_READ_ONLY: string = translationKey(
  "Someone who can edit this case can change this.",
);

// The case's checklist, answered.
export const CHECKLIST: string = translationKey("The Case's Checklist");
export const OPEN_TASKS: string = translationKey("Open Tasks");
export const TASK_DONE: string = translationKey("Done");
export const TASK_TO_DO: string = translationKey("To do");
export const NO_TASK: string = translationKey("No task on the case");
export const CHECK_WHO_READ: string = translationKey("Find who read the data");
export const CHECK_REPORT: string = translationKey(
  "Decide whether to report it",
);
export const CHECK_ROTATE: string = translationKey("Rotate the secrets");
export const CHECK_CLOSE: string = translationKey("Close the case");
export const ANSWER_LAW_DUE: string = translationKey(
  "{{law}} may apply first: {{due}}.",
);
export const ANSWER_LAWS: PluralTemplate = {
  one: "{{count}} breach law may apply.",
  other: "{{count}} breach laws may apply.",
};
export const ANSWER_NO_LAWS: string = translationKey(
  "No breach law in OneUptime's table asks for a notice.",
);
export const ANSWER_SAY_WHERE: string = translationKey(
  "Say where the people live to see which laws apply.",
);
export const ANSWER_SECRETS: PluralTemplate = {
  one: "{{count}} secret to rotate.",
  other: "{{count}} secrets to rotate.",
};
export const ANSWER_NO_SECRETS: string = translationKey(
  "No secrets were found in the store.",
);
export const ANSWER_SUMMARY_DRAFTED: string = translationKey(
  "The internal summary below says what was exposed, for how long and to whom.",
);
export const ANSWER_SUMMARY_TO_WRITE: string = translationKey(
  "Write the internal summary below, or have OneUptime AI draft it.",
);
// The same, under the task on the case's Tasks page, where the summary is not below (#10954).
export const ANSWER_SUMMARY_DRAFTED_ON_NOTICES: string = translationKey(
  "The internal summary in Breach Notices says what was exposed, for how long and to whom.",
);
export const ANSWER_SUMMARY_TO_WRITE_ON_NOTICES: string = translationKey(
  "Write the internal summary in Breach Notices, or have OneUptime AI draft it.",
);

// The notices.
export const BREACH_NOTICES: string = translationKey("Breach Notices");
export const BREACH_NOTICES_DESCRIPTION: string = translationKey(
  "The assessment written up for a person to review, edit and copy. Nothing is sent.",
);
export const DRAFT_WITH_AI: string = translationKey("Draft With OneUptime AI");
export const DRAFT_AGAIN: string = translationKey("Draft Again");
export const DRAFTED_TOAST: string = translationKey(
  "OneUptime AI drafted the write-up. Nothing was sent.",
);
export const DRAFT_NOT_LEGAL_ADVICE: string = translationKey(
  "A draft, not legal advice. Review it with whoever answers for your compliance before you send it yourself.",
);
export const AI_OFF: string = translationKey(
  "OneUptime AI is off for this project, so nothing is drafted: write each part yourself.",
);
export const NOT_WRITTEN: string = translationKey("Not written yet.");
export const SHOW_TEXT: string = translationKey("Show Text");
export const HIDE_TEXT: string = translationKey("Hide Text");
export const UNSAVED_NOTICES: string = translationKey(
  "Your edits to a notice are not saved yet.",
);
// Why Export PDF and Export Markdown wait while a part is edited (#10955).
export const EXPORT_WAITS_FOR_SAVE: string = translationKey(
  "Save or cancel your edit first: the export holds each part as it was last saved.",
);
