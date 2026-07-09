import EscalationRules from "../../../Components/OnCallPolicy/EscalationRule/EscalationRules";
import RepeatPolicy from "../../../Components/OnCallPolicy/RepeatPolicy";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallPolicyEscalation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The policy id comes from the route and the project id from ProjectUtil.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  return (
    <Fragment>
      <EscalationRules onCallDutyPolicyId={modelId} projectId={projectId} />

      <div className="mt-6">
        <RepeatPolicy onCallDutyPolicyId={modelId} />
      </div>
    </Fragment>
  );
};

export default OnCallPolicyEscalation;
