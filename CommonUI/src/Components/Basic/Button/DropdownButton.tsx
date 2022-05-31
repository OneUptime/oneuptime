import React, { FC, MouseEventHandler, ReactElement } from 'react';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import './DropdownButton.scss';

export interface ComponentProps {
    showDropdown?: boolean;
    action?: MouseEventHandler;
    dropdownItems?: Array<ReactElement>;
    title: string;
}

const DropdownButton: FC<ComponentProps> = ({
    action,
    title,
    dropdownItems,
    showDropdown,
}): ReactElement => {
    return (
        <div className="dropdown-button">
            <button onClick={action}>
                {title} <FontAwesomeIcon icon={faChevronDown} />
            </button>
            {showDropdown && (
                <div className="dropdown-button-lists">
                    {dropdownItems?.map((item, index) => (
                        <React.Fragment key={index}>{item}</React.Fragment>
                    ))}
                </div>
            )}
        </div>
    );
};

export default DropdownButton;
