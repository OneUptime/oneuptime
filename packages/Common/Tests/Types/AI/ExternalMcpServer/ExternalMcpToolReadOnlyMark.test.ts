import {
  ExternalMcpToolForStatus,
  ExternalMcpToolMarkRefusal,
  ExternalMcpToolMarkRefusalKind,
  ExternalMcpToolReadOnlyStatus,
  canExternalMcpToolBeMarked,
  getExternalMcpToolMarkRefusal,
  getExternalMcpToolReadOnlyStatus,
  isExternalMcpToolFingerprint,
  isExternalMcpToolReadOnly,
  readExternalMcpToolMarkRefusal,
  splitExternalMcpToolWords,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpToolReadOnlyMark";
import { JSONObject } from "../../../../Types/JSON";
import {
  KAgentToolsVersion,
  getKAgentTool,
  getKAgentToolNames,
  getKAgentWriteToolNames,
  readKAgentToolsRecording,
} from "../../../Helpers/KAgentToolRecordings";
import { describe, expect, test } from "@jest/globals";

/*
 * ISSUE #11081: WHICH TOOLS A PROJECT ADMIN MAY MARK READ-ONLY, AND WHEN A
 * MARK HOLDS.
 *
 * A mark lets OneUptime AI call a tool with nobody asking, so safety comes
 * first: only a tool its server says nothing about, never one whose name or
 * arguments plainly change something, and only while the tool is as it was
 * when marked. The backstop is checked against kAgent's tool server as it
 * answers (Tests/Fixtures/KAgentTools): of the 80 tools kAgent keeps with
 * --read-only, it refuses only the two that do change something, and of
 * the 46 tools kAgent counts as writes, it lets through only two whose
 * names say nothing of it - those stay the admin's to judge.
 */

const FINGERPRINT_A: string = "a".repeat(64);
const FINGERPRINT_B: string = "b".repeat(64);

function refusalOf(
  name: string,
  inputSchema?: JSONObject | undefined,
): ExternalMcpToolMarkRefusal | null {
  return getExternalMcpToolMarkRefusal({ name, inputSchema });
}

function withArguments(properties: JSONObject): JSONObject {
  return { type: "object", properties };
}

function refusedToolNames(tools: Array<JSONObject>): Array<string> {
  return tools
    .filter((tool: JSONObject): boolean => {
      return (
        getExternalMcpToolMarkRefusal({
          name: String(tool["name"]),
          inputSchema: tool["inputSchema"] as JSONObject,
        }) !== null
      );
    })
    .map((tool: JSONObject): string => {
      return String(tool["name"]);
    });
}

describe("a tool's name, as words", () => {
  test.each([
    ["k8s_get_resources", ["k8s", "get", "resources"]],
    ["deleteIssue", ["delete", "issue"]],
    ["DeleteBucket", ["delete", "bucket"]],
    ["HTTPGetResource", ["http", "get", "resource"]],
    ["events.list/recent pods", ["events", "list", "recent", "pods"]],
    ["azmcp-storage-account-list", ["azmcp", "storage", "account", "list"]],
    ["get_or_create_branch", ["get", "or", "create", "branch"]],
    ["", []],
    ["___", []],
  ])("%s", (name: string, words: Array<string>) => {
    expect(splitExternalMcpToolWords(name)).toEqual(words);
  });

  test("an absurdly long name is read only so far", () => {
    expect(
      splitExternalMcpToolWords(`get_${"x".repeat(10000)}`).join("").length,
    ).toBeLessThanOrEqual(256);
  });
});

describe("a name that says the tool changes something can never be marked", () => {
  test.each([
    ["k8s_delete_resource", "delete"],
    ["k8s_apply_manifest", "apply"],
    ["k8s_patch_resource", "patch"],
    ["k8s_scale", "scale"],
    ["k8s_execute_command", "execute"],
    ["helm_upgrade", "upgrade"],
    ["helm_uninstall", "uninstall"],
    ["shell", "shell"],
    ["deleteIssue", "delete"],
    ["pods.delete", "delete"],
    ["create_or_update_file", "create"],
    ["mark_all_notifications_read", "mark"],
    ["call_aws", "call"],
    ["restart_deployment", "restart"],
  ])("%s, by “%s”", (name: string, word: string) => {
    expect(refusalOf(name)).toEqual({
      kind: ExternalMcpToolMarkRefusalKind.NameSaysItChanges,
      word,
    });
  });

  test("a change verb joined to a read verb with or / and counts: get_or_create_branch, list_and_delete_old", () => {
    expect(refusalOf("get_or_create_branch")?.word).toBe("create");
    expect(refusalOf("list_and_delete_old")?.word).toBe("delete");
    expect(refusalOf("get_or_list_or_delete")?.word).toBe("delete");
  });

  test("a change word after a read verb is what it reads about, not what it does", () => {
    expect(refusalOf("argo_verify_argo_rollouts_controller_install")).toBe(
      null,
    );
    expect(refusalOf("list_deleted_items")).toBe(null);
    expect(refusalOf("get_start_time")).toBe(null);
    expect(refusalOf("cilium_status_and_version")).toBe(null);
  });

  test("words that are as often nouns stay out: label names, a rollout's status, a rollouts list", () => {
    expect(refusalOf("prometheus_label_names_tool")).toBe(null);
    expect(refusalOf("rollout_status")).toBe(null);
    expect(refusalOf("argo_rollouts_list")).toBe(null);
    expect(refusalOf("list_prometheus_label_names")).toBe(null);
  });

  test("kAgent's k8s_rollout still never is: its free-text action can restart or undo", () => {
    expect(
      refusalOf(
        "k8s_rollout",
        getKAgentTool({ version: "0.3.2", name: "k8s_rollout" })[
          "inputSchema"
        ] as JSONObject,
      ),
    ).toEqual({
      kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
      word: "action",
    });
  });

  test("a name with no verb at all says nothing: its arguments decide", () => {
    expect(refusalOf("cilium_fqdn_cache")).toBe(null);
    expect(refusalOf("istio_proxy_config")).toBe(null);
  });
});

describe("an argument that runs what it is given, or switches a change on, refuses the tool", () => {
  test.each(["command", "cmd", "commands", "script", "shell", "sql"])(
    "an argument named %s",
    (argument: string) => {
      expect(
        refusalOf("inspect_node", withArguments({ [argument]: {} })),
      ).toEqual({
        kind: ExternalMcpToolMarkRefusalKind.RunsWhatItIsGiven,
        word: argument,
      });
    },
  );

  test("an argument whose name has such a word: cli_command, shellScript", () => {
    expect(refusalOf("aws", withArguments({ cli_command: {} }))?.kind).toBe(
      ExternalMcpToolMarkRefusalKind.RunsWhatItIsGiven,
    );
    expect(refusalOf("node", withArguments({ shellScript: {} }))?.word).toBe(
      "shellScript",
    );
  });

  test.each(["should_install", "force_delete", "restart_after", "overwrite"])(
    "a switch named %s",
    (argument: string) => {
      expect(
        refusalOf("verify_plugin", withArguments({ [argument]: {} })),
      ).toEqual({
        kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
        word: argument,
      });
    },
  );

  test.each(["dry_run", "dryRun", "dry-run"])(
    "a preview switch named %s: the tool changes something when it is false",
    (argument: string) => {
      expect(
        refusalOf("helm_chart", withArguments({ [argument]: {} }))?.kind,
      ).toBe(ExternalMcpToolMarkRefusalKind.ArgumentCanChange);
    },
  );

  test("a read tool's own switches stay markable: all_namespaces, enable_k8s, list_read_only", () => {
    expect(
      refusalOf(
        "cilium_validate_cilium_network_policies",
        withArguments({
          enable_k8s: { type: "boolean" },
          enable_k8s_api_discovery: { type: "boolean" },
        }),
      ),
    ).toBe(null);
    expect(
      refusalOf(
        "k8s_get_resources",
        withArguments({ all_namespaces: {}, output: {} }),
      ),
    ).toBe(null);
  });

  test("a query, a url or code is not a command: what the call does is still a read", () => {
    expect(
      refusalOf("prometheus_query_tool", withArguments({ query: {} })),
    ).toBe(null);
    expect(refusalOf("get_page", withArguments({ url: {} }))).toBe(null);
    expect(refusalOf("get_error", withArguments({ code: {} }))).toBe(null);
  });
});

describe("an argument that picks what the tool does refuses it, unless every choice reads", () => {
  test("free text can pick anything", () => {
    expect(
      refusalOf("kubernetes", withArguments({ action: { type: "string" } })),
    ).toEqual({
      kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
      word: "action",
    });
  });

  test("a choice that is a change verb", () => {
    expect(
      refusalOf(
        "kubernetes",
        withArguments({
          operation: { type: "string", enum: ["get", "list", "delete"] },
        }),
      ),
    ).toEqual({
      kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
      word: "delete",
      argument: "operation",
    });
  });

  test("an HTTP method that writes", () => {
    expect(
      refusalOf(
        "http_request",
        withArguments({ method: { type: "string", enum: ["GET", "POST"] } }),
      ),
    ).toEqual({
      kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
      word: "POST",
      argument: "method",
    });
  });

  test("choices listed with oneOf or anyOf of consts", () => {
    expect(
      refusalOf(
        "kubernetes",
        withArguments({
          verb: { oneOf: [{ const: "get" }, { const: "patch" }] },
        }),
      )?.word,
    ).toBe("patch");
    expect(
      refusalOf(
        "kubernetes",
        withArguments({ op: { anyOf: [{ enum: ["get", "drain"] }] } }),
      )?.word,
    ).toBe("drain");
  });

  test("a choice that is a name with a change verb: create_or_update", () => {
    expect(
      refusalOf(
        "records",
        withArguments({ action: { enum: ["get", "create_or_update"] } }),
      )?.word,
    ).toBe("create_or_update");
  });

  test("choices that only read keep it markable", () => {
    expect(
      refusalOf(
        "http_get",
        withArguments({ method: { type: "string", enum: ["GET", "HEAD"] } }),
      ),
    ).toBe(null);
    expect(
      refusalOf(
        "rollout_info",
        withArguments({ action: { enum: ["history", "status"] } }),
      ),
    ).toBe(null);
  });

  test("an argument of another name with change words among its choices is a filter, not a pick", () => {
    expect(
      refusalOf(
        "list_events",
        withArguments({ type: { enum: ["create", "delete"] } }),
      ),
    ).toBe(null);
  });

  test("a schema that is no object, or has no properties, says nothing of its arguments", () => {
    expect(refusalOf("get_status", undefined)).toBe(null);
    expect(refusalOf("get_status", { type: "object" })).toBe(null);
    expect(
      refusalOf("get_status", { type: "object", properties: [] as never }),
    ).toBe(null);
  });
});

describe("kAgent's tool server, as recorded", () => {
  const VERSIONS: Array<KAgentToolsVersion> = ["0.3.2", "0.2.1"];

  test.each(VERSIONS)(
    "kAgent %s: of the tools it keeps with --read-only, only the two that do change something are refused",
    (version: KAgentToolsVersion) => {
      const readOnly: Array<JSONObject> = readKAgentToolsRecording({
        version,
        isReadOnly: true,
      }).tools;

      expect(refusedToolNames(readOnly)).toEqual([
        "cilium_fqdn_cache",
        "helm_repo_update",
      ]);
      expect(
        refusalOf(
          "cilium_fqdn_cache",
          getKAgentTool({ version, name: "cilium_fqdn_cache" })[
            "inputSchema"
          ] as JSONObject,
        ),
      ).toEqual({
        kind: ExternalMcpToolMarkRefusalKind.RunsWhatItIsGiven,
        word: "command",
      });
      expect(refusalOf("helm_repo_update")).toEqual({
        kind: ExternalMcpToolMarkRefusalKind.NameSaysItChanges,
        word: "update",
      });
    },
  );

  test.each(VERSIONS)(
    "kAgent %s: of the tools it counts as writes, only two whose names say nothing of it get through",
    (version: KAgentToolsVersion) => {
      const writeNames: Set<string> = new Set<string>(
        getKAgentWriteToolNames(version),
      );
      const writes: Array<JSONObject> = readKAgentToolsRecording({
        version,
      }).tools.filter((tool: JSONObject): boolean => {
        return writeNames.has(String(tool["name"]));
      });
      const refused: Set<string> = new Set<string>(refusedToolNames(writes));

      expect(writes.length).toBe(46);
      expect(
        writes
          .map((tool: JSONObject): string => {
            return String(tool["name"]);
          })
          .filter((name: string): boolean => {
            return !refused.has(name);
          }),
      ).toEqual(["k8s_check_service_connectivity", "k8s_label_resource"]);
    },
  );

  test("the tools that matter to an investigation stay markable", () => {
    for (const name of [
      "k8s_get_resources",
      "k8s_get_pod_logs",
      "k8s_get_events",
      "k8s_describe_resource",
      "k8s_get_resource_yaml",
      "helm_list_releases",
      "prometheus_query_tool",
      "prometheus_query_range_tool",
      "prometheus_label_names_tool",
      "istio_proxy_status",
      "cilium_status_and_version",
    ]) {
      const tool: JSONObject = getKAgentTool({ version: "0.3.2", name });

      expect({
        name,
        refusal: refusalOf(name, tool["inputSchema"] as JSONObject),
      }).toEqual({ name, refusal: null });
    }
  });

  test("argo_verify_gateway_plugin reads, unless its should_install switch says to install", () => {
    const tool: JSONObject = getKAgentTool({
      version: "0.3.2",
      name: "argo_verify_gateway_plugin",
    });

    expect(
      refusalOf(
        "argo_verify_gateway_plugin",
        tool["inputSchema"] as JSONObject,
      ),
    ).toEqual({
      kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
      word: "should_install",
    });
  });

  test("the recordings hold every tool once, in the order the server listed them", () => {
    for (const version of VERSIONS) {
      const names: Array<string> = getKAgentToolNames({ version });

      expect(new Set<string>(names).size).toBe(names.length);
      expect(names).toEqual([...names].sort());
    }
    expect(getKAgentToolNames({ version: "0.3.2" }).length).toBe(126);
    expect(getKAgentToolNames({ version: "0.2.1" }).length).toBe(124);
  });
});

describe("whether a tool counts as read-only, and why", () => {
  function tool(
    fields: Partial<ExternalMcpToolForStatus> = {},
  ): ExternalMcpToolForStatus {
    return { readsOnly: false, fingerprint: FINGERPRINT_A, ...fields };
  }

  test("the server's read-only word comes first, whatever the marks say", () => {
    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: tool({ readsOnly: true, serverMarksAsChange: true }),
        marks: [{ toolFingerprint: FINGERPRINT_B }],
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.ServerMarksReadOnly);
  });

  test("a tool the server marks as a change is never read-only, even marked", () => {
    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: tool({ serverMarksAsChange: true }),
        marks: [{ toolFingerprint: FINGERPRINT_A }],
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.ServerMarksChange);
  });

  test("a tool OneUptime never lets be marked is never read-only, even with a mark that matches", () => {
    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: tool({
          markRefusal: {
            kind: ExternalMcpToolMarkRefusalKind.NameSaysItChanges,
            word: "delete",
          },
        }),
        marks: [{ toolFingerprint: FINGERPRINT_A }],
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.CannotBeMarked);
  });

  test("with no mark, a tool its server says nothing about may change something", () => {
    expect(getExternalMcpToolReadOnlyStatus({ tool: tool() })).toBe(
      ExternalMcpToolReadOnlyStatus.NotMarked,
    );
    expect(getExternalMcpToolReadOnlyStatus({ tool: tool(), marks: [] })).toBe(
      ExternalMcpToolReadOnlyStatus.NotMarked,
    );
  });

  test("a mark holds while the tool's fingerprint is the one it holds", () => {
    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: tool(),
        marks: [{ toolFingerprint: FINGERPRINT_A }],
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.MarkedReadOnly);
  });

  test("a changed definition drops the mark: it lapses until someone marks the tool again", () => {
    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: tool({ fingerprint: FINGERPRINT_B }),
        marks: [{ toolFingerprint: FINGERPRINT_A }],
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.MarkLapsed);
  });

  test("a tool read before fingerprints existed holds no mark", () => {
    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: tool({ fingerprint: undefined }),
        marks: [{ toolFingerprint: FINGERPRINT_A }],
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.MarkLapsed);
  });

  test("a mark with no fingerprint holds nothing", () => {
    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: tool(),
        marks: [{ toolFingerprint: null }, { toolFingerprint: undefined }],
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.MarkLapsed);
  });

  test("of several marks, one that matches is enough", () => {
    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: tool(),
        marks: [
          { toolFingerprint: FINGERPRINT_B },
          { toolFingerprint: FINGERPRINT_A },
        ],
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.MarkedReadOnly);
  });

  test("only the server's word and a mark that holds count as read-only", () => {
    expect(
      Object.values(ExternalMcpToolReadOnlyStatus).filter(
        (status: ExternalMcpToolReadOnlyStatus): boolean => {
          return isExternalMcpToolReadOnly(status);
        },
      ),
    ).toEqual([
      ExternalMcpToolReadOnlyStatus.ServerMarksReadOnly,
      ExternalMcpToolReadOnlyStatus.MarkedReadOnly,
    ]);
  });
});

describe("whether a Project Admin may mark a tool now", () => {
  test("a tool its server says nothing about, not marked or with a lapsed mark", () => {
    const tool: ExternalMcpToolForStatus = {
      readsOnly: false,
      fingerprint: FINGERPRINT_A,
    };

    expect(canExternalMcpToolBeMarked({ tool })).toBe(true);
    expect(
      canExternalMcpToolBeMarked({
        tool,
        marks: [{ toolFingerprint: FINGERPRINT_B }],
      }),
    ).toBe(true);
  });

  test("never one marked as it is, one the server marks either way, one refused, or one with no fingerprint", () => {
    expect(
      canExternalMcpToolBeMarked({
        tool: { readsOnly: false, fingerprint: FINGERPRINT_A },
        marks: [{ toolFingerprint: FINGERPRINT_A }],
      }),
    ).toBe(false);
    expect(
      canExternalMcpToolBeMarked({
        tool: { readsOnly: true, fingerprint: FINGERPRINT_A },
      }),
    ).toBe(false);
    expect(
      canExternalMcpToolBeMarked({
        tool: {
          readsOnly: false,
          serverMarksAsChange: true,
          fingerprint: FINGERPRINT_A,
        },
      }),
    ).toBe(false);
    expect(
      canExternalMcpToolBeMarked({
        tool: {
          readsOnly: false,
          fingerprint: FINGERPRINT_A,
          markRefusal: {
            kind: ExternalMcpToolMarkRefusalKind.RunsWhatItIsGiven,
            word: "command",
          },
        },
      }),
    ).toBe(false);
    expect(canExternalMcpToolBeMarked({ tool: { readsOnly: false } })).toBe(
      false,
    );
  });
});

describe("what is stored, read back defensively", () => {
  test("a fingerprint is 64 lower-case hex digits", () => {
    expect(isExternalMcpToolFingerprint(FINGERPRINT_A)).toBe(true);
    expect(isExternalMcpToolFingerprint("A".repeat(64))).toBe(false);
    expect(isExternalMcpToolFingerprint("a".repeat(63))).toBe(false);
    expect(isExternalMcpToolFingerprint(`${"a".repeat(63)}g`)).toBe(false);
    expect(isExternalMcpToolFingerprint(12)).toBe(false);
    expect(isExternalMcpToolFingerprint(undefined)).toBe(false);
  });

  test("a refusal keeps its kind, its word and its argument, each held to its length", () => {
    expect(
      readExternalMcpToolMarkRefusal({
        kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
        word: ` ${"d".repeat(500)} `,
        argument: " action ",
      }),
    ).toEqual({
      kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
      word: "d".repeat(128),
      argument: "action",
    });
  });

  test("anything else is no refusal", () => {
    expect(readExternalMcpToolMarkRefusal(undefined)).toBe(undefined);
    expect(readExternalMcpToolMarkRefusal("delete")).toBe(undefined);
    expect(readExternalMcpToolMarkRefusal([])).toBe(undefined);
    expect(
      readExternalMcpToolMarkRefusal({ kind: "Other", word: "delete" }),
    ).toBe(undefined);
    expect(
      readExternalMcpToolMarkRefusal({
        kind: ExternalMcpToolMarkRefusalKind.NameSaysItChanges,
        word: "  ",
      }),
    ).toBe(undefined);
  });
});
