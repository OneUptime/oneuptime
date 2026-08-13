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
}

const WorkflowLogModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const steps: Array<WorkflowStepTraceEntry> = props.stepTrace?.steps || [];

  const tabs: Array<Tab> = [
    {
      name: STEPS_TAB_NAME,
      countBadge: steps.length,
      tabType: TabType.Info,
      children: <StepTraceViewer trace={props.stepTrace} />,
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
      onClose={props.onClose}
      onSubmit={props.onClose}
      submitButtonText={"Close"}
      submitButtonStyleType={ButtonStyleType.NORMAL}
    >
      <div>
        {props.statusMessage && (
          <div className="flex items-center gap-2">
            {props.isRunning && (
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-indigo-500 animate-pulse"
              />
            )}
            <p
              className={`text-sm font-medium ${
                props.isStatusMessageError ? "text-red-600" : "text-gray-600"
              }`}
            >
              {props.statusMessage}
            </p>
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
