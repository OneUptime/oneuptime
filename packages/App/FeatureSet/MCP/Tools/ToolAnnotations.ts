/**
 * Tool Annotations
 *
 * The hints every tool carries, each one stated outright. Clients read them
 * to decide what to run without asking: Claude runs a read-only tool on its
 * own and always asks before a destructive one. MCP directories hold every
 * tool to them: the Claude Connectors Directory requires a readOnlyHint or a
 * destructiveHint on each tool, and ChatGPT's app directory requires
 * readOnlyHint, destructiveHint and openWorldHint, each set to true or false.
 *
 * Every tool that changes something is destructive. Most writes in OneUptime
 * overwrite or delete a record, move an incident or an alert to another
 * state, page someone on call, or post to a status page, and the directories
 * allow destructiveHint: false only for a write that adds and sends nothing.
 * So a client asks before each write, whatever model the tool was made for.
 *
 * A tool is open-world only when it reaches past the caller's project: the
 * public status page tools read any public status page on the instance,
 * without a credential. Every other tool works inside the one project its
 * credential belongs to.
 */

import { ToolAnnotations } from "../Types/McpTypes";

// A tool that changes nothing.
export function readOnlyToolAnnotations(options?: {
  // It reads public status pages beyond the caller's project.
  openWorld?: boolean | undefined;
}): ToolAnnotations {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: options?.openWorld === true,
  };
}

// A tool that changes something in the caller's project.
export function writeToolAnnotations(options?: {
  // Calling it again with the same arguments changes nothing more.
  idempotent?: boolean | undefined;
}): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
    ...(options?.idempotent ? { idempotentHint: true } : {}),
  };
}
