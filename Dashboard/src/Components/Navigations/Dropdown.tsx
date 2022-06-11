import React, {
    ReactElement,
    useState,
    FunctionComponent,
    MouseEventHandler,
} from 'react';
import OutsideClickHandler from 'react-outside-click-handler';
import NavDropDown from 'CommonUI/src/Components/Dashboard/TopBar/NavLink/NavDropDown/NavDropDown';
import NavDropDownItem from 'CommonUI/src/Components/Dashboard/TopBar/NavLink/NavDropDown/NavDropDownItem';

const Dropdown: FunctionComponent = (): ReactElement => {
    const [showDropdownItems, setShowDropDownItems] = useState(false);
    const toggle: Function = () => {
        return setShowDropDownItems(!showDropdownItems);
    };

    return (
        <OutsideClickHandler
            onOutsideClick={() => {
                if (showDropdownItems) {
                    toggle();
                }
            }}
        >
            <NavDropDown
                title="More"
                action={toggle as MouseEventHandler}
                showDropdownItems={showDropdownItems}
            >
                <NavDropDownItem title="On-Call Duty" />
                <NavDropDownItem title="Scheduled Maintainance" />
                <NavDropDownItem title="Error Tracking" />
                <NavDropDownItem title="Performance Tracker" />
                <NavDropDownItem title="Security" />
                <NavDropDownItem title="Automation Script" />
                <NavDropDownItem title="Reports" />
            </NavDropDown>
        </OutsideClickHandler>
    );
};

export default Dropdown;
