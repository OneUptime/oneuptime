import { MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT } from "./ExternalMcpServerLimits";

/*
 * WHICH OF THE PROJECT'S EXTERNAL MCP SERVERS OneUptime AI MAY USE for one
 * incident or alert.
 *
 * An investigation rule and an auto remediation rule each name, under More
 * fields, the MCP servers OneUptime AI may use for what they match. The
 * maintainer: "If there are no MCP servers selected, by default, you can
 * say, 'Allow all MCP servers to be used.'" So:
 *
 *   - no rule set up: every server;
 *   - a matching rule that names none: every server;
 *   - matching rules that name some: the servers any of them names.
 *
 * A server that is turned off is never used, whatever a rule names; and
 * only the project's own servers are (a rule can only name those - the
 * rule services refuse any other - and the runs read them by project).
 *
 * Shared by the server and the Dashboard, so it imports nothing but limits.
 */

// How many servers one rule may name: as many as a project may have.
export const MAX_EXTERNAL_MCP_SERVERS_PER_RULE: number =
  MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT;

export const RULE_TOO_MANY_EXTERNAL_MCP_SERVERS_MESSAGE: string = `A rule can name at most ${MAX_EXTERNAL_MCP_SERVERS_PER_RULE} MCP servers. Leave the list empty to let OneUptime AI use all of them.`;

export interface ExternalMcpServerAllowance {
  // Every server of the project.
  isEveryServer: boolean;
  // Otherwise these (lower-case ids), and only these.
  serverIds: Array<string>;
}

export const EVERY_EXTERNAL_MCP_SERVER: ExternalMcpServerAllowance = {
  isEveryServer: true,
  serverIds: [],
};

export const NO_EXTERNAL_MCP_SERVER: ExternalMcpServerAllowance = {
  isEveryServer: false,
  serverIds: [],
};

/*
 * An id from a stored value, a relation row ({ _id } or { id }), an
 * ObjectID (which keeps its text in _id) or a text.
 */
function readId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (value && typeof value === "object") {
    const row: { _id?: unknown; id?: unknown } = value as {
      _id?: unknown;
      id?: unknown;
    };

    return readId(row._id ?? row.id);
  }

  return "";
}

// The server ids a rule's list holds (rows, ids or option values), each once.
export function readExternalMcpServerIds(value: unknown): Array<string> {
  const values: Array<unknown> = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];

  const ids: Array<string> = [];

  for (const item of values) {
    const id: string = readId(
      item && typeof item === "object" && "value" in (item as object)
        ? (item as { value?: unknown }).value
        : item,
    );

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/*
 * Why a rule cannot be saved with this list of servers, or null when it
 * can. Whether each is the project's own is checked with every other
 * reference the rule writes (ProjectReferencesService).
 */
export function getRuleExternalMcpServersProblem(
  value: unknown,
): string | null {
  return readExternalMcpServerIds(value).length >
    MAX_EXTERNAL_MCP_SERVERS_PER_RULE
    ? RULE_TOO_MANY_EXTERNAL_MCP_SERVERS_MESSAGE
    : null;
}

/*
 * The servers OneUptime AI may use for a signal, from the rules that match
 * it. `rulesSetUp` is false when the project has no rule of this kind at
 * all: then every server may be used. With rules set up and none matching,
 * none may (nothing would have started a run).
 */
export function getExternalMcpServerAllowance(data: {
  rulesSetUp: boolean;
  matchingRules: Array<{ externalMcpServers?: unknown }>;
}): ExternalMcpServerAllowance {
  if (!data.rulesSetUp) {
    return EVERY_EXTERNAL_MCP_SERVER;
  }

  const serverIds: Array<string> = [];

  for (const rule of data.matchingRules) {
    const ruleServerIds: Array<string> = readExternalMcpServerIds(
      rule.externalMcpServers,
    );

    if (ruleServerIds.length === 0) {
      return EVERY_EXTERNAL_MCP_SERVER;
    }

    for (const id of ruleServerIds) {
      if (!serverIds.includes(id)) {
        serverIds.push(id);
      }
    }
  }

  return { isEveryServer: false, serverIds };
}

// Whether the allowance lets OneUptime AI use this server.
export function isExternalMcpServerAllowed(
  allowance: ExternalMcpServerAllowance,
  serverId: unknown,
): boolean {
  if (allowance.isEveryServer) {
    return true;
  }

  const id: string = readId(serverId);

  return Boolean(id) && allowance.serverIds.includes(id);
}

// Whether the allowance lets OneUptime AI use any server at all.
export function allowsAnyExternalMcpServer(
  allowance: ExternalMcpServerAllowance,
): boolean {
  return allowance.isEveryServer || allowance.serverIds.length > 0;
}
