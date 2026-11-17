import React, { FunctionComponent, ReactElement } from "react";
import Pill from "./Pill";
import { PillTone } from "./PillTone";

/*
 * WHETHER A RULE, A FILTER OR A WORKFLOW IS ON.
 *
 * About fifty rule lists drew a rule someone switched off as a red
 * "Disabled" pill (#9184): owner and label rules, drop filters, pipelines,
 * workflows. Turning a rule off is a choice, not a fault, and red is for
 * what broke (Docs/ux/README.md#side-menus, #9126). Enabled is green;
 * Disabled is the grey Paused tone with its hollow dot.
 */

export interface ComponentProps {
  isEnabled: boolean | undefined | null;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

const EnabledPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return props.isEnabled ? (
    <Pill
      text="Enabled"
      tone={PillTone.Success}
      className={props.className}
      dataTestId={props.dataTestId}
    />
  ) : (
    <Pill
      text="Disabled"
      tone={PillTone.Paused}
      className={props.className}
      dataTestId={props.dataTestId}
    />
  );
};

export default EnabledPill;
