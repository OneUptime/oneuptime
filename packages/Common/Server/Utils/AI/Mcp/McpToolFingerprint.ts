import crypto from "crypto";
import {
  ExternalMcpToolForStatus,
  ExternalMcpToolMarkRefusal,
  getExternalMcpToolMarkRefusal,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpToolReadOnlyMark";
import { JSONObject } from "../../../../Types/JSON";
import { McpToolDescription } from "./McpClient";

/*
 * A TOOL'S DEFINITION AS ONE FINGERPRINT - what a Project Admin's read-only
 * mark holds (issue #11081, Types/AI/ExternalMcpServer/
 * ExternalMcpToolReadOnlyMark).
 *
 * A mark says "this tool, as it is now, only reads". The fingerprint is
 * that "as it is now": the tool's name, its description and its input
 * schema, as the server sent them. A server that changes any of them - a
 * new argument, a description that now says it deletes - changes the
 * fingerprint, and the mark stops holding until someone marks the tool
 * again. Its title and annotations are left out: a title is for people,
 * and a server that starts marking the tool itself is taken at its word
 * whatever the mark says.
 *
 * What the server sent is read the same way whatever order it wrote it in,
 * so a server that writes its JSON in another order is the same server:
 * object keys are sorted, and so are the lists a schema reads as sets -
 * `required`, `enum` and `type`. Everything else, text included, is held
 * exactly: kAgent's k8s_generate_resource lists its resource types in its
 * description in another order each time kAgent starts (recorded in
 * Tests/Fixtures/KAgentTools), and a mark on it holds only until then.
 */

// The fingerprint's own version: a change to how it is worked out lets every mark lapse.
const FINGERPRINT_VERSION: string = "oneuptime-external-mcp-tool-v1";

// The keys whose arrays a JSON schema reads as sets.
const SET_VALUED_KEYS: ReadonlySet<string> = new Set<string>([
  "enum",
  "required",
  "type",
]);

// How deep a schema is read: deeper than any real one, short of a stack overflow.
const MAX_DEPTH: number = 64;

function canonicalize(value: unknown, key: string, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return null;
  }

  if (Array.isArray(value)) {
    const items: Array<unknown> = value.map((item: unknown): unknown => {
      return canonicalize(item, "", depth + 1);
    });

    if (!SET_VALUED_KEYS.has(key)) {
      return items;
    }

    return items
      .map((item: unknown): string => {
        return JSON.stringify(item);
      })
      .sort()
      .map((text: string): unknown => {
        return JSON.parse(text);
      });
  }

  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};

    for (const name of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[name] = canonicalize(
        (value as Record<string, unknown>)[name],
        name,
        depth + 1,
      );
    }

    return sorted;
  }

  return value;
}

// The text a fingerprint is the digest of: the same for the same definition.
export function getMcpToolDefinitionText(tool: {
  name: string;
  description?: string | undefined;
  inputSchema: JSONObject;
}): string {
  return JSON.stringify([
    FINGERPRINT_VERSION,
    tool.name,
    tool.description || "",
    canonicalize(tool.inputSchema, "", 0),
  ]);
}

// The fingerprint of a tool's definition: SHA-256, as 64 hex digits.
export function getMcpToolFingerprint(tool: {
  name: string;
  description?: string | undefined;
  inputSchema: JSONObject;
}): string {
  return crypto
    .createHash("sha256")
    .update(getMcpToolDefinitionText(tool), "utf8")
    .digest("hex");
}

/*
 * What deciding whether a tool counts as read-only reads of a tool just
 * read from its server: the server's word, the fingerprint of its
 * definition, and why it can never be marked, if it cannot.
 */
export function describeMcpToolForStatus(
  tool: McpToolDescription,
): ExternalMcpToolForStatus {
  const markRefusal: ExternalMcpToolMarkRefusal | null =
    getExternalMcpToolMarkRefusal({
      name: tool.name,
      inputSchema: tool.inputSchema,
    });

  return {
    readsOnly: tool.readsOnly,
    serverMarksAsChange: tool.serverMarksAsChange === true,
    fingerprint: getMcpToolFingerprint(tool),
    ...(markRefusal ? { markRefusal } : {}),
  };
}
