import Span from "../../Models/AnalyticsModels/Span";
import InBetween from "../BaseDatabase/InBetween";
import Includes from "../BaseDatabase/Includes";
import Query from "../BaseDatabase/Query";
import OneUptimeDate from "../Date";
import { JSONObject, ObjectType } from "../JSON";
import ObjectID from "../ObjectID";
import {
  LlmAnswerIssue,
  LlmAnswerIssueUtil,
} from "../Telemetry/LlmAnswerIssue";

/*
 * THE AI / LLM MONITOR: "TELL ME WHEN THE AI ANSWERS BADLY".
 *
 * Each check counts the AI's answers in a window - the calls where a model
 * produced a response (LlmCallKind.Answer), in the apps it watches - and
 * how many of them were bad. An answer is bad when it had one of the
 * problems ingest found on it (LlmAnswerIssue: failed, refused, cut off,
 * empty, flagged by an evaluation the app sent) that this monitor counts,
 * or when it took longer than the monitor's slow-answer limit. The
 * criteria then compare the number of bad answers, their share of all
 * answers, or the number of answers (for "the AI stopped answering").
 *
 * What counts as slow is the customer's threshold, so it lives here rather
 * than at ingest. Tool runs, embeddings, searches and agent wrappers are
 * not answers and are never counted: a RAG app's embedding calls must not
 * dilute the share of bad answers.
 */
export default interface MonitorStepLlmMonitor {
  // The apps (telemetry services) whose AI calls count; [] = every app.
  telemetryServiceIds: Array<ObjectID>;
  /*
   * The problems that make an answer bad. Empty counts every problem -
   * unless a slow-answer limit is set, in which case only slow answers are
   * bad (see getBadAnswerRule).
   */
  issues: Array<LlmAnswerIssue>;
  // An answer that took longer than this many seconds is bad; 0 = no limit.
  slowAnswerSeconds: number;
  // Only answers from this model (requested or served); "" = any model.
  model: string;
  // How far back each check looks, in seconds.
  lastXSecondsOfCalls: number;
}

export interface LlmBadAnswerRule {
  issues: Array<LlmAnswerIssue>;
  // null when no slow-answer limit is set.
  slowAnswerMs: number | null;
}

export const LLM_MONITOR_DEFAULT_WINDOW_SECONDS: number = 900;

// A week: the longest window a check reads.
export const LLM_MONITOR_MAX_WINDOW_SECONDS: number = 7 * 24 * 60 * 60;

// A day: the longest an answer can be told it is slow after.
export const LLM_MONITOR_MAX_SLOW_ANSWER_SECONDS: number = 24 * 60 * 60;

export const LLM_MONITOR_MAX_MODEL_LENGTH: number = 200;

// The windows the monitor form offers, in seconds.
export const LLM_MONITOR_WINDOW_OPTIONS: ReadonlyArray<number> = [
  300, 900, 1800, 3600, 21600, 86400,
];

function readServiceIds(value: unknown): Array<ObjectID> {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: Array<ObjectID> = [];

  for (const entry of value) {
    let id: string = "";

    if (entry instanceof ObjectID) {
      id = entry.toString();
    } else if (typeof entry === "string") {
      id = entry;
    } else if (
      entry &&
      typeof entry === "object" &&
      (entry as JSONObject)["_type"] === ObjectType.ObjectID &&
      typeof (entry as JSONObject)["value"] === "string"
    ) {
      id = (entry as JSONObject)["value"] as string;
    }

    id = id.trim();

    if (
      id &&
      ObjectID.isValidUUID(id) &&
      !ids.some((existing: ObjectID): boolean => {
        return existing.toString() === id;
      })
    ) {
      ids.push(new ObjectID(id));
    }
  }

  return ids;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed: number =
    typeof value === "number" ? value : Number(value ?? Number.NaN);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class MonitorStepLlmMonitorUtil {
  public static getDefault(): MonitorStepLlmMonitor {
    return {
      telemetryServiceIds: [],
      issues: LlmAnswerIssueUtil.getAllIssues(),
      slowAnswerSeconds: 0,
      model: "",
      lastXSecondsOfCalls: LLM_MONITOR_DEFAULT_WINDOW_SECONDS,
    };
  }

  /*
   * A step read back from JSON - saved by any build, written by the API or
   * by hand. Never throws: anything unreadable takes its default, so a
   * monitor always has a config its check can run.
   */
  public static fromJSON(
    json: JSONObject | undefined | null,
  ): MonitorStepLlmMonitor {
    const object: JSONObject =
      json && typeof json === "object" && !Array.isArray(json) ? json : {};

    const slowAnswerSeconds: number = Number(object["slowAnswerSeconds"]);

    return {
      telemetryServiceIds: readServiceIds(object["telemetryServiceIds"]),
      issues: Array.isArray(object["issues"])
        ? LlmAnswerIssueUtil.fromValues(object["issues"])
        : LlmAnswerIssueUtil.getAllIssues(),
      slowAnswerSeconds:
        Number.isFinite(slowAnswerSeconds) && slowAnswerSeconds > 0
          ? Math.min(slowAnswerSeconds, LLM_MONITOR_MAX_SLOW_ANSWER_SECONDS)
          : 0,
      model:
        typeof object["model"] === "string"
          ? (object["model"] as string)
              .trim()
              .slice(0, LLM_MONITOR_MAX_MODEL_LENGTH)
          : "",
      lastXSecondsOfCalls: Math.min(
        readPositiveNumber(
          object["lastXSecondsOfCalls"],
          LLM_MONITOR_DEFAULT_WINDOW_SECONDS,
        ),
        LLM_MONITOR_MAX_WINDOW_SECONDS,
      ),
    };
  }

  public static toJSON(monitor: MonitorStepLlmMonitor): JSONObject {
    const normalized: MonitorStepLlmMonitor =
      MonitorStepLlmMonitorUtil.fromJSON(monitor as unknown as JSONObject);

    return {
      telemetryServiceIds: ObjectID.toJSONArray(normalized.telemetryServiceIds),
      issues: normalized.issues,
      slowAnswerSeconds: normalized.slowAnswerSeconds,
      model: normalized.model,
      lastXSecondsOfCalls: normalized.lastXSecondsOfCalls,
    };
  }

  /*
   * What makes an answer bad for this monitor. No problem picked and no
   * slow-answer limit would make a monitor that can never see a bad
   * answer, so it counts every problem instead.
   */
  public static getBadAnswerRule(
    monitor: MonitorStepLlmMonitor,
  ): LlmBadAnswerRule {
    const issues: Array<LlmAnswerIssue> = LlmAnswerIssueUtil.fromValues(
      monitor.issues,
    );
    const slowAnswerSeconds: number = Number(monitor.slowAnswerSeconds);
    const slowAnswerMs: number | null =
      Number.isFinite(slowAnswerSeconds) && slowAnswerSeconds > 0
        ? Math.round(
            Math.min(slowAnswerSeconds, LLM_MONITOR_MAX_SLOW_ANSWER_SECONDS) *
              1000,
          )
        : null;

    if (issues.length === 0 && slowAnswerMs === null) {
      return {
        issues: LlmAnswerIssueUtil.getAllIssues(),
        slowAnswerMs: null,
      };
    }

    return { issues: issues, slowAnswerMs: slowAnswerMs };
  }

  /*
   * The window a check reads. `evaluateUntil` ends it earlier than now: a
   * telemetry check judges only data OneUptime has finished reading while
   * its ingest queue is behind (ReceivingCoverage.planTelemetryEvaluation,
   * issue #2825).
   */
  public static getWindow(
    monitor: MonitorStepLlmMonitor,
    evaluateUntil?: Date | undefined,
  ): InBetween<Date> {
    const seconds: number = Math.min(
      readPositiveNumber(
        monitor.lastXSecondsOfCalls,
        LLM_MONITOR_DEFAULT_WINDOW_SECONDS,
      ),
      LLM_MONITOR_MAX_WINDOW_SECONDS,
    );
    const endDate: Date = evaluateUntil || OneUptimeDate.getCurrentDate();

    return new InBetween<Date>(
      OneUptimeDate.addRemoveSeconds(endDate, seconds * -1),
      endDate,
    );
  }

  /*
   * The AI calls a check looked at, as a span query: what an incident or an
   * alert links to ("view the AI calls") in the trace explorer.
   */
  public static toSpanQuery(
    monitor: MonitorStepLlmMonitor,
    evaluateUntil?: Date | undefined,
  ): Query<Span> {
    const query: Query<Span> = {
      isLlmSpan: true,
      startTime: MonitorStepLlmMonitorUtil.getWindow(monitor, evaluateUntil),
    };

    const serviceIds: Array<ObjectID> = readServiceIds(
      monitor.telemetryServiceIds,
    );

    if (serviceIds.length > 0) {
      query.primaryEntityId = new Includes(serviceIds);
    }

    return query;
  }
}
