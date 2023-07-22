import React, { FunctionComponent, ReactElement } from 'react';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import ProjectSmtpConfig from 'Model/Models/ProjectSmtpConfig';

export interface ComponentProps {
    smtp?: ProjectSmtpConfig | undefined;
    onNavigateComplete?: (() => void) | undefined;
}

const CustomSMTPElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (!props.smtp) {
        return <span>OneUptime Mail Server</span>;
    }

    if (props.smtp._id) {
        return (
            <Link
                onNavigateComplete={props.onNavigateComplete}
                className="hover:underline"
                to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SETTINGS_CUSTOM_SMTP] as Route
                )}
            >
                <span>{props.smtp.name}</span>
            </Link>
        );
    }

    return <span>{props.smtp.name}</span>;
};

export default CustomSMTPElement;
