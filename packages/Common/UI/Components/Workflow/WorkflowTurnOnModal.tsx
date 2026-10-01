import { ButtonStyleType } from "../Button/Button";
import ConfirmModal from "../Modal/ConfirmModal";
import { WorkflowRunAttempt, WorkflowRunKind } from "./UseWorkflowEnabled";
import { WorkflowEnabledCopy } from "./WorkflowEnabledCopy";
import { translateTemplate } from "../../Utils/TranslateTemplate";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The run that is waiting for the workflow to be turned on.
  attempt: WorkflowRunAttempt;
  /*
   * The workflow's trigger. Turning the workflow on lets it start the
   * workflow as well, so the dialog says so. Left out for a Manual trigger,
   * which only Run Workflow starts, and when there is no trigger.
   */
  triggerTitle?: string | undefined;
  /*
   * False when the user may not turn the workflow on. The dialog then only
   * says who can, and closes.
   */
  canTurnOn: boolean;
  isTurningOn?: boolean | undefined;
  // Why the workflow could not be turned on.
  error?: string | undefined;
  onTurnOn: () => void;
  onClose: () => void;
}

/*
 * Someone ran a workflow, or one of its steps, while the workflow was turned
 * off. The run is held rather than sent and refused, and this offers to do
 * the two things in one go: turn the workflow on, then run what they asked
 * for. It says what else turning it on does - its trigger starts it from then
 * on - and where the switch is, to turn it off again.
 *
 * It replaced an Error dialog that said "This workflow is not enabled" and
 * offered only Close (UseWorkflowEnabled).
 */
const WorkflowTurnOnModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  if (!props.canTurnOn) {
    // A notice: nothing to do here but read it, so its one button closes it.
    return (
      <ConfirmModal
        title={WorkflowEnabledCopy.promptCannotTurnOnTitle}
        description={
          <div data-testid="workflow-turn-on-prompt">
            <p>{translate(WorkflowEnabledCopy.promptCannotTurnOn)}</p>
          </div>
        }
        submitButtonText={WorkflowEnabledCopy.close}
        onSubmit={props.onClose}
      />
    );
  }

  const isStep: boolean = props.attempt.kind === WorkflowRunKind.Step;
  const stepTitle: string = (props.attempt.stepTitle || "").trim();

  const whatWasAskedFor: string =
    isStep && stepTitle
      ? translateTemplate(WorkflowEnabledCopy.promptRunStep, {
          step: stepTitle,
        })
      : translate(WorkflowEnabledCopy.promptRunWorkflow);

  const triggerTitle: string = (props.triggerTitle || "").trim();

  const afterwards: Array<string> = [
    triggerTitle
      ? translateTemplate(WorkflowEnabledCopy.promptTrigger, {
          trigger: triggerTitle,
        })
      : "",
    translate(WorkflowEnabledCopy.promptWhereTheSwitchIs),
  ].filter((sentence: string): boolean => {
    return sentence.length > 0;
  });

  return (
    <ConfirmModal
      title={WorkflowEnabledCopy.promptTitle}
      description={
        <div className="space-y-3" data-testid="workflow-turn-on-prompt">
          <p>{whatWasAskedFor}</p>
          <p>{afterwards.join(" ")}</p>
        </div>
      }
      submitButtonText={
        isStep
          ? WorkflowEnabledCopy.turnOnAndRunStep
          : WorkflowEnabledCopy.turnOnAndRun
      }
      // Turning it on and running is what the dialog is for: the one primary.
      submitButtonType={ButtonStyleType.PRIMARY}
      isLoading={Boolean(props.isTurningOn)}
      error={props.error || undefined}
      onSubmit={props.onTurnOn}
      onClose={props.onClose}
    />
  );
};

export default WorkflowTurnOnModal;
