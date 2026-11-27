import fs from "fs";
import path from "path";
import { JSONObject } from "../../Types/JSON";

/*
 * KAGENT'S TOOL SERVER, AS IT ANSWERS tools/list - Tests/Fixtures/KAgentTools,
 * for the tests of #11081 (a Project Admin marks a tool read-only) and
 * #11082 (OneUptime AI reads with the servers in Slack and Microsoft Teams).
 *
 * Recorded on 2026-11-27 from kAgent's published image,
 * ghcr.io/kagent-dev/kagent/tools, run with `docker run -p
 * 127.0.0.1:<port>:8084 ghcr.io/kagent-dev/kagent/tools:<version>
 * [--read-only]`, over Streamable HTTP at /mcp: initialize (protocol
 * 2025-11-25, as OneUptime asks), notifications/initialized, then every
 * tools/list page. Each file holds the server's serverInfo, the protocol
 * it agreed on, its capabilities and its tools exactly as sent.
 *
 *   - kagent-tools-0.3.2.json (126 tools) and -read-only.json (80): kAgent
 *     tools 0.3, built on the official Go SDK (go-sdk 1.8). No tool carries
 *     annotations: the server says nothing about whether any of them only
 *     reads, k8s_get_resources included - the case #11081 is about.
 *   - kagent-tools-0.2.1.json (124 tools) and -read-only.json (78): kAgent
 *     tools 0.2, built on mcp-go 0.43, whose NewTool writes out
 *     readOnlyHint false, destructiveHint true, idempotentHint false and
 *     openWorldHint true for every tool its author did not annotate - so
 *     every tool says it may destroy something, k8s_get_resources included,
 *     and --read-only too.
 *
 * `--read-only` leaves kAgent's write tools unregistered, so each read-only
 * list is what kAgent itself counts as reading. Two of those still change
 * something - cilium_fqdn_cache's command can be "clean", and
 * helm_repo_update rewrites the local chart cache - and one tool,
 * k8s_generate_resource, lists its resource types in another order each
 * time kAgent starts (a Go map's order), in its description (0.3) or an
 * argument's (0.2): the two recordings of each version differ in it alone.
 *
 * Not a test file itself, so jest does not run it.
 */

const FIXTURES: string = path.join(__dirname, "../Fixtures/KAgentTools");

export type KAgentToolsVersion = "0.3.2" | "0.2.1";

export interface KAgentToolsRecording {
  serverInfo: JSONObject;
  protocolVersion: string;
  capabilities: JSONObject;
  tools: Array<JSONObject>;
}

export function getKAgentToolsRecordingPath(data: {
  version: KAgentToolsVersion;
  isReadOnly?: boolean | undefined;
}): string {
  return path.join(
    FIXTURES,
    `kagent-tools-${data.version}${data.isReadOnly ? "-read-only" : ""}.json`,
  );
}

// A recording, as a fresh copy a test may change.
export function readKAgentToolsRecording(data: {
  version: KAgentToolsVersion;
  isReadOnly?: boolean | undefined;
}): KAgentToolsRecording {
  return JSON.parse(
    fs.readFileSync(getKAgentToolsRecordingPath(data), "utf8"),
  ) as KAgentToolsRecording;
}

// One tool of a recording, by name, as the server sent it.
export function getKAgentTool(data: {
  version: KAgentToolsVersion;
  name: string;
  isReadOnly?: boolean | undefined;
}): JSONObject {
  const tool: JSONObject | undefined = readKAgentToolsRecording(
    data,
  ).tools.find((candidate: JSONObject): boolean => {
    return candidate["name"] === data.name;
  });

  if (!tool) {
    throw new Error(`kAgent ${data.version} has no tool named ${data.name}`);
  }

  return tool;
}

// The names of a recording's tools, in the server's order.
export function getKAgentToolNames(data: {
  version: KAgentToolsVersion;
  isReadOnly?: boolean | undefined;
}): Array<string> {
  return readKAgentToolsRecording(data).tools.map(
    (tool: JSONObject): string => {
      return String(tool["name"]);
    },
  );
}

/*
 * The tools kAgent registers only without --read-only: what kAgent itself
 * counts as tools that change something.
 */
export function getKAgentWriteToolNames(
  version: KAgentToolsVersion,
): Array<string> {
  const readOnly: Set<string> = new Set<string>(
    getKAgentToolNames({ version, isReadOnly: true }),
  );

  return getKAgentToolNames({ version }).filter((name: string): boolean => {
    return !readOnly.has(name);
  });
}
