import { DatabaseSettings } from "./DatabaseSettings";
import { OutputSection } from "./DatabaseOutput";
import {
  DatabaseParamSpec,
  ParsedDatabaseCommand,
} from "../../Common/Utils/AiRemediation/Resource/DatabaseDiagnosticCatalog";

/*
 * What every engine's diagnostics module (PostgresDiagnostics,
 * MySqlDiagnostics, RedisDiagnostics, MongoDiagnostics) receives and
 * answers. The executor connects, hands the parsed catalog command over,
 * and turns the outcome into the job's result:
 *
 *   ok       it ran and answered: exit code 0, the sections as output;
 *   failed   it ran, and the server answered with a problem the module
 *            understood (no such setting, a signal that did not land):
 *            exit code 1, the sections plus the reason;
 *   notRun   it stopped before changing anything (the session is this
 *            agent's own, it does not exist, it is an internal process):
 *            no exit code and no output, which the server reads as
 *            "never ran".
 * Anything a module does not understand it throws, and the executor
 * describes the driver's error (exit code 1: the command reached the
 * server).
 */

// How the agent names itself to the server: application_name, client name, appName.
export const DATABASE_AI_AGENT_APPLICATION_NAME: string =
  "oneuptime-database-ai-agent";

export interface DiagnosticRun {
  command: ParsedDatabaseCommand;
  settings: DatabaseSettings;
  // The server-side limit for each statement (always below the job's budget).
  statementTimeoutMs: number;
  // How long a statement may wait for a lock (never longer than the statement).
  lockTimeoutMs: number;
  // How long a write waits before it looks at its target again.
  settleMs: number;
  sleep: (ms: number) => Promise<void>;
}

export type DiagnosticOutcome =
  | { status: "ok"; sections: Array<OutputSection> }
  | { status: "failed"; sections: Array<OutputSection>; reason: string }
  | { status: "notRun"; reason: string };

export interface EngineProbe {
  // "PostgreSQL 16.4", "MariaDB 11.4.2", "Valkey 8.0.1", "MongoDB 8.0.3".
  toolVersion: string | null;
  details: Record<string, string | number | boolean | null>;
}

export function ok(sections: Array<OutputSection>): DiagnosticOutcome {
  return { status: "ok", sections };
}

export function failed(
  reason: string,
  sections: Array<OutputSection> = [],
): DiagnosticOutcome {
  return { status: "failed", sections, reason };
}

export function notRun(reason: string): DiagnosticOutcome {
  return { status: "notRun", reason };
}

// "Refused by the Database AI agent: ..." for a write stopped before it changed anything.
export function refusedByAgent(reason: string): DiagnosticOutcome {
  return notRun(`Refused by the Database AI agent: ${reason}`);
}

/*
 * An Integer flag's value: the one given, else the catalog's default for
 * it, else `fallback`.
 */
export function flagInteger(
  command: ParsedDatabaseCommand,
  name: string,
  fallback: number,
): number {
  const given: unknown = command.flags[name];

  if (typeof given === "number" && Number.isFinite(given)) {
    return given;
  }

  const spec: DatabaseParamSpec | undefined = command.operation.flags.find(
    (flag: DatabaseParamSpec): boolean => {
      return flag.name === name;
    },
  );

  return spec && typeof spec.defaultValue === "number"
    ? spec.defaultValue
    : fallback;
}

// A string flag's value, or null when it was not given.
export function flagString(
  command: ParsedDatabaseCommand,
  name: string,
): string | null {
  const given: unknown = command.flags[name];
  return typeof given === "string" && given !== "" ? given : null;
}

// The argument as a string, or null.
export function argumentString(command: ParsedDatabaseCommand): string | null {
  return command.argument === null || command.argument === undefined
    ? null
    : String(command.argument);
}

/*
 * The session id a write names: a positive whole number of at most 15
 * digits (the catalog's SessionId), re-checked here because it is the one
 * value that reaches a KILL. Null when it is anything else.
 */
export function sessionIdOf(command: ParsedDatabaseCommand): number | null {
  const value: unknown = command.argument;

  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    String(value).length <= 15
    ? value
    : null;
}

// A number from a driver value (numbers, numeric strings, bigint); null otherwise.
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

// A driver error's code (SQLSTATE, errno name, Mongo code), as a string.
export function errorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") {
    return null;
  }

  const code: unknown = (err as Record<string, unknown>)["code"];

  if (typeof code === "string" && code) {
    return code;
  }

  return typeof code === "number" ? String(code) : null;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  return typeof err === "string" ? err : String(err);
}

/*
 * The error's numeric code where the driver keeps one apart (mysql2's
 * errno, MongoDB's code).
 */
export function errorNumber(err: unknown, field: string): number | null {
  if (!err || typeof err !== "object") {
    return null;
  }

  const value: unknown = (err as Record<string, unknown>)[field];
  return typeof value === "number" ? value : null;
}
