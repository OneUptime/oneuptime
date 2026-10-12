import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import { RUN_WORKFLOW_BUTTON_TITLE } from "./ManualTriggerPanel";
import { WorkflowEnabledCopy } from "./WorkflowEnabledCopy";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /*
   * Turns the workflow on. Left out when the user may not: the notice then
   * says who can.
   */
  onTurnOn?: (() => void) | undefined;
  isTurningOn?: boolean | undefined;
  /*
   * The user may run the workflow (WorkflowRunGate), so the notice says Run
   * Workflow still tests it while it is off. False for someone who may not:
   * Run Workflow is locked for them, and the notice does not offer it.
   */
  canTest?: boolean | undefined;
}

type GetNoticeBodyFunction = (data: {
  canTurnOn: boolean;
  canTest: boolean;
}) => string;

/*
 * The notice's one sentence for this reader: whether they may turn the
 * workflow on decides who it says can, and whether they may run it decides
 * whether it offers Run Workflow.
 */
export const getNoticeBody: GetNoticeBodyFunction = (data: {
  canTurnOn: boolean;
  canTest: boolean;
}): string => {
  if (data.canTurnOn) {
    return data.canTest
      ? WorkflowEnabledCopy.noticeBodyCanTest
      : WorkflowEnabledCopy.noticeBody;
  }

  return data.canTest
    ? WorkflowEnabledCopy.noticeBodyForOthersCanTest
    : WorkflowEnabledCopy.noticeBodyForOthers;
};

/*
 * Above the Builder's canvas while the workflow is turned off. It says what
 * off means - the workflow's trigger is paused, so nothing starts it on its
 * own - and what it does not: the workflow can still be tested with Run
 * Workflow, as a test run (Types/Workflow/WorkflowEnabled). Then the one
 * thing to do about it, Turn on workflow, for whoever may; anyone else is
 * told who can.
 *
 * Amber rather than red: off is a normal state for a workflow that is still
 * being built, not a failure, but nothing it is meant to do on its own
 * happens until it changes, so it should not be missed either.
 */
const WorkflowTurnedOffNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const canTest: boolean = props.canTest !== false;

  const body: string = getNoticeBody({
    canTurnOn: Boolean(props.onTurnOn),
    canTest: canTest,
  });

  return (
    <div
      role="status"
      data-testid="workflow-turned-off-notice"
      className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"
        >
          <Icon icon={IconProp.Power} className="h-5 w-5" />
        </div>
        <div className="min-w-0 text-sm leading-6">
          <p
            className="font-semibold text-amber-900"
            data-testid="workflow-turned-off-notice-title"
          >
            {translator.translateText(WorkflowEnabledCopy.noticeTitle)}
          </p>
          <p
            className="text-amber-800"
            data-testid="workflow-turned-off-notice-body"
          >
            {canTest ? (
              /*
               * The toolbar's button, named as the toolbar draws it and in
               * bold, so the eye goes from here to it.
               */
              <TranslatedSentence
                template={body}
                slots={{
                  button: (
                    <strong className="font-semibold text-amber-900">
                      {translator.translateText(RUN_WORKFLOW_BUTTON_TITLE)}
                    </strong>
                  ),
                }}
              />
            ) : (
              translator.translateText(body)
            )}
          </p>
        </div>
      </div>
      {props.onTurnOn ? (
        <div className="shrink-0">
          <Button
            title={WorkflowEnabledCopy.turnOnWorkflow}
            icon={IconProp.Power}
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Small}
            isLoading={Boolean(props.isTurningOn)}
            disabled={Boolean(props.isTurningOn)}
            onClick={props.onTurnOn}
            dataTestId="workflow-turn-on-button"
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default WorkflowTurnedOffNotice;
