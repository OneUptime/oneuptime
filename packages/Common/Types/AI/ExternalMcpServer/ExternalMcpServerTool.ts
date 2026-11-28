import {
  MAX_EXTERNAL_MCP_SERVER_TOOLS,
  MAX_EXTERNAL_MCP_TOOL_DESCRIPTION_CHARS,
  MAX_EXTERNAL_MCP_TOOL_NAME_CHARS,
} from "./ExternalMcpServerLimits";
import {
  ExternalMcpToolMarkRefusal,
  isExternalMcpToolFingerprint,
  readExternalMcpToolMarkRefusal,
} from "./ExternalMcpToolReadOnlyMark";

/*
 * THE TOOLS AN EXTERNAL MCP SERVER OFFERS, as OneUptime last read them
 * (ExternalMcpServer.tools): what the server's page lists, and what tells
 * OneUptime AI which tools only read.
 *
 * A tool "only reads" when the server says so - its annotations carry
 * `readOnlyHint: true` - or when a Project Admin marked it read-only and it
 * is as it was then (ExternalMcpToolReadOnlyMark, issue #11081). That is
 * the only tool an investigation may call - an investigation never changes
 * anything. Every other tool may change something, so OneUptime AI uses it
 * only to fix, and only the way the auto remediation rule's Approval says
 * (asking first unless the rule fixes without asking).
 *
 * What is stored is what a server sent - text from outside OneUptime - so
 * it is read back defensively: anything that is not a tool with a name is
 * left out, and every text is held to its length.
 *
 * Shared by the server and the Dashboard, so it imports nothing but limits
 * and the read-only rules.
 */

// How many of a tool's argument names are kept, and how long each may be.
export const MAX_EXTERNAL_MCP_TOOL_ARGUMENT_NAMES: number = 30;
export const MAX_EXTERNAL_MCP_TOOL_ARGUMENT_NAME_CHARS: number = 64;

export interface ExternalMcpServerTool {
  // The tool's name, as the server calls it.
  name: string;
  // A name for people, when the server gives one.
  title?: string | undefined;
  description?: string | undefined;
  // The server marks it read-only (annotations.readOnlyHint).
  readsOnly: boolean;
  /*
   * The server marks it as one that may change something (readOnlyHint
   * false, or destructiveHint true): it can never be marked read-only.
   */
  serverMarksAsChange?: boolean | undefined;
  /*
   * The fingerprint of its definition - name, description and input
   * schema - as OneUptime read it: what a Project Admin's mark holds. A
   * tool stored before marks existed has none until it is read again.
   */
  fingerprint?: string | undefined;
  // Why OneUptime never lets it be marked read-only, if it does not.
  markRefusal?: ExternalMcpToolMarkRefusal | undefined;
  // The names of the arguments it takes, for whoever decides whether to mark it.
  argumentNames?: Array<string> | undefined;
}

// The argument names as stored: strings, each held to its length, at most so many.
function readArgumentNames(value: unknown): Array<string> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const names: Array<string> = [];

  for (const entry of value) {
    if (names.length >= MAX_EXTERNAL_MCP_TOOL_ARGUMENT_NAMES) {
      break;
    }

    if (typeof entry === "string" && entry.trim()) {
      names.push(
        entry.trim().slice(0, MAX_EXTERNAL_MCP_TOOL_ARGUMENT_NAME_CHARS),
      );
    }
  }

  return names;
}

function readText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const text: string = value.trim();

  if (!text) {
    return undefined;
  }

  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

// One stored (or freshly read) tool, or null when it is not one.
export function readExternalMcpServerTool(
  value: unknown,
): ExternalMcpServerTool | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const name: unknown = raw["name"];

  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > MAX_EXTERNAL_MCP_TOOL_NAME_CHARS
  ) {
    return null;
  }

  const tool: ExternalMcpServerTool = {
    name: name.trim(),
    readsOnly: raw["readsOnly"] === true,
  };

  const title: string | undefined = readText(raw["title"], 200);
  const description: string | undefined = readText(
    raw["description"],
    MAX_EXTERNAL_MCP_TOOL_DESCRIPTION_CHARS,
  );

  if (title) {
    tool.title = title;
  }

  if (description) {
    tool.description = description;
  }

  if (raw["serverMarksAsChange"] === true) {
    tool.serverMarksAsChange = true;
  }

  if (isExternalMcpToolFingerprint(raw["fingerprint"])) {
    tool.fingerprint = raw["fingerprint"];
  }

  const markRefusal: ExternalMcpToolMarkRefusal | undefined =
    readExternalMcpToolMarkRefusal(raw["markRefusal"]);

  if (markRefusal) {
    tool.markRefusal = markRefusal;
  }

  const argumentNames: Array<string> | undefined = readArgumentNames(
    raw["argumentNames"],
  );

  if (argumentNames) {
    tool.argumentNames = argumentNames;
  }

  return tool;
}

/*
 * The tools a stored value holds, each name once, at most
 * MAX_EXTERNAL_MCP_SERVER_TOOLS, in the order the server listed them.
 */
export function readExternalMcpServerTools(
  value: unknown,
): Array<ExternalMcpServerTool> {
  if (!Array.isArray(value)) {
    return [];
  }

  const tools: Array<ExternalMcpServerTool> = [];
  const names: Set<string> = new Set<string>();

  for (const entry of value) {
    if (tools.length >= MAX_EXTERNAL_MCP_SERVER_TOOLS) {
      break;
    }

    const tool: ExternalMcpServerTool | null = readExternalMcpServerTool(entry);

    if (!tool || names.has(tool.name)) {
      continue;
    }

    names.add(tool.name);
    tools.push(tool);
  }

  return tools;
}

// How many of the tools may change something (they do not only read).
export function countExternalMcpServerChangingTools(
  tools: Array<ExternalMcpServerTool>,
): number {
  return tools.filter((tool: ExternalMcpServerTool): boolean => {
    return !tool.readsOnly;
  }).length;
}

// How many of the tools only read.
export function countExternalMcpServerReadOnlyTools(
  tools: Array<ExternalMcpServerTool>,
): number {
  return tools.length - countExternalMcpServerChangingTools(tools);
}
