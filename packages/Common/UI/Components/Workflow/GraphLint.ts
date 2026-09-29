/*
 * Static checks over a workflow graph, run in the builder as the user edits.
 *
 * Every rule here corresponds to a way the runner (App/FeatureSet/Workflow/
 * Services/RunWorkflow.ts) either throws at run time or — worse — carries on
 * quietly with the wrong value. The point is to move those failures from "3am,
 * in a log blob, after the trigger already fired" to "in the editor, before
 * you save".
 *
 * Rules only fire on things that are knowable from the graph alone. Anything
 * needing a network round trip (does this workflow variable exist?) is checked
 * for shape but not for existence, because a false positive here puts a red
 * badge on a workflow that runs perfectly.
 */

import Dictionary from "../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
  ReturnValue,
  isJSON5ToleratedInputType,
} from "../../../Types/Workflow/Component";
import {
  ParsedReferencePath,
  ReferenceRootType,
  TemplateExpression,
  TemplateExpressionKind,
  checkJSONSyntax,
  looksLikeReferencePath,
  parseReferencePath,
  parseTemplateExpressions,
} from "../../../Types/Workflow/TemplateSyntax";

export enum WorkflowLintSeverity {
  /** The workflow will fail, or silently do the wrong thing, as written. */
  Error = "Error",
  /** Suspicious but survivable — e.g. a step that can never be reached. */
  Warning = "Warning",
}

export enum WorkflowLintRule {
  MissingRequiredArgument = "MissingRequiredArgument",
  InvalidJSON = "InvalidJSON",
  ReferenceHasWhitespace = "ReferenceHasWhitespace",
  UnknownReferenceRoot = "UnknownReferenceRoot",
  UnknownReferencedComponent = "UnknownReferencedComponent",
  UnknownReferencedReturnValue = "UnknownReferencedReturnValue",
  SelfReference = "SelfReference",
  ForwardReference = "ForwardReference",
  ReferenceToUnreachableComponent = "ReferenceToUnreachableComponent",
  DuplicateComponentId = "DuplicateComponentId",
  ComponentIdContainsDot = "ComponentIdContainsDot",
  UnreachableComponent = "UnreachableComponent",
  NoTrigger = "NoTrigger",
}

export interface WorkflowLintIssue {
  rule: WorkflowLintRule;
  severity: WorkflowLintSeverity;
  /** The react-flow node id, or null when the issue is about the graph itself. */
  nodeId: string | null;
  /** The step's user-facing id ("api-get-1"), when the issue belongs to a step. */
  componentId: string | null;
  /** The argument the issue is about, when it is about one. */
  argumentId: string | null;
  /** Shown to the builder, verbatim. */
  message: string;
}

export interface WorkflowLintResult {
  issues: Array<WorkflowLintIssue>;
  /**
   * One combined message per react-flow node id, ready to drop into
   * NodeDataProp.error so the canvas shows its (already implemented, until now
   * never populated) red badge.
   */
  errorsByNodeId: Dictionary<string>;
  errorCount: number;
  warningCount: number;
}

/** Minimal structural view of a react-flow node — keeps this file testable. */
export interface LintGraphNode {
  id: string;
  data: NodeDataProp;
}

/** Minimal structural view of a react-flow edge. */
export interface LintGraphEdge {
  source: string;
  target: string;
}

/*
 * Argument types the builder stores as a JSON document in a code editor. A
 * malformed one throws in RunWorkflow.getComponentArguments (for JSON / Query /
 * Select) or in the component itself (JSONFunctions.parse in
 * CreateOneBaseModel, ApiComponentUtils.sanitizeArgs, and friends), so all of
 * them are worth checking up front.
 */
const JSON_DOCUMENT_INPUT_TYPES: Array<ComponentInputType> = [
  ComponentInputType.JSON,
  ComponentInputType.JSONArray,
  ComponentInputType.Query,
  ComponentInputType.Select,
  ComponentInputType.BaseModel,
  ComponentInputType.BaseModelArray,
  ComponentInputType.StringDictionary,
];

type IsEmptyArgumentValueFunction = (
  value: JSONValue | undefined,
  type?: ComponentInputType | undefined,
) => boolean;

/*
 * `false` and `0` are values a builder deliberately set — only absence and the
 * empty box count as missing. An empty object/array counts as missing too: the
 * Dictionary editor writes `{}` for a field nobody filled in.
 *
 * For a JSON-document argument the value arrives as *text*, so the literal
 * "{}" has to be recognised as the same emptiness. It reads as a filled-in
 * field otherwise, and on Delete Many an empty query is not a harmless no-op:
 * it matches every record in the project and the component deletes the first
 * ten of them. A required argument holding "{}" should be reported, not run.
 */
export const isEmptyArgumentValue: IsEmptyArgumentValueFunction = (
  value: JSONValue | undefined,
  type?: ComponentInputType | undefined,
): boolean => {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    const trimmed: string = value.trim();

    if (trimmed === "") {
      return true;
    }

    if (type && JSON_DOCUMENT_INPUT_TYPES.includes(type)) {
      /*
       * Only a literal empty document counts. Anything that fails to parse is
       * left alone — it is reported as invalid JSON a few lines further down,
       * which is a better message than "this is required".
       */
      try {
        const parsed: unknown = JSON.parse(trimmed);

        if (Array.isArray(parsed)) {
          return parsed.length === 0;
        }

        if (parsed && typeof parsed === "object") {
          return Object.keys(parsed as JSONObject).length === 0;
        }
      } catch {
        return false;
      }
    }

    return false;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "object") {
    return Object.keys(value as JSONObject).length === 0;
  }

  return false;
};

type IsRealNodeFunction = (node: LintGraphNode) => boolean;

const isRealNode: IsRealNodeFunction = (node: LintGraphNode): boolean => {
  return Boolean(
    node.data &&
      node.data.nodeType !== NodeType.PlaceholderNode &&
      node.data.metadata,
  );
};

type BuildReachableSetFunction = (
  startNodeIds: Array<string>,
  adjacency: Dictionary<Array<string>>,
) => Set<string>;

/** Every node id reachable by following edges forward from `startNodeIds`. */
const buildReachableSet: BuildReachableSetFunction = (
  startNodeIds: Array<string>,
  adjacency: Dictionary<Array<string>>,
): Set<string> => {
  const reachable: Set<string> = new Set<string>();
  const queue: Array<string> = [...startNodeIds];

  while (queue.length > 0) {
    const current: string = queue.shift() as string;

    if (reachable.has(current)) {
      continue;
    }

    reachable.add(current);

    for (const next of adjacency[current] || []) {
      if (!reachable.has(next)) {
        queue.push(next);
      }
    }
  }

  return reachable;
};

type CollectArgumentStringsFunction = (value: JSONValue) => Array<string>;

/*
 * A reference can hide anywhere a string can: the Dictionary editor stores an
 * object whose values are strings, and imported graphs can hold arrays. Walk
 * the whole value so {{...}} inside a header value is linted too.
 */
const collectArgumentStrings: CollectArgumentStringsFunction = (
  value: JSONValue,
): Array<string> => {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item: JSONValue) => {
      return collectArgumentStrings(item);
    });
  }

  if (value && typeof value === "object") {
    return Object.values(value as JSONObject).flatMap((item: JSONValue) => {
      return collectArgumentStrings(item as JSONValue);
    });
  }

  return [];
};

export type LintWorkflowGraphFunction = (graph: {
  nodes: Array<LintGraphNode>;
  edges: Array<LintGraphEdge>;
}) => WorkflowLintResult;

/**
 * Check a workflow graph and report everything wrong with it.
 */
export const lintWorkflowGraph: LintWorkflowGraphFunction = (graph: {
  nodes: Array<LintGraphNode>;
  edges: Array<LintGraphEdge>;
}): WorkflowLintResult => {
  const issues: Array<WorkflowLintIssue> = [];
  const nodes: Array<LintGraphNode> = (graph.nodes || []).filter(isRealNode);
  const edges: Array<LintGraphEdge> = graph.edges || [];

  type AddIssueFunction = (issue: WorkflowLintIssue) => void;

  const addIssue: AddIssueFunction = (issue: WorkflowLintIssue): void => {
    issues.push(issue);
  };

  /* ---- indexes ---------------------------------------------------------- */

  // The runner keys its storage map on node.data.id, not the react-flow id.
  const nodesByComponentId: Dictionary<LintGraphNode> = {};
  const componentIdCounts: Dictionary<number> = {};

  for (const node of nodes) {
    const componentId: string = node.data.id;

    if (!componentId) {
      continue;
    }

    componentIdCounts[componentId] = (componentIdCounts[componentId] || 0) + 1;

    if (!nodesByComponentId[componentId]) {
      nodesByComponentId[componentId] = node;
    }
  }

  const adjacency: Dictionary<Array<string>> = {};

  for (const edge of edges) {
    if (!adjacency[edge.source]) {
      adjacency[edge.source] = [];
    }
    adjacency[edge.source]?.push(edge.target);
  }

  const triggerNodes: Array<LintGraphNode> = nodes.filter(
    (node: LintGraphNode) => {
      return node.data.componentType === ComponentType.Trigger;
    },
  );

  const reachableFromTrigger: Set<string> = buildReachableSet(
    triggerNodes.map((node: LintGraphNode) => {
      return node.id;
    }),
    adjacency,
  );

  /*
   * Strict descendants of a node, computed at most once per node — the
   * reference rules ask for this per argument, and recomputing a traversal
   * inside that loop makes linting quadratic on graphs that are already wide.
   */
  const descendantCache: Dictionary<Set<string>> = {};

  type GetDescendantsFunction = (nodeId: string) => Set<string>;

  const getDescendants: GetDescendantsFunction = (
    nodeId: string,
  ): Set<string> => {
    let descendants: Set<string> | undefined = descendantCache[nodeId];

    if (!descendants) {
      descendants = buildReachableSet(adjacency[nodeId] || [], adjacency);
      descendantCache[nodeId] = descendants;
    }

    return descendants;
  };

  /* ---- graph-wide rules -------------------------------------------------- */

  if (nodes.length > 0 && triggerNodes.length === 0) {
    addIssue({
      rule: WorkflowLintRule.NoTrigger,
      severity: WorkflowLintSeverity.Error,
      nodeId: null,
      componentId: null,
      argumentId: null,
      message:
        "This workflow has no trigger, so it can never start. Add a trigger and connect it to the first step.",
    });
  }

  /* ---- per-node rules ---------------------------------------------------- */

  for (const node of nodes) {
    const data: NodeDataProp = node.data;
    const componentId: string = data.id;
    const argumentValues: JSONObject = (data.arguments as JSONObject) || {};

    type AddNodeIssueFunction = (params: {
      rule: WorkflowLintRule;
      severity: WorkflowLintSeverity;
      argumentId?: string | undefined;
      message: string;
    }) => void;

    const addNodeIssue: AddNodeIssueFunction = (params: {
      rule: WorkflowLintRule;
      severity: WorkflowLintSeverity;
      argumentId?: string | undefined;
      message: string;
    }): void => {
      addIssue({
        rule: params.rule,
        severity: params.severity,
        nodeId: node.id,
        componentId: componentId || null,
        argumentId: params.argumentId || null,
        message: params.message,
      });
    };

    // -- identity ---------------------------------------------------------

    if (componentId && (componentIdCounts[componentId] || 0) > 1) {
      addNodeIssue({
        rule: WorkflowLintRule.DuplicateComponentId,
        severity: WorkflowLintSeverity.Error,
        message: `More than one step has the id "${componentId}". Ids must be unique — otherwise the steps overwrite each other's results and any reference to "${componentId}" is ambiguous.`,
      });
    }

    if (componentId && componentId.includes(".")) {
      addNodeIssue({
        rule: WorkflowLintRule.ComponentIdContainsDot,
        severity: WorkflowLintSeverity.Error,
        message: `The id "${componentId}" contains a dot. References are split on dots, so no other step can read this one's results. Use dashes instead.`,
      });
    }

    // -- reachability ------------------------------------------------------

    if (
      data.componentType !== ComponentType.Trigger &&
      triggerNodes.length > 0 &&
      !reachableFromTrigger.has(node.id)
    ) {
      addNodeIssue({
        rule: WorkflowLintRule.UnreachableComponent,
        severity: WorkflowLintSeverity.Warning,
        message:
          "Nothing connects to this step from the trigger, so it will never run.",
      });
    }

    // -- arguments ---------------------------------------------------------

    const argumentMetadata: Array<Argument> = data.metadata.arguments || [];

    for (const argument of argumentMetadata) {
      const value: JSONValue | undefined = argumentValues[argument.id];

      if (argument.required && isEmptyArgumentValue(value, argument.type)) {
        addNodeIssue({
          rule: WorkflowLintRule.MissingRequiredArgument,
          severity: WorkflowLintSeverity.Error,
          argumentId: argument.id,
          message: `"${argument.name}" is required but empty.`,
        });
        continue;
      }

      if (isEmptyArgumentValue(value, argument.type)) {
        continue;
      }

      if (JSON_DOCUMENT_INPUT_TYPES.includes(argument.type)) {
        const jsonCheck: {
          isValid: boolean;
          errorMessage: string | null;
        } = checkJSONSyntax(value, {
          allowJSON5: isJSON5ToleratedInputType(argument.type),
        });

        if (!jsonCheck.isValid) {
          addNodeIssue({
            rule: WorkflowLintRule.InvalidJSON,
            severity: WorkflowLintSeverity.Error,
            argumentId: argument.id,
            message: `"${argument.name}" is not valid JSON. ${jsonCheck.errorMessage}`,
          });
        }
      }

      // -- references ------------------------------------------------------

      for (const text of collectArgumentStrings(value as JSONValue)) {
        const expressions: Array<TemplateExpression> =
          parseTemplateExpressions(text);

        for (const expression of expressions) {
          if (expression.kind !== TemplateExpressionKind.Reference) {
            continue;
          }

          /*
           * Inside a loop, VMAPI resolves against the current array element
           * before the storage map, so a bare {{status}} is correct there and
           * cannot be checked from here.
           */
          if (expression.isInsideEachBlock) {
            continue;
          }

          /*
           * At the top level the runtime looks the path up exactly as written
           * (VMAPI.replaceValueInPlace passes the raw capture to deepFind), so
           * a stray space makes the reference resolve to nothing and the braces
           * are shipped as literal text. Nothing about the rendered workflow
           * hints at it, which makes this worth its own message rather than
           * folding it into "unknown reference".
           */
          /*
           * Every argument is templated, including the JavaScript component's
           * source, and JavaScript can legitimately produce a {{...}} match on
           * one line. Only complain about captures that were plausibly meant
           * to be references.
           */
          if (!looksLikeReferencePath(expression.innerRaw)) {
            continue;
          }

          if (expression.innerRaw !== expression.inner) {
            addNodeIssue({
              rule: WorkflowLintRule.ReferenceHasWhitespace,
              severity: WorkflowLintSeverity.Error,
              argumentId: argument.id,
              message: `"${argument.name}" contains ${expression.raw}, which has a space inside the braces. Spaces are not trimmed here, so this resolves to nothing — write it as {{${expression.inner}}}.`,
            });
            continue;
          }

          const parsed: ParsedReferencePath = parseReferencePath(
            expression.inner,
          );

          if (parsed.rootType === ReferenceRootType.Unknown) {
            addNodeIssue({
              rule: WorkflowLintRule.UnknownReferenceRoot,
              severity: WorkflowLintSeverity.Error,
              argumentId: argument.id,
              message: `"${argument.name}" refers to ${expression.raw}, but ${parsed.reason}. Nothing will be substituted and the text will be sent as-is.`,
            });
            continue;
          }

          if (parsed.rootType !== ReferenceRootType.ComponentReturnValue) {
            // A variable reference — well-formed. Existence needs the API.
            continue;
          }

          const referencedComponentId: string = parsed.componentId as string;
          const referencedNode: LintGraphNode | undefined =
            nodesByComponentId[referencedComponentId];

          if (!referencedNode) {
            addNodeIssue({
              rule: WorkflowLintRule.UnknownReferencedComponent,
              severity: WorkflowLintSeverity.Error,
              argumentId: argument.id,
              message: `"${argument.name}" refers to a step called "${referencedComponentId}", but no step in this workflow has that id.`,
            });
            continue;
          }

          const returnValueId: string = parsed.returnValueId as string;
          const returnValues: Array<ReturnValue> =
            referencedNode.data.metadata.returnValues || [];

          const hasReturnValue: boolean = returnValues.some(
            (returnValue: ReturnValue) => {
              return returnValue.id === returnValueId;
            },
          );

          if (!hasReturnValue) {
            addNodeIssue({
              rule: WorkflowLintRule.UnknownReferencedReturnValue,
              severity: WorkflowLintSeverity.Error,
              argumentId: argument.id,
              message: `"${argument.name}" reads "${returnValueId}" from step "${referencedComponentId}", but that step does not return anything by that name.`,
            });
            continue;
          }

          if (referencedNode.id === node.id) {
            addNodeIssue({
              rule: WorkflowLintRule.SelfReference,
              severity: WorkflowLintSeverity.Error,
              argumentId: argument.id,
              message: `"${argument.name}" refers to this step's own results, which do not exist yet while its settings are being read.`,
            });
            continue;
          }

          /*
           * A step that is downstream of this one has definitively not run
           * when this step's arguments are resolved, so the reference is
           * always empty. (The converse is not true — the runner's queue is
           * FIFO across branches, so a step on a parallel branch may well have
           * run. Only the unambiguous direction is reported.)
           */
          if (getDescendants(node.id).has(referencedNode.id)) {
            addNodeIssue({
              rule: WorkflowLintRule.ForwardReference,
              severity: WorkflowLintSeverity.Error,
              argumentId: argument.id,
              message: `"${argument.name}" reads results from "${referencedComponentId}", but that step runs after this one, so it has no results yet.`,
            });
            continue;
          }

          if (
            triggerNodes.length > 0 &&
            !reachableFromTrigger.has(referencedNode.id)
          ) {
            addNodeIssue({
              rule: WorkflowLintRule.ReferenceToUnreachableComponent,
              severity: WorkflowLintSeverity.Warning,
              argumentId: argument.id,
              message: `"${argument.name}" reads results from "${referencedComponentId}", which is not connected to the trigger and so never runs.`,
            });
          }
        }
      }
    }
  }

  /* ---- roll up ----------------------------------------------------------- */

  const errorsByNodeId: Dictionary<string> = {};
  let errorCount: number = 0;
  let warningCount: number = 0;

  for (const issue of issues) {
    if (issue.severity === WorkflowLintSeverity.Error) {
      errorCount++;
    } else {
      warningCount++;
    }

    if (!issue.nodeId) {
      continue;
    }

    errorsByNodeId[issue.nodeId] = errorsByNodeId[issue.nodeId]
      ? `${errorsByNodeId[issue.nodeId]}\n${issue.message}`
      : issue.message;
  }

  return {
    issues: issues,
    errorsByNodeId: errorsByNodeId,
    errorCount: errorCount,
    warningCount: warningCount,
  };
};

export default lintWorkflowGraph;
