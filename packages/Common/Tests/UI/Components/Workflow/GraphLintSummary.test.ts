import {
  LintGraphNode,
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
  WorkflowLintSeverity,
  lintWorkflowGraph,
} from "../../../../UI/Components/Workflow/GraphLint";
import {
  OpenableGraphNode,
  WORKFLOW_ISSUE_GRAPH_GROUP_KEY,
  WORKFLOW_ISSUE_GRAPH_GROUP_TITLE,
  WORKFLOW_ISSUE_UNTITLED_STEP_TITLE,
  WorkflowIssueGroup,
  WorkflowLintTone,
  WorkflowNodeIssueSummary,
  buildNodeIssueSummaries,
  buildStepTitlesByNodeId,
  findStepNodeToOpen,
  getWorkflowLintCountText,
  getWorkflowLintSeverityLabel,
  getWorkflowLintTone,
  getWorkflowNodeIssuePresentation,
  groupWorkflowLintIssues,
} from "../../../../UI/Components/Workflow/GraphLintSummary";
import Dictionary from "../../../../Types/Dictionary";
import IconProp from "../../../../Types/Icon/IconProp";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeType,
} from "../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

type MakeIssueFunction = (params: {
  rule?: WorkflowLintRule | undefined;
  severity?: WorkflowLintSeverity | undefined;
  nodeId?: string | null | undefined;
  componentId?: string | null | undefined;
  argumentId?: string | null | undefined;
  message?: string | undefined;
}) => WorkflowLintIssue;

const makeIssue: MakeIssueFunction = (params: {
  rule?: WorkflowLintRule | undefined;
  severity?: WorkflowLintSeverity | undefined;
  nodeId?: string | null | undefined;
  componentId?: string | null | undefined;
  argumentId?: string | null | undefined;
  message?: string | undefined;
}): WorkflowLintIssue => {
  return {
    rule: params.rule || WorkflowLintRule.MissingRequiredArgument,
    severity: params.severity || WorkflowLintSeverity.Error,
    nodeId: params.nodeId === undefined ? "n1" : params.nodeId,
    componentId:
      params.componentId === undefined ? "api-get-1" : params.componentId,
    argumentId: params.argumentId === undefined ? null : params.argumentId,
    message: params.message || "Something is wrong.",
  };
};

type MessagesOfFunction = (group: WorkflowIssueGroup) => Array<string>;

const messagesOf: MessagesOfFunction = (
  group: WorkflowIssueGroup,
): Array<string> => {
  return group.issues.map((issue: WorkflowLintIssue) => {
    return issue.message;
  });
};

describe("getWorkflowLintCountText", () => {
  test("says nothing when there is nothing to report", () => {
    expect(getWorkflowLintCountText({ errorCount: 0, warningCount: 0 })).toBe(
      "",
    );
  });

  test("counts one error in the singular", () => {
    expect(getWorkflowLintCountText({ errorCount: 1, warningCount: 0 })).toBe(
      "1 error",
    );
  });

  test("counts several errors in the plural", () => {
    expect(getWorkflowLintCountText({ errorCount: 4, warningCount: 0 })).toBe(
      "4 errors",
    );
  });

  test("counts one warning in the singular", () => {
    expect(getWorkflowLintCountText({ errorCount: 0, warningCount: 1 })).toBe(
      "1 warning",
    );
  });

  test("counts several warnings in the plural", () => {
    expect(getWorkflowLintCountText({ errorCount: 0, warningCount: 3 })).toBe(
      "3 warnings",
    );
  });

  test("puts errors before warnings when there are both", () => {
    expect(getWorkflowLintCountText({ errorCount: 2, warningCount: 1 })).toBe(
      "2 errors, 1 warning",
    );
  });
});

describe("getWorkflowLintTone", () => {
  test("a clean graph is clean", () => {
    expect(getWorkflowLintTone({ errorCount: 0, warningCount: 0 })).toBe(
      WorkflowLintTone.Clean,
    );
  });

  test("warnings alone are a warning", () => {
    expect(getWorkflowLintTone({ errorCount: 0, warningCount: 2 })).toBe(
      WorkflowLintTone.Warning,
    );
  });

  test("one error outranks any number of warnings", () => {
    expect(getWorkflowLintTone({ errorCount: 1, warningCount: 9 })).toBe(
      WorkflowLintTone.Error,
    );
  });
});

describe("getWorkflowLintSeverityLabel", () => {
  test("names both severities", () => {
    expect(getWorkflowLintSeverityLabel(WorkflowLintSeverity.Error)).toBe(
      "Error",
    );
    expect(getWorkflowLintSeverityLabel(WorkflowLintSeverity.Warning)).toBe(
      "Warning",
    );
  });
});

describe("buildStepTitlesByNodeId", () => {
  test("keys the title the canvas shows by react-flow node id", () => {
    const titles: Dictionary<string> = buildStepTitlesByNodeId([
      { id: "n1", data: { metadata: { title: "Send to Slack" } } },
      { id: "n2", data: { metadata: { title: "Create Monitor Secret" } } },
    ]);

    expect(titles).toEqual({
      n1: "Send to Slack",
      n2: "Create Monitor Secret",
    });
  });

  test("skips nodes with nothing usable to show", () => {
    const titles: Dictionary<string> = buildStepTitlesByNodeId([
      { id: "n1" },
      { id: "n2", data: {} },
      { id: "n3", data: { metadata: {} } },
      { id: "n4", data: { metadata: { title: "" } } },
      { id: "n5", data: { metadata: { title: "   " } } },
    ]);

    expect(titles).toEqual({});
  });

  test("trims whitespace around a title", () => {
    const titles: Dictionary<string> = buildStepTitlesByNodeId([
      { id: "n1", data: { metadata: { title: "  Send to Slack  " } } },
    ]);

    expect(titles["n1"]).toBe("Send to Slack");
  });

  test("survives an empty graph and missing ids", () => {
    expect(buildStepTitlesByNodeId([])).toEqual({});
    expect(
      buildStepTitlesByNodeId([
        { id: "", data: { metadata: { title: "Nameless" } } },
      ]),
    ).toEqual({});
  });
});

describe("findStepNodeToOpen", () => {
  const step: OpenableGraphNode = {
    id: "n1",
    data: { nodeType: NodeType.Node },
  };
  const placeholder: OpenableGraphNode = {
    id: "n2",
    data: { nodeType: NodeType.PlaceholderNode },
  };

  test("finds the step by react-flow node id", () => {
    expect(
      findStepNodeToOpen({ nodes: [placeholder, step], nodeId: "n1" }),
    ).toBe(step);
  });

  test("opens nothing when nothing was asked for", () => {
    expect(findStepNodeToOpen({ nodes: [step], nodeId: null })).toBeNull();
    expect(findStepNodeToOpen({ nodes: [step], nodeId: undefined })).toBeNull();
    expect(findStepNodeToOpen({ nodes: [step], nodeId: "" })).toBeNull();
  });

  test("opens nothing when the step has been deleted since", () => {
    expect(findStepNodeToOpen({ nodes: [step], nodeId: "gone" })).toBeNull();
    expect(findStepNodeToOpen({ nodes: [], nodeId: "n1" })).toBeNull();
  });

  test("a placeholder is not a step — it has no settings to open", () => {
    expect(
      findStepNodeToOpen({ nodes: [placeholder], nodeId: "n2" }),
    ).toBeNull();
  });

  test("a node with no data at all is still openable", () => {
    /*
     * Node data is what the canvas hands back, so this only happens to an
     * imported graph — better to open it and show what is there than to
     * silently do nothing when the builder clicked.
     */
    const bare: OpenableGraphNode = { id: "n3" };

    expect(findStepNodeToOpen({ nodes: [bare], nodeId: "n3" })).toBe(bare);
  });
});

describe("groupWorkflowLintIssues — grouping", () => {
  test("an empty list produces no groups", () => {
    expect(groupWorkflowLintIssues({ issues: [] })).toEqual([]);
  });

  test("issues about the same node land in one group", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n1", message: "First problem." }),
        makeIssue({ nodeId: "n1", message: "Second problem." }),
      ],
    });

    expect(groups).toHaveLength(1);
    expect(messagesOf(groups[0] as WorkflowIssueGroup)).toEqual([
      "First problem.",
      "Second problem.",
    ]);
  });

  test("issues about different nodes stay apart", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n1", componentId: "api-get-1" }),
        makeIssue({ nodeId: "n2", componentId: "api-post-1" }),
      ],
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]?.nodeId).toBe("n1");
    expect(groups[1]?.nodeId).toBe("n2");
  });

  test("two steps that share a component id still group by node", () => {
    /*
     * A duplicate id is itself something the lint reports, so the panel has to
     * keep telling the two steps apart while the builder fixes it.
     */
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n1", componentId: "api-get-1" }),
        makeIssue({ nodeId: "n2", componentId: "api-get-1" }),
      ],
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]?.key).not.toBe(groups[1]?.key);
  });

  test("issues about the graph itself group under the workflow", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({
          rule: WorkflowLintRule.NoTrigger,
          nodeId: null,
          componentId: null,
          message: "This workflow has no trigger.",
        }),
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(WORKFLOW_ISSUE_GRAPH_GROUP_KEY);
    expect(groups[0]?.title).toBe(WORKFLOW_ISSUE_GRAPH_GROUP_TITLE);
    expect(groups[0]?.nodeId).toBeNull();
    expect(groups[0]?.componentId).toBeNull();
  });

  test("an issue naming a step but no node groups with that step", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: null, componentId: "api-get-1", message: "One." }),
        makeIssue({ nodeId: null, componentId: "api-get-1", message: "Two." }),
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).not.toBe(WORKFLOW_ISSUE_GRAPH_GROUP_KEY);
    expect(groups[0]?.title).toBe("api-get-1");
    expect(groups[0]?.issues).toHaveLength(2);
  });

  test("ignores holes in the issue list", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n1" }),
        null as unknown as WorkflowLintIssue,
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.issues).toHaveLength(1);
  });
});

describe("groupWorkflowLintIssues — titles", () => {
  test("uses the title the canvas shows for the step", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [makeIssue({ nodeId: "n1", componentId: "api-get-1" })],
      stepTitlesByNodeId: { n1: "Make API Request" },
    });

    expect(groups[0]?.title).toBe("Make API Request");
    expect(groups[0]?.componentId).toBe("api-get-1");
  });

  test("falls back to the step id when the node has no title", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [makeIssue({ nodeId: "n1", componentId: "api-get-1" })],
      stepTitlesByNodeId: {},
    });

    expect(groups[0]?.title).toBe("api-get-1");
  });

  test("falls back again when the step has no id either", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [makeIssue({ nodeId: "n1", componentId: null })],
    });

    expect(groups[0]?.title).toBe(WORKFLOW_ISSUE_UNTITLED_STEP_TITLE);
  });

  test("takes the title from the first issue seen for a node", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n1", componentId: "api-get-1" }),
        makeIssue({ nodeId: "n1", componentId: "api-get-1" }),
      ],
      stepTitlesByNodeId: { n1: "Make API Request" },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe("Make API Request");
  });
});

describe("groupWorkflowLintIssues — counting", () => {
  test("counts each severity within a group", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({
          nodeId: "n1",
          severity: WorkflowLintSeverity.Error,
          message: "One.",
        }),
        makeIssue({
          nodeId: "n1",
          severity: WorkflowLintSeverity.Error,
          message: "Two.",
        }),
        makeIssue({
          nodeId: "n1",
          severity: WorkflowLintSeverity.Warning,
          message: "Three.",
        }),
      ],
    });

    expect(groups[0]?.errorCount).toBe(2);
    expect(groups[0]?.warningCount).toBe(1);
  });

  test("a deduplicated issue is not counted twice", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n1", message: "Same thing." }),
        makeIssue({ nodeId: "n1", message: "Same thing." }),
      ],
    });

    expect(groups[0]?.issues).toHaveLength(1);
    expect(groups[0]?.errorCount).toBe(1);
  });

  test("group counts add up to the whole list", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n1", message: "A." }),
        makeIssue({
          nodeId: "n2",
          severity: WorkflowLintSeverity.Warning,
          message: "B.",
        }),
        makeIssue({ nodeId: null, componentId: null, message: "C." }),
      ],
    });

    const totalErrors: number = groups.reduce(
      (total: number, group: WorkflowIssueGroup) => {
        return total + group.errorCount;
      },
      0,
    );
    const totalWarnings: number = groups.reduce(
      (total: number, group: WorkflowIssueGroup) => {
        return total + group.warningCount;
      },
      0,
    );

    expect(totalErrors).toBe(2);
    expect(totalWarnings).toBe(1);
  });
});

describe("groupWorkflowLintIssues — deduplication", () => {
  test("drops an identical message repeated for the same step", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n1", message: '"URL" is required but empty.' }),
        makeIssue({ nodeId: "n1", message: '"URL" is required but empty.' }),
      ],
    });

    expect(messagesOf(groups[0] as WorkflowIssueGroup)).toEqual([
      '"URL" is required but empty.',
    ]);
  });

  test("keeps the same message when it is reported at a different severity", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({
          nodeId: "n1",
          severity: WorkflowLintSeverity.Error,
          message: "Same words.",
        }),
        makeIssue({
          nodeId: "n1",
          severity: WorkflowLintSeverity.Warning,
          message: "Same words.",
        }),
      ],
    });

    expect(groups[0]?.issues).toHaveLength(2);
  });

  test("keeps the same message when it belongs to a different step", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n1", message: "Same words." }),
        makeIssue({ nodeId: "n2", message: "Same words." }),
      ],
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]?.issues).toHaveLength(1);
    expect(groups[1]?.issues).toHaveLength(1);
  });
});

describe("groupWorkflowLintIssues — ordering", () => {
  test("errors come before warnings inside a group", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({
          nodeId: "n1",
          severity: WorkflowLintSeverity.Warning,
          message: "A warning.",
        }),
        makeIssue({
          nodeId: "n1",
          severity: WorkflowLintSeverity.Error,
          message: "An error.",
        }),
      ],
    });

    expect(messagesOf(groups[0] as WorkflowIssueGroup)).toEqual([
      "An error.",
      "A warning.",
    ]);
  });

  test("issues of one severity keep the order the checks found them in", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n1", message: "First." }),
        makeIssue({ nodeId: "n1", message: "Second." }),
        makeIssue({ nodeId: "n1", message: "Third." }),
      ],
    });

    expect(messagesOf(groups[0] as WorkflowIssueGroup)).toEqual([
      "First.",
      "Second.",
      "Third.",
    ]);
  });

  test("the graph's own issues lead, even when a step has errors and it does not", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n1", message: "A step error." }),
        makeIssue({
          nodeId: null,
          componentId: null,
          severity: WorkflowLintSeverity.Warning,
          message: "A graph warning.",
        }),
      ],
    });

    expect(groups[0]?.key).toBe(WORKFLOW_ISSUE_GRAPH_GROUP_KEY);
    expect(groups[1]?.nodeId).toBe("n1");
  });

  test("steps with errors come before steps with only warnings", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({
          nodeId: "n1",
          severity: WorkflowLintSeverity.Warning,
          message: "Only a warning.",
        }),
        makeIssue({
          nodeId: "n2",
          severity: WorkflowLintSeverity.Error,
          message: "An error.",
        }),
      ],
    });

    expect(groups[0]?.nodeId).toBe("n2");
    expect(groups[1]?.nodeId).toBe("n1");
  });

  test("steps of equal weight keep the order the checks found them in", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        makeIssue({ nodeId: "n3", message: "Third." }),
        makeIssue({ nodeId: "n1", message: "First." }),
        makeIssue({ nodeId: "n2", message: "Second." }),
      ],
    });

    expect(
      groups.map((group: WorkflowIssueGroup) => {
        return group.nodeId;
      }),
    ).toEqual(["n3", "n1", "n2"]);
  });

  test("does not mutate the list it was given", () => {
    const issues: Array<WorkflowLintIssue> = [
      makeIssue({
        nodeId: "n1",
        severity: WorkflowLintSeverity.Warning,
        message: "A warning.",
      }),
      makeIssue({
        nodeId: "n1",
        severity: WorkflowLintSeverity.Error,
        message: "An error.",
      }),
    ];

    groupWorkflowLintIssues({ issues: issues });

    expect(
      issues.map((issue: WorkflowLintIssue) => {
        return issue.message;
      }),
    ).toEqual(["A warning.", "An error."]);
  });
});

/*
 * The panel is fed by lintWorkflowGraph, so the interesting case is a real
 * graph rather than a hand-written issue list: the screenshot that started
 * this work showed one step reported twice, once as unreachable and once for
 * an empty required field.
 */
describe("groupWorkflowLintIssues — over a real linted graph", () => {
  const jsonArgument: Argument = {
    id: "json",
    name: "JSON Object",
    description: "The object to create",
    type: ComponentInputType.JSON,
    required: true,
  };

  type MakeMetadataFunction = (params: {
    title: string;
    componentType: ComponentType;
    args: Array<Argument>;
  }) => ComponentMetadata;

  const makeMetadata: MakeMetadataFunction = (params: {
    title: string;
    componentType: ComponentType;
    args: Array<Argument>;
  }): ComponentMetadata => {
    return {
      id: params.title,
      title: params.title,
      category: "Test",
      description: "A test component",
      iconProp: IconProp.Bolt,
      componentType: params.componentType,
      arguments: params.args,
      returnValues: [],
      inPorts: [],
      outPorts: [],
    };
  };

  type MakeNodeFunction = (params: {
    nodeId: string;
    componentId: string;
    title: string;
    componentType?: ComponentType | undefined;
    args?: Array<Argument> | undefined;
  }) => LintGraphNode;

  const makeNode: MakeNodeFunction = (params: {
    nodeId: string;
    componentId: string;
    title: string;
    componentType?: ComponentType | undefined;
    args?: Array<Argument> | undefined;
  }): LintGraphNode => {
    const componentType: ComponentType =
      params.componentType || ComponentType.Component;

    return {
      id: params.nodeId,
      data: {
        error: "",
        id: params.componentId,
        nodeType: NodeType.Node,
        metadata: makeMetadata({
          title: params.title,
          componentType: componentType,
          args: params.args || [],
        }),
        metadataId: `${params.componentId}-metadata`,
        internalId: `${params.nodeId}-internal`,
        arguments: {},
        returnValues: {},
        componentType: componentType,
      },
    };
  };

  test("a step that is both unreachable and unconfigured becomes one group", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        makeNode({
          nodeId: "n1",
          componentId: "manual-1",
          title: "Manual Trigger",
          componentType: ComponentType.Trigger,
        }),
        makeNode({
          nodeId: "n2",
          componentId: "monitor-secret-create-one-1",
          title: "Create Monitor Secret",
          args: [jsonArgument],
        }),
      ],
      edges: [],
    });

    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(1);

    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: result.issues,
      stepTitlesByNodeId: buildStepTitlesByNodeId([
        { id: "n1", data: { metadata: { title: "Manual Trigger" } } },
        { id: "n2", data: { metadata: { title: "Create Monitor Secret" } } },
      ]),
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe("Create Monitor Secret");
    expect(groups[0]?.componentId).toBe("monitor-secret-create-one-1");
    expect(groups[0]?.errorCount).toBe(1);
    expect(groups[0]?.warningCount).toBe(1);
    expect(messagesOf(groups[0] as WorkflowIssueGroup)).toEqual([
      '"JSON Object" is required but empty.',
      "Nothing connects to this step from the trigger, so it will never run.",
    ]);
  });

  test("a graph-wide problem leads the list ahead of the steps", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        makeNode({
          nodeId: "n1",
          componentId: "api-post-1",
          title: "Make API Request",
          args: [jsonArgument],
        }),
      ],
      edges: [],
    });

    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: result.issues,
    });

    expect(groups[0]?.key).toBe(WORKFLOW_ISSUE_GRAPH_GROUP_KEY);
    expect(groups[0]?.issues[0]?.rule).toBe(WorkflowLintRule.NoTrigger);
    expect(groups[1]?.componentId).toBe("api-post-1");
  });

  test("a clean graph gives the panel nothing to show", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        makeNode({
          nodeId: "n1",
          componentId: "manual-1",
          title: "Manual Trigger",
          componentType: ComponentType.Trigger,
        }),
      ],
      edges: [],
    });

    expect(groupWorkflowLintIssues({ issues: result.issues })).toEqual([]);
    expect(getWorkflowLintTone(result)).toBe(WorkflowLintTone.Clean);
    expect(getWorkflowLintCountText(result)).toBe("");
  });
});

/*
 * What one step on the canvas says about itself. Settings no longer open when
 * a step is added, so an empty required setting has to read as "Click to set
 * up" (the next thing to do) and not as a red error badge on a step that was
 * added a moment ago.
 */
describe("buildNodeIssueSummaries", () => {
  test("an empty list summarises no steps", () => {
    expect(buildNodeIssueSummaries([])).toEqual({});
  });

  test("an empty required setting is a setting to fill in, not an error", () => {
    const summaries: Dictionary<WorkflowNodeIssueSummary> =
      buildNodeIssueSummaries([
        makeIssue({
          rule: WorkflowLintRule.MissingRequiredArgument,
          message: '"Message" is required but empty.',
        }),
      ]);

    expect(summaries["n1"]).toEqual({
      missingSettingMessages: ['"Message" is required but empty.'],
      errorMessages: [],
      warningMessages: [],
    });
  });

  test("every other error stays an error", () => {
    const rules: Array<WorkflowLintRule> = [
      WorkflowLintRule.InvalidJSON,
      WorkflowLintRule.ReferenceHasWhitespace,
      WorkflowLintRule.UnknownReferenceRoot,
      WorkflowLintRule.UnknownReferencedComponent,
      WorkflowLintRule.UnknownReferencedReturnValue,
      WorkflowLintRule.SelfReference,
      WorkflowLintRule.ForwardReference,
      WorkflowLintRule.DuplicateComponentId,
      WorkflowLintRule.ComponentIdContainsDot,
    ];

    const summaries: Dictionary<WorkflowNodeIssueSummary> =
      buildNodeIssueSummaries(
        rules.map((rule: WorkflowLintRule) => {
          return makeIssue({ rule: rule, message: `${rule}.` });
        }),
      );

    expect(summaries["n1"]?.errorMessages).toEqual(
      rules.map((rule: WorkflowLintRule) => {
        return `${rule}.`;
      }),
    );
    expect(summaries["n1"]?.missingSettingMessages).toEqual([]);
    expect(summaries["n1"]?.warningMessages).toEqual([]);
  });

  test("warnings are kept apart from errors", () => {
    const summaries: Dictionary<WorkflowNodeIssueSummary> =
      buildNodeIssueSummaries([
        makeIssue({
          rule: WorkflowLintRule.UnreachableComponent,
          severity: WorkflowLintSeverity.Warning,
          message: "Nothing runs this step.",
        }),
        makeIssue({
          rule: WorkflowLintRule.ReferenceToUnreachableComponent,
          severity: WorkflowLintSeverity.Warning,
          message: "It reads from a step that never runs.",
        }),
      ]);

    expect(summaries["n1"]).toEqual({
      missingSettingMessages: [],
      errorMessages: [],
      warningMessages: [
        "Nothing runs this step.",
        "It reads from a step that never runs.",
      ],
    });
  });

  test("keys each step by its react-flow node id", () => {
    const summaries: Dictionary<WorkflowNodeIssueSummary> =
      buildNodeIssueSummaries([
        makeIssue({ nodeId: "a", message: "About a." }),
        makeIssue({
          nodeId: "b",
          rule: WorkflowLintRule.InvalidJSON,
          message: "About b.",
        }),
      ]);

    expect(Object.keys(summaries).sort()).toEqual(["a", "b"]);
    expect(summaries["a"]?.missingSettingMessages).toEqual(["About a."]);
    expect(summaries["b"]?.errorMessages).toEqual(["About b."]);
  });

  test("issues about the whole workflow belong to no step", () => {
    expect(
      buildNodeIssueSummaries([
        makeIssue({
          rule: WorkflowLintRule.NoTrigger,
          nodeId: null,
          componentId: null,
          message: "No trigger.",
        }),
      ]),
    ).toEqual({});
  });

  test("a message repeated for the same step is kept once", () => {
    const summaries: Dictionary<WorkflowNodeIssueSummary> =
      buildNodeIssueSummaries([
        makeIssue({ message: '"URL" is required but empty.' }),
        makeIssue({ message: '"URL" is required but empty.' }),
      ]);

    expect(summaries["n1"]?.missingSettingMessages).toEqual([
      '"URL" is required but empty.',
    ]);
  });

  test("keeps the order the checks found things in", () => {
    const summaries: Dictionary<WorkflowNodeIssueSummary> =
      buildNodeIssueSummaries([
        makeIssue({ argumentId: "b", message: '"B" is required but empty.' }),
        makeIssue({ argumentId: "a", message: '"A" is required but empty.' }),
      ]);

    expect(summaries["n1"]?.missingSettingMessages).toEqual([
      '"B" is required but empty.',
      '"A" is required but empty.',
    ]);
  });

  test("ignores holes in the list and does not change it", () => {
    const issues: Array<WorkflowLintIssue> = [
      makeIssue({ message: "Kept." }),
      undefined as unknown as WorkflowLintIssue,
    ];
    const before: string = JSON.stringify(issues);

    expect(
      buildNodeIssueSummaries(issues)["n1"]?.missingSettingMessages,
    ).toEqual(["Kept."]);
    expect(JSON.stringify(issues)).toBe(before);
  });
});

describe("getWorkflowNodeIssuePresentation", () => {
  const summary: (
    params: Partial<WorkflowNodeIssueSummary>,
  ) => WorkflowNodeIssueSummary = (
    params: Partial<WorkflowNodeIssueSummary>,
  ): WorkflowNodeIssueSummary => {
    return {
      missingSettingMessages: params.missingSettingMessages || [],
      errorMessages: params.errorMessages || [],
      warningMessages: params.warningMessages || [],
    };
  };

  test("a step the checks say nothing about shows nothing", () => {
    expect(getWorkflowNodeIssuePresentation({})).toEqual({
      needsSetup: false,
      setupHint: "",
      badgeTone: WorkflowLintTone.Clean,
      badgeText: "",
    });
  });

  test("a step with empty required settings asks to be set up, with no badge", () => {
    expect(
      getWorkflowNodeIssuePresentation({
        issueSummary: summary({
          missingSettingMessages: [
            '"Webhook URL" is required but empty.',
            '"Message" is required but empty.',
          ],
        }),
        error:
          '"Webhook URL" is required but empty.\n"Message" is required but empty.',
      }),
    ).toEqual({
      needsSetup: true,
      setupHint:
        '"Webhook URL" is required but empty.\n"Message" is required but empty.',
      badgeTone: WorkflowLintTone.Clean,
      badgeText: "",
    });
  });

  test("a warning alone gives a warning badge", () => {
    expect(
      getWorkflowNodeIssuePresentation({
        issueSummary: summary({ warningMessages: ["Nothing runs this step."] }),
      }),
    ).toEqual({
      needsSetup: false,
      setupHint: "",
      badgeTone: WorkflowLintTone.Warning,
      badgeText: "Nothing runs this step.",
    });
  });

  test("an error outranks a warning, and the badge says the error first", () => {
    expect(
      getWorkflowNodeIssuePresentation({
        issueSummary: summary({
          warningMessages: ["Nothing runs this step."],
          errorMessages: ['"Body" is not valid JSON.'],
        }),
      }),
    ).toEqual({
      needsSetup: false,
      setupHint: "",
      badgeTone: WorkflowLintTone.Error,
      badgeText: '"Body" is not valid JSON.\nNothing runs this step.',
    });
  });

  test("a step can need setting up and have an error at once", () => {
    const presentation: ReturnType<typeof getWorkflowNodeIssuePresentation> =
      getWorkflowNodeIssuePresentation({
        issueSummary: summary({
          missingSettingMessages: ['"Message" is required but empty.'],
          errorMessages: ['"Headers" is not valid JSON.'],
        }),
      });

    expect(presentation.needsSetup).toBe(true);
    expect(presentation.setupHint).toBe('"Message" is required but empty.');
    expect(presentation.badgeTone).toBe(WorkflowLintTone.Error);
    expect(presentation.badgeText).toBe('"Headers" is not valid JSON.');
  });

  test("the badge never repeats what the setup prompt already says", () => {
    const presentation: ReturnType<typeof getWorkflowNodeIssuePresentation> =
      getWorkflowNodeIssuePresentation({
        issueSummary: summary({
          missingSettingMessages: ['"Message" is required but empty.'],
          warningMessages: ["Nothing runs this step."],
        }),
      });

    expect(presentation.badgeText).not.toContain("required");
    expect(presentation.badgeTone).toBe(WorkflowLintTone.Warning);
  });

  test("plain error text with no summary still shows as an error", () => {
    expect(
      getWorkflowNodeIssuePresentation({ error: "Something is wrong." }),
    ).toEqual({
      needsSetup: false,
      setupHint: "",
      badgeTone: WorkflowLintTone.Error,
      badgeText: "Something is wrong.",
    });
  });

  test("a summary wins over the plain text it was built alongside", () => {
    expect(
      getWorkflowNodeIssuePresentation({
        issueSummary: summary({}),
        error: "Stale text.",
      }).badgeTone,
    ).toBe(WorkflowLintTone.Clean);
  });
});

describe("buildNodeIssueSummaries — over a real linted graph", () => {
  const messageArgument: Argument = {
    id: "message",
    name: "Message",
    description: "What to send",
    type: ComponentInputType.Text,
    required: true,
  };

  const headersArgument: Argument = {
    id: "headers",
    name: "Headers",
    description: "Request headers",
    type: ComponentInputType.JSON,
    required: false,
  };

  type MakeNodeFunction = (params: {
    nodeId: string;
    componentId: string;
    componentType?: ComponentType | undefined;
    args?: Array<Argument> | undefined;
    values?: Dictionary<string> | undefined;
  }) => LintGraphNode;

  const makeNode: MakeNodeFunction = (params: {
    nodeId: string;
    componentId: string;
    componentType?: ComponentType | undefined;
    args?: Array<Argument> | undefined;
    values?: Dictionary<string> | undefined;
  }): LintGraphNode => {
    const componentType: ComponentType =
      params.componentType || ComponentType.Component;

    const metadata: ComponentMetadata = {
      id: params.componentId,
      title: params.componentId,
      category: "Test",
      description: "A test component",
      iconProp: IconProp.Bolt,
      componentType: componentType,
      arguments: params.args || [],
      returnValues: [],
      inPorts: [],
      outPorts: [],
    };

    return {
      id: params.nodeId,
      data: {
        error: "",
        id: params.componentId,
        nodeType: NodeType.Node,
        metadata: metadata,
        metadataId: `${params.componentId}-metadata`,
        internalId: `${params.nodeId}-internal`,
        arguments: params.values || {},
        returnValues: {},
        componentType: componentType,
      },
    };
  };

  const trigger: LintGraphNode = makeNode({
    nodeId: "trigger",
    componentId: "manual-1",
    componentType: ComponentType.Trigger,
  });

  test("a step that was just added asks to be set up and warns it is not connected", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        trigger,
        makeNode({
          nodeId: "added",
          componentId: "slack-1",
          args: [messageArgument],
        }),
      ],
      edges: [],
    });

    const presentation: ReturnType<typeof getWorkflowNodeIssuePresentation> =
      getWorkflowNodeIssuePresentation({
        issueSummary: buildNodeIssueSummaries(result.issues)["added"],
      });

    expect(presentation).toEqual({
      needsSetup: true,
      setupHint: '"Message" is required but empty.',
      badgeTone: WorkflowLintTone.Warning,
      badgeText:
        "Nothing connects to this step from the trigger, so it will never run.",
    });
  });

  test("once connected, an unconfigured step shows only the setup prompt", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        trigger,
        makeNode({
          nodeId: "added",
          componentId: "slack-1",
          args: [messageArgument],
        }),
      ],
      edges: [{ source: "trigger", target: "added" }],
    });

    const presentation: ReturnType<typeof getWorkflowNodeIssuePresentation> =
      getWorkflowNodeIssuePresentation({
        issueSummary: buildNodeIssueSummaries(result.issues)["added"],
      });

    expect(presentation.needsSetup).toBe(true);
    expect(presentation.badgeTone).toBe(WorkflowLintTone.Clean);
  });

  test("a set-up step with broken JSON shows a red badge and no setup prompt", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        trigger,
        makeNode({
          nodeId: "api",
          componentId: "api-1",
          args: [messageArgument, headersArgument],
          values: { message: "Hello", headers: "{not json" },
        }),
      ],
      edges: [{ source: "trigger", target: "api" }],
    });

    const presentation: ReturnType<typeof getWorkflowNodeIssuePresentation> =
      getWorkflowNodeIssuePresentation({
        issueSummary: buildNodeIssueSummaries(result.issues)["api"],
      });

    expect(presentation.needsSetup).toBe(false);
    expect(presentation.badgeTone).toBe(WorkflowLintTone.Error);
    expect(presentation.badgeText).toContain('"Headers" is not valid JSON.');
  });

  test("filling in the required setting clears the prompt", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        trigger,
        makeNode({
          nodeId: "added",
          componentId: "slack-1",
          args: [messageArgument],
          values: { message: "Deploy finished" },
        }),
      ],
      edges: [{ source: "trigger", target: "added" }],
    });

    expect(buildNodeIssueSummaries(result.issues)["added"]).toBeUndefined();
    expect(getWorkflowNodeIssuePresentation({})).toEqual(
      expect.objectContaining({
        needsSetup: false,
        badgeTone: WorkflowLintTone.Clean,
      }),
    );
  });

  test("the summary carries every message the canvas's error text does, sorted", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        trigger,
        makeNode({
          nodeId: "added",
          componentId: "slack-1",
          args: [messageArgument, headersArgument],
          values: { headers: "{not json" },
        }),
      ],
      edges: [],
    });

    const summary: WorkflowNodeIssueSummary = buildNodeIssueSummaries(
      result.issues,
    )["added"] as WorkflowNodeIssueSummary;

    expect(
      [
        ...summary.missingSettingMessages,
        ...summary.errorMessages,
        ...summary.warningMessages,
      ].sort(),
    ).toEqual((result.errorsByNodeId["added"] || "").split("\n").sort());
  });
});
