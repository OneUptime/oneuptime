/*
 * Everything the static checks found, arranged so it can be fixed.
 *
 * The list used to be one card per issue, each headed by the step id in caps,
 * so a step with two problems announced itself twice and a workflow with six
 * looked like six unrelated failures. Here the issues belong to the step they
 * are about: one card per step, headed by the step's name, with a button that
 * takes the builder to it. The panel says "fixing them here saves a failed run
 * later" — this is the part that makes "here" mean something.
 */

import Icon, { SizeProp } from "../Icon/Icon";
import Modal, { ModalWidth } from "../Modal/Modal";
import IconProp from "../../../Types/Icon/IconProp";
import Dictionary from "../../../Types/Dictionary";
import {
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintSeverity,
} from "./GraphLint";
import {
  WorkflowIssueGroup,
  getWorkflowLintSeverityLabel,
  groupWorkflowLintIssues,
} from "./GraphLintSummary";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  lintResult: WorkflowLintResult;
  /**
   * Step titles by react-flow node id, so a group is headed the way the canvas
   * heads the node rather than only by the id the builder typed.
   */
  stepTitlesByNodeId?: Dictionary<string> | undefined;
  onClose: () => void;
  /**
   * Opens a step's settings. Without it the groups have no action and the
   * panel is read-only, which is what happens for issues about the graph
   * itself — there is no step to open.
   */
  onGoToStep?: ((nodeId: string) => void) | undefined;
}

type RenderSeverityIconFunction = (
  severity: WorkflowLintSeverity,
) => ReactElement;

const renderSeverityIcon: RenderSeverityIconFunction = (
  severity: WorkflowLintSeverity,
): ReactElement => {
  const isError: boolean = severity === WorkflowLintSeverity.Error;

  return (
    <span
      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
        isError ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
      }`}
      data-testid={
        isError ? "workflow-issue-error-icon" : "workflow-issue-warning-icon"
      }
    >
      <Icon
        icon={isError ? IconProp.Close : IconProp.Alert}
        size={SizeProp.ExtraSmall}
        className="h-2.5 w-2.5"
      />
    </span>
  );
};

type RenderCountPillFunction = (params: {
  count: number;
  singular: string;
  className: string;
  testId: string;
}) => ReactElement | null;

const renderCountPill: RenderCountPillFunction = (params: {
  count: number;
  singular: string;
  className: string;
  testId: string;
}): ReactElement | null => {
  if (params.count <= 0) {
    return null;
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-4 whitespace-nowrap ${params.className}`}
      data-testid={params.testId}
    >
      {params.count} {params.singular}
      {params.count === 1 ? "" : "s"}
    </span>
  );
};

const WorkflowIssuesModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
    issues: props.lintResult.issues,
    stepTitlesByNodeId: props.stepTitlesByNodeId,
  });

  return (
    <Modal
      title="Problems with this workflow"
      description="These are found by reading the workflow. Fixing them here saves a failed run later."
      modalWidth={ModalWidth.Medium}
      closeButtonText="Close"
      onClose={props.onClose}
    >
      <div className="space-y-3" data-testid="workflow-issues">
        {groups.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center"
            data-testid="workflow-issues-empty"
          >
            <Icon
              icon={IconProp.CheckCircle}
              className="h-6 w-6 text-emerald-500"
            />
            <p className="text-sm font-medium text-gray-900">
              Nothing to fix here
            </p>
            <p className="text-sm text-gray-500">
              The checks found nothing wrong with this workflow.
            </p>
          </div>
        ) : (
          <>
            {/*
              A running total up front: the groups below say what is wrong with
              each step, and this says how much of it there is in total.
            */}
            <div
              className="flex flex-wrap items-center gap-2"
              data-testid="workflow-issues-summary"
            >
              {renderCountPill({
                count: props.lintResult.errorCount,
                singular: "error",
                className:
                  "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
                testId: "workflow-issues-error-count",
              })}
              {renderCountPill({
                count: props.lintResult.warningCount,
                singular: "warning",
                className:
                  "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
                testId: "workflow-issues-warning-count",
              })}
              <span className="text-xs text-gray-500">
                across{" "}
                {groups.length === 1 ? "1 place" : `${groups.length} places`}
              </span>
            </div>

            {groups.map((group: WorkflowIssueGroup): ReactElement => {
              const canGoToStep: boolean = Boolean(
                props.onGoToStep && group.nodeId,
              );

              return (
                <section
                  key={group.key}
                  className="overflow-hidden rounded-lg border border-gray-200"
                  data-testid="workflow-issue-group"
                >
                  <header className="flex items-start justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {group.title}
                      </p>
                      {group.componentId &&
                        group.componentId !== group.title && (
                          <p className="truncate font-mono text-xs text-gray-500">
                            {group.componentId}
                          </p>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {renderCountPill({
                        count: group.errorCount,
                        singular: "error",
                        className:
                          "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
                        testId: "workflow-issue-group-error-count",
                      })}
                      {renderCountPill({
                        count: group.warningCount,
                        singular: "warning",
                        className:
                          "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
                        testId: "workflow-issue-group-warning-count",
                      })}
                      {canGoToStep && (
                        <button
                          type="button"
                          onClick={() => {
                            props.onGoToStep?.(group.nodeId as string);
                          }}
                          aria-label={`Open settings for ${group.title}`}
                          data-testid="workflow-issue-go-to-step"
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
                        >
                          Open step
                          <Icon
                            icon={IconProp.ChevronRight}
                            size={SizeProp.ExtraSmall}
                            className="h-3 w-3"
                          />
                        </button>
                      )}
                    </div>
                  </header>

                  <ul className="divide-y divide-gray-100">
                    {group.issues.map(
                      (
                        issue: WorkflowLintIssue,
                        index: number,
                      ): ReactElement => {
                        return (
                          <li
                            key={`${issue.rule}-${index}`}
                            className="flex items-start gap-2.5 px-3 py-2.5"
                            data-testid="workflow-issue"
                          >
                            {renderSeverityIcon(issue.severity)}
                            <p className="text-sm leading-5 text-gray-700">
                              <span className="sr-only">
                                {getWorkflowLintSeverityLabel(issue.severity)}:{" "}
                              </span>
                              {issue.message}
                            </p>
                          </li>
                        );
                      },
                    )}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>
    </Modal>
  );
};

export default WorkflowIssuesModal;
