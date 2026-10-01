import Toggle from "../Toggle/Toggle";
import { WorkflowEnabledCopy } from "./WorkflowEnabledCopy";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  isEnabled: boolean;
  // The switch is being saved, so a second press is not sent.
  isSaving?: boolean | undefined;
  /*
   * Set when the user may not turn the workflow on or off. The switch stays on
   * screen, so the state is still read from it, but it is disabled and says
   * which permission is missing.
   */
  disabledReason?: string | undefined;
  onChange: (isEnabled: boolean) => void;
}

/*
 * The workflow's Enabled switch, at the top of the Builder.
 *
 * It used to live only in the Overview's Workflow Details, behind Edit, two
 * pages away from where a workflow is built and run, and nothing in the
 * Builder said it existed. Here the state is in view while the workflow is
 * edited, which matters both ways: a workflow that is off does not run, and
 * one that is on is live, so every saved change to it takes effect at once.
 */
const WorkflowEnabledSwitch: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="shrink-0" data-testid="workflow-enabled-switch-field">
      <Toggle
        title={WorkflowEnabledCopy.switchLabel}
        value={props.isEnabled}
        onChange={props.onChange}
        disabled={Boolean(props.isSaving) || Boolean(props.disabledReason)}
        tooltip={props.disabledReason}
        dataTestId="workflow-enabled-switch"
      />
    </div>
  );
};

export default WorkflowEnabledSwitch;
