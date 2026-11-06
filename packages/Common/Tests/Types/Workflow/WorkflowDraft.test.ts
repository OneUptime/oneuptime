import { JSONObject } from "../../../Types/JSON";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import BuiltInComponents from "../../../Types/Workflow/Components";
import { buildTemplateGraph } from "../../../Types/Workflow/Templates";
import {
  HIDDEN_SECRET_VALUE,
  WorkflowDraft,
  WorkflowDraftChanges,
  WorkflowDraftStep,
  buildGraphFromDraft,
  checkWorkflowDraft,
  describeDraftChanges,
  getDraftFromGraph,
  readWorkflowDraft,
} from "../../../Types/Workflow/WorkflowDraft";
import {
  TEMPLATE_ROW_HEIGHT,
  TEMPLATE_START,
} from "../../../Types/Workflow/TemplateLayout";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #5945: what Ask AI writes is a draft of a workflow, not a graph, and the
 * graph built from it is in the shape the Builder saves.
 */

const TRIGGER: ComponentMetadata = {
  id: "on-thing",
  title: "On Thing",
  category: "Test",
  description: "",
  componentType: ComponentType.Trigger,
  arguments: [],
  returnValues: [],
  inPorts: [],
  outPorts: [{ id: "success", title: "Success", description: "" }],
} as unknown as ComponentMetadata;

const STEP: ComponentMetadata = {
  id: "do-thing",
  title: "Do Thing",
  category: "Test",
  description: "",
  componentType: ComponentType.Component,
  arguments: [
    {
      id: "text",
      name: "Text",
      description: "",
      type: ComponentInputType.Text,
      required: true,
    },
    {
      id: "token",
      name: "Token",
      description: "",
      type: ComponentInputType.Password,
      required: false,
    },
    {
      id: "body",
      name: "Body",
      description: "",
      type: ComponentInputType.JSON,
      required: false,
    },
  ],
  returnValues: [],
  inPorts: [{ id: "in", title: "In", description: "" }],
  outPorts: [
    { id: "success", title: "Success", description: "" },
    { id: "error", title: "Error", description: "" },
  ],
} as unknown as ComponentMetadata;

const BRANCH: ComponentMetadata = {
  ...STEP,
  id: "branch",
  title: "Branch",
  outPorts: [
    { id: "yes", title: "Yes", description: "" },
    { id: "no", title: "No", description: "" },
  ],
} as unknown as ComponentMetadata;

type GetComponentFunction = (id: string) => ComponentMetadata | undefined;

const getComponent: GetComponentFunction = (
  id: string,
): ComponentMetadata | undefined => {
  return [TRIGGER, STEP, BRANCH].find((component: ComponentMetadata) => {
    return component.id === id;
  });
};

let nextId: number = 0;

const generateId: () => string = (): string => {
  nextId++;
  return `generated-${nextId}`;
};

beforeEach(() => {
  nextId = 0;
});

const A_DRAFT: WorkflowDraft = {
  steps: [
    { id: "start", componentId: "on-thing" },
    { id: "work", componentId: "do-thing", arguments: { text: "hello" } },
  ],
  connections: [{ from: "start", to: "work" }],
};

type ProblemsFunction = (draft: WorkflowDraft) => Array<string>;

const problems: ProblemsFunction = (draft: WorkflowDraft): Array<string> => {
  return checkWorkflowDraft({ draft: draft, getComponent: getComponent });
};

type GraphFunction = (
  draft: WorkflowDraft,
  existingGraph?: JSONObject,
) => { nodes: Array<any>; edges: Array<any> };

const graphOf: GraphFunction = (
  draft: WorkflowDraft,
  existingGraph?: JSONObject,
): { nodes: Array<any>; edges: Array<any> } => {
  return buildGraphFromDraft({
    draft: draft,
    getComponent: getComponent,
    generateId: generateId,
    existingGraph: existingGraph,
  }) as unknown as { nodes: Array<any>; edges: Array<any> };
};

describe("readWorkflowDraft", () => {
  test("reads steps and connections", () => {
    expect(
      readWorkflowDraft({
        steps: [{ id: " a ", componentId: "x", arguments: { y: 1 } }],
        connections: [{ from: "a", to: "b", fromOutput: "yes" }],
      }),
    ).toEqual({
      steps: [{ id: "a", componentId: "x", arguments: { y: 1 } }],
      connections: [{ from: "a", to: "b", fromOutput: "yes" }],
    });
  });

  test("a step with no settings says nothing of them: it keeps what it has", () => {
    expect(
      readWorkflowDraft({ steps: [{ id: "a", componentId: "x" }] }).steps[0],
    ).toEqual({ id: "a", componentId: "x" });
  });

  test.each([
    ["nothing", {}],
    ["text for lists", { steps: "x", connections: 3 }],
    [
      "items that are no objects",
      { steps: [1, "a", null, []], connections: [null] },
    ],
  ] as Array<[string, JSONObject]>)(
    "%s reads as an empty draft",
    (_name: string, args: JSONObject) => {
      expect(readWorkflowDraft(args)).toEqual({ steps: [], connections: [] });
    },
  );

  test("a value of the wrong kind reads as missing, for the check to say", () => {
    expect(
      readWorkflowDraft({
        steps: [{ id: 3, componentId: null, arguments: "x" }],
      }).steps[0],
    ).toEqual({ id: "", componentId: "" });
  });
});

describe("checkWorkflowDraft", () => {
  test("a trigger and a step connected is fine", () => {
    expect(problems(A_DRAFT)).toEqual([]);
  });

  test("a trigger on its own is fine", () => {
    expect(
      problems({
        steps: [{ id: "start", componentId: "on-thing" }],
        connections: [],
      }),
    ).toEqual([]);
  });

  test("nothing at all is not", () => {
    expect(problems({ steps: [], connections: [] }).join()).toContain(
      "steps is empty",
    );
  });

  test("too many steps are not, however good", () => {
    expect(
      problems({
        steps: Array.from({ length: 101 }, (_: unknown, i: number) => {
          return { id: `s${i}`, componentId: "do-thing" };
        }),
        connections: [],
      }).join(),
    ).toContain("100 at most");
  });

  test.each(["a.b", "a b", "", "a/b", "{{x}}"])(
    "the id %p cannot be read back by a reference",
    (id: string) => {
      expect(
        problems({
          steps: [
            { id: "start", componentId: "on-thing" },
            { id: id, componentId: "do-thing" },
          ],
          connections: [],
        }).join(),
      ).toContain("letters, numbers");
    },
  );

  test("two steps cannot share an id", () => {
    expect(
      problems({
        steps: [
          { id: "start", componentId: "on-thing" },
          { id: "a", componentId: "do-thing" },
          { id: "a", componentId: "do-thing" },
        ],
        connections: [],
      }).join(),
    ).toContain('Two steps have the id "a"');
  });

  test("a component that does not exist is named, with where to look", () => {
    const found: string = problems({
      steps: [{ id: "a", componentId: "no-such-thing" }],
      connections: [],
    }).join();

    expect(found).toContain('no component "no-such-thing"');
    expect(found).toContain("find_workflow_components");
  });

  test("a setting the component does not have is named, with the ones it has", () => {
    const found: string = problems({
      steps: [
        { id: "start", componentId: "on-thing" },
        { id: "a", componentId: "do-thing", arguments: { texts: "x" } },
      ],
      connections: [],
    }).join();

    expect(found).toContain('no setting "texts"');
    expect(found).toContain("text, token, body");
  });

  test("no trigger is said once, when every step is known", () => {
    expect(
      problems({
        steps: [{ id: "a", componentId: "do-thing" }],
        connections: [],
      }).join(),
    ).toContain("starts from a trigger");
  });

  test("no trigger is not said over a component it could not read", () => {
    expect(
      problems({
        steps: [{ id: "a", componentId: "no-such-thing" }],
        connections: [],
      }).join(),
    ).not.toContain("starts from a trigger");
  });

  test("two triggers are not one workflow", () => {
    expect(
      problems({
        steps: [
          { id: "a", componentId: "on-thing" },
          { id: "b", componentId: "on-thing" },
        ],
        connections: [],
      }).join(),
    ).toContain("one trigger");
  });

  test("a connection names steps the draft has", () => {
    expect(
      problems({
        ...A_DRAFT,
        connections: [{ from: "start", to: "nowhere" }],
      }).join(),
    ).toContain("names a step this draft does not have");
  });

  test("nothing leads into a trigger", () => {
    expect(
      problems({
        ...A_DRAFT,
        connections: [{ from: "work", to: "start", fromOutput: "success" }],
      }).join(),
    ).toContain("nothing leads into one");
  });

  test("an output a step does not have is named, with the ones it has", () => {
    const found: string = problems({
      ...A_DRAFT,
      connections: [{ from: "start", to: "work", fromOutput: "maybe" }],
    }).join();

    expect(found).toContain('no output "maybe"');
    expect(found).toContain("success");
  });

  test("a step that branches has to be told which way", () => {
    expect(
      problems({
        steps: [
          { id: "start", componentId: "on-thing" },
          { id: "choose", componentId: "branch" },
          { id: "work", componentId: "do-thing" },
        ],
        connections: [
          { from: "start", to: "choose" },
          { from: "choose", to: "work" },
        ],
      }).join(),
    ).toContain("which output it leaves by: yes, no");
  });

  test("a step with success and error leaves by success unless told", () => {
    expect(
      problems({
        steps: [
          { id: "start", componentId: "on-thing" },
          { id: "work", componentId: "do-thing" },
          { id: "more", componentId: "do-thing" },
        ],
        connections: [
          { from: "start", to: "work" },
          { from: "work", to: "more" },
        ],
      }),
    ).toEqual([]);
  });
});

describe("buildGraphFromDraft", () => {
  test("is the shape the Builder saves", () => {
    const graph: { nodes: Array<any>; edges: Array<any> } = graphOf(A_DRAFT);

    expect(graph.nodes[0]).toMatchObject({
      type: "node",
      data: {
        id: "start",
        nodeType: "Node",
        componentType: ComponentType.Trigger,
        metadataId: "on-thing",
        error: "",
        arguments: {},
        returnValues: {},
      },
    });
    expect(graph.nodes[1].data.arguments).toEqual({ text: "hello" });
    expect(graph.edges[0]).toMatchObject({
      source: graph.nodes[0].id,
      target: graph.nodes[1].id,
      sourceHandle: "success",
      targetHandle: "in",
    });
  });

  test("the canvas's ids are its own, not the step's", () => {
    const graph: { nodes: Array<any>; edges: Array<any> } = graphOf(A_DRAFT);

    expect(graph.nodes[0].id).toMatch(/^generated-/);
    expect(graph.nodes[0].data.internalId).toMatch(/^generated-/);
    expect(graph.nodes[0].id).not.toBe(graph.nodes[0].data.internalId);
  });

  test("a setting the Builder keeps as JSON text is JSON text", () => {
    const graph: { nodes: Array<any>; edges: Array<any> } = graphOf({
      ...A_DRAFT,
      steps: [
        A_DRAFT.steps[0]!,
        {
          id: "work",
          componentId: "do-thing",
          arguments: { body: { a: 1 }, text: "x" },
        },
      ],
    });

    expect(graph.nodes[1].data.arguments).toEqual({
      body: '{"a":1}',
      text: "x",
    });
  });

  test("JSON already written as text, or a reference, stays as written", () => {
    const graph: { nodes: Array<any>; edges: Array<any> } = graphOf({
      ...A_DRAFT,
      steps: [
        A_DRAFT.steps[0]!,
        {
          id: "work",
          componentId: "do-thing",
          arguments: { body: "{{local.variables.x}}" },
        },
      ],
    });

    expect(graph.nodes[1].data.arguments.body).toBe("{{local.variables.x}}");
  });

  test("the same connection twice is one", () => {
    expect(
      graphOf({
        ...A_DRAFT,
        connections: [
          { from: "start", to: "work" },
          { from: "start", to: "work", fromOutput: "success" },
        ],
      }).edges,
    ).toHaveLength(1);
  });

  test("the steps are laid out from the trigger down, a row at a time", () => {
    const graph: { nodes: Array<any>; edges: Array<any> } = graphOf({
      steps: [
        { id: "start", componentId: "on-thing" },
        { id: "a", componentId: "do-thing" },
        { id: "b", componentId: "do-thing" },
      ],
      connections: [
        { from: "start", to: "a" },
        { from: "a", to: "b" },
      ],
    });

    expect(graph.nodes[0].position).toEqual(TEMPLATE_START);
    expect(graph.nodes[1].position.y).toBe(
      TEMPLATE_START.y + TEMPLATE_ROW_HEIGHT,
    );
    expect(graph.nodes[2].position.y).toBe(
      TEMPLATE_START.y + 2 * TEMPLATE_ROW_HEIGHT,
    );
  });

  test("two branches do not land on each other", () => {
    const graph: { nodes: Array<any>; edges: Array<any> } = graphOf({
      steps: [
        { id: "start", componentId: "on-thing" },
        { id: "choose", componentId: "branch" },
        { id: "a", componentId: "do-thing" },
        { id: "b", componentId: "do-thing" },
        { id: "c", componentId: "do-thing" },
      ],
      connections: [
        { from: "start", to: "choose" },
        { from: "choose", to: "a", fromOutput: "yes" },
        { from: "choose", to: "b", fromOutput: "no" },
        { from: "choose", to: "c", fromOutput: "no" },
      ],
    });

    const row: Array<{ x: number; y: number }> = graph.nodes
      .slice(2)
      .map((node: any) => {
        return node.position;
      });

    expect(
      new Set(
        row.map((p: { y: number }) => {
          return p.y;
        }),
      ).size,
    ).toBe(1);

    const xs: Array<number> = row
      .map((p: { x: number }) => {
        return p.x;
      })
      .sort((a: number, b: number) => {
        return a - b;
      });

    // A card is at least 256 wide.
    expect(xs[1]! - xs[0]!).toBeGreaterThanOrEqual(256);
    expect(xs[2]! - xs[1]!).toBeGreaterThanOrEqual(256);
  });

  test("a step nothing leads to is still on the canvas, under the rest", () => {
    const graph: { nodes: Array<any>; edges: Array<any> } = graphOf({
      steps: [
        { id: "start", componentId: "on-thing" },
        { id: "a", componentId: "do-thing" },
        { id: "lost", componentId: "do-thing" },
      ],
      connections: [{ from: "start", to: "a" }],
    });

    expect(graph.nodes[2].position.y).toBeGreaterThan(
      graph.nodes[1].position.y,
    );
  });

  test("a loop in the connections does not hang the layout", () => {
    expect(
      graphOf({
        steps: [
          { id: "start", componentId: "on-thing" },
          { id: "a", componentId: "do-thing" },
          { id: "b", componentId: "do-thing" },
        ],
        connections: [
          { from: "start", to: "a" },
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      }).nodes,
    ).toHaveLength(3);
  });

  describe("over a workflow that already exists", () => {
    const EXISTING: JSONObject = {
      nodes: [
        {
          id: "node-start",
          type: "node",
          position: { x: 500, y: 40 },
          data: {
            id: "start",
            nodeType: "Node",
            componentType: ComponentType.Trigger,
            metadataId: "on-thing",
            internalId: "internal-start",
            arguments: {},
          },
        },
        {
          id: "node-work",
          type: "node",
          position: { x: 700, y: 300 },
          data: {
            id: "work",
            nodeType: "Node",
            componentType: ComponentType.Component,
            metadataId: "do-thing",
            internalId: "internal-work",
            arguments: { text: "old", token: "s3cret" },
          },
        },
      ],
      edges: [
        {
          id: "edge-1",
          source: "node-start",
          target: "node-work",
          sourceHandle: "success",
          targetHandle: "in",
        },
      ],
    } as unknown as JSONObject;

    test("a step that stays keeps its place and what the canvas knows it by", () => {
      const graph: { nodes: Array<any>; edges: Array<any> } = graphOf(
        A_DRAFT,
        EXISTING,
      );

      expect(graph.nodes[1].id).toBe("node-work");
      expect(graph.nodes[1].position).toEqual({ x: 700, y: 300 });
      expect(graph.nodes[1].data.internalId).toBe("internal-work");
      expect(graph.edges[0].id).toBe("edge-1");
    });

    test("a step with no settings keeps them", () => {
      const graph: { nodes: Array<any>; edges: Array<any> } = graphOf(
        {
          ...A_DRAFT,
          steps: [A_DRAFT.steps[0]!, { id: "work", componentId: "do-thing" }],
        },
        EXISTING,
      );

      expect(graph.nodes[1].data.arguments).toEqual({
        text: "old",
        token: "s3cret",
      });
    });

    test("a step's settings, when given, are what it now has", () => {
      expect(graphOf(A_DRAFT, EXISTING).nodes[1].data.arguments).toEqual({
        text: "hello",
      });
    });

    test("a secret read back hidden stays as saved", () => {
      const graph: { nodes: Array<any>; edges: Array<any> } = graphOf(
        {
          ...A_DRAFT,
          steps: [
            A_DRAFT.steps[0]!,
            {
              id: "work",
              componentId: "do-thing",
              arguments: { text: "new", token: HIDDEN_SECRET_VALUE },
            },
          ],
        },
        EXISTING,
      );

      expect(graph.nodes[1].data.arguments).toEqual({
        text: "new",
        token: "s3cret",
      });
    });

    test.each([
      ["a value with an address redacted", "[redacted-ip]"],
      ["a URL with a token redacted", "https://x.test/?t=[redacted]"],
    ])("%s stays as saved", (_name: string, value: string) => {
      const graph: { nodes: Array<any>; edges: Array<any> } = graphOf(
        {
          ...A_DRAFT,
          steps: [
            A_DRAFT.steps[0]!,
            {
              id: "work",
              componentId: "do-thing",
              arguments: { text: value, token: "new" },
            },
          ],
        },
        EXISTING,
      );

      expect(graph.nodes[1].data.arguments).toEqual({
        text: "old",
        token: "new",
      });
    });

    test("JSON with something redacted in it stays as saved too", () => {
      const graph: { nodes: Array<any>; edges: Array<any> } = graphOf(
        {
          ...A_DRAFT,
          steps: [
            A_DRAFT.steps[0]!,
            {
              id: "work",
              componentId: "do-thing",
              arguments: { body: { to: "[redacted-email]" } },
            },
          ],
        },
        EXISTING,
      );

      expect(graph.nodes[1].data.arguments).toEqual({});
    });

    test("a hidden secret with nothing saved is left out, never written as text", () => {
      const graph: { nodes: Array<any>; edges: Array<any> } = graphOf({
        ...A_DRAFT,
        steps: [
          A_DRAFT.steps[0]!,
          {
            id: "work",
            componentId: "do-thing",
            arguments: { token: HIDDEN_SECRET_VALUE },
          },
        ],
      });

      expect(graph.nodes[1].data.arguments).toEqual({});
    });

    test("a new step goes under what leads to it", () => {
      const graph: { nodes: Array<any>; edges: Array<any> } = graphOf(
        {
          steps: [...A_DRAFT.steps, { id: "more", componentId: "do-thing" }],
          connections: [...A_DRAFT.connections, { from: "work", to: "more" }],
        },
        EXISTING,
      );

      expect(graph.nodes[2].position.y).toBe(300 + TEMPLATE_ROW_HEIGHT);
      expect(graph.nodes[2].id).toMatch(/^generated-/);
    });

    test("a step whose id now means another component is a new step", () => {
      const graph: { nodes: Array<any>; edges: Array<any> } = graphOf(
        {
          steps: [A_DRAFT.steps[0]!, { id: "work", componentId: "branch" }],
          connections: [{ from: "start", to: "work" }],
        },
        EXISTING,
      );

      expect(graph.nodes[1].id).not.toBe("node-work");
      expect(graph.nodes[1].data.arguments).toEqual({});
    });

    test("the saved workflow is not changed by building a new one", () => {
      const before: string = JSON.stringify(EXISTING);

      graphOf(
        {
          ...A_DRAFT,
          steps: [A_DRAFT.steps[0]!, { id: "work", componentId: "do-thing" }],
        },
        EXISTING,
      );

      expect(JSON.stringify(EXISTING)).toBe(before);
    });

    test("read back as a draft, with no secret in it", () => {
      const draft: WorkflowDraft = getDraftFromGraph({
        graph: EXISTING,
        getComponent: getComponent,
      });

      expect(draft).toEqual({
        steps: [
          { id: "start", componentId: "on-thing", arguments: {} },
          {
            id: "work",
            componentId: "do-thing",
            arguments: { text: "old", token: HIDDEN_SECRET_VALUE },
          },
        ],
        connections: [{ from: "start", to: "work", fromOutput: "success" }],
      });
      expect(JSON.stringify(draft)).not.toContain("s3cret");
    });

    test("reading it and writing it back changes nothing", () => {
      const graph: { nodes: Array<any>; edges: Array<any> } = graphOf(
        getDraftFromGraph({ graph: EXISTING, getComponent: getComponent }),
        EXISTING,
      );

      expect(graph.nodes[1].data.arguments).toEqual({
        text: "old",
        token: "s3cret",
      });
      expect(graph.nodes[1].position).toEqual({ x: 700, y: 300 });
      expect(graph.edges).toEqual([
        expect.objectContaining({ id: "edge-1", sourceHandle: "success" }),
      ]);
    });
  });
});

describe("getDraftFromGraph", () => {
  test("leaves out what only stands in for a trigger", () => {
    expect(
      getDraftFromGraph({
        graph: {
          nodes: [
            {
              id: "p",
              data: { id: "placeholder", nodeType: "PlaceholderNode" },
            },
          ],
          edges: [],
        } as unknown as JSONObject,
        getComponent: getComponent,
      }),
    ).toEqual({ steps: [], connections: [] });
  });

  test.each([[null], [undefined], [{}], [{ nodes: "x", edges: 3 }]])(
    "reads %p as nothing",
    (graph: unknown) => {
      expect(
        getDraftFromGraph({
          graph: graph as JSONObject,
          getComponent: getComponent,
        }),
      ).toEqual({ steps: [], connections: [] });
    },
  );

  test("keeps a setting of a component it no longer knows", () => {
    expect(
      getDraftFromGraph({
        graph: {
          nodes: [
            {
              id: "n",
              data: {
                id: "old",
                nodeType: "Node",
                metadataId: "gone",
                arguments: { x: 1 },
              },
            },
          ],
          edges: [],
        } as unknown as JSONObject,
        getComponent: getComponent,
      }).steps[0]?.arguments,
    ).toEqual({ x: 1 });
  });
});

describe("describeDraftChanges", () => {
  type ChangesFunction = (
    before: WorkflowDraft,
    after: WorkflowDraft,
  ) => WorkflowDraftChanges;

  const changes: ChangesFunction = (
    before: WorkflowDraft,
    after: WorkflowDraft,
  ): WorkflowDraftChanges => {
    return describeDraftChanges({
      before: before,
      after: after,
      titleOf: (step: WorkflowDraftStep): string => {
        return step.id;
      },
    });
  };

  test("a step not there before is added, one not there now removed", () => {
    expect(
      changes(
        { steps: [{ id: "a", componentId: "x" }], connections: [] },
        { steps: [{ id: "b", componentId: "x" }], connections: [] },
      ),
    ).toEqual({ added: ["b"], removed: ["a"], changed: [] });
  });

  test("a step that became another component is both", () => {
    expect(
      changes(
        { steps: [{ id: "a", componentId: "x" }], connections: [] },
        { steps: [{ id: "a", componentId: "y" }], connections: [] },
      ),
    ).toEqual({ added: ["a"], removed: ["a"], changed: [] });
  });

  test("a step with other settings is changed", () => {
    expect(
      changes(
        {
          steps: [{ id: "a", componentId: "x", arguments: { t: 1 } }],
          connections: [],
        },
        {
          steps: [{ id: "a", componentId: "x", arguments: { t: 2 } }],
          connections: [],
        },
      ).changed,
    ).toEqual(["a"]);
  });

  test("the same settings, however they are written, are no change", () => {
    expect(
      changes(
        {
          steps: [
            {
              id: "a",
              componentId: "x",
              arguments: { b: '{"z":1,"y":2}', t: 1 },
            },
          ],
          connections: [],
        },
        {
          steps: [
            {
              id: "a",
              componentId: "x",
              arguments: { t: 1, b: { y: 2, z: 1 } },
            },
          ],
          connections: [],
        },
      ).changed,
    ).toEqual([]);
  });

  test("a step given no settings keeps them, so is no change", () => {
    expect(
      changes(
        {
          steps: [{ id: "a", componentId: "x", arguments: { t: 1 } }],
          connections: [],
        },
        { steps: [{ id: "a", componentId: "x" }], connections: [] },
      ).changed,
    ).toEqual([]);
  });
});

describe("the shape the rest of the product reads", () => {
  test("is the shape a template's graph has, key for key", () => {
    const fromDraft: { nodes: Array<any>; edges: Array<any> } =
      graphOf(A_DRAFT);
    const fromTemplate: { nodes: Array<any>; edges: Array<any> } =
      buildTemplateGraph(
        {
          nodes: [
            {
              componentId: "start",
              metadataId: "on-thing",
              componentType: ComponentType.Trigger,
              position: { x: 0, y: 0 },
            },
            {
              componentId: "work",
              metadataId: "do-thing",
              componentType: ComponentType.Component,
              position: { x: 0, y: 220 },
            },
          ],
          edges: [
            {
              fromComponentId: "start",
              toComponentId: "work",
              fromPort: "success",
            },
          ],
        },
        generateId,
      ) as unknown as { nodes: Array<any>; edges: Array<any> };

    expect(Object.keys(fromDraft.nodes[0]).sort()).toEqual(
      Object.keys(fromTemplate.nodes[0]).sort(),
    );
    expect(Object.keys(fromDraft.nodes[0].data).sort()).toEqual(
      Object.keys(fromTemplate.nodes[0].data).sort(),
    );
    expect(Object.keys(fromDraft.edges[0]).sort()).toEqual(
      Object.keys(fromTemplate.edges[0]).sort(),
    );
  });
});

describe("the real components", () => {
  test("a webhook, an If / Else and a log make a workflow", () => {
    const real: GetComponentFunction = (
      id: string,
    ): ComponentMetadata | undefined => {
      return BuiltInComponents.find((component: ComponentMetadata) => {
        return component.id === id;
      });
    };

    const draft: WorkflowDraft = {
      steps: [
        { id: "webhook-1", componentId: ComponentID.Webhook },
        { id: "check", componentId: ComponentID.IfElse },
        { id: "log", componentId: ComponentID.Log, arguments: { value: "ok" } },
      ],
      connections: [
        { from: "webhook-1", to: "check" },
        { from: "check", to: "log", fromOutput: "yes" },
      ],
    };

    expect(checkWorkflowDraft({ draft: draft, getComponent: real })).toEqual(
      [],
    );
  });
});
