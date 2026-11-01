import crypto from "crypto";
import { JSONObject } from "../../../Types/JSON";
import {
  MAX_UNPLACED_FIELDS_PER_SCAN,
  readUnplacedFields,
  UnplacedField,
  unplacedFieldSignature,
} from "../../../Utils/DataSecurity/UnplacedFields";
import { DataStoreLocationKind } from "./DataSecurityScanTypes";

/*
 * A STORE'S FIELDS NO DETECTOR PLACED, AND WHAT ONEUPTIME AI SAID OF THEM
 * (DataStore.fieldSuggestionState, read by nobody through the API).
 *
 *   pending   the fields the store's last content scan could not place,
 *             described by their names and the shapes of their values
 *             (Utils/DataSecurity/UnplacedFields) - written by the scan's
 *             writer, read by the field suggestion job
 *             (Server/Utils/AI/DataSecurity/FieldSuggestion)
 *   answers   OneUptime AI's answer for each field it was asked about, by
 *             the hash of what it was asked (the field's location and
 *             shapes): the data type it named, and why, or no type. A field
 *             is asked again only once its answer is
 *             FIELD_ANSWER_LIFETIME_IN_DAYS old, or once it looks different.
 *
 * A column of its own, not the scan state the evaluator reads for every
 * store: two hundred fields described is tens of kilobytes.
 */

// How long an answer stands before the field is asked about again.
export const FIELD_ANSWER_LIFETIME_IN_DAYS: number = 30;

// The most answers a store keeps: the newest first.
export const MAX_FIELD_ANSWERS: number = 500;

// The longest reason a stored answer keeps.
const MAX_STORED_REASON_LENGTH: number = 300;

export interface FieldAnswer {
  // When OneUptime AI answered, as an ISO date.
  at: string;
  // The data type it named; none when it named none.
  dataTypeId?: string | undefined;
  reason?: string | undefined;
}

export interface FieldSuggestionState {
  pending: Array<UnplacedField>;
  // When the scan that left the pending fields finished, as an ISO date.
  scannedAt?: string | undefined;
  answers: Record<string, FieldAnswer>;
}

const LOCATION_KINDS: ReadonlySet<string> = new Set(
  Object.values(DataStoreLocationKind),
);

// The key an answer is kept by: what the field was asked as.
export function getFieldAnswerKey(field: UnplacedField): string {
  return crypto
    .createHash("sha256")
    .update(unplacedFieldSignature(field))
    .digest("hex")
    .slice(0, 32);
}

function readIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 40) {
    return undefined;
  }

  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function readAnswer(value: unknown): FieldAnswer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: JSONObject = value as JSONObject;
  const at: string | undefined = readIsoDate(raw["at"]);

  if (!at) {
    return null;
  }

  const answer: FieldAnswer = { at };

  if (
    typeof raw["dataTypeId"] === "string" &&
    raw["dataTypeId"].length > 0 &&
    raw["dataTypeId"].length <= 100
  ) {
    answer.dataTypeId = raw["dataTypeId"];

    if (typeof raw["reason"] === "string") {
      answer.reason = raw["reason"].slice(0, MAX_STORED_REASON_LENGTH);
    }
  }

  return answer;
}

// The stored state, read defensively: anything that is not one is empty.
export function readFieldSuggestionState(value: unknown): FieldSuggestionState {
  const raw: JSONObject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : {};
  const answers: Record<string, FieldAnswer> = {};
  const rawAnswers: unknown = raw["answers"];

  if (
    rawAnswers &&
    typeof rawAnswers === "object" &&
    !Array.isArray(rawAnswers)
  ) {
    for (const [key, entry] of Object.entries(
      rawAnswers as Record<string, unknown>,
    )) {
      if (Object.keys(answers).length >= MAX_FIELD_ANSWERS) {
        break;
      }

      const answer: FieldAnswer | null = readAnswer(entry);

      if (answer && key.length > 0 && key.length <= 64) {
        answers[key] = answer;
      }
    }
  }

  return {
    pending: readUnplacedFields(raw["pending"], (kind: string): boolean => {
      return LOCATION_KINDS.has(kind);
    }),
    scannedAt: readIsoDate(raw["scannedAt"]),
    answers,
  };
}

/*
 * The answers that still stand at `now`, the newest MAX_FIELD_ANSWERS of
 * them.
 */
export function keepStandingAnswers(
  answers: Record<string, FieldAnswer>,
  now: Date,
): Record<string, FieldAnswer> {
  const oldest: number =
    now.getTime() - FIELD_ANSWER_LIFETIME_IN_DAYS * 24 * 60 * 60 * 1000;

  return Object.fromEntries(
    Object.entries(answers)
      .filter(([, answer]: [string, FieldAnswer]): boolean => {
        const at: number = Date.parse(answer.at);

        return Number.isFinite(at) && at >= oldest && at <= now.getTime();
      })
      .sort((a: [string, FieldAnswer], b: [string, FieldAnswer]): number => {
        return Date.parse(b[1].at) - Date.parse(a[1].at);
      })
      .slice(0, MAX_FIELD_ANSWERS),
  );
}

// The state as it is stored.
export function toStoredFieldSuggestionState(
  state: FieldSuggestionState,
): JSONObject {
  const stored: JSONObject = {
    pending: state.pending.slice(
      0,
      MAX_UNPLACED_FIELDS_PER_SCAN,
    ) as unknown as JSONObject[],
    answers: state.answers as unknown as JSONObject,
  };

  if (state.scannedAt) {
    stored["scannedAt"] = state.scannedAt;
  }

  return stored;
}

/*
 * After a content scan: the fields it could not place are the ones
 * pending now; the answers are kept.
 */
export function withPendingFields(data: {
  previous: unknown;
  pending: ReadonlyArray<UnplacedField>;
  scannedAt: Date;
}): JSONObject {
  const previous: FieldSuggestionState = readFieldSuggestionState(
    data.previous,
  );

  return toStoredFieldSuggestionState({
    pending: [...data.pending],
    scannedAt: data.scannedAt.toISOString(),
    answers: keepStandingAnswers(previous.answers, data.scannedAt),
  });
}
