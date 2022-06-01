import React, { FC, MouseEventHandler, ReactElement } from 'react';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import './DropdownButton.scss';
import { MenuOutlineButton } from '../../Dashboard/TopBar/TopbarMenuButton/MenuButton';

export interface ComponentProps {
    showDropdown?: boolean;
    onClick?: MouseEventHandler;
    children?: Array<ReactElement>;
    title: string;
}

const DropdownButton: FC<ComponentProps> = ({
    onClick,
    title,
    children,
    showDropdown,
}): ReactElement => {
    return (
        <div className="dropdown-button">
            <MenuOutlineButton
                id="table_button"
                text={title}
                icon={faChevronDown}
                onClick={onClick!}
            />
            {showDropdown && (
                <div className="dropdown-button-lists">{children}</div>
            )}
        </div>
    );
};

export default DropdownButton;
