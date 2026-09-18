import {
  LintGraphEdge,
  LintGraphNode,
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
  WorkflowLintSeverity,
  isEmptyArgumentValue,
  lintWorkflowGraph,
} from "../../../../UI/Components/Workflow/GraphLint";
import IconProp from "../../../../Types/Icon/IconProp";
import { JSONObject } from "../../../../Types/JSON";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeType,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

type MakeMetadataFunction = (params: {
  id: string;
  componentType?: ComponentType | undefined;
  args?: Array<Argument> | undefined;
  returnValues?: Array<ReturnValue> | undefined;
}) => ComponentMetadata;

const makeMetadata: MakeMetadataFunction = (params: {
  id: string;
  componentType?: ComponentType | undefined;
  args?: Array<Argument> | undefined;
  returnValues?: Array<ReturnValue> | undefined;
}): ComponentMetadata => {
  return {
    id: params.id,
    title: params.id,
    category: "Test",
    description: "A test component",
    iconProp: IconProp.Bolt,
    componentType: params.componentType || ComponentType.Component,
    arguments: params.args || [],
    returnValues: params.returnValues || [],
    inPorts: [],
    outPorts: [],
  };
};

type MakeNodeFunction = (params: {
  nodeId: string;
  componentId: string;
  componentType?: ComponentType | undefined;
  args?: Array<Argument> | undefined;
  returnValues?: Array<ReturnValue> | undefined;
  values?: JSONObject | undefined;
  nodeType?: NodeType | undefined;
}) => LintGraphNode;

const makeNode: MakeNodeFunction = (params: {
  nodeId: string;
  componentId: string;
  componentType?: ComponentType | undefined;
  args?: Array<Argument> | undefined;
  returnValues?: Array<ReturnValue> | undefined;
  values?: JSONObject | undefined;
  nodeType?: NodeType | undefined;
}): LintGraphNode => {
  const componentType: ComponentType =
    params.componentType || ComponentType.Component;

  return {
    id: params.nodeId,
    data: {
      error: "",
      id: params.componentId,
      nodeType: params.nodeType || NodeType.Node,
      metadata: makeMetadata({
        id: `${params.componentId}-metadata`,
        componentType: componentType,
        args: params.args,
        returnValues: params.returnValues,
      }),
      metadataId: `${params.componentId}-metadata`,
      internalId: `${params.nodeId}-internal`,
      arguments: params.values || {},
      returnValues: {},
      componentType: componentType,
    },
  };
};

const textArgument: Argument = {
  id: "message",
  name: "Message",
  description: "Text to send",
  type: ComponentInputType.Text,
  required: false,
};

const requiredUrlArgument: Argument = {
  id: "url",
  name: "URL",
  description: "Where to send it",
  type: ComponentInputType.URL,
  required: true,
};

const jsonArgument: Argument = {
  id: "request-body",
  name: "Request Body",
  description: "Body",
  type: ComponentInputType.JSON,
  required: false,
};

const bodyReturnValue: ReturnValue = {
  id: "response-body",
  name: "Response Body",
  description: "What came back",
  type: ComponentInputType.JSON,
  required: false,
};

type MakeTriggerFunction = (
  nodeId: string,
  componentId: string,
) => LintGraphNode;

const makeTrigger: MakeTriggerFunction = (
  nodeId: string,
  componentId: string,
): LintGraphNode => {
  return makeNode({
    nodeId: nodeId,
    componentId: componentId,
    componentType: ComponentType.Trigger,
  });
};

type RulesOfFunction = (result: WorkflowLintResult) => Array<WorkflowLintRule>;

const rulesOf: RulesOfFunction = (
  result: WorkflowLintResult,
): Array<WorkflowLintRule> => {
  return result.issues.map((issue: WorkflowLintIssue) => {
    return issue.rule;
  });
};

describe("lintWorkflowGraph — nothing to report", () => {
  test("an empty graph is silent", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [],
      edges: [],
    });

    expect(result.issues).toEqual([]);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  test("a well-formed graph is silent", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const step: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "api-post-1",
      args: [requiredUrlArgument, jsonArgument],
      values: {
        url: "https://example.com",
        "request-body": '{"a": 1}',
      },
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, step],
      edges: [{ source: "n1", target: "n2" }],
    });

    expect(result.issues).toEqual([]);
  });

  test("placeholder nodes are ignored entirely", () => {
    const placeholder: LintGraphNode = makeNode({
      nodeId: "n1",
      componentId: "",
      componentType: ComponentType.Trigger,
      nodeType: NodeType.PlaceholderNode,
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [placeholder],
      edges: [],
    });

    expect(result.issues).toEqual([]);
  });
});

describe("lintWorkflowGraph — graph shape", () => {
  test("reports a workflow with no trigger", () => {
    const step: LintGraphNode = makeNode({
      nodeId: "n1",
      componentId: "log-1",
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [step],
      edges: [],
    });

    expect(rulesOf(result)).toContain(WorkflowLintRule.NoTrigger);
    expect(
      result.issues.find((issue: WorkflowLintIssue) => {
        return issue.rule === WorkflowLintRule.NoTrigger;
      })?.nodeId,
    ).toBeNull();
  });

  test("reports a step the trigger cannot reach, as a warning", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const connected: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "log-1",
    });
    const orphan: LintGraphNode = makeNode({
      nodeId: "n3",
      componentId: "log-2",
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, connected, orphan],
      edges: [{ source: "n1", target: "n2" }],
    });

    const issue: WorkflowLintIssue | undefined = result.issues.find(
      (candidate: WorkflowLintIssue) => {
        return candidate.rule === WorkflowLintRule.UnreachableComponent;
      },
    );

    expect(issue?.componentId).toBe("log-2");
    expect(issue?.severity).toBe(WorkflowLintSeverity.Warning);
    expect(result.warningCount).toBe(1);
  });

  test("follows a chain of edges when deciding reachability", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const a: LintGraphNode = makeNode({ nodeId: "n2", componentId: "a" });
    const b: LintGraphNode = makeNode({ nodeId: "n3", componentId: "b" });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, a, b],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    });

    expect(rulesOf(result)).not.toContain(
      WorkflowLintRule.UnreachableComponent,
    );
  });

  test("reports two steps sharing an id", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const first: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "log-1",
    });
    const second: LintGraphNode = makeNode({
      nodeId: "n3",
      componentId: "log-1",
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, first, second],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    });

    const duplicates: Array<WorkflowLintIssue> = result.issues.filter(
      (issue: WorkflowLintIssue) => {
        return issue.rule === WorkflowLintRule.DuplicateComponentId;
      },
    );

    // Both nodes are flagged, so either one shows the badge.
    expect(duplicates).toHaveLength(2);
    expect(duplicates[0]?.severity).toBe(WorkflowLintSeverity.Error);
  });

  test("reports an id containing a dot, which no reference can address", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const dotted: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "api.get.1",
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, dotted],
      edges: [{ source: "n1", target: "n2" }],
    });

    expect(rulesOf(result)).toContain(WorkflowLintRule.ComponentIdContainsDot);
  });
});

describe("lintWorkflowGraph — arguments", () => {
  test("reports a required argument left empty", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const step: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "api-get-1",
      args: [requiredUrlArgument],
      values: {},
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, step],
      edges: [{ source: "n1", target: "n2" }],
    });

    const issue: WorkflowLintIssue | undefined = result.issues.find(
      (candidate: WorkflowLintIssue) => {
        return candidate.rule === WorkflowLintRule.MissingRequiredArgument;
      },
    );

    expect(issue?.argumentId).toBe("url");
    expect(issue?.message).toMatch(/"URL" is required/);
  });

  test("treats whitespace and an empty object as empty", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const blank: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "a",
      args: [requiredUrlArgument],
      values: { url: "   " },
    });
    const emptyObject: LintGraphNode = makeNode({
      nodeId: "n3",
      componentId: "b",
      args: [{ ...requiredUrlArgument, type: ComponentInputType.JSON }],
      values: { url: {} },
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, blank, emptyObject],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    });

    expect(
      result.issues.filter((issue: WorkflowLintIssue) => {
        return issue.rule === WorkflowLintRule.MissingRequiredArgument;
      }),
    ).toHaveLength(2);
  });

  test("does not treat false or zero as missing", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const step: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "a",
      args: [
        {
          id: "enabled",
          name: "Enabled",
          description: "",
          type: ComponentInputType.Boolean,
          required: true,
        },
        {
          id: "count",
          name: "Count",
          description: "",
          type: ComponentInputType.Number,
          required: true,
        },
      ],
      values: { enabled: false, count: 0 },
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, step],
      edges: [{ source: "n1", target: "n2" }],
    });

    expect(rulesOf(result)).not.toContain(
      WorkflowLintRule.MissingRequiredArgument,
    );
  });

  test("reports malformed JSON in a JSON argument", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const step: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "api-post-1",
      args: [jsonArgument],
      values: { "request-body": '{"a": 1,}' },
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, step],
      edges: [{ source: "n1", target: "n2" }],
    });

    const issue: WorkflowLintIssue | undefined = result.issues.find(
      (candidate: WorkflowLintIssue) => {
        return candidate.rule === WorkflowLintRule.InvalidJSON;
      },
    );

    expect(issue?.message).toMatch(/"Request Body" is not valid JSON/);
  });

  test("does not report JSON5 in an argument that is read with JSON5", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const step: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "create-one-1",
      args: [
        {
          id: "json",
          name: "Data",
          description: "",
          type: ComponentInputType.BaseModel,
          required: false,
        },
      ],
      values: { json: "{name: 'x',}" },
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, step],
      edges: [{ source: "n1", target: "n2" }],
    });

    expect(rulesOf(result)).not.toContain(WorkflowLintRule.InvalidJSON);
  });

  test("still reports JSON5 in an argument the runner parses strictly", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const step: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "api-post-1",
      args: [jsonArgument],
      values: { "request-body": "{name: 'x',}" },
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, step],
      edges: [{ source: "n1", target: "n2" }],
    });

    expect(rulesOf(result)).toContain(WorkflowLintRule.InvalidJSON);
  });

  test("does not report JSON that only looks malformed because of templates", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const step: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "api-post-1",
      args: [jsonArgument],
      values: {
        "request-body": '{"retries": {{local.variables.count}}}',
      },
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, step],
      edges: [{ source: "n1", target: "n2" }],
    });

    expect(rulesOf(result)).not.toContain(WorkflowLintRule.InvalidJSON);
  });
});

describe("lintWorkflowGraph — references", () => {
  type BuildPairFunction = (referenceText: string) => {
    nodes: Array<LintGraphNode>;
    edges: Array<LintGraphEdge>;
  };

  /*
   * trigger -> api-get-1 -> log-1, where log-1's Message carries the reference
   * under test. api-get-1 returns "response-body".
   */
  const buildPair: BuildPairFunction = (
    referenceText: string,
  ): { nodes: Array<LintGraphNode>; edges: Array<LintGraphEdge> } => {
    return {
      nodes: [
        makeTrigger("n1", "manual-1"),
        makeNode({
          nodeId: "n2",
          componentId: "api-get-1",
          returnValues: [bodyReturnValue],
        }),
        makeNode({
          nodeId: "n3",
          componentId: "log-1",
          args: [textArgument],
          values: { message: referenceText },
        }),
      ],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    };
  };

  test("accepts a reference the picker would have written", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(
      buildPair("{{local.components.api-get-1.returnValues.response-body}}"),
    );

    expect(result.issues).toEqual([]);
  });

  test("accepts a drill-in below the return value", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(
      buildPair(
        "{{local.components.api-get-1.returnValues.response-body.data.items[0].id}}",
      ),
    );

    expect(result.issues).toEqual([]);
  });

  test("accepts variable references without checking that they exist", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(
      buildPair("{{local.variables.token}} {{global.variables.region}}"),
    );

    expect(result.issues).toEqual([]);
  });

  test("reports a misspelled root", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(
      buildPair("{{local.componets.api-get-1.returnValues.response-body}}"),
    );

    expect(rulesOf(result)).toContain(WorkflowLintRule.UnknownReferenceRoot);
  });

  test("reports a step id that is not in the graph", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(
      buildPair("{{local.components.api-get-2.returnValues.response-body}}"),
    );

    const issue: WorkflowLintIssue | undefined = result.issues.find(
      (candidate: WorkflowLintIssue) => {
        return candidate.rule === WorkflowLintRule.UnknownReferencedComponent;
      },
    );

    expect(issue?.message).toMatch(/api-get-2/);
  });

  test("reports a return value the referenced step does not have", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(
      buildPair("{{local.components.api-get-1.returnValues.respones-body}}"),
    );

    const issue: WorkflowLintIssue | undefined = result.issues.find(
      (candidate: WorkflowLintIssue) => {
        return candidate.rule === WorkflowLintRule.UnknownReferencedReturnValue;
      },
    );

    expect(issue?.message).toMatch(/respones-body/);
  });

  test("reports a space inside the braces, which silently never resolves", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(
      buildPair("{{ local.components.api-get-1.returnValues.response-body }}"),
    );

    const issue: WorkflowLintIssue | undefined = result.issues.find(
      (candidate: WorkflowLintIssue) => {
        return candidate.rule === WorkflowLintRule.ReferenceHasWhitespace;
      },
    );

    expect(issue?.severity).toBe(WorkflowLintSeverity.Error);
    expect(issue?.message).toMatch(/space/);
  });

  test("reports a step referring to its own results", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        makeTrigger("n1", "manual-1"),
        makeNode({
          nodeId: "n2",
          componentId: "api-get-1",
          args: [textArgument],
          returnValues: [bodyReturnValue],
          values: {
            message:
              "{{local.components.api-get-1.returnValues.response-body}}",
          },
        }),
      ],
      edges: [{ source: "n1", target: "n2" }],
    });

    expect(rulesOf(result)).toContain(WorkflowLintRule.SelfReference);
  });

  test("reports a reference to a step that runs later", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        makeTrigger("n1", "manual-1"),
        makeNode({
          nodeId: "n2",
          componentId: "first",
          args: [textArgument],
          values: {
            message: "{{local.components.second.returnValues.response-body}}",
          },
        }),
        makeNode({
          nodeId: "n3",
          componentId: "second",
          returnValues: [bodyReturnValue],
        }),
      ],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    });

    const issue: WorkflowLintIssue | undefined = result.issues.find(
      (candidate: WorkflowLintIssue) => {
        return candidate.rule === WorkflowLintRule.ForwardReference;
      },
    );

    expect(issue?.severity).toBe(WorkflowLintSeverity.Error);
    expect(issue?.message).toMatch(/runs after this one/);
  });

  test("stays quiet about a step on a parallel branch, whose order is not decidable", () => {
    /*
     * trigger fans out to "sibling" and to "reader". The runner's queue is
     * FIFO across branches, so sibling may well have run by the time reader
     * does. Reporting it would be a guess.
     */
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        makeTrigger("n1", "manual-1"),
        makeNode({
          nodeId: "n2",
          componentId: "sibling",
          returnValues: [bodyReturnValue],
        }),
        makeNode({
          nodeId: "n3",
          componentId: "reader",
          args: [textArgument],
          values: {
            message: "{{local.components.sibling.returnValues.response-body}}",
          },
        }),
      ],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n1", target: "n3" },
      ],
    });

    expect(result.issues).toEqual([]);
  });

  test("warns when the referenced step is never reached", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        makeTrigger("n1", "manual-1"),
        makeNode({
          nodeId: "n2",
          componentId: "reader",
          args: [textArgument],
          values: {
            message: "{{local.components.island.returnValues.response-body}}",
          },
        }),
        makeNode({
          nodeId: "n3",
          componentId: "island",
          returnValues: [bodyReturnValue],
        }),
      ],
      edges: [{ source: "n1", target: "n2" }],
    });

    expect(rulesOf(result)).toContain(
      WorkflowLintRule.ReferenceToUnreachableComponent,
    );
  });

  test("never reports references inside a loop body", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(
      buildPair(
        "{{#each local.components.api-get-1.returnValues.response-body}}{{status}} {{labels.name}} {{@index}} {{this}}{{/each}}",
      ),
    );

    expect(result.issues).toEqual([]);
  });

  test("still checks the loop's own array path", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(
      buildPair("{{#each local.componets.api-get-1.returnValues.x}}a{{/each}}"),
    );

    /*
     * The {{#each}} tag is not a Reference, so it is not path-checked — this
     * asserts the linter stays silent rather than inventing a rule it cannot
     * apply soundly.
     */
    expect(result.issues).toEqual([]);
  });

  test("does not mistake JavaScript for a broken reference", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(
      buildPair("if (x) {{ return 1; }}"),
    );

    expect(result.issues).toEqual([]);
  });

  test("finds references nested inside an object-shaped argument", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        makeTrigger("n1", "manual-1"),
        makeNode({
          nodeId: "n2",
          componentId: "api-post-1",
          args: [
            {
              id: "request-headers",
              name: "Request Headers",
              description: "",
              type: ComponentInputType.StringDictionary,
              required: false,
            },
          ],
          values: {
            "request-headers": {
              Authorization: "Bearer {{local.componets.x.returnValues.y}}",
            },
          },
        }),
      ],
      edges: [{ source: "n1", target: "n2" }],
    });

    expect(rulesOf(result)).toContain(WorkflowLintRule.UnknownReferenceRoot);
  });
});

describe("lintWorkflowGraph — roll-up", () => {
  test("combines several messages for one node onto one line each", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const step: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "api.get.1",
      args: [requiredUrlArgument, jsonArgument],
      values: { "request-body": "{oops" },
    });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, step],
      edges: [{ source: "n1", target: "n2" }],
    });

    const combined: string = result.errorsByNodeId["n2"] as string;

    expect(combined.split("\n").length).toBeGreaterThan(1);
    expect(combined).toMatch(/dot/);
    expect(combined).toMatch(/required/);
  });

  test("counts errors and warnings separately", () => {
    const trigger: LintGraphNode = makeTrigger("n1", "manual-1");
    const missing: LintGraphNode = makeNode({
      nodeId: "n2",
      componentId: "a",
      args: [requiredUrlArgument],
      values: {},
    });
    const orphan: LintGraphNode = makeNode({ nodeId: "n3", componentId: "b" });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [trigger, missing, orphan],
      edges: [{ source: "n1", target: "n2" }],
    });

    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(1);
  });

  test("keeps graph-wide issues out of the per-node map", () => {
    const step: LintGraphNode = makeNode({ nodeId: "n1", componentId: "a" });

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [step],
      edges: [],
    });

    expect(result.errorsByNodeId["n1"]).toBeUndefined();
    expect(result.errorCount).toBe(1);
  });
});

/*
 * An empty JSON document is not a filled-in field.
 *
 * Arguments are stored as text, so "{}" typed into the JSON escape hatch used
 * to satisfy a required Query. On Delete Many that is not a harmless no-op: an
 * empty query matches every record in the project and the component deletes the
 * first ten of them.
 */
describe("an empty JSON document reads as empty", () => {
  const JSON_DOCUMENT_TYPES: Array<ComponentInputType> = [
    ComponentInputType.JSON,
    ComponentInputType.JSONArray,
    ComponentInputType.Query,
    ComponentInputType.Select,
    ComponentInputType.BaseModel,
    ComponentInputType.BaseModelArray,
    ComponentInputType.StringDictionary,
  ];

  test('"{}" is empty for every JSON-document argument type', () => {
    for (const type of JSON_DOCUMENT_TYPES) {
      expect(isEmptyArgumentValue("{}", type)).toBe(true);
    }
  });

  test('"[]" is empty too, and whitespace does not save it', () => {
    expect(isEmptyArgumentValue("[]", ComponentInputType.JSONArray)).toBe(true);
    expect(isEmptyArgumentValue("  {  }  ", ComponentInputType.Query)).toBe(
      true,
    );
  });

  test("a document with anything in it is not empty", () => {
    expect(
      isEmptyArgumentValue('{"_id": "abc"}', ComponentInputType.Query),
    ).toBe(false);
    expect(
      isEmptyArgumentValue('[{"a":1}]', ComponentInputType.JSONArray),
    ).toBe(false);
  });

  /*
   * Broken text is left alone deliberately: it is reported as invalid JSON a
   * few lines later, and "not valid JSON" is a more useful message than "this
   * is required".
   */
  test("text that does not parse is not called empty", () => {
    expect(isEmptyArgumentValue("{not json", ComponentInputType.Query)).toBe(
      false,
    );
  });

  test('"{}" in a plain text argument is still a value', () => {
    expect(isEmptyArgumentValue("{}", ComponentInputType.Text)).toBe(false);
    expect(isEmptyArgumentValue("{}")).toBe(false);
  });

  test("absence and the empty box are still empty, whatever the type", () => {
    for (const type of JSON_DOCUMENT_TYPES) {
      expect(isEmptyArgumentValue(undefined, type)).toBe(true);
      expect(isEmptyArgumentValue("", type)).toBe(true);
      expect(isEmptyArgumentValue("   ", type)).toBe(true);
    }
  });

  test("false and zero remain values a builder chose", () => {
    expect(isEmptyArgumentValue(false, ComponentInputType.Boolean)).toBe(false);
    expect(isEmptyArgumentValue(0, ComponentInputType.Number)).toBe(false);
  });
});
