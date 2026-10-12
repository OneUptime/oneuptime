import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import { WorkflowEnabledCopy } from "./WorkflowEnabledCopy";
import useTranslateValue from "../../Utils/Translation";
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

/*
 * Above the Builder's canvas while the workflow is turned off. It says what
 * off means - the workflow's trigger is paused, so nothing starts it on its
 * own - and what it does not: the workflow can still be tested with Run
 * Workflow, as a test run (Types/Workflow/WorkflowEnabled). Then the one
 * thing to do about it, Turn on workflow, for whoever may.
 *
 * Amber rather than red: off is a normal state for a workflow that is still
 * being built, not a failure, but nothing it is meant to do on its own
 * happens until it changes, so it should not be missed either.
 */
const WorkflowTurnedOffNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

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
            {translate(WorkflowEnabledCopy.noticeTitle)}
          </p>
          <p className="text-amber-800">
            {translate(WorkflowEnabledCopy.noticeBody)}
            {props.canTest === false ? (
              <></>
            ) : (
              <span data-testid="workflow-turned-off-notice-can-test">
                {" "}
                {translate(WorkflowEnabledCopy.noticeCanTest)}
              </span>
            )}
          </p>
          {props.onTurnOn ? (
            <></>
          ) : (
            <p
              className="text-amber-800"
              data-testid="workflow-turned-off-notice-who-can"
            >
              {translate(WorkflowEnabledCopy.onlyEditorsCanTurnOn)}
            </p>
          )}
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
