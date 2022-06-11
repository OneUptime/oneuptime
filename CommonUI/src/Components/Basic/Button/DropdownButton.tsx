import React, {
    MouseEventHandler,
    ReactElement,
    FunctionComponent,
} from 'react';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import './DropdownButton.scss';
import { MenuOutlineButton } from '../../Dashboard/TopBar/TopbarMenuButton/MenuButton';

export interface ComponentProps {
    showDropdown?: boolean;
    onClick?: MouseEventHandler;
    children?: Array<ReactElement>;
    title: string;
}

const DropdownButton: FunctionComponent<ComponentProps> = ({
    onClick,
    title,
    children,
    showDropdown,
}: ComponentProps): ReactElement => {
    return (
        <div className="dropdownButton">
            <MenuOutlineButton
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
