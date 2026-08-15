/*
 * How the builder presents what GraphLint found.
 *
 * GraphLint reports one issue per problem, which is right for a checker and
 * wrong for a panel: a step with three empty required fields produces three
 * issues, and rendering them flat gives three cards that happen to repeat the
 * same step id. Everything here is about arranging that list instead —
 * counting it, naming the step each issue belongs to, and folding one step's
 * issues into a single group the builder can act on.
 *
 * The other half of the panel — taking the builder to the step a group is
 * about — needs to look a node up by id, so that lives here too.
 *
 * Kept apart from the components that render it so all of it is testable
 * without a DOM.
 */

import Dictionary from "../../../Types/Dictionary";
import { NodeType } from "../../../Types/Workflow/Component";
import { WorkflowLintIssue, WorkflowLintSeverity } from "./GraphLint";

/** The part of a lint result a summary is built from. */
export interface WorkflowLintCounts {
  errorCount: number;
  warningCount: number;
}

/**
 * What the graph looks like overall. Drives one colour choice in the toolbar,
 * so it is deliberately three states rather than a count.
 */
export enum WorkflowLintTone {
  /** Nothing to report. */
  Clean = "Clean",
  /** Only warnings — the workflow runs, but probably not as intended. */
  Warning = "Warning",
  /** At least one error — the workflow fails, or does the wrong thing. */
  Error = "Error",
}

/** Issues about the graph itself rather than any one step. */
export const WORKFLOW_ISSUE_GRAPH_GROUP_KEY: string = "__workflow__";
export const WORKFLOW_ISSUE_GRAPH_GROUP_TITLE: string = "This workflow";

/** A step that has issues but no title and no id to show for itself. */
export const WORKFLOW_ISSUE_UNTITLED_STEP_TITLE: string = "Untitled step";

/** Every issue that belongs to one step (or to the graph), shown as one card. */
export interface WorkflowIssueGroup {
  /** Stable react key. */
  key: string;
  /** The react-flow node id, or null for issues about the graph itself. */
  nodeId: string | null;
  /** The step id the builder typed ("api-get-1"), when there is one. */
  componentId: string | null;
  /** Heading for the group — the step's title, falling back to its id. */
  title: string;
  issues: Array<WorkflowLintIssue>;
  errorCount: number;
  warningCount: number;
}

type PluraliseFunction = (count: number, singular: string) => string;

const pluralise: PluraliseFunction = (
  count: number,
  singular: string,
): string => {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
};

export type GetWorkflowLintCountTextFunction = (
  counts: WorkflowLintCounts,
) => string;

/**
 * "1 error, 2 warnings" — empty when there is nothing to report.
 *
 * Errors are called errors rather than "problems" because the panel these
 * counts label is titled "Problems", and having "problems" also mean
 * specifically-the-errors inside it left the two counts reading as subsets of
 * each other.
 */
export const getWorkflowLintCountText: GetWorkflowLintCountTextFunction = (
  counts: WorkflowLintCounts,
): string => {
  const parts: Array<string> = [];

  if (counts.errorCount > 0) {
    parts.push(pluralise(counts.errorCount, "error"));
  }

  if (counts.warningCount > 0) {
    parts.push(pluralise(counts.warningCount, "warning"));
  }

  return parts.join(", ");
};

export type GetWorkflowLintToneFunction = (
  counts: WorkflowLintCounts,
) => WorkflowLintTone;

export const getWorkflowLintTone: GetWorkflowLintToneFunction = (
  counts: WorkflowLintCounts,
): WorkflowLintTone => {
  if (counts.errorCount > 0) {
    return WorkflowLintTone.Error;
  }

  if (counts.warningCount > 0) {
    return WorkflowLintTone.Warning;
  }

  return WorkflowLintTone.Clean;
};

export type GetWorkflowLintSeverityLabelFunction = (
  severity: WorkflowLintSeverity,
) => string;

/** The word for a severity — the panel says it out loud rather than only colouring it. */
export const getWorkflowLintSeverityLabel: GetWorkflowLintSeverityLabelFunction =
  (severity: WorkflowLintSeverity): string => {
    return severity === WorkflowLintSeverity.Error ? "Error" : "Warning";
  };

/** The shape of a graph node this module needs — keeps react-flow out of here. */
export interface TitledGraphNode {
  id: string;
  data?:
    | {
        metadata?: { title?: string | undefined } | undefined;
      }
    | undefined;
}

export type BuildStepTitlesByNodeIdFunction = (
  nodes: Array<TitledGraphNode>,
) => Dictionary<string>;

/**
 * Step titles keyed by react-flow node id, so the issues panel can name a step
 * the way the canvas does rather than only by the id the builder typed.
 */
export const buildStepTitlesByNodeId: BuildStepTitlesByNodeIdFunction = (
  nodes: Array<TitledGraphNode>,
): Dictionary<string> => {
  const titles: Dictionary<string> = {};

  for (const node of nodes || []) {
    if (!node || !node.id) {
      continue;
    }

    const title: string | undefined = node.data?.metadata?.title;

    if (title && title.trim()) {
      titles[node.id] = title.trim();
    }
  }

  return titles;
};

/** The shape of a graph node the "open this step" lookup needs. */
export interface OpenableGraphNode {
  id: string;
  data?: { nodeType?: NodeType | undefined } | undefined;
}

export type FindStepNodeToOpenFunction = <T extends OpenableGraphNode>(params: {
  nodes: Array<T>;
  nodeId: string | null | undefined;
}) => T | null;

/**
 * The node a "go to this step" request means, or null when there is nothing to
 * open.
 *
 * A request can name a node that has since been deleted — the panel is a
 * snapshot of what the checks last said, and the graph carries on being
 * edited underneath it. A placeholder is not a step either: it is the empty
 * slot where a trigger goes, and it has no settings.
 */
export const findStepNodeToOpen: FindStepNodeToOpenFunction = <
  T extends OpenableGraphNode,
>(params: {
  nodes: Array<T>;
  nodeId: string | null | undefined;
}): T | null => {
  if (!params.nodeId) {
    return null;
  }

  const node: T | undefined = (params.nodes || []).find((node: T) => {
    return node && node.id === params.nodeId;
  });

  if (!node || node.data?.nodeType === NodeType.PlaceholderNode) {
    return null;
  }

  return node;
};

type GetGroupKeyFunction = (issue: WorkflowLintIssue) => string;

const getGroupKey: GetGroupKeyFunction = (issue: WorkflowLintIssue): string => {
  if (issue.nodeId) {
    return `node:${issue.nodeId}`;
  }

  /*
   * A graph-wide issue has no node. Anything that somehow names a step without
   * naming its node still groups with that step rather than with the graph.
   */
  if (issue.componentId) {
    return `component:${issue.componentId}`;
  }

  return WORKFLOW_ISSUE_GRAPH_GROUP_KEY;
};

type GetGroupTitleFunction = (params: {
  issue: WorkflowLintIssue;
  stepTitlesByNodeId: Dictionary<string>;
}) => string;

const getGroupTitle: GetGroupTitleFunction = (params: {
  issue: WorkflowLintIssue;
  stepTitlesByNodeId: Dictionary<string>;
}): string => {
  const { issue, stepTitlesByNodeId } = params;

  if (!issue.nodeId && !issue.componentId) {
    return WORKFLOW_ISSUE_GRAPH_GROUP_TITLE;
  }

  const titleFromGraph: string | undefined = issue.nodeId
    ? stepTitlesByNodeId[issue.nodeId]
    : undefined;

  return (
    titleFromGraph || issue.componentId || WORKFLOW_ISSUE_UNTITLED_STEP_TITLE
  );
};

export type GroupWorkflowLintIssuesFunction = (params: {
  issues: Array<WorkflowLintIssue>;
  stepTitlesByNodeId?: Dictionary<string> | undefined;
}) => Array<WorkflowIssueGroup>;

/**
 * One group per step, errors first, and the graph's own issues at the top.
 *
 * Identical messages inside a group are dropped: two rules can land on the
 * same wording for the same step, and a panel that says the same sentence
 * twice reads as a rendering bug rather than as two findings.
 */
export const groupWorkflowLintIssues: GroupWorkflowLintIssuesFunction =
  (params: {
    issues: Array<WorkflowLintIssue>;
    stepTitlesByNodeId?: Dictionary<string> | undefined;
  }): Array<WorkflowIssueGroup> => {
    const stepTitlesByNodeId: Dictionary<string> =
      params.stepTitlesByNodeId || {};
    const groupsByKey: Dictionary<WorkflowIssueGroup> = {};
    const orderedKeys: Array<string> = [];
    const seenMessagesByKey: Dictionary<Set<string>> = {};

    for (const issue of params.issues || []) {
      if (!issue) {
        continue;
      }

      const key: string = getGroupKey(issue);

      let group: WorkflowIssueGroup | undefined = groupsByKey[key];

      if (!group) {
        group = {
          key: key,
          nodeId: issue.nodeId,
          componentId: issue.componentId,
          title: getGroupTitle({
            issue: issue,
            stepTitlesByNodeId: stepTitlesByNodeId,
          }),
          issues: [],
          errorCount: 0,
          warningCount: 0,
        };

        groupsByKey[key] = group;
        seenMessagesByKey[key] = new Set<string>();
        orderedKeys.push(key);
      }

      const seenMessages: Set<string> = seenMessagesByKey[key] as Set<string>;
      const messageKey: string = `${issue.severity}|${issue.message}`;

      if (seenMessages.has(messageKey)) {
        continue;
      }

      seenMessages.add(messageKey);
      group.issues.push(issue);

      if (issue.severity === WorkflowLintSeverity.Error) {
        group.errorCount++;
      } else {
        group.warningCount++;
      }
    }

    const groups: Array<WorkflowIssueGroup> = orderedKeys
      .map((key: string, index: number) => {
        const group: WorkflowIssueGroup = groupsByKey[
          key
        ] as WorkflowIssueGroup;

        /*
         * Errors first inside a group: they are what stops the workflow, and a
         * warning read first sets the wrong expectation about the rest.
         * `index` keeps the sort stable across engines that do not guarantee it.
         */
        group.issues = group.issues
          .map((issue: WorkflowLintIssue, issueIndex: number) => {
            return { issue: issue, issueIndex: issueIndex };
          })
          .sort(
            (
              a: { issue: WorkflowLintIssue; issueIndex: number },
              b: { issue: WorkflowLintIssue; issueIndex: number },
            ) => {
              const aIsError: number =
                a.issue.severity === WorkflowLintSeverity.Error ? 0 : 1;
              const bIsError: number =
                b.issue.severity === WorkflowLintSeverity.Error ? 0 : 1;

              if (aIsError !== bIsError) {
                return aIsError - bIsError;
              }

              return a.issueIndex - b.issueIndex;
            },
          )
          .map((entry: { issue: WorkflowLintIssue; issueIndex: number }) => {
            return entry.issue;
          });

        return { group: group, index: index };
      })
      .sort(
        (
          a: { group: WorkflowIssueGroup; index: number },
          b: { group: WorkflowIssueGroup; index: number },
        ) => {
          /*
           * "This workflow has no trigger" is about the thing every step hangs
           * off, so the graph's own issues lead regardless of what else is wrong.
           */
          const aIsGraph: number =
            a.group.key === WORKFLOW_ISSUE_GRAPH_GROUP_KEY ? 0 : 1;
          const bIsGraph: number =
            b.group.key === WORKFLOW_ISSUE_GRAPH_GROUP_KEY ? 0 : 1;

          if (aIsGraph !== bIsGraph) {
            return aIsGraph - bIsGraph;
          }

          const aHasErrors: number = a.group.errorCount > 0 ? 0 : 1;
          const bHasErrors: number = b.group.errorCount > 0 ? 0 : 1;

          if (aHasErrors !== bHasErrors) {
            return aHasErrors - bHasErrors;
          }

          return a.index - b.index;
        },
      )
      .map((entry: { group: WorkflowIssueGroup; index: number }) => {
        return entry.group;
      });

    return groups;
  };

export default groupWorkflowLintIssues;
