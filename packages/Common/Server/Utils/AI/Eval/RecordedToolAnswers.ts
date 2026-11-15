import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { InvestigationRecordedToolCall } from "../../../../Types/AI/InvestigationRecording";
import { ToolCallOutcome } from "../Toolbox/Index";

/*
 * Answers a replayed investigation's tool calls from what the original run
 * was handed back (Types/AI/InvestigationRecording) - never from the
 * project's live data.
 *
 * A call is answered by, in order:
 *
 *  1. The same tool with the same arguments (keys in any order): the
 *     recorded answers in the order the original run got them, and the last
 *     one again for a call made more often than the original made it.
 *  2. The same tool with the same arguments but its timestamps (an ISO 8601
 *     startTime, endTime, changeTime...) each within
 *     APPROXIMATE_TIME_TOLERANCE_MS of a recorded call's: a model works its
 *     windows out from "now", so the same question can name a window a
 *     minute off. The nearest such call answers, and it is counted apart.
 *  3. Nothing else: the replayed model asked what the original never did,
 *     or the same call as one whose result was too long to keep (never
 *     answered by a nearby call instead). It is told no data is available - in
 *     the words a tool error uses, never "this is a replay" - and the call
 *     is counted as not recorded. Many such calls mean the replay went
 *     somewhere the recording cannot follow, and its score says less.
 */

export const APPROXIMATE_TIME_TOLERANCE_MS: number = 15 * 60 * 1000;

export const NOT_RECORDED_ERROR_MESSAGE: string =
  "No result recorded for this call";

// What a tool call's answer was matched by.
export enum RecordedAnswerMatch {
  Exact = "Exact",
  NearbyTime = "NearbyTime",
  NotRecorded = "NotRecorded",
}

export interface RecordedToolAnswerCounts {
  exact: number;
  nearbyTime: number;
  notRecorded: number;
}

// An ISO 8601 date and time, as the tools take them.
const TIMESTAMP_PATTERN: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

interface RecordedEntry {
  call: InvestigationRecordedToolCall;
  // The arguments with every timestamp left out, as canonical JSON.
  withoutTimesKey: string;
  // The timestamps left out, by their path in the arguments.
  times: Map<string, number>;
}

interface ExactQueue {
  entries: Array<RecordedEntry>;
  // How many of them were served.
  served: number;
}

export default class RecordedToolAnswers {
  private readonly exact: Map<string, ExactQueue> = new Map();
  private readonly byToolName: Map<string, Array<RecordedEntry>> = new Map();
  private readonly counts: RecordedToolAnswerCounts = {
    exact: 0,
    nearbyTime: 0,
    notRecorded: 0,
  };

  public constructor(toolCalls: Array<InvestigationRecordedToolCall>) {
    for (const call of toolCalls) {
      if (!call || typeof call.toolName !== "string") {
        continue;
      }

      const toolArguments: JSONObject = call.arguments || {};
      const times: Map<string, number> = new Map();
      const withoutTimes: JSONValue = RecordedToolAnswers.takeTimes(
        toolArguments,
        "",
        times,
      );

      const entry: RecordedEntry = {
        call,
        withoutTimesKey: RecordedToolAnswers.canonicalJson(withoutTimes),
        times,
      };

      const exactKey: string = RecordedToolAnswers.getExactKey(
        call.toolName,
        toolArguments,
      );

      const queue: ExactQueue = this.exact.get(exactKey) || {
        entries: [],
        served: 0,
      };
      queue.entries.push(entry);
      this.exact.set(exactKey, queue);

      const sameTool: Array<RecordedEntry> =
        this.byToolName.get(call.toolName) || [];
      sameTool.push(entry);
      this.byToolName.set(call.toolName, sameTool);
    }
  }

  public answer(toolName: string, toolArguments: JSONObject): ToolCallOutcome {
    return this.answerWithMatch(toolName, toolArguments).outcome;
  }

  public answerWithMatch(
    toolName: string,
    toolArguments: JSONObject,
  ): { outcome: ToolCallOutcome; match: RecordedAnswerMatch } {
    const exactQueue: ExactQueue | undefined = this.exact.get(
      RecordedToolAnswers.getExactKey(toolName, toolArguments || {}),
    );

    if (exactQueue && exactQueue.entries.length > 0) {
      const index: number = Math.min(
        exactQueue.served,
        exactQueue.entries.length - 1,
      );
      exactQueue.served++;

      const entry: RecordedEntry = exactQueue.entries[index]!;

      if (entry.call.text !== null && entry.call.text !== undefined) {
        this.counts.exact++;
        return {
          outcome: RecordedToolAnswers.toOutcome(entry.call),
          match: RecordedAnswerMatch.Exact,
        };
      }

      /*
       * The original made this very call, but its result was too long to
       * keep. What it read is unknown, so no other call's result - one a few
       * minutes off included - stands in for it.
       */
      return this.notRecorded(toolName);
    }

    const nearby: RecordedEntry | null = this.findNearbyTime(
      toolName,
      toolArguments || {},
    );

    if (nearby) {
      this.counts.nearbyTime++;
      return {
        outcome: RecordedToolAnswers.toOutcome(nearby.call),
        match: RecordedAnswerMatch.NearbyTime,
      };
    }

    return this.notRecorded(toolName);
  }

  private notRecorded(toolName: string): {
    outcome: ToolCallOutcome;
    match: RecordedAnswerMatch;
  } {
    this.counts.notRecorded++;

    return {
      outcome: {
        success: false,
        textForLlm: `Error: no data is available for ${toolName} with these arguments in this run. Answer with the data you already have, or try a different call.`,
        errorMessage: NOT_RECORDED_ERROR_MESSAGE,
      },
      match: RecordedAnswerMatch.NotRecorded,
    };
  }

  public getCounts(): RecordedToolAnswerCounts {
    return { ...this.counts };
  }

  // The same tool and arguments, with timestamps that moved a little.
  private findNearbyTime(
    toolName: string,
    toolArguments: JSONObject,
  ): RecordedEntry | null {
    const candidates: Array<RecordedEntry> =
      this.byToolName.get(toolName) || [];

    if (candidates.length === 0) {
      return null;
    }

    const times: Map<string, number> = new Map();
    const withoutTimesKey: string = RecordedToolAnswers.canonicalJson(
      RecordedToolAnswers.takeTimes(toolArguments, "", times),
    );

    // Arguments without a timestamp have nothing to move.
    if (times.size === 0) {
      return null;
    }

    let best: RecordedEntry | null = null;
    let bestDistance: number = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (
        candidate.call.text === null ||
        candidate.call.text === undefined ||
        candidate.withoutTimesKey !== withoutTimesKey ||
        candidate.times.size !== times.size
      ) {
        continue;
      }

      let distance: number = 0;
      let isNear: boolean = true;

      for (const [path, time] of times) {
        const recordedTime: number | undefined = candidate.times.get(path);

        if (recordedTime === undefined) {
          isNear = false;
          break;
        }

        const apart: number = Math.abs(recordedTime - time);

        if (apart > APPROXIMATE_TIME_TOLERANCE_MS) {
          isNear = false;
          break;
        }

        distance += apart;
      }

      if (isNear && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    return best;
  }

  private static toOutcome(
    call: InvestigationRecordedToolCall,
  ): ToolCallOutcome {
    const text: string = call.text || "";

    if (!call.success) {
      return {
        success: false,
        textForLlm: text,
        errorMessage: text,
      };
    }

    return {
      success: true,
      textForLlm: text,
      result: {
        dataForLlm: text,
        rowCount: typeof call.rowCount === "number" ? call.rowCount : 0,
        citationLabel: call.citationLabel || call.toolName,
        ...(call.citationTarget ? { citationTarget: call.citationTarget } : {}),
        redactionCount: 0,
        isTruncated: call.isTruncated === true,
      },
    };
  }

  public static getExactKey(
    toolName: string,
    toolArguments: JSONObject,
  ): string {
    return `${toolName}\u0001${RecordedToolAnswers.canonicalJson(toolArguments)}`;
  }

  /*
   * JSON with every object's keys in order, so the same arguments make the
   * same text whichever order the model wrote them in.
   */
  public static canonicalJson(value: unknown): string {
    return JSON.stringify(RecordedToolAnswers.sortKeys(value)) ?? "null";
  }

  private static sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item: unknown) => {
        return RecordedToolAnswers.sortKeys(item);
      });
    }

    if (value && typeof value === "object") {
      const sorted: Record<string, unknown> = {};

      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        const item: unknown = (value as Record<string, unknown>)[key];

        // JSON leaves an undefined value out; so does the key.
        if (item !== undefined) {
          sorted[key] = RecordedToolAnswers.sortKeys(item);
        }
      }

      return sorted;
    }

    return value;
  }

  /*
   * The value with every timestamp string replaced by a placeholder, and
   * each timestamp collected by its path, so two calls that differ only in
   * their times have the same text.
   */
  private static takeTimes(
    value: unknown,
    path: string,
    times: Map<string, number>,
  ): JSONValue {
    if (typeof value === "string" && TIMESTAMP_PATTERN.test(value)) {
      const time: number = Date.parse(value);

      if (!Number.isNaN(time)) {
        times.set(path, time);
        return "<time>";
      }

      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item: unknown, index: number) => {
        return RecordedToolAnswers.takeTimes(item, `${path}[${index}]`, times);
      });
    }

    if (value && typeof value === "object") {
      const copy: JSONObject = {};

      for (const key of Object.keys(value as Record<string, unknown>)) {
        copy[key] = RecordedToolAnswers.takeTimes(
          (value as Record<string, unknown>)[key],
          `${path}.${key}`,
          times,
        );
      }

      return copy;
    }

    return value as JSONValue;
  }
}
