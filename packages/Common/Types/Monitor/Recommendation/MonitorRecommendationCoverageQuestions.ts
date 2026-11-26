import BadDataException from "../../Exception/BadDataException";
import MonitorStep from "../MonitorStep";
import MonitorType from "../MonitorType";
import MonitorRecommendationUtil, {
  MonitorRecommendationFingerprint,
} from "./MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
} from "./MonitorRecommendationTypes";

/*
 * WHICH RECOMMENDED MONITORS A PROJECT HAS ALREADY, DECIDED WITH A QUERY
 * ON THE SERVER (#11074).
 *
 * A recommendation is covered when a monitor of its type has a step that
 * watches the same thing - its fingerprint (MonitorRecommendationUtil):
 * the same resource, metrics, formulas, filters and thresholds. Every page
 * that asks - a resource's Recommendations tab and its menu's count, a
 * cloud account's recommendations, the telemetry guided setup - read the
 * project's first 10,000 monitors of each type by name, with every step,
 * and compared them in the browser. A monitor past them that covered a
 * recommendation was never seen: the recommendation read as missing, and
 * the guided setup offered to make it a second time.
 *
 * The page sends its recommendations' fingerprints instead
 * (POST /monitor/recommendation-coverage), and the server answers which
 * monitor covers each one:
 *
 *   - the monitors read are only the ones whose steps mention what the
 *     fingerprints are about (getCoverageSearchText): every fingerprint's
 *     resource is a value its steps hold - a host's identifier, a
 *     service's id, a cloud resource's id - so a monitor that holds none
 *     of them cannot cover any (a mention is a candidate, never a match);
 *   - each of those is fingerprinted as the browser fingerprinted every
 *     monitor (MonitorRecommendationCoverageMatcher, here, so the server
 *     and a page's tests answer alike), by name, a page at a time, under
 *     the reader's own permissions - however many monitors the project
 *     has;
 *   - and the answer is a monitor id for each covered recommendation:
 *     nothing of the monitors' steps leaves the server.
 *
 * React-free and model-free, so the server, the Dashboard and plain unit
 * tests read the one rule.
 */

// The route, under the monitors' own (/monitor).
export const MONITOR_RECOMMENDATION_COVERAGE_PATH: string =
  "/recommendation-coverage";

/*
 * The most questions one request asks: a page that asks more (a cloud
 * account's thousands of resources) asks in several requests.
 */
export const MAX_COVERAGE_QUESTIONS: number = 500;

// The most fingerprints one question holds: its own, and the equivalents.
export const MAX_COVERAGE_FINGERPRINTS_PER_QUESTION: number = 10;

// The longest fingerprint taken: a step's whole identity, serialized.
export const MAX_COVERAGE_FINGERPRINT_LENGTH: number = 20000;

// The longest key a page names a question by.
export const MAX_COVERAGE_KEY_LENGTH: number = 512;

// One recommendation of one resource, asked about.
export interface MonitorRecommendationCoverageQuestion {
  // The page's name for the answer: a recommendation's id, or a resource's and its.
  key: string;
  // The monitors that can cover it are of this type.
  monitorType: MonitorType;
  /*
   * Its fingerprints, serialized (MonitorRecommendationUtil
   * .serializeFingerprint): its own step's first, then the steps a monitor
   * made from it may have and still be it.
   */
  fingerprints: Array<string>;
}

// What the server answers: the monitor that covers each covered question.
export interface MonitorRecommendationCoverageAnswerJSON {
  covered: Record<string, string>;
}

/*
 * The questions a resource's recommendations ask, each named by `keyOf`
 * (the recommendation's id unless said): built as the create flow builds
 * their steps, so a monitor made from one fingerprints as it does.
 */
export function getCoverageQuestions(data: {
  recommendations: ReadonlyArray<MonitorRecommendation>;
  args: MonitorRecommendationArgs;
  keyOf?: ((recommendation: MonitorRecommendation) => string) | undefined;
}): Array<MonitorRecommendationCoverageQuestion> {
  const questions: Array<MonitorRecommendationCoverageQuestion> = [];

  for (const recommendation of data.recommendations) {
    const fingerprints: Array<string> =
      MonitorRecommendationUtil.getSerializedFingerprintsForRecommendation({
        recommendation,
        args: data.args,
      }).slice(0, MAX_COVERAGE_FINGERPRINTS_PER_QUESTION);

    // A step that carries no recommendation config can never be covered.
    if (fingerprints.length === 0) {
      continue;
    }

    questions.push({
      key: data.keyOf
        ? data.keyOf(recommendation)
        : recommendation.recommendationId,
      monitorType: recommendation.monitorType,
      fingerprints,
    });
  }

  return questions;
}

function isStringArray(value: unknown): value is Array<string> {
  return (
    Array.isArray(value) &&
    value.every((item: unknown): boolean => {
      return typeof item === "string";
    })
  );
}

/*
 * A fingerprint read back from its serialized form (the positional array
 * serializeFingerprint writes), or null when the text is not one.
 */
export function parseSerializedFingerprint(
  serialized: string,
): MonitorRecommendationFingerprint | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 8 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string" ||
    !parsed.slice(2).every(isStringArray)
  ) {
    return null;
  }

  return {
    resourceIdentifier: parsed[0],
    configKind: parsed[1],
    metricNames: parsed[2] as Array<string>,
    formulas: parsed[3] as Array<string>,
    metricAliases: parsed[4] as Array<string>,
    queryAttributes: parsed[5] as Array<string>,
    criteriaFilters: parsed[6] as Array<string>,
    configValues: parsed[7] as Array<string>,
  };
}

function getLongest(values: Array<string>): string {
  return values
    .map((value: string): string => {
      return value.trim();
    })
    .reduce((longest: string, value: string): string => {
      return value.length > longest.length ? value : longest;
    }, "");
}

// How a fingerprint writes a trace's or a log's attribute filter in its config values.
const ATTRIBUTES_CONFIG_VALUE_PREFIX: string = "attributes=";

/*
 * The values of the attribute filters a fingerprint holds - a cloud app's
 * task family, a function's name - as the step's JSON holds them: each
 * filter is written "key=value,key=value" (the metric queries' in
 * queryAttributes, a trace's or a log's in its "attributes=" config value).
 * What a value's text cannot be found as - one that held an object, or
 * nothing - is left out; a value with a comma in it is found by its parts.
 */
function getAttributeFilterValues(
  fingerprint: MonitorRecommendationFingerprint,
): Array<string> {
  const filters: Array<string> = [
    ...fingerprint.queryAttributes,
    ...fingerprint.configValues
      .filter((value: string): boolean => {
        return value.startsWith(ATTRIBUTES_CONFIG_VALUE_PREFIX);
      })
      .map((value: string): string => {
        return value.slice(ATTRIBUTES_CONFIG_VALUE_PREFIX.length);
      }),
  ];
  const values: Array<string> = [];

  for (const filter of filters) {
    for (const pair of filter.split(",")) {
      const at: number = pair.indexOf("=");
      const value: string = at > 0 ? pair.slice(at + 1).trim() : "";

      if (value && value !== "[object Object]" && value !== "undefined") {
        values.push(value);
      }
    }
  }

  return values;
}

/*
 * A text the JSON of every monitor step that fingerprints as `serialized`
 * holds, as Postgres writes the JSON out: the longest part of its resource
 * (each part is a value of the step - an identifier, a service's id, an
 * attribute's value); else, for a resource told apart by its attribute
 * filters (a cloud app, a serverless function), the longest of their
 * values; else its longest metric name. JSON-escaped, so a quote or a
 * backslash in it is found as the stored text writes it. Null when the
 * fingerprint names none: every monitor of the type is then a candidate.
 */
export function getCoverageSearchText(serialized: string): string | null {
  const fingerprint: MonitorRecommendationFingerprint | null =
    parseSerializedFingerprint(serialized);

  if (!fingerprint) {
    return null;
  }

  const literal: string =
    getLongest(fingerprint.resourceIdentifier.split(",")) ||
    getLongest(getAttributeFilterValues(fingerprint)) ||
    getLongest(fingerprint.metricNames);

  if (!literal) {
    return null;
  }

  return JSON.stringify(literal).slice(1, -1);
}

/*
 * The questions a request asks, read and checked: a list of at most
 * MAX_COVERAGE_QUESTIONS, each with a key, a monitor type and its
 * fingerprints. Anything else is refused, saying what is wrong.
 */
export function readCoverageQuestions(
  body: unknown,
): Array<MonitorRecommendationCoverageQuestion> {
  const questions: unknown =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)["questions"]
      : undefined;

  if (!Array.isArray(questions)) {
    throw new BadDataException(
      "questions must be a list of the recommendations asked about.",
    );
  }

  if (questions.length > MAX_COVERAGE_QUESTIONS) {
    throw new BadDataException(
      `Ask about at most ${MAX_COVERAGE_QUESTIONS} recommendations at once.`,
    );
  }

  const monitorTypes: Array<string> = Object.values(MonitorType);
  const read: Array<MonitorRecommendationCoverageQuestion> = [];

  for (const question of questions) {
    const record: Record<string, unknown> | null =
      question && typeof question === "object" && !Array.isArray(question)
        ? (question as Record<string, unknown>)
        : null;

    const key: unknown = record?.["key"];
    const monitorType: unknown = record?.["monitorType"];
    const fingerprints: unknown = record?.["fingerprints"];

    if (
      typeof key !== "string" ||
      !key ||
      key.length > MAX_COVERAGE_KEY_LENGTH
    ) {
      throw new BadDataException(
        `Each recommendation asked about needs a key of at most ${MAX_COVERAGE_KEY_LENGTH} characters.`,
      );
    }

    if (
      typeof monitorType !== "string" ||
      !monitorTypes.includes(monitorType)
    ) {
      throw new BadDataException(
        "Each recommendation asked about needs the type of monitor that would cover it.",
      );
    }

    if (
      !isStringArray(fingerprints) ||
      fingerprints.length === 0 ||
      fingerprints.length > MAX_COVERAGE_FINGERPRINTS_PER_QUESTION ||
      !fingerprints.every((fingerprint: string): boolean => {
        return (
          fingerprint.length <= MAX_COVERAGE_FINGERPRINT_LENGTH &&
          parseSerializedFingerprint(fingerprint) !== null
        );
      })
    ) {
      throw new BadDataException(
        `Each recommendation asked about needs between 1 and ${MAX_COVERAGE_FINGERPRINTS_PER_QUESTION} fingerprints, as MonitorRecommendationUtil writes them.`,
      );
    }

    read.push({
      key,
      monitorType: monitorType as MonitorType,
      fingerprints,
    });
  }

  return read;
}

/*
 * Which monitor covers each question, of the monitors handed to it in the
 * order they come: the first monitor with a step that fingerprints as one
 * of a question's fingerprints - its own first, then its equivalents - as
 * MonitorRecommendationUtil.getCoveredRecommendationMonitorIds decides it.
 * Handed a page at a time, by name, it answers as that did of a list by
 * name. One question's monitors are of its type: a matcher is for one type.
 */
export class MonitorRecommendationCoverageMatcher {
  private readonly questions: Array<MonitorRecommendationCoverageQuestion>;
  // Every fingerprint asked about, and the first monitor found with it.
  private readonly found: Map<string, string> = new Map<string, string>();
  private readonly wanted: Set<string>;

  public constructor(questions: Array<MonitorRecommendationCoverageQuestion>) {
    this.questions = questions;
    this.wanted = new Set<string>(
      questions.flatMap(
        (question: MonitorRecommendationCoverageQuestion): Array<string> => {
          return question.fingerprints;
        },
      ),
    );
  }

  /*
   * The texts that narrow the monitors read to the ones that could match,
   * each once - or null when one fingerprint names nothing to narrow by,
   * and every monitor of the type is a candidate.
   */
  public getSearchTexts(): Array<string> | null {
    const texts: Set<string> = new Set<string>();

    for (const fingerprint of this.wanted) {
      const text: string | null = getCoverageSearchText(fingerprint);

      if (!text) {
        return null;
      }

      texts.add(text);
    }

    return Array.from(texts);
  }

  // A monitor read, in the order monitors are read.
  public addMonitor(monitorId: string, steps: Array<MonitorStep>): void {
    for (const step of steps) {
      const fingerprint: MonitorRecommendationFingerprint | undefined =
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(step);

      if (!fingerprint) {
        continue;
      }

      const serialized: string =
        MonitorRecommendationUtil.serializeFingerprint(fingerprint);

      if (this.wanted.has(serialized) && !this.found.has(serialized)) {
        this.found.set(serialized, monitorId);
      }
    }
  }

  // Whether every fingerprint asked about has its monitor: none read later could change the answer.
  public isComplete(): boolean {
    return this.found.size === this.wanted.size;
  }

  // The covered questions, by key, each with the monitor that covers it.
  public getAnswer(): Map<string, string> {
    const answer: Map<string, string> = new Map<string, string>();

    for (const question of this.questions) {
      for (const fingerprint of question.fingerprints) {
        const monitorId: string | undefined = this.found.get(fingerprint);

        if (monitorId) {
          answer.set(question.key, monitorId);
          break;
        }
      }
    }

    return answer;
  }
}
