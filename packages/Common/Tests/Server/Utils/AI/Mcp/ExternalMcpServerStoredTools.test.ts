import ExternalMcpServerCheck from "../../../../../Server/Utils/AI/Mcp/ExternalMcpServerCheck";
import {
  McpToolDescription,
  readMcpToolDescription,
} from "../../../../../Server/Utils/AI/Mcp/McpClient";
import { getMcpToolFingerprint } from "../../../../../Server/Utils/AI/Mcp/McpToolFingerprint";
import {
  ExternalMcpServerTool,
  MAX_EXTERNAL_MCP_TOOL_ARGUMENT_NAMES,
  MAX_EXTERNAL_MCP_TOOL_ARGUMENT_NAME_CHARS,
  readExternalMcpServerTool,
  readExternalMcpServerTools,
} from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import {
  ExternalMcpToolMarkRefusalKind,
  ExternalMcpToolReadOnlyStatus,
  getExternalMcpToolReadOnlyStatus,
} from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpToolReadOnlyMark";
import { JSONObject } from "../../../../../Types/JSON";
import {
  KAgentToolsVersion,
  readKAgentToolsRecording,
} from "../../../../Helpers/KAgentToolRecordings";
import { describe, expect, test } from "@jest/globals";

/*
 * ISSUE #11081: WHAT A SERVER'S RECORD KEEPS OF EACH TOOL, so its page can
 * say whether a tool counts as read-only and offer to mark it - what Test
 * connection, and a run that found a mark lapsed, keep
 * (ExternalMcpServerCheck.toStoredTools): the server's word on it, the
 * fingerprint a mark holds, why it can never be marked, and the names of
 * its arguments, for whoever decides. No schema is kept: its fingerprint
 * and argument names stand for it.
 */

function storedOf(version: KAgentToolsVersion): Array<ExternalMcpServerTool> {
  return ExternalMcpServerCheck.toStoredTools(
    readKAgentToolsRecording({ version }).tools.map(
      (raw: JSONObject): McpToolDescription => {
        return readMcpToolDescription(raw)!;
      },
    ),
  );
}

function byName(
  tools: Array<ExternalMcpServerTool>,
  name: string,
): ExternalMcpServerTool {
  return tools.find((tool: ExternalMcpServerTool): boolean => {
    return tool.name === name;
  })!;
}

describe("what Test connection keeps of kAgent's tools", () => {
  test("kAgent 0.3: every tool, each with the fingerprint of its definition as the server sent it", () => {
    const raw: Array<JSONObject> = readKAgentToolsRecording({
      version: "0.3.2",
    }).tools;
    const stored: Array<ExternalMcpServerTool> = storedOf("0.3.2");

    expect(stored).toHaveLength(126);

    for (const tool of raw) {
      const kept: ExternalMcpServerTool = byName(stored, String(tool["name"]));

      expect({ name: kept.name, fingerprint: kept.fingerprint }).toEqual({
        name: kept.name,
        fingerprint: getMcpToolFingerprint(readMcpToolDescription(tool)!),
      });
      expect(kept.readsOnly).toBe(false);
      expect(kept.serverMarksAsChange).toBeUndefined();
    }
  });

  test("kAgent 0.3's k8s_get_resources: markable, with the arguments it takes", () => {
    const kept: ExternalMcpServerTool = byName(
      storedOf("0.3.2"),
      "k8s_get_resources",
    );

    expect(kept.markRefusal).toBeUndefined();
    expect(kept.argumentNames).toEqual([
      "resource_type",
      "resource_name",
      "namespace",
      "all_namespaces",
      "output",
    ]);
    expect(getExternalMcpToolReadOnlyStatus({ tool: kept })).toBe(
      ExternalMcpToolReadOnlyStatus.NotMarked,
    );
  });

  test("kAgent 0.3's tools that change something keep why they can never be marked", () => {
    const stored: Array<ExternalMcpServerTool> = storedOf("0.3.2");

    expect(byName(stored, "k8s_delete_resource").markRefusal).toEqual({
      kind: ExternalMcpToolMarkRefusalKind.NameSaysItChanges,
      word: "delete",
    });
    expect(byName(stored, "shell").markRefusal).toEqual({
      kind: ExternalMcpToolMarkRefusalKind.NameSaysItChanges,
      word: "shell",
    });
    expect(byName(stored, "cilium_fqdn_cache").markRefusal).toEqual({
      kind: ExternalMcpToolMarkRefusalKind.RunsWhatItIsGiven,
      word: "command",
    });
  });

  test("kAgent 0.2 (mcp-go): every tool kept as one the server marks a change, which no mark overrides", () => {
    for (const kept of storedOf("0.2.1")) {
      expect({
        name: kept.name,
        marksChange: kept.serverMarksAsChange,
      }).toEqual({ name: kept.name, marksChange: true });
      expect(getExternalMcpToolReadOnlyStatus({ tool: kept })).toBe(
        ExternalMcpToolReadOnlyStatus.ServerMarksChange,
      );
    }
  });

  test("what is kept reads back the same: a round trip loses nothing a mark needs", () => {
    const stored: Array<ExternalMcpServerTool> = storedOf("0.3.2");

    expect(
      readExternalMcpServerTools(JSON.parse(JSON.stringify(stored))),
    ).toEqual(stored);
  });

  test("kept small: no schema, so a server's whole list stays a few hundred bytes a tool", () => {
    const stored: Array<ExternalMcpServerTool> = storedOf("0.3.2");
    const bytes: number = JSON.stringify(stored).length;

    expect(bytes / stored.length).toBeLessThan(900);
  });
});

describe("a stored tool, read back defensively", () => {
  const FINGERPRINT: string = "e".repeat(64);

  test("keeps what a mark needs: the server's word, the fingerprint, the refusal, the arguments", () => {
    expect(
      readExternalMcpServerTool({
        name: "k8s_rollout",
        readsOnly: false,
        serverMarksAsChange: true,
        fingerprint: FINGERPRINT,
        markRefusal: {
          kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
          word: "action",
        },
        argumentNames: ["action", " namespace "],
      }),
    ).toEqual({
      name: "k8s_rollout",
      readsOnly: false,
      serverMarksAsChange: true,
      fingerprint: FINGERPRINT,
      markRefusal: {
        kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
        word: "action",
      },
      argumentNames: ["action", "namespace"],
    });
  });

  test("a tool stored before marks existed has none of it, and reads as it did", () => {
    expect(
      readExternalMcpServerTool({ name: "get_logs", readsOnly: true }),
    ).toEqual({ name: "get_logs", readsOnly: true });
  });

  test.each([
    ["a fingerprint that is not one", { fingerprint: "not-a-digest" }],
    ["a fingerprint in capitals", { fingerprint: "E".repeat(64) }],
    ["a refusal of no kind", { markRefusal: { kind: "Other", word: "x" } }],
    ["a server's word that is not true", { serverMarksAsChange: "true" }],
    ["arguments that are no list", { argumentNames: "namespace" }],
  ])("drops %s", (_what: string, field: JSONObject) => {
    const tool: ExternalMcpServerTool | null = readExternalMcpServerTool({
      name: "get_logs",
      readsOnly: false,
      ...field,
    });

    expect(tool).toEqual({ name: "get_logs", readsOnly: false });
  });

  test("holds the argument names to their count and length, and leaves out what is not a name", () => {
    const tool: ExternalMcpServerTool | null = readExternalMcpServerTool({
      name: "wide",
      readsOnly: false,
      argumentNames: [
        12,
        "",
        "a".repeat(500),
        ...Array.from({ length: 100 }, (_value: unknown, index: number) => {
          return `argument_${index}`;
        }),
      ],
    });

    expect(tool?.argumentNames).toHaveLength(
      MAX_EXTERNAL_MCP_TOOL_ARGUMENT_NAMES,
    );
    expect(tool?.argumentNames?.[0]).toBe(
      "a".repeat(MAX_EXTERNAL_MCP_TOOL_ARGUMENT_NAME_CHARS),
    );
    expect(tool?.argumentNames?.[1]).toBe("argument_0");
  });
});
