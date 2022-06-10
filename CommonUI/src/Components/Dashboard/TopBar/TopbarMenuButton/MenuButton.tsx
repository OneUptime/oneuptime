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
    action?: MouseEventHandler;
    modalContent?: ReactElement;
    showModal?: boolean;
}

export interface MenuOutlineButtonComponentProps
    extends MenuIconButtonComponentProps {
    text?: string;
}

export const MenuIconButton: FunctionComponent<
    MenuIconButtonComponentProps
> = ({
    icon,
    action,
    showModal,
    modalContent,
}: MenuIconButtonComponentProps): ReactElement => {
    return (
        <div className="button-layout">
            <div className="icon-button" onClick={action}>
                {icon && <FontAwesomeIcon icon={icon} />}
            </div>
            {showModal && <div className="button-modal">{modalContent}</div>}
        </div>
    );
};

export const MenuOutlineButton: FunctionComponent<
    MenuOutlineButtonComponentProps
> = ({
    text,
    icon,
    action,
    showModal,
    modalContent,
}: MenuOutlineButtonComponentProps): ReactElement => {
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

const MenuButton: FunctionComponent<MenuOutlineButtonComponentProps> = ({
    text,
    icon,
    action,
    showModal,
    modalContent,
}: MenuOutlineButtonComponentProps): ReactElement => {
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
