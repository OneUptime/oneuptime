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
 * agent may ask for more, up to ten minutes a command, the way coding
 * agents' shell tools let the model set a timeout. A command never runs
 * past the time the task has left.
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

// The argument the model sets a command's time limit with, in seconds.
export const AGENT_COMMAND_TIMEOUT_ARGUMENT: string = "timeout_seconds";

// What a command gets when the model asks for nothing else.
export const DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS: number = 120;

// The most a command may be given.
export const MAX_AGENT_COMMAND_TIMEOUT_SECONDS: number = 600;

// The least: a command is always given a second to start.
export const MIN_AGENT_COMMAND_TIMEOUT_SECONDS: number = 1;

/*
 * How often a command that is still running tells the server its run is
 * still working: well inside the sweeper's 12 minutes, even when a report
 * is lost on the way.
 */
export const AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS: number = 2 * 60 * 1000;

/*
 * The time limit the model asked for, in seconds: a whole number of them
 * between the least and the most a command may be given, or the default
 * when it asked for none (or for something that is not a number of
 * seconds). A number written as text ("300") is read as that number.
 */
export function getRequestedAgentCommandTimeoutSeconds(
  requested: unknown,
): number {
  const value: number =
    typeof requested === "number"
      ? requested
      : typeof requested === "string" && requested.trim().length > 0
        ? Number(requested.trim())
        : NaN;

  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS;
  }

  return Math.min(
    MAX_AGENT_COMMAND_TIMEOUT_SECONDS,
    Math.max(MIN_AGENT_COMMAND_TIMEOUT_SECONDS, Math.floor(value)),
  );
}

/*
 * How long a command may run, in milliseconds: what the model asked for,
 * and never past the time the task has left (`remainingMs`, when the task
 * has a deadline) - though always the least a command may be given, so a
 * command asked for in the task's last moments still starts and reports.
 */
export function getAgentCommandTimeoutMs(data: {
  requested: unknown;
  remainingMs?: number | undefined;
}): number {
  const requestedMs: number =
    getRequestedAgentCommandTimeoutSeconds(data.requested) * 1000;

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
 * had and, when it could have had longer, how to ask for it - so a slow
 * test suite is run again with a longer limit rather than given up on.
 */
export function describeAgentCommandTimedOut(timeoutMs: number): string {
  const sentence: string = `Command timed out after ${describeAgentCommandTimeout(timeoutMs)}.`;

  if (timeoutMs >= MAX_AGENT_COMMAND_TIMEOUT_SECONDS * 1000) {
    return sentence;
  }

  return `${sentence} If it needs longer, such as a slow install, build or test suite, run it again with ${AGENT_COMMAND_TIMEOUT_ARGUMENT} (at most ${MAX_AGENT_COMMAND_TIMEOUT_SECONDS}).`;
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
