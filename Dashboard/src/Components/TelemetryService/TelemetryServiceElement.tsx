import React, { FunctionComponent, ReactElement } from 'react';
import TelemetryService from 'Model/Models/TelemetryService';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps {
    telemetryService: TelemetryService;
    onNavigateComplete?: (() => void) | undefined;
}

const TelemetryServiceElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (props.telemetryService._id) {
        return (
            <Link
                onNavigateComplete={props.onNavigateComplete}
                className="hover:underline"
                to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.TELEMETRY_SERVICES_VIEW] as Route,
                    {
                        modelId: new ObjectID(
                            props.telemetryService._id as string
                        ),
                    }
                )}
            >
                <span>{props.telemetryService.name}</span>
            </Link>
        );
    }

    return <span>{props.telemetryService.name}</span>;
};

export default TelemetryServiceElement;
