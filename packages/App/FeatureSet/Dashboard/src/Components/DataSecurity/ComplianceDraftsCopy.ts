import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF THE COMPLIANCE PAPERWORK (#10375): the record of
 * processing's drafts, Review Drafts, a store's impact assessment and a
 * framework's audit evidence. English constants, looked up where they are
 * drawn, in the reader's language.
 */

/*
 * Said once where drafts are: on the record, on Review Drafts, on an
 * assessment and on the evidence - plainly, never under each field.
 */
export const NOT_LEGAL_ADVICE: string = translationKey(
  "OneUptime AI drafts these from what the scans found. They are a starting point, not legal advice: have them checked by whoever answers for your compliance.",
);

// The record of processing's card.
export const REVIEW_DRAFTS: string = translationKey("Review Drafts");
export const STORES_TO_REVIEW: PluralTemplate = {
  one: "{{count}} store to review",
  other: "{{count}} stores to review",
};
export const STORES_COMPLETE: PluralTemplate = {
  one: "{{count}} complete",
  other: "{{count}} complete",
};
export const STORES_INCOMPLETE: PluralTemplate = {
  one: "{{count}} with empty fields",
  other: "{{count}} with empty fields",
};
export const DRAFTS_TURNED_OFF: string = translationKey(
  "OneUptime AI drafts a store's empty fields on its own while Work on new issues is on, under Data Security > AI.",
);
export const DRAFT_PILL: string = translationKey("Draft");
export const CHANGE_PILL: string = translationKey("Change proposed");
export const REVIEW: string = translationKey("Review");
export const RECIPIENTS: string = translationKey("Recipients");
export const TRANSFERS: string = translationKey("Transfers");
export const LEGAL_BASIS: string = translationKey("Legal Basis");
export const PEOPLE: string = translationKey("People It Is About");
export const IMPACT_ASSESSMENT: string = translationKey("Impact Assessment");
export const NEEDS_ONE: string = translationKey("Needs one");
export const ASSESSMENT_DRAFTED: string = translationKey("Drafted");
export const ASSESSMENT_EDITED: string = translationKey("Edited");

// Review Drafts.
export const REVIEW_DRAFTS_DESCRIPTION: string = translationKey(
  "Each store with a draft or a proposed change, one at a time. Confirm a draft as it is, or edit it into your own words.",
);
export const STORE_OF: string = translationKey("Store {{index}} of {{count}}");
export const PREVIOUS_STORE: string = translationKey("Previous Store");
export const NEXT_STORE: string = translationKey("Next Store");
export const OPEN_STORE: string = translationKey("Open Store");
export const NOTHING_TO_REVIEW_TITLE: string = translationKey(
  "Nothing left to review",
);
export const NOTHING_TO_REVIEW_DESCRIPTION: string = translationKey(
  "Every draft is confirmed or written in your own words. New drafts wait here as OneUptime AI writes them.",
);
export const BACK_TO_COMPLIANCE: string = translationKey("Back to Compliance");
export const NOT_IN_THE_RECORD: string = translationKey(
  "This data store holds no personal data, so it is not in the record of processing.",
);

// A store's record, field by field.
export const RECORD_CARD_TITLE: string = translationKey("Record of Processing");
export const RECORD_CARD_DESCRIPTION: string = translationKey(
  "What GDPR Article 30 asks of this store. OneUptime AI drafts what nobody wrote; nothing is in the record until you confirm it.",
);
export const CONFIRM: string = translationKey("Confirm");
export const EDIT: string = translationKey("Edit");
export const WRITE: string = translationKey("Write");
export const SAVE: string = translationKey("Save");
export const CANCEL: string = translationKey("Cancel");
export const USE_NEW_DRAFT: string = translationKey("Use New Draft");
export const KEEP_CURRENT: string = translationKey("Keep Current");
export const DRAFT_WITH_AI: string = translationKey("Draft with OneUptime AI");
export const DRAFT_AGAIN: string = translationKey("Draft Again");
export const WHY: string = translationKey("Why: {{reason}}");
export const NOT_WRITTEN_YET: string = translationKey("Not written yet.");
export const NOW_IN_THE_RECORD: string = translationKey("In the record now");
export const PROPOSED_CHANGE: string = translationKey("Proposed change");
export const WHAT_CHANGED: string = translationKey(
  "What changed since it was confirmed",
);
export const BEFORE: string = translationKey("Before");
export const NOW: string = translationKey("Now");
export const GONE: string = translationKey("No longer seen");
export const SHOW_FACTS: PluralTemplate = {
  one: "Show the {{count}} fact it rests on",
  other: "Show the {{count}} facts it rests on",
};
export const HIDE_FACTS: string = translationKey("Hide the facts");
export const DRAFTED_NOTHING: string = translationKey(
  "OneUptime AI drafted nothing new.",
);
export const DRAFTED_FIELDS: PluralTemplate = {
  one: "OneUptime AI drafted {{count}} field.",
  other: "OneUptime AI drafted {{count}} fields.",
};
export const SAVED: string = translationKey("Saved.");
export const CONFIRMED: string = translationKey("Confirmed.");
export const PURPOSE_PLACEHOLDER: string = translationKey(
  "Customer orders, for fulfilment and support",
);
export const RETENTION_PLACEHOLDER: string = translationKey(
  "Two years after an account is closed",
);
export const PICK_A_BASIS: string = translationKey("Pick a legal basis");
export const PICK_PEOPLE: string = translationKey("Pick who it is about");

// Recipients and transfers, worked out by plain code.
export const WORKED_OUT: string = translationKey(
  "Worked out from the store's flows and regions.",
);
export const NO_RECIPIENTS: string = translationKey(
  "No recipient outside your project is seen.",
);
export const NO_TRANSFERS: string = translationKey(
  "Its data stays in its people's countries.",
);
export const RECIPIENT_VIA: string = translationKey(
  "{{name}}, through {{services}}",
);
export const TRANSFER_LINE: string = translationKey("{{from}} to {{to}}");
export const TRANSFER_BY_REPLICATION: string = translationKey(
  "{{from}} to {{to}}, by replication",
);
export const TRANSFER_IN_COPY: string = translationKey(
  "{{from}} to {{to}}, in {{store}}",
);
export const LEAVES_EEA: string = translationKey("Leaves the EEA");
export const THE_EEA: string = translationKey("the European Economic Area");

// A store's impact assessment.
export const ASSESSMENT_TITLE: string = translationKey(
  "Data Protection Impact Assessment",
);
export const ASSESSMENT_DESCRIPTION: string = translationKey(
  "The assessment GDPR Article 35 asks for before processing likely to put people at high risk. Edit any part: a part you edit is never drafted again.",
);
export const WHY_IT_NEEDS_ONE: string = translationKey(
  "Why this store needs one",
);
export const NOT_NEEDED_TITLE: string = translationKey(
  "This store does not need an assessment",
);
export const NOT_NEEDED_DESCRIPTION: string = translationKey(
  "It holds no special category data, no data about many people, and none of its data leaves its people's countries.",
);
export const DRAFT_ASSESSMENT: string = translationKey("Draft the Assessment");
export const EXPORT_MARKDOWN: string = translationKey("Export Markdown");
export const EXPORT_PDF: string = translationKey("Export PDF");
export const DRAFTED_BY_AI_ON: string = translationKey(
  "Drafted by OneUptime AI {{time}}",
);
export const EDITED_BY_ON: string = translationKey(
  "Edited by {{name}} {{time}}",
);
export const EDITED_ON: string = translationKey("Edited {{time}}");
export const FACTS_CHANGED: string = translationKey(
  "The facts it rests on changed since it was written. Read it again, or draft it again.",
);
export const NO_ASSESSMENT_YET: string = translationKey(
  "No assessment yet. OneUptime AI drafts one from what the scans know, for you to edit.",
);
export const SPECIAL_CATEGORIES: string = translationKey(
  "It holds special category data: {{categories}}.",
);
export const MANY_PEOPLE: PluralTemplate = {
  one: "It holds data about many people: about {{count}} record.",
  other: "It holds data about many people: about {{count}} records.",
};
export const LEAVES_COUNTRIES: string = translationKey(
  "Its data leaves its people's countries: {{transfers}}.",
);
// What the leave question says is lost (LeaveWithoutSavingQuestion).
export const UNSAVED_ASSESSMENT: string = translationKey(
  "You have unsaved changes to this assessment. If you leave now, they will be lost.",
);
export const UNSAVED_EVIDENCE: string = translationKey(
  "You have unsaved changes to this evidence. If you leave now, they will be lost.",
);
export const UNSAVED_RECORD: string = translationKey(
  "You have unsaved changes to this store's record. If you leave now, they will be lost.",
);

// A framework's audit evidence.
export const AUDIT_EVIDENCE: string = translationKey("Audit Evidence");
export const EVIDENCE_TITLE: string = translationKey(
  "Audit Evidence: {{framework}}",
);
export const EVIDENCE_DESCRIPTION: string = translationKey(
  "What an auditor reads under each requirement, from Data Security's checks and issue history. Edit any paragraph: one you edit is never drafted again.",
);
export const FRAMEWORK: string = translationKey("Framework");
export const PERIOD: string = translationKey("Period");
export const LAST_DAYS: PluralTemplate = {
  one: "Last {{count}} day",
  other: "Last {{count}} days",
};
export const DRAFT_EVIDENCE: string = translationKey("Draft the Evidence");
export const NO_PARAGRAPH_YET: string = translationKey(
  "No paragraph yet: the facts below are its evidence.",
);
export const ISSUE_HISTORY: string = translationKey("Issue History");
export const ISSUE_HISTORY_DESCRIPTION: PluralTemplate = {
  one: "The {{count}} issue of its checks opened or fixed in the period, which the export lists.",
  other:
    "The {{count}} issues of its checks opened or fixed in the period, which the export lists.",
};
export const NO_ISSUE_HISTORY_TITLE: string = translationKey(
  "Nothing opened or fixed",
);
export const NO_ISSUE_HISTORY: string = translationKey(
  "No issue of its checks opened or was fixed in the period.",
);
export const OPENED: string = translationKey("Opened");
export const FIXED: string = translationKey("Fixed");
export const HOURS_TO_FIX: PluralTemplate = {
  one: "{{count}} hour",
  other: "{{count}} hours",
};
export const DAYS_TO_FIX: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};
export const REQUIREMENTS_FAILING: PluralTemplate = {
  one: "{{count}} requirement failing",
  other: "{{count}} requirements failing",
};
export const STORES_IN_SCOPE: PluralTemplate = {
  one: "{{count}} store in scope",
  other: "{{count}} stores in scope",
};
export const EVIDENCE_DRAFTED: string = translationKey(
  "OneUptime AI drafted the evidence.",
);
export const ASSESSMENT_DRAFTED_TOAST: string = translationKey(
  "OneUptime AI drafted the assessment.",
);

// The facts a draft rests on, kind by kind.
export const FACT_HOLDS: string = translationKey("Holds {{dataTypes}}");
export const FACT_RECORDS: PluralTemplate = {
  one: "About {{count}} record",
  other: "About {{count}} records",
};
export const FACT_STORE: string = translationKey("{{name}}, a {{kind}}");
export const FACT_KEPT_IN: string = translationKey("Kept in {{region}}");
export const FACT_KEPT_IN_COUNTRY: string = translationKey(
  "Kept in {{region}}, {{country}}",
);
export const FACT_REGION_UNKNOWN: string = translationKey(
  "Its region is not known.",
);
export const FACT_COPIED_TO: string = translationKey(
  "Its cloud copies it to {{regions}}",
);
export const FACT_PEOPLE_IN: string = translationKey(
  "Its data is about people in {{countries}}",
);
export const FACT_USED_BY: string = translationKey("Used by {{service}}");
export const FACT_CALLS: string = translationKey("{{service}} calls {{host}}");
export const FACT_SENDS_TO: string = translationKey(
  "{{service}} sends calls to {{provider}}",
);
export const FACT_SENT_TO: string = translationKey("Sent to {{provider}}");
export const FACT_HOLDS_COPY: string = translationKey(
  "{{store}} holds a copy of its data",
);
export const FACT_IS_COPY: string = translationKey(
  "It holds a copy of the data of {{store}}",
);
export const FACT_BACKED_UP: string = translationKey("Backed up");
export const FACT_NOT_BACKED_UP: string = translationKey("Not backed up");
export const FACT_BACKUPS_KEPT: PluralTemplate = {
  one: "Backups kept {{count}} day",
  other: "Backups kept {{count}} days",
};
export const FACT_PITR: string = translationKey("Point-in-time recovery on");
export const FACT_VERSIONING: string = translationKey("Versioning on");
export const FACT_SOFT_DELETE: string = translationKey("Soft delete on");
export const FACT_DELETION_PROTECTION: string = translationKey(
  "Deletion protection on",
);
export const FACT_KEEPS_FOR: PluralTemplate = {
  one: "OneUptime keeps its records {{count}} day",
  other: "OneUptime keeps its records {{count}} days",
};
export const FACT_SOME_UP_TO: PluralTemplate = {
  one: "some up to {{count}} day",
  other: "some up to {{count}} days",
};
export const FACT_DECLARED_IN: string = translationKey(
  "Declared in {{repository}}",
);
export const FACT_PUBLIC_BY_DESIGN: string = translationKey("Public by design");
export const FACT_ENCRYPTED: string = translationKey("Encrypted at rest");
export const FACT_NOT_ENCRYPTED: string = translationKey(
  "Not encrypted at rest",
);
export const FACT_OWN_KEY: string = translationKey(
  "With a customer-managed key",
);
export const FACT_IN_TRANSIT: string = translationKey(
  "Encryption in transit enforced",
);
export const FACT_NOT_IN_TRANSIT: string = translationKey(
  "Encryption in transit not enforced",
);
export const FACT_TLS: string = translationKey("TLS {{version}} or later");
export const FACT_IDENTITIES: PluralTemplate = {
  one: "{{count}} identity can reach it",
  other: "{{count}} identities can reach it",
};
export const FACT_PUBLIC_GRANTS: PluralTemplate = {
  one: "{{count}} public grant",
  other: "{{count}} public grants",
};
export const FACT_EXTERNAL_GRANTS: PluralTemplate = {
  one: "{{count}} outside your accounts",
  other: "{{count}} outside your accounts",
};
export const FACT_WRITE_GRANTS: PluralTemplate = {
  one: "{{count}} can write",
  other: "{{count}} can write",
};
export const FACT_SERVICES_SEEN: PluralTemplate = {
  one: "{{count}} service seen using it",
  other: "{{count}} services seen using it",
};
export const FACT_FIXED_WEEK: string = translationKey("Fixed in the last week");
export const FACT_FIXED_MONTH: string = translationKey(
  "Fixed in the last 30 days",
);
export const FACT_FIXED_QUARTER: string = translationKey(
  "Fixed in the last 90 days",
);
export const FACT_RECORD_SAYS: string = translationKey(
  "Its record says, for {{field}}:",
);
export const FACT_ALL_CHECKS_PASS: PluralTemplate = {
  one: "Its {{count}} check passes on every store in scope",
  other: "All {{count}} of its checks pass on every store in scope",
};
export const FACT_MET_BY_INVENTORY: string = translationKey(
  "Met by Data Security itself once every store in scope is read",
);
export const FACT_CHECKS_FAIL: string = translationKey(
  "{{failing}} of its {{checks}} checks fail on {{stores}}",
);
export const FACT_STORES: PluralTemplate = {
  one: "{{count}} store",
  other: "{{count}} stores",
};
export const FACT_OPEN_ISSUES: PluralTemplate = {
  one: "{{count}} open issue",
  other: "{{count}} open issues",
};
export const FACT_HISTORY: string = translationKey(
  "In the period: {{opened}} opened, {{fixed}} fixed, {{open}} still open",
);
export const FACT_MEDIAN_FIX: PluralTemplate = {
  one: "Fixed in {{count}} hour at the median",
  other: "Fixed in {{count}} hours at the median",
};
export const FACT_RISK_ON: string = translationKey(
  "Risk accepted on {{store}}",
);
export const FACT_UNTIL: string = translationKey("Until {{date}}");
export const FACT_NO_EXPIRY: string = translationKey("With no expiry");
export const FACT_TURNED_OFF_ON: string = translationKey(
  "Turned off on {{resource}}",
);
export const FACT_WHOLE_FRAMEWORK: string = translationKey(
  "For the whole framework",
);
