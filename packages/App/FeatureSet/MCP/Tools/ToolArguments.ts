/**
 * Tool Arguments
 * Reading the arguments of a tool written by hand (WorkflowTools, MoveInList):
 * a missing or malformed one is thrown, and the agent reads the message as a
 * failed call it can correct (ToolHandler's buildErrorResult).
 */

import ObjectID from "Common/Types/ObjectID";

// An ID the tool puts in a path or a query: a UUID, or the call is refused.
export function requireUuid(
  args: Record<string, unknown>,
  key: string,
): string {
  const value: unknown = args[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`'${key}' is required.`);
  }
  if (!ObjectID.isValidUUID(value)) {
    throw new Error(
      `'${key}' must be a UUID like "550e8400-e29b-41d4-a716-446655440000". Use the corresponding list tool to find valid IDs.`,
    );
  }
  return value;
}

// Text the tool needs, with something in it besides spaces.
export function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value: unknown = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`'${key}' is required.`);
  }
  return value;
}
