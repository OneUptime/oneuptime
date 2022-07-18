import React, { FunctionComponent } from 'react';
import NavBar from 'CommonUI/src/Components/Navbar/NavBar';
import NavBarMenu from 'CommonUI/src/Components/Navbar/NavBarMenu';
import NavBarItem from 'CommonUI/src/Components/Navbar/NavBarItem';
import NavBarMenuItem from 'CommonUI/src/Components/Navbar/NavBarMenuItem';
import NavBarMenuColumn from 'CommonUI/src/Components/Navbar/NavBarMenuColumn';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import Project from 'Common/Models/Project';
import RouteParams from '../../Utils/RouteParams';

export interface ComponentProps {
    currentProject: Project | null;
}

const DashboardNavbar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    const addRouteParam: Function = (route: Route): Route => {
        if (!props.currentProject || !props.currentProject._id) {
            return route;
        }

        return route.addRouteParam(
            RouteParams.ProjectID,
            props.currentProject._id
        );
    };

    return (
        <NavBar
            rightContent={
                <NavBarItem
                    title="Project Settings"
                    icon={IconProp.Settings}
                    route={addRouteParam(RouteMap[PageMap.SETTINGS] as Route)}
                ></NavBarItem>
            }
        >
            <NavBarItem
                title="Home"
                icon={IconProp.Home}
                route={addRouteParam(RouteMap[PageMap.HOME] as Route)}
            ></NavBarItem>

            <NavBarItem
                title="Monitors"
                route={addRouteParam(RouteMap[PageMap.MONITORS] as Route)}
                icon={IconProp.Activity}
            ></NavBarItem>

            <NavBarItem
                title="Incidents"
                route={addRouteParam(RouteMap[PageMap.INCIDENTS] as Route)}
                icon={IconProp.Alert}
            ></NavBarItem>

            <NavBarItem
                title="On-Call Duty"
                route={addRouteParam(RouteMap[PageMap.ON_CALL] as Route)}
                icon={IconProp.Call}
            ></NavBarItem>

            <NavBarItem
                title="Status Pages"
                icon={IconProp.CheckCircle}
                route={addRouteParam(RouteMap[PageMap.STATUS_PAGE] as Route)}
            ></NavBarItem>

            <NavBarItem title="More" icon={IconProp.More}>
                <NavBarMenu>
                    <NavBarMenuColumn title="More">
                        <NavBarMenuItem
                            title="Logs Management"
                            route={addRouteParam(
                                RouteMap[PageMap.LOGS] as Route
                            )}
                            icon={IconProp.Terminal}
                        />
                        <NavBarMenuItem
                            title="Error Tracker"
                            route={addRouteParam(
                                RouteMap[PageMap.ERROR_TRACKER] as Route
                            )}
                            icon={IconProp.Error}
                        />
                    </NavBarMenuColumn>
                    <NavBarMenuColumn title="Advanced">
                        <NavBarMenuItem
                            title="Automation Scripts"
                            route={addRouteParam(
                                RouteMap[PageMap.AUTOMATION_SCRIPTS] as Route
                            )}
                            icon={IconProp.Code}
                        />
                        <NavBarMenuItem
                            title="Reports"
                            route={addRouteParam(
                                RouteMap[PageMap.REPORTS] as Route
                            )}
                            icon={IconProp.Report}
                        />
                    </NavBarMenuColumn>
                </NavBarMenu>
            </NavBarItem>
        </NavBar>
    );
};

export default DashboardNavbar;
