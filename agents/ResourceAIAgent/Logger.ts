/*
 * One JSON object per line on stdout (debug, info) or stderr (warn, error),
 * like the other OneUptime agents, so `docker logs <the ai-agent container>`
 * reads cleanly and log pipelines can parse it.
 *
 * The level is read from LOG_LEVEL once, lazily, so importing this module
 * never depends on the environment being ready. Tests swap the sink to
 * assert what was logged (and how often).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  ts: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

export type LogFunction = (
  message: string,
  extra?: Record<string, unknown>,
) => void;

/*
 * What an executor (or anything else handed a logger) may call. The
 * agent's Logger is one; a test can pass a recording one instead.
 */
export interface AgentLogger {
  debug: LogFunction;
  info: LogFunction;
  warn: LogFunction;
  error: LogFunction;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// "silent" is for tests: nothing reaches the sink.
const SILENT_RANK: number = 100;

export function parseLogLevel(value: string | undefined): LogLevel {
  const normalized: string = (value || "").trim().toLowerCase();

  return normalized in LEVEL_RANK ? (normalized as LogLevel) : "info";
}

const consoleSink: LogSink = (record: LogRecord): void => {
  const line: string = JSON.stringify(record);

  if (record.level === "error" || record.level === "warn") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
};

let configuredRank: number | null = null;
let sink: LogSink = consoleSink;

function getRank(): number {
  if (configuredRank === null) {
    configuredRank = LEVEL_RANK[parseLogLevel(process.env["LOG_LEVEL"])];
  }

  return configuredRank;
}

function emit(
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
): void {
  if (LEVEL_RANK[level] < getRank()) {
    return;
  }

  sink({
    ...(extra || {}),
    ts: new Date().toISOString(),
    level,
    message,
  });
}

const Logger: AgentLogger & {
  setLevel: (level: LogLevel | "silent") => void;
  setSink: (next: LogSink | null) => void;
} = {
  debug: (message: string, extra?: Record<string, unknown>): void => {
    emit("debug", message, extra);
  },
  info: (message: string, extra?: Record<string, unknown>): void => {
    emit("info", message, extra);
  },
  warn: (message: string, extra?: Record<string, unknown>): void => {
    emit("warn", message, extra);
  },
  error: (message: string, extra?: Record<string, unknown>): void => {
    emit("error", message, extra);
  },
  setLevel: (level: LogLevel | "silent"): void => {
    configuredRank = level === "silent" ? SILENT_RANK : LEVEL_RANK[level];
  },
  // null restores the console.
  setSink: (next: LogSink | null): void => {
    sink = next || consoleSink;
  },
};

export default Logger;
