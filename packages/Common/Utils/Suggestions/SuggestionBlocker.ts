import { CodeTaskBlocker, CodeTaskBlockerType } from "../../Types/AI/CodeTask";
import { JSONObject } from "../../Types/JSON";

/*
 * WHAT STANDS BETWEEN A PERSON AND AN AI FIX A PAGE WOULD OFFER - Code's
 * gate (CodeTaskGate) as a suggestion carries it on the wire: the bill or
 * the plan, AI credits or an LLM provider, the project's daily AI limits, a
 * Runner online, a repository OneUptime can reach. A SetUp offer draws it in
 * Code's own words (the Dashboard's CodeBlockerNotice), with the one step
 * that clears it - so a fix the click would only queue to fail is never
 * offered as if it would work.
 *
 * One reader for every suggestion that carries one (a telemetry finding's
 * Fix with AI, a trace's Fix performance with AI): the page never draws a
 * set-up step the answer does not fully name.
 */
export interface SuggestionBlocker extends CodeTaskBlocker {
  // The repository Code's gate was asked about, when it was asked about one.
  repositoryId?: string | undefined;
}

// Code's gate's answer as a suggestion carries it.
export function toSuggestionBlocker(
  blocker: CodeTaskBlocker,
  repositoryId?: string | null | undefined,
): SuggestionBlocker {
  return {
    type: blocker.type,
    message: blocker.message,
    ...(blocker.runnerName ? { runnerName: blocker.runnerName } : {}),
    ...(repositoryId ? { repositoryId } : {}),
  };
}

function isBlockerType(value: unknown): value is CodeTaskBlockerType {
  return (
    typeof value === "string" &&
    (Object.values(CodeTaskBlockerType) as Array<string>).includes(value)
  );
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/*
 * Reads a blocker off the wire, or null when it is not one this build can
 * draw: a type it does not know, or no sentence to fall back on.
 */
export function parseSuggestionBlocker(
  value: unknown,
): SuggestionBlocker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;

  if (!isBlockerType(record["type"])) {
    return null;
  }

  const message: string | null = readText(record["message"]);

  if (!message) {
    return null;
  }

  const blocker: SuggestionBlocker = {
    type: record["type"] as CodeTaskBlockerType,
    message,
  };

  const runnerName: string | null = readText(record["runnerName"]);

  if (runnerName) {
    blocker.runnerName = runnerName;
  }

  const repositoryId: string | null = readText(record["repositoryId"]);

  if (repositoryId) {
    blocker.repositoryId = repositoryId;
  }

  return blocker;
}

// A blocker as JSON (the server's side of the reader above).
export function suggestionBlockerToJSON(
  blocker: SuggestionBlocker,
): JSONObject {
  return {
    type: blocker.type,
    message: blocker.message,
    ...(blocker.runnerName ? { runnerName: blocker.runnerName } : {}),
    ...(blocker.repositoryId ? { repositoryId: blocker.repositoryId } : {}),
  };
}
