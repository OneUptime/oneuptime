import React, { FunctionComponent, ReactElement } from 'react';
import { MouseOnClick } from '../../../Types/HtmlEvents';
import Button from '../Button/Button';
import ButtonTypes from '../Button/ButtonTypes';
import ShortcutKey from '../ShortcutKey/ShortcutKey';

import './Modal.scss';

export interface ComponentProps {
    title: string;
    description?: string;
    children: Array<ReactElement> | ReactElement;
    onClick?: MouseOnClick;
    closeModal?: Function;
    showPrimaryButton?: boolean;
    showCancelButton?: boolean;
    primaryButtonText?: string;
    cancelButtonText?: string;
}

const BasicModal: FunctionComponent<ComponentProps> = ({
    title,
    description,
    children,
    showPrimaryButton,
    showCancelButton = true,
    primaryButtonText = 'Save',
    cancelButtonText = 'Cancel',
    onClick,
}): ReactElement => {
    return (
        <>
            <div className="basic-modal-backdrop"></div>
            <div className="basic-modal">
                <div className="basic-modal__details">
                    <h2 className="basic-modal__details-title">{title}</h2>
                    <p className="basic-modal__details-description">
                        {description}
                    </p>
                </div>
                <div className="basic-modal__content">{children}</div>
                <div className="basic-modal__footer">
                    {showCancelButton && (
                        <Button
                            id="cancel"
                            title={cancelButtonText}
                            shortcutKey={ShortcutKey.Esc}
                            type={ButtonTypes.Button}
                        />
                    )}
                    {showPrimaryButton && (
                        <Button
                            id="primary"
                            title={primaryButtonText}
                            shortcutKey={ShortcutKey.Enter}
                            type={ButtonTypes.Button}
                            onClick={onClick!}
                        />
                    )}
                </div>
            </div>
        </>
    );
};

export default BasicModal;
