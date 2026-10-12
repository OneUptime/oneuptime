/*
 * What the workflow's checks say about a Switch / Case step, from its real
 * definition, and about a connection that leaves a step from an output it no
 * longer has.
 *
 * Worth flagging, because each is a run that quietly goes the wrong way:
 *   - a case not set up yet (nothing to compare with): "Click to set up",
 *     like any empty setting;
 *   - a case whose comparison the step does not know: every run stops;
 *   - a case that asks the same as one above it: it is never taken;
 *   - a case nothing is connected to: a run that matches it stops there;
 *   - cases that cannot be read at all: every run stops;
 *   - a connection from an output the step does not have (a case taken out
 *     outside the builder): it never carries a run, and does not make the
 *     step it leads to reachable.
 * Not worth flagging: Default with nothing connected, which is how "do
 * nothing for anything else" is said, as If / Else's No is.
 */

import {
  LintGraphEdge,
  LintGraphNode,
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
  WorkflowLintSeverity,
  lintWorkflowGraph,
} from "../../../../../UI/Components/Workflow/GraphLint";
import {
  WorkflowNodeIssueSummary,
  buildNodeIssueSummaries,
} from "../../../../../UI/Components/Workflow/GraphLintSummary";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata, {
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import {
  getStarterSwitchCases,
  toStoredSwitchCases,
} from "../../../../../Types/Workflow/Components/SwitchCases";
import { describe, expect, test } from "@jest/globals";

type MetadataFunction = (id: ComponentID) => ComponentMetadata;

const metadataOf: MetadataFunction = (id: ComponentID): ComponentMetadata => {
  return Components.find((component: ComponentMetadata) => {
    return component.id === id;
  }) as ComponentMetadata;
};

const SWITCH: ComponentMetadata = metadataOf(ComponentID.Switch);
const MANUAL: ComponentMetadata = metadataOf(ComponentID.Manual);
const LOG: ComponentMetadata = metadataOf(ComponentID.Log);
const IF_ELSE: ComponentMetadata = metadataOf(ComponentID.IfElse);

type NodeFunction = (
  nodeId: string,
  metadata: ComponentMetadata,
  componentId: string,
  args?: JSONObject,
) => LintGraphNode;

const node: NodeFunction = (
  nodeId: string,
  metadata: ComponentMetadata,
  componentId: string,
  args: JSONObject = {},
): LintGraphNode => {
  return {
    id: nodeId,
    data: {
      error: "",
      id: componentId,
      nodeType: NodeType.Node,
      metadata: metadata,
      metadataId: metadata.id,
      internalId: `${nodeId}-internal`,
      arguments: args,
      returnValues: {},
      componentType: metadata.componentType,
    },
  };
};

type CaseFunction = (
  id: string,
  comparison: string,
  value?: string,
  compareAs?: string,
) => JSONObject;

const aCase: CaseFunction = (
  id: string,
  comparison: string,
  value: string = "",
  compareAs: string = "text",
): JSONObject => {
  return { id: id, comparison: comparison, value: value, compareAs: compareAs };
};

const VALUE: string = "{{local.components.manual-1.returnValues.value}}";

type EdgeFunction = (
  source: string,
  sourceHandle: string | undefined,
  target: string,
) => LintGraphEdge;

const edge: EdgeFunction = (
  source: string,
  sourceHandle: string | undefined,
  target: string,
): LintGraphEdge => {
  return { source: source, target: target, sourceHandle: sourceHandle };
};

type LintFunction = (
  args: JSONObject,
  extraEdges?: Array<LintGraphEdge>,
) => WorkflowLintResult;

/*
 * A manual trigger, a Switch / Case with these settings, and three Log steps
 * to connect its outputs to: log-a, log-b and log-c.
 */
const lint: LintFunction = (
  args: JSONObject,
  extraEdges: Array<LintGraphEdge> = [],
): WorkflowLintResult => {
  return lintWorkflowGraph({
    nodes: [
      node("n-manual", MANUAL, "manual-1"),
      node("n-switch", SWITCH, "switch-1", args),
      node("n-log-a", LOG, "log-a", { value: "a" }),
      node("n-log-b", LOG, "log-b", { value: "b" }),
      node("n-log-c", LOG, "log-c", { value: "c" }),
    ],
    edges: [edge("n-manual", "success", "n-switch"), ...extraEdges],
  });
};

type SwitchIssuesFunction = (
  result: WorkflowLintResult,
) => Array<WorkflowLintIssue>;

const switchIssues: SwitchIssuesFunction = (
  result: WorkflowLintResult,
): Array<WorkflowLintIssue> => {
  return result.issues.filter((issue: WorkflowLintIssue): boolean => {
    return issue.nodeId === "n-switch";
  });
};

type MessagesFunction = (issues: Array<WorkflowLintIssue>) => Array<string>;

const messages: MessagesFunction = (
  issues: Array<WorkflowLintIssue>,
): Array<string> => {
  return issues.map((issue: WorkflowLintIssue): string => {
    return issue.message;
  });
};

const CONNECTED_SEVERITY: Array<LintGraphEdge> = [
  edge("n-switch", "case-1", "n-log-a"),
  edge("n-switch", "case-2", "n-log-b"),
  edge("n-switch", "default", "n-log-c"),
];

const SEVERITY_CASES: Array<JSONObject> = [
  aCase("case-1", "==", "Critical Incident"),
  aCase("case-2", "==", "Major Incident"),
];

describe("a Switch / Case that is set up and connected", () => {
  test("has nothing to say", () => {
    const result: WorkflowLintResult = lint(
      { value: VALUE, cases: SEVERITY_CASES },
      CONNECTED_SEVERITY,
    );

    expect(result.issues).toEqual([]);
  });

  test("with Default left unconnected - do nothing for anything else - still has nothing to say", () => {
    const result: WorkflowLintResult = lint(
      { value: VALUE, cases: SEVERITY_CASES },
      CONNECTED_SEVERITY.slice(0, 2),
    );

    expect(switchIssues(result)).toEqual([]);
  });
});

describe("what still needs setting up", () => {
  test("a new step: the value to check, and each of its two empty cases", () => {
    const issues: Array<WorkflowLintIssue> = switchIssues(
      lint({ cases: toStoredSwitchCases(getStarterSwitchCases()) }),
    );

    expect(
      issues.map((issue: WorkflowLintIssue) => {
        return [issue.rule, issue.severity, issue.argumentId, issue.message];
      }),
    ).toEqual([
      [
        WorkflowLintRule.MissingRequiredArgument,
        WorkflowLintSeverity.Error,
        "cases",
        "Case 1 needs a value to compare with.",
      ],
      [
        WorkflowLintRule.MissingRequiredArgument,
        WorkflowLintSeverity.Error,
        "cases",
        "Case 2 needs a value to compare with.",
      ],
      [
        WorkflowLintRule.MissingRequiredArgument,
        WorkflowLintSeverity.Error,
        "value",
        '"Value to check" is required but empty.',
      ],
    ]);
  });

  test("which the canvas shows as Click to set up, not as a red badge", () => {
    const summaries: Dictionary<WorkflowNodeIssueSummary> =
      buildNodeIssueSummaries(
        lint({ cases: toStoredSwitchCases(getStarterSwitchCases()) }).issues,
      );

    expect(summaries["n-switch"]).toEqual({
      missingSettingMessages: [
        "Case 1 needs a value to compare with.",
        "Case 2 needs a value to compare with.",
        '"Value to check" is required but empty.',
      ],
      errorMessages: [],
      warningMessages: [],
    });
  });

  test("a case that needs no value - is empty, is true - is set up as it is", () => {
    expect(
      switchIssues(
        lint(
          {
            value: VALUE,
            cases: [
              aCase("case-1", "is empty"),
              aCase("case-2", "==", "true", "boolean"),
            ],
          },
          [
            edge("n-switch", "case-1", "n-log-a"),
            edge("n-switch", "case-2", "n-log-b"),
          ],
        ),
      ),
    ).toEqual([]);
  });

  test("a step with no case at all needs its cases", () => {
    expect(messages(switchIssues(lint({ value: VALUE, cases: [] })))).toEqual([
      '"Cases" is required but empty.',
    ]);
  });
});

describe("cases that stop every run", () => {
  test("a comparison the step does not know", () => {
    const issues: Array<WorkflowLintIssue> = switchIssues(
      lint(
        {
          value: VALUE,
          cases: [aCase("case-1", "==", "a"), aCase("case-2", "~=", "b")],
        },
        [edge("n-switch", "case-1", "n-log-a")],
      ),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        rule: WorkflowLintRule.SwitchCaseUnknownComparison,
        severity: WorkflowLintSeverity.Error,
        argumentId: "cases",
        message:
          "Case 2 has a comparison this step does not know, so every run stops here. Choose one, such as is equal to.",
      }),
    ]);
  });

  test("cases that are not a list at all", () => {
    const issues: Array<WorkflowLintIssue> = switchIssues(
      lint({ value: VALUE, cases: "not a list" }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        rule: WorkflowLintRule.SwitchCasesUnreadable,
        severity: WorkflowLintSeverity.Error,
        message:
          "This step's cases could not be read, so every run stops here. Open the step and add its cases again.",
      }),
    ]);
  });
});

describe("cases that are never taken", () => {
  test("a case that asks the same as one above it", () => {
    const issues: Array<WorkflowLintIssue> = switchIssues(
      lint(
        {
          value: VALUE,
          cases: [
            aCase("case-1", "==", "Critical Incident"),
            aCase("case-2", "==", "Major Incident"),
            aCase("case-3", "==", "Critical Incident"),
          ],
        },
        [
          edge("n-switch", "case-1", "n-log-a"),
          edge("n-switch", "case-2", "n-log-b"),
          edge("n-switch", "case-3", "n-log-c"),
        ],
      ),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        rule: WorkflowLintRule.SwitchCaseNeverTaken,
        severity: WorkflowLintSeverity.Warning,
        message:
          "Case 3 asks the same as case 1, which is checked first, so case 3 is never taken. Change it or remove it.",
      }),
    ]);
  });
});

describe("cases nothing is connected to", () => {
  test("each says a run that matches it stops at the step, naming the case", () => {
    const issues: Array<WorkflowLintIssue> = switchIssues(
      lint({ value: VALUE, cases: SEVERITY_CASES }, [
        edge("n-switch", "case-2", "n-log-b"),
      ]),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        rule: WorkflowLintRule.SwitchCaseNotConnected,
        severity: WorkflowLintSeverity.Warning,
        argumentId: "cases",
        message:
          'Nothing is connected to case 1, "Critical Incident", so a run that matches it stops at this step.',
      }),
    ]);
  });

  test("a warning, an amber badge: the workflow runs", () => {
    const summaries: Dictionary<WorkflowNodeIssueSummary> =
      buildNodeIssueSummaries(
        lint({ value: VALUE, cases: SEVERITY_CASES }, []).issues,
      );

    expect(summaries["n-switch"]?.errorMessages).toEqual([]);
    expect(summaries["n-switch"]?.warningMessages).toHaveLength(2);
  });

  test("not said of a case still being set up: that one says Click to set up", () => {
    expect(
      switchIssues(
        lint({ value: VALUE, cases: [aCase("case-1", "==", "")] }),
      ).map((issue: WorkflowLintIssue): WorkflowLintRule => {
        return issue.rule;
      }),
    ).toEqual([WorkflowLintRule.MissingRequiredArgument]);
  });
});

describe("a connection from an output the step does not have", () => {
  test("is said once, on the step it leaves, naming where it led", () => {
    const issues: Array<WorkflowLintIssue> = switchIssues(
      lint({ value: VALUE, cases: [aCase("case-1", "==", "a")] }, [
        edge("n-switch", "case-1", "n-log-a"),
        // case-2 was taken out of the step outside the builder.
        edge("n-switch", "case-2", "n-log-b"),
      ]),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        rule: WorkflowLintRule.ConnectionFromMissingOutput,
        severity: WorkflowLintSeverity.Warning,
        message:
          'A connection to "log-b" leaves this step from an output it no longer has, so it never runs from here. Connect "log-b" to one of the outputs this step has.',
      }),
    ]);
  });

  test("does not make the step it leads to reachable", () => {
    const result: WorkflowLintResult = lint(
      { value: VALUE, cases: [aCase("case-1", "==", "a")] },
      [
        edge("n-switch", "case-1", "n-log-a"),
        edge("n-switch", "case-2", "n-log-b"),
      ],
    );

    expect(
      result.issues
        .filter((issue: WorkflowLintIssue): boolean => {
          return issue.nodeId === "n-log-b";
        })
        .map((issue: WorkflowLintIssue): WorkflowLintRule => {
          return issue.rule;
        }),
    ).toEqual([WorkflowLintRule.UnreachableComponent]);
  });

  test("applies to every step: an If / Else connection from an output it never had", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        node("n-manual", MANUAL, "manual-1"),
        node("n-if", IF_ELSE, "if-else-1", {
          "input-1": VALUE,
          operator: "==",
          "input-2": "x",
        }),
        node("n-log-a", LOG, "log-a", { value: "a" }),
      ],
      edges: [
        edge("n-manual", "success", "n-if"),
        edge("n-if", "maybe", "n-log-a"),
      ],
    });

    expect(
      result.issues.map((issue: WorkflowLintIssue) => {
        return [issue.nodeId, issue.rule];
      }),
    ).toEqual([
      ["n-if", WorkflowLintRule.ConnectionFromMissingOutput],
      ["n-log-a", WorkflowLintRule.UnreachableComponent],
    ]);
  });

  test("a connection that does not say its output is taken to leave from one, as before", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        node("n-manual", MANUAL, "manual-1"),
        node("n-log-a", LOG, "log-a", { value: "a" }),
      ],
      edges: [{ source: "n-manual", target: "n-log-a" }],
    });

    expect(result.issues).toEqual([]);
  });
});

describe("references inside the cases", () => {
  test("are checked like any setting's, by the setting's name", () => {
    const issues: Array<WorkflowLintIssue> = switchIssues(
      lint(
        {
          value: VALUE,
          cases: [
            aCase(
              "case-1",
              "==",
              "{{local.components.no-such-step.returnValues.value}}",
            ),
          ],
        },
        [edge("n-switch", "case-1", "n-log-a")],
      ),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        rule: WorkflowLintRule.UnknownReferencedComponent,
        argumentId: "cases",
        message:
          '"Cases" refers to a step called "no-such-step", but no step in this workflow has that id.',
      }),
    ]);
  });
});
