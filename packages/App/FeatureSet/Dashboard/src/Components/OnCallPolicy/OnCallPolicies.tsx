import OnCallPolicyElement from "./OnCallPolicy";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import React, { FunctionComponent, ReactElement } from "react";
import {
  getListSeparator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
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

  /*
   * The names one after another as the reader's language lists them
   * ("، " in Arabic and Persian): each name is an isolate of its own
   * (OnCallPolicy), so the list itself reads the page's way. A comma and a
   * space between English names on an Arabic page made the whole list one
   * line read left to right, its first policy on the left.
   */
  const separator: string = getListSeparator(translator.language);

  return (
    <div>
      {props.onCallPolicies.map((onCallPolicy: Monitor, i: number) => {
        return (
          <span key={i}>
            <OnCallPolicyElement
              onCallPolicy={onCallPolicy}
              onNavigateComplete={props.onNavigateComplete}
            />
            {i !== props.onCallPolicies.length - 1 && <span>{separator}</span>}
          </span>
        );
      })}
    </div>
  );
};

export default OnCallDutyPoliciesView;
