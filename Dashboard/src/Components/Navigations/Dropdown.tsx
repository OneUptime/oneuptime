import React, { ReactElement, useState } from 'react';
import OutsideClickHandler from 'react-outside-click-handler';
import NavDropDown from 'CommonUI/src/Components/Dashboard/TopBar/NavLink/NavDropDown/NavDropDown';
import NavDropDownItem from 'CommonUI/src/Components/Dashboard/TopBar/NavLink/NavDropDown/NavDropDownItem';

const Dropdown = (): ReactElement => {
    const [showDropdownItems, setShowDropDownItems] = useState(false);
    const toggle = () => {
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
                action={toggle}
                showDropdownItems={showDropdownItems}
                items={[
                    <NavDropDownItem key={1} title="On-Call Duty" />,
                    <NavDropDownItem key={2} title="Scheduled Maintainance" />,
                    <NavDropDownItem key={3} title="Error Tracking" />,
                    <NavDropDownItem key={4} title="Performance Tracker" />,
                    <NavDropDownItem key={5} title="Security" />,
                ]}
            />
        </OutsideClickHandler>
    );
};

export default Dropdown;
