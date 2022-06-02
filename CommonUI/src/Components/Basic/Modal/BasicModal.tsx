import React, { FunctionComponent, ReactElement } from 'react';
import Button from '../Button/Button';
import ButtonTypes from '../Button/ButtonTypes';
import ShortcutKey from '../ShortcutKey/ShortcutKey';

import './Modal.scss';

export interface ComponentProps {
    title: string;
    description?: string;
    children?: Array<ReactElement> | ReactElement;
}

const BasicModal: FunctionComponent<ComponentProps> = ({
    title,
    description,
    children,
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
                    <Button
                        id="cancel"
                        title="Cancel"
                        shortcutKey={ShortcutKey.Esc}
                        type={ButtonTypes.Button}
                    />
                    <Button
                        id="primary"
                        title="Save"
                        shortcutKey={ShortcutKey.Enter}
                        type={ButtonTypes.Button}
                    />
                </div>
            </div>
        </>
    );
};

export default BasicModal;
