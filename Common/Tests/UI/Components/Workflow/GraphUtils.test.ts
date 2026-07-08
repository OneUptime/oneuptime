import {
  getUpstreamComponentIds,
  getComponentSummary,
  getNodeStatus,
  buildOutline,
  WorkflowOutline,
  renameComponentReferences,
} from "../../../../UI/Components/Workflow/GraphUtils";
import {
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";
import { Edge, Node } from "reactflow";

type MakeNodeFunction = (nodeId: string, dataId: string) => Node;

const makeNode: MakeNodeFunction = (nodeId: string, dataId: string): Node => {
  return {
    id: nodeId,
    position: { x: 0, y: 0 },
    data: { id: dataId } as NodeDataProp,
  };
};

type MakeEdgeFunction = (source: string, target: string) => Edge;

const makeEdge: MakeEdgeFunction = (source: string, target: string): Edge => {
  return { id: `${source}->${target}`, source: source, target: target };
};

describe("GraphUtils.getUpstreamComponentIds", () => {
  test("returns all ancestors in a linear chain A -> B -> C", () => {
    const nodes: Array<Node> = [
      makeNode("nA", "a-1"),
      makeNode("nB", "b-1"),
      makeNode("nC", "c-1"),
    ];
    const edges: Array<Edge> = [makeEdge("nA", "nB"), makeEdge("nB", "nC")];

    const upstreamOfC: Set<string> = getUpstreamComponentIds(
      "nC",
      nodes,
      edges,
    );
    expect(upstreamOfC).toEqual(new Set(["a-1", "b-1"]));
  });

  test("a root node has no upstream", () => {
    const nodes: Array<Node> = [makeNode("nA", "a-1"), makeNode("nB", "b-1")];
    const edges: Array<Edge> = [makeEdge("nA", "nB")];

    expect(getUpstreamComponentIds("nA", nodes, edges)).toEqual(
      new Set<string>(),
    );
  });

  test("collects all ancestors across a diamond and does not include self", () => {
    // A -> B, A -> C, B -> D, C -> D
    const nodes: Array<Node> = [
      makeNode("nA", "a-1"),
      makeNode("nB", "b-1"),
      makeNode("nC", "c-1"),
      makeNode("nD", "d-1"),
    ];
    const edges: Array<Edge> = [
      makeEdge("nA", "nB"),
      makeEdge("nA", "nC"),
      makeEdge("nB", "nD"),
      makeEdge("nC", "nD"),
    ];

    const upstreamOfD: Set<string> = getUpstreamComponentIds(
      "nD",
      nodes,
      edges,
    );
    expect(upstreamOfD).toEqual(new Set(["a-1", "b-1", "c-1"]));
    expect(upstreamOfD.has("d-1")).toBe(false);
  });

  test("terminates on a cycle instead of looping forever", () => {
    // A -> B -> A (pathological), asking upstream of B
    const nodes: Array<Node> = [makeNode("nA", "a-1"), makeNode("nB", "b-1")];
    const edges: Array<Edge> = [makeEdge("nA", "nB"), makeEdge("nB", "nA")];

    const upstreamOfB: Set<string> = getUpstreamComponentIds(
      "nB",
      nodes,
      edges,
    );
    expect(upstreamOfB).toEqual(new Set(["a-1"]));
  });
});

type MakeDataFunction = (
  args: Array<{ id: string; name: string; type: ComponentInputType }>,
  values: Record<string, unknown>,
) => NodeDataProp;

const makeData: MakeDataFunction = (
  args: Array<{ id: string; name: string; type: ComponentInputType }>,
  values: Record<string, unknown>,
): NodeDataProp => {
  return {
    metadata: {
      arguments: args.map(
        (a: { id: string; name: string; type: ComponentInputType }) => {
          return {
            id: a.id,
            name: a.name,
            type: a.type,
            description: "",
            required: false,
          };
        },
      ),
    },
    arguments: values,
  } as unknown as NodeDataProp;
};

describe("GraphUtils.getComponentSummary", () => {
  test("returns null when nothing is configured", () => {
    const data: NodeDataProp = makeData(
      [{ id: "text", name: "Message", type: ComponentInputType.Text }],
      {},
    );
    expect(getComponentSummary(data)).toBeNull();
  });

  test("summarizes up to two configured values", () => {
    const data: NodeDataProp = makeData(
      [
        { id: "channel", name: "Channel", type: ComponentInputType.Text },
        { id: "text", name: "Message", type: ComponentInputType.Text },
        { id: "extra", name: "Extra", type: ComponentInputType.Text },
      ],
      { channel: "#alerts", text: "Incident is down", extra: "ignored" },
    );
    expect(getComponentSummary(data)).toBe(
      "Channel: #alerts · Message: Incident is down",
    );
  });

  test("redacts secret-typed and secret-named fields", () => {
    const data: NodeDataProp = makeData(
      [
        {
          id: "webhook-url",
          name: "Slack Webhook URL",
          type: ComponentInputType.URL,
        },
      ],
      { "webhook-url": "https://hooks.slack.com/services/TOKEN" },
    );
    expect(getComponentSummary(data)).toBe("Slack Webhook URL: ••••");

    const pwd: NodeDataProp = makeData(
      [{ id: "pw", name: "Password", type: ComponentInputType.Password }],
      { pw: "hunter2" },
    );
    expect(getComponentSummary(pwd)).toBe("Password: ••••");
  });

  test("truncates long values", () => {
    const longText: string = "x".repeat(100);
    const data: NodeDataProp = makeData(
      [{ id: "text", name: "Msg", type: ComponentInputType.Text }],
      { text: longText },
    );
    const summary: string | null = getComponentSummary(data);
    expect(summary).not.toBeNull();
    expect(summary!.endsWith("…")).toBe(true);
    // "Msg: " + 40 chars max
    expect(summary!.length).toBeLessThanOrEqual("Msg: ".length + 40);
  });

  test("redacts structured/opaque types (JSON, headers) that may hold secrets", () => {
    const headers: NodeDataProp = makeData(
      [
        {
          id: "request-headers",
          name: "Request Headers",
          type: ComponentInputType.StringDictionary,
        },
      ],
      { "request-headers": '{"Authorization":"Bearer eyJsecrettoken"}' },
    );
    expect(getComponentSummary(headers)).toBe("Request Headers: ••••");

    const body: NodeDataProp = makeData(
      [{ id: "request-body", name: "Body", type: ComponentInputType.JSON }],
      { "request-body": '{"apiKey":"sk-live-123"}' },
    );
    expect(getComponentSummary(body)).toBe("Body: ••••");
  });

  test("masks credentials and query string from URL values", () => {
    const withCreds: NodeDataProp = makeData(
      [{ id: "endpoint", name: "Endpoint", type: ComponentInputType.URL }],
      { endpoint: "https://user:p@ssw0rd@internal.host/path?sig=secret" },
    );
    // userinfo and query dropped, host + path kept.
    expect(getComponentSummary(withCreds)).toBe(
      "Endpoint: https://internal.host/path",
    );

    const plain: NodeDataProp = makeData(
      [{ id: "endpoint", name: "Endpoint", type: ComponentInputType.URL }],
      { endpoint: "https://api.example.com/v1" },
    );
    expect(getComponentSummary(plain)).toBe(
      "Endpoint: https://api.example.com/v1",
    );
  });

  test("humanizes {{ tokens }} into friendly names", () => {
    const data: NodeDataProp = makeData(
      [{ id: "text", name: "Message", type: ComponentInputType.Text }],
      {
        text: "Incident {{local.components.incident-1.returnValues.title}} is down",
      },
    );
    expect(getComponentSummary(data)).toBe("Message: Incident {title} is down");
  });

  test("skips a value that is only whitespace (no dangling label)", () => {
    const data: NodeDataProp = makeData(
      [
        { id: "a", name: "A", type: ComponentInputType.Text },
        { id: "b", name: "B", type: ComponentInputType.Text },
      ],
      { a: "   ", b: "real" },
    );
    expect(getComponentSummary(data)).toBe("B: real");
  });
});

describe("GraphUtils.getNodeStatus", () => {
  const requiredArgData: (values: Record<string, unknown>) => NodeDataProp = (
    values: Record<string, unknown>,
  ): NodeDataProp => {
    return {
      error: "",
      metadata: {
        arguments: [
          {
            id: "url",
            name: "URL",
            type: ComponentInputType.URL,
            description: "",
            required: true,
          },
          {
            id: "note",
            name: "Note",
            type: ComponentInputType.Text,
            description: "",
            required: false,
          },
        ],
      },
      arguments: values,
    } as unknown as NodeDataProp;
  };

  test("is 'error' when the node reported an error", () => {
    const data: NodeDataProp = requiredArgData({ url: "https://x" });
    (data as { error: string }).error = "boom";
    expect(getNodeStatus(data)).toBe("error");
  });

  test("is 'incomplete' when a required argument is empty", () => {
    expect(getNodeStatus(requiredArgData({}))).toBe("incomplete");
    expect(getNodeStatus(requiredArgData({ url: "" }))).toBe("incomplete");
  });

  test("is 'ready' when all required arguments are filled", () => {
    expect(getNodeStatus(requiredArgData({ url: "https://x" }))).toBe("ready");
  });

  test("ignores optional arguments", () => {
    // note is optional and empty, url is filled -> still ready.
    expect(getNodeStatus(requiredArgData({ url: "https://x", note: "" }))).toBe(
      "ready",
    );
  });

  test("is 'ready' for a step with no arguments", () => {
    const data: NodeDataProp = {
      error: "",
      metadata: { arguments: [] },
      arguments: {},
    } as unknown as NodeDataProp;
    expect(getNodeStatus(data)).toBe("ready");
  });
});

describe("GraphUtils.buildOutline", () => {
  const wfNode: (
    rfId: string,
    dataId: string,
    title: string,
    componentType: ComponentType,
    outPorts: Array<{ id: string; title: string }>,
  ) => Node = (
    rfId: string,
    dataId: string,
    title: string,
    componentType: ComponentType,
    outPorts: Array<{ id: string; title: string }>,
  ): Node => {
    return {
      id: rfId,
      position: { x: 0, y: 0 },
      data: {
        id: dataId,
        nodeType: NodeType.Node,
        componentType: componentType,
        metadata: {
          title: title,
          outPorts: outPorts.map((p: { id: string; title: string }) => {
            return { id: p.id, title: p.title, description: "" };
          }),
          arguments: [],
        },
        arguments: {},
      },
    } as unknown as Node;
  };

  const edge: (source: string, target: string, handle: string) => Edge = (
    source: string,
    target: string,
    handle: string,
  ): Edge => {
    return {
      id: `${source}->${target}`,
      source: source,
      target: target,
      sourceHandle: handle,
    };
  };

  test("returns hasTrigger=false with no trigger", () => {
    const nodes: Array<Node> = [
      wfNode("n1", "log-1", "Log", ComponentType.Component, []),
    ];
    const outline: WorkflowOutline = buildOutline(nodes, []);
    expect(outline.hasTrigger).toBe(false);
    expect(outline.entries).toHaveLength(0);
  });

  test("linearises a simple chain with increasing depth", () => {
    const nodes: Array<Node> = [
      wfNode("t", "schedule-1", "Schedule", ComponentType.Trigger, [
        { id: "execute", title: "Execute" },
      ]),
      wfNode("a", "slack-1", "Slack", ComponentType.Component, [
        { id: "success", title: "Success" },
      ]),
      wfNode("b", "log-1", "Log", ComponentType.Component, []),
    ];
    const edges: Array<Edge> = [
      edge("t", "a", "execute"),
      edge("a", "b", "success"),
    ];

    const outline: WorkflowOutline = buildOutline(nodes, edges);
    expect(outline.hasTrigger).toBe(true);
    expect(
      outline.entries.map((e: { title: string; depth: number }) => {
        return `${e.depth}:${e.title}`;
      }),
    ).toEqual(["0:Schedule", "1:Slack", "2:Log"]);
    expect(outline.hasMultiplePaths).toBe(false);
  });

  test("labels branches by their out-port when a step has multiple ports", () => {
    const nodes: Array<Node> = [
      wfNode("t", "schedule-1", "Schedule", ComponentType.Trigger, [
        { id: "execute", title: "Execute" },
      ]),
      wfNode("if", "if-else-1", "If / Else", ComponentType.Component, [
        { id: "yes", title: "Yes" },
        { id: "no", title: "No" },
      ]),
      wfNode("x", "slack-1", "Slack", ComponentType.Component, []),
      wfNode("y", "log-1", "Log", ComponentType.Component, []),
    ];
    const edges: Array<Edge> = [
      edge("t", "if", "execute"),
      edge("if", "x", "yes"),
      edge("if", "y", "no"),
    ];

    const outline: WorkflowOutline = buildOutline(nodes, edges);
    const branchLabels: Record<string, string | undefined> = {};
    for (const entry of outline.entries) {
      branchLabels[entry.title] = entry.branchLabel;
    }
    expect(branchLabels["Slack"]).toBe("Yes");
    expect(branchLabels["Log"]).toBe("No");
    // The trigger's single out-port doesn't get a branch label.
    expect(branchLabels["If / Else"]).toBeUndefined();
  });

  test("marks a merge/loop step as repeated and flags multiple paths", () => {
    // t -> a -> c, t -> b -> c  (c is a fan-in)
    const nodes: Array<Node> = [
      wfNode("t", "schedule-1", "Schedule", ComponentType.Trigger, [
        { id: "execute", title: "Execute" },
      ]),
      wfNode("a", "slack-1", "Slack", ComponentType.Component, [
        { id: "out", title: "Out" },
      ]),
      wfNode("b", "email-1", "Email", ComponentType.Component, [
        { id: "out", title: "Out" },
      ]),
      wfNode("c", "log-1", "Log", ComponentType.Component, []),
    ];
    const edges: Array<Edge> = [
      edge("t", "a", "execute"),
      edge("t", "b", "execute"),
      edge("a", "c", "out"),
      edge("b", "c", "out"),
    ];

    const outline: WorkflowOutline = buildOutline(nodes, edges);
    expect(outline.hasMultiplePaths).toBe(true);
    const logEntries: Array<{ repeated: boolean }> = outline.entries.filter(
      (e: { title: string }) => {
        return e.title === "Log";
      },
    );
    expect(logEntries).toHaveLength(2);
    expect(logEntries[0]!.repeated).toBe(false);
    expect(logEntries[1]!.repeated).toBe(true);
  });
});

describe("GraphUtils.renameComponentReferences", () => {
  const nodeWithArgs: (
    dataId: string,
    args: Record<string, unknown>,
  ) => Node = (dataId: string, args: Record<string, unknown>): Node => {
    return {
      id: `rf-${dataId}`,
      position: { x: 0, y: 0 },
      data: { id: dataId, arguments: args },
    } as unknown as Node;
  };

  const argsOf: (node: Node) => Record<string, unknown> = (
    node: Node,
  ): Record<string, unknown> => {
    return (node.data as { arguments: Record<string, unknown> }).arguments;
  };

  test("rewrites a downstream reference to the renamed step", () => {
    const nodes: Array<Node> = [
      nodeWithArgs("slack-1", {}),
      nodeWithArgs("log-1", {
        text: "Error was {{local.components.slack-1.returnValues.error}}",
      }),
    ];

    const result: Array<Node> = renameComponentReferences(
      nodes,
      "slack-1",
      "notify-slack",
    );

    expect(argsOf(result[1]!)["text"]).toBe(
      "Error was {{local.components.notify-slack.returnValues.error}}",
    );
  });

  test("does not rewrite a step whose id is only a prefix of the renamed one", () => {
    const nodes: Array<Node> = [
      nodeWithArgs("log-1", {
        a: "{{local.components.slack-1.returnValues.x}}",
        b: "{{local.components.slack-10.returnValues.y}}",
      }),
    ];

    const result: Array<Node> = renameComponentReferences(
      nodes,
      "slack-1",
      "NEW",
    );

    expect(argsOf(result[0]!)["a"]).toBe(
      "{{local.components.NEW.returnValues.x}}",
    );
    // slack-10 must be untouched.
    expect(argsOf(result[0]!)["b"]).toBe(
      "{{local.components.slack-10.returnValues.y}}",
    );
  });

  test("rewrites every occurrence within a value", () => {
    const nodes: Array<Node> = [
      nodeWithArgs("log-1", {
        text:
          "{{local.components.a-1.returnValues.x}} and " +
          "{{local.components.a-1.returnValues.y}}",
      }),
    ];

    const result: Array<Node> = renameComponentReferences(nodes, "a-1", "b-1");
    expect(argsOf(result[0]!)["text"]).toBe(
      "{{local.components.b-1.returnValues.x}} and " +
        "{{local.components.b-1.returnValues.y}}",
    );
  });

  test("is a no-op (same reference) when id is unchanged or empty", () => {
    const nodes: Array<Node> = [nodeWithArgs("slack-1", { text: "hi" })];
    expect(renameComponentReferences(nodes, "slack-1", "slack-1")).toBe(nodes);
    expect(renameComponentReferences(nodes, "", "x")).toBe(nodes);
  });

  test("leaves unaffected nodes as the same object", () => {
    const untouched: Node = nodeWithArgs("log-1", { text: "no refs here" });
    const nodes: Array<Node> = [untouched];
    const result: Array<Node> = renameComponentReferences(
      nodes,
      "slack-1",
      "x",
    );
    expect(result[0]).toBe(untouched);
  });
});
