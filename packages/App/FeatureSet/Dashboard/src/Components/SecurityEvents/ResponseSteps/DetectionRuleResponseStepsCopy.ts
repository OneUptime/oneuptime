import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of a detection rule's own response steps (#9621): the field on
 * the rule's form that edits them, and the list a library rule's details
 * show them in. Each is an en.json key, looked up where it is drawn; a
 * step's words are drawn as their author wrote them. The parts of the plan
 * a step goes under are the Response Plan's own (RESPONSE_PHASE_TITLES), so
 * a step is filed under the words the case shows it under.
 *
 * React-free, so the words and the test ids are pinned in a plain test.
 */

export const RESPONSE_STEPS_TITLE: string = translationKey("Response Steps");

export const RESPONSE_STEPS_DESCRIPTION: string = translationKey(
  "What to do when this rule opens a case. Each step is shown in the case's Response Plan under the part you pick, ahead of the general steps, and is ticked off like any other.",
);

// While the rule has none of its own and its library rule comes with some.
export const RESPONSE_STEPS_FROM_LIBRARY: string = translationKey(
  "These steps come with this rule in the rule library. Change any of them and they become this rule's own.",
);

export const RESPONSE_STEPS_EMPTY: string = translationKey(
  "No response steps. A case this rule opens shows the general steps.",
);

export const RESPONSE_STEP_ADD: string = translationKey("Add Step");

export const RESPONSE_STEPS_FULL: PluralTemplate = {
  one: "A rule can carry at most {{count}} response step.",
  other: "A rule can carry at most {{count}} response steps.",
};

// Each row's controls, named by the step's number.
export const RESPONSE_STEP_PART_LABEL: string = translationKey(
  "Part of the plan for step {{number}}",
);
export const RESPONSE_STEP_TEXT_LABEL: string = translationKey(
  "What to do in step {{number}}",
);
export const RESPONSE_STEP_REMOVE_LABEL: string = translationKey(
  "Remove step {{number}}",
);
export const RESPONSE_STEP_REMOVE: string = translationKey("Remove step");
export const RESPONSE_STEP_PLACEHOLDER: string = translationKey(
  "e.g. Page the payments on-call",
);

// A library rule's details: what it says to do when it fires.
export const RESPONSE_STEPS_LIBRARY_NOTE: string = translationKey(
  "Shown in the Response Plan of each case this rule opens. Change them on the rule's form once it is added.",
);

export const DETECTION_RULE_RESPONSE_STEPS_TEST_IDS: {
  field: string;
  fromLibrary: string;
  empty: string;
  row: string;
  part: string;
  text: string;
  remove: string;
  add: string;
  list: string;
  listPart: string;
} = {
  field: "detection-rule-response-steps",
  fromLibrary: "detection-rule-response-steps-from-library",
  empty: "detection-rule-response-steps-empty",
  row: "detection-rule-response-step",
  part: "detection-rule-response-step-part",
  text: "detection-rule-response-step-text",
  remove: "detection-rule-response-step-remove",
  add: "detection-rule-response-step-add",
  list: "detection-rule-response-steps-list",
  listPart: "detection-rule-response-steps-list-part",
};
