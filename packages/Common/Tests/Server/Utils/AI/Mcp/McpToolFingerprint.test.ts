import {
  describeMcpToolForStatus,
  getMcpToolDefinitionText,
  getMcpToolFingerprint,
} from "../../../../../Server/Utils/AI/Mcp/McpToolFingerprint";
import {
  McpToolDescription,
  readMcpToolDescription,
} from "../../../../../Server/Utils/AI/Mcp/McpClient";
import {
  ExternalMcpToolForStatus,
  ExternalMcpToolMarkRefusalKind,
  ExternalMcpToolReadOnlyStatus,
  getExternalMcpToolReadOnlyStatus,
  isExternalMcpToolFingerprint,
} from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpToolReadOnlyMark";
import { JSONObject } from "../../../../../Types/JSON";
import {
  KAgentToolsVersion,
  readKAgentToolsRecording,
} from "../../../../Helpers/KAgentToolRecordings";
import { describe, expect, test } from "@jest/globals";

/*
 * ISSUE #11081: WHAT A READ-ONLY MARK HOLDS. A Project Admin marks a tool
 * as it is; the server may change it later. The fingerprint is the tool's
 * name, description and input schema as the server sent them, so a change
 * to any of them drops the mark - and only a change: the same definition
 * written in another order is the same tool.
 */

const GET_RESOURCES: JSONObject = {
  name: "k8s_get_resources",
  description: "List Kubernetes resources with kubectl.",
  inputSchema: {
    type: "object",
    properties: {
      resource_type: { type: "string", description: "Type of resource" },
      namespace: { type: "string", description: "Namespace to query" },
    },
    required: ["resource_type", "namespace"],
  },
};

function read(raw: JSONObject): McpToolDescription {
  const tool: McpToolDescription | null = readMcpToolDescription(raw);

  if (!tool) {
    throw new Error("not a tool");
  }

  return tool;
}

function fingerprintOf(raw: JSONObject): string {
  return getMcpToolFingerprint(read(raw));
}

function clone(value: JSONObject): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

describe("a tool's fingerprint", () => {
  test("is 64 hex digits, the same every time for the same definition", () => {
    const fingerprint: string = fingerprintOf(GET_RESOURCES);

    expect(isExternalMcpToolFingerprint(fingerprint)).toBe(true);
    expect(fingerprintOf(clone(GET_RESOURCES))).toBe(fingerprint);
  });

  test("is the same whatever order the server wrote its JSON in", () => {
    const reordered: JSONObject = {
      inputSchema: {
        required: ["namespace", "resource_type"],
        properties: {
          namespace: { description: "Namespace to query", type: "string" },
          resource_type: { description: "Type of resource", type: "string" },
        },
        type: "object",
      },
      description: "List Kubernetes resources with kubectl.",
      name: "k8s_get_resources",
    };

    expect(fingerprintOf(reordered)).toBe(fingerprintOf(GET_RESOURCES));
  });

  test("reads enum and type lists as the sets they are", () => {
    const withEnum: (values: Array<string>) => JSONObject = (
      values: Array<string>,
    ): JSONObject => {
      const raw: JSONObject = clone(GET_RESOURCES);
      ((raw["inputSchema"] as JSONObject)["properties"] as JSONObject)[
        "output"
      ] = { type: ["string", "null"], enum: values };
      return raw;
    };

    expect(fingerprintOf(withEnum(["json", "yaml", "wide"]))).toBe(
      fingerprintOf(withEnum(["wide", "yaml", "json"])),
    );

    const typeFlipped: JSONObject = withEnum(["json"]);
    (
      ((typeFlipped["inputSchema"] as JSONObject)["properties"] as JSONObject)[
        "output"
      ] as JSONObject
    )["type"] = ["null", "string"];
    expect(fingerprintOf(typeFlipped)).toBe(fingerprintOf(withEnum(["json"])));
  });

  test("keeps the order of a list that is no set: an array default is the server's own", () => {
    const withDefault: (values: Array<string>) => JSONObject = (
      values: Array<string>,
    ): JSONObject => {
      const raw: JSONObject = clone(GET_RESOURCES);
      ((raw["inputSchema"] as JSONObject)["properties"] as JSONObject)[
        "columns"
      ] = { type: "array", default: values };
      return raw;
    };

    expect(fingerprintOf(withDefault(["name", "status"]))).not.toBe(
      fingerprintOf(withDefault(["status", "name"])),
    );
  });

  test.each([
    [
      "a description that now says it deletes",
      (raw: JSONObject): void => {
        raw["description"] =
          "List or delete Kubernetes resources with kubectl.";
      },
    ],
    [
      "a new argument",
      (raw: JSONObject): void => {
        ((raw["inputSchema"] as JSONObject)["properties"] as JSONObject)[
          "action"
        ] = { type: "string" };
      },
    ],
    [
      "an argument's description",
      (raw: JSONObject): void => {
        (
          ((raw["inputSchema"] as JSONObject)["properties"] as JSONObject)[
            "namespace"
          ] as JSONObject
        )["description"] = "Namespace to delete from";
      },
    ],
    [
      "an argument's type",
      (raw: JSONObject): void => {
        (
          ((raw["inputSchema"] as JSONObject)["properties"] as JSONObject)[
            "namespace"
          ] as JSONObject
        )["type"] = "array";
      },
    ],
    [
      "an argument that is required no more",
      (raw: JSONObject): void => {
        (raw["inputSchema"] as JSONObject)["required"] = ["resource_type"];
      },
    ],
    [
      "additional arguments allowed",
      (raw: JSONObject): void => {
        (raw["inputSchema"] as JSONObject)["additionalProperties"] = true;
      },
    ],
    [
      "its description taken away",
      (raw: JSONObject): void => {
        delete raw["description"];
      },
    ],
  ])("changes with %s", (_what: string, change: (raw: JSONObject) => void) => {
    const changed: JSONObject = clone(GET_RESOURCES);
    change(changed);

    expect(fingerprintOf(changed)).not.toBe(fingerprintOf(GET_RESOURCES));
  });

  test("changes with the tool's name: a renamed tool is another tool", () => {
    const renamed: JSONObject = clone(GET_RESOURCES);
    renamed["name"] = "k8s_get_resources_v2";

    expect(fingerprintOf(renamed)).not.toBe(fingerprintOf(GET_RESOURCES));
  });

  test("leaves out its title, its annotations and its output schema", () => {
    const decorated: JSONObject = clone(GET_RESOURCES);
    decorated["title"] = "Get resources";
    decorated["annotations"] = { openWorldHint: true, title: "Get" };
    decorated["outputSchema"] = {
      type: "object",
      properties: { output: { type: "string" } },
    };

    expect(fingerprintOf(decorated)).toBe(fingerprintOf(GET_RESOURCES));
  });

  test("reads the description as the client keeps it: trimmed", () => {
    const padded: JSONObject = clone(GET_RESOURCES);
    padded["description"] = `  ${String(GET_RESOURCES["description"])}\n`;

    expect(fingerprintOf(padded)).toBe(fingerprintOf(GET_RESOURCES));
  });

  test("tells the description from the schema: text cannot slide from one into the other", () => {
    expect(
      getMcpToolDefinitionText({
        name: "a",
        description: "b",
        inputSchema: { type: "object" },
      }),
    ).not.toBe(
      getMcpToolDefinitionText({
        name: "a",
        description: "",
        inputSchema: { type: "object", description: "b" },
      }),
    );
  });

  test("is worked out for a schema nested past any real one without overflowing", () => {
    let schema: JSONObject = { type: "string" };

    for (let depth: number = 0; depth < 5000; depth++) {
      schema = { type: "object", properties: { next: schema } };
    }

    expect(
      isExternalMcpToolFingerprint(
        getMcpToolFingerprint({ name: "deep", inputSchema: schema }),
      ),
    ).toBe(true);
  });
});

describe("kAgent's tools, recorded twice", () => {
  const VERSIONS: Array<KAgentToolsVersion> = ["0.3.2", "0.2.1"];

  function fingerprintsOf(data: {
    version: KAgentToolsVersion;
    isReadOnly?: boolean | undefined;
  }): Map<string, string> {
    const fingerprints: Map<string, string> = new Map<string, string>();

    for (const raw of readKAgentToolsRecording(data).tools) {
      fingerprints.set(String(raw["name"]), fingerprintOf(raw));
    }

    return fingerprints;
  }

  test.each(VERSIONS)(
    "kAgent %s: every tool both recordings have is the same tool, but k8s_generate_resource, which kAgent writes anew each start",
    (version: KAgentToolsVersion) => {
      const all: Map<string, string> = fingerprintsOf({ version });
      const readOnly: Map<string, string> = fingerprintsOf({
        version,
        isReadOnly: true,
      });

      const changed: Array<string> = Array.from(readOnly.keys()).filter(
        (name: string): boolean => {
          return all.get(name) !== readOnly.get(name);
        },
      );

      expect(changed).toEqual(["k8s_generate_resource"]);
    },
  );

  test("a mark on kAgent's k8s_generate_resource lapses when kAgent starts again", () => {
    const marked: McpToolDescription = read(
      readKAgentToolsRecording({ version: "0.3.2" }).tools.find(
        (raw: JSONObject): boolean => {
          return raw["name"] === "k8s_generate_resource";
        },
      )!,
    );
    const afterRestart: McpToolDescription = read(
      readKAgentToolsRecording({
        version: "0.3.2",
        isReadOnly: true,
      }).tools.find((raw: JSONObject): boolean => {
        return raw["name"] === "k8s_generate_resource";
      })!,
    );

    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: describeMcpToolForStatus(afterRestart),
        marks: [{ toolFingerprint: getMcpToolFingerprint(marked) }],
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.MarkLapsed);
  });

  test("kAgent 0.3: no tool says anything of itself, so every one is the admin's to judge", () => {
    for (const raw of readKAgentToolsRecording({ version: "0.3.2" }).tools) {
      const status: ExternalMcpToolForStatus = describeMcpToolForStatus(
        read(raw),
      );

      expect({ name: raw["name"], readsOnly: status.readsOnly }).toEqual({
        name: raw["name"],
        readsOnly: false,
      });
      expect({
        name: raw["name"],
        serverMarksAsChange: status.serverMarksAsChange,
      }).toEqual({ name: raw["name"], serverMarksAsChange: false });
    }
  });

  test("kAgent 0.2 (mcp-go): every tool says it may destroy something, so none can be marked", () => {
    for (const raw of readKAgentToolsRecording({ version: "0.2.1" }).tools) {
      const status: ExternalMcpToolForStatus = describeMcpToolForStatus(
        read(raw),
      );

      expect({
        name: raw["name"],
        status: getExternalMcpToolReadOnlyStatus({ tool: status }),
      }).toEqual({
        name: raw["name"],
        status: ExternalMcpToolReadOnlyStatus.ServerMarksChange,
      });
    }
  });
});

describe("what deciding a tool's status reads of a tool just read", () => {
  test("its server's word, its fingerprint and why it can never be marked", () => {
    const shell: McpToolDescription = read({
      name: "shell",
      description: "Execute shell commands",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string" } },
      },
    });

    expect(describeMcpToolForStatus(shell)).toEqual({
      readsOnly: false,
      serverMarksAsChange: false,
      fingerprint: getMcpToolFingerprint(shell),
      markRefusal: {
        kind: ExternalMcpToolMarkRefusalKind.NameSaysItChanges,
        word: "shell",
      },
    });
  });

  test("a tool nothing refuses carries no refusal", () => {
    expect(
      describeMcpToolForStatus(read(GET_RESOURCES)).markRefusal,
    ).toBeUndefined();
  });
});
