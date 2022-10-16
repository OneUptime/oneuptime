import React, { FunctionComponent, ReactElement } from 'react';
import NavBar from 'CommonUI/src/Components/Navbar/NavBar';
import NavBarItem from 'CommonUI/src/Components/Navbar/NavBarItem';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';

export interface ComponentProps {
    show: boolean;
    isPreview: boolean;
}

const DashboardNavbar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    if (!props.show) {
        return <></>;
    }

    return (
        <NavBar
            navBarStyle={{
                marginTop: "0px",
                position: "unset"
            }}
            rightContent={
                <>
                    <NavBarItem
                        title="Subscribe"
                        icon={IconProp.Email}
                        route={RouteUtil.populateRouteParams(
                            props.isPreview ? RouteMap[PageMap.PREVIEW_SUBSCRIBE] as Route : RouteMap[PageMap.SUBSCRIBE] as Route
                        )}
                    ></NavBarItem>
                    <NavBarItem
                        title="RSS"
                        icon={IconProp.RSS}
                        route={RouteUtil.populateRouteParams(
                            props.isPreview ? RouteMap[PageMap.PREVIEW_RSS] as Route : RouteMap[PageMap.RSS] as Route
                        )}
                    ></NavBarItem>
                </>
            }
            maxWidth="880px"
        >
            <NavBarItem
                title="Overview"
                route={RouteUtil.populateRouteParams(
                    props.isPreview ? RouteMap[PageMap.PREVIEW_OVERVIEW] as Route : RouteMap[PageMap.OVERVIEW] as Route
                )}
            ></NavBarItem>

            <NavBarItem
                title="Incidents"
                route={RouteUtil.populateRouteParams(
                    props.isPreview ? RouteMap[PageMap.PREVIEW_INCIDENT_LIST] as Route : RouteMap[PageMap.INCIDENT_LIST] as Route
                )}
            ></NavBarItem>

            <NavBarItem
                title="Announcements"
                route={RouteUtil.populateRouteParams(
                    props.isPreview ? RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_LIST] as Route : RouteMap[PageMap.ANNOUNCEMENT_LIST] as Route
                )}
            ></NavBarItem>

            <NavBarItem
                title="Scheduled Maintenance"
                route={RouteUtil.populateRouteParams(
                    props.isPreview ? RouteMap[PageMap.PREVIEW_SCHEDULED_EVENT_LIST] as Route : RouteMap[PageMap.SCHEDULED_EVENT_LIST] as Route
                )}
            ></NavBarItem>

        </NavBar>
    );
};

export default DashboardNavbar;
