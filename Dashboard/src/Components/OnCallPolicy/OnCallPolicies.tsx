import OnCallPolicyElement from "./OnCallPolicy";
import Monitor from "Model/Models/Monitor";
import OnCallDutyPolicy from "Model/Models/OnCallDutyPolicy";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onCallPolicies: Array<OnCallDutyPolicy>;
  onNavigateComplete?: (() => void) | undefined;
}

const OnCallDutyPoliciesView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.onCallPolicies || props.onCallPolicies.length === 0) {
    return <p>No on-call policies.</p>;
  }

  return (
    <div>
      {props.onCallPolicies.map((onCallPolicy: Monitor, i: number) => {
        return (
          <span key={i}>
            <OnCallPolicyElement
              onCallPolicy={onCallPolicy}
              onNavigateComplete={props.onNavigateComplete}
            />
            {i !== props.onCallPolicies.length - 1 && <span>,&nbsp;</span>}
          </span>
        );
      })}
    </div>
  );
};

export default OnCallDutyPoliciesView;
