import React, { FunctionComponent, ReactElement } from 'react';
import MonitorGroup from 'Model/Models/MonitorGroup';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import ObjectID from 'Common/Types/ObjectID';
import Icon from 'CommonUI/src/Components/Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';

export interface ComponentProps {
    monitorGroup: MonitorGroup;
    onNavigateComplete?: (() => void) | undefined;
    showIcon?: boolean;
}

const MonitorGroupElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (props.monitorGroup._id) {
        return (
            <Link
                onNavigateComplete={props.onNavigateComplete}
                className="hover:underline"
                to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITOR_GROUP_VIEW] as Route,
                    {
                        modelId: new ObjectID(props.monitorGroup._id as string),
                    }
                )}
            >
                <span className="flex">
                    {props.showIcon ? (
                        <Icon
                            icon={IconProp.Squares}
                            className="w-5 h-5 mr-1"
                        />
                    ) : (
                        <></>
                    )}{' '}
                    {props.monitorGroup.name}
                </span>
            </Link>
        );
    }

    return <span>{props.monitorGroup.name}</span>;
};

export default MonitorGroupElement;
