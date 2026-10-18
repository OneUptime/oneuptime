import RepeatChoiceCard from "./RepeatChoice/RepeatChoiceCard";
import { ON_CALL_POLICY_REPEAT } from "./RepeatChoice/RepeatChoice";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onCallDutyPolicyId: ObjectID;
}

/*
 * The Repeat Policy card under a policy's escalation rules: what happens
 * when nobody acknowledges after the last level - "Stop paging", or "Start
 * again from Level 1, up to 2 more times" - and Edit to change it. It used
 * to show a switch and a number, which could say "Repeat enabled" for a
 * policy that never repeated (RepeatChoice.ts).
 */
const RepeatPolicy: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <RepeatChoiceCard<OnCallDutyPolicy>
      config={ON_CALL_POLICY_REPEAT}
      modelType={OnCallDutyPolicy}
      modelId={props.onCallDutyPolicyId}
      name="On-Call Policy > Repeat Policy"
    />
  );
};

export default RepeatPolicy;
