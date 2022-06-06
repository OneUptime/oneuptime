import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import React, {
    ReactElement,
    MouseEventHandler,
    FunctionComponent,
} from 'react';
import './NavDropDown.scss';

export interface ComponentProps {
    title: string;
    items: Array<ReactElement>;
    action?: MouseEventHandler;
    showDropdownItems?: boolean;
}

const NavDropDown: FunctionComponent<ComponentProps> = ({
    title,
    items,
    action,
    showDropdownItems,
}: ComponentProps): ReactElement => {
    return (
        <div className="nav-dropdown" onClick={action}>
            <div className="nav-dropdown__name">
                <p>{title}</p>
                <FontAwesomeIcon icon={faChevronDown} />
            </div>
            {showDropdownItems && (
                <div className="nav-dropdown__modal">
                    {items.map((item, index) => {
                        return (
                            <React.Fragment key={index}>{item}</React.Fragment>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default NavDropDown;
