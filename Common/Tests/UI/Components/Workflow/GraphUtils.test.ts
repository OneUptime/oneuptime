import {
  getUpstreamComponentIds,
  getComponentSummary,
  getNodeStatus,
} from "../../../../UI/Components/Workflow/GraphUtils";
import {
  ComponentInputType,
  NodeDataProp,
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
