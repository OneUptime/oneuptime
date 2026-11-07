import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import ComponentMetadata, { NodeType } from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import Components from "../../../Types/Workflow/Components";
import {
  WORKFLOW_GRAPH_CHANGE_LINE_LIMIT,
  WorkflowComponentLookup,
  WorkflowGraphChanges,
  describeWorkflowGraphSize,
  getWorkflowGraphChanges,
  limitLines,
  listWorkflowGraphSteps,
  readWorkflowGraph,
} from "../../../Utils/Workflow/WorkflowGraphChanges";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * What a workflow save says in the audit log (issue #6187): the steps and
 * connections that changed, in plain lines - and nothing at all for a save
 * that only moved or selected a card, which the builder makes a second after
 * every click.
 */

const COMPONENTS: Map<string, ComponentMetadata> = new Map<
  string,
  ComponentMetadata
>(
  Components.map(
    (component: ComponentMetadata): [string, ComponentMetadata] => {
      return [component.id, component];
    },
  ),
);

const lookup: WorkflowComponentLookup = (
  componentId: string,
): ComponentMetadata | undefined => {
  return COMPONENTS.get(componentId);
};

interface NodeSpec {
  key: string;
  stepId: string;
  componentId: string;
  args?: JSONObject | undefined;
  x?: number | undefined;
  y?: number | undefined;
  selected?: boolean | undefined;
  placeholder?: boolean | undefined;
}

interface EdgeSpec {
  from: string;
  to: string;
  fromPort?: string | undefined;
  id?: string | undefined;
}

function node(spec: NodeSpec): JSONObject {
  return {
    id: spec.key,
    type: "node",
    position: { x: spec.x ?? 100, y: spec.y ?? 100 },
    positionAbsolute: { x: spec.x ?? 100, y: spec.y ?? 100 },
    width: 256,
    height: 120,
    selected: Boolean(spec.selected),
    dragging: false,
    data: {
      id: spec.stepId,
      nodeType: spec.placeholder ? NodeType.PlaceholderNode : NodeType.Node,
      componentType: "Component",
      metadataId: spec.componentId,
      internalId: `internal-${spec.key}`,
      error: "",
      arguments: spec.args || {},
      returnValues: {},
    },
  };
}

function edge(spec: EdgeSpec): JSONObject {
  return {
    id: spec.id || `${spec.from}-${spec.to}`,
    source: spec.from,
    target: spec.to,
    sourceHandle: spec.fromPort || "success",
    targetHandle: "in",
  };
}

function graph(nodes: Array<NodeSpec>, edges: Array<EdgeSpec>): JSONObject {
  return { nodes: nodes.map(node), edges: edges.map(edge) };
}

const MANUAL: NodeSpec = {
  key: "n-manual",
  stepId: "manual-1",
  componentId: ComponentID.Manual,
};

const EMAIL: NodeSpec = {
  key: "n-email",
  stepId: "send-email-1",
  componentId: ComponentID.SendEmail,
  args: {
    to: "oncall@example.com",
    subject: "Disk full",
    "smtp-password": "hunter2-very-secret",
  },
};

const IF_ELSE: NodeSpec = {
  key: "n-if",
  stepId: "if-else-1",
  componentId: ComponentID.IfElse,
};

const LOG: NodeSpec = {
  key: "n-log",
  stepId: "log-1",
  componentId: ComponentID.Log,
  args: { value: "{{local.components.manual-1.returnValues.value}}" },
};

function changes(
  before: unknown,
  after: unknown,
  withLookup: boolean = true,
): WorkflowGraphChanges {
  return getWorkflowGraphChanges({
    before,
    after,
    lookup: withLookup ? lookup : undefined,
  });
}

describe("a save that changes nothing a workflow does says nothing", () => {
  const base: JSONObject = graph(
    [MANUAL, EMAIL, IF_ELSE, LOG],
    [
      { from: MANUAL.key, to: IF_ELSE.key },
      { from: IF_ELSE.key, to: EMAIL.key, fromPort: "yes" },
      { from: IF_ELSE.key, to: LOG.key, fromPort: "no" },
    ],
  );

  test("the same graph saved again", () => {
    expect(changes(base, JSON.parse(JSON.stringify(base))).lines).toEqual([]);
  });

  test("a card moved", () => {
    const moved: JSONObject = graph(
      [MANUAL, { ...EMAIL, x: 900, y: 40 }, IF_ELSE, LOG],
      [
        { from: MANUAL.key, to: IF_ELSE.key },
        { from: IF_ELSE.key, to: EMAIL.key, fromPort: "yes" },
        { from: IF_ELSE.key, to: LOG.key, fromPort: "no" },
      ],
    );

    expect(changes(base, moved).lines).toEqual([]);
  });

  test("a card selected, or measured again, and the edges restyled with new ids", () => {
    const selected: JSONObject = graph(
      [{ ...MANUAL, selected: true }, EMAIL, IF_ELSE, LOG],
      [
        { from: MANUAL.key, to: IF_ELSE.key, id: "other-1" },
        { from: IF_ELSE.key, to: EMAIL.key, fromPort: "yes", id: "other-2" },
        { from: IF_ELSE.key, to: LOG.key, fromPort: "no", id: "other-3" },
      ],
    );
    ((selected["nodes"] as Array<JSONObject>)[0] as JSONObject)["width"] = 300;
    ((selected["edges"] as Array<JSONObject>)[0] as JSONObject)["style"] = {
      stroke: "#000",
    };

    expect(changes(base, selected).lines).toEqual([]);
  });

  test("the steps and connections listed in another order", () => {
    const random: SeededRandom = seededRandom(6187);
    const reordered: JSONObject = {
      nodes: shuffled(base["nodes"] as Array<JSONObject>, random),
      edges: shuffled(base["edges"] as Array<JSONObject>, random),
    };

    expect(changes(base, reordered).lines).toEqual([]);
  });

  test("a step's error message and returned values, which are the canvas's", () => {
    const after: JSONObject = JSON.parse(JSON.stringify(base));
    const data: JSONObject = (
      (after["nodes"] as Array<JSONObject>)[1] as JSONObject
    )["data"] as JSONObject;
    data["error"] = "To Email is required";
    data["returnValues"] = { error: "x" };
    data["metadata"] = { title: "anything" };

    expect(changes(base, after).lines).toEqual([]);
  });

  test("a setting cleared to an empty text is the setting left out", () => {
    const before: JSONObject = graph([{ ...LOG, args: {} }], []);
    const after: JSONObject = graph([{ ...LOG, args: { value: "" } }], []);

    expect(changes(before, after).lines).toEqual([]);
  });

  test("settings written with their keys in another order", () => {
    const before: JSONObject = graph(
      [{ ...LOG, args: { value: { a: 1, b: [1, { c: 2, d: 3 }] } } }],
      [],
    );
    const after: JSONObject = graph(
      [{ ...LOG, args: { value: { b: [1, { d: 3, c: 2 }], a: 1 } } }],
      [],
    );

    expect(changes(before, after).lines).toEqual([]);
  });
});

describe("the steps that changed", () => {
  test("a step added says its title and id", () => {
    expect(
      changes(graph([MANUAL], []), graph([MANUAL, EMAIL], [])).lines,
    ).toEqual(['Added "Send Email" (send-email-1)']);
  });

  test("a step removed, without a line for each of its connections", () => {
    const before: JSONObject = graph(
      [MANUAL, LOG],
      [{ from: MANUAL.key, to: LOG.key }],
    );

    expect(changes(before, graph([MANUAL], [])).lines).toEqual([
      'Removed "Log" (log-1)',
    ]);
  });

  test("settings changed are named, never quoted", () => {
    const after: NodeSpec = {
      ...EMAIL,
      args: {
        to: "everyone@example.com",
        subject: "Disk is full",
        "smtp-password": "a-new-password-nobody-should-see",
      },
    };

    const result: WorkflowGraphChanges = changes(
      graph([MANUAL, EMAIL], []),
      graph([MANUAL, after], []),
    );

    expect(result.lines).toEqual([
      'Changed "SMTP Password", "Subject" and "To Email" in "Send Email" (send-email-1)',
    ]);

    const text: string = JSON.stringify(result);

    for (const value of [
      "everyone@example.com",
      "Disk is full",
      "a-new-password-nobody-should-see",
      "hunter2-very-secret",
      "oncall@example.com",
    ]) {
      expect(text).not.toContain(value);
    }
  });

  test("more than four settings changed: three named and the rest counted", () => {
    const before: JSONObject = graph(
      [
        {
          ...EMAIL,
          args: {
            from: "a",
            to: "b",
            subject: "c",
            "email-body": "d",
            "smtp-host": "e",
          },
        },
      ],
      [],
    );
    const after: JSONObject = graph(
      [
        {
          ...EMAIL,
          args: {
            from: "1",
            to: "2",
            subject: "3",
            "email-body": "4",
            "smtp-host": "5",
          },
        },
      ],
      [],
    );

    expect(changes(before, after).lines).toEqual([
      'Changed "Email Body", "From Email", "SMTP HOST" and 2 more settings in "Send Email" (send-email-1)',
    ]);
  });

  test("a step renamed says its old and new ids", () => {
    expect(
      changes(graph([LOG], []), graph([{ ...LOG, stepId: "log-final" }], []))
        .lines,
    ).toEqual(['Renamed "Log" (log-1) to "log-final"']);
  });

  test("a step whose component was swapped", () => {
    expect(
      changes(
        graph([LOG], []),
        graph([{ ...LOG, componentId: ComponentID.SendEmail }], []),
      ).lines,
    ).toEqual(['Replaced "Log" (log-1) with "Send Email" (log-1)']);
  });

  test("a change to a part of a step this does not know is still a change", () => {
    const after: JSONObject = graph([LOG], []);
    (
      ((after["nodes"] as Array<JSONObject>)[0] as JSONObject)[
        "data"
      ] as JSONObject
    )["isDisabled"] = true;

    expect(changes(graph([LOG], []), after).lines).toEqual([
      'Changed how "Log" (log-1) is set up',
    ]);
  });

  test("without component metadata, a step is named by its component and its settings by their ids", () => {
    const result: WorkflowGraphChanges = changes(
      graph([{ ...LOG, args: { value: "a" } }], []),
      graph([{ ...LOG, args: { value: "b" } }, EMAIL], []),
      false,
    );

    expect(result.lines).toEqual([
      'Added "send-email" (send-email-1)',
      'Changed "value" in "log" (log-1)',
    ]);
  });

  test("a component the lookup does not know is named by its id", () => {
    const unknown: NodeSpec = {
      key: "n-x",
      stepId: "monitor-on-create-1",
      componentId: "monitor-on-create",
    };

    expect(changes(graph([], []), graph([unknown], [])).lines).toEqual([
      'Added "monitor-on-create" (monitor-on-create-1)',
    ]);
  });

  test("a lookup that throws is no lookup", () => {
    const result: WorkflowGraphChanges = getWorkflowGraphChanges({
      before: graph([], []),
      after: graph([LOG], []),
      lookup: (): ComponentMetadata | undefined => {
        throw new Error("broken");
      },
    });

    expect(result.lines).toEqual(['Added "log" (log-1)']);
  });

  test("the empty slot where a trigger goes is not a step", () => {
    const slot: NodeSpec = {
      key: "n-slot",
      stepId: "",
      componentId: "",
      placeholder: true,
    };

    expect(changes(graph([slot], []), graph([MANUAL], [])).lines).toEqual([
      'Added "Manual" (manual-1)',
    ]);
    expect(readWorkflowGraph(graph([slot, LOG], [])).steps).toHaveLength(1);
  });
});

describe("the connections that changed", () => {
  test("a connection from a step with one output names no output", () => {
    expect(
      changes(
        graph([MANUAL, LOG], []),
        graph([MANUAL, LOG], [{ from: MANUAL.key, to: LOG.key }]),
      ).lines,
    ).toEqual(['Connected "Manual" (manual-1) to "Log" (log-1)']);
  });

  test("a connection from one of several outputs names the output", () => {
    expect(
      changes(
        graph([IF_ELSE, EMAIL], []),
        graph(
          [IF_ELSE, EMAIL],
          [{ from: IF_ELSE.key, to: EMAIL.key, fromPort: "yes" }],
        ),
      ).lines,
    ).toEqual([
      'Connected the "Yes" output of "If / Else" (if-else-1) to "Send Email" (send-email-1)',
    ]);
  });

  test("moving a connection from one output to another is one removed and one made", () => {
    const before: JSONObject = graph(
      [IF_ELSE, LOG],
      [{ from: IF_ELSE.key, to: LOG.key, fromPort: "yes" }],
    );
    const after: JSONObject = graph(
      [IF_ELSE, LOG],
      [{ from: IF_ELSE.key, to: LOG.key, fromPort: "no" }],
    );

    expect(changes(before, after).lines).toEqual([
      'Connected the "No" output of "If / Else" (if-else-1) to "Log" (log-1)',
      'Removed the connection from the "Yes" output of "If / Else" (if-else-1) to "Log" (log-1)',
    ]);
  });

  test("a step added with its connection says both", () => {
    expect(
      changes(
        graph([MANUAL], []),
        graph([MANUAL, LOG], [{ from: MANUAL.key, to: LOG.key }]),
      ).lines,
    ).toEqual([
      'Added "Log" (log-1)',
      'Connected "Manual" (manual-1) to "Log" (log-1)',
    ]);
  });

  test("a connection to a step that is not there runs nothing and says nothing", () => {
    expect(
      changes(
        graph([MANUAL], []),
        graph([MANUAL], [{ from: MANUAL.key, to: "gone" }]),
      ).lines,
    ).toEqual([]);
  });
});

describe("what a graph holds, in a few words", () => {
  test("counts steps and the connections between them", () => {
    expect(
      describeWorkflowGraphSize(
        graph(
          [MANUAL, LOG, EMAIL],
          [
            { from: MANUAL.key, to: LOG.key },
            { from: LOG.key, to: EMAIL.key, fromPort: "out" },
            { from: LOG.key, to: "gone" },
          ],
        ),
      ),
    ).toBe("3 steps and 2 connections");
    expect(describeWorkflowGraphSize(graph([LOG], []))).toBe(
      "1 step and no connections",
    );
    expect(describeWorkflowGraphSize({ nodes: [], edges: [] })).toBe(
      "No steps and no connections",
    );
  });

  test("lists the steps of a workflow created or deleted", () => {
    expect(
      listWorkflowGraphSteps({
        graph: graph([MANUAL, LOG, EMAIL], []),
        lookup,
      }),
    ).toEqual([
      '"Log" (log-1)',
      '"Manual" (manual-1)',
      '"Send Email" (send-email-1)',
    ]);
  });
});

describe("a graph that cannot be read is an empty one, never an error", () => {
  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a number", 42],
    ["a list", []],
    ["text that is not JSON", "{nodes:"],
    ["nodes that are not a list", { nodes: "x", edges: 3 }],
    ["nodes that are not objects", { nodes: [1, "two", null], edges: [null] }],
  ])("%s", (_name: string, value: unknown) => {
    expect(readWorkflowGraph(value)).toEqual({ steps: [], connections: [] });
    expect(changes(value, value).lines).toEqual([]);
    expect(describeWorkflowGraphSize(value)).toBe(
      "No steps and no connections",
    );
  });

  test("a graph saved as JSON text is read like the object", () => {
    const value: JSONObject = graph(
      [MANUAL, LOG],
      [{ from: MANUAL.key, to: LOG.key }],
    );

    expect(readWorkflowGraph(JSON.stringify(value))).toEqual(
      readWorkflowGraph(value),
    );
    expect(changes(JSON.stringify(value), value).lines).toEqual([]);
  });

  test("a node listed twice is one step", () => {
    const value: JSONObject = graph([LOG, LOG], []);

    expect(readWorkflowGraph(value).steps).toHaveLength(1);
  });
});

describe("a long list of changes is cut, and says how many more there were", () => {
  test("a workflow rebuilt from scratch", () => {
    const steps: Array<NodeSpec> = [];

    for (let index: number = 0; index < 60; index++) {
      steps.push({
        key: `n-${index}`,
        stepId: `log-${index}`,
        componentId: ComponentID.Log,
      });
    }

    const result: WorkflowGraphChanges = changes(
      graph([], []),
      graph(steps, []),
    );

    expect(result.totalChanges).toBe(60);
    expect(result.lines).toHaveLength(WORKFLOW_GRAPH_CHANGE_LINE_LIMIT);
    expect(result.lines[result.lines.length - 1]).toBe(
      `and ${60 - (WORKFLOW_GRAPH_CHANGE_LINE_LIMIT - 1)} more changes`,
    );
  });

  test("limitLines keeps a list that fits whole, and counts what it cuts", () => {
    expect(limitLines({ lines: ["a", "b"], limit: 2, noun: "change" })).toEqual(
      ["a", "b"],
    );
    expect(
      limitLines({
        lines: ["a", "b", "c", "d", "e"],
        limit: 4,
        noun: "change",
      }),
    ).toEqual(["a", "b", "c", "and 2 more changes"]);
    expect(
      limitLines({ lines: ["a", "b", "c", "d"], limit: 3, noun: "step" }),
    ).toEqual(["a", "b", "and 2 more steps"]);
  });

  test("limitLines never cuts to fewer than the one line that counts", () => {
    expect(limitLines({ lines: ["a", "b"], limit: 0, noun: "step" })).toEqual([
      "and 2 more steps",
    ]);
    expect(limitLines({ lines: ["a", "b"], limit: 1, noun: "change" })).toEqual(
      ["and 2 more changes"],
    );
    expect(
      limitLines({ lines: ["a", "b", "c"], limit: 2.9, noun: "step" }),
    ).toEqual(["a", "and 2 more steps"]);
  });
});

describe("property: random edits are reported, and only they", () => {
  /*
   * A random graph, then random edits of the kinds a person makes. Every
   * edit that changes what the workflow does gives at least one line; moving
   * and selecting cards gives none; and no value typed into a setting ever
   * appears in a line.
   */
  const SECRET_VALUE_PREFIX: string = "typed-value-";

  function randomGraph(random: SeededRandom): Array<NodeSpec> {
    const count: number = 1 + random(6);
    const kinds: Array<string> = [
      ComponentID.Log,
      ComponentID.SendEmail,
      ComponentID.IfElse,
      ComponentID.Manual,
    ];
    const steps: Array<NodeSpec> = [];

    for (let index: number = 0; index < count; index++) {
      steps.push({
        key: `n-${index}`,
        stepId: `step-${index}`,
        componentId: kinds[random(kinds.length)] as string,
        args: { value: `${SECRET_VALUE_PREFIX}${random(1000)}` },
        x: random(1000),
        y: random(1000),
      });
    }

    return steps;
  }

  test("over 500 seeded graphs", () => {
    const random: SeededRandom = seededRandom(61870);

    for (let run: number = 0; run < 500; run++) {
      const steps: Array<NodeSpec> = randomGraph(random);
      const edges: Array<EdgeSpec> = steps
        .slice(1)
        .map((step: NodeSpec, index: number): EdgeSpec => {
          return { from: (steps[index] as NodeSpec).key, to: step.key };
        });
      const before: JSONObject = graph(steps, edges);

      // Cosmetic: every card moved and one selected.
      const cosmetic: JSONObject = graph(
        steps.map((step: NodeSpec, index: number): NodeSpec => {
          return {
            ...step,
            x: random(2000),
            y: random(2000),
            selected: index === 0,
          };
        }),
        edges,
      );

      expect(changes(before, cosmetic).lines).toEqual([]);

      // Real: one of the edits a person makes.
      const edit: number = random(4);
      let after: JSONObject;

      if (edit === 0) {
        after = graph(
          [
            ...steps,
            {
              key: "n-new",
              stepId: "step-new",
              componentId: ComponentID.Log,
            },
          ],
          edges,
        );
      } else if (edit === 1) {
        after = graph(steps.slice(1), edges.slice(1));
      } else if (edit === 2) {
        after = graph(
          steps.map((step: NodeSpec, index: number): NodeSpec => {
            return index === 0
              ? { ...step, args: { value: `${SECRET_VALUE_PREFIX}changed` } }
              : step;
          }),
          edges,
        );
      } else {
        after = graph(steps, [
          ...edges,
          {
            from: (steps[steps.length - 1] as NodeSpec).key,
            to: (steps[0] as NodeSpec).key,
            fromPort: "loop",
          },
        ]);
      }

      const result: WorkflowGraphChanges = changes(before, after);

      expect(result.lines.length).toBeGreaterThan(0);
      expect(JSON.stringify(result)).not.toContain(SECRET_VALUE_PREFIX);
      expect(changes(after, after).lines).toEqual([]);
    }
  });
});
