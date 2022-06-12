import NavBar from 'CommonUI/src/Components/Dashboard/Navbar/NavBar';
import NavItem from 'CommonUI/src/Components/Dashboard/Navbar/NavItem';
import NavDropDown from 'CommonUI/src/Components/Dashboard/Navbar/NavDropDown/NavDropDown';
import NavDropDownItem from 'CommonUI/src/Components/Dashboard/Navbar/NavDropDown/NavDropDownItem';
import React, { FunctionComponent } from 'react';
import Route from 'Common/Types/API/Route';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';

const NavBarComponent: FunctionComponent = () => {
    return (
        <NavBar
            rightContent={[
                <NavItem
                    route={RouteMap[PageMap.SETTINGS] as Route}
                    title="Settings"
                    key={1}
                />,
            ]}
        >
            <NavItem route={RouteMap[PageMap.HOME] as Route} title="Home" />

            <NavItem
                route={RouteMap[PageMap.MONITORS] as Route}
                title="Monitors"
            />

            <NavItem
                route={RouteMap[PageMap.INCIDENTS] as Route}
                title="Incidents"
            />

            <NavItem
                route={RouteMap[PageMap.STATUS_PAGE] as Route}
                title="Status Pages"
            />

            <NavItem route={RouteMap[PageMap.LOGS] as Route} title="Logs" />

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
