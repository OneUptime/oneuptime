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
    children: Array<ReactElement>;
    action?: MouseEventHandler;
    showDropdownItems?: boolean;
}

const NavDropDown: FunctionComponent<ComponentProps> = ({
    title,
    children,
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
                    {children.map((item: ReactElement, index: number) => {
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
