import React, { FunctionComponent, ReactElement } from 'react';
import NavBar from 'CommonUI/src/Components/Navbar/NavBar';
import NavBarItem from 'CommonUI/src/Components/Navbar/NavBarItem';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';

export interface ComponentProps {
    show: boolean;
    isPreview: boolean;
    isPrivateStatusPage: boolean;
}

const DashboardNavbar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (!props.show) {
        return <></>;
    }

    return (
        <NavBar className="bg-white lg:flex text-center justify-between py-2 mt-5 rounded-lg shadow px-5">
            <NavBarItem
                title="Overview"
                icon={IconProp.CheckCircle}
                route={RouteUtil.populateRouteParams(
                    props.isPreview
                        ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
                        : (RouteMap[PageMap.OVERVIEW] as Route)
                )}
            ></NavBarItem>

            <NavBarItem
                title="Incidents"
                icon={IconProp.Alert}
                route={RouteUtil.populateRouteParams(
                    props.isPreview
                        ? (RouteMap[PageMap.PREVIEW_INCIDENT_LIST] as Route)
                        : (RouteMap[PageMap.INCIDENT_LIST] as Route)
                )}
            ></NavBarItem>

            <NavBarItem
                title="Announcements"
                icon={IconProp.Announcement}
                route={RouteUtil.populateRouteParams(
                    props.isPreview
                        ? (RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_LIST] as Route)
                        : (RouteMap[PageMap.ANNOUNCEMENT_LIST] as Route)
                )}
            ></NavBarItem>

            <NavBarItem
                title="Scheduled Events"
                icon={IconProp.Clock}
                route={RouteUtil.populateRouteParams(
                    props.isPreview
                        ? (RouteMap[
                              PageMap.PREVIEW_SCHEDULED_EVENT_LIST
                          ] as Route)
                        : (RouteMap[PageMap.SCHEDULED_EVENT_LIST] as Route)
                )}
            ></NavBarItem>

            <NavBarItem
                title="Subscribe"
                icon={IconProp.Email}
                route={RouteUtil.populateRouteParams(
                    props.isPreview
                        ? (RouteMap[PageMap.PREVIEW_SUBSCRIBE_EMAIL] as Route)
                        : (RouteMap[PageMap.SUBSCRIBE_SMS] as Route)
                )}
            ></NavBarItem>

            {props.isPrivateStatusPage ? (
                <NavBarItem
                    title="Logout"
                    icon={IconProp.Logout}
                    route={RouteUtil.populateRouteParams(
                        props.isPreview
                            ? (RouteMap[PageMap.PREVIEW_LOGOUT] as Route)
                            : (RouteMap[PageMap.LOGOUT] as Route)
                    )}
                ></NavBarItem>
            ) : (
                <></>
            )}
        </NavBar>
    );
};

export default DashboardNavbar;
