import React, { FunctionComponent } from 'react';
import NavBar from 'CommonUI/src/Components/Navbar/NavBar';
import NavBarMenu from 'CommonUI/src/Components/Navbar/NavBarMenu';
import NavBarItem from 'CommonUI/src/Components/Navbar/NavBarItem';
import NavBarMenuItem from 'CommonUI/src/Components/Navbar/NavBarMenuItem';
import NavBarMenuColumn from 'CommonUI/src/Components/Navbar/NavBarMenuColumn';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Basic/Icon/Icon';

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
                isActive={true}
            ></NavBarItem>

            <NavBarItem title="Monitors" icon={IconProp.Activity}></NavBarItem>

            <NavBarItem title="Incidents" icon={IconProp.Alert}></NavBarItem>

            <NavBarItem title="On-Call Duty" icon={IconProp.Call}></NavBarItem>

            <NavBarItem
                title="Status Pages"
                icon={IconProp.CheckCircle}
            ></NavBarItem>

            <NavBarItem title="More" icon={IconProp.More}>
                <NavBarMenu>
                    <NavBarMenuColumn title="More">
                        <NavBarMenuItem
                            title="Logs Management"
                            route={new Route('/')}
                            icon={IconProp.Terminal}
                        />
                        <NavBarMenuItem
                            title="Error Tracker"
                            route={new Route('/')}
                            icon={IconProp.Error}
                        />
                    </NavBarMenuColumn>
                    <NavBarMenuColumn title="Advanced">
                        <NavBarMenuItem
                            title="Automation Scripts"
                            route={new Route('/')}
                            icon={IconProp.Code}
                        />
                        <NavBarMenuItem
                            title="Reports"
                            route={new Route('/')}
                            icon={IconProp.Report}
                        />
                    </NavBarMenuColumn>
                </NavBarMenu>
            </NavBarItem>
        </NavBar>
    );
};

export default DashboardNavbar;
