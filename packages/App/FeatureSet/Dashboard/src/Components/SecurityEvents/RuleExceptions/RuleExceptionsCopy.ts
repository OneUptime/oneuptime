import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of detection rule exceptions in the Dashboard: Security Events
 * > Detections > Rule Exceptions, the Add Exception dialog a rule's row and
 * a case's detection open, and the line under a rule's name. Each is an
 * en.json key, looked up where it is drawn. What is wrong with an exception
 * is the shared rules' own words (getDetectionRuleExceptionProblems in
 * Common/Types/SecurityEvent/DetectionRuleException), keys too.
 *
 * "Rule Exception", never a bare "Exception": that word is already the
 * Exceptions product's (an error a service threw), and some languages say
 * the two differently.
 *
 * React-free, so the words are pinned in a plain test beside the rules they
 * talk about.
 */

// ---------- Security Events > Rule Exceptions ----------

export const RULE_EXCEPTIONS_TABLE_TITLE: string =
  translationKey("Rule Exceptions");

export const RULE_EXCEPTIONS_TABLE_DESCRIPTION: string = translationKey(
  "What your detection rules skip: an entity, a value or a time window, each with who added it, why and until when.",
);

export const RULE_EXCEPTIONS_EMPTY_TITLE: string = translationKey(
  "No rule skips anything yet",
);

export const RULE_EXCEPTIONS_EMPTY_DESCRIPTION: string = translationKey(
  "When a rule fires on something you expect, such as a scanner, a backup job or a planned test, add an exception here or from the detection on its case.",
);

// One row of the list: "Add Rule Exception", "Showing 1-3 of 3 rule exceptions".
export const RULE_EXCEPTION_SINGULAR: string = translationKey("Rule Exception");
export const RULE_EXCEPTION_PLURAL: string = translationKey("Rule Exceptions");

// The list's columns.
export const SKIPS_COLUMN_TITLE: string = translationKey("Skips");
export const RULE_COLUMN_TITLE: string = translationKey("Rule");
export const REASON_COLUMN_TITLE: string = translationKey("Reason");
export const STATUS_COLUMN_TITLE: string = translationKey("Status");
export const ADDED_BY_COLUMN_TITLE: string = translationKey("Added By");

// What each row says under the thing it skips.
export const ADDRESS_RANGE_LABEL: string = translationKey("IP address range");
export const VALUE_IN_FIELD: string = translationKey("Value of {{field}}");
export const TIME_WINDOW_LABEL: string = translationKey("Time window");
export const TIME_WINDOW_RANGE: string = translationKey("{{from}} to {{until}}");

// Under the status pill: until when, or since when.
export const STATUS_UNTIL: string = translationKey("Until {{time}}");
export const STATUS_NO_EXPIRY: string = translationKey("No expiry");
export const STATUS_EXPIRED_AT: string = translationKey("Expired {{time}}");
export const STATUS_STARTS_AT: string = translationKey("Starts {{time}}");
export const STATUS_ENDS_AT: string = translationKey("Ends {{time}}");
export const STATUS_ENDED_AT: string = translationKey("Ended {{time}}");

// Who added it, and when; nobody when an API key or a workflow did.
export const ADDED_BY_NOBODY: string = translationKey("Added through the API");
export const ADDED_AT: string = translationKey("Added {{time}}");

// The rule a row belongs to, when it was deleted under it (a stale read).
export const RULE_NOT_FOUND: string = translationKey("Rule not found");

// ---------- The form: Add Exception / Edit ----------

export const ADD_EXCEPTION_TITLE: string = translationKey("Add Exception");

export const STEP_WHAT_TO_SKIP: string = translationKey("What to Skip");
export const STEP_WHY: string = translationKey("Why");

export const RULE_FIELD_TITLE: string = translationKey("Detection Rule");
export const RULE_FIELD_DESCRIPTION: string = translationKey(
  "The rule that skips it. Its other matches still fire.",
);

export const RULE_FIELD_PLACEHOLDER: string = translationKey(
  "Choose a detection rule",
);

export const KIND_FIELD_TITLE: string = translationKey("What the rule skips");

export const KIND_ENTITY_TITLE: string = translationKey("An entity");
export const KIND_ENTITY_DESCRIPTION: string = translationKey(
  "A user, host or IP address, wherever an event names it.",
);
export const KIND_VALUE_TITLE: string = translationKey("A value");
export const KIND_VALUE_DESCRIPTION: string = translationKey(
  "One event field's value, such as the process backup.exe.",
);
export const KIND_WINDOW_TITLE: string = translationKey("A time window");
export const KIND_WINDOW_DESCRIPTION: string = translationKey(
  "Every event between two times, such as during a planned test.",
);

export const ENTITY_TYPE_FIELD_TITLE: string = translationKey("Entity Type");

export const FIELD_NAME_FIELD_TITLE: string = translationKey("Field");
export const FIELD_NAME_FIELD_DESCRIPTION: string = translationKey(
  "The event field, named as in a Sigma rule: processName, principalUser, or an attribute key such as http.user_agent.",
);
export const FIELD_NAME_FIELD_PLACEHOLDER: string =
  translationKey("e.g. processName");

export const VALUE_FIELD_TITLE: string = translationKey("Value");
export const VALUE_FIELD_DESCRIPTION: string = translationKey(
  "Matched whatever the case. * stands for any run of characters: svc-* skips every service account. An address can be a range, such as 10.20.0.0/16.",
);
export const VALUE_FIELD_PLACEHOLDER: string = translationKey(
  "e.g. svc-backup or backup.exe",
);

export const STARTS_AT_FIELD_TITLE: string = translationKey("From");
export const ENDS_AT_FIELD_TITLE: string = translationKey("Until");
export const ENDS_AT_FIELD_DESCRIPTION: string = translationKey(
  "When the rule sees events again: at most 30 days after it starts.",
);

export const REASON_FIELD_TITLE: string = translationKey("Reason");
export const REASON_FIELD_DESCRIPTION: string = translationKey(
  "Why it is safe for the rule to skip this. Everyone who reads the list sees it.",
);
export const REASON_FIELD_PLACEHOLDER: string = translationKey(
  "e.g. Our vulnerability scanner. It probes every host each night.",
);

export const EXPIRES_AT_FIELD_TITLE: string = translationKey("Expires");
export const EXPIRES_AT_FIELD_DESCRIPTION: string = translationKey(
  "After this, the rule sees it again. Empty: until someone deletes the exception.",
);

// ---------- Detection Rules: a rule's row ----------

export const ADD_EXCEPTION_ACTION: string = translationKey("Add Exception");
export const VIEW_EXCEPTIONS_ACTION: string = translationKey("View Exceptions");

// Under a rule's name: how many of its exceptions skip something now.
export const ACTIVE_EXCEPTION_COUNT: PluralTemplate = {
  one: "{{count}} exception",
  other: "{{count}} exceptions",
};

// ---------- A case's detection ----------

export const ADD_EXCEPTION_FROM_DETECTION_DESCRIPTION: string = translationKey(
  "Stop this rule from firing on what you expect. Its other matches still fire.",
);

// ---------- Test ids ----------

export const RULE_EXCEPTIONS_TEST_IDS: Readonly<{
  table: string;
  skipsCell: string;
  statusCell: string;
  addedByCell: string;
  ruleCount: string;
  kindChoice: string;
}> = {
  table: "rule-exceptions-table",
  skipsCell: "rule-exception-skips",
  statusCell: "rule-exception-status",
  addedByCell: "rule-exception-added-by",
  ruleCount: "detection-rule-exception-count",
  kindChoice: "rule-exception-kind",
};
