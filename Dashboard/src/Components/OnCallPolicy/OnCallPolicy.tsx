import React, { FunctionComponent, ReactElement } from 'react';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps {
    onCallPolicy: OnCallDutyPolicy;
    onNavigateComplete?: (() => void) | undefined;
}

const OnCallPolicyView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (props.onCallPolicy._id) {
        return (
            <Link
                onNavigateComplete={props.onNavigateComplete}
                className="underline-on-hover"
                to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
                    {
                        modelId: new ObjectID(props.onCallPolicy._id as string),
                    }
                )}
            >
                <span>{props.onCallPolicy.name}</span>
            </Link>
        );
    }

    return <span>{props.onCallPolicy.name}</span>;
};

export default OnCallPolicyView;
