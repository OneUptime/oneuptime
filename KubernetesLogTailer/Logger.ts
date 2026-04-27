import { LOG_LEVEL } from "./Config";

type Level = "debug" | "info" | "warn" | "error";

const levelRank: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredRank: number =
  levelRank[(LOG_LEVEL as Level) in levelRank ? (LOG_LEVEL as Level) : "info"];

const emit: (
  level: Level,
  message: string,
  extra?: Record<string, unknown>,
) => void = (
  level: Level,
  message: string,
  extra?: Record<string, unknown>,
): void => {
  if (levelRank[level] < configuredRank) {
    return;
  }
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(extra || {}),
  };
  const out: string = JSON.stringify(payload);
  if (level === "error" || level === "warn") {
    // eslint-disable-next-line no-console
    console.error(out);
  } else {
    // eslint-disable-next-line no-console
    console.log(out);
  }
};

const Logger: {
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
} = {
  debug: (msg: string, extra?: Record<string, unknown>): void => {
    emit("debug", msg, extra);
  },
  info: (msg: string, extra?: Record<string, unknown>): void => {
    emit("info", msg, extra);
  },
  warn: (msg: string, extra?: Record<string, unknown>): void => {
    emit("warn", msg, extra);
  },
  error: (msg: string, extra?: Record<string, unknown>): void => {
    emit("error", msg, extra);
  },
};

export default Logger;
