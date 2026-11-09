/*
 * Tells an AI run that is going in circles from one that is working (issue
 * #6440). Runs no longer stop at a count of calls, so this is what catches a
 * model that is stuck long before its time limit does - and it never stops
 * a run that is still learning something, however many calls that takes.
 *
 * It reads the run one round at a time - the tool calls of one model
 * response, with what each returned - and watches for two things:
 *
 *   - the same failing call: a call that fails, made again with the same
 *     arguments and failing the same way, REPEATED_FAILURE_LIMIT times in
 *     the run. The model is not adapting to the error;
 *   - rounds that show it nothing new: a round makes progress when at
 *     least one of its calls returned something the run had not seen -
 *     a new call, or a call made again that now returns something else
 *     (a file read after an edit, a status that moved on). After
 *     NO_PROGRESS_ROUNDS_BEFORE_NUDGE rounds in a row without any, the
 *     model is told to change course; after NO_PROGRESS_ROUNDS_BEFORE_STOP,
 *     the run is asked to answer with what it has.
 *
 * It compares what the calls returned, not how many there were, so a run
 * that reads a thousand different things is never stopped by it. Kept free
 * of React and of server code: the server's agent loops and the Runner's
 * code agent share it.
 */

export const REPEATED_FAILURE_LIMIT: number = 3;
export const NO_PROGRESS_ROUNDS_BEFORE_NUDGE: number = 3;
export const NO_PROGRESS_ROUNDS_BEFORE_STOP: number = 5;

// One tool call of a round, as the loop ran it.
export interface AgentLoopToolCall {
  name: string;
  // The arguments as the model sent them: an object, or its JSON text.
  arguments: unknown;
  // What the call handed back to the model.
  output: string;
  // Whether it failed: an error the model was shown instead of a result.
  isError: boolean;
}

export enum AgentLoopVerdict {
  // Go on.
  Continue = "Continue",
  // Go on, but tell the model to change course (getNudgeInstruction).
  Nudge = "Nudge",
  // Ask the run to answer now (AIRunStopReason.Loop).
  Stop = "Stop",
}

/*
 * A short, stable fingerprint of a text (cyrb53): two different texts get
 * the same one with a chance of about 1 in 2^53, so a run keeps a number
 * per call instead of every output it read.
 */
export function fingerprintText(text: string): string {
  let h1: number = 0xdeadbeef;
  let h2: number = 0x41c6ce57;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return `${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}:${text.length}`;
}

/*
 * Arguments written the same however the model ordered their keys or spaced
 * their JSON: {"b":1,"a":2} and { "a": 2, "b": 1 } are one call.
 */
export function canonicalArguments(value: unknown): string {
  let parsed: unknown = value;

  if (typeof value === "string") {
    const trimmed: string = value.trim();

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return stableStringify(parsed);
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((item: unknown): string => {
        return stableStringify(item);
      })
      .join(",")}]`;
  }

  if (typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;

    return `{${Object.keys(record)
      .sort()
      .map((key: string): string => {
        return `${JSON.stringify(key)}:${stableStringify(record[key])}`;
      })
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

export default class AgentLoopDetector {
  // What every call of the run returned: name, arguments and output.
  private seenResults: Set<string> = new Set<string>();
  // How many times each failing call failed the same way.
  private failures: Map<string, number> = new Map<string, number>();
  private roundsWithoutProgress: number = 0;
  // Told to change course in this streak of rounds without progress.
  private nudgedThisStreak: boolean = false;
  private repeatedFailure: { name: string; count: number } | null = null;

  /*
   * One round: the calls of one model response, as they ran. A round with
   * no call that ran (each was skipped) says nothing either way.
   */
  public recordRound(calls: Array<AgentLoopToolCall>): AgentLoopVerdict {
    if (calls.length === 0) {
      return AgentLoopVerdict.Continue;
    }

    let isProgress: boolean = false;

    for (const call of calls) {
      const callKey: string = `${call.name}\u0000${fingerprintText(
        canonicalArguments(call.arguments),
      )}`;
      const resultKey: string = `${callKey}\u0000${fingerprintText(
        call.output || "",
      )}`;

      if (!this.seenResults.has(resultKey)) {
        this.seenResults.add(resultKey);
        isProgress = true;
      }

      if (call.isError) {
        const count: number = (this.failures.get(resultKey) || 0) + 1;
        this.failures.set(resultKey, count);

        if (count >= REPEATED_FAILURE_LIMIT && !this.repeatedFailure) {
          this.repeatedFailure = { name: call.name, count };
        }
      }
    }

    if (this.repeatedFailure) {
      return AgentLoopVerdict.Stop;
    }

    if (isProgress) {
      this.roundsWithoutProgress = 0;
      this.nudgedThisStreak = false;
      return AgentLoopVerdict.Continue;
    }

    this.roundsWithoutProgress++;

    if (this.roundsWithoutProgress >= NO_PROGRESS_ROUNDS_BEFORE_STOP) {
      return AgentLoopVerdict.Stop;
    }

    if (
      this.roundsWithoutProgress >= NO_PROGRESS_ROUNDS_BEFORE_NUDGE &&
      !this.nudgedThisStreak
    ) {
      this.nudgedThisStreak = true;
      return AgentLoopVerdict.Nudge;
    }

    return AgentLoopVerdict.Continue;
  }

  public getRoundsWithoutProgress(): number {
    return this.roundsWithoutProgress;
  }

  // What the model is told when it should change course.
  public getNudgeInstruction(): string {
    return `Your last ${this.roundsWithoutProgress} rounds of tool calls returned only results you had already seen. Do not repeat them: try a different approach, or answer with what you have.`;
  }

  // Why it stopped the run, for the run's log.
  public describeStop(): string {
    if (this.repeatedFailure) {
      return `${this.repeatedFailure.name} failed the same way ${this.repeatedFailure.count} times with the same arguments`;
    }

    return `${this.roundsWithoutProgress} rounds of tool calls in a row returned nothing new`;
  }
}
