/*
 * What the workflow's checks say about an If / Else step, from its real
 * definition.
 *
 * Compare with is required, except for the comparisons that look at the value
 * to check only - is empty and is not empty - which leave it empty. The
 * checks (and the canvas's "Click to set up", which they drive) have to agree
 * with the settings on that, or a finished step would be reported unfinished.
 */

import {
  LintGraphNode,
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
  lintWorkflowGraph,
} from "../../../../../UI/Components/Workflow/GraphLint";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  NodeType,
  isArgumentRequired,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import { describe, expect, test } from "@jest/globals";

const IF_ELSE: ComponentMetadata = Components.find(
  (component: ComponentMetadata) => {
    return component.id === ComponentID.IfElse;
  },
) as ComponentMetadata;

const MANUAL: ComponentMetadata = Components.find(
  (component: ComponentMetadata) => {
    return component.id === ComponentID.Manual;
  },
) as ComponentMetadata;

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

type MissingFunction = (args: JSONObject) => Array<string>;

// The settings the checks call required but empty, by name.
const missing: MissingFunction = (args: JSONObject): Array<string> => {
  const result: WorkflowLintResult = lintWorkflowGraph({
    nodes: [
      node("n1", MANUAL, "manual-1"),
      node("n2", IF_ELSE, "if-else-1", args),
    ],
    edges: [{ source: "n1", target: "n2" }],
  });

  return result.issues
    .filter((issue: WorkflowLintIssue) => {
      return issue.rule === WorkflowLintRule.MissingRequiredArgument;
    })
    .map((issue: WorkflowLintIssue) => {
      return issue.message;
    });
};

describe("an If / Else step's required settings", () => {
  test("a new one needs its value to check and what to compare with", () => {
    expect(missing({})).toEqual([
      '"Value to check" is required but empty.',
      '"Comparison" is required but empty.',
      '"Compare with" is required but empty.',
    ]);
  });

  test("is empty and is not empty need no Compare with", () => {
    for (const operator of ["is empty", "is not empty", " Is  Empty "]) {
      expect(
        missing({ "input-1": "{{local.variables.ENV}}", operator: operator }),
      ).toEqual([]);
    }
  });

  test("every other comparison does", () => {
    for (const operator of ["==", "!=", ">", "contains", "starts with"]) {
      expect(missing({ "input-1": "x", operator: operator })).toEqual([
        '"Compare with" is required but empty.',
      ]);
    }
  });

  test("is true and is false fill it in themselves", () => {
    expect(
      missing({
        "input-1": "x",
        operator: "==",
        "input-2": "true",
        "input-1-type": "boolean",
        "input-2-type": "boolean",
      }),
    ).toEqual([]);
  });

  test("the template's production check is complete", () => {
    expect(
      missing({
        "input-1-type": "text",
        "input-1": "{{local.components.manual-1.returnValues.value}}",
        operator: "==",
        "input-2-type": "text",
        "input-2": "production",
      }),
    ).toEqual([]);
  });
});

describe("isArgumentRequired", () => {
  const conditional: Argument = {
    id: "input-2",
    name: "Compare with",
    description: "",
    type: ComponentInputType.Text,
    required: true,
    notRequiredWhen: {
      argumentId: "operator",
      values: ["is empty", "is not empty"],
    },
  };

  test("an optional setting is never required", () => {
    expect(isArgumentRequired({ ...conditional, required: false }, {})).toBe(
      false,
    );
  });

  test("a required one without a rule always is", () => {
    const plain: Argument = { ...conditional };
    delete plain.notRequiredWhen;

    expect(isArgumentRequired(plain, { operator: "is empty" })).toBe(true);
  });

  test("the rule lifts it for the values it lists, however they are spaced or capitalised", () => {
    expect(isArgumentRequired(conditional, { operator: "is empty" })).toBe(
      false,
    );
    expect(isArgumentRequired(conditional, { operator: "IS NOT  EMPTY" })).toBe(
      false,
    );
    expect(isArgumentRequired(conditional, { operator: "==" })).toBe(true);
  });

  test("and nothing else does: no value, no settings, not text", () => {
    expect(isArgumentRequired(conditional, {})).toBe(true);
    expect(isArgumentRequired(conditional, undefined)).toBe(true);
    expect(isArgumentRequired(conditional, null)).toBe(true);
    expect(isArgumentRequired(conditional, { operator: true })).toBe(true);
  });

  test("If / Else's Compare with is the setting that uses it", () => {
    const withRule: Array<Argument> = Components.flatMap(
      (component: ComponentMetadata) => {
        return component.arguments.filter((argument: Argument) => {
          return Boolean(argument.notRequiredWhen);
        });
      },
    );

    expect(
      withRule.map((argument: Argument) => {
        return [argument.id, argument.notRequiredWhen];
      }),
    ).toEqual([
      [
        "input-2",
        { argumentId: "operator", values: ["is empty", "is not empty"] },
      ],
    ]);
  });
});
