import React, { FunctionComponent, ReactElement } from 'react';
import NavBar from 'CommonUI/src/Components/Navbar/NavBar';
// import NavBarMenu from 'CommonUI/src/Components/Navbar/NavBarMenu';
import NavBarItem from 'CommonUI/src/Components/Navbar/NavBarItem';
// import NavBarMenuItem from 'CommonUI/src/Components/Navbar/NavBarMenuItem';
// import NavBarMenuColumn from 'CommonUI/src/Components/Navbar/NavBarMenuColumn';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';

export interface ComponentProps {
    show: boolean;
}

const DashboardNavbar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (!props.show) {
        return <></>;
    }

    return (
        <NavBar>
            <NavBarItem
                title="Home"
                icon={IconProp.Home}
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.HOME] as Route
                )}
            ></NavBarItem>

            <NavBarItem
                title="Monitors"
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITORS] as Route
                )}
                icon={IconProp.AltGlobe}
            ></NavBarItem>

            <NavBarItem
                title="Incidents"
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.INCIDENTS] as Route
                )}
                icon={IconProp.Alert}
            ></NavBarItem>

            <NavBarItem
                title="Scheduled Maintenance"
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route
                )}
                icon={IconProp.Clock}
            ></NavBarItem>

            <NavBarItem
                title="Status Pages"
                icon={IconProp.CheckCircle}
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.STATUS_PAGES] as Route
                )}
            ></NavBarItem>

            <NavBarItem
                title="Project Settings"
                icon={IconProp.Settings}
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SETTINGS] as Route
                )}
            ></NavBarItem>

            {/* <NavBarItem title="More" icon={IconProp.More}>
                <NavBarMenu>
                    <NavBarMenuColumn title="More">
                        <NavBarMenuItem
                            title="Logs Management"
                            route={RouteUtil.populateRouteParams(
                                RouteMap[PageMap.LOGS] as Route
                            )}
                            icon={IconProp.Terminal}
                        />
                        <NavBarMenuItem
                            title="Error Tracker"
                            route={RouteUtil.populateRouteParams(
                                RouteMap[PageMap.ERROR_TRACKER] as Route
                            )}
                            icon={IconProp.Error}
                        />
                        <NavBarMenuItem
                            title="On-Call Duty"
                            route={RouteUtil.populateRouteParams(
                                RouteMap[PageMap.ON_CALL_DUTY] as Route
                            )}
                            icon={IconProp.Call}
                        ></NavBarMenuItem>
                    </NavBarMenuColumn>
                    <NavBarMenuColumn title="Advanced">
                        <NavBarMenuItem
                            title="Automation Scripts"
                            route={RouteUtil.populateRouteParams(
                                RouteMap[PageMap.AUTOMATION_SCRIPTS] as Route
                            )}
                            icon={IconProp.Code}
                        />
                        <NavBarMenuItem
                            title="Reports"
                            route={RouteUtil.populateRouteParams(
                                RouteMap[PageMap.REPORTS] as Route
                            )}
                            icon={IconProp.Report}
                        />
                    </NavBarMenuColumn>
                </NavBarMenu>
            </NavBarItem> */}
        </NavBar>
    );
};

export default DashboardNavbar;
