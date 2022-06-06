import { IconProp } from '@fortawesome/fontawesome-svg-core';
import React, { ReactElement, FC, MouseEventHandler } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import './MenuButton.scss';

export interface ComponentProps {
    text?: string;
    icon?: IconProp;
    action?: MouseEventHandler;
    modalContent?: ReactElement;
    showModal?: boolean;
}

export const MenuIconButton: FunctionComponent<ComponentProps> = ({
    icon,
    action,
    showModal,
    modalContent,
}): ReactElement => {
    return (
        <div className="button-layout">
            <div className="icon-button" onClick={action}>
                {icon && <FontAwesomeIcon icon={icon} />}
            </div>
            {showModal && <div className="button-modal">{modalContent}</div>}
        </div>
    );
};

export const MenuOutlineButton: FunctionComponent<ComponentProps> = ({
    text,
    icon,
    action,
    showModal,
    modalContent,
}): ReactElement => {
    return (
        <div className="button-layout">
            <div className="button" onClick={action}>
                <span>{text}</span>
                {icon && <FontAwesomeIcon icon={icon} />}
            </div>
            {showModal && <div className="button-modal">{modalContent}</div>}
        </div>
    );
};

const MenuButton: FunctionComponent<ComponentProps> = ({
    text,
    icon,
    action,
    showModal,
    modalContent,
}): ReactElement => {
    return (
        <div className="button-layout">
            <div className="menu-button" onClick={action}>
                {icon && <FontAwesomeIcon icon={icon} />}
                <span>{text}</span>
            </div>
            {showModal && <div className="button-modal">{modalContent}</div>}
        </div>
    );
};

export default MenuButton;
