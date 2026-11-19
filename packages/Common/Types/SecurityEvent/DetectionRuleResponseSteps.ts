/*
 * A DETECTION RULE'S OWN RESPONSE STEPS (#9621).
 *
 * A security case's Response Plan says what to do about the case: confirm
 * it, contain it, fix what let it happen. It is built from what the case is
 * about, the ATT&CK tactics its detections map to and the project's
 * playbooks - sound, but general. The team that writes a rule knows what to
 * do when it fires: "Page the payments on-call", "Rotate the key in Vault",
 * "Check the admin audit log in the billing app". Those are the rule's
 * response steps (DetectionRule.responseSteps): a short list, each under
 * the part of the plan it belongs to, which every case the rule's
 * detections are on shows ahead of the general steps.
 *
 * Each step keeps an id of its own, made when it is added and never
 * changed, so ticking it off - a task on the case keyed by the step
 * (getDetectionRuleResponseStepKey) - stays with it when its words are
 * edited. The rule library's rules come with steps of their own
 * (DetectionRuleLibraryResponseSteps), whose ids are fixed.
 *
 * Shared by the server, which checks what is saved, the rule's form and the
 * Response Plan. Free of anything server-only and of React.
 */

// The part of a case's Response Plan a rule's step goes under.
export enum DetectionRuleResponsePhase {
  Confirm = "Confirm",
  Contain = "Contain",
  Fix = "Fix",
}

export const DETECTION_RULE_RESPONSE_PHASES: ReadonlyArray<DetectionRuleResponsePhase> =
  [
    DetectionRuleResponsePhase.Confirm,
    DetectionRuleResponsePhase.Contain,
    DetectionRuleResponsePhase.Fix,
  ];

export interface DetectionRuleResponseStep {
  // Stable: the plan's key for the step is made from it.
  id: string;
  phase: DetectionRuleResponsePhase;
  // What to do, in the author's words: one sentence or two.
  text: string;
}

// The most steps a rule carries: a short list, not a runbook.
export const DETECTION_RULE_RESPONSE_STEPS_MAX: number = 10;

// The longest a step's words are.
export const DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH: number = 300;

// The longest a step's id is, and what it is made of.
export const DETECTION_RULE_RESPONSE_STEP_ID_MAX_LENGTH: number = 40;
const STEP_ID_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]*$/;

// What a case's plan prefixes a rule's step's id with, for the step's key.
export const DETECTION_RULE_RESPONSE_STEP_KEY_PREFIX: string = "rule:";

export function isDetectionRuleResponsePhase(
  value: unknown,
): value is DetectionRuleResponsePhase {
  return (
    typeof value === "string" &&
    (DETECTION_RULE_RESPONSE_PHASES as ReadonlyArray<string>).includes(value)
  );
}

export function isDetectionRuleResponseStepId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= DETECTION_RULE_RESPONSE_STEP_ID_MAX_LENGTH &&
    STEP_ID_PATTERN.test(value)
  );
}

// A step's words as they are kept: one line, its spaces collapsed.
export function normalizeDetectionRuleResponseStepText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/*
 * A new step's id, unlike every id already used: "s" and eight letters or
 * digits. Not a secret, only a name.
 */
export function makeDetectionRuleResponseStepId(
  usedIds: ReadonlyArray<string> = [],
): string {
  for (;;) {
    let id: string = "s";

    while (id.length < 9) {
      id += Math.floor(Math.random() * 36).toString(36);
    }

    if (!usedIds.includes(id)) {
      return id;
    }
  }
}

/*
 * The key a case's plan keeps a rule's step under - the task ticked off for
 * it holds it (SecurityCaseTask.responseStepKey) - at most 45 characters.
 */
export function getDetectionRuleResponseStepKey(stepId: string): string {
  return `${DETECTION_RULE_RESPONSE_STEP_KEY_PREFIX}${stepId}`;
}

/*
 * A rule's steps as stored, read for the plan and the form: each that has a
 * part of the plan, words and an id, once, in its order, at most
 * DETECTION_RULE_RESPONSE_STEPS_MAX. Anything else is left out, never a
 * reason to drop the rest.
 */
export function readDetectionRuleResponseSteps(
  value: unknown,
): Array<DetectionRuleResponseStep> {
  const steps: Array<DetectionRuleResponseStep> = [];

  if (!Array.isArray(value)) {
    return steps;
  }

  const seen: Set<string> = new Set<string>();

  for (const item of value) {
    if (steps.length >= DETECTION_RULE_RESPONSE_STEPS_MAX) {
      break;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: { [key: string]: unknown } = item as {
      [key: string]: unknown;
    };
    const id: unknown = record["id"];
    const phase: unknown = record["phase"];
    const text: string = normalizeDetectionRuleResponseStepText(
      record["text"],
    ).substring(0, DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH);

    if (
      !isDetectionRuleResponseStepId(id) ||
      !isDetectionRuleResponsePhase(phase) ||
      !text ||
      seen.has(id as string)
    ) {
      continue;
    }

    seen.add(id as string);
    steps.push({ id: id as string, phase, text });
  }

  return steps;
}

export interface DetectionRuleResponseStepsCheck {
  // The steps as they are saved: their words trimmed, an empty one left out.
  steps: Array<DetectionRuleResponseStep>;
  // Why they cannot be saved, in words the form and the API show; null when they can.
  problem: string | null;
}

/*
 * The steps a form or an API call saves, checked: a list of at most
 * DETECTION_RULE_RESPONSE_STEPS_MAX steps, each with a part of the plan, an
 * id of its own and words no longer than
 * DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH. A step left without words
 * is left out, as an empty line of a list is.
 */
export function checkDetectionRuleResponseSteps(
  value: unknown,
): DetectionRuleResponseStepsCheck {
  if (value === null || value === undefined) {
    return { steps: [], problem: null };
  }

  if (!Array.isArray(value)) {
    return {
      steps: [],
      problem:
        "Response steps are a list of steps, each with the part of the plan it goes under and what to do.",
    };
  }

  const steps: Array<DetectionRuleResponseStep> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return {
        steps: [],
        problem:
          "Each response step needs the part of the plan it goes under and what to do.",
      };
    }

    const record: { [key: string]: unknown } = item as {
      [key: string]: unknown;
    };
    const text: string = normalizeDetectionRuleResponseStepText(record["text"]);

    if (!text) {
      continue;
    }

    if (text.length > DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH) {
      return {
        steps: [],
        problem: `A response step can be at most ${DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH} characters. Shorten it, or split it into two steps.`,
      };
    }

    if (!isDetectionRuleResponsePhase(record["phase"])) {
      return {
        steps: [],
        problem:
          "Each response step goes under Confirm, Contain or Fix. Choose where it goes.",
      };
    }

    const id: unknown = record["id"];

    if (!isDetectionRuleResponseStepId(id) || seen.has(id as string)) {
      return {
        steps: [],
        problem: `Each response step needs an id of its own: lower-case letters, digits and dashes, at most ${DETECTION_RULE_RESPONSE_STEP_ID_MAX_LENGTH} characters.`,
      };
    }

    seen.add(id as string);
    steps.push({ id: id as string, phase: record["phase"], text });
  }

  if (steps.length > DETECTION_RULE_RESPONSE_STEPS_MAX) {
    return {
      steps: [],
      problem: `A rule can carry at most ${DETECTION_RULE_RESPONSE_STEPS_MAX} response steps. Keep the ones a responder needs first.`,
    };
  }

  return { steps, problem: null };
}
