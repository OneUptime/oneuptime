import { JSONObject, JSONValue } from "../JSON";
import { ResponseLink, readResponseLink } from "./SecurityCaseResponseLink";

/*
 * THE EVIDENCE BEHIND A CHECK OF A RESPONSE PLAN STEP (#10340), as it is
 * stored (SecurityCaseStepCheck.evidence) and read by the card, the server
 * and OneUptime AI:
 *
 *   sentence  the line the step says: "No request from 35.205.11.131 has
 *             reached your app since 10:42. It sent 212 in the hour
 *             before." - an English key of the Dashboard's locales
 *             (StepCheckWords) and its parts, worded where it is drawn;
 *   facts     what else OneUptime saw, each a sentence: the "How we know"
 *             fold;
 *   links     where the evidence is: the traces, the events, the product;
 *   docsPath  for a step OneUptime cannot tell about, the docs page that
 *             says how to let it (a path under the docs' address);
 *   data      the figures and moments the check worked from, by name - what
 *             the next check reads to tell a step that stopped holding.
 *
 * A sentence's values are written as they are (an address, a user name);
 * its numbers in the reader's digits; its times as the reader's time of
 * day. Nothing here is trusted as it comes back from storage:
 * readStepCheckEvidence keeps only what fits.
 */

// The most facts and links a check keeps.
export const STEP_CHECK_MAX_FACTS: number = 8;
export const STEP_CHECK_MAX_LINKS: number = 6;

const MAX_TEXT_LENGTH: number = 1000;
const MAX_KEYS: number = 24;

// A path of the docs, and its anchor: /telemetry/security-cases#checks.
const DOCS_PATH: RegExp = /^\/[a-z0-9/#._-]*$/i;

export interface SecurityCaseStepCheckSentence {
  // An English key, or a count-dependent one ({ one, other }) with `count`.
  template: string | { one: string; other: string };
  values: Record<string, string>;
  numbers?: Record<string, number> | undefined;
  // ISO times, written as the reader's time where the sentence is drawn.
  times?: Record<string, string> | undefined;
  count?: number | undefined;
}

export type SecurityCaseStepCheckData = Record<
  string,
  string | number | boolean | null
>;

export interface SecurityCaseStepCheckEvidence {
  sentence: SecurityCaseStepCheckSentence;
  facts: Array<SecurityCaseStepCheckSentence>;
  links: Array<ResponseLink>;
  docsPath?: string | undefined;
  data: SecurityCaseStepCheckData;
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : "";
}

function readRecord<T>(
  value: JSONValue | undefined,
  readEntry: (entry: JSONValue) => T | undefined,
): Record<string, T> {
  const record: Record<string, T> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return record;
  }

  for (const key of Object.keys(value).slice(0, MAX_KEYS)) {
    const entry: T | undefined = readEntry((value as JSONObject)[key]!);

    if (entry !== undefined) {
      record[key] = entry;
    }
  }

  return record;
}

// A sentence as stored, read back; null when it has no words to say.
export function readStepCheckSentence(
  value: unknown,
): SecurityCaseStepCheckSentence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const sentence: JSONObject = value as JSONObject;
  const rawTemplate: JSONValue | undefined = sentence["template"];
  let template: string | { one: string; other: string } | null = null;

  if (typeof rawTemplate === "string" && rawTemplate.trim()) {
    template = readText(rawTemplate);
  } else if (
    rawTemplate &&
    typeof rawTemplate === "object" &&
    !Array.isArray(rawTemplate)
  ) {
    const one: string = readText((rawTemplate as JSONObject)["one"]);
    const other: string = readText((rawTemplate as JSONObject)["other"]);

    template = one && other ? { one, other } : null;
  }

  if (!template) {
    return null;
  }

  const numbers: Record<string, number> = readRecord<number>(
    sentence["numbers"],
    (entry: JSONValue): number | undefined => {
      return typeof entry === "number" && Number.isFinite(entry)
        ? entry
        : undefined;
    },
  );
  const times: Record<string, string> = readRecord<string>(
    sentence["times"],
    (entry: JSONValue): string | undefined => {
      return typeof entry === "string" &&
        !Number.isNaN(new Date(entry).getTime())
        ? entry
        : undefined;
    },
  );
  const count: JSONValue | undefined = sentence["count"];

  return {
    template,
    values: readRecord<string>(
      sentence["values"],
      (entry: JSONValue): string | undefined => {
        return typeof entry === "string" ? readText(entry) : undefined;
      },
    ),
    ...(Object.keys(numbers).length > 0 ? { numbers } : {}),
    ...(Object.keys(times).length > 0 ? { times } : {}),
    ...(typeof count === "number" && Number.isFinite(count)
      ? { count: Math.max(0, Math.trunc(count)) }
      : {}),
  };
}

/*
 * Evidence as stored, read back: null when it has no sentence to say - a
 * check with nothing to show says nothing, and is never read as done.
 */
export function readStepCheckEvidence(
  value: unknown,
): SecurityCaseStepCheckEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const evidence: JSONObject = value as JSONObject;
  const sentence: SecurityCaseStepCheckSentence | null = readStepCheckSentence(
    evidence["sentence"],
  );

  if (!sentence) {
    return null;
  }

  const facts: Array<SecurityCaseStepCheckSentence> = Array.isArray(
    evidence["facts"],
  )
    ? (evidence["facts"] as Array<JSONValue>)
        .map((fact: JSONValue): SecurityCaseStepCheckSentence | null => {
          return readStepCheckSentence(fact);
        })
        .filter(
          (
            fact: SecurityCaseStepCheckSentence | null,
          ): fact is SecurityCaseStepCheckSentence => {
            return fact !== null;
          },
        )
        .slice(0, STEP_CHECK_MAX_FACTS)
    : [];
  const links: Array<ResponseLink> = Array.isArray(evidence["links"])
    ? (evidence["links"] as Array<JSONValue>)
        .map((link: JSONValue): ResponseLink | null => {
          return readResponseLink(link);
        })
        .filter((link: ResponseLink | null): link is ResponseLink => {
          return link !== null;
        })
        .slice(0, STEP_CHECK_MAX_LINKS)
    : [];
  const docsPath: string = readText(evidence["docsPath"]);

  return {
    sentence,
    facts,
    links,
    // Only a path of the docs: never an address of anywhere else.
    ...(DOCS_PATH.test(docsPath) ? { docsPath } : {}),
    data: readRecord<string | number | boolean | null>(
      evidence["data"],
      (entry: JSONValue): string | number | boolean | null | undefined => {
        if (entry === null || typeof entry === "boolean") {
          return entry;
        }

        if (typeof entry === "number") {
          return Number.isFinite(entry) ? entry : undefined;
        }

        return typeof entry === "string" ? readText(entry) : undefined;
      },
    ),
  };
}

// A moment the evidence's data keeps, read back; null for none or not a time.
export function readStepCheckDataTime(
  data: SecurityCaseStepCheckData | undefined,
  key: string,
): Date | null {
  const value: string | number | boolean | null | undefined = data?.[key];

  if (typeof value !== "string" || !value) {
    return null;
  }

  const time: Date = new Date(value);

  return Number.isNaN(time.getTime()) ? null : time;
}
