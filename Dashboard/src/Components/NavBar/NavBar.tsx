import NavBar from 'CommonUI/src/Components/Dashboard/Navbar/NavBar';
import NavItem from 'CommonUI/src/Components/Dashboard/Navbar/NavItem';
import NavDropDown from 'CommonUI/src/Components/Dashboard/NavBar/NavDropDown/NavDropDown';
import NavDropDownItem from 'CommonUI/src/Components/Dashboard/NavBar/NavDropDown/NavDropDownItem';
import React, { FunctionComponent } from 'react';
import Route from 'Common/Types/API/Route';

export interface ComponentProps{
   
}

const NavBarComponent: FunctionComponent<ComponentProps> = ({
    
}: ComponentProps) => {
    return (
        <NavBar
            rightContent={[
                <NavItem
                    route={new Route('/projectId/settings')}
                    title="Settings"
                    key={1}
                    
                />,
            ]}
        >
            <NavItem route={new Route('/projectId/home')} title="Home" />

            <NavItem
                route={new Route('/projectId/monitors')}
                title="Monitors"
            />

            <NavItem
                route={new Route('/projectId/incidents')}
                title="Incidents"
            />

            <NavItem
                route={new Route('/projectId/statuspages')}
                title="Status Pages"
            />

            <NavItem route={new Route('/projectId/logs')} title="Logs" />

            <NavDropDown title="More">
                <NavDropDownItem
                    route={new Route('/projectId/home')}
                    title="On-Call Duty"
                />
                <NavDropDownItem
                    route={new Route('/projectId/home')}
                    title="Scheduled Maintainance"
                />
                <NavDropDownItem
                    route={new Route('/projectId/home')}
                    title="Error Tracking"
                />
                <NavDropDownItem
                    route={new Route('/projectId/home')}
                    title="Performance Tracker"
                />
                <NavDropDownItem
                    route={new Route('/projectId/home')}
                    title="Security"
                />
                <NavDropDownItem
                    route={new Route('/projectId/home')}
                    title="Automation Script"
                />
                <NavDropDownItem
                    route={new Route('/projectId/home')}
                    title="Reports"
                />
            </NavDropDown>
        </NavBar>
    );
};

export default NavBarComponent;
