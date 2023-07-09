import React, { FunctionComponent, ReactElement } from 'react';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageMap from '../../../Utils/PageMap';
import ObjectID from 'Common/Types/ObjectID';
import OnCallDutyPolicyEscalationRule from 'Model/Models/OnCallDutyPolicyEscalationRule';

export interface ComponentProps {
    escalationRule: OnCallDutyPolicyEscalationRule;
    onNavigateComplete?: (() => void) | undefined;
}

const EscalationRuleView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
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
                            props.escalationRule.onCallDutyPolicyId.toString() as string
                        ),
                    }
                )}
            >
                <span>{props.escalationRule.name}</span>
            </Link>
        );
    }

    return <span>{props.escalationRule.name}</span>;
};

export default EscalationRuleView;
