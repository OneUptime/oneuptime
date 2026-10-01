/*
 * One run of a workflow, shown in one place.
 *
 * A run answers two different questions and they want different shapes. "Which
 * steps ran, what did each receive and return" is structure, and reads as a
 * list. "What did the runner actually print" is a log, and reads as lines. They
 * used to be stacked in the same modal, which meant the log was always pushed
 * below a step list of unknown length and neither got the height it wanted.
 * Tabs give each the whole body.
 *
 * The modal is presentational: whoever opens it owns the data. That is what
 * lets the builder point it at a run it is still polling while the Logs table
 * points it at a finished one.
 */

import { ButtonStyleType } from "../Button/Button";
import Modal, { ModalWidth } from "../Modal/Modal";
import SimpleLogViewer from "../SimpleLogViewer/SimpleLogViewer";
import { Tab, TabType } from "../Tabs/Tab";
import Tabs from "../Tabs/Tabs";
import StepTraceViewer from "./StepTraceViewer";
import {
  TraceAttention,
  getTraceAttention,
  getTraceSteps,
} from "./StepTracePresentation";
import {
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
} from "../../../Types/Workflow/StepTrace";
import React, { FunctionComponent, ReactElement } from "react";

export const STEPS_TAB_NAME: string = "Steps";
export const FULL_LOG_TAB_NAME: string = "Full Log";

export interface ComponentProps {
  logs: string;
  stepTrace: WorkflowStepTrace;
  onClose: () => void;
  title?: string | undefined;
  description?: string | undefined;
  /**
   * A line about the run itself — "Run running…", "Run finished successfully".
   * Shown above the tabs so it is visible whichever tab is open.
   */
  statusMessage?: string | null | undefined;
  /** Colours the status line as a failure. */
  isStatusMessageError?: boolean | undefined;
  /** The run is still being followed, so what is on screen is not final. */
  isRunning?: boolean | undefined;
  initialTabName?: string | undefined;
  /**
   * Actions on the run as a whole (downloading it, say). They sit at the end
   * of the status line, above the tabs, so they apply to either tab and stay
   * put when the reader switches between them.
   */
  toolbar?: ReactElement | undefined;
}

/*
 * The Steps tab's count takes the colour of the worst thing in the run, so a
 * failed step or a warning shows before the tab is even open.
 */
const TAB_TYPE_BY_ATTENTION: Record<TraceAttention, TabType> = {
  [TraceAttention.Error]: TabType.Error,
  [TraceAttention.Warning]: TabType.Warning,
  [TraceAttention.None]: TabType.Info,
};

const WorkflowLogModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const steps: Array<WorkflowStepTraceEntry> = getTraceSteps(props.stepTrace);

  const tabs: Array<Tab> = [
    {
      name: STEPS_TAB_NAME,
      countBadge: steps.length,
      tabType: TAB_TYPE_BY_ATTENTION[getTraceAttention(props.stepTrace)],
      children: (
        <StepTraceViewer trace={props.stepTrace} isRunning={props.isRunning} />
      ),
    },
    {
      name: FULL_LOG_TAB_NAME,
      children: props.logs ? (
        <SimpleLogViewer
          title="Workflow Execution Log"
          height="400px"
          autoScrollToBottom={props.isRunning}
        >
          {props.logs}
        </SimpleLogViewer>
      ) : (
        <p className="text-sm text-gray-500">
          {props.isRunning
            ? "Nothing has been logged yet."
            : "This run did not log anything."}
        </p>
      ),
    },
  ];

  return (
    <Modal
      title={props.title || "Workflow Run"}
      description={
        props.description || "Here is what happened when this workflow ran."
      }
      isLoading={false}
      modalWidth={ModalWidth.Large}
      /*
       * Nothing here is submitted — the modal only shows a run. One button,
       * which is the same thing the header's × and the Escape key do.
       */
      onClose={props.onClose}
      closeButtonText={"Close"}
      closeButtonStyleType={ButtonStyleType.NORMAL}
    >
      <div>
        {(props.statusMessage || props.toolbar) && (
          <div
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
            data-testid="workflow-run-status-row"
          >
            {props.statusMessage ? (
              <div className="flex min-w-0 items-center gap-2">
                {props.isRunning && (
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full bg-indigo-500 animate-pulse"
                  />
                )}
                <p
                  className={`text-sm font-medium ${
                    props.isStatusMessageError
                      ? "text-red-600"
                      : "text-gray-600"
                  }`}
                >
                  {props.statusMessage}
                </p>
              </div>
            ) : (
              <div />
            )}
            {props.toolbar && (
              <div
                className="flex flex-wrap items-center gap-2"
                data-testid="workflow-run-toolbar"
              >
                {props.toolbar}
              </div>
            )}
          </div>
        )}

        <Tabs
          tabs={tabs}
          initialTabName={props.initialTabName}
          onTabChange={() => {
            // Nothing to do — the modal shows both tabs from data it already has.
          }}
        />
      </div>
    </Modal>
  );
};

export default WorkflowLogModal;
