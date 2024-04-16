import React, { FunctionComponent, ReactElement } from 'react';
import TelemetryService from 'Model/Models/TelemetryService';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import ObjectID from 'Common/Types/ObjectID';
import ColorSquareCube from 'CommonUI/src/Components/ColorSquareCube/ColorSquareCube';
import { Black } from 'Common/Types/BrandColors';
import { GetReactElementFunction } from 'CommonUI/src/Types/FunctionTypes';

export interface ComponentProps {
    telemetryService: TelemetryService;
    onNavigateComplete?: (() => void) | undefined;
}

const TelemetryServiceElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const getServiceElement: GetReactElementFunction = (): ReactElement => {
        return (
            <div className="flex space-x-2">
                <div className="mt-1">
                    <ColorSquareCube
                        color={props.telemetryService.serviceColor || Black}
                        tooltip={`${props.telemetryService.name?.toString()} Service Color`}
                    />
                </div>
                <span>{props.telemetryService.name?.toString()}</span>
            </div>
        );
    };

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
                {getServiceElement()}
            </Link>
        );
    }

    return <div>{getServiceElement()}</div>;
};

export default TelemetryServiceElement;
