import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import NavBar from 'CommonUI/src/Components/Navbar/NavBar';
import NavBarItem from 'CommonUI/src/Components/Navbar/NavBarItem';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    show: boolean;
    isPreview: boolean;
    isPrivateStatusPage: boolean;
    enableEmailSubscribers: boolean;
    enableSMSSubscribers: boolean;
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
                id="overview-nav-bar-item"
                title="Overview"
                icon={IconProp.CheckCircle}
                exact={true}
                route={RouteUtil.populateRouteParams(
                    props.isPreview
                        ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
                        : (RouteMap[PageMap.OVERVIEW] as Route)
                )}
            ></NavBarItem>

            <NavBarItem
                id="incidents-nav-bar-item"
                title="Incidents"
                icon={IconProp.Alert}
                exact={true}
                route={RouteUtil.populateRouteParams(
                    props.isPreview
                        ? (RouteMap[PageMap.PREVIEW_INCIDENT_LIST] as Route)
                        : (RouteMap[PageMap.INCIDENT_LIST] as Route)
                )}
            ></NavBarItem>

            <NavBarItem
                id="announcements-nav-bar-item"
                title="Announcements"
                icon={IconProp.Announcement}
                exact={true}
                route={RouteUtil.populateRouteParams(
                    props.isPreview
                        ? (RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_LIST] as Route)
                        : (RouteMap[PageMap.ANNOUNCEMENT_LIST] as Route)
                )}
            ></NavBarItem>

            <NavBarItem
                id="scheduled-events-nav-bar-item"
                title="Scheduled Events"
                icon={IconProp.Clock}
                exact={true}
                route={RouteUtil.populateRouteParams(
                    props.isPreview
                        ? (RouteMap[
                              PageMap.PREVIEW_SCHEDULED_EVENT_LIST
                          ] as Route)
                        : (RouteMap[PageMap.SCHEDULED_EVENT_LIST] as Route)
                )}
            ></NavBarItem>

            {props.enableEmailSubscribers || props.enableSMSSubscribers ? (
                <NavBarItem
                    id="subscribe-nav-bar-item"
                    title="Subscribe"
                    icon={IconProp.Email}
                    exact={true}
                    route={RouteUtil.populateRouteParams(
                        props.isPreview
                            ? (RouteMap[
                                  PageMap.PREVIEW_SUBSCRIBE_EMAIL
                              ] as Route)
                            : (RouteMap[PageMap.SUBSCRIBE_SMS] as Route)
                    )}
                ></NavBarItem>
            ) : (
                <></>
            )}

            {props.isPrivateStatusPage ? (
                <NavBarItem
                    id="logout-nav-bar-item"
                    title="Logout"
                    icon={IconProp.Logout}
                    exact={true}
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
