import { IconProp } from '@fortawesome/fontawesome-svg-core';
import React, {
    ReactElement,
    MouseEventHandler,
    FunctionComponent,
} from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import './MenuButton.scss';

export interface MenuIconButtonComponentProps {
    icon?: IconProp;
    onClick?: MouseEventHandler;
    modalContent?: ReactElement;
    showModal?: boolean;
}

export interface MenuOutlineButtonComponentProps
    extends MenuIconButtonComponentProps {
    text?: string;
    className?: string;
    id?: string;
}

export const MenuIconButton: FunctionComponent<
    MenuIconButtonComponentProps
> = ({
    icon,
    onClick,
    showModal,
    modalContent,
}: MenuIconButtonComponentProps): ReactElement => {
    return (
        <div className="buttonLayout">
            <div className="iconButton" onClick={onClick}>
                {icon && <FontAwesomeIcon icon={icon} />}
            </div>
            {showModal && <div className="buttonModal">{modalContent}</div>}
        </div>
    );
};

export const MenuOutlineButton: FunctionComponent<
    MenuOutlineButtonComponentProps
> = ({
    text,
    icon,
    onClick,
    showModal,
    modalContent,
    className,
    id,
}: MenuOutlineButtonComponentProps): ReactElement => {
    return (
        <div className="buttonLayout">
            <div className={`button ${className}`} id={id} onClick={onClick}>
                <span>{text}</span>
                {icon && <FontAwesomeIcon icon={icon} />}
            </div>
            {showModal && <div className="buttonModal">{modalContent}</div>}
        </div>
    );
};

const MenuButton: FunctionComponent<MenuOutlineButtonComponentProps> = ({
    text,
    icon,
    onClick,
    showModal,
    modalContent,
}: MenuOutlineButtonComponentProps): ReactElement => {
    return (
        <div className="buttonLayout">
            <div className="menuButton" onClick={onClick}>
                {icon && <FontAwesomeIcon icon={icon} />}
                <span>{text}</span>
            </div>
            {showModal && <div className="buttonModal">{modalContent}</div>}
        </div>
    );
};

export default MenuButton;
