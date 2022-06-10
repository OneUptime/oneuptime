import { IconProp } from '@fortawesome/fontawesome-svg-core';
import React, { ReactElement, FC, MouseEventHandler } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import './MenuButton.scss';

export interface ComponentProps {
    text?: string;
    icon?: IconProp;
    onClick?: MouseEventHandler;
    modalContent?: ReactElement;
    showModal?: boolean;
    className?: string;
    id?: string;
}

export const MenuIconButton: FC<ComponentProps> = ({
    icon,
    onClick,
    showModal,
    modalContent,
}): ReactElement => {
    return (
        <div className="buttonLayout">
            <div className="iconButton" onClick={onClick}>
                {icon && <FontAwesomeIcon icon={icon} />}
            </div>
            {showModal && <div className="buttonModal">{modalContent}</div>}
        </div>
    );
};

export const MenuOutlineButton: FC<ComponentProps> = ({
    text,
    icon,
    onClick,
    showModal,
    modalContent,
    className,
    id,
}): ReactElement => {
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

const MenuButton: FC<ComponentProps> = ({
    text,
    icon,
    onClick,
    showModal,
    modalContent,
}): ReactElement => {
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
