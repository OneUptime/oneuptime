import React, { FunctionComponent } from 'react';
import NavBar from 'CommonUI/src/Components/Navbar/NavBar';
import NavBarMenu from 'CommonUI/src/Components/Navbar/NavBarMenu';
import NavBarItem from 'CommonUI/src/Components/Navbar/NavBarItem';
import NavBarMenuItem from 'CommonUI/src/Components/Navbar/NavBarMenuItem';
import NavBarMenuColumn from 'CommonUI/src/Components/Navbar/NavBarMenuColumn';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Basic/Icon/Icon';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';

const DashboardNavbar: FunctionComponent = () => {
    return (
        <NavBar
            rightContent={
                <NavBarItem
                    title="Project Settings"
                    icon={IconProp.Settings}
                ></NavBarItem>
            }
        >
            <NavBarItem
                title="Home"
                icon={IconProp.Home}
                route={RouteMap[PageMap.HOME] as Route}
                isActive={true}
            ></NavBarItem>

            <NavBarItem title="Monitors" route={RouteMap[PageMap.MONITORS] as Route} icon={IconProp.Activity}></NavBarItem>

            <NavBarItem title="Incidents" route={RouteMap[PageMap.INCIDENTS] as Route} icon={IconProp.Alert}></NavBarItem>

            <NavBarItem title="On-Call Duty" route={RouteMap[PageMap.ON_CALL] as Route} icon={IconProp.Call}></NavBarItem>

            <NavBarItem
                title="Status Pages"
                icon={IconProp.CheckCircle}
                route={RouteMap[PageMap.STATUS_PAGE] as Route}
            ></NavBarItem>

            <NavBarItem title="More" icon={IconProp.More}>
                <NavBarMenu>
                    <NavBarMenuColumn title="More">
                        <NavBarMenuItem
                            title="Logs Management"
                            route={RouteMap[PageMap.LOGS] as Route}
                            icon={IconProp.Terminal}
                        />
                        <NavBarMenuItem
                            title="Error Tracker"
                            route={RouteMap[PageMap.ERROR_TRACKER] as Route}
                            icon={IconProp.Error}
                        />
                    </NavBarMenuColumn>
                    <NavBarMenuColumn title="Advanced">
                        <NavBarMenuItem
                            title="Automation Scripts"
                            route={RouteMap[PageMap.AUTOMATION_SCRIPTS] as Route}
                            icon={IconProp.Code}
                        />
                        <NavBarMenuItem
                            title="Reports"
                            route={RouteMap[PageMap.REPORTS] as Route}
                            icon={IconProp.Report}
                        />
                    </NavBarMenuColumn>
                </NavBarMenu>
            </NavBarItem>
        </NavBar>
    );
};

export default DashboardNavbar;
