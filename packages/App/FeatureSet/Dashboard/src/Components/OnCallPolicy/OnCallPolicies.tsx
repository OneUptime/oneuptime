import OnCallPolicyElement from "./OnCallPolicy";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  onCallPolicies: Array<OnCallDutyPolicy>;
  onNavigateComplete?: (() => void) | undefined;
}

const OnCallDutyPoliciesView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  if (!props.onCallPolicies || props.onCallPolicies.length === 0) {
    return <p>{translator.translateText("No on-call policies.")}</p>;
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
