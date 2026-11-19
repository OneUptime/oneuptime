/*
 * HOW LONG A COMMAND THE CODE AGENT COMPOSES MAY RUN, AND HOW ITS RUN IS
 * KEPT ALIVE WHILE IT DOES.
 *
 * On a Runner of the project's own the code agent builds and tests its
 * change the way the repository says to (RepositoryInstructions), with
 * commands it composes (InHouseCodeAgent.toolRunCommand). Most finish in
 * seconds, so a command gets two minutes: a command that hangs - a dev
 * server, a test runner in watch mode, a prompt nobody answers - costs no
 * more than that. A slow install, build or test suite needs longer, so the
 * agent may ask for more, the way coding agents' shell tools let the model
 * set a timeout: up to ten minutes a command, or up to the project's own
 * Time Limit per Command (issue #6532: Project Settings → AI → AI Features →
 * More settings → Limits per run), which the server sends with the run's
 * limits and which goes no higher than two hours. A command never runs past
 * the time the task has left.
 *
 * A command makes no LLM call and posts no log of its own, and the
 * server's stale-run sweeper fails a code-fix run whose heartbeat has been
 * quiet for 12 minutes (RUN_HEARTBEAT_TIMEOUT_MINUTES in
 * App/FeatureSet/Workers/Jobs/AIChat/TimeoutStuckRuns.ts) - a long command
 * plus the model call before it would pass that. So while a command runs,
 * the Runner tells the server every two minutes that the run is still
 * working (the update-task-status route's InProgress report, which only
 * refreshes the run's heartbeat and adds nothing to its trail).
 *
 * Pure, so the agent, its tests and the docs' facts suite read one place.
 */

import AIAgentRunLimitsHelper, {
  DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES,
  MAX_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES,
  PROJECT_AI_RUN_LIMITS_LOCATION,
} from "Common/Types/AI/AIAgentRunLimits";

// The argument the model sets a command's time limit with, in seconds.
export const AGENT_COMMAND_TIMEOUT_ARGUMENT: string = "timeout_seconds";

// What a command gets when the model asks for nothing else.
export const DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS: number = 120;

/*
 * The most a command may be given when the project set no Time Limit per
 * Command (or the server does not say): ten minutes.
 */
export const MAX_AGENT_COMMAND_TIMEOUT_SECONDS: number =
  DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES * 60;

// The most any project may let a command run: two hours.
export const CEILING_AGENT_COMMAND_TIMEOUT_SECONDS: number =
  MAX_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES * 60;

// The least: a command is always given a second to start.
export const MIN_AGENT_COMMAND_TIMEOUT_SECONDS: number = 1;

/*
 * How often a command that is still running tells the server its run is
 * still working: well inside the sweeper's 12 minutes, even when a report
 * is lost on the way.
 */
export const AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS: number = 2 * 60 * 1000;

/*
 * How long the output of a command that has exited may still arrive. The
 * last of it - a test run's failures and its summary - can still be in the
 * pipe when the command exits, and is read just after. A program the
 * command left running (a server started in the background) holds the
 * pipe open, so its output may never end: past this, the command is done
 * with what has arrived.
 */
export const AGENT_COMMAND_OUTPUT_DRAIN_GRACE_MS: number = 2 * 1000;

/*
 * The most one command may be given, in whole seconds: the project's Time
 * Limit per Command (`commandTimeLimitInMinutes`, as the server sends it -
 * ten minutes when it sends none), never past the ceiling, and never past
 * `atMostMs` when given: the run's own time limit, or a step's, which no
 * command outlasts. Never less than the least a command may be given.
 */
export function getAgentCommandMaxSeconds(data: {
  commandTimeLimitInMinutes?: number | null | undefined;
  atMostMs?: number | null | undefined;
}): number {
  const minutes: number =
    AIAgentRunLimitsHelper.normalizeCommandTimeLimitInMinutes(
      data.commandTimeLimitInMinutes,
    ) ?? DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES;

  let seconds: number = Math.min(
    CEILING_AGENT_COMMAND_TIMEOUT_SECONDS,
    minutes * 60,
  );

  if (
    data.atMostMs !== null &&
    data.atMostMs !== undefined &&
    Number.isFinite(data.atMostMs) &&
    data.atMostMs > 0
  ) {
    seconds = Math.min(seconds, Math.floor(data.atMostMs / 1000));
  }

  return Math.max(MIN_AGENT_COMMAND_TIMEOUT_SECONDS, seconds);
}

// What a command gets when the model asks for nothing, under a most of `maxSeconds`.
export function getDefaultAgentCommandTimeoutSeconds(
  maxSeconds: number = MAX_AGENT_COMMAND_TIMEOUT_SECONDS,
): number {
  return Math.min(DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS, maxSeconds);
}

/*
 * The time limit the model asked for, in seconds: a whole number of them
 * between the least and the most a command may be given here (`maxSeconds`,
 * getAgentCommandMaxSeconds: ten minutes unless the project set its own),
 * or the default when it asked for none (or for something that is not a
 * number of seconds). A number written as text ("300") is read as that
 * number.
 */
export function getRequestedAgentCommandTimeoutSeconds(
  requested: unknown,
  maxSeconds: number = MAX_AGENT_COMMAND_TIMEOUT_SECONDS,
): number {
  const value: number =
    typeof requested === "number"
      ? requested
      : typeof requested === "string" && requested.trim().length > 0
        ? Number(requested.trim())
        : NaN;

  if (!Number.isFinite(value) || value <= 0) {
    return getDefaultAgentCommandTimeoutSeconds(maxSeconds);
  }

  return Math.min(
    maxSeconds,
    Math.max(MIN_AGENT_COMMAND_TIMEOUT_SECONDS, Math.floor(value)),
  );
}

/*
 * How long a command may run, in milliseconds: what the model asked for,
 * up to the most a command may be given here (`maxSeconds`), and never past
 * the time the task has left (`remainingMs`, when the task has a deadline) -
 * though always the least a command may be given, so a command asked for in
 * the task's last moments still starts and reports.
 */
export function getAgentCommandTimeoutMs(data: {
  requested: unknown;
  remainingMs?: number | undefined;
  maxSeconds?: number | undefined;
}): number {
  const requestedMs: number =
    getRequestedAgentCommandTimeoutSeconds(
      data.requested,
      data.maxSeconds ?? MAX_AGENT_COMMAND_TIMEOUT_SECONDS,
    ) * 1000;

  if (data.remainingMs === undefined || !Number.isFinite(data.remainingMs)) {
    return requestedMs;
  }

  return Math.max(
    MIN_AGENT_COMMAND_TIMEOUT_SECONDS * 1000,
    Math.min(requestedMs, Math.floor(data.remainingMs)),
  );
}

// "2 minutes", "90 seconds", "1 second": a time limit as the model reads it.
export function describeAgentCommandTimeout(timeoutMs: number): string {
  const seconds: number = Math.max(0, Math.round(timeoutMs / 1000));

  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes: number = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/*
 * What the model is told about a command that ran out of time: how long it
 * had and what to do now -
 *
 *   - given less than it asked for, because the task's time was nearly up
 *     (`heldToTimeLeft`): that was all the time left, and asking for longer
 *     will not help;
 *   - given the most a command may be given here (`maxSeconds`): run a
 *     smaller part of it and, if the whole of it must run, say so - naming
 *     the project's Time Limit per Command, which gives a command longer,
 *     while it is below the ceiling;
 *   - otherwise: how to ask for longer, so a slow test suite is run again
 *     with a longer limit rather than given up on.
 */
export function describeAgentCommandTimedOut(data: {
  timeoutMs: number;
  maxSeconds?: number | undefined;
  heldToTimeLeft?: boolean | undefined;
}): string {
  const timeoutMs: number = data.timeoutMs;
  const maxSeconds: number =
    data.maxSeconds ?? MAX_AGENT_COMMAND_TIMEOUT_SECONDS;
  const took: string = describeAgentCommandTimeout(timeoutMs);

  if (data.heldToTimeLeft) {
    return `Command timed out after ${took}: that was all the time this task had left.`;
  }

  if (timeoutMs >= maxSeconds * 1000) {
    const sentence: string = `Command timed out after ${took}, the longest a command may run here. Run a smaller part of it, such as one test file or one package.`;

    if (maxSeconds >= CEILING_AGENT_COMMAND_TIMEOUT_SECONDS) {
      return sentence;
    }

    return `${sentence} If the whole of it must run, say so in your summary: the project's Time Limit per Command (${PROJECT_AI_RUN_LIMITS_LOCATION}) lets a command run for up to ${describeAgentCommandTimeout(
      CEILING_AGENT_COMMAND_TIMEOUT_SECONDS * 1000,
    )}.`;
  }

  return `Command timed out after ${took}. If it needs longer, such as a slow install, build or test suite, run it again with ${AGENT_COMMAND_TIMEOUT_ARGUMENT} (at most ${maxSeconds}).`;
}

/*
 * Call `beat` every `intervalMs` until the returned stop is called. A beat
 * that fails is dropped: the next one tries again, and a keep-alive must
 * never break the command it keeps alive.
 */
export function startAgentCommandKeepAlive(data: {
  intervalMs?: number | undefined;
  beat: () => Promise<void>;
}): () => void {
  const timer: ReturnType<typeof setInterval> = setInterval(() => {
    let beating: Promise<void>;

    try {
      beating = data.beat();
    } catch {
      return;
    }

    beating.catch(() => {
      // Dropped: the next beat tries again.
    });
  }, data.intervalMs ?? AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS);

  return (): void => {
    clearInterval(timer);
  };
}
