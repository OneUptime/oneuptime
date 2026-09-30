import Logger, { AgentLogger, LogRecord } from "../../Logger";
import { AgentConfig, parseConfig } from "../../Config";
import { SleepFunction } from "../../Sleep";

/*
 * Shared bits for the agent's tests. Importing this module silences the
 * logger (tests that assert on logs capture them with captureLogs).
 */

Logger.setLevel("silent");

export interface CapturedLogs {
  records: Array<LogRecord>;
  messages: (level?: string) => Array<string>;
  restore: () => void;
}

// Capture every log record from now on (all levels) until restore().
export function captureLogs(): CapturedLogs {
  const records: Array<LogRecord> = [];

  Logger.setLevel("debug");
  Logger.setSink((record: LogRecord): void => {
    records.push(record);
  });

  return {
    records,
    messages: (level?: string): Array<string> => {
      return records
        .filter((record: LogRecord): boolean => {
          return !level || record.level === level;
        })
        .map((record: LogRecord): string => {
          return record.message;
        });
    },
    restore: (): void => {
      Logger.setSink(null);
      Logger.setLevel("silent");
    },
  };
}

// A logger that records what an executor logged, without the global sink.
export interface RecordingLogger extends AgentLogger {
  records: Array<{ level: string; message: string }>;
}

export function recordingLogger(): RecordingLogger {
  const records: Array<{ level: string; message: string }> = [];
  const log: (level: string) => (message: string) => void = (
    level: string,
  ): ((message: string) => void) => {
    return (message: string): void => {
      records.push({ level, message });
    };
  };

  return {
    records,
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
  };
}

/*
 * A sleep that records what it was asked to wait and returns at once, so
 * backoff schedules measured in minutes run in milliseconds. A test that
 * needs a pause yields with realSleep.
 */
export interface RecordingSleep {
  sleep: SleepFunction;
  delays: Array<number>;
}

export function recordingSleep(): RecordingSleep {
  const delays: Array<number> = [];

  return {
    delays,
    sleep: (ms: number, signal?: AbortSignal): Promise<void> => {
      delays.push(ms);
      // Yield a turn so loops interleave the way real waits would.
      return new Promise<void>((resolve: () => void): void => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        setImmediate(resolve);
      });
    },
  };
}

export function realSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}

// Poll until the condition holds (or fail after timeoutMs).
export async function eventually(
  condition: () => boolean,
  timeoutMs: number = 5_000,
  description: string = "condition",
): Promise<void> {
  const deadline: number = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await realSleep(10);
  }
}

// The Docker host every test agent serves unless it says otherwise.
export const TEST_RESOURCE_NAME: string = "web-host-1";

// The environment of a complete, valid Docker host agent.
export function testEnv(
  oneuptimeUrl: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    ONEUPTIME_URL: oneuptimeUrl,
    ONEUPTIME_SERVICE_TOKEN: "ingestion-key-1",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "docker",
    DOCKER_HOST_NAME: TEST_RESOURCE_NAME,
    APP_VERSION: "14.0.8",
    ...overrides,
  };
}

// A complete, valid configuration for the given OneUptime URL.
export function testConfig(
  oneuptimeUrl: string,
  overrides: Record<string, string> = {},
): AgentConfig {
  return parseConfig(testEnv(oneuptimeUrl, overrides)).config;
}
