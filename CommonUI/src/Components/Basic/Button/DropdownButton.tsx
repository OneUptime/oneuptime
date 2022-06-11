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
}: ComponentProps): ReactElement => {
    return (
        <div className="dropdownButton">
            <MenuOutlineButton
                id="tableButton"
                text={title}
                icon={faChevronDown}
                onClick={onClick!}
            />
            {showDropdown && (
                <div className="dropdownButtonLists">{children}</div>
            )}
        </div>
    );
};

export default DropdownButton;
