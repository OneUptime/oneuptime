import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  escalationRule: OnCallDutyPolicyEscalationRule;
  onNavigateComplete?: (() => void) | undefined;
}

const EscalationRuleView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.escalationRule.onCallDutyPolicyId) {
    return (
      <Link
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
          {
            modelId: new ObjectID(
              props.escalationRule.onCallDutyPolicyId.toString() as string,
            ),
          },
        )}
      >
        <span>{props.escalationRule.name}</span>
      </Link>
    );
  }

  return <span>{props.escalationRule.name}</span>;
};

export default EscalationRuleView;
