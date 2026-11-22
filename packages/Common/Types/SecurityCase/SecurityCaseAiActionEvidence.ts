import { JSONObject, JSONValue } from "../JSON";
import SecurityCaseStepCheckState, {
  isSecurityCaseStepCheckState,
} from "./SecurityCaseStepCheckState";
import {
  SecurityCaseStepCheckEvidence,
  readStepCheckEvidence,
} from "./SecurityCaseStepCheckEvidence";
import SecurityCaseVerdict, {
  isSecurityCaseVerdict,
} from "./SecurityCaseVerdict";
import { SecurityEntity, readSecurityEntities } from "./SecurityEntity";

/*
 * WHAT ONEUPTIME AI READ THAT MADE IT DO, ASK OR LEAVE ONE THING ON A CASE
 * (#10352): the evidence a row of its log keeps (SecurityCaseAiAction
 * .evidence), for the case's AI card to show beside it.
 *
 *   - check: the step's own check as OneUptime AI read it - its state and
 *     its evidence, worded on the card as the Response Plan words it;
 *   - stepKeys: for a hand-off, the steps left for a person;
 *   - trackRecord: how often the same action held on cases like this one
 *     in the project, when it asked or acted;
 *   - verdict, priorityId: what a close or a priority change sets.
 *
 * Only figures, codes and what OneUptime's own checks wrote: never the
 * triage's report, nor any text the model wrote (SubjectReadersOnlyGuard).
 */
export interface SecurityCaseAiTrackRecord {
  // Similar cases where the same step was done and checked.
  similar: number;
  // Of those, the ones where it held.
  held: number;
}

export interface SecurityCaseAiActionEvidence {
  check?:
    | {
        state: SecurityCaseStepCheckState;
        evidence: SecurityCaseStepCheckEvidence;
      }
    | undefined;
  stepKeys?: Array<string> | undefined;
  trackRecord?: SecurityCaseAiTrackRecord | undefined;
  verdict?: SecurityCaseVerdict | undefined;
  priorityId?: string | undefined;
  // What an exception OneUptime AI offers skips: an entity of the case.
  entity?: SecurityEntity | undefined;
  // What the engine said when the step did not do what was asked.
  error?: string | undefined;
}

// The most step keys a hand-off lists.
export const SECURITY_CASE_AI_EVIDENCE_MAX_STEP_KEYS: number = 20;

const MAX_ERROR_LENGTH: number = 500;

function readWholeNumber(value: JSONValue | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

// The evidence as stored; anything it cannot read is left out, never guessed.
export function readSecurityCaseAiActionEvidence(
  value: unknown,
): SecurityCaseAiActionEvidence {
  const evidence: SecurityCaseAiActionEvidence = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return evidence;
  }

  const raw: JSONObject = value as JSONObject;
  const check: JSONValue | undefined = raw["check"];

  if (check && typeof check === "object" && !Array.isArray(check)) {
    const state: JSONValue | undefined = (check as JSONObject)["state"];
    const checkEvidence: SecurityCaseStepCheckEvidence | null =
      readStepCheckEvidence((check as JSONObject)["evidence"]);

    if (isSecurityCaseStepCheckState(state) && checkEvidence) {
      evidence.check = { state, evidence: checkEvidence };
    }
  }

  if (Array.isArray(raw["stepKeys"])) {
    evidence.stepKeys = (raw["stepKeys"] as Array<JSONValue>)
      .filter((key: JSONValue): key is string => {
        return typeof key === "string" && key.length > 0 && key.length <= 100;
      })
      .slice(0, SECURITY_CASE_AI_EVIDENCE_MAX_STEP_KEYS);
  }

  const trackRecord: JSONValue | undefined = raw["trackRecord"];

  if (
    trackRecord &&
    typeof trackRecord === "object" &&
    !Array.isArray(trackRecord)
  ) {
    const similar: number | null = readWholeNumber(
      (trackRecord as JSONObject)["similar"],
    );
    const held: number | null = readWholeNumber(
      (trackRecord as JSONObject)["held"],
    );

    if (similar !== null && held !== null && held <= similar) {
      evidence.trackRecord = { similar, held };
    }
  }

  if (isSecurityCaseVerdict(raw["verdict"])) {
    evidence.verdict = raw["verdict"];
  }

  if (typeof raw["priorityId"] === "string" && raw["priorityId"]) {
    evidence.priorityId = raw["priorityId"];
  }

  const entity: SecurityEntity | undefined = readSecurityEntities(
    raw["entity"] ? [raw["entity"]] : [],
  )[0];

  if (entity) {
    evidence.entity = entity;
  }

  if (typeof raw["error"] === "string" && raw["error"]) {
    evidence.error = (raw["error"] as string).slice(0, MAX_ERROR_LENGTH);
  }

  return evidence;
}

// The evidence as it is stored.
export function toSecurityCaseAiActionEvidenceJson(
  evidence: SecurityCaseAiActionEvidence,
): JSONObject {
  return JSON.parse(JSON.stringify(evidence)) as JSONObject;
}
