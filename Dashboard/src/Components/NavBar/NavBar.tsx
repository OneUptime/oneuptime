import NavBar from 'CommonUI/src/Components/Dashboard/Navbar/NavBar';
import NavItem from 'CommonUI/src/Components/Dashboard/Navbar/NavItem';
import NavDropDown from 'CommonUI/src/Components/Dashboard/NavBar/NavDropDown/NavDropDown';
import NavDropDownItem from 'CommonUI/src/Components/Dashboard/NavBar/NavDropDown/NavDropDownItem';
import React, { FunctionComponent } from 'react';

const NavBarComponent: FunctionComponent = () => {
    return (
        <NavBar rightContent={[<NavItem title="Settings" key={1} />]}>
            <NavItem title="Home" />

            <NavItem title="Monitors" isActive={true} />

            <NavItem title="Incidents" />

            <NavItem title="Status Pages" />

            <NavItem title="Logs" />

            <NavDropDown title="More">
                <NavDropDownItem title="On-Call Duty" />
                <NavDropDownItem title="Scheduled Maintainance" />
                <NavDropDownItem title="Error Tracking" />
                <NavDropDownItem title="Performance Tracker" />
                <NavDropDownItem title="Security" />
                <NavDropDownItem title="Automation Script" />
                <NavDropDownItem title="Reports" />
            </NavDropDown>
        </NavBar>
    );
};

export default NavBarComponent;
