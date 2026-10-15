import { ATTRIBUTE_KEYS_LIMIT } from "../../../Types/Telemetry/AttributeSuggestionLimits";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import URL from "../../../Types/API/URL";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import API from "../API/API";
import ModelAPI from "../ModelAPI/ModelAPI";
import { APP_API_URL } from "../../Config";
import TelemetryLoadErrorUtil, {
  TelemetryLoadError,
} from "./TelemetryLoadError";

/*
 * THE `@key:` VALUE PICKER (issue #4708).
 *
 * The explorers' search bars offer the values of an attribute once the
 * reader has typed `@key:`. They used to ask for them whenever the last word
 * looked like `@key:` - for a key the project does not have (a typo, the
 * search help's `@http.status_code:500` with its key being typed over, one
 * letter at a time), and again for a key asked about a minute before - and
 * every ask was a scan of a day of telemetry.
 *
 * Now a bar asks:
 *   - only for a key in the project's key list (a list that could not load,
 *     or that is cut off at ATTRIBUTE_KEYS_LIMIT, cannot say a key is
 *     missing, so then any key is asked about);
 *   - only once the reader has paused (ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS),
 *     so the keys a key passes through while it is typed or edited in place
 *     are never asked about;
 *   - once per key and window for five minutes, across the explorers and
 *     their remounts: the answer is kept here (and on the server);
 *   - and a lookup that fails says so - "could not load", with Try again -
 *     instead of spinning or claiming the key has no values.
 *
 * useAttributeValueSuggestions (UseAttributeValueSuggestions.ts) holds the
 * part that lives in React; this file holds the rules and the cache.
 */

// How long the reader has to stop typing before the values are asked for.
export const ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS: number = 400;

// How long an answer is reused; the server keeps its own for as long.
export const ATTRIBUTE_VALUE_ANSWER_TTL_IN_MS: number = 5 * 60 * 1000;

/*
 * How long a failed lookup stays failed. Typing the key again after that
 * asks again; Try again asks at once.
 */
export const ATTRIBUTE_VALUE_FAILURE_TTL_IN_MS: number = 60 * 1000;

/*
 * The longest a lookup may take, end to end. The server stops one at 10
 * seconds; this only bounds a request that never comes back at all, so the
 * picker says it could not load the values rather than spin.
 */
export const ATTRIBUTE_VALUE_REQUEST_TIMEOUT_IN_MS: number = 30 * 1000;

// The most answers kept in a browser tab.
const MAX_CACHED_ANSWERS: number = 300;

const WHITESPACE: RegExp = /\s+/;

/*
 * The attribute key the search text's last word asks values for: the `key`
 * of `@key:` or `-@key:`, whatever follows the colon. Null for anything else
 * - a key still being typed (no colon yet), a field without `@`, free text.
 */
export function getTypedAttributeKey(searchText: string): string | null {
  const words: Array<string> = searchText.split(WHITESPACE);
  let word: string = words[words.length - 1] || "";

  if (word.startsWith("-")) {
    word = word.substring(1);
  }

  if (!word.startsWith("@")) {
    return null;
  }

  const colon: number = word.indexOf(":");

  // `@:` names no key.
  if (colon <= 1) {
    return null;
  }

  return word.substring(1, colon);
}

// The project's attribute keys, as the explorer has them.
export interface AttributeKeyList {
  keys: ReadonlyArray<string>;
  isLoading: boolean;
  hasFailed: boolean;
}

export enum AttributeKeyVerdict {
  // Ask for its values.
  LookUp = "look-up",
  // The key list is on its way: it will tell.
  WaitForKeyList = "wait-for-key-list",
  // Not a key the project has: nothing to ask.
  NotAKey = "not-a-key",
}

/*
 * Whether a typed key gets a lookup. Keys are matched exactly, as the data
 * holds them: `@Env:` filters on a key named "Env", so offering the values
 * of "env" under it would offer values that filter nothing.
 */
export function judgeTypedAttributeKey(
  key: string,
  list: AttributeKeyList,
): AttributeKeyVerdict {
  if (list.hasFailed) {
    return AttributeKeyVerdict.LookUp;
  }

  if (list.isLoading) {
    return AttributeKeyVerdict.WaitForKeyList;
  }

  if (list.keys.includes(key)) {
    return AttributeKeyVerdict.LookUp;
  }

  // A list cut off at the limit may be missing the key.
  if (list.keys.length >= ATTRIBUTE_KEYS_LIMIT) {
    return AttributeKeyVerdict.LookUp;
  }

  return AttributeKeyVerdict.NotAKey;
}

/*
 * What part of a cache entry's name the time range is: the range itself for
 * a moving one ("Past 1 Hour" asks the same question for five minutes - the
 * answer's lifetime), its edges for a fixed one.
 */
export function getTimeRangeScope(
  timeRange: RangeStartAndEndDateTime | undefined,
): string {
  if (!timeRange) {
    return "no-window";
  }

  if (timeRange.range === TimeRange.CUSTOM) {
    const startValue: Date | undefined = timeRange.startAndEndDate?.startValue;
    const endValue: Date | undefined = timeRange.startAndEndDate?.endValue;

    return `${toIso(startValue)}..${toIso(endValue)}`;
  }

  return timeRange.range;
}

function toIso(value: Date | undefined): string {
  if (!value) {
    return "";
  }

  const date: Date = new Date(value);

  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

/*
 * The window a lookup reads, as the route takes it: the explorer's time
 * range, resolved now (a moving range moves with the clock). Nothing when
 * there is no range on screen; the server then reads the last day.
 */
export function getLookupWindowBody(
  timeRange: RangeStartAndEndDateTime | undefined,
): JSONObject {
  if (!timeRange) {
    return {};
  }

  const window: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
  const startTime: string = toIso(window.startValue);
  const endTime: string = toIso(window.endValue);

  if (!startTime || !endTime) {
    return {};
  }

  return { startTime: startTime, endTime: endTime };
}

// The explorers whose `@key:` values come from /telemetry/<signal>/get-attribute-values.
export type AttributeValueSignal =
  | "logs"
  | "traces"
  | "exceptions"
  | "metrics"
  | "security-events";

export async function fetchAttributeValueSuggestions(data: {
  signal: AttributeValueSignal;
  attributeKey: string;
  timeRange?: RangeStartAndEndDateTime | undefined;
  metricName?: string | undefined;
}): Promise<Array<string>> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        `/telemetry/${data.signal}/get-attribute-values`,
      ),
      data: {
        attributeKey: data.attributeKey,
        ...(data.metricName ? { metricName: data.metricName } : {}),
        ...getLookupWindowBody(data.timeRange),
      },
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
      options: {
        timeout: ATTRIBUTE_VALUE_REQUEST_TIMEOUT_IN_MS,
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return toValueList(response.data["values"]);
}

// The strings of a route's `values`, nothing else.
export function toValueList(values: unknown): Array<string> {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter((value: unknown): value is string => {
    return typeof value === "string";
  });
}

/*
 * --- The answers of this tab ---
 *
 * Keyed by the caller's scope (signal, project, window, anything else that
 * decides the answer) and the key. Shared by every explorer on the page and
 * kept across their remounts, so going back to the logs and typing the same
 * `@key:` asks nothing.
 */
export type AttributeValueAnswer =
  | { kind: "loading"; done: Promise<void> }
  | { kind: "loaded"; values: Array<string>; at: number }
  | { kind: "failed"; error: TelemetryLoadError; at: number };

const answers: Map<string, AttributeValueAnswer> = new Map();
const listeners: Set<() => void> = new Set();

export function toAnswerKey(scope: string, key: string): string {
  return JSON.stringify([scope, key]);
}

// The answer for `answerKey` while it is fresh, else undefined.
export function readAnswer(
  answerKey: string,
  now: number = Date.now(),
): AttributeValueAnswer | undefined {
  const answer: AttributeValueAnswer | undefined = answers.get(answerKey);

  if (!answer || answer.kind === "loading") {
    return answer;
  }

  const ttl: number =
    answer.kind === "loaded"
      ? ATTRIBUTE_VALUE_ANSWER_TTL_IN_MS
      : ATTRIBUTE_VALUE_FAILURE_TTL_IN_MS;

  if (now - answer.at >= ttl) {
    answers.delete(answerKey);
    return undefined;
  }

  return answer;
}

/*
 * Asks for the values once: a lookup already on its way for the same
 * answer key is joined, not repeated. Settles when the answer is stored;
 * never rejects - a failure is an answer too.
 */
export function lookUpAttributeValues(
  answerKey: string,
  fetchValues: () => Promise<Array<string>>,
): Promise<void> {
  const current: AttributeValueAnswer | undefined = answers.get(answerKey);

  if (current && current.kind === "loading") {
    return current.done;
  }

  const done: Promise<void> = (async (): Promise<void> => {
    try {
      const values: Array<string> = await fetchValues();

      store(answerKey, {
        kind: "loaded",
        values: Array.from(new Set(toValueList(values))),
        at: Date.now(),
      });
    } catch (error) {
      store(answerKey, {
        kind: "failed",
        error: TelemetryLoadErrorUtil.fromError(error),
        at: Date.now(),
      });
    }

    notify();
  })();

  store(answerKey, { kind: "loading", done: done });
  notify();

  return done;
}

// Forgets the answer, so the next lookup asks again.
export function forgetAttributeValues(answerKey: string): void {
  const current: AttributeValueAnswer | undefined = answers.get(answerKey);

  if (current && current.kind !== "loading") {
    answers.delete(answerKey);
  }
}

// Called whenever an answer starts or settles.
export function onAttributeValueAnswers(listener: () => void): () => void {
  listeners.add(listener);

  return (): void => {
    listeners.delete(listener);
  };
}

// Forgets every answer. For tests.
export function clearAttributeValueAnswers(): void {
  answers.clear();
}

function store(answerKey: string, answer: AttributeValueAnswer): void {
  answers.delete(answerKey);

  while (answers.size >= MAX_CACHED_ANSWERS) {
    const oldest: string | undefined = answers.keys().next().value as
      | string
      | undefined;

    if (oldest === undefined) {
      break;
    }

    answers.delete(oldest);
  }

  answers.set(answerKey, answer);
}

function notify(): void {
  for (const listener of Array.from(listeners)) {
    listener();
  }
}
