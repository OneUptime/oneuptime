import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import React, { ReactElement, FC, MouseEventHandler } from 'react';
import './NavDropDown.scss';

export interface ComponentProps {
    title: string;
    items: Array<ReactElement>;
    action?: MouseEventHandler;
    showDropdownItems?: boolean;
}

const NavDropDown: FC<ComponentProps> = ({
    title,
    items,
    action,
    showDropdownItems,
}): ReactElement => {
    return (
        <div className="nav-dropdown" onClick={action}>
            <div className="nav-dropdown__name">
                <p>{title}</p>
                <FontAwesomeIcon icon={faChevronDown} />
            </div>
            {showDropdownItems && (
                <div className="nav-dropdown__modal">
                    {items.map((item, index) => (
                        <React.Fragment key={index}>{item}</React.Fragment>
                    ))}
                </div>
            )}
        </div>
    );
};

export default NavDropDown;
