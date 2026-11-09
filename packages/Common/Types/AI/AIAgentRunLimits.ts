/*
 * How far one AI run may go before it answers with what it has (issue
 * #6440: "Why is there a budget? Can we remove all of the artificial limits
 * by default, customers can add them if they need it").
 *
 * Nothing counts a healthy run down. By default a run - an incident or
 * alert investigation, an Ask AI answer, a Slack or Microsoft Teams answer,
 * a triage, a remediation plan or its execution, a code task on a Runner -
 * makes as many model calls and tool calls, and uses as many tokens, as its
 * work needs. What stops one:
 *
 *   - its time limit: DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES, unless the
 *     project set its own (Project Settings → AI → AI Features → More
 *     settings → Limits per run), or an incident or alert investigation
 *     time limit for that lane. A provider that hangs, or a model that never
 *     stops, cannot hold a worker or a Runner forever;
 *   - loop detection (AgentLoopDetector): the same failing call again and
 *     again, or round after round that shows the model nothing new;
 *   - Stop / Cancel, and the plan's quotas and the project's daily limits;
 *   - the caps a project chooses for itself, all unset by default: model
 *     calls, tool calls and tokens per run (Types/AI/ProjectAiRunLimits).
 *
 * The model's context window is not a limit on a run either: the oldest tool
 * results are elided as the transcript outgrows it (AgentContextCompactor).
 *
 * A run that stops at one of these says so, in a sentence OneUptime writes
 * (getStopNote) under its answer: which limit, and where it is changed. And
 * the model is only ever told about a limit the run really has - the
 * wrap-up instruction names the one it reached, and nothing in a prompt
 * speaks of a budget.
 *
 * Kept free of React and of server code: the server's agent loops and the
 * Runner's code agent read the same rules.
 */

/*
 * The time limit of a run when nothing else sets one: generous - far past
 * what a real investigation, answer or code change takes - so it stops only
 * a run that is stuck.
 */
export const DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES: number = 120;

// Bounds for a time limit a project sets, for every run or for one lane.
export const MIN_AI_RUN_TIME_LIMIT_IN_MINUTES: number = 1;
export const MAX_AI_RUN_TIME_LIMIT_IN_MINUTES: number = 24 * 60;

// The lane settings' names for the same bounds.
export const MIN_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES: number =
  MIN_AI_RUN_TIME_LIMIT_IN_MINUTES;
export const MAX_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES: number =
  MAX_AI_RUN_TIME_LIMIT_IN_MINUTES;

/*
 * The longest a Slack or Microsoft Teams answer may take, whatever the
 * project's time limit: a slash command's answer is posted to Slack's
 * response_url, which stops taking answers 30 minutes after the command.
 */
export const CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES: number = 25;

/*
 * Long command output is never cut before the model: it is shown a page at a
 * time (the server's ToolOutputPager). This is one page — roughly 10k
 * tokens, enough for a `kubectl describe node` of a busy node in one go.
 */
export const TOOL_OUTPUT_PAGE_CHARS: number = 40_000;

/*
 * Where every limit of a run is changed, as the sentences about them name
 * it - the card's title is "Limits per run".
 */
export const PROJECT_AI_RUN_LIMITS_LOCATION: string =
  "Project Settings → AI → AI Features → More settings → Limits per run";

export const INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION: string =
  "Incidents → AI → Settings → More settings → Investigation limits";

export const ALERT_AI_INVESTIGATION_LIMITS_LOCATION: string =
  "Alerts → AI → Settings → More settings → Investigation limits";

// What set a run's time limit, so the sentence that it stopped names it.
export enum AIRunTimeLimitSource {
  // DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES: nothing else set one.
  Default = "Default",
  // The project's Time Limit per Run.
  Project = "Project",
  // An incident investigation, held to the incident lane's time limit.
  IncidentInvestigation = "IncidentInvestigation",
  // An alert investigation, held to the alert lane's time limit.
  AlertInvestigation = "AlertInvestigation",
  // A Slack or Microsoft Teams answer: CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES.
  ChatApp = "ChatApp",
}

// Why a run was asked to answer now - or, for tokens, stopped.
export enum AIRunStopReason {
  TimeLimit = "TimeLimit",
  ModelCalls = "ModelCalls",
  ToolCalls = "ToolCalls",
  Tokens = "Tokens",
  // AgentLoopDetector: the run kept repeating itself.
  Loop = "Loop",
}

export interface AIAgentRunLimits {
  // The most model (LLM) calls the run may make; undefined is no cap.
  maxLlmCalls: number | undefined;
  // The most tool calls the run may make; undefined is no cap.
  maxToolCalls: number | undefined;
  /*
   * The most tokens the run may use, counted as OneUptime counts them
   * (AiTokenCount); undefined is no cap.
   */
  maxTokens: number | undefined;
  // Every run has a time limit.
  maxWallClockMs: number;
  timeLimitSource: AIRunTimeLimitSource;
}

// What a run has done so far, as its loop counts it.
export interface AIAgentRunUsage {
  llmCallCount: number;
  toolCallCount: number;
  tokenCount: number;
  /*
   * The tokens of the run's latest model call: what the next one will use at
   * least, since the conversation only grows.
   */
  lastCallTokenCount: number;
  startedAtMs: number;
  nowMs: number;
}

export interface AIRunStopDecision {
  reason: AIRunStopReason;
  /*
   * Whether the run makes one more model call - its answer, without tools.
   * Not for a token cap already reached: another call would only go further
   * past it, so the run stops where it is.
   */
  mayAnswer: boolean;
}

const MILLISECONDS_IN_A_MINUTE: number = 60 * 1000;

const ANSWER_NOW: string =
  "Answer now with the findings so far, clearly stating what you could and could not verify and what you would check next. Do not request more tools.";

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

function plural(count: number, one: string, other: string): string {
  return `${formatCount(count)} ${count === 1 ? one : other}`;
}

export default class AIAgentRunLimitsHelper {
  // No caps, and the default time limit.
  public static getDefault(): AIAgentRunLimits {
    return {
      maxLlmCalls: undefined,
      maxToolCalls: undefined,
      maxTokens: undefined,
      maxWallClockMs:
        DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES * MILLISECONDS_IN_A_MINUTE,
      timeLimitSource: AIRunTimeLimitSource.Default,
    };
  }

  /*
   * A configured time limit, as stored (minutes, nullable). Null,
   * undefined, zero, negative or non-numeric values all mean "not set": the
   * setting is opt-in, so anything that is not a usable positive number
   * leaves the run to the next limit in line (the project's, then the
   * default) rather than cutting it short. Positive values are clamped into
   * the supported range.
   */
  public static normalizeTimeLimitInMinutes(
    value: number | string | null | undefined,
  ): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const minutes: number =
      typeof value === "number" ? value : Number.parseFloat(value);

    if (!Number.isFinite(minutes) || minutes <= 0) {
      return null;
    }

    return Math.min(
      MAX_AI_RUN_TIME_LIMIT_IN_MINUTES,
      Math.max(MIN_AI_RUN_TIME_LIMIT_IN_MINUTES, Math.round(minutes)),
    );
  }

  /*
   * A cap a project set, as stored: a whole number of at least 1, or
   * undefined for none. Anything else - unset, empty, not a number, below
   * 1 - is no cap: the caps are opt-in, and a value the server would never
   * have saved does not stop a run.
   */
  public static normalizeCap(value: unknown): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    let parsed: number = Number.NaN;

    if (typeof value === "number") {
      parsed = value;
    } else if (typeof value === "string" && value.trim().length > 0) {
      parsed = Number(value.trim());
    }

    if (!Number.isFinite(parsed) || parsed < 1) {
      return undefined;
    }

    return Math.floor(parsed);
  }

  /*
   * A run's limits from what the project set: its caps, and the most
   * specific time limit - the lane's, for an investigation of that lane,
   * then the project's, then the default.
   */
  public static fromSettings(data: {
    maxModelCalls?: unknown;
    maxToolCalls?: unknown;
    maxTokens?: unknown;
    timeLimitInMinutes?: number | string | null | undefined;
    lane?:
      | {
          timeLimitInMinutes: number | string | null | undefined;
          source:
            | AIRunTimeLimitSource.IncidentInvestigation
            | AIRunTimeLimitSource.AlertInvestigation;
        }
      | undefined;
  }): AIAgentRunLimits {
    const laneMinutes: number | null = data.lane
      ? this.normalizeTimeLimitInMinutes(data.lane.timeLimitInMinutes)
      : null;
    const projectMinutes: number | null = this.normalizeTimeLimitInMinutes(
      data.timeLimitInMinutes,
    );

    let minutes: number = DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES;
    let source: AIRunTimeLimitSource = AIRunTimeLimitSource.Default;

    if (laneMinutes !== null && data.lane) {
      minutes = laneMinutes;
      source = data.lane.source;
    } else if (projectMinutes !== null) {
      minutes = projectMinutes;
      source = AIRunTimeLimitSource.Project;
    }

    return {
      maxLlmCalls: this.normalizeCap(data.maxModelCalls),
      maxToolCalls: this.normalizeCap(data.maxToolCalls),
      maxTokens: this.normalizeCap(data.maxTokens),
      maxWallClockMs: minutes * MILLISECONDS_IN_A_MINUTE,
      timeLimitSource: source,
    };
  }

  /*
   * The limits with a time limit no longer than `minutes`: a Slack or
   * Microsoft Teams answer keeps the project's caps, and its time is the
   * shorter of the project's and the chat app's.
   */
  public static withTimeCeiling(
    limits: AIAgentRunLimits,
    minutes: number,
    source: AIRunTimeLimitSource,
  ): AIAgentRunLimits {
    const ceilingMs: number = minutes * MILLISECONDS_IN_A_MINUTE;

    if (limits.maxWallClockMs <= ceilingMs) {
      return limits;
    }

    return { ...limits, maxWallClockMs: ceilingMs, timeLimitSource: source };
  }

  // The time limit in whole minutes, as the sentences about it say it.
  public static getTimeLimitInMinutes(limits: AIAgentRunLimits): number {
    return Math.max(
      1,
      Math.round(limits.maxWallClockMs / MILLISECONDS_IN_A_MINUTE),
    );
  }

  // When the run's time is up (epoch ms).
  public static getDeadlineAtMs(
    limits: Pick<AIAgentRunLimits, "maxWallClockMs">,
    startedAtMs: number,
  ): number {
    return startedAtMs + limits.maxWallClockMs;
  }

  public static isTimeUp(data: {
    maxWallClockMs: number;
    startedAtMs: number;
    nowMs: number;
  }): boolean {
    return data.nowMs - data.startedAtMs >= data.maxWallClockMs;
  }

  // Whether the project set any cap at all (the time limit aside).
  public static hasCaps(limits: AIAgentRunLimits): boolean {
    return (
      limits.maxLlmCalls !== undefined ||
      limits.maxToolCalls !== undefined ||
      limits.maxTokens !== undefined
    );
  }

  /*
   * Whether a run must stop calling tools now, and why - checked before each
   * model call. Null while it may go on. In order:
   *
   *   - its time is up: one more call, for the answer;
   *   - the next call is the last its model-call cap allows: that one is
   *     the answer (none left at all: it stops);
   *   - its token cap is reached: it stops, since any call goes past it;
   *   - its token cap would be reached by the next call (it uses at least
   *     what the last one did): that one is the answer;
   *   - its tool-call cap is reached: one more call, for the answer.
   */
  public static getStopDecision(
    limits: AIAgentRunLimits,
    usage: AIAgentRunUsage,
  ): AIRunStopDecision | null {
    if (
      this.isTimeUp({
        maxWallClockMs: limits.maxWallClockMs,
        startedAtMs: usage.startedAtMs,
        nowMs: usage.nowMs,
      })
    ) {
      return { reason: AIRunStopReason.TimeLimit, mayAnswer: true };
    }

    return this.getCapStopDecision(limits, usage);
  }

  /*
   * getStopDecision without the time limit: the caps alone, for a loop that
   * keeps its own deadline (the Runner's code agent, whose deadline the
   * server gives it).
   */
  public static getCapStopDecision(
    limits: AIAgentRunLimits,
    usage: Pick<
      AIAgentRunUsage,
      "llmCallCount" | "toolCallCount" | "tokenCount" | "lastCallTokenCount"
    >,
  ): AIRunStopDecision | null {
    if (limits.maxLlmCalls !== undefined) {
      if (usage.llmCallCount >= limits.maxLlmCalls) {
        return { reason: AIRunStopReason.ModelCalls, mayAnswer: false };
      }

      if (usage.llmCallCount >= limits.maxLlmCalls - 1) {
        return { reason: AIRunStopReason.ModelCalls, mayAnswer: true };
      }
    }

    if (limits.maxTokens !== undefined) {
      if (usage.tokenCount >= limits.maxTokens) {
        return { reason: AIRunStopReason.Tokens, mayAnswer: false };
      }

      if (usage.tokenCount + usage.lastCallTokenCount >= limits.maxTokens) {
        return { reason: AIRunStopReason.Tokens, mayAnswer: true };
      }
    }

    if (
      limits.maxToolCalls !== undefined &&
      usage.toolCallCount >= limits.maxToolCalls
    ) {
      return { reason: AIRunStopReason.ToolCalls, mayAnswer: true };
    }

    return null;
  }

  /*
   * Whether a run finishing an answer the model's output limit cut off may
   * make one more call for it, or which cap leaves it none: a cap the
   * project set holds while an answer is finished too, so a run never makes
   * more model calls, or uses more tokens, than the cap allows - the answer
   * keeps what it has, and the note under it names the cap. The time limit
   * and the tool-call cap leave a run its answer, and so its continuations.
   */
  public static getContinuationStopReason(
    limits: AIAgentRunLimits,
    usage: Pick<
      AIAgentRunUsage,
      "llmCallCount" | "toolCallCount" | "tokenCount" | "lastCallTokenCount"
    >,
  ): AIRunStopReason | null {
    const decision: AIRunStopDecision | null = this.getCapStopDecision(
      limits,
      usage,
    );

    return decision && !decision.mayAnswer ? decision.reason : null;
  }

  /*
   * Whether one more tool call of a batch may run, or why not: a model asks
   * for as many calls at once as it likes, so the tool-call cap and the
   * time limit hold inside a batch too.
   */
  public static getToolCallRefusal(
    limits: AIAgentRunLimits,
    data: { toolCallCount: number; startedAtMs: number; nowMs: number },
  ): AIRunStopReason | null {
    if (
      this.isTimeUp({
        maxWallClockMs: limits.maxWallClockMs,
        startedAtMs: data.startedAtMs,
        nowMs: data.nowMs,
      })
    ) {
      return AIRunStopReason.TimeLimit;
    }

    if (
      limits.maxToolCalls !== undefined &&
      data.toolCallCount >= limits.maxToolCalls
    ) {
      return AIRunStopReason.ToolCalls;
    }

    return null;
  }

  /*
   * What the model is told when it has to answer now: the limit it reached,
   * and nothing about any other. The run's own words - "this run" - fit an
   * investigation, an answer and a remediation alike.
   */
  public static getWrapUpInstruction(
    reason: AIRunStopReason,
    limits: AIAgentRunLimits,
  ): string {
    return `${this.getLimitReachedSentence(reason, limits)} ${ANSWER_NOW}`;
  }

  /*
   * The limit a run reached, in one sentence to the model: the start of a
   * wrap-up instruction, which goes on to say what the answer should hold
   * (getWrapUpInstruction's for an investigation or an answer; the code
   * agent's own for a summary of its changes).
   */
  public static getLimitReachedSentence(
    reason: AIRunStopReason,
    limits: AIAgentRunLimits,
  ): string {
    switch (reason) {
      case AIRunStopReason.TimeLimit:
        return `This run has reached its time limit of ${plural(this.getTimeLimitInMinutes(limits), "minute", "minutes")}.`;
      case AIRunStopReason.ModelCalls:
        return `This is the last model call this run may make: the project allows ${plural(limits.maxLlmCalls || 0, "model call", "model calls")} per run.`;
      case AIRunStopReason.ToolCalls:
        return `This run has made ${plural(limits.maxToolCalls || 0, "tool call", "tool calls")}, the most the project allows per run.`;
      case AIRunStopReason.Tokens:
        return `This run is about to reach the project's limit of ${plural(limits.maxTokens || 0, "token", "tokens")} per run.`;
      case AIRunStopReason.Loop:
        return "Your recent tool calls keep returning what you have already seen, so this run is going in circles.";
    }
  }

  /*
   * Why the server refuses a call of a run past one of its limits - a model
   * call, or a tool call it runs - in plain text that names the setting.
   * Only a run that ignored its limits gets one: the agent winds down
   * before them.
   */
  public static getRefusal(
    reason: AIRunStopReason,
    limits: AIAgentRunLimits,
  ): string {
    let sentence: string;

    switch (reason) {
      case AIRunStopReason.TimeLimit:
        sentence = `This run has reached its time limit of ${plural(this.getTimeLimitInMinutes(limits), "minute", "minutes")}, so it may make no more calls.`;
        break;
      case AIRunStopReason.ModelCalls:
        sentence = `This run has made ${plural(limits.maxLlmCalls || 0, "model call", "model calls")}, this project's limit per run, so it may make no more.`;
        break;
      case AIRunStopReason.ToolCalls:
        sentence = `This run has made ${plural(limits.maxToolCalls || 0, "tool call", "tool calls")}, this project's limit per run, so it may make no more.`;
        break;
      case AIRunStopReason.Tokens:
        sentence = `This run has used this project's limit of ${plural(limits.maxTokens || 0, "token", "tokens")} per run, so it may make no more calls.`;
        break;
      case AIRunStopReason.Loop:
        sentence =
          "This run kept repeating calls that showed it nothing new, so it was stopped.";
        break;
    }

    const location: string | null = this.getSettingLocation(reason, limits);

    return location ? `${sentence} Change it in ${location}.` : sentence;
  }

  // What a tool call the run may no longer make returns to the model.
  public static getSkippedToolCallText(
    reason: AIRunStopReason,
    limits: AIAgentRunLimits,
  ): string {
    switch (reason) {
      case AIRunStopReason.TimeLimit:
        return `Skipped: this run has reached its time limit of ${plural(this.getTimeLimitInMinutes(limits), "minute", "minutes")}. Answer with the data you already have.`;
      case AIRunStopReason.ToolCalls:
        return `Skipped: this run has made ${plural(limits.maxToolCalls || 0, "tool call", "tool calls")}, the most the project allows per run. Answer with the data you already have.`;
      case AIRunStopReason.ModelCalls:
        return `Skipped: this run has reached the project's limit of ${plural(limits.maxLlmCalls || 0, "model call", "model calls")} per run. Answer with the data you already have.`;
      case AIRunStopReason.Tokens:
        return `Skipped: this run has reached the project's limit of ${plural(limits.maxTokens || 0, "token", "tokens")} per run. Answer with the data you already have.`;
      case AIRunStopReason.Loop:
        return "Skipped: this run is going in circles. Answer with the data you already have.";
    }
  }

  /*
   * Where the limit that stopped a run is changed, or null when it is not a
   * setting (a chat app's answer window, loop detection).
   */
  public static getSettingLocation(
    reason: AIRunStopReason,
    limits: AIAgentRunLimits,
  ): string | null {
    if (reason === AIRunStopReason.Loop) {
      return null;
    }

    if (reason !== AIRunStopReason.TimeLimit) {
      return PROJECT_AI_RUN_LIMITS_LOCATION;
    }

    switch (limits.timeLimitSource) {
      case AIRunTimeLimitSource.ChatApp:
        return null;
      case AIRunTimeLimitSource.IncidentInvestigation:
        return INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION;
      case AIRunTimeLimitSource.AlertInvestigation:
        return ALERT_AI_INVESTIGATION_LIMITS_LOCATION;
      case AIRunTimeLimitSource.Project:
      case AIRunTimeLimitSource.Default:
        return PROJECT_AI_RUN_LIMITS_LOCATION;
    }
  }

  /*
   * The sentence OneUptime writes under the answer of a run a limit stopped:
   * which limit, and where to change it - linked when the server knows the
   * Dashboard's address. Markdown. Never written by the model.
   */
  public static getStopNote(data: {
    reason: AIRunStopReason;
    limits: AIAgentRunLimits;
    // The setting's page in the Dashboard, when it has one.
    settingsUrl?: string | null | undefined;
  }): string {
    const limits: AIAgentRunLimits = data.limits;
    const minutes: number = this.getTimeLimitInMinutes(limits);
    let sentence: string;

    switch (data.reason) {
      case AIRunStopReason.ModelCalls:
        sentence = `This run stopped at this project's limit of ${plural(limits.maxLlmCalls || 0, "model call", "model calls")} per run.`;
        break;
      case AIRunStopReason.ToolCalls:
        sentence = `This run stopped at this project's limit of ${plural(limits.maxToolCalls || 0, "tool call", "tool calls")} per run.`;
        break;
      case AIRunStopReason.Tokens:
        sentence = `This run stopped at this project's limit of ${plural(limits.maxTokens || 0, "token", "tokens")} per run.`;
        break;
      case AIRunStopReason.Loop:
        sentence =
          "This run stopped early: it kept repeating calls that showed it nothing new.";
        break;
      case AIRunStopReason.TimeLimit:
        switch (limits.timeLimitSource) {
          case AIRunTimeLimitSource.Default:
            sentence = `This run stopped at the time limit of ${plural(minutes, "minute", "minutes")} per run, the default.`;
            break;
          case AIRunTimeLimitSource.Project:
            sentence = `This run stopped at this project's time limit of ${plural(minutes, "minute", "minutes")} per run.`;
            break;
          case AIRunTimeLimitSource.IncidentInvestigation:
            sentence = `This investigation stopped at the incident investigation time limit of ${plural(minutes, "minute", "minutes")}.`;
            break;
          case AIRunTimeLimitSource.AlertInvestigation:
            sentence = `This investigation stopped at the alert investigation time limit of ${plural(minutes, "minute", "minutes")}.`;
            break;
          case AIRunTimeLimitSource.ChatApp:
            sentence = `This answer stopped after ${plural(minutes, "minute", "minutes")}, the longest a chat answer may take. Ask AI in the Dashboard can take longer.`;
            break;
        }
        break;
    }

    const location: string | null = this.getSettingLocation(
      data.reason,
      limits,
    );

    if (!location) {
      return `_${sentence}_`;
    }

    const where: string = data.settingsUrl
      ? `[${location}](${data.settingsUrl})`
      : location;

    return `_${sentence} Change it in ${where}._`;
  }

  // A lane's time limit, in words, for its settings page and run details.
  public static describeTimeLimit(
    value: number | string | null | undefined,
  ): string {
    const minutes: number | null = this.normalizeTimeLimitInMinutes(value);

    if (minutes === null) {
      return `Uses the project's time limit per run: ${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES} minutes unless the project set its own.`;
    }

    return `Stops investigating after ${plural(minutes, "minute", "minutes")} and reports what it found.`;
  }
}
